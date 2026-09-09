import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeMem0DerivationReceipt, startMem0Worker, validateMem0SelectedCorpus, type createMem0RpcDispatcher } from "../scripts/benchmarks/mem0-parent";

const h = (char: string) => char.repeat(64);
const turns = [{ turnId: "1".repeat(16), sourceTurnId: "a".repeat(16), sourceTurnSha256: sha256Hex("Remember alpha."), sessionId: "2".repeat(16), date: "2024-01-01", role: "user", text: "Remember alpha.", utf8Start: 0, utf8End: 15, sourceUtf8Bytes: 15 }, { turnId: "3".repeat(16), sourceTurnId: "b".repeat(16), sourceTurnSha256: sha256Hex("Alpha acknowledged."), sessionId: "2".repeat(16), date: "2024-01-02", role: "assistant", text: "Alpha acknowledged.", utf8Start: 0, utf8End: 19, sourceUtf8Bytes: 19 }] as const;
const chunks = [{ chunkId: "4".repeat(16), sourceSha256: canonicalSha256(turns), turns }] as const;
const corpus = { protocol: "oh.memory.mem0-selected-corpus.v1", dataset: "longmemeval-s", partition: "development", corpusId: "5".repeat(16), corpusSha256: canonicalSha256(chunks.map(chunk => ({ chunkId: chunk.chunkId, sourceSha256: chunk.sourceSha256 }))), chunks, sourceReceiptSha256: h("b") } as const;
const llmProfile = { id: "mem0-extract", kind: "llm", model: "openai/extract", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions", maxInputTokens: 1000, maxOutputTokens: 100, embeddingDimensions: null, timeoutMs: 1000, inputNanodollarsPerToken: 50, outputNanodollarsPerToken: 400 } as const;
const embeddingProfile = { id: "mem0-embed", kind: "embedding", model: "openai/embed", provider: "openai", endpoint: "https://ai-gateway.vercel.sh/v1/embeddings", maxInputTokens: 1000, maxOutputTokens: 0, embeddingDimensions: 1536, timeoutMs: 1000, inputNanodollarsPerToken: 20, outputNanodollarsPerToken: 0 } as const;
const identity = canonicalSha256({ protocol: "oh.memory.mem0-bridge-policy.v1", llmProfile, embeddingProfile });
const runSha256 = canonicalSha256({ protocol: "oh.memory.mem0-parent-run.v1", policyIdentitySha256: identity, corpusSha256: corpus.corpusSha256, sourceReceiptSha256: corpus.sourceReceiptSha256 });
const policy = { protocol: "oh.memory.mem0-bridge-policy.v1", runSha256, namespace: canonicalSha256({ protocol: "oh.memory.mem0-parent-namespace.v1", runSha256 }), llmProfile, embeddingProfile } as const;

test("Mem0 parent preserves every ordered dated source turn while deriving an opaque namespace", () => {
  expect(validateMem0SelectedCorpus(corpus)).toEqual(corpus);
  const receipt = makeMem0DerivationReceipt(policy, corpus);
  expect(receipt).toMatchObject({ runSha256, namespace: policy.namespace, corpusSha256: corpus.corpusSha256, chunkCount: 1 });
  expect(() => makeMem0DerivationReceipt({ ...policy, namespace: h("c") }, corpus)).toThrow("does not bind");
  expect(() => validateMem0SelectedCorpus({ ...corpus, partition: "closed" })).toThrow("selected corpus");
  expect(() => validateMem0SelectedCorpus({ ...corpus, chunks: [{ ...chunks[0], turns: [{ ...turns[0], goldAnswer: "leak" }] }] })).toThrow("exact");
});

test("source continuation validation rejects resealed gaps, stale bytes, and dated chunk overflow", () => {
  const reseal = (changed: unknown[]) => { const entries = [{ chunkId: "4".repeat(16), sourceSha256: canonicalSha256(changed), turns: changed }]; return { ...corpus, chunks: entries, corpusSha256: canonicalSha256(entries.map(({chunkId, sourceSha256}) => ({chunkId, sourceSha256}))) }; };
  expect(() => validateMem0SelectedCorpus(reseal([{ ...turns[0], text: "Remember omega." }]))).toThrow("reconstruction");
  expect(() => validateMem0SelectedCorpus(reseal([{ ...turns[0], utf8Start: 1, utf8End: 16, sourceUtf8Bytes: 16 }]))).toThrow("gap");
  const content = "x".repeat(4096);
  expect(() => validateMem0SelectedCorpus(reseal([{ ...turns[0], text: content, sourceTurnSha256: sha256Hex(content), utf8End: 4096, sourceUtf8Bytes: 4096 }]))).toThrow("byte");
  const first = { ...turns[0], text: "Remember ", utf8End: 9 }, second = { ...turns[0], turnId: "6".repeat(16), text: "alpha.", utf8Start: 9 };
  expect(validateMem0SelectedCorpus(reseal([first, second])).chunks[0]!.turns).toHaveLength(2);
  expect(() => validateMem0SelectedCorpus(reseal([first, turns[1], second]))).toThrow("order");
  expect(() => validateMem0SelectedCorpus(reseal([first, { ...second, date: "2024-02-01" }]))).toThrow("provenance");
});


test("worker spawn failure closes custody without an unhandled pipe error", async () => {
  let closed = false;
  const dispatcher = { derivation: makeMem0DerivationReceipt(policy, corpus), embeddingDimensions: 1536, maximumCallTimeoutMs: 1000, abort() {},
    async close() { closed = true; } } as ReturnType<typeof createMem0RpcDispatcher>;
  const worker = await startMem0Worker({ command: ["/nonexistent-mem0-fixture-python", "-m", "mem0_bridge_worker"], workerDirectory: "/private/tmp", mem0Directory: "/private/tmp", dispatcher, corpus });
  let rejection: unknown;
  try { await worker.prepare(); } catch (error) { rejection = error; } finally { await worker.close(); }
  expect(rejection).toBeInstanceOf(Error); expect(String(rejection)).not.toContain("deadline"); expect(closed).toBe(true);
}, 10_000);
