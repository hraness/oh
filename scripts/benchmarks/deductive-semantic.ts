// Declared, content-addressed semantic facts for the deductive benchmark.
// Replay hits do no embedding, QMD import, indexing, or model provisioning.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { canonicalSha256, isPlainRecord } from "../../src/canonical";
import { formatOhEmbeddingQueryV1, OH_EMBEDDING_PROFILE_V1 } from "../../src/semantic-model";
import { ROOT } from "./io";
import type { Corpus } from "./datasets";
import { readSemanticCache, semanticCorpusSha256, semanticFail as fail, semanticRequest,
  semanticResult, writeSemanticCache, SEMANTIC_CACHE_LIMITS, SEMANTIC_MODEL_SHA256, SEMANTIC_RUNTIME,
  type SemanticFacts, type SemanticRank, type SemanticResult } from "./deductive-semantic-cache";
export { SEMANTIC_PRODUCER_ID, SEMANTIC_MODEL_SHA256, SEMANTIC_PROFILE_SHA256,
  SEMANTIC_RUNTIME } from "./deductive-semantic-cache";
export type { SemanticFacts } from "./deductive-semantic-cache";

const SEM_MODEL = OH_EMBEDDING_PROFILE_V1.model;
const DEFAULT_CACHE = join(ROOT, ".cache/benchmarks/sem");
const QMD_SPECIFIER = join(ROOT, ".cache/qmd-env/node_modules/@tobilu/qmd");

interface QmdStoreLike {
  readonly internal: {
    searchVec(query: string, model: string, limit: number, collection: string,
      session: undefined, embedding: readonly number[]): Promise<readonly unknown[]>;
    readonly llm: {
    readonly embedModelName: string;
    ensureEmbedModel(): Promise<{ readonly _modelPath?: unknown }>;
    embed(text: string, options: unknown): Promise<{ readonly embedding: readonly number[] } | null>;
  } };
  update(options: unknown): Promise<unknown>;
  embed(options: unknown): Promise<unknown>;
  close(): Promise<void>;
}
export interface SemanticProducerOptions {
  /** Replay storage; defaults to .cache/benchmarks/sem. */
  readonly cacheRoot?: string;
  readonly cacheMode?: "read-write" | "replay-only" | "off";
  /** Directory of an already installed @tobilu/qmd package; never installs it. */
  readonly qmdModulePath?: string;
  /** Reuse legacy <root>/<corpus.id>/{docs,qmd.sqlite} after exact document checks. */
  readonly qmdCacheRoot?: string;
  /** Optional assertion for the exact GGUF file loaded by QMD. */
  readonly modelPath?: string;
  /** Score floor for a sem-near edge (default 0.30, tuned on dev only). */
  readonly tau?: number;
  /** Maximum sem-near facts per question (default 48). */
  readonly topN?: number;
}
export interface SemanticProducer {
  /** Selects a frozen corpus; runtime initialization is deferred until a miss. */
  prepare(corpus: Corpus): Promise<void>;
  searchAndFacts(question: string, questionDigest: string, rankLimit: number): Promise<SemanticResult>;
  factsFor(question: string, questionDigest: string): Promise<SemanticFacts>;
  vectorRank(question: string, limit: number): Promise<readonly SemanticRank[]>;
  close(): Promise<void>;
}
function document(turn: Corpus["turns"][number]): string {
  return `# ${turn.speaker} — ${turn.date}\n\n${turn.text}\n`;
}
function filename(index: number): string { return `t${String(index).padStart(5, "0")}.md`; }
function checkPackage(path: string, name: string, version: string): void {
  if (statSync(path).size > 64 * 1024) fail("runtime package manifest exceeds byte limit");
  const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isPlainRecord(manifest) || manifest.name !== name || manifest.version !== version) fail(`runtime identity mismatch for ${name}`);
}
async function verifyLoadedModel(store: QmdStoreLike, expectedPath?: string): Promise<void> {
  if (store.internal?.llm?.embedModelName !== SEM_MODEL) fail("loaded model URI differs from profile");
  // QMD's exact pinned runtime owns this object; absence of loaded identity is
  // an error, never grounds for reporting the expected constant as measured.
  const model = await store.internal.llm.ensureEmbedModel();
  if (typeof model._modelPath !== "string") fail("QMD did not expose the loaded model path");
  const path = realpathSync(model._modelPath);
  if (expectedPath !== undefined && path !== realpathSync(expectedPath)) fail("loaded model path mismatch");
  const before = statSync(path);
  if (!before.isFile() || before.size > 1024 * 1024 * 1024) fail("invalid model file size");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024 * 1024) fail("model file byte limit exceeded");
    hash.update(chunk);
  }
  const after = statSync(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino
    || hash.digest("hex") !== SEMANTIC_MODEL_SHA256) fail("loaded model SHA-256 mismatch");
}
export async function createSemanticProducer(options: SemanticProducerOptions = {}): Promise<SemanticProducer> {
  const cacheRoot = options.cacheRoot ?? DEFAULT_CACHE;
  const cacheMode = options.cacheMode ?? "read-write";
  if (!["read-write", "replay-only", "off"].includes(cacheMode)) fail("invalid cache mode");
  const tau = options.tau ?? 0.30;
  const topN = options.topN ?? 48;
  semanticRequest("0".repeat(64), "", "0".repeat(64), tau, topN, 0);
  let corpus: Corpus | null = null;
  let corpusSha256 = "";
  let store: QmdStoreLike | null = null;
  let turnIds: ReadonlySet<string> = new Set();
  let indexOfFile = new Map<string, string>();
  let closed = false;
  let active = false;

  const ensureStore = async (): Promise<QmdStoreLike> => {
    if (store !== null) return store;
    if (cacheMode === "replay-only") fail("replay-only cache miss; QMD initialization is disabled");
    if (corpus === null) fail("prepare() has not run");
    const dir = options.qmdCacheRoot === undefined ? join(cacheRoot, "indexes", corpusSha256)
      : join(resolve(options.qmdCacheRoot), corpus.id);
    if (options.qmdCacheRoot === undefined) {
      const indexes = join(cacheRoot, "indexes");
      if (existsSync(dir)) {
        if (!lstatSync(dir).isDirectory()) fail("invalid QMD index directory");
      } else if (existsSync(indexes) && readdirSync(indexes).length >= SEMANTIC_CACHE_LIMITS.indexes) {
        fail("QMD corpus index count limit exceeded");
      }
    }
    const modulePath = resolve(options.qmdModulePath ?? QMD_SPECIFIER);
    // These reads do not initialize native code or permit automatic installs.
    checkPackage(join(modulePath, "package.json"), "@tobilu/qmd", "2.5.3");
    const require = createRequire(join(modulePath, "package.json"));
    for (const [name, version] of [["node-llama-cpp", SEMANTIC_RUNTIME.nodeLlamaCpp],
      ["sqlite-vec", SEMANTIC_RUNTIME.sqliteVec]] as const) {
      checkPackage(require.resolve(`${name}/package.json`), name, version);
    }
    let createStore: unknown;
    try { createStore = (await import(modulePath)).createStore; }
    catch { fail("@tobilu/qmd is not provisioned; select an installed qmdModulePath"); }
    if (typeof createStore !== "function") fail("installed qmd has no createStore export");
    if (options.qmdCacheRoot !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(corpus.id)) fail("unsafe reused corpus directory");
    const docs = join(dir, "docs");
    if (options.qmdCacheRoot !== undefined) {
      const files = readdirSync(docs);
      if (files.length !== corpus.turns.length || !lstatSync(join(dir, "qmd.sqlite")).isFile()) fail("reused QMD index shape mismatch");
      corpus.turns.forEach((turn, index) => {
        const path = join(docs, filename(index));
        const expected = document(turn);
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size !== Buffer.byteLength(expected)
          || readFileSync(path, "utf8") !== expected) fail("reused QMD corpus content mismatch");
      });
    } else {
      mkdirSync(docs, { recursive: true, mode: 0o700 });
      corpus.turns.forEach((turn, index) => {
        const path = join(docs, filename(index));
        const expected = document(turn);
        try { writeFileSync(path, expected, { mode: 0o600, flag: "wx" }); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const stat = lstatSync(path);
          if (!stat.isFile() || stat.size !== Buffer.byteLength(expected)
            || readFileSync(path, "utf8") !== expected) fail("content-addressed QMD corpus changed");
        }
      });
      if (readdirSync(docs).length !== corpus.turns.length) fail("unexpected document in QMD corpus");
    }
    const opened = await (createStore as (o: unknown) => Promise<QmdStoreLike>)({
      dbPath: join(dir, "qmd.sqlite"), config: { collections: { oh: { path: docs, pattern: "*.md" } },
        models: { embed: SEM_MODEL } } });
    try {
      // Verify actual loaded bytes before asking the runtime to embed anything.
      await verifyLoadedModel(opened, options.modelPath);
      await opened.update({ collections: ["oh"] });
      await opened.embed({ collection: "oh", model: SEM_MODEL });
      store = opened;
      return store;
    } catch (error) { await opened.close(); throw error; }
  };
  const searchAndFacts = async (question: string, questionDigest: string, rankLimit: number): Promise<SemanticResult> => {
    if (closed) fail("producer is closed");
    if (corpus === null) fail("prepare() has not run");
    if (active) fail("concurrent semantic producer operations are not supported");
    active = true;
    try {
      const request = semanticRequest(corpusSha256, question, questionDigest, tau, topN, rankLimit);
      if (cacheMode !== "off") {
        const cached = readSemanticCache(cacheRoot, request, turnIds);
        if (cached !== null) return cached;
      }
      if (cacheMode === "replay-only") fail(`replay-only cache miss for ${canonicalSha256(request)}`);
      const liveStore = await ensureStore();
      const limit = Math.max(topN, rankLimit);
      // QMD 2.5.3 searchVector accidentally uses the global query model. Feed
      // its unchanged vector search the verified per-store query embedding.
      const embedded = await liveStore.internal.llm.embed(formatOhEmbeddingQueryV1(question),
        { model: SEM_MODEL, isQuery: true });
      if (!embedded || !Array.isArray(embedded.embedding)
        || embedded.embedding.length !== OH_EMBEDDING_PROFILE_V1.dimensions
        || !embedded.embedding.every((n) => typeof n === "number" && Number.isFinite(n))) {
        fail("QMD query embedding failed or has invalid dimensions");
      }
      const hits = await liveStore.internal.searchVec(question, SEM_MODEL, limit, "oh", undefined, embedded.embedding);
      if (!Array.isArray(hits) || hits.length > limit) fail("QMD returned too many hits");
      const ranked = hits.map((hit): SemanticRank => {
        if (!isPlainRecord(hit)) fail("QMD returned invalid hit");
        const path = hit.displayPath ?? hit.filepath;
        if (typeof path !== "string") fail("QMD returned invalid path");
        const name = path.split("/").pop() ?? "";
        const turnId = indexOfFile.get(name);
        if ((path !== `oh/${name}` && path !== `qmd://oh/${name}`)
          || turnId === undefined || typeof hit.score !== "number") fail("QMD returned stale turn or invalid score");
        return { turnId, score: hit.score };
      });
      return cacheMode === "off" ? semanticResult(request, ranked, turnIds)
        : writeSemanticCache(cacheRoot, request, ranked, turnIds);
    } finally { active = false; }
  };
  return Object.freeze({
    async prepare(next: Corpus): Promise<void> {
      if (closed) fail("producer is closed");
      if (active) fail("concurrent semantic producer operations are not supported");
      active = true;
      try {
        const digest = semanticCorpusSha256(next);
        if (digest === corpusSha256) return;
        if (store !== null) { await store.close(); store = null; }
        corpus = structuredClone(next);
        corpusSha256 = digest;
        turnIds = new Set(corpus.turns.map((turn) => turn.id));
        indexOfFile = new Map(corpus.turns.map((turn, index) => [filename(index), turn.id]));
      } finally { active = false; }
    },
    searchAndFacts,
    async vectorRank(question: string, limit: number): Promise<readonly SemanticRank[]> {
      return (await searchAndFacts(question, canonicalSha256({ query: question }), limit)).ranked;
    },
    async factsFor(question: string, questionDigest: string): Promise<SemanticFacts> {
      const { ranked: _, ...rest } = await searchAndFacts(question, questionDigest, 0);
      return Object.freeze(rest);
    },
    async close(): Promise<void> {
      if (active) fail("concurrent semantic producer operations are not supported");
      closed = true;
      if (store !== null) { await store.close(); store = null; }
    },
  });
}
