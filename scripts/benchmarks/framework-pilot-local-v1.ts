import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonicalJson, canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { normalizeOhRerankLexicalQueryV1, OH_RERANK_PROFILE_V1, parseOhRerankDocumentsV1,
  parseOhRerankQueryV1, type OhRerankBackendV1 } from "../../src/rerank-model";
import { Oh } from "../../src/sdk";
import type { OhSearchResponseV1 } from "../../src/search";
import { OH_EMBEDDING_PROFILE_V1, recordDocument, type OhSemanticSearchBackendV1 } from "../../src/semantic-model";
import { parseFrameworkPilotContextInputV1 } from "./framework-pilot-context-v1";
import { validateFrameworkPilotSourceUnitsV1, type FrameworkPilotSourceUnitsV1 } from "./framework-pilot-source-v1";

export const FRAMEWORK_PILOT_LOCAL_POLICY_V1 = Object.freeze({
  maximumQueries: 60, maximumQueryBytes: 16_384, maximumResultBytes: 64 * 1024 * 1024,
  resultLimit: 20, ingestBatchRecords: 128, ingestBatchBytes: 4 * 1024 * 1024,
  bm25: "SQLite FTS5; unicode61 remove_diacritics 2; canonical source-unit fields; score ascending then source ordinal",
  lexicalQuery: "OH_RERANK_PROFILE_V1 normalization; quoted terms joined by OR; empty terms produce no hits",
  sdkQuery: "Oh.search(original query, {limit:20}); no mode or pool override",
  timing: "performance.now; initialization covers factories/stores; lazy native initialization belongs to index or first search",
} as const);

/** Factories own failed acquisitions until they return. Returned backends transfer
 * to this run. The semantic factory must use the supplied fresh directory.
 * Native file/token-fit/no-download admission belongs to the caller. Profiles and
 * callbacks are assertions, never evidence of installed models or native execution. */
export type FrameworkPilotLocalBackendsV1 = Readonly<{
  openSemantic(options: Readonly<{ cacheDirectory: string }>): Promise<OhSemanticSearchBackendV1>;
  openRerank(): Promise<OhRerankBackendV1>;
}>;
type Failure = Readonly<{ stage: string; message: string }>;
type Hit = Readonly<{ rank: number; unitId: string; unitSha256: string; recordKey: string;
  recordSha256: string; content: string; score: number; evidence: OhSearchResponseV1["results"][number]["evidence"] }>;
type QueryResult = Readonly<{
  queryId: string; querySha256: string; lexicalQuery: string;
  bm25: Readonly<{ status: "complete" | "not-run"; searchMs: number; hits: readonly Hit[] }>;
  oh: Readonly<{ status: "complete" | "unqualified-fallback" | "failed" | "not-run"; failure: Failure | null;
    mode: string | null; searchMs: number; semanticMs: number; rerankMs: number;
    semanticCalls: number; rerankCalls: number; responseSha256: string | null;
    diagnostics: OhSearchResponseV1["diagnostics"]; hits: readonly Hit[] }>;
}>;
export type FrameworkPilotLocalResultV1 = Readonly<{
  protocol: "oh.framework-pilot-local.v1"; status: "complete" | "unqualified" | "failed";
  backendQualification: "not-established-by-this-module"; modelContextFit: "not-established-by-this-module";
  sourceCompleteness: "relative-to-supplied-projection";
  sourceSha256: string; splitPlanSha256: string; bundleSha256: string;
  policySha256: string; semanticProfileSha256: string; rerankProfileSha256: string;
  namespace: string; unitCount: number; indexed: number; authorityHeadSha256: string | null;
  records: readonly Readonly<{ unitId: string; unitSha256: string; key: string; recordSha256: string; documentSha256: string }>[];
  queries: readonly QueryResult[]; failure: Failure | null; cleanupFailures: readonly Failure[];
  cache: Readonly<{ directory: string | null; created: boolean; removed: boolean }>;
  timings: Readonly<{ validationMs: number; initializationMs: number; recordIngestionMs: number;
    bm25IngestionMs: number; semanticIndexMs: number; closeMs: number; totalMs: number }>;
}>;

function fail(message: string): never { throw new TypeError(`Framework pilot local: ${message}.`); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length !== keys.length
    || Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key))) fail("unexpected fields");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (field === undefined || !field.enumerable || !("value" in field)) fail("data fields required");
    result[key] = field.value;
  }
  return result;
}
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function failure(stage: string, error: unknown): Failure {
  return { stage, message: (error instanceof Error ? error.message : "Operation rejected without an Error.").slice(0, 2_048) };
}
function parse(input: unknown): { bundle: FrameworkPilotSourceUnitsV1; queries: { queryId: string; text: string }[] } {
  const value = exact(input, ["protocol", "source", "splitPlan", "sourceUnits", "queries"]);
  if (value.protocol !== "oh.framework-pilot-local-input.v1") fail("input protocol mismatch");
  const bundle = validateFrameworkPilotSourceUnitsV1(value.sourceUnits, value.source, value.splitPlan);
  if (!Array.isArray(value.queries) || value.queries.length < 1 || value.queries.length > FRAMEWORK_PILOT_LOCAL_POLICY_V1.maximumQueries
    || Reflect.ownKeys(value.queries).length !== value.queries.length + 1) fail("invalid query array");
  const queries: { queryId: string; text: string }[] = [];
  for (let index = 0; index < value.queries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value.queries, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("dense query data required");
    const row = exact(descriptor.value, ["queryId", "text"]), queryId = `q${String(index + 1).padStart(4, "0")}`;
    if (row.queryId !== queryId) fail("neutral query IDs must preserve supplied order");
    queries.push({ queryId, text: parseOhRerankQueryV1(row.text) });
  }
  return { bundle, queries };
}
function parentPath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || value.length > 4_096 || Buffer.byteLength(value) > 4_096
    || value.includes("\0") || /\p{Surrogate}/u.test(value)) fail("an existing absolute cache parent is required");
  return value;
}

/** Answer-blind local retrieval over an explicitly supplied source projection.
 * No dataset, gold, provider, model loader, download or existing database is opened.
 * Every run owns fresh SQLite stores and a fresh cache child. Source/model fit is
 * not proved here. A successful callback run cannot qualify a native backend.
 * Invalid inputs reject before acquisition; operational failures return evidence
 * after attempting all acquired closes. Failed closes retain the owned cache.
 * Factory/backend work has no in-process deadline or cancellation guarantee;
 * live execution needs an independently bounded process owner. */
export async function runFrameworkPilotLocalV1(input: unknown, suppliedBackends: FrameworkPilotLocalBackendsV1,
  options: Readonly<{ cacheParent: string }>): Promise<FrameworkPilotLocalResultV1> {
  const started = performance.now(), parsed = parse(input), bundle = parsed.bundle;
  const optionValues = exact(options, ["cacheParent"]), cacheParent = parentPath(optionValues.cacheParent);
  const factory = exact(suppliedBackends, ["openSemantic", "openRerank"]);
  if (typeof factory.openSemantic !== "function" || typeof factory.openRerank !== "function") fail("backend factories required");
  const backends = factory as unknown as FrameworkPilotLocalBackendsV1;
  const records = bundle.units.map(unit => {
    const { unitSha256: _digest, ...value } = unit;
    return immutable(createKnowledgeGraphRecordV1({ dependencies: [], key: `edition:${unit.unitId}`, kind: "edition", value, v: 1 }));
  });
  const content = records.map(record => canonicalJson(record.value));
  // Admit every unit before I/O, including units a query will never retrieve.
  records.forEach((record, index) => {
    parseOhRerankDocumentsV1([{ key: record.key, text: recordDocument(record), v: 1 }]);
    parseFrameworkPilotContextInputV1({ protocol: "oh.framework-pilot-context-input.v1", maxContextTokens: 8_192,
      candidates: [{ unitId: bundle.units[index]!.unitId, content: content[index]! }] });
  });
  const byKey = new Map(records.map((record, index) => [record.key, index]));
  const namespace = `framework-pilot-${randomUUID()}`;
  const rows: QueryResult[] = parsed.queries.map(query => ({ queryId: query.queryId,
    querySha256: sha256Hex(query.text), lexicalQuery: normalizeOhRerankLexicalQueryV1(query.text),
    bm25: { status: "not-run", searchMs: 0, hits: [] }, oh: { status: "not-run", mode: null, searchMs: 0,
      semanticMs: 0, rerankMs: 0, semanticCalls: 0, rerankCalls: 0, responseSha256: null, diagnostics: [], hits: [], failure: null } }));
  const recordManifest = records.map((record, index) => ({ unitId: bundle.units[index]!.unitId,
    unitSha256: bundle.units[index]!.unitSha256, key: record.key, recordSha256: record.recordSha256,
    documentSha256: sha256Hex(recordDocument(record)) }));
  const timings = { validationMs: performance.now() - started, initializationMs: 0, recordIngestionMs: 0,
    bm25IngestionMs: 0, semanticIndexMs: 0, closeMs: 0, totalMs: 0 };
  const cache = { directory: null as string | null, created: false, removed: false };
  let cacheIdentity: { dev: number; ino: number } | undefined, stage = "initialize", issue: Failure | null = null;
  let semantic: OhSemanticSearchBackendV1 | undefined, reranker: OhRerankBackendV1 | undefined;
  let oh: Oh | undefined, bm25: Database | undefined, indexed = 0, head: string | null = null;
  let active: { query: string; semanticCalls: number; rerankCalls: number; semanticMs: number; rerankMs: number } | undefined;
  // Reserve the manifest/query envelopes and bounded metadata/failure fields before
  // acquisition. Charging replacement arm envelopes again is conservative.
  let indexCalls = 0, resultBytes = Buffer.byteLength(canonicalJson({ records: recordManifest, queries: rows })) + 65_536;
  if (resultBytes > FRAMEWORK_PILOT_LOCAL_POLICY_V1.maximumResultBytes) fail("result envelope byte budget exceeded");
  const cleanupFailures: Failure[] = [];
  function unchanged(): void { if (oh === undefined || canonicalSha256(oh.head()) !== head) fail("authority changed during retrieval"); }
  function hit(index: number, score: number, rank: number, evidence: Hit["evidence"] = []): Hit {
    const record = records[index], unit = bundle.units[index];
    if (record === undefined || unit === undefined || !Number.isFinite(score)
      || oh?.get(record.key)?.recordSha256 !== record.recordSha256) fail("result/source digest join failed");
    return { rank, unitId: unit.unitId, unitSha256: unit.unitSha256, recordKey: record.key,
      recordSha256: record.recordSha256, content: content[index]!, score, evidence };
  }
  function reserve(row: unknown): void {
    resultBytes += Buffer.byteLength(canonicalJson(row));
    if (resultBytes > FRAMEWORK_PILOT_LOCAL_POLICY_V1.maximumResultBytes) fail("result byte budget exceeded");
  }
  try {
    let mark = performance.now();
    try {
      const parent = await realpath(cacheParent);
      if (!(await lstat(parent)).isDirectory()) fail("cache parent is not a directory");
      cache.directory = await mkdtemp(join(parent, "oh-framework-pilot-")); cache.created = true;
      const identity = await lstat(cache.directory); cacheIdentity = { dev: identity.dev, ino: identity.ino };
      semantic = await backends.openSemantic(Object.freeze({ cacheDirectory: cache.directory }));
      if (canonicalJson(semantic.profile) !== canonicalJson(OH_EMBEDDING_PROFILE_V1)) fail("semantic profile mismatch");
      reranker = await backends.openRerank();
      if (canonicalJson(reranker.profile) !== canonicalJson(OH_RERANK_PROFILE_V1)) fail("rerank profile mismatch");
      const semanticBackend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
        close: async () => { await semantic!.close(); },
        async index(snapshot) {
          if (++indexCalls !== 1 || snapshot.length !== records.length || snapshot.some((record, index) =>
            canonicalJson(record) !== canonicalJson(records[index]))) fail("incomplete or repeated semantic ingestion");
          return await semantic!.index(Object.freeze([...records]));
        },
        async search(query, limit, authority) {
          if (active === undefined || query !== active.query || limit !== 30 || authority !== oh?.store
            || ++active.semanticCalls !== 1) fail("unexpected semantic query route");
          const start = performance.now();
          try {
            const result = await semantic!.search(query, limit, authority);
            if (!Array.isArray(result) || result.length > limit) fail("semantic result bound exceeded");
            for (const resultHit of result) {
              const index = byKey.get(resultHit.key);
              if (index === undefined || records[index]!.recordSha256 !== resultHit.recordSha256) fail("semantic result/source digest join failed");
            }
            return result;
          } finally { active.semanticMs += performance.now() - start; }
        } };
      const rerankBackend: OhRerankBackendV1 = { profile: OH_RERANK_PROFILE_V1,
        close: async () => { await reranker!.close(); },
        async rerank(query, documents) {
          if (active === undefined || query !== active.query || ++active.rerankCalls !== 1) fail("unexpected rerank query route");
          for (const document of documents) {
            const index = byKey.get(document.key);
            if (index === undefined || document.text !== recordDocument(records[index]!)) fail("rerank document/source join failed");
          }
          const start = performance.now();
          try { return await reranker!.rerank(query, documents); }
          finally { active.rerankMs += performance.now() - start; }
        } };
      oh = Oh.open({ databasePath: ":memory:", spaceId: namespace, semanticBackend, rerankBackend });
      bm25 = new Database(":memory:");
    } finally { timings.initializationMs = performance.now() - mark; }
    stage = "record-ingestion"; mark = performance.now();
    try {
      for (let cursor = 0; cursor < records.length;) {
        const changes: { kind: "put"; record: KnowledgeGraphRecordV1; v: 1 }[] = [];
        let bytes = 0;
        while (cursor + changes.length < records.length && changes.length < FRAMEWORK_PILOT_LOCAL_POLICY_V1.ingestBatchRecords) {
          const change = { kind: "put" as const, record: records[cursor + changes.length]!, v: 1 as const };
          const next = Buffer.byteLength(canonicalJson(change)) + 1;
          if (changes.length > 0 && bytes + next > FRAMEWORK_PILOT_LOCAL_POLICY_V1.ingestBatchBytes) break;
          changes.push(change); bytes += next;
        }
        oh.store.commit({ actorId: "framework.pilot", changes, expectedHead: oh.head(),
          instant: "2026-01-01T00:00:00.000Z", operationId: `op_framework_pilot_${cursor}` });
        cursor += changes.length;
      }
      if (canonicalSha256(oh.store.snapshotRecords()) !== canonicalSha256(records)) fail("authority ingestion coverage mismatch");
      head = canonicalSha256(oh.head());
    } finally { timings.recordIngestionMs = performance.now() - mark; }
    stage = "bm25-ingestion"; mark = performance.now();
    try {
      bm25.run("CREATE VIRTUAL TABLE units USING fts5(ordinal UNINDEXED, content, tokenize='unicode61 remove_diacritics 2')");
      const insert = bm25.prepare("INSERT INTO units(ordinal, content) VALUES (?, ?)");
      bm25.transaction(() => content.forEach((text, index) => insert.run(index, text)))();
      if (bm25.query<{ count: number }, []>("SELECT count(*) AS count FROM units").get()?.count !== records.length) fail("BM25 ingestion coverage mismatch");
    } finally { timings.bm25IngestionMs = performance.now() - mark; }
    // The baseline remains available even if later semantic indexing fails.
    stage = "bm25-search";
    for (const [index, row] of rows.entries()) {
      const start = performance.now(), match = row.lexicalQuery.split(" ").filter(Boolean).map(term => `"${term}"`).join(" OR ");
      const found = match === "" ? [] : bm25.query<{ ordinal: number; score: number }, [string]>(
        "SELECT CAST(ordinal AS INTEGER) AS ordinal, bm25(units) AS score FROM units WHERE units MATCH ? ORDER BY score, ordinal LIMIT 20").all(match);
      const hits = found.map((value, rank) => hit(value.ordinal, value.score, rank + 1));
      const result: QueryResult["bm25"] = { status: "complete", searchMs: performance.now() - start, hits };
      reserve(result); rows[index] = { ...row, bm25: result };
    }
    stage = "semantic-index"; mark = performance.now();
    try {
      const result = exact(await oh.indexSemantic(), ["indexed", "v"]);
      unchanged();
      if (result.v !== 1 || result.indexed !== records.length || indexCalls !== 1) fail("semantic index did not cover every unit");
      indexed = result.indexed as number;
    } finally { timings.semanticIndexMs = performance.now() - mark; }
    for (const [index, query] of parsed.queries.entries()) {
      stage = `oh-search:${query.queryId}`;
      active = { query: query.text, semanticCalls: 0, rerankCalls: 0, semanticMs: 0, rerankMs: 0 };
      const start = performance.now();
      try {
        const response = await oh.search(query.text, { limit: 20 });
        const searchMs = performance.now() - start;
        unchanged();
        if (response.mode !== "rerank" || active.semanticCalls !== 1 || response.results.length > 20) fail("default SDK query route mismatch");
        if (response.diagnostics.some(diagnostic => Buffer.byteLength(diagnostic.message) > 8_192)) fail("diagnostic byte bound exceeded");
        const seen = new Set<string>();
        const hits = response.results.map((result, rank) => {
          const ordinal = byKey.get(result.record.key);
          if (ordinal === undefined || seen.has(result.record.key) || canonicalJson(result.record) !== canonicalJson(records[ordinal])) fail("SDK result/source join failed");
          seen.add(result.record.key); return hit(ordinal, result.score, rank + 1, result.evidence);
        });
        if (response.diagnostics.length === 0 && hits.length > 0 && active.rerankCalls !== 1) fail("rerank was not invoked");
        const result: QueryResult["oh"] = { status: response.diagnostics.length === 0 ? "complete" : "unqualified-fallback", failure: null,
          mode: response.mode, searchMs, semanticMs: active.semanticMs, rerankMs: active.rerankMs,
          semanticCalls: active.semanticCalls, rerankCalls: active.rerankCalls,
          responseSha256: canonicalSha256(response), diagnostics: response.diagnostics, hits };
        reserve(result); rows[index] = { ...rows[index]!, oh: result };
      } catch (error) {
        rows[index] = { ...rows[index]!, oh: { ...rows[index]!.oh, status: "failed", failure: failure(stage, error),
          searchMs: performance.now() - start, semanticMs: active.semanticMs, rerankMs: active.rerankMs,
          semanticCalls: active.semanticCalls, rerankCalls: active.rerankCalls } };
        throw error;
      } finally { active = undefined; }
    }
  } catch (error) { issue = failure(stage, error); }
  finally {
    const mark = performance.now();
    if (oh !== undefined) {
      try { await oh.close(); } catch (error) { cleanupFailures.push(failure("sdk-close", error)); }
    } else {
      for (const [name, resource] of [["semantic-close", semantic], ["rerank-close", reranker]] as const) {
        try { await resource?.close(); } catch (error) { cleanupFailures.push(failure(name, error)); }
      }
    }
    try { bm25?.close(); } catch (error) { cleanupFailures.push(failure("bm25-close", error)); }
    if (cache.directory !== null && cacheIdentity !== undefined && cleanupFailures.length === 0) {
      try {
        const current = await lstat(cache.directory);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== cacheIdentity.dev || current.ino !== cacheIdentity.ino) fail("owned cache identity changed");
        await rm(cache.directory, { recursive: true }); cache.removed = true;
      } catch (error) { cleanupFailures.push(failure("cache-remove", error)); }
    }
    timings.closeMs = performance.now() - mark; timings.totalMs = performance.now() - started;
  }
  return immutable({ protocol: "oh.framework-pilot-local.v1", status: issue !== null || cleanupFailures.length > 0 ? "failed"
    : rows.some(row => row.oh.status === "unqualified-fallback") ? "unqualified" : "complete",
    backendQualification: "not-established-by-this-module", modelContextFit: "not-established-by-this-module",
    sourceCompleteness: "relative-to-supplied-projection", sourceSha256: bundle.sourceSha256,
    splitPlanSha256: bundle.splitPlanSha256, bundleSha256: bundle.bundleSha256,
    policySha256: canonicalSha256(FRAMEWORK_PILOT_LOCAL_POLICY_V1), semanticProfileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1),
    rerankProfileSha256: canonicalSha256(OH_RERANK_PROFILE_V1), namespace, unitCount: records.length, indexed,
    authorityHeadSha256: head, records: recordManifest, queries: rows, failure: issue, cleanupFailures, cache, timings });
}
