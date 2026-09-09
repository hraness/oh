import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { invokeMem0Request, makeMem0EmbeddingRequest, makeMem0LlmRequest, openMem0Ledger, parseMem0Response } from "../scripts/benchmarks/mem0-ledger";

const hex = (char: string) => char.repeat(64);
const policy = { protocol: "oh.memory.mem0-bridge-policy.v1", runSha256: hex("a"), namespace: hex("b"),
  llmProfile: { id: "mem0-extract", kind: "llm", model: "openai/test-extract", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions", maxInputTokens: 100_000, maxOutputTokens: 100, embeddingDimensions: null, timeoutMs: 1_000, inputNanodollarsPerToken: 2, outputNanodollarsPerToken: 4 },
  embeddingProfile: { id: "mem0-embed", kind: "embedding", model: "openai/test-embed", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/embeddings", maxInputTokens: 100_000, maxOutputTokens: 0, embeddingDimensions: 3, timeoutMs: 1_000, inputNanodollarsPerToken: 3, outputNanodollarsPerToken: 0 } } as const;
let directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function ledger(cap = 1_000_000, maximumCalls = 3) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "mem0-ledger-test-"))), pin = async (name: string, value: unknown) => { const path = join(directory, name), raw = new TextEncoder().encode(JSON.stringify(value)); await writeFile(path, raw, { mode: 0o600 }); return { path, sha256: sha256Hex(raw) }; };
  directories.push(directory);
  const historical = join(directory, "historical.jsonl"); await writeFile(historical, "", { mode: 0o600 }); const authority = await pin("gateway-authority.json", { schema: "oh.gateway-v3-authority.v1", project: "test", scope: "scope", environment: "development" });
  const campaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic", storeDirectory: join(directory, "separate-campaign-store"), approval: "Synthetic no-network fixture", additionalBudgetMicros: 100, maximumCalls: 10, historicalExposureMicros: 0, historicalLedgers: [{ path: historical, sha256: sha256Hex(""), bytes: 0 }], authAuthority: authority } as const;
  const campaignPin = await pin("campaign.json", campaign), policyPin = await pin("policy.json", policy);
  const accountingPin = await pin("accounting.json", { protocol: "oh.memory.mem0-antecedent-accounting.v1", campaignPin, campaignSha256: canonicalSha256(campaign), historicalExposureMicros: 0, completedCampaignExposureMicros: 17, cumulativeExposureMicros: 17 });
  return { directory, authority: { protocol: "oh.memory.mem0-ledger-authority.v1", ledgerId: "synthetic", directory, additionalBudgetMicros: cap, maximumCalls, policyPins: [policyPin], antecedentAccountingPin: accountingPin } as const, ledger: openMem0Ledger({ protocol: "oh.memory.mem0-ledger-authority.v1", ledgerId: "synthetic", directory, additionalBudgetMicros: cap, maximumCalls, policyPins: [policyPin], antecedentAccountingPin: accountingPin } as const) };
}
function raw(request: ReturnType<typeof makeMem0LlmRequest>, content = '{"memory":[]}') { return new TextEncoder().encode(JSON.stringify({ model: request.profile.model, providerMetadata: { gateway: { routing: { finalProvider: request.profile.provider, originalModelId: request.profile.model, canonicalSlug: request.profile.model }, cost: 0.000002 } }, usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } }, choices: [{ finish_reason: "stop", message: { role: "assistant", content, refusal: null } }] })); }
function embedRaw(request: ReturnType<typeof makeMem0EmbeddingRequest>) { return new TextEncoder().encode(JSON.stringify({ object: "list", model: request.profile.model, providerMetadata: { gateway: { routing: { finalProvider: request.profile.provider, originalModelId: request.profile.model, canonicalSlug: request.profile.model }, cost: 0.000002 } }, usage: { prompt_tokens: 2, total_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } }, data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })); }
function oidc() { const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"), now = Math.floor(Date.now() / 1000); return `${encode({ alg: "RS256" })}.${encode({ sub: "owner:scope:project:test:environment:development", aud: "https://vercel.com/scope", iss: "https://oidc.vercel.com/scope", iat: now, exp: now + 600 })}.signature`; }
describe("Mem0 typed parent ledger", () => {
  test("replays a settled extraction once and carries pinned cumulative antecedent exposure", async () => { const fixture = await ledger(), current = await fixture.ledger; const request = makeMem0LlmRequest(policy, 0, [{ role: "system", content: "extract" }, { role: "user", content: "alpha" }]); await current.admit(request); const body = raw(request); await current.capture(request, body, { httpStatus: 200, complete: true, receivedBytes: body.length, error: null, serviceMs: 9 }); const result = await current.finalize(request); expect(result.value).toEqual({ content: '{"memory":[]}' }); expect(current.summary()).toMatchObject({ calls: 1, antecedentExposureMicros: 17, combinedExposureMicros: result.usage.micros + 17 }); expect(current.lookup(request).kind).toBe("hit"); await expect(current.admit(request)).rejects.toThrow("duplicate"); await current.close(); });
  test("captures malformed first responses as charged occupied requests", async () => { const fixture = await ledger(), current = await fixture.ledger; const request = makeMem0EmbeddingRequest(policy, 1, "ingest-embed", "alpha"); await current.admit(request); const body = new TextEncoder().encode("not json"); await current.capture(request, body, { httpStatus: 200, complete: true, receivedBytes: body.length, error: null, serviceMs: 3 }); await expect(current.finalize(request)).rejects.toThrow(); expect(current.lookup(request)).toEqual({ kind: "occupied", state: "captured" }); expect(current.summary().exposureMicros).toBe(request.reservationMicros); await current.close(); });
  test("accepts typed observed usage and rejects incomplete LLM, malformed embedding, and ambiguous usage", () => { const embedding = makeMem0EmbeddingRequest(policy, 2, "query-embed", "alpha"); expect(parseMem0Response(embedRaw(embedding), embedding).value).toEqual({ embedding: [0.1, 0.2, 0.3] }); const invalid = JSON.parse(new TextDecoder().decode(embedRaw(embedding))); invalid.data[0].embedding[1] = "nan"; expect(() => parseMem0Response(new TextEncoder().encode(JSON.stringify(invalid)), embedding)).toThrow("embedding shape"); invalid.data[0].embedding[1] = 0.2; invalid.usage.unrecognized = 1; expect(() => parseMem0Response(new TextEncoder().encode(JSON.stringify(invalid)), embedding)).toThrow("ambiguous usage"); const extraction = makeMem0LlmRequest(policy, 3, [{ role: "system", content: "extract" }, { role: "user", content: "alpha" }]), truncated = JSON.parse(new TextDecoder().decode(raw(extraction))); truncated.choices[0].finish_reason = "length"; expect(() => parseMem0Response(new TextEncoder().encode(JSON.stringify(truncated)), extraction)).toThrow("completion shape"); });
  test("serializes concurrent admission and persists the immutable authority", async () => { const fixture = await ledger(400_000, 1), current = await fixture.ledger, first = makeMem0EmbeddingRequest(policy, 4, "query-embed", "alpha"), second = makeMem0EmbeddingRequest(policy, 5, "query-embed", "beta"); const admitted = await Promise.allSettled([current.admit(first), current.admit(first)]); expect(admitted.filter(result => result.status === "fulfilled")).toHaveLength(1); await expect(current.admit(second)).rejects.toThrow("exhausted"); await current.close(); const altered = { ...fixture.authority, additionalBudgetMicros: 400_001 }; await expect(openMem0Ledger(altered)).rejects.toThrow("persisted authority changed"); });
  test("fake transport dispatch settles once under OIDC and conservative accounting", async () => { const fixture = await ledger(), current = await fixture.ledger, request = makeMem0EmbeddingRequest(policy, 6, "query-embed", "alpha"); const result = await invokeMem0Request({ request, ledger: current, credential: { token: oidc(), auth: { method: "project-oidc", project: "test", scope: "scope", environment: "development" } }, fetcher: async () => new Response(embedRaw(request), { status: 200 }) }); expect(result.usage.micros).toBeGreaterThan(0); expect(current.summary().exposureMicros).toBe(result.usage.micros); expect(current.lookup(request).kind).toBe("hit"); await current.close(); });
});


test("capture snapshots raw bytes and transport metadata before its queued write", async () => {
  const fixture = await ledger(), current = await fixture.ledger;
  const request = makeMem0LlmRequest(policy, 7, [{ role: "system", content: "extract" }, { role: "user", content: "alpha" }]);
  await current.admit(request); const bytes = raw(request), expectedSha = sha256Hex(bytes);
  const meta = { httpStatus: 200, complete: true, receivedBytes: bytes.length, error: null, serviceMs: 3 };
  const captured = current.capture(request, bytes, meta); bytes.fill(0); meta.httpStatus = 400; await captured;
  expect((await current.finalize(request)).rawSha256).toBe(expectedSha); await current.close();
  const reopened = await openMem0Ledger(fixture.authority); expect(reopened.lookup(request).kind).toBe("hit"); await reopened.close();
});

test("HTTP failure remains occupied on reopen and replay rejects a foreign policy reservation", async () => {
  const fixture = await ledger(), current = await fixture.ledger;
  const request = makeMem0EmbeddingRequest(policy, 8, "query-embed", "alpha"), bytes = embedRaw(request);
  await current.admit(request); await current.capture(request, bytes, { httpStatus: 400, complete: true, receivedBytes: bytes.length, error: null, serviceMs: 1 });
  await expect(current.finalize(request)).rejects.toThrow("remains charged"); await current.close();
  const reopened = await openMem0Ledger(fixture.authority); expect(reopened.lookup(request)).toEqual({ kind: "occupied", state: "captured" });
  expect(reopened.summary().exposureMicros).toBe(request.reservationMicros); await reopened.close();
  const path = join(fixture.directory, "ledger.jsonl"), foreign = makeMem0EmbeddingRequest({ ...policy, runSha256: hex("c") }, 9, "query-embed", "beta");
  await writeFile(path, await readFile(path, "utf8") + JSON.stringify({ kind: "reserved", request: foreign }) + "\n", { mode: 0o600 });
  await expect(openMem0Ledger(fixture.authority)).rejects.toThrow("pinned policy");
});

test("aborted fetch and stalled response body are captured once and remain fully charged", async () => {
  const fixture = await ledger(), current = await fixture.ledger;
  const credential = { token: oidc(), auth: { method: "project-oidc", project: "test", scope: "scope", environment: "development" } } as const;
  let fetchCalls = 0;
  for (const [index, kind] of ["fetch", "body"].entries()) {
    const request = makeMem0EmbeddingRequest(policy, 20 + index, "query-embed", kind), controller = new AbortController();
    let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
    const pending = invokeMem0Request({ request, ledger: current, credential, signal: controller.signal, fetcher: async () => {
      fetchCalls++; began(); if (kind === "fetch") return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([123])); } }));
    } });
    await started; const timer = setTimeout(() => controller.abort(), 20);
    try { await expect(pending).rejects.toThrow("remains charged"); } finally { clearTimeout(timer); }
    expect(current.lookup(request)).toEqual({ kind: "occupied", state: "captured" });
    await expect(invokeMem0Request({ request, ledger: current, credential, fetcher: async () => { fetchCalls++; throw new Error("must not retry"); } })).rejects.toThrow("cannot be retried");
  }
  expect(fetchCalls).toBe(2); expect(current.summary().calls).toBe(2);
  expect(current.summary().exposureMicros).toBe(makeMem0EmbeddingRequest(policy, 20, "query-embed", "fetch").reservationMicros * 2);
  await current.close();
});
