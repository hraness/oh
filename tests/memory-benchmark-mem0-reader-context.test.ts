import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeMem0DerivationReceipt, validateMem0SelectedCorpus } from "../scripts/benchmarks/mem0-parent";
import { validateMem0BridgePolicy } from "../scripts/benchmarks/mem0-ledger";
import { MEM0_READER_CONTEXT_POLICY, packMem0ReaderContext, validateMem0ReaderSearchBinding,
  validateMem0WorkerSearchResult, makeMem0ReaderSearchBinding, type Mem0ReaderSearchBinding } from "../scripts/benchmarks/mem0-reader-context";

function fixture(memories: readonly string[] = ["The user keeps a paper notebook.", "The user moved last spring."]) {
  const turns = ["Private source text that must not enter the reader context.", "A second original source turn."].map((text, index) => ({
    turnId: sha256Hex(`part-${index}`), sourceTurnId: sha256Hex(`source-${index}`), sourceTurnSha256: sha256Hex(text),
    sessionId: sha256Hex(`session-${index}`), date: "2024-01-01", role: "user", text,
    utf8Start: 0, utf8End: Buffer.byteLength(text), sourceUtf8Bytes: Buffer.byteLength(text),
  }));
  const chunks = turns.map((turn, index) => ({ chunkId: sha256Hex(`chunk-${index}`), sourceSha256: canonicalSha256([turn]), turns: [turn] }));
  const corpus = validateMem0SelectedCorpus({ protocol: "oh.memory.mem0-selected-corpus.v1", dataset: "longmemeval-s", partition: "development",
    corpusId: sha256Hex("synthetic-corpus"), corpusSha256: canonicalSha256(chunks.map(({ chunkId, sourceSha256 }) => ({ chunkId, sourceSha256 }))),
    chunks, sourceReceiptSha256: sha256Hex("context-plan") });
  const llmProfile = { id: "synthetic-llm", kind: "llm", model: "openai/gpt-5-nano", provider: "openai",
    endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions", maxInputTokens: 100000, maxOutputTokens: 8192,
    embeddingDimensions: null, timeoutMs: 45000, inputNanodollarsPerToken: 50, outputNanodollarsPerToken: 400 };
  const embeddingProfile = { id: "synthetic-embedding", kind: "embedding", model: "openai/text-embedding-3-small", provider: "openai",
    endpoint: "https://ai-gateway.vercel.sh/v1/embeddings", maxInputTokens: 8192, maxOutputTokens: 0,
    embeddingDimensions: 1536, timeoutMs: 15000, inputNanodollarsPerToken: 20, outputNanodollarsPerToken: 0 };
  const policyIdentitySha256 = canonicalSha256({ protocol: "oh.memory.mem0-bridge-policy.v1", llmProfile, embeddingProfile });
  const runSha256 = canonicalSha256({ protocol: "oh.memory.mem0-parent-run.v1", policyIdentitySha256,
    corpusSha256: corpus.corpusSha256, sourceReceiptSha256: corpus.sourceReceiptSha256 });
  const policy = validateMem0BridgePolicy({ protocol: "oh.memory.mem0-bridge-policy.v1", runSha256,
    namespace: canonicalSha256({ protocol: "oh.memory.mem0-parent-namespace.v1", runSha256 }), llmProfile, embeddingProfile });
  const derivation = makeMem0DerivationReceipt(policy, corpus);
  const result = { results: memories.map((memory, index) => ({ memory, metadata: { chunkId: chunks[index % chunks.length]!.chunkId,
    sourceDigest: chunks[index % chunks.length]!.sourceSha256 } })) };
  const binding: Mem0ReaderSearchBinding = { protocol: "oh.memory.mem0-reader-search-binding.v1", sourceArtifactSha256: sha256Hex("source-receipt-file"),
    sourceReceiptSha256: corpus.sourceReceiptSha256, corpusSha256: corpus.corpusSha256, derivationReceiptSha256: derivation.receiptSha256,
    policySha256: derivation.policySha256, namespace: derivation.namespace, querySha256: sha256Hex("What does the user prefer?"),
    workerSha256: sha256Hex("worker"), runtimeSha256: sha256Hex("runtime"), executionSourceSha256: sha256Hex("execution-source"),
    searchReceiptSha256: sha256Hex("search-receipt-file"), searchResultSha256: canonicalSha256(result), topK: 50, threshold: 0.1, rerank: false };
  return { corpus, policy, result, binding, expectedBindingSha256: canonicalSha256(binding), contextBytes: 48_000 as const };
}
function repin<T extends ReturnType<typeof fixture>>(input: T, result: unknown) {
  const binding = { ...input.binding, searchResultSha256: canonicalSha256(result) };
  return { ...input, result, binding, expectedBindingSha256: canonicalSha256(binding) };
}

test("current worker shape preserves order, exact derived text and provenance without source or gold rendering", () => {
  const f = fixture(), context = packMem0ReaderContext(f);
  const { sourceArtifactSha256, querySha256, workerSha256, runtimeSha256, executionSourceSha256, searchReceiptSha256 } = f.binding;
  expect(makeMem0ReaderSearchBinding({ corpus: f.corpus, policy: f.policy, result: f.result,
    pins: { sourceArtifactSha256, querySha256, workerSha256, runtimeSha256, executionSourceSha256, searchReceiptSha256 } })).toEqual(f.binding);
  expect(context.context.indexOf(f.result.results[0]!.memory)).toBeLessThan(context.context.indexOf(f.result.results[1]!.memory));
  expect(context.context).not.toContain(f.corpus.chunks[0]!.turns[0]!.text);
  expect(context.context).not.toContain(f.result.results[0]!.metadata.sourceDigest);
  expect(context.included.map(row => row.rank)).toEqual([1, 2]);
  expect(context.included.map(row => row.chunkId)).toEqual(f.result.results.map(row => row.metadata.chunkId));
  expect(context.contextSha256).toBe(sha256Hex(context.context));
  expect(context.contextBytes).toBe(Buffer.byteLength(context.context));
  expect(context.contentKind).toBe("model-derived-memory");
  expect(MEM0_READER_CONTEXT_POLICY).toMatchObject({ sdkIdsAvailable: false, sdkScoresAvailable: false, topK: 50, threshold: 0.1, rerank: false });
  expect(packMem0ReaderContext(f)).toEqual(context);
  const { resultSha256, ...payload } = context; expect(resultSha256).toBe(canonicalSha256(payload));
});

test("fixed byte budgets preserve a whole-memory prefix, exact UTF-8, all omissions and duplicate projections", () => {
  const base = fixture(["a"]), overhead = packMem0ReaderContext(base).contextBytes - 1;
  const exact = fixture(["x".repeat(48_000 - overhead)]);
  expect(packMem0ReaderContext(exact)).toMatchObject({ contextBytes: 48_000, includedCount: 1, omittedCount: 0 });
  const oneOver = fixture(["x".repeat(48_000 - overhead + 1), "tiny"]);
  expect(packMem0ReaderContext(oneOver)).toMatchObject({ contextBytes: 0, includedCount: 0, omittedCount: 2 });
  const large = fixture(["é".repeat(25_000), "small", "😀"]);
  expect(packMem0ReaderContext(large).includedCount).toBe(0);
  const wide = packMem0ReaderContext({ ...large, contextBytes: 96_000 });
  expect(wide.includedCount).toBe(3); expect(wide.contextBytes).toBe(Buffer.byteLength(wide.context));
  expect(wide.included.map(row => row.memoryBytes)).toEqual([50_000, 5, 4]);
  const duplicates = fixture(["same"]), row = duplicates.result.results[0]!;
  const duplicated = packMem0ReaderContext(repin(duplicates, { results: [row, row] }));
  expect(duplicated.duplicateProjectionRows).toBe(1); expect(duplicated.includedCount).toBe(2);
  expect(duplicated.included[0]!.rowSha256).toBe(duplicated.included[1]!.rowSha256);
  expect(duplicated.included[0]!.derivedRowId).not.toBe(duplicated.included[1]!.derivedRowId);
  expect(packMem0ReaderContext(fixture([]))).toMatchObject({ context: "", contextBytes: 0, includedCount: 0, omittedCount: 0 });
  expect(() => packMem0ReaderContext({ ...base, contextBytes: 64_000 as 48_000 })).toThrow("48KB or 96KB");
});

test("foreign chunks, changed derivations, unknown labels and malformed omitted rows fail before packing", () => {
  const f = fixture(["x".repeat(60_000)]), row = f.result.results[0]!;
  const badRows = [{ ...row, answer: "gold" }, { ...row, id: "not-in-worker-projection" }, { ...row, score: 0.8 },
    { ...row, metadata: { ...row.metadata, namespace: f.binding.namespace } },
    { ...row, metadata: { ...row.metadata, chunkId: sha256Hex("foreign") } },
    { ...row, metadata: { ...row.metadata, sourceDigest: sha256Hex("changed") } },
    { ...row, memory: "" }, { ...row, memory: "\ud800" }, { ...row, memory: "x".repeat(262_145) }];
  for (const bad of badRows) {
    expect(() => validateMem0WorkerSearchResult({ results: [row, bad] }, f.corpus)).toThrow();
    expect(() => packMem0ReaderContext(repin(f, { results: [row, bad] }))).toThrow();
  }
  expect(() => validateMem0WorkerSearchResult({ ...f.result, category: "label" }, f.corpus)).toThrow("exact shape");
  expect(() => packMem0ReaderContext({ ...f, corpus: { ...f.corpus, answer: "gold" } })).toThrow();
  for (const key of ["namespace", "corpusSha256", "sourceReceiptSha256", "derivationReceiptSha256", "policySha256"] as const) {
    const binding = { ...f.binding, [key]: sha256Hex(`changed-${key}`) };
    expect(() => packMem0ReaderContext({ ...f, binding, expectedBindingSha256: canonicalSha256(binding) })).toThrow("binding mismatch");
  }
});

test("search, artifact, query, worker and runtime pins remain distinct and bounded", () => {
  const f = fixture();
  for (const key of ["querySha256", "workerSha256", "runtimeSha256", "executionSourceSha256", "sourceArtifactSha256", "searchReceiptSha256"] as const) {
    expect(() => packMem0ReaderContext({ ...f, binding: { ...f.binding, [key]: sha256Hex(key) } })).toThrow("binding pin");
  }
  expect(() => packMem0ReaderContext({ ...f, result: { results: f.result.results.slice().reverse() } })).toThrow("result pin");
  for (const changed of [{ topK: 49 }, { threshold: 0.2 }, { rerank: true }, { answer: "gold" }, { runtimeSha256: "A".repeat(64) }]) {
    expect(() => validateMem0ReaderSearchBinding({ ...f.binding, ...changed })).toThrow();
  }
  const row = f.result.results[0]!;
  expect(() => validateMem0WorkerSearchResult({ results: Array(51).fill(row) }, f.corpus)).toThrow("topK");
  expect(() => validateMem0WorkerSearchResult({ results: Array(5).fill({ ...row, memory: "x".repeat(262_144) }) }, f.corpus)).toThrow("result byte bound");
  const original = packMem0ReaderContext(f); f.result.results[0]!.memory = "mutated later";
  expect(original.context).not.toContain("mutated later");
});

test("an exact real-SDK current-projection capture joins its admitted synthetic source without modification", async () => {
  const sourceRaw = await Bun.file(new URL("fixtures/mem0-reader-context-sdk-input-v1.json", import.meta.url)).text();
  const resultRaw = await Bun.file(new URL("fixtures/mem0-reader-context-sdk-result-v1.json", import.meta.url)).text();
  expect<string>(sha256Hex(sourceRaw)).toBe("1340414aecba509ca22d2db8134d6da73e16d6b95ecb0d49da7d6cfa4a232b9e");
  expect<string>(sha256Hex(resultRaw)).toBe("e8ebca5e72b34ba661ba82d038a6d3bb6e9ec19f6638910195c1252d8eaafcd7");
  const source = JSON.parse(sourceRaw) as { corpus: unknown; policy: unknown; derivation: unknown; query: string; querySha256: string };
  const result: unknown = JSON.parse(resultRaw);
  expect<unknown>(makeMem0DerivationReceipt(source.policy, source.corpus)).toEqual(source.derivation);
  expect<string>(sha256Hex(source.query)).toBe(source.querySha256);
  // Runtime/worker/source hashes are synthetic admission pins in this pure test.
  // The recorded fixture itself came from the pinned real SDK with a fake RPC.
  const binding = makeMem0ReaderSearchBinding({ corpus: source.corpus, policy: source.policy, result,
    pins: { sourceArtifactSha256: sha256Hex(sourceRaw), searchReceiptSha256: sha256Hex(resultRaw), querySha256: source.querySha256,
      workerSha256: sha256Hex("qualified-worker-fixture"), runtimeSha256: sha256Hex("qualified-runtime-fixture"), executionSourceSha256: sha256Hex("fixture-source") } });
  const prepared = { corpus: source.corpus, policy: source.policy, result, binding, expectedBindingSha256: canonicalSha256(binding) };
  const narrow = packMem0ReaderContext({ ...prepared, contextBytes: 48_000 }), wide = packMem0ReaderContext({ ...prepared, contextBytes: 96_000 });
  expect(narrow).toMatchObject({ retrievedCount: 1, includedCount: 1, omittedCount: 0, duplicateProjectionRows: 0 });
  expect(narrow.context).toContain("alpha fact");
  expect(narrow.context).not.toContain("Remember alpha preference");
  expect(narrow.context).toBe(wide.context);
  expect(narrow.included[0]!.sourceDigest).toBe("cfa93e2f398b41a1d7f24215c021a85a7d2ebc92d07c3c8d0d5324f5324a3b04");
});
