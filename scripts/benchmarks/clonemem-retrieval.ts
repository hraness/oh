/** Native whole-trace CloneMem comparison through the shipped Oh SDK.
 * The same physical top-30 semantic request supplies hybrid and vector-only.
 * Only question text and its causal-visibility timestamp enter the retriever;
 * scorers, answers, choices, and categories remain outside this boundary. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { Oh } from "../../src/sdk";
import { OhQmdSemanticBackendV1 } from "../../src/semantic";
import { OH_EMBEDDING_PROFILE_V1, recordDocument, type OhSemanticSearchBackendV1,
  type OhSemanticSearchResultV1, type QmdStore, type QmdStoreFactoryV1 } from "../../src/semantic-model";
import type { OhSearchResultV1 } from "../../src/search";
import { CLONEMEM_PRIMARY_PERSON_IDS, CLONEMEM_SOURCE, cloneMemTimestamp, readCloneMemPersona,
  renderCloneMemEvidence, type CloneMemMemory } from "./clonemem-dataset";
import { SEMANTIC_MODEL_SHA256, SEMANTIC_RUNTIME } from "./deductive-semantic-cache";
import { ROOT, writeNew } from "./io";

export const CLONEMEM_RETRIEVAL_POLICY = Object.freeze({
  protocol: "oh.clonemem-retrieval-policy.v1", topK: 10, semanticCandidates: 30,
  arms: ["oh-hybrid", "raw-vector", "oh-keyword"] as const,
  productEntry: "Oh.search", recordKind: "edition", traceFields: ["id", "medium", "date", "content"],
  semanticDocument: "recordDocument", semanticProfileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1),
  hybrid: "shipped searchOhV1 (keyword weight 2, semantic weight 1, RRF k=60)",
  eligibility: "incremental records with event_date <= question_time; queries in ascending timestamp then ID order",
  context: "native top-10 whole digital traces; no byte cap, neighbors, or reranker",
  vectorTiming: "shared semantic top-30 service time; not independent vector top-10 latency",
} as const);
export const CLONEMEM_CAPTURE_LIMITS = Object.freeze({ personas: 9, questions: 1_007,
  personaBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, timeoutMs: 20 * 60 * 1_000 });
export type CloneMemArmResult = Readonly<{ arm: "oh-hybrid" | "raw-vector" | "oh-keyword";
  traceIds: readonly string[]; context: string; contextBytes: number; contextSha256: string;
  sources: readonly Readonly<{ traceId: string; key: string; recordSha256: string }>[];
  evidence: readonly OhSearchResultV1["evidence"][] }>;
export type CloneMemRetrievalResult = Readonly<{ protocol: "oh.clonemem-retrieval-result.v1";
  personId: string; querySha256: string; identitySha256: string;
  questionDate: string; eligibleTraceIds: readonly string[]; authorityHeadSha256: string;
  semanticCapture: readonly OhSemanticSearchResultV1[]; semanticCaptureSha256: string;
  arms: readonly CloneMemArmResult[];
  timing: Readonly<{ incrementalIndexMs: number; hybridWallMs: number; sharedSemanticTop30Ms: number; keywordWallMs: number }>;
  resultSha256: string }>;

function fail(reason: string): never { throw new TypeError(`CloneMem retrieval: ${reason}.`); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function scalar(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || Buffer.byteLength(value) > maximum
    || /\p{Surrogate}/u.test(value) || value.includes("\0")) fail("invalid source text");
  return value;
}
/** Allowlisted reads detach source bytes without traversing possible annotation fields. */
export function cloneMemRetrievalMemory(input: CloneMemMemory): CloneMemMemory {
  if (!Array.isArray(input.traces) || input.traces.length < 1 || input.traces.length > 2_000) fail("trace count");
  const memory = { personId: scalar(input.personId, 128), personName: scalar(input.personName, 512),
    traces: input.traces.map(trace => ({ id: scalar(trace.id, 256), medium: scalar(trace.medium, 256),
      date: scalar(trace.date, 512, true), content: scalar(trace.content, 65_536) })) };
  if (new Set(memory.traces.map(trace => trace.id)).size !== memory.traces.length
    || Buffer.byteLength(canonicalJson(memory)) > 16 * 1024 * 1024) fail("duplicate trace or memory byte bound");
  return freeze(memory);
}

export async function prepareCloneMemRetrieval(input: CloneMemMemory, backend: OhSemanticSearchBackendV1) {
  const started = performance.now(), memory = cloneMemRetrievalMemory(input);
  if (canonicalSha256(backend.profile) !== canonicalSha256(OH_EMBEDDING_PROFILE_V1)) fail("semantic profile mismatch");
  const records = freeze(memory.traces.map((trace, index) => createKnowledgeGraphRecordV1({
    key: `edition:trace-${String(index).padStart(5, "0")}`, kind: "edition", dependencies: [], v: 1,
    value: { id: trace.id, medium: trace.medium, date: trace.date, content: trace.content },
  })));
  const byKey = new Map(records.map((record, index) => [record.key, index]));
  const dates = memory.traces.map(trace => cloneMemTimestamp(trace.date));
  const identity = freeze({ protocol: "oh.clonemem-retrieval-identity.v1", personId: memory.personId,
    memorySha256: canonicalSha256(memory), policySha256: canonicalSha256(CLONEMEM_RETRIEVAL_POLICY),
    records: records.map(record => ({ key: record.key, recordSha256: record.recordSha256,
      documentSha256: sha256Hex(recordDocument(record)) })) });
  let capture: readonly OhSemanticSearchResultV1[] | null = null, semanticMs = 0, semanticCalls = 0;
  let headSha256 = "", closed = false, closing = false, active: Promise<CloneMemRetrievalResult> | null = null;
  let closeResult: Promise<void> | null = null;
  let latestTimestamp = -Infinity, indexed = false, failed = false;
  const eligibleKeys = new Set<string>();
  const checkedBackend: OhSemanticSearchBackendV1 = {
    profile: backend.profile, index: values => backend.index(values), close: () => backend.close(),
    async search(query, limit, authority) {
      if (limit !== 30 || semanticCalls++ !== 0 || canonicalSha256(authority.head()) !== headSha256) fail("semantic request or authority changed");
      const begin = performance.now();
      const hits = await backend.search(query, limit, authority);
      semanticMs = performance.now() - begin;
      if (!Array.isArray(hits) || hits.length > 30 || new Set(hits.map(hit => hit.key)).size !== hits.length) fail("invalid semantic count or duplicate key");
      const checked = freeze(hits.map(hit => {
        if (!isPlainRecord(hit) || !hasExactKeys(hit, ["key", "recordSha256", "score", "v"])
          || typeof hit.key !== "string" || typeof hit.score !== "number" || hit.v !== 1 || !Number.isFinite(hit.score)) fail("invalid semantic hit shape");
        const index = byKey.get(hit.key), record = index === undefined ? undefined : records[index];
        if (record === undefined || !eligibleKeys.has(hit.key)
          || hit.recordSha256 !== record.recordSha256 || authority.get(hit.key)?.recordSha256 !== record.recordSha256) fail("stale or invalid semantic hit");
        return { key: record.key, recordSha256: record.recordSha256, score: hit.score, v: 1 as const };
      }));
      capture = checked;
      return checked;
    },
  };
  const oh = Oh.open({ databasePath: ":memory:", spaceId: "clonemem", semanticBackend: checkedBackend });
  headSha256 = canonicalSha256(oh.head());
  const preparationMs = performance.now() - started;
  async function advance(timestamp: number): Promise<number> {
    if (timestamp < latestTimestamp) fail("queries must be in chronological order");
    latestTimestamp = timestamp;
    const pending = records.filter((record, index) => dates[index]! <= timestamp && !eligibleKeys.has(record.key));
    if (!pending.length && indexed) return 0;
    const begin = performance.now();
    for (let start = 0; start < pending.length;) {
      const changes: { kind: "put"; record: KnowledgeGraphRecordV1; v: 1 }[] = [];
      let bytes = 2;
      while (start + changes.length < pending.length && changes.length < 512) {
        const change = { kind: "put" as const, record: pending[start + changes.length]!, v: 1 as const };
        const size = Buffer.byteLength(canonicalJson(change)) + 1;
        if (changes.length && bytes + size > 4 * 1024 * 1024) break;
        changes.push(change); bytes += size;
      }
      oh.store.commit({ actorId: "clonemem.prepare", changes, expectedHead: oh.head(),
        instant: "2026-01-01T00:00:00.000Z", operationId: `op_clonemem_${eligibleKeys.size}` });
      changes.forEach(change => eligibleKeys.add(change.record.key));
      start += changes.length;
    }
    headSha256 = canonicalSha256(oh.head());
    // Production QMD update checks content hashes and embed skips complete,
    // unchanged embeddings. Only newly eligible documents need model inference.
    const result = await oh.indexSemantic();
    if (result.v !== 1 || result.indexed !== eligibleKeys.size || canonicalSha256(oh.head()) !== headSha256) fail("incomplete index or changed authority");
    indexed = true;
    return performance.now() - begin;
  }
  function arm(armId: CloneMemArmResult["arm"], keys: readonly string[], evidence: readonly OhSearchResultV1["evidence"][]): CloneMemArmResult {
    if (keys.length > 10 || new Set(keys).size !== keys.length) fail("result rank bound");
    const sources = keys.map(key => {
      const index = byKey.get(key), record = index === undefined ? undefined : records[index];
      if (record === undefined || !eligibleKeys.has(key) || oh.get(key)?.recordSha256 !== record.recordSha256) fail("result source changed");
      return { traceId: memory.traces[index!]!.id, key, recordSha256: record.recordSha256 };
    });
    const traceIds = sources.map(source => source.traceId), context = renderCloneMemEvidence(memory, traceIds, 10);
    return freeze({ arm: armId, traceIds, context, contextBytes: Buffer.byteLength(context),
      contextSha256: sha256Hex(context), sources, evidence });
  }
  async function retrieveImpl(question: string, questionDate: string): Promise<CloneMemRetrievalResult> {
    const query = scalar(question, 16_384);
    if (canonicalSha256(oh.head()) !== headSha256) fail("prepared authority changed");
    const incrementalIndexMs = await advance(cloneMemTimestamp(questionDate));
    capture = null; semanticMs = 0; semanticCalls = 0;
    const begin = performance.now(), hybrid = await oh.search(query, { mode: "hybrid", limit: 10 });
    const hybridWallMs = performance.now() - begin;
    if (hybrid.diagnostics.length || capture === null || semanticCalls !== 1) fail("semantic fallback or absent capture");
    const semanticCapture: readonly OhSemanticSearchResultV1[] = capture;
    const keywordStarted = performance.now(), keyword = await oh.search(query, { mode: "keyword", limit: 10 });
    const keywordWallMs = performance.now() - keywordStarted;
    if (keyword.diagnostics.length || canonicalSha256(oh.head()) !== headSha256) fail("keyword diagnostics or changed authority");
    const arms = [arm("oh-hybrid", hybrid.results.map(hit => hit.record.key), hybrid.results.map(hit => hit.evidence)),
      arm("raw-vector", semanticCapture.slice(0, 10).map(hit => hit.key), semanticCapture.slice(0, 10).map((hit, index) =>
        [{ lane: "semantic" as const, rank: index + 1, score: hit.score, v: 1 as const }])),
      arm("oh-keyword", keyword.results.map(hit => hit.record.key), keyword.results.map(hit => hit.evidence))];
    const payload = { protocol: "oh.clonemem-retrieval-result.v1" as const, personId: memory.personId,
      querySha256: sha256Hex(query), identitySha256: canonicalSha256(identity), semanticCapture,
      questionDate, eligibleTraceIds: records.flatMap((record, index) => eligibleKeys.has(record.key) ? [memory.traces[index]!.id] : []),
      authorityHeadSha256: headSha256,
      semanticCaptureSha256: canonicalSha256(semanticCapture), arms,
      timing: { incrementalIndexMs, hybridWallMs, sharedSemanticTop30Ms: semanticMs, keywordWallMs } };
    return freeze({ ...payload, resultSha256: canonicalSha256(payload) });
  }
  return Object.freeze({ identity, preparationMs,
    async retrieve(question: string, questionDate: string): Promise<CloneMemRetrievalResult> {
      if (closed || closing || failed || active !== null) fail("closed, failed or concurrent retrieval");
      active = retrieveImpl(question, questionDate);
      try { return await active; } catch (error) { failed = true; throw error; } finally { active = null; }
    },
    close(): Promise<void> {
      if (closeResult !== null) return closeResult;
      closing = true;
      closeResult = (async () => {
        try { await active; } finally { try { await oh.close(); } finally { closed = true; } }
      })();
      return closeResult;
    },
  });
}

type LocalLlm = { embedModelName: string; modelCacheDir: string;
  ensureLlama(allowBuild: boolean): Promise<unknown>;
  ensureEmbedModel(): Promise<{ _modelPath?: unknown }> };
type NativeQmd = QmdStore & { internal: { llm: LocalLlm } };
/** Runtime acquisition only uses already installed packages and cached model bytes.
 * searchVector and the production Oh QMD boundary remain unchanged. */
export async function createCloneMemLocalBackend(cacheDirectory: string, qmdModulePath = join(ROOT, ".cache/qmd-env/node_modules/@tobilu/qmd")) {
  const modulePath = await realpath(qmdModulePath), require = createRequire(join(modulePath, "package.json"));
  const packages = [[join(modulePath, "package.json"), "@tobilu/qmd", "2.5.3"],
    [require.resolve("node-llama-cpp/package.json"), "node-llama-cpp", SEMANTIC_RUNTIME.nodeLlamaCpp],
    [require.resolve("sqlite-vec/package.json"), "sqlite-vec", SEMANTIC_RUNTIME.sqliteVec]] as const;
  for (const [path, name, version] of packages) {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isPlainRecord(value) || value.name !== name || value.version !== version) fail("native runtime version mismatch");
  }
  const qmd = await import(modulePath) as { createStore: (options: Parameters<QmdStoreFactoryV1>[0]) => Promise<NativeQmd> };
  const llmModule = await import(join(modulePath, "dist/llm.js")) as {
    getDefaultLlamaCpp(): LocalLlm; hasDefaultLlamaCpp(): boolean; disposeDefaultLlamaCpp(): Promise<void> };
  if (llmModule.hasDefaultLlamaCpp()) fail("local worker must own a fresh QMD singleton");
  const llama = await import(require.resolve("node-llama-cpp")) as {
    resolveModelFile(uri: string, options: { directory: string; download: false }): Promise<string> };
  const verified = new Map<string, { digest: string; identity: string }>();
  const modelIdentity = async (path: string): Promise<string> => {
    const value = await stat(path);
    if (!value.isFile() || value.size > 1024 * 1024 * 1024) fail("model file size");
    return canonicalJson({ dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs });
  };
  const verify = async (llm: LocalLlm) => {
    if (llm.embedModelName !== OH_EMBEDDING_PROFILE_V1.model) fail("global or per-store model URI mismatch");
    const path = await realpath(await llama.resolveModelFile(llm.embedModelName, { directory: llm.modelCacheDir, download: false }));
    const before = await modelIdentity(path), prior = verified.get(path);
    if (prior !== undefined && prior.identity !== before) fail("verified model file changed before load");
    if (prior === undefined) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      const after = await modelIdentity(path), digest = hash.digest("hex");
      if (digest !== SEMANTIC_MODEL_SHA256 || before !== after) fail("model bytes mismatch");
      verified.set(path, { digest, identity: before });
    }
    await llm.ensureLlama(false); // installed native binary only; never compile or download
    const loaded = await llm.ensureEmbedModel();
    if (typeof loaded._modelPath !== "string" || await realpath(loaded._modelPath) !== path
      || await modelIdentity(path) !== before) fail("loaded model identity mismatch");
  };
  const started = performance.now();
  try { await verify(llmModule.getDefaultLlamaCpp()); }
  catch (error) { await llmModule.disposeDefaultLlamaCpp(); throw error; }
  const backend = new OhQmdSemanticBackendV1({ cacheDirectory: resolve(cacheDirectory), storeFactory: async options => {
    const store = await qmd.createStore(options);
    try { await verify(store.internal.llm); return store; }
    catch (error) { await store.close(); throw error; }
  } });
  let disposed = false;
  return Object.freeze({
    backend: { profile: backend.profile, index: records => backend.index(records),
      search: (query, limit, authority) => backend.search(query, limit, authority),
      async close() {
        if (disposed) return;
        disposed = true;
        try { await backend.close(); } finally { await llmModule.disposeDefaultLlamaCpp(); }
      } } satisfies OhSemanticSearchBackendV1,
    runtime: { ...SEMANTIC_RUNTIME, search: "shipped-oh-qmd-searchVector-global-query-v1", modelSha256: SEMANTIC_MODEL_SHA256,
      semanticProfileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1), queryPath: "unchanged QMD searchVector/global query LLM",
      qmdForceCpu: process.env.QMD_FORCE_CPU ?? null, qmdLlamaGpu: process.env.QMD_LLAMA_GPU ?? null,
      nativeStartupMs: performance.now() - started },
  });
}

async function preflight(): Promise<void> {
  const personId = "11ccc069-2a93-4e9d-af03-cdacb0b8d568", projection = await readCloneMemPersona(personId);
  const base = join(ROOT, ".cache/benchmarks"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "clonemem-preflight-"));
  const native = await createCloneMemLocalBackend(join(directory, "index"));
  let prepared: Awaited<ReturnType<typeof prepareCloneMemRetrieval>> | undefined;
  try {
    prepared = await prepareCloneMemRetrieval(projection.memory, native.backend);
    const rows = [];
    const queries = [...projection.queries].sort((left, right) => cloneMemTimestamp(left.questionDate) - cloneMemTimestamp(right.questionDate)
      || left.id.localeCompare(right.id));
    for (const query of queries) {
      rows.push({ questionId: query.id, result: await prepared.retrieve(query.question, query.questionDate) });
      if (rows.length % 8 === 0) console.log(JSON.stringify({ status: "preflight", completed: rows.length, total: projection.queries.length }));
    }
    const payload = { protocol: "oh.clonemem-native-preflight.v1", scored: false, personId,
      sourceSha256: projection.sourceSha256, retrievalSha256: projection.retrievalSha256,
      policy: CLONEMEM_RETRIEVAL_POLICY, runtime: native.runtime, identity: prepared.identity,
      preparationMs: prepared.preparationMs, rows };
    await writeNew(join(directory, "result.json"), canonicalJson({ ...payload, resultSha256: canonicalSha256(payload) }) + "\n");
    console.log(JSON.stringify({ path: join(directory, "result.json"), scored: false, questions: rows.length,
      preparationMs: prepared.preparationMs, nativeStartupMs: native.runtime.nativeStartupMs,
      meanHybridWallMs: rows.reduce((sum, row) => sum + row.result.timing.hybridWallMs, 0) / rows.length }));
  } finally { if (prepared) await prepared.close(); else await native.backend.close(); }
}
/** Pin runtime code separately from disjoint reader/provider work. */
export async function cloneMemMechanismManifest() {
  const files: { label: string; path: string }[] = [];
  const addTree = async (directory: string, label: string, accept = (_name: string) => true): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name), nextLabel = `${label}/${entry.name}`;
      if (entry.isDirectory()) await addTree(path, nextLabel, accept);
      else if (entry.isFile() && accept(entry.name)) files.push({ label: nextLabel, path });
      else if (entry.isSymbolicLink()) fail("unexpected symlink in frozen runtime tree");
      if (files.length > 8_000) fail("mechanism file count bound");
    }
  };
  await addTree(join(ROOT, "src"), "src", name => name.endsWith(".ts") || name.endsWith(".json"));
  // model.ts/consistency-rules.ts imports from these files are type-only.
  for (const path of ["scripts/benchmarks/clonemem-retrieval.ts", "scripts/benchmarks/clonemem-dataset.ts",
    "scripts/benchmarks/deductive-semantic-cache.ts", "scripts/benchmarks/io.ts", "scripts/benchmarks/datasets.ts",
    "benchmarks/profiles/clonemem-source-v1.json", "package.json", "bun.lock"]) files.push({ label: path, path: join(ROOT, path) });
  const qmd = await realpath(join(ROOT, ".cache/qmd-env/node_modules/@tobilu/qmd"));
  const require = createRequire(join(qmd, "package.json"));
  const packages = [{ label: "@tobilu/qmd", directory: qmd },
    { label: "node-llama-cpp", directory: dirname(require.resolve("node-llama-cpp/package.json")) },
    { label: "sqlite-vec", directory: dirname(require.resolve("sqlite-vec/package.json")) }];
  for (const item of packages) {
    files.push({ label: `native/${item.label}/package.json`, path: join(item.directory, "package.json") });
    if (item.label === "sqlite-vec") {
      for (const name of ["index.cjs", "index.mjs"]) files.push({ label: `native/${item.label}/${name}`, path: join(item.directory, name) });
    } else await addTree(join(item.directory, "dist"), `native/${item.label}/dist`);
  }
  // Pin installed native artifacts without loading or installing them.
  const modules = dirname(dirname(qmd));
  for (const name of ["sqlite-vec-darwin-arm64", "sqlite-vec-darwin-x64", "@node-llama-cpp"]) {
    const path = join(modules, name);
    try { await stat(path); await addTree(path, `native/${name}`); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
  const pins = []; let total = 0;
  for (const file of files.sort((a, b) => a.label.localeCompare(b.label))) {
    const before = await stat(file.path); total += before.size;
    if (!before.isFile() || total > 1024 * 1024 * 1024) fail("mechanism file byte bound");
    const hash = createHash("sha256"); for await (const chunk of createReadStream(file.path)) hash.update(chunk);
    const after = await stat(file.path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || before.ino !== after.ino || before.dev !== after.dev) fail("mechanism changed while hashing");
    pins.push({ path: file.label, bytes: before.size, sha256: hash.digest("hex") });
  }
  return freeze({ protocol: "oh.clonemem-mechanism.v1", files: pins, mechanismSha256: canonicalSha256(pins) });
}

/** No scorer is invoked by capture; later evaluation consumes sealed contexts. */
async function capturePrimary(): Promise<void> {
  const base = join(ROOT, ".cache/benchmarks"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "clonemem-capture-")), source = await cloneMemMechanismManifest();
  const started = performance.now(), personas = [];
  let totalQueries = 0, totalBytes = 0, stopped = false;
  const stop = () => { stopped = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const timeout = setTimeout(stop, CLONEMEM_CAPTURE_LIMITS.timeoutMs);
  await writeNew(join(directory, "source.json"), canonicalJson({ source, policy: CLONEMEM_RETRIEVAL_POLICY,
    limits: CLONEMEM_CAPTURE_LIMITS, sourceRevision: CLONEMEM_SOURCE.revision,
    primaryPersonIds: CLONEMEM_PRIMARY_PERSON_IDS }) + "\n");
  console.log(JSON.stringify({ status: "capture-start", directory, personas: CLONEMEM_PRIMARY_PERSON_IDS.length,
    expectedQuestions: CLONEMEM_CAPTURE_LIMITS.questions, mechanismSha256: source.mechanismSha256 }));
  try {
    if (CLONEMEM_PRIMARY_PERSON_IDS.length !== CLONEMEM_CAPTURE_LIMITS.personas) fail("primary persona count changed");
    for (const personId of CLONEMEM_PRIMARY_PERSON_IDS) {
      if (stopped) fail("capture cancelled or timed out");
      const projection = await readCloneMemPersona(personId);
      const native = await createCloneMemLocalBackend(join(directory, "indexes", personId));
      let prepared: Awaited<ReturnType<typeof prepareCloneMemRetrieval>> | undefined;
      try {
        prepared = await prepareCloneMemRetrieval(projection.memory, native.backend);
        const rows = [], queries = [...projection.queries].sort((left, right) => cloneMemTimestamp(left.questionDate) - cloneMemTimestamp(right.questionDate)
          || left.id.localeCompare(right.id));
        for (const query of queries) {
          if (stopped) fail("capture cancelled or timed out");
          const row = { questionId: query.id, result: await prepared.retrieve(query.question, query.questionDate) };
          totalBytes += Buffer.byteLength(canonicalJson(row)); rows.push(row); totalQueries++;
          if (totalBytes > CLONEMEM_CAPTURE_LIMITS.totalBytes || totalQueries > CLONEMEM_CAPTURE_LIMITS.questions) fail("capture output bound");
          if (rows.length % 16 === 0) console.log(JSON.stringify({ status: "capture", personId, completed: rows.length,
            total: queries.length, overallCompleted: totalQueries, elapsedMs: performance.now() - started }));
        }
        const payload = { protocol: "oh.clonemem-persona-capture.v1", scored: false, personId,
          sourceSha256: projection.sourceSha256, retrievalSha256: projection.retrievalSha256,
          mechanismSha256: source.mechanismSha256, policySha256: canonicalSha256(CLONEMEM_RETRIEVAL_POLICY),
          runtime: native.runtime, identity: prepared.identity, preparationMs: prepared.preparationMs, rows };
        const resultSha256 = canonicalSha256(payload), encoded = canonicalJson({ ...payload, resultSha256 }) + "\n";
        if (Buffer.byteLength(encoded) > CLONEMEM_CAPTURE_LIMITS.personaBytes) fail("persona artifact byte bound");
        const path = join(directory, `${personId}.json`); await writeNew(path, encoded);
        personas.push({ personId, path: relative(directory, path), bytes: Buffer.byteLength(encoded), sha256: sha256Hex(encoded),
          resultSha256, questions: rows.length, traces: projection.memory.traces.length, sourceSha256: projection.sourceSha256 });
      } finally { if (prepared) await prepared.close(); else await native.backend.close(); }
      console.log(JSON.stringify({ status: "persona-complete", personId, overallCompleted: totalQueries }));
    }
    if (stopped || totalQueries !== CLONEMEM_CAPTURE_LIMITS.questions) fail("incomplete or cancelled capture");
    const finalSource = await cloneMemMechanismManifest();
    if (canonicalJson(finalSource) !== canonicalJson(source)) fail("frozen mechanism changed during capture");
    const payload = { protocol: "oh.clonemem-primary-capture.v1", scored: false,
      sourceRevision: CLONEMEM_SOURCE.revision, source, policy: CLONEMEM_RETRIEVAL_POLICY,
      policySha256: canonicalSha256(CLONEMEM_RETRIEVAL_POLICY), personas, totalQueries, totalBytes,
      elapsedMs: performance.now() - started, complete: true };
    const resultSha256 = canonicalSha256(payload);
    await writeNew(join(directory, "result.json"), canonicalJson({ ...payload, resultSha256 }) + "\n");
    console.log(JSON.stringify({ status: "capture-complete", path: join(directory, "result.json"), resultSha256,
      questions: totalQueries, bytes: totalBytes, elapsedMs: payload.elapsedMs, scored: false }));
  } finally {
    clearTimeout(timeout); process.off("SIGINT", stop); process.off("SIGTERM", stop);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "preflight") await preflight();
  else if (args.length === 1 && args[0] === "capture") await capturePrimary();
  else if (args.length === 1 && args[0] === "--help") console.log("bun run scripts/benchmarks/clonemem-retrieval.ts preflight|capture\nPreflight: smallest primary persona, 324 traces and 32 questions. Capture: all nine primary personas, 1,007 queries, chronological eligible-only indexes, one local model process, 20-minute bound. Cached SHA-pinned model and unchanged shipped Oh hybrid search. Fresh private .cache/benchmarks/clonemem-{preflight,capture}-*/ artifacts; complete capture manifest is result.json with separate persona files. No scoring or provider calls.");
  else fail("use preflight, capture or --help");
}
