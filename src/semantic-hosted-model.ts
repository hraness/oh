import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, safeCode,
  sha256Hex, type Sha256Hex } from "./canonical";
import { parseKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "./graph";
import { recordDocument, type OhSemanticSearchBackendV1 } from "./semantic-model";

/** Separate from the immutable local QMD profile. The provider model is an alias. */
export const OH_HOSTED_EMBEDDING_PROFILE_V2 = Object.freeze({
  chunkBytes: 4096, chunking: "contiguous-utf8-scalars-no-overlap-v1", dimensions: 1536,
  distance: "cosine", documentFormat: "oh-record-document-v1", encoding: "float",
  engine: "oh.precomputed-hosted.v1", gateway: "vercel-ai-gateway", model: "openai/text-embedding-3-small",
  modelIdentity: "alias", normalization: "l2", provider: "openai", queryFormat: "raw-utf8-v1",
  queryMaxBytes: 8192, recordAggregation: "maximum-chunk-cosine-v1", v: 2,
} as const);
export const OH_HOSTED_PROFILE_SHA256_V2 = canonicalSha256(OH_HOSTED_EMBEDDING_PROFILE_V2);
export const OH_HOSTED_LIMITS_V1 = Object.freeze({ records: 4096, embeddings: 4096, queries: 1024,
  sourceBytes: 32 * 1024 * 1024, snapshotBytes: 128 * 1024 * 1024, batchInputs: 128,
  batchBytes: 128 * 1024, inputBytes: 16 * 1024 * 1024 });
export type OhHostedEmbeddingProfileV2 = typeof OH_HOSTED_EMBEDDING_PROFILE_V2;
export interface OhSemanticSearchBackendV2 extends Omit<OhSemanticSearchBackendV1, "profile"> {
  readonly profile: OhHostedEmbeddingProfileV2;
}
export type OhSemanticSearchBackend = OhSemanticSearchBackendV1 | OhSemanticSearchBackendV2;
export type OhHostedEmbeddingRoleV1 = "document" | "query";
export type OhHostedSettlementV1 = Readonly<{
  authoritySha256: Sha256Hex; settlementSha256: Sha256Hex; requestSha256: Sha256Hex; responseSha256: Sha256Hex;
  profileSha256: Sha256Hex; role: OhHostedEmbeddingRoleV1; inputSha256s: readonly Sha256Hex[];
  knownCostMicros: number; reservationMicros: number; latencyMs: number; physicalCalls: 1;
}>;
export type OhHostedEmbeddingV1 = Readonly<{ role: OhHostedEmbeddingRoleV1; inputSha256: Sha256Hex;
  vector: readonly number[]; receiptIndex: number; inputIndex: number }>;
export type OhHostedRecordV1 = Readonly<{ key: string; recordSha256: Sha256Hex; documentSha256: Sha256Hex;
  chunks: readonly Readonly<{ start: number; end: number; inputSha256: Sha256Hex; embeddingIndex: number }>[] }>;
export type OhHostedSnapshotV1 = Readonly<{
  protocol: "oh.semantic-hosted-snapshot.v1"; profileSha256: Sha256Hex; sourceSha256: Sha256Hex;
  records: readonly OhHostedRecordV1[]; queries: readonly Readonly<{ querySha256: Sha256Hex; embeddingIndex: number }>[];
  embeddings: readonly OhHostedEmbeddingV1[]; receipts: readonly OhHostedSettlementV1[];
}>;
export function hostedInteger(value: unknown, maximum: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)
    || value < minimum || value > maximum) throw new TypeError("Invalid hosted integer.");
  return value;
}
/** Bound untrusted JSON before parsing/copying vectors or canonical hashing. */
function boundHostedWire(value: unknown, maximumBytes: number): void {
  let bytes = 0, nodes = 0;
  const ancestors = new Set<object>();
  const add = (amount: number) => { bytes += amount; if (bytes > maximumBytes) throw new RangeError("Hosted wire byte limit exceeded."); };
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 8_000_000 || depth > 32) throw new RangeError("Hosted wire structure limit exceeded.");
    if (typeof v === "string") {
      if (Buffer.byteLength(v) > maximumBytes || /\p{Surrogate}/u.test(v)) throw new TypeError("Invalid hosted string.");
      add(Buffer.byteLength(JSON.stringify(v))); return;
    }
    if (v === null || typeof v === "boolean") { add(v === null ? 4 : v ? 4 : 5); return; }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Object.is(v, -0)) throw new TypeError("Invalid hosted number.");
      add(String(v).length); return;
    }
    if (typeof v !== "object" || ancestors.has(v)) throw new TypeError("Hosted wire must be acyclic JSON.");
    ancestors.add(v);
    try {
      if (Array.isArray(v)) {
        if (v.length > 8_000_000 || Reflect.ownKeys(v).length !== v.length + 1) throw new TypeError("Invalid hosted dense array.");
        add(2 + Math.max(0, v.length - 1));
        for (let i = 0; i < v.length; i++) {
          const d = Object.getOwnPropertyDescriptor(v, String(i));
          if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new TypeError("Hosted arrays require data elements.");
          visit(d.value, depth + 1);
        }
      } else {
        if (!isPlainRecord(v)) throw new TypeError("Invalid hosted plain object.");
        const keys = Reflect.ownKeys(v); add(2 + Math.max(0, keys.length - 1));
        for (const key of keys) {
          const d = Object.getOwnPropertyDescriptor(v, key)!;
          if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value")) throw new TypeError("Hosted objects require data properties.");
          visit(key, depth + 1); add(1); visit(d.value, depth + 1);
        }
      }
    } finally { ancestors.delete(v); }
  };
  visit(value, 0);
}
function freezeHosted<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeHosted(child);
    Object.freeze(value);
  }
  return value;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) throw new TypeError("Invalid hosted object.");
  if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) throw new TypeError("Invalid hosted data properties.");
  return value;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new TypeError("Invalid hosted array.");
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError("Invalid hosted array properties.");
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new TypeError("Invalid hosted dense array."); }
  return value;
}
function digest(value: unknown): Sha256Hex {
  const result = parseSha256Hex(value);
  if (result === null) throw new TypeError("Invalid hosted digest.");
  return result;
}
function role(value: unknown): OhHostedEmbeddingRoleV1 {
  if (value !== "document" && value !== "query") throw new TypeError("Invalid hosted role.");
  return value;
}
function finiteVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 1536) throw new TypeError("Hosted vectors require 1536 components.");
  return array(value, 1536).map(component => {
    if (typeof component !== "number" || !Number.isFinite(component) || Object.is(component, -0)) {
      throw new TypeError("Invalid hosted vector component.");
    }
    return component;
  });
}
export function normalizeOhHostedEmbeddingV2(value: unknown): readonly number[] {
  const vector = finiteVector(value);
  const scale = vector.reduce((max, n) => Math.max(max, Math.abs(n)), 0);
  if (scale === 0) throw new TypeError("Hosted vector has zero magnitude.");
  const length = Math.sqrt(vector.reduce((sum, n) => sum + (n / scale) ** 2, 0));
  return Object.freeze(vector.map(n => ((n / scale) / length) || 0));
}
export function hostedQueryV1(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > OH_HOSTED_EMBEDDING_PROFILE_V2.queryMaxBytes
    || /\p{Surrogate}/u.test(value)) throw new TypeError("Invalid hosted query.");
  return value;
}
export function hostedDocumentChunksV1(record: KnowledgeGraphRecordV1): readonly Readonly<{
  start: number; end: number; input: string; inputSha256: Sha256Hex;
}>[] {
  boundHostedWire(record, OH_HOSTED_LIMITS_V1.sourceBytes);
  const parsed = parseKnowledgeGraphRecordV1(record);
  if (parsed === null) throw new TypeError("Invalid hosted source record.");
  const document = recordDocument(parsed);
  const chunks: { start: number; end: number; input: string; inputSha256: Sha256Hex }[] = [];
  let start = 0, bytes = 0, input = "";
  const flush = () => {
    if (bytes === 0) return;
    chunks.push({ start, end: start + bytes, input, inputSha256: sha256Hex(input) });
    start += bytes; bytes = 0; input = "";
  };
  for (const scalar of document) {
    const size = new TextEncoder().encode(scalar).length;
    if (bytes + size > 4096) flush();
    input += scalar; bytes += size;
  }
  flush();
  return freezeHosted(chunks);
}
export function hostedRecordsV1(value: unknown): readonly KnowledgeGraphRecordV1[] {
  boundHostedWire(value, OH_HOSTED_LIMITS_V1.sourceBytes);
  let bytes = 0;
  const records = array(value, OH_HOSTED_LIMITS_V1.records).map(raw => {
    const record = parseKnowledgeGraphRecordV1(raw);
    if (record === null) throw new TypeError("Invalid hosted source record.");
    bytes += new TextEncoder().encode(recordDocument(record)).length;
    if (bytes > OH_HOSTED_LIMITS_V1.sourceBytes) throw new RangeError("Hosted source byte limit exceeded.");
    return record;
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (new Set(records.map(record => record.key)).size !== records.length) throw new TypeError("Duplicate hosted source key.");
  return freezeHosted(structuredClone(records));
}
export function hostedSourceSha256V1(records: readonly Readonly<{ key: string; recordSha256: Sha256Hex }>[]): Sha256Hex {
  return canonicalSha256({ protocol: "oh.semantic-hosted-source.v1", records: records.map(({ key, recordSha256 }) => ({ key, recordSha256 })) });
}
export function parseOhHostedSettlementV1(value: unknown): OhHostedSettlementV1 {
  boundHostedWire(value, 32768);
  const v = object(value, ["authoritySha256", "settlementSha256", "requestSha256", "responseSha256", "profileSha256",
    "role", "inputSha256s", "knownCostMicros", "reservationMicros", "latencyMs", "physicalCalls"]);
  if (v.profileSha256 !== OH_HOSTED_PROFILE_SHA256_V2 || v.physicalCalls !== 1) throw new TypeError("Wrong hosted settlement profile/calls.");
  const reservationMicros = hostedInteger(v.reservationMicros, Number.MAX_SAFE_INTEGER);
  const knownCostMicros = hostedInteger(v.knownCostMicros, reservationMicros);
  if (typeof v.latencyMs !== "number" || !Number.isFinite(v.latencyMs) || v.latencyMs < 0
    || v.latencyMs > 300_000 || Object.is(v.latencyMs, -0)) throw new TypeError("Invalid hosted latency.");
  return Object.freeze({ authoritySha256: digest(v.authoritySha256), settlementSha256: digest(v.settlementSha256),
    requestSha256: digest(v.requestSha256), responseSha256: digest(v.responseSha256), profileSha256: OH_HOSTED_PROFILE_SHA256_V2,
    role: role(v.role), inputSha256s: Object.freeze(array(v.inputSha256s, 128).map(digest)), knownCostMicros,
    reservationMicros, latencyMs: v.latencyMs, physicalCalls: 1 });
}
/** Validates structure/bindings; the caller authenticates settlement and raw-capture pins against its ledger. */
export function parseOhHostedSnapshotV1(value: unknown): OhHostedSnapshotV1 {
  boundHostedWire(value, OH_HOSTED_LIMITS_V1.snapshotBytes);
  const v = object(value, ["protocol", "profileSha256", "sourceSha256", "records", "queries", "embeddings", "receipts"]);
  if (v.protocol !== "oh.semantic-hosted-snapshot.v1" || v.profileSha256 !== OH_HOSTED_PROFILE_SHA256_V2) {
    throw new TypeError("Wrong hosted snapshot protocol/profile.");
  }
  const receipts = array(v.receipts, 4096).map(parseOhHostedSettlementV1);
  if (new Set(receipts.map(r => r.requestSha256)).size !== receipts.length
    || new Set(receipts.map(r => r.settlementSha256)).size !== receipts.length) throw new TypeError("Duplicate hosted receipt.");
  const usedReceiptInputs = new Set<string>();
  const embeddings = array(v.embeddings, 4096).map(raw => {
    const e = object(raw, ["role", "inputSha256", "vector", "receiptIndex", "inputIndex"]);
    const receiptIndex = hostedInteger(e.receiptIndex, receipts.length - 1);
    const receipt = receipts[receiptIndex]!;
    const inputIndex = hostedInteger(e.inputIndex, receipt.inputSha256s.length - 1);
    const inputSha256 = digest(e.inputSha256), embeddingRole = role(e.role);
    const key = `${receiptIndex}:${inputIndex}`;
    if (usedReceiptInputs.has(key) || receipt.inputSha256s[inputIndex] !== inputSha256 || receipt.role !== embeddingRole) {
      throw new TypeError("Hosted receipt/input binding mismatch.");
    }
    usedReceiptInputs.add(key);
    const vector = finiteVector(e.vector);
    const norm = vector.reduce((sum, n) => sum + n * n, 0);
    if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-6) throw new TypeError("Hosted snapshot vector is not L2 normalized.");
    return Object.freeze({ role: embeddingRole, inputSha256, vector: Object.freeze(vector), receiptIndex, inputIndex });
  });
  if (usedReceiptInputs.size !== receipts.reduce((sum, r) => sum + r.inputSha256s.length, 0)) {
    throw new TypeError("Hosted receipt input coverage is incomplete.");
  }
  const used = new Set<number>();
  const claim = (index: unknown, expectedRole: OhHostedEmbeddingRoleV1, sha: Sha256Hex) => {
    const n = hostedInteger(index, embeddings.length - 1), embedding = embeddings[n]!;
    if (used.has(n) || embedding.role !== expectedRole || embedding.inputSha256 !== sha) throw new TypeError("Hosted source/vector binding mismatch.");
    used.add(n); return n;
  };
  let previousKey = "", inputBytes = 0;
  const records = array(v.records, 4096).map(raw => {
    const r = object(raw, ["key", "recordSha256", "documentSha256", "chunks"]);
    const key = safeCode(r.key, 512);
    if (key === null || key <= previousKey) throw new TypeError("Hosted records must have unique sorted keys.");
    previousKey = key;
    let next = 0;
    const chunks = array(r.chunks, 4096).map(rawChunk => {
      const c = object(rawChunk, ["start", "end", "inputSha256", "embeddingIndex"]);
      const start = hostedInteger(c.start, OH_HOSTED_LIMITS_V1.sourceBytes), end = hostedInteger(c.end, OH_HOSTED_LIMITS_V1.sourceBytes, start + 1);
      if (start !== next || end - start > 4096) throw new TypeError("Hosted chunk coverage is not contiguous.");
      next = end; inputBytes += end - start;
      if (inputBytes > OH_HOSTED_LIMITS_V1.inputBytes) throw new RangeError("Hosted input limit exceeded.");
      const inputSha256 = digest(c.inputSha256);
      return Object.freeze({ start, end, inputSha256, embeddingIndex: claim(c.embeddingIndex, "document", inputSha256) });
    });
    return Object.freeze({ key, recordSha256: digest(r.recordSha256), documentSha256: digest(r.documentSha256), chunks: Object.freeze(chunks) });
  });
  let previousQuery = "";
  const queries = array(v.queries, 1024).map(raw => {
    const q = object(raw, ["querySha256", "embeddingIndex"]), querySha256 = digest(q.querySha256);
    if (querySha256 <= previousQuery) throw new TypeError("Hosted queries must have unique sorted hashes.");
    previousQuery = querySha256;
    return Object.freeze({ querySha256, embeddingIndex: claim(q.embeddingIndex, "query", querySha256) });
  });
  if (used.size !== embeddings.length || hostedSourceSha256V1(records) !== v.sourceSha256) throw new TypeError("Hosted snapshot source coverage mismatch.");
  return Object.freeze({ protocol: "oh.semantic-hosted-snapshot.v1", profileSha256: OH_HOSTED_PROFILE_SHA256_V2,
    sourceSha256: digest(v.sourceSha256), records: Object.freeze(records), queries: Object.freeze(queries),
    embeddings: Object.freeze(embeddings), receipts: Object.freeze(receipts) });
}
