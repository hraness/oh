/** Production retrieval qualification. Semantic scores are authenticated historical
 * QMD captures; reranker calls use the real SDK backend. No gold enters this module. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { Oh } from "../../src/sdk";
import type { OhRerankBackendV1, OhRerankDocumentV1, OhRerankResultV1 } from "../../src/rerank-model";
import { OH_EMBEDDING_PROFILE_V1, recordDocument, type OhSemanticSearchBackendV1,
  type OhSemanticSearchResultV1 } from "../../src/semantic-model";
import { cloneMemTimestamp, renderCloneMemEvidence, type CloneMemMemory } from "./clonemem-dataset";
import { cloneMemRetrievalMemory } from "./clonemem-retrieval";

export const SDK_QUALIFICATION_ARMS = ["sdk-semantic", "sdk-hybrid", "sdk-default-rerank"] as const;
export const SDK_QUALIFICATION_PEOPLE = ["2684282b-1e09-42a8-9425-533e2a95901d", "11ccc069-2a93-4e9d-af03-cdacb0b8d568"] as const;
export const SDK_QUALIFICATION_POLICY = Object.freeze({
  protocol: "oh.sdk-retrieval-qualification-policy.v1", questions: 146, personaQuestions: [114, 32],
  arms: SDK_QUALIFICATION_ARMS, limit: 10, poolSize: 30,
  semantic: "authenticated native original-question QMD capture replay; no new embedding inference",
  reranker: "fresh OhQmdRerankBackendV1 via default Oh.search; exact recordDocument bytes",
  control: "explicit SDK semantic and unmodified-query hybrid; hybrid is not a same-pool ablation",
  eligibility: "original trace date <= question date before any search limit; chronological incremental SQLite store",
  readerContext: "native complete original traces in SDK result order, no added metadata or truncation",
  labels: "separate scorer; native capture never opens choices, gold keys, evidence labels or previous answer outputs",
  maximumNativeSeconds: 3600, maximumDocuments: 60, maximumContextBytes: 96 * 1024,
  paid: "primary semantic pair; optional separately frozen hybrid pair; three attempts per arm; each pair <=876 physical calls",
  maximumAdditionalMicros: 25_000_000, priorTaskMicros: 12_876_502,
  interpretation: "previously exposed development qualification; no SOTA, clean holdout, live semantic latency or external superiority claim",
});

export type SdkQualificationQuery = Readonly<{ id: string; personId: string; query: string; questionDate: string;
  eligibleTraceIds: readonly string[]; semanticCapture: readonly OhSemanticSearchResultV1[]; originalResultSha256: string }>;
export type SdkQualificationPersona = Readonly<{ memory: CloneMemMemory; queries: readonly SdkQualificationQuery[] }>;
export type SdkQualificationArm = Readonly<{ armId: typeof SDK_QUALIFICATION_ARMS[number]; traceIds: readonly string[];
  context: string; contextSha256: string; contextBytes: number; searchMs: number }>;
export type SdkQualificationRow = Readonly<{ questionId: string; personId: string; questionDate: string;
  querySha256: string; authorityHeadSha256: string; eligibleRecords: number; semanticCaptureSha256: string;
  arms: readonly SdkQualificationArm[]; pool: readonly Readonly<{ key: string; documentSha256: string; documentBytes: number }>[];
  nativeScores: readonly OhRerankResultV1[]; rerankMs: number; defaultMode: string; diagnostics: readonly string[] }>;

function need(value: unknown, message: string): asserts value { if (!value) throw Error(`SDK qualification: ${message}`); }
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= maximum
    && !value.includes("\0") && !/\p{Surrogate}/u.test(value);
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Reject label-bearing/unknown fields rather than destructuring a raw source row. */
export function parseSdkQualificationPersona(value: unknown): SdkQualificationPersona {
  need(isPlainRecord(value) && hasExactKeys(value, ["memory", "queries"]), "persona shape");
  need(isPlainRecord(value.memory) && hasExactKeys(value.memory, ["personId", "personName", "traces"]), "memory projection");
  need(Array.isArray(value.memory.traces) && value.memory.traces.every(trace => isPlainRecord(trace)
    && hasExactKeys(trace, ["id", "medium", "date", "content"])), "gold-free trace projection");
  const memory = cloneMemRetrievalMemory(value.memory as unknown as CloneMemMemory);
  need(Array.isArray(value.queries) && value.queries.length > 0 && value.queries.length <= 146, "query bound");
  const records = memory.traces.map((trace, index) => createKnowledgeGraphRecordV1({
    key: `edition:trace-${String(index).padStart(5, "0")}`, kind: "edition", dependencies: [], v: 1,
    value: { id: trace.id, medium: trace.medium, date: trace.date, content: trace.content },
  }));
  const byKey = new Map(records.map(record => [record.key, record]));
  const queries = value.queries.map(raw => {
    need(isPlainRecord(raw) && hasExactKeys(raw, ["id", "personId", "query", "questionDate", "eligibleTraceIds", "semanticCapture", "originalResultSha256"]), "gold-free query projection");
    need(text(raw.id, 256) && raw.personId === memory.personId && text(raw.query, 16_384)
      && text(raw.questionDate, 512) && text(raw.originalResultSha256, 64) && /^[a-f0-9]{64}$/.test(raw.originalResultSha256), "query identity");
    const cutoff = cloneMemTimestamp(raw.questionDate);
    const eligible = memory.traces.filter(t => cloneMemTimestamp(t.date) <= cutoff).map(t => t.id);
    need(same(raw.eligibleTraceIds, eligible), "temporal eligible set differs");
    const eligibleKeys = new Set(records.filter((_, i) => eligible.includes(memory.traces[i]!.id)).map(r => r.key));
    need(Array.isArray(raw.semanticCapture) && raw.semanticCapture.length <= 30, "semantic pool bound");
    const hits = raw.semanticCapture.map(hit => {
      need(isPlainRecord(hit) && hasExactKeys(hit, ["key", "recordSha256", "score", "v"])
        && typeof hit.key === "string" && eligibleKeys.has(hit.key) && hit.v === 1
        && typeof hit.score === "number" && Number.isFinite(hit.score)
        && byKey.get(hit.key)?.recordSha256 === hit.recordSha256, "stale, future or invalid captured hit");
      return hit as OhSemanticSearchResultV1;
    });
    need(new Set(hits.map(hit => hit.key)).size === hits.length, "duplicate semantic hit");
    return { id: raw.id, personId: memory.personId, query: raw.query, questionDate: raw.questionDate,
      eligibleTraceIds: eligible, semanticCapture: hits, originalResultSha256: raw.originalResultSha256 };
  });
  need(new Set(queries.map(q => q.id)).size === queries.length, "duplicate question");
  return { memory, queries: queries.sort((a, b) => cloneMemTimestamp(a.questionDate) - cloneMemTimestamp(b.questionDate)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
}

/** The ranker is owned by the outer native capture. Each per-persona SDK owns
 * and closes its SQLite authority and replay adapter, never the shared ranker. */
export function openSdkQualificationPersona(input: SdkQualificationPersona, ranker: OhRerankBackendV1) {
  const { memory, queries } = parseSdkQualificationPersona(input);
  const records = memory.traces.map((trace, index) => createKnowledgeGraphRecordV1({
    key: `edition:trace-${String(index).padStart(5, "0")}`, kind: "edition", dependencies: [], v: 1,
    value: { id: trace.id, medium: trace.medium, date: trace.date, content: trace.content },
  }));
  const byKey = new Map(records.map((record, index) => [record.key, index]));
  const dates = memory.traces.map(trace => cloneMemTimestamp(trace.date));
  let current: SdkQualificationQuery | undefined, index = 0, semanticCalls = 0, rerankCalls = 0;
  let pool: SdkQualificationRow["pool"] = [], nativeScores: readonly OhRerankResultV1[] = [], rerankMs = 0;
  let active = false, failed = false, closed = false;
  const eligibleKeys = new Set<string>();
  const replay: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index() { throw Error("SDK qualification never mints an embedding index result"); }, async close() {},
    async search(query, limit, authority) {
      need(current && query === current.query && limit === 30 && authority === oh.store, "semantic replay route");
      semanticCalls++;
      for (const hit of current.semanticCapture) need(authority.get(hit.key)?.recordSha256 === hit.recordSha256, "captured hit digest");
      return current.semanticCapture;
    } };
  const observed: OhRerankBackendV1 = { profile: ranker.profile, async close() {},
    async rerank(query: string, documents: readonly OhRerankDocumentV1[]) {
      need(current && query === current.query && rerankCalls++ === 0 && documents.length > 0 && documents.length <= 60, "rerank route or pool bound");
      pool = documents.map(doc => {
        const record = oh.get(doc.key);
        need(record && eligibleKeys.has(doc.key) && doc.text === recordDocument(record), "SDK document or causality changed");
        return { key: doc.key, documentSha256: sha256Hex(doc.text), documentBytes: Buffer.byteLength(doc.text) };
      });
      const start = performance.now();
      nativeScores = await ranker.rerank(query, documents);
      rerankMs = performance.now() - start;
      return nativeScores;
    } };
  const oh = Oh.open({ databasePath: ":memory:", spaceId: "clonemem", semanticBackend: replay, rerankBackend: observed });
  function advance(query: SdkQualificationQuery) {
    const cutoff = cloneMemTimestamp(query.questionDate);
    const pending = records.filter((record, i) => dates[i]! <= cutoff && !eligibleKeys.has(record.key));
    for (let start = 0; start < pending.length;) {
      const changes: { kind: "put"; record: KnowledgeGraphRecordV1; v: 1 }[] = [];
      let bytes = 2;
      while (start + changes.length < pending.length && changes.length < 128) {
        const change = { kind: "put" as const, record: pending[start + changes.length]!, v: 1 as const };
        const size = Buffer.byteLength(canonicalJson(change)) + 1;
        if (changes.length && bytes + size > 4 * 1024 * 1024) break;
        changes.push(change); bytes += size;
      }
      oh.store.commit({ actorId: "sdk.qualification", changes, expectedHead: oh.head(),
        instant: "2026-01-01T00:00:00.000Z", operationId: `op_sdk_qualification_${eligibleKeys.size}` });
      changes.forEach(change => eligibleKeys.add(change.record.key)); start += changes.length;
    }
    need(eligibleKeys.size === query.eligibleTraceIds.length, "eligible authority coverage");
  }
  async function next(): Promise<SdkQualificationRow> {
    need(!active && !failed && !closed && index < queries.length, "closed, failed, busy or complete");
    active = true;
    try {
      current = queries[index]!; advance(current);
      const head = canonicalSha256(oh.head()); semanticCalls = 0; rerankCalls = 0;
      pool = []; nativeScores = []; rerankMs = 0;
      const arms: SdkQualificationArm[] = [];
      for (const armId of SDK_QUALIFICATION_ARMS) {
        const start = performance.now();
        const response = await oh.search(current.query, armId === "sdk-default-rerank" ? { limit: 10 }
          : { limit: 10, mode: armId === "sdk-semantic" ? "semantic" : "hybrid" });
        const searchMs = performance.now() - start;
        need(response.diagnostics.length === 0 && response.mode === (armId === "sdk-default-rerank" ? "rerank" : armId.slice(4)), "fallback or wrong production route");
        const ids = response.results.map(hit => {
          const i = byKey.get(hit.record.key);
          need(i !== undefined && eligibleKeys.has(hit.record.key) && records[i]!.recordSha256 === hit.record.recordSha256, "ranked source identity");
          return memory.traces[i]!.id;
        });
        need(ids.length <= 10 && new Set(ids).size === ids.length, "rank bounds");
        const context = renderCloneMemEvidence(memory, ids, 10);
        need(Buffer.byteLength(context) <= SDK_QUALIFICATION_POLICY.maximumContextBytes, "whole reader context exceeds bound");
        arms.push({ armId, traceIds: ids, context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), searchMs });
      }
      need(semanticCalls === 3 && rerankCalls === 1 && canonicalSha256(oh.head()) === head, "route count or read mutation");
      index++;
      return { questionId: current.id, personId: current.personId, questionDate: current.questionDate,
        querySha256: sha256Hex(current.query), authorityHeadSha256: head, eligibleRecords: eligibleKeys.size,
        semanticCaptureSha256: canonicalSha256(current.semanticCapture), arms, pool, nativeScores, rerankMs,
        defaultMode: "rerank", diagnostics: [] };
    } catch (error) { failed = true; throw error; }
    finally { active = false; }
  }
  return { next, questions: queries, async close() { need(!active, "close while active"); closed = true; await oh.close(); } };
}
