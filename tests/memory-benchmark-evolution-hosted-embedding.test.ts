import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../src/semantic-model";
import { OH_HOSTED_PROFILE_SHA256_V2 } from "../src/semantic-hosted-model";
import { hostedCorpusRecordsV1, hostedCorpusV1, HostedEmbeddingPreparationError, planHostedEmbeddingsV1,
  prepareHostedEmbeddingsV1, prepareEvolutionHostedCorpusV1, validateEvolutionHostedContextSourcesV1,
  type HostedEmbeddingBatchV1 } from "../scripts/benchmarks/evolution-hosted-embedding";
const authoritySha256 = sha256Hex("synthetic metered authority, no provider");
const corpus = { id: "synthetic", groupId: "group", turns: [
  { id: "t0", sessionId: "s0", date: "2024-01-01", speaker: "user", text: "Cobalt is the unrelated subject." },
  { id: "t1", sessionId: "s1", date: "2024-01-02", speaker: "assistant", text: "The atlas is in the red cabinet." },
  { id: "t2", sessionId: "s2", date: "2024-01-03", speaker: "user", text: "A third topic." },
] };
const vector = (index: number, sign = 1) => Array.from({ length: 1536 }, (_, i) => i === index ? sign : 0);
function reply(batch: HostedEmbeddingBatchV1) {
  return { receipt: { authoritySha256, settlementSha256: sha256Hex(`settled:${batch.batchSha256}`),
    requestSha256: sha256Hex(`request:${batch.batchSha256}`), responseSha256: sha256Hex(`response:${batch.batchSha256}`),
    profileSha256: batch.profileSha256, role: batch.role, inputSha256s: batch.inputSha256s,
    knownCostMicros: 2, reservationMicros: 10, latencyMs: 7, physicalCalls: 1 },
    vectors: batch.inputs.map(input => batch.role === "query" || input.includes("red cabinet") ? vector(0)
      : input.includes("Cobalt") ? vector(1) : vector(0, -1)) };
}
async function fixture(value: unknown = corpus, queries: readonly string[] = ["cobalt"]) {
  const calls: HostedEmbeddingBatchV1[] = [];
  const prepared = await prepareHostedEmbeddingsV1({ records: hostedCorpusRecordsV1(value), queries, authoritySha256,
    embed: async batch => { calls.push(batch); return reply(batch); } });
  return { ...prepared, calls };
}
test("fake metered preparation runs actual Oh SQLite semantic/hybrid and authenticates original dated contexts", async () => {
  const fixtureResult = await fixture();
  expect(fixtureResult.calls.map(call => call.role)).toEqual(["document", "query"]);
  expect(fixtureResult.attributed).toEqual({ physicalCalls: 2, knownCostMicros: 4, serviceMs: 14 });
  expect(fixtureResult.snapshot.profileSha256).toBe(OH_HOSTED_PROFILE_SHA256_V2);
  expect(fixtureResult.snapshot.profileSha256).not.toBe(canonicalSha256(OH_EMBEDDING_PROFILE_V1));
  const prepared = await prepareEvolutionHostedCorpusV1(corpus, fixtureResult.snapshot);
  try {
    const semantic = await prepared.retrieve("cobalt", "semantic"), hybrid = await prepared.retrieve("cobalt", "hybrid");
    expect(semantic.turnIds[0]).toBe("t1"); expect(hybrid.turnIds[0]).toBe("t0");
    expect(semantic.context.startsWith("[t1] [2024-01-02] assistant: The atlas is in the red cabinet.")).toBe(true);
    expect(semantic.sources.map(s => s.turnId)).toEqual([...semantic.turnIds]);
    expect(semantic.contextBytes).toBe(Buffer.byteLength(semantic.context));
    expect(await validateEvolutionHostedContextSourcesV1({ corpus, snapshot: fixtureResult.snapshot, query: "cobalt", result: semantic })).toEqual(semantic);
    const reseal = (raw: typeof semantic) => { const { resultSha256: _, ...payload } = raw; return { ...payload, resultSha256: canonicalSha256(payload) }; };
    for (const changed of [reseal({ ...semantic, mode: "hybrid" }), reseal({ ...semantic, profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1) }),
      reseal({ ...semantic, turnIds: [...semantic.turnIds].reverse() }), reseal({ ...semantic, context: semantic.context + "altered" })]) {
      await expect(validateEvolutionHostedContextSourcesV1({ corpus, snapshot: fixtureResult.snapshot, query: "cobalt", result: changed })).rejects.toThrow();
    }
    await expect(prepared.retrieve("unplanned exact query", "hybrid")).rejects.toThrow("fallback is forbidden");
  } finally { await prepared.close(); }
  expect(fixtureResult.calls.length).toBe(2);
});
test("source projection never reads gold or evidence getters and detaches before metered calls", async () => {
  const source = structuredClone(corpus);
  for (const value of [source, ...source.turns]) {
    Object.defineProperty(value, "answer", { enumerable: true, get() { throw Error("Gold must remain outside ingestion"); } });
    Object.defineProperty(value, "evidenceTurnIds", { enumerable: true, get() { throw Error("Annotations must remain outside ingestion"); } });
  }
  expect(hostedCorpusV1(source)).toEqual(corpus);
  const records = hostedCorpusRecordsV1(source), promises: Promise<unknown>[] = [];
  const result = await prepareHostedEmbeddingsV1({ records, queries: ["cobalt", "cobalt"], authoritySha256, embed: async batch => {
    expect(Object.isFrozen(batch)).toBe(true); expect(Object.isFrozen(batch.inputs)).toBe(true);
    expect(batch.inputs.every(input => !input.includes("evidenceTurnIds") && !input.includes('"answer"'))).toBe(true);
    promises.push(Promise.resolve()); return reply(batch);
  } });
  expect(result.snapshot.queries.length).toBe(1); expect(result.snapshot.records.length).toBe(3);
  expect(promises.length).toBe(2);
});
test("complete workload bounds and source changes fail before calls or source acceptance", async () => {
  let calls = 0;
  const embed = async (batch: HostedEmbeddingBatchV1) => { calls++; return reply(batch); };
  await expect(prepareHostedEmbeddingsV1({ records: hostedCorpusRecordsV1(corpus), queries: ["x".repeat(8193)], authoritySha256, embed })).rejects.toThrow();
  await expect(prepareHostedEmbeddingsV1({ records: [], queries: ["cobalt"], authoritySha256, embed })).rejects.toThrow();
  expect(calls).toBe(0);
  const done = await fixture(), changed = structuredClone(corpus); changed.turns[0]!.text = "changed source";
  await expect(prepareEvolutionHostedCorpusV1(changed, done.snapshot)).rejects.toThrow("source mismatch");
  const plan = planHostedEmbeddingsV1({ records: hostedCorpusRecordsV1(corpus), queries: ["cobalt"], authoritySha256 });
  expect(plan.inputBytes).toBe(plan.inputs.reduce((sum, row) => sum + Buffer.byteLength(row.input), 0));
});
test("scalar-safe chunks preserve an entire oversized source turn and fixed96KB packing skips whole turns", async () => {
  const long = { id: "long", groupId: "group", turns: [
    { ...corpus.turns[1]!, id: "long-turn", text: "red cabinet "+"🪻".repeat(26000) }, corpus.turns[0]!,
  ] };
  const done = await fixture(long), record = done.snapshot.records[0]!;
  expect(record.chunks.length).toBeGreaterThan(25);
  const texts = done.plan.inputs.filter(i => i.role === "document").slice(0, record.chunks.length).map(i => i.input);
  expect(texts.every(input => Buffer.byteLength(input) <= 4096 && !input.includes("�"))).toBe(true);
  expect(texts.join("").includes(long.turns[0]!.text)).toBe(true);
  const prepared = await prepareEvolutionHostedCorpusV1(long, done.snapshot);
  try { const context = await prepared.retrieve("cobalt", "semantic"); expect(context.turnIds).toEqual(["t0"]);
    expect(context.omittedForBudget).toBe(1); expect(context.contextBytes).toBeLessThanOrEqual(96000); }
  finally { await prepared.close(); }
});
test("bounded concurrent failure drains started batches, retains settled evidence and never retries", async () => {
  const many = { id: "many", groupId: "g", turns: Array.from({ length: 520 }, (_, index) => ({ ...corpus.turns[0]!, id: `t${index}` })) };
  const records = hostedCorpusRecordsV1(many), started: number[] = [], finished: number[] = [];
  let resolveSecond!: () => void;
  const second = new Promise<void>(resolve => { resolveSecond = resolve; });
  const pending = prepareHostedEmbeddingsV1({ records, queries: ["cobalt"], authoritySha256, concurrency: 2, embed: async batch => {
    started.push(batch.batchIndex);
    if (batch.batchIndex === 0) { queueMicrotask(resolveSecond); throw Error("synthetic occupied transport failure"); }
    await second; finished.push(batch.batchIndex); return reply(batch);
  } });
  try { await pending; throw Error("Expected failure"); } catch (error) {
    expect(error).toBeInstanceOf(HostedEmbeddingPreparationError);
    const stopped = error as HostedEmbeddingPreparationError;
    expect(stopped.complete).toBe(false); expect(stopped.attemptedBatches).toBe(2);
    expect(stopped.settledReceipts.length).toBe(1); expect(stopped.plannedBatches).toBeGreaterThan(2);
  }
  expect(started).toEqual([0, 1]); expect(finished).toEqual([1]);
});
test("wrong batch, profile, authority, incomplete vector and duplicate receipts fail closed", async () => {
  for (const mutate of [
    (r: ReturnType<typeof reply>) => { r.receipt.authoritySha256 = sha256Hex("wrong authority"); },
    (r: ReturnType<typeof reply>) => { r.receipt.profileSha256 = canonicalSha256(OH_EMBEDDING_PROFILE_V1); },
    (r: ReturnType<typeof reply>) => { r.receipt.inputSha256s = [sha256Hex("wrong input")]; },
    (r: ReturnType<typeof reply>) => { r.vectors.pop(); },
    (r: ReturnType<typeof reply>) => { r.vectors[0] = vector(0, 0); },
  ]) {
    let calls = 0;
    await expect(prepareHostedEmbeddingsV1({ records: hostedCorpusRecordsV1(corpus), queries: ["cobalt"], authoritySha256,
      embed: async batch => { calls++; const value = reply(batch); mutate(value); return value; } })).rejects.toBeInstanceOf(HostedEmbeddingPreparationError);
    expect(calls).toBe(1);
  }
  await expect(prepareHostedEmbeddingsV1({ records: hostedCorpusRecordsV1(corpus), queries: ["cobalt"], authoritySha256,
    embed: async batch => { const value = reply(batch); value.receipt.requestSha256 = sha256Hex("duplicate"); return value; } })).rejects.toBeInstanceOf(HostedEmbeddingPreparationError);
});

test("public hosted profile and schema match the distinct runtime contract", async () => {
  const root = new URL("../spec/hosted-embedding-v1/", import.meta.url);
  const profile = await Bun.file(new URL("profile.json", root)).json();
  const manifest = await Bun.file(new URL("manifest.json", root)).json();
  const schema = await Bun.file(new URL("snapshot.schema.json", root)).json();
  expect(canonicalSha256(profile)).toBe(OH_HOSTED_PROFILE_SHA256_V2);
  expect(manifest.profileSha256).toBe(OH_HOSTED_PROFILE_SHA256_V2);
  expect(schema.properties.profileSha256.const).toBe(OH_HOSTED_PROFILE_SHA256_V2);
  expect(schema.properties.protocol.const).toBe("oh.semantic-hosted-snapshot.v1");
  expect(schema.$defs.embedding.properties.vector.minItems).toBe(1536);
  expect(schema.$defs.embedding.properties.vector.maxItems).toBe(1536);
});
test("foreign accessor and sparse provider wrappers are rejected without evaluation", async () => {
  for (const mode of ["accessor", "sparse"]) {
    let accessed = false, calls = 0;
    await expect(prepareHostedEmbeddingsV1({ records: hostedCorpusRecordsV1(corpus), queries: ["cobalt"], authoritySha256,
      embed: async batch => {
        calls++; const result = reply(batch);
        if (mode === "accessor") Object.defineProperty(result, "vectors", { enumerable: true, get() { accessed = true; throw Error("must not run"); } });
        else delete result.vectors[0];
        return result;
      } })).rejects.toBeInstanceOf(HostedEmbeddingPreparationError);
    expect(accessed).toBe(false); expect(calls).toBe(1);
  }
});
test("empty source fields are preserved and cancellation prevents metered dispatch", async () => {
  const source = { ...corpus, turns: [{ ...corpus.turns[0]!, date: "", text: "" }] };
  expect(hostedCorpusV1(source)).toEqual(source);
  let accessed = false;
  const foreign = { ...source };
  Object.defineProperty(foreign, "turns", { enumerable: true, get() { accessed = true; throw Error("must not run"); } });
  expect(() => hostedCorpusV1(foreign)).toThrow("data property"); expect(accessed).toBe(false);
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await expect(prepareHostedEmbeddingsV1({ records: hostedCorpusRecordsV1(source), queries: ["cobalt"], authoritySha256,
    signal: controller.signal, embed: async batch => { calls++; return reply(batch); } })).rejects.toBeInstanceOf(HostedEmbeddingPreparationError);
  expect(calls).toBe(0);
});
test("foreign context accessors are rejected without reading source metadata getters", async () => {
  const done = await fixture(), prepared = await prepareEvolutionHostedCorpusV1(corpus, done.snapshot);
  try {
    const original = await prepared.retrieve("cobalt", "semantic");
    for (const where of ["mode", "source"]) {
      const result = structuredClone(original); let reads = 0;
      if (where === "mode") Object.defineProperty(result, "mode", { enumerable: true, get() { reads++; return "semantic"; } });
      else Object.defineProperty(result.sources[0]!, "turnId", { enumerable: true, get() { reads++; return "t1"; } });
      await expect(validateEvolutionHostedContextSourcesV1({ corpus, snapshot: done.snapshot, query: "cobalt", result })).rejects.toThrow("data property");
      expect(reads).toBe(0);
    }
  } finally { await prepared.close(); }
});
