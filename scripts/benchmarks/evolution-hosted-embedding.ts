/** Optional hosted-vector study boundary. The caller owns the metered provider,
 * durable reservation/capture/settlement and raw-evidence authentication. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex,
  sha256Hex, type Sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../../src/graph";
import { Oh } from "../../src/sdk";
import { recordDocument } from "../../src/semantic-model";
import { OhHostedSemanticBackendV2 } from "../../src/semantic-hosted";
import { hostedDocumentChunksV1, hostedInteger, hostedQueryV1, hostedRecordsV1, hostedSourceSha256V1,
  normalizeOhHostedEmbeddingV2, OH_HOSTED_EMBEDDING_PROFILE_V2, OH_HOSTED_LIMITS_V1,
  OH_HOSTED_PROFILE_SHA256_V2, parseOhHostedSettlementV1, parseOhHostedSnapshotV1,
  type OhHostedEmbeddingRoleV1, type OhHostedSnapshotV1, type OhHostedSettlementV1 } from "../../src/semantic-hosted-model";
import type { Corpus, Turn } from "./datasets";
import { pack } from "./retrieval";

export type HostedEmbeddingBatchV1 = Readonly<{
  protocol: "oh.evolution-hosted-embedding-batch.v1"; authoritySha256: Sha256Hex;
  profileSha256: Sha256Hex; profile: typeof OH_HOSTED_EMBEDDING_PROFILE_V2;
  role: OhHostedEmbeddingRoleV1; inputs: readonly string[]; inputSha256s: readonly Sha256Hex[];
  batchIndex: number; inputBytes: number; batchSha256: Sha256Hex;
}>;
/** Exactly one physical request per invocation. The function must durably reserve
 * before dispatch, keep failures occupied, bound/drain its transport, authenticate
 * every raw vector/route/usage, and return only a settled receipt. No retries. */
export type MeteredHostedEmbedV1 = (batch: HostedEmbeddingBatchV1, signal?: AbortSignal) => Promise<unknown>;
type PlannedInput = Readonly<{ role: OhHostedEmbeddingRoleV1; input: string; inputSha256: Sha256Hex }>;
export type HostedEmbeddingPlanV1 = Readonly<{
  protocol: "oh.evolution-hosted-embedding-plan.v1"; sourceSha256: Sha256Hex; authoritySha256: Sha256Hex;
  profileSha256: Sha256Hex; records: OhHostedSnapshotV1["records"]; queries: OhHostedSnapshotV1["queries"];
  inputs: readonly PlannedInput[]; batches: readonly HostedEmbeddingBatchV1[]; inputBytes: number; planSha256: Sha256Hex;
}>;
function digest(value: unknown): Sha256Hex {
  const checked = parseSha256Hex(value); if (checked === null) throw new TypeError("Invalid hosted study digest."); return checked;
}
/** Source-only, deterministic complete workload preflight. No provider or database. */
export function planHostedEmbeddingsV1(input: Readonly<{ records: unknown; queries: unknown; authoritySha256: unknown }>): HostedEmbeddingPlanV1 {
  const records = hostedRecordsV1(input.records), authoritySha256 = digest(input.authoritySha256);
  if (!Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > OH_HOSTED_LIMITS_V1.queries) {
    throw new TypeError("Invalid hosted query batch.");
  }
  const queryMap = new Map(Array.from({ length: input.queries.length }, (_, index) => { const query = hostedQueryV1(data(input.queries as object, String(index))); return [sha256Hex(query), query] as const; }));
  const inputs: PlannedInput[] = [];
  let inputBytes = 0;
  const add = (role: OhHostedEmbeddingRoleV1, text: string) => {
    inputBytes += Buffer.byteLength(text);
    if (inputBytes > OH_HOSTED_LIMITS_V1.inputBytes || inputs.length >= OH_HOSTED_LIMITS_V1.embeddings) {
      throw new RangeError("Hosted embedding workload exceeds its complete-input bound.");
    }
    const index = inputs.length; inputs.push(Object.freeze({ role, input: text, inputSha256: sha256Hex(text) })); return index;
  };
  const recordManifest = records.map(record => Object.freeze({ key: record.key, recordSha256: record.recordSha256,
    documentSha256: sha256Hex(recordDocument(record)), chunks: Object.freeze(hostedDocumentChunksV1(record).map(chunk => Object.freeze({
      start: chunk.start, end: chunk.end, inputSha256: chunk.inputSha256, embeddingIndex: add("document", chunk.input),
    }))) }));
  const queries = [...queryMap.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([querySha256, query]) => Object.freeze({ querySha256, embeddingIndex: add("query", query) }));
  const batches: HostedEmbeddingBatchV1[] = [];
  for (let start = 0; start < inputs.length;) {
    const role = inputs[start]!.role, batchInputs: string[] = [], hashes: Sha256Hex[] = [];
    let bytes = 0;
    while (start < inputs.length && batchInputs.length < OH_HOSTED_LIMITS_V1.batchInputs) {
      const item = inputs[start]!, size = Buffer.byteLength(item.input);
      if (item.role !== role || bytes + size > OH_HOSTED_LIMITS_V1.batchBytes) break;
      batchInputs.push(item.input); hashes.push(item.inputSha256); bytes += size; start++;
    }
    const payload = { protocol: "oh.evolution-hosted-embedding-batch.v1" as const, authoritySha256,
      profileSha256: OH_HOSTED_PROFILE_SHA256_V2, profile: OH_HOSTED_EMBEDDING_PROFILE_V2, role,
      inputs: Object.freeze(batchInputs), inputSha256s: Object.freeze(hashes), batchIndex: batches.length, inputBytes: bytes };
    batches.push(Object.freeze({ ...payload, batchSha256: canonicalSha256(payload) }));
  }
  const payload = { protocol: "oh.evolution-hosted-embedding-plan.v1" as const, sourceSha256: hostedSourceSha256V1(records),
    authoritySha256, profileSha256: OH_HOSTED_PROFILE_SHA256_V2, records: Object.freeze(recordManifest), queries: Object.freeze(queries),
    inputs: Object.freeze(inputs), batches: Object.freeze(batches), inputBytes };
  return Object.freeze({ ...payload, planSha256: canonicalSha256(payload) });
}
export class HostedEmbeddingPreparationError extends Error {
  readonly complete = false;
  constructor(readonly planSha256: Sha256Hex, readonly plannedBatches: number, readonly attemptedBatches: number,
    readonly settledReceipts: readonly OhHostedSettlementV1[], readonly failedBatchSha256: Sha256Hex | null, cause: unknown) {
    super("Hosted embedding preparation stopped; failed requests remain the caller ledger's responsibility.", { cause });
    this.name = "HostedEmbeddingPreparationError";
  }
}
/** No default provider exists. Source preflight finishes before the first injected
 * invocation. Concurrent failures stop new admission and drain all invoked work. */
export async function prepareHostedEmbeddingsV1(input: Readonly<{ records: unknown; queries: unknown; authoritySha256: unknown;
  embed: MeteredHostedEmbedV1; concurrency?: number; signal?: AbortSignal }>): Promise<Readonly<{
    plan: HostedEmbeddingPlanV1; snapshot: OhHostedSnapshotV1; snapshotSha256: Sha256Hex;
    attributed: Readonly<{ physicalCalls: number; knownCostMicros: number; serviceMs: number }>;
  }>> {
  if (typeof input.embed !== "function") throw new TypeError("An explicitly metered hosted embedding function is required.");
  const embed = input.embed, signal = input.signal;
  const concurrency = hostedInteger(input.concurrency ?? 1, 4, 1), plan = planHostedEmbeddingsV1(input);
  const completed = new Map<number, { receipt: OhHostedSettlementV1; vectors: readonly (readonly number[])[] }>();
  let next = 0, attempts = 0, failure: { batch: Sha256Hex | null; cause: unknown } | null = null;
  const worker = async () => {
    while (failure === null && next < plan.batches.length) {
      if (signal?.aborted) { failure = { batch: null, cause: signal.reason }; break; }
      const batch = plan.batches[next++]!; attempts++;
      try {
        const raw = await embed(batch, signal);
        if (!isPlainRecord(raw) || !hasExactKeys(raw, ["receipt", "vectors"])) throw new TypeError("Invalid hosted response wrapper.");
        const vectorsInput = data(raw, "vectors");
        if (!Array.isArray(vectorsInput) || vectorsInput.length !== batch.inputs.length
          || Object.keys(vectorsInput).length !== vectorsInput.length) throw new TypeError("Incomplete hosted embedding response.");
        const receipt = parseOhHostedSettlementV1(data(raw, "receipt"));
        if (receipt.authoritySha256 !== plan.authoritySha256 || receipt.role !== batch.role
          || canonicalSha256(receipt.inputSha256s) !== canonicalSha256(batch.inputSha256s)) {
          throw new TypeError("Hosted metered receipt does not bind this exact batch.");
        }
        const vectors = Array.from({ length: vectorsInput.length }, (_, index) => normalizeOhHostedEmbeddingV2(data(vectorsInput, String(index))));
        completed.set(batch.batchIndex, { receipt, vectors });
      } catch (cause) { failure ??= { batch: batch.batchSha256, cause }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.batches.length) }, worker));
  const ordered = [...completed.entries()].sort(([a], [b]) => a - b).map(([, result]) => result);
  if (failure !== null || completed.size !== plan.batches.length || signal?.aborted) {
    const stopped = failure as { batch: Sha256Hex | null; cause: unknown } | null;
    throw new HostedEmbeddingPreparationError(plan.planSha256, plan.batches.length, attempts,
      Object.freeze(ordered.map(r => r.receipt)), stopped?.batch ?? null, stopped?.cause ?? signal?.reason);
  }
  const embeddings: OhHostedSnapshotV1["embeddings"][number][] = [];
  ordered.forEach(({ vectors, receipt }, receiptIndex) => vectors.forEach((vector, inputIndex) => embeddings.push({
    role: receipt.role, inputSha256: receipt.inputSha256s[inputIndex]!, vector, receiptIndex, inputIndex,
  })));
  try {
    const snapshot = parseOhHostedSnapshotV1({ protocol: "oh.semantic-hosted-snapshot.v1", profileSha256: plan.profileSha256,
      sourceSha256: plan.sourceSha256, records: plan.records, queries: plan.queries, embeddings, receipts: ordered.map(r => r.receipt) });
    const knownCostMicros = snapshot.receipts.reduce((sum, r) => hostedInteger(sum + r.knownCostMicros, Number.MAX_SAFE_INTEGER), 0);
    return Object.freeze({ plan, snapshot, snapshotSha256: canonicalSha256(snapshot), attributed: Object.freeze({
      physicalCalls: snapshot.receipts.length, knownCostMicros, serviceMs: snapshot.receipts.reduce((sum, r) => sum + r.latencyMs, 0),
    }) });
  } catch (cause) {
    throw new HostedEmbeddingPreparationError(plan.planSha256, plan.batches.length, attempts,
      Object.freeze(ordered.map(r => r.receipt)), null, cause);
  }
}

function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || !empty && value.length === 0 || value.length > max
    || Buffer.byteLength(value) > max || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value)) !== value) {
    throw new TypeError("Invalid hosted source text.");
  }
  return value;
}
function data(value: object, key: string, optional = false): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined && optional) return undefined;
  if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Hosted data property required.");
  return descriptor.value;
}
/** Whitelist source fields before reading, hashing or spreading anything. Gold and
 * annotation getters on the caller's corpus or turns are never consulted. */
export function hostedCorpusV1(value: unknown): Corpus {
  if (!isPlainRecord(value)) throw new TypeError("Invalid hosted source corpus.");
  const rawTurns = data(value, "turns");
  if (!Array.isArray(rawTurns) || rawTurns.length < 1 || rawTurns.length > OH_HOSTED_LIMITS_V1.records) {
    throw new TypeError("Invalid hosted source corpus.");
  }
  const id = text(data(value, "id"), 512), groupId = text(data(value, "groupId"), 512); let bytes = 0;
  const turns = Array.from({ length: rawTurns.length }, (_, position): Turn => {
    const raw = data(rawTurns, String(position));
    if (!isPlainRecord(raw)) throw new TypeError("Invalid hosted source turn.");
    const index = data(raw, "sessionIndex", true);
    const turn = Object.freeze({ id: text(data(raw, "id"), 512), sessionId: text(data(raw, "sessionId"), 512),
      ...(index === undefined ? {} : { sessionIndex: hostedInteger(index, Number.MAX_SAFE_INTEGER) }),
      date: text(data(raw, "date"), 256, true), speaker: text(data(raw, "speaker"), 512), text: text(data(raw, "text"), 524288, true) });
    bytes += Buffer.byteLength(canonicalJson(turn)); if (bytes > OH_HOSTED_LIMITS_V1.sourceBytes) throw new RangeError("Hosted corpus exceeds32MiB.");
    return turn;
  });
  if (new Set(turns.map(t => t.id)).size !== turns.length) throw new TypeError("Duplicate hosted source turn.");
  return Object.freeze({ id, groupId, turns: Object.freeze(turns) });
}
export function hostedCorpusRecordsV1(value: unknown) {
  const corpus = hostedCorpusV1(value);
  return Object.freeze(corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({ dependencies: [],
    key: `edition:turn-${String(index).padStart(5, "0")}`, kind: "edition", v: 1, value: { ...turn } })));
}
export const HOSTED_CONTEXT_BUDGET_V1 = Object.freeze({ topK: 100, contextBytes: 96000 });
export type EvolutionHostedContextV1 = Readonly<{
  protocol: "oh.evolution-hosted-context.v1"; preparedSha256: Sha256Hex; profileSha256: Sha256Hex;
  snapshotSha256: Sha256Hex; querySha256: Sha256Hex; mode: "semantic" | "hybrid"; budget: typeof HOSTED_CONTEXT_BUDGET_V1;
  context: string; contextSha256: Sha256Hex; contextBytes: number; turnIds: readonly string[]; sessionIds: readonly string[];
  sources: readonly Readonly<{ key: string; recordSha256: Sha256Hex; turnId: string; sessionId: string }>[];
  omittedForBudget: number; resultSha256: Sha256Hex;
}>;
/** Actual Oh SDK/SQLite/searchOhV1, with an immutable, fully source-validated hosted
 * backend. This is a distinct context protocol, never a QMD/V7 context identity. */
export async function prepareEvolutionHostedCorpusV1(corpusInput: unknown, snapshotInput: unknown) {
  const corpus = hostedCorpusV1(corpusInput), records = hostedCorpusRecordsV1(corpus), backend = new OhHostedSemanticBackendV2(snapshotInput);
  const oh = Oh.open({ databasePath: ":memory:", spaceId: "evolution-hosted-v1", semanticBackend: backend });
  const positions = new Map(records.map((record, index) => [record.key, index]));
  const payload = { protocol: "oh.evolution-hosted-prepared.v1", corpusSha256: canonicalSha256(corpus),
    sourceSha256: hostedSourceSha256V1(records), profileSha256: OH_HOSTED_PROFILE_SHA256_V2, snapshotSha256: backend.snapshotSha256 } as const;
  const identity = Object.freeze({ ...payload, preparedSha256: canonicalSha256(payload) });
  try {
    for (let offset = 0; offset < records.length;) {
      const batch = []; let bytes = 0;
      while (offset < records.length && batch.length < 512) {
        const record = records[offset]!, size = Buffer.byteLength(canonicalJson(record));
        if (batch.length > 0 && bytes + size > 4 * 1024 * 1024) break;
        batch.push({ kind: "put" as const, record, v: 1 as const }); bytes += size; offset++;
      }
      oh.store.commit({ actorId: "benchmark.hosted", expectedHead: oh.head(), changes: batch,
        instant: "2026-01-01T00:00:00.000Z", operationId: `op_hosted_${offset}` });
    }
    await oh.indexSemantic();
  } catch (error) { await oh.close(); throw error; }
  return Object.freeze({ identity,
    async retrieve(queryInput: unknown, mode: "semantic" | "hybrid"): Promise<EvolutionHostedContextV1> {
      if (mode !== "semantic" && mode !== "hybrid") throw new TypeError("Invalid hosted retrieval mode.");
      const query = hostedQueryV1(queryInput), result = await oh.search(query, { mode, limit: HOSTED_CONTEXT_BUDGET_V1.topK });
      if (result.diagnostics.length) throw new Error("Hosted semantic retrieval unavailable; benchmark fallback is forbidden.");
      const candidates = result.results.map(({ record }) => {
        const index = positions.get(record.key);
        if (index === undefined || records[index]!.recordSha256 !== record.recordSha256) throw new TypeError("Hosted source join mismatch.");
        return { turn: corpus.turns[index]!, digest: record.recordSha256, record };
      });
      const packed = pack(candidates, HOSTED_CONTEXT_BUDGET_V1.contextBytes), selected = new Set(packed.turnIds);
      const sources = candidates.filter(c => selected.has(c.turn.id)).map(c => Object.freeze({ key: c.record.key,
        recordSha256: c.record.recordSha256, turnId: c.turn.id, sessionId: c.turn.sessionId }));
      const payload = { protocol: "oh.evolution-hosted-context.v1" as const, preparedSha256: identity.preparedSha256,
        profileSha256: OH_HOSTED_PROFILE_SHA256_V2, snapshotSha256: backend.snapshotSha256, querySha256: sha256Hex(query),
        mode, budget: HOSTED_CONTEXT_BUDGET_V1, context: packed.context, contextSha256: sha256Hex(packed.context),
        contextBytes: Buffer.byteLength(packed.context), turnIds: Object.freeze(packed.turnIds), sessionIds: Object.freeze(packed.sessionIds),
        sources: Object.freeze(sources), omittedForBudget: packed.omittedForBudget };
      return Object.freeze({ ...payload, resultSha256: canonicalSha256(payload) });
    }, close: () => oh.close(),
  });
}
/** Source authentication replays only deterministic local ranking/context packing;
 * vectors are precomputed, so this performs no embedding calls. */
export async function validateEvolutionHostedContextSourcesV1(input: Readonly<{ corpus: unknown; snapshot: unknown;
  query: unknown; result: unknown }>): Promise<EvolutionHostedContextV1> {
  if (!isPlainRecord(input.result) || !hasExactKeys(input.result, ["protocol", "preparedSha256", "profileSha256", "snapshotSha256",
    "querySha256", "mode", "budget", "context", "contextSha256", "contextBytes", "turnIds", "sessionIds", "sources", "omittedForBudget", "resultSha256"])) {
    throw new TypeError("Invalid hosted context envelope.");
  }
  const mode = data(input.result, "mode"), context = data(input.result, "context"),
    turnIds = data(input.result, "turnIds"), sessionIds = data(input.result, "sessionIds"), sources = data(input.result, "sources");
  if (mode !== "semantic" && mode !== "hybrid" || typeof context !== "string" || context.length > 96000
    || Buffer.byteLength(context) > 96000 || !Array.isArray(turnIds) || turnIds.length > 100
    || !Array.isArray(sessionIds) || sessionIds.length > 100 || !Array.isArray(sources) || sources.length > 100) {
    throw new TypeError("Invalid hosted context bounds.");
  }
  const prepared = await prepareEvolutionHostedCorpusV1(input.corpus, input.snapshot);
  try {
    const expected = await prepared.retrieve(input.query, mode);
    // Walk the bounded expected shape; never canonicalize an unchecked foreign subtree.
    const check = (a: unknown, b: unknown): boolean => {
      if (a === null || typeof a !== "object") return Object.is(a, b);
      if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && Reflect.ownKeys(b).length === b.length + 1
        && a.every((v, i) => check(v, data(b, String(i))));
      if (!isPlainRecord(b) || !hasExactKeys(b, Object.keys(a)) || Reflect.ownKeys(b).length !== Object.keys(a).length) return false;
      return Object.entries(a).every(([key, value]) => check(value, data(b, key)));
    };
    if (!check(expected, input.result)) throw new TypeError("Hosted context source/ranking/profile binding mismatch.");
    return expected;
  } finally { await prepared.close(); }
}
