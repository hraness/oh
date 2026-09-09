/** Pure packing of the existing Mem0 worker projection. No dataset, filesystem,
 * provider, ledger, or scorer operation is performed by these functions. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { makeMem0DerivationReceipt, validateMem0SelectedCorpus } from "./mem0-parent";

export const MEM0_READER_CONTEXT_POLICY = Object.freeze({
  protocol: "oh.memory.mem0-reader-context-policy.v1" as const,
  workerProjection: "memory-and-metadata-v1" as const,
  topK: 50 as const, threshold: 0.1 as const, rerank: false as const,
  packing: "sdk-order-whole-memory-prefix" as const,
  maximumResultBytes: 1_048_576, maximumMemoryBytes: 262_144,
  sdkIdsAvailable: false as const, sdkScoresAvailable: false as const,
  contentKind: "model-derived-memory" as const,
});
type Metadata = Readonly<{ chunkId: string; sourceDigest: string }>;
export type Mem0WorkerSearchResult = Readonly<{ results: readonly Readonly<{ memory: string; metadata: Metadata }>[] }>;
export type Mem0ReaderSearchBinding = Readonly<{
  protocol: "oh.memory.mem0-reader-search-binding.v1";
  sourceArtifactSha256: string; sourceReceiptSha256: string; corpusSha256: string;
  derivationReceiptSha256: string; policySha256: string; namespace: string;
  querySha256: string; workerSha256: string; runtimeSha256: string;
  executionSourceSha256: string; searchReceiptSha256: string; searchResultSha256: string;
  topK: 50; threshold: 0.1; rerank: false;
}>;
export type Mem0ReaderArtifactPins = Pick<Mem0ReaderSearchBinding, "sourceArtifactSha256" | "querySha256" |
  "workerSha256" | "runtimeSha256" | "executionSourceSha256" | "searchReceiptSha256">;
export type Mem0DerivedContextRow = Readonly<{
  rank: number; derivedRowId: string; rowSha256: string; memorySha256: string;
  memoryBytes: number; chunkId: string; sourceDigest: string;
}>;
export type Mem0ReaderContext = Readonly<{
  protocol: "oh.memory.mem0-reader-context.v1";
  contentKind: "model-derived-memory";
  adapterPolicySha256: string; bindingSha256: string; binding: Mem0ReaderSearchBinding;
  budgetBytes: 48_000 | 96_000; context: string; contextBytes: number; contextSha256: string;
  retrievedCount: number; includedCount: number; omittedCount: number;
  duplicateProjectionRows: number;
  included: readonly Mem0DerivedContextRow[];
  omitted: readonly Readonly<Mem0DerivedContextRow & { reason: "rank-prefix-budget" }>[];
  resultSha256: string;
}>;
function fail(reason: string): never { throw new TypeError(`Mem0 reader context: ${reason}.`); }
function exact(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) fail(`${name} exact shape`);
  return value;
}
function sha(value: unknown): string {
  if (typeof value !== "string" || parseSha256Hex(value) === null) fail("canonical digest");
  return value;
}
function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maximum
    || /\p{Surrogate}/u.test(value)) fail("bounded UTF-8 memory");
  return value;
}
const BINDING_DIGESTS = ["sourceArtifactSha256", "sourceReceiptSha256", "corpusSha256", "derivationReceiptSha256",
  "policySha256", "namespace", "querySha256", "workerSha256", "runtimeSha256", "executionSourceSha256",
  "searchReceiptSha256", "searchResultSha256"] as const;
/** Pins are supplied by the caller that authenticated the actual worker,
 * runtime, source and completed search artifacts. Hashes do not establish that
 * custody by themselves, and missing SDK IDs/scores cannot be reconstructed. */
export function validateMem0ReaderSearchBinding(value: unknown): Mem0ReaderSearchBinding {
  const v = exact(value, ["protocol", ...BINDING_DIGESTS, "topK", "threshold", "rerank"], "binding");
  if (v.protocol !== "oh.memory.mem0-reader-search-binding.v1" || v.topK !== 50
    || v.threshold !== 0.1 || v.rerank !== false) fail("fixed SDK search policy");
  const hashes = Object.fromEntries(BINDING_DIGESTS.map(key => [key, sha(v[key])])) as Record<typeof BINDING_DIGESTS[number], string>;
  return Object.freeze({ protocol: v.protocol, ...hashes, topK: 50, threshold: 0.1, rerank: false });
}
/** Validate every returned row, including rows that will not fit the context.
 * Metadata membership is provenance attribution, not a claim that a generated
 * memory is entailed by that chunk or has complete evidence provenance. */
export function validateMem0WorkerSearchResult(value: unknown, corpusInput: unknown): Mem0WorkerSearchResult {
  const corpus = validateMem0SelectedCorpus(corpusInput), v = exact(value, ["results"], "worker search result");
  if (!Array.isArray(v.results) || v.results.length > MEM0_READER_CONTEXT_POLICY.topK) fail("SDK topK bound");
  const chunks = new Map(corpus.chunks.map(chunk => [chunk.chunkId, chunk.sourceSha256]));
  const results = v.results.map((value: unknown) => {
    const row = exact(value, ["memory", "metadata"], "worker result row");
    const memory = boundedText(row.memory, MEM0_READER_CONTEXT_POLICY.maximumMemoryBytes);
    const metadata = exact(row.metadata, ["chunkId", "sourceDigest"], "worker metadata");
    if (typeof metadata.chunkId !== "string" || !chunks.has(metadata.chunkId)
      || chunks.get(metadata.chunkId) !== sha(metadata.sourceDigest)) fail("foreign source chunk or digest");
    return Object.freeze({ memory, metadata: Object.freeze({ chunkId: metadata.chunkId, sourceDigest: metadata.sourceDigest as string }) });
  });
  const result = Object.freeze({ results: Object.freeze(results) });
  if (Buffer.byteLength(JSON.stringify(result)) > MEM0_READER_CONTEXT_POLICY.maximumResultBytes) fail("worker result byte bound");
  return result;
}
/** Construct a binding after the I/O owner has authenticated all six artifact
 * pins. This is an additive receipt and does not reinterpret an old SDK result. */
export function makeMem0ReaderSearchBinding(input: Readonly<{
  corpus: unknown; policy: unknown; result: unknown; pins: Mem0ReaderArtifactPins;
}>): Mem0ReaderSearchBinding {
  const pins = exact(input.pins, ["sourceArtifactSha256", "querySha256", "workerSha256", "runtimeSha256",
    "executionSourceSha256", "searchReceiptSha256"], "artifact pins");
  const corpus = validateMem0SelectedCorpus(input.corpus), derivation = makeMem0DerivationReceipt(input.policy, corpus);
  const result = validateMem0WorkerSearchResult(input.result, corpus);
  return validateMem0ReaderSearchBinding({ protocol: "oh.memory.mem0-reader-search-binding.v1", ...pins,
    sourceReceiptSha256: corpus.sourceReceiptSha256, corpusSha256: corpus.corpusSha256,
    derivationReceiptSha256: derivation.receiptSha256, policySha256: derivation.policySha256,
    namespace: derivation.namespace, searchResultSha256: canonicalSha256(result), topK: 50, threshold: 0.1, rerank: false });
}
/** Whole-record prefix packing retains the exact SDK order, including repeated
 * projections. A derived row identity includes rank and is not an SDK memory ID.
 * The caller must match binding.querySha256 to the exact reader question. */
export function packMem0ReaderContext(input: Readonly<{
  corpus: unknown; policy: unknown; result: unknown; binding: unknown;
  expectedBindingSha256: string; contextBytes: 48_000 | 96_000;
}>): Mem0ReaderContext {
  if (input.contextBytes !== 48_000 && input.contextBytes !== 96_000) fail("explicit 48KB or 96KB budget");
  const binding = validateMem0ReaderSearchBinding(input.binding), bindingSha256 = canonicalSha256(binding);
  if (bindingSha256 !== sha(input.expectedBindingSha256)) fail("binding pin mismatch");
  const corpus = validateMem0SelectedCorpus(input.corpus), derivation = makeMem0DerivationReceipt(input.policy, corpus);
  if (binding.corpusSha256 !== corpus.corpusSha256 || binding.sourceReceiptSha256 !== corpus.sourceReceiptSha256
    || binding.derivationReceiptSha256 !== derivation.receiptSha256 || binding.policySha256 !== derivation.policySha256
    || binding.namespace !== derivation.namespace) fail("source or derivation binding mismatch");
  const result = validateMem0WorkerSearchResult(input.result, corpus);
  if (canonicalSha256(result) !== binding.searchResultSha256) fail("search result pin mismatch");
  const included: Mem0DerivedContextRow[] = [], omitted: (Mem0DerivedContextRow & { reason: "rank-prefix-budget" })[] = [];
  const chunks: string[] = [], seen = new Set<string>();
  const header = "Model-derived memories retrieved by Mem0:\n\n";
  let contextBytes = 0, stopped = false, duplicateProjectionRows = 0;
  for (const [index, row] of result.results.entries()) {
    const rowSha256 = canonicalSha256(row); if (seen.has(rowSha256)) duplicateProjectionRows++; seen.add(rowSha256);
    const rank = index + 1, derivedRowId = `mem0-derived-${canonicalSha256({ namespace: binding.namespace, rank, rowSha256 })}`;
    const metadata = Object.freeze({ rank, derivedRowId, rowSha256,
      memorySha256: sha256Hex(row.memory), memoryBytes: Buffer.byteLength(row.memory), ...row.metadata });
    const text = `${chunks.length === 0 ? header : "\n\n"}[${derivedRowId}] ${row.memory}`;
    const bytes = Buffer.byteLength(text);
    if (stopped || contextBytes + bytes > input.contextBytes) {
      stopped = true; omitted.push(Object.freeze({ ...metadata, reason: "rank-prefix-budget" }));
    } else { chunks.push(text); contextBytes += bytes; included.push(metadata); }
  }
  const context = chunks.join("");
  const payload = { protocol: "oh.memory.mem0-reader-context.v1" as const,
    contentKind: "model-derived-memory" as const, adapterPolicySha256: canonicalSha256(MEM0_READER_CONTEXT_POLICY),
    bindingSha256, binding, budgetBytes: input.contextBytes, context, contextBytes, contextSha256: sha256Hex(context),
    retrievedCount: result.results.length, includedCount: included.length, omittedCount: omitted.length,
    duplicateProjectionRows, included: Object.freeze(included), omitted: Object.freeze(omitted) };
  return Object.freeze({ ...payload, resultSha256: canonicalSha256(payload) });
}
