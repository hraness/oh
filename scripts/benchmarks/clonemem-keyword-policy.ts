/** Frozen English keyword-query preparation for an exposed-development screen.
 * This is an explicit split-query procedure: lexical search receives normalized
 * text, while semantic search retains the original question stem. Replay never
 * claims that the normalized text generated the captured semantic ranking. */
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../../src/graph";
import { Oh } from "../../src/sdk";
import { searchOhV1 } from "../../src/search";
import { OH_EMBEDDING_PROFILE_V1, recordDocument, type OhSemanticSearchBackendV1,
  type OhSemanticSearchResultV1 } from "../../src/semantic-model";
import { cloneMemTimestamp, renderCloneMemEvidence, type CloneMemMemory } from "./clonemem-dataset";
import { CLONEMEM_RETRIEVAL_POLICY, cloneMemRetrievalMemory, type CloneMemRetrievalResult } from "./clonemem-retrieval";

// Exact list from the frozen private development probe; no post-result changes.
const stopwords = Object.freeze("a an and are as at be been being but by can could did do does doing for from had has have having he her hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves s t ve ll re d m don isn aren wasn weren".split(" "));
const stopwordSet = new Set(stopwords);
export const CLONEMEM_KEYWORD_POLICY_V1 = Object.freeze({
  protocol: "oh.clonemem-keyword-policy.v1", arm: "oh-hybrid-keywords-v1", language: "en",
  normalization: "NFC; en-US lowercase; shipped token regex; first-occurrence deduplication; fixed stopword removal; first16",
  stopwords, maximumQueryBytes: 16_384, lexicalCandidates: 30, semanticCandidates: 30, topK: 10,
  fusion: "unchanged shipped searchOhV1: keyword2, semantic1, reciprocal-rank constant60",
  lexicalQuery: "normalized original question stem", semanticQuery: "unchanged original question stem",
  eligibility: "original trace date <= question date before indexing or candidate limits",
  context: "native top10 whole original traces, unchanged renderer, no byte truncation",
  probeFreezeSha256: "642f9f47e82f3b3cade4a957ba38fa312bb79afa112975655e35ebb199a730dc",
  probeResultSha256: "a3609af631e982fad65eb7ef5794f04004fb1b9fb047f411886c893630cadd6a",
} as const);

function fail(reason: string): never { throw new TypeError(`CloneMem keyword replay: ${reason}.`); }
function boundedQuery(value: string): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > CLONEMEM_KEYWORD_POLICY_V1.maximumQueryBytes
    || /\p{Surrogate}/u.test(value) || value.includes("\0")) fail("query scalar or byte bound");
  return value;
}
/** Does not stem words. Empty content-term output is an empty lexical lane. */
export function normalizeCloneMemKeywordQuery(query: string): string {
  return [...new Set(boundedQuery(query).normalize("NFC").toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}/gu) ?? [])]
    .filter(token => !stopwordSet.has(token)).slice(0, 16).join(" ");
}
export type CloneMemKeywordSemanticCapture = Pick<CloneMemRetrievalResult,
  "personId" | "querySha256" | "identitySha256" | "questionDate" | "eligibleTraceIds"
  | "semanticCapture" | "semanticCaptureSha256">;
export type CloneMemKeywordArm = Readonly<{ arm: "raw-vector" | "oh-hybrid-keywords-v1";
  traceIds: readonly string[]; context: string; contextBytes: number; contextSha256: string }>;
export type CloneMemKeywordResult = Readonly<{
  protocol: "oh.clonemem-keyword-replay-result.v1"; personId: string; policySha256: string;
  originalIdentitySha256: string; questionDate: string; eligibleTraceIds: readonly string[];
  queryPlan: Readonly<{ lexicalQuery: string; lexicalQuerySha256: string; semanticQuery: string;
    semanticQuerySha256: string; semanticSource: "captured-original-question-stem" }>;
  semanticCaptureSha256: string;
  arms: readonly CloneMemKeywordArm[];
}>;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Owns a disposable in-memory FTS authority. Inputs contain only original
 * trace/query fields and authenticated capture metadata, never choices or gold.
 * A future live adapter must pass semanticQuery to the real semantic backend;
 * this replay-only helper deliberately has no model/index/network capability. */
export function prepareCloneMemKeywordReplay(input: CloneMemMemory) {
  const memory = cloneMemRetrievalMemory(input);
  const records = memory.traces.map((trace, index) => createKnowledgeGraphRecordV1({
    key: `edition:trace-${String(index).padStart(5, "0")}`, kind: "edition", dependencies: [], v: 1,
    value: { id: trace.id, medium: trace.medium, date: trace.date, content: trace.content },
  }));
  const dates = memory.traces.map(trace => cloneMemTimestamp(trace.date));
  const byKey = new Map(records.map((record, index) => [record.key, index]));
  const identity = freeze({ protocol: "oh.clonemem-retrieval-identity.v1", personId: memory.personId,
    memorySha256: canonicalSha256(memory), policySha256: canonicalSha256(CLONEMEM_RETRIEVAL_POLICY),
    records: records.map(record => ({ key: record.key, recordSha256: record.recordSha256,
      documentSha256: sha256Hex(recordDocument(record)) })) });
  const originalIdentitySha256 = canonicalSha256(identity);
  const oh = Oh.open({ databasePath: ":memory:", spaceId: "clonemem" });
  const eligibleKeys = new Set<string>();
  let latestTimestamp = -Infinity, failed = false, closed = false;
  let active: Promise<CloneMemKeywordResult> | null = null, closeResult: Promise<void> | null = null;

  function advance(timestamp: number) {
    if (timestamp < latestTimestamp) fail("queries must be chronological");
    latestTimestamp = timestamp;
    const pending = records.filter((record, index) => dates[index]! <= timestamp && !eligibleKeys.has(record.key));
    for (let start = 0; start < pending.length;) {
      const changes: { kind: "put"; record: typeof records[number]; v: 1 }[] = [];
      let bytes = 2;
      while (start + changes.length < pending.length && changes.length < 128) {
        const change = { kind: "put" as const, record: pending[start + changes.length]!, v: 1 as const };
        const size = Buffer.byteLength(JSON.stringify(change)) + 1;
        if (changes.length && bytes + size > 4 * 1024 * 1024) break;
        changes.push(change); bytes += size;
      }
      oh.store.commit({ actorId: "clonemem.keyword", changes, expectedHead: oh.head(),
        instant: "2026-01-01T00:00:00.000Z", operationId: `op_keyword_${eligibleKeys.size}` });
      changes.forEach(change => eligibleKeys.add(change.record.key)); start += changes.length;
    }
  }
  function traceIds(keys: readonly string[]): string[] {
    return keys.map(key => {
      const index = byKey.get(key), record = index === undefined ? undefined : records[index];
      if (record === undefined || !eligibleKeys.has(key) || oh.get(key)?.recordSha256 !== record.recordSha256) fail("unknown, future or stale source");
      return memory.traces[index!]!.id;
    });
  }
  function render(arm: CloneMemKeywordArm["arm"], keys: readonly string[]): CloneMemKeywordArm {
    if (keys.length > 10 || new Set(keys).size !== keys.length) fail("top10 identity bound");
    const ids = traceIds(keys), context = renderCloneMemEvidence(memory, ids);
    return { arm, traceIds: ids, context, contextBytes: Buffer.byteLength(context), contextSha256: sha256Hex(context) };
  }
  async function perform(queryInput: string, questionDate: string, inputCapture: CloneMemKeywordSemanticCapture): Promise<CloneMemKeywordResult> {
    const semanticQuery = boundedQuery(queryInput), lexicalQuery = normalizeCloneMemKeywordQuery(semanticQuery);
    const timestamp = cloneMemTimestamp(questionDate);
    if (!semanticQuery.trim()) fail("empty original query");
    if (!isPlainRecord(inputCapture) || !hasExactKeys(inputCapture, ["personId", "querySha256", "identitySha256", "questionDate",
      "eligibleTraceIds", "semanticCapture", "semanticCaptureSha256"]) || inputCapture.personId !== memory.personId
      || inputCapture.identitySha256 !== originalIdentitySha256 || inputCapture.querySha256 !== sha256Hex(semanticQuery)
      || inputCapture.questionDate !== questionDate || !Array.isArray(inputCapture.eligibleTraceIds)
      || inputCapture.eligibleTraceIds.length > 2_000
      || inputCapture.eligibleTraceIds.some(id => typeof id !== "string" || Buffer.byteLength(id) > 256)
      || !Array.isArray(inputCapture.semanticCapture)
      || inputCapture.semanticCapture.length > 30) fail("original-stem capture identity or bounds");
    const eligibleTraceIds = memory.traces.filter((_, index) => dates[index]! <= timestamp).map(trace => trace.id);
    if (canonicalSha256(inputCapture.eligibleTraceIds) !== canonicalSha256(eligibleTraceIds)) fail("causal eligible-set mismatch");
    advance(timestamp);
    const hits: OhSemanticSearchResultV1[] = inputCapture.semanticCapture.map(value => {
      if (!isPlainRecord(value) || !hasExactKeys(value, ["key", "recordSha256", "score", "v"])
        || typeof value.key !== "string" || typeof value.score !== "number" || !Number.isFinite(value.score) || value.v !== 1) fail("semantic hit shape");
      const index = byKey.get(value.key), record = index === undefined ? undefined : records[index];
      if (record === undefined || !eligibleKeys.has(value.key) || record.recordSha256 !== value.recordSha256
        || oh.get(value.key)?.recordSha256 !== value.recordSha256) fail("unknown, future or stale semantic hit");
      return { key: record.key, recordSha256: record.recordSha256, score: value.score, v: 1 };
    });
    if (new Set(hits.map(hit => hit.key)).size !== hits.length
      || canonicalSha256(hits) !== inputCapture.semanticCaptureSha256) fail("duplicate or changed semantic capture");
    freeze(hits);
    const headSha256 = canonicalSha256(oh.head());
    let calls = 0;
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index() { return fail("replay must not index a model"); }, async close() {},
      async search(routedLexicalQuery, limit, authority) {
        if (routedLexicalQuery !== lexicalQuery || limit !== 30 || authority !== oh.store
          || canonicalSha256(authority.head()) !== headSha256 || calls++ !== 0) fail("split-query replay route changed");
        // Explicit substitution only after the ORIGINAL semanticQuery capture is
        // authenticated above. These hits do not represent routedLexicalQuery.
        return hits;
      } };
    const result = await searchOhV1({ store: oh.store, query: lexicalQuery, mode: "hybrid", limit: 10, backend });
    if (calls !== 1 || result.diagnostics.length || canonicalSha256(oh.head()) !== headSha256) fail("semantic fallback or changed authority");
    return freeze({ protocol: "oh.clonemem-keyword-replay-result.v1", personId: memory.personId,
      policySha256: canonicalSha256(CLONEMEM_KEYWORD_POLICY_V1), originalIdentitySha256, questionDate, eligibleTraceIds,
      queryPlan: { lexicalQuery, lexicalQuerySha256: sha256Hex(lexicalQuery), semanticQuery,
        semanticQuerySha256: sha256Hex(semanticQuery), semanticSource: "captured-original-question-stem" },
      semanticCaptureSha256: canonicalSha256(hits),
      arms: [render("raw-vector", hits.slice(0, 10).map(hit => hit.key)),
        render("oh-hybrid-keywords-v1", result.results.map(hit => hit.record.key))] });
  }
  function retrieve(query: string, questionDate: string, capture: CloneMemKeywordSemanticCapture): Promise<CloneMemKeywordResult> {
    if (closed || closeResult !== null || failed || active !== null) return Promise.reject(new TypeError("CloneMem keyword replay: closed, failed or busy."));
    const running = perform(query, questionDate, capture).catch(error => { failed = true; throw error; });
    active = running;
    void running.finally(() => { if (active === running) active = null; }).catch(() => {});
    return running;
  }
  function close(): Promise<void> {
    if (closeResult !== null) return closeResult;
    closeResult = (async () => { try { await active?.catch(() => {}); } finally { closed = true; await oh.close(); } })();
    return closeResult;
  }
  return Object.freeze({ identity, retrieve, close });
}
