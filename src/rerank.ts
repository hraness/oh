import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hasExactKeys, isPlainRecord } from "./canonical";
import {
  OH_RERANK_PROFILE_V1,
  parseOhRerankDocumentsV1,
  parseOhRerankQueryV1,
  parseOhRerankResultsV1,
  type OhRerankBackendV1,
  type OhRerankDocumentV1,
  type OhRerankResultV1,
} from "./rerank-model";

export {
  OH_RERANK_LIMITS_V1,
  OH_RERANK_PROFILE_V1,
  OH_RERANK_STOPWORDS_V1,
  normalizeOhRerankLexicalQueryV1,
} from "./rerank-model";
export type {
  OhRerankBackendV1,
  OhRerankDocumentV1,
  OhRerankResultV1,
} from "./rerank-model";

type QmdModel = Readonly<{ _modelPath: string; tokenize(text: string): readonly unknown[] }>;
type QmdLlamaContext = Readonly<{
  _llamaContext: { contextSize: number };
  _getEvaluationInput(query: string, document: string): readonly unknown[];
}>;
type QmdLlamaCpp = Readonly<{
  rerankModelName: string;
  ensureLlama(allowBuild: boolean): Promise<unknown>;
  ensureRerankModel(): Promise<QmdModel>;
  ensureRerankContexts(): Promise<readonly QmdLlamaContext[]>;
  rerank(query: string, documents: readonly { file: string; text: string }[]): Promise<unknown>;
  dispose(): Promise<void>;
}>;
type Ready = Readonly<{ engine: QmdLlamaCpp; model: QmdModel; contexts: readonly QmdLlamaContext[]; modelPath: string }>;
const TEMPLATE_OVERHEAD = 512;
const MAXIMUM_MODEL_BYTES = 1_073_741_824;
const qmdModuleSpecifier: string = "@tobilu/qmd";

function localPath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > 4_096
    || value.includes("\0") || /\p{Surrogate}/u.test(value)
    || (!isAbsolute(value) && /^[a-z][a-z\d+.-]*:/iu.test(value))) {
    throw new TypeError("The rerank " + label + " must be a bounded local path.");
  }
  return resolve(value);
}

function fileIdentity(value: Readonly<{ dev: number | bigint; ino: number | bigint; size: number | bigint;
  mtimeMs: number | bigint; ctimeMs: number | bigint }>): string {
  return [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(":");
}

/** Hash the already-local model through a bounded read, then retain its identity across native acquisition. */
async function verifyModel(path: string): Promise<Readonly<{ path: string; identity: string }>> {
  const actual = await realpath(path), target = await stat(actual);
  if (!target.isFile() || target.size < 1 || target.size > MAXIMUM_MODEL_BYTES) {
    throw new Error("The rerank model must be a regular local file of at most 1 GiB.");
  }
  const file = await open(actual, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAXIMUM_MODEL_BYTES) {
      throw new Error("The rerank model must be a regular local file of at most 1 GiB.");
    }
    const hash = createHash("sha256"), buffer = Buffer.alloc(65_536);
    let bytes = 0;
    while (bytes <= before.size) {
      const count = (await file.read(buffer, 0, Math.min(buffer.length, before.size - bytes + 1), bytes)).bytesRead;
      if (count === 0) break;
      bytes += count;
      if (bytes > before.size) throw new Error("The rerank model changed during verification.");
      hash.update(buffer.subarray(0, count));
    }
    const identity = fileIdentity(before);
    if (bytes !== before.size || hash.digest("hex") !== OH_RERANK_PROFILE_V1.modelSha256) {
      throw new Error("The local rerank model does not match the pinned SHA-256.");
    }
    if (identity !== fileIdentity(await file.stat()) || identity !== fileIdentity(await stat(actual))) {
      throw new Error("The rerank model changed during verification.");
    }
    return { path: actual, identity };
  } finally { await file.close(); }
}

async function qmdConstructor(): Promise<new (options: unknown) => QmdLlamaCpp> {
  let packagePath: string;
  try {
    // QMD 2.5.3 exports only its import entry, not package.json or the native module.
    packagePath = join(dirname(fileURLToPath(import.meta.resolve(qmdModuleSpecifier))), "..", "package.json");
  } catch { throw new Error("Reranking needs the optional @tobilu/qmd@2.5.3 package."); }
  const file = await open(packagePath, "r");
  let metadata: unknown;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65_536) throw new Error("The QMD package metadata exceeds its byte bound.");
    const buffer = Buffer.alloc(65_537);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = (await file.read(buffer, bytes, buffer.length - bytes, bytes)).bytesRead;
      if (count === 0) break;
      bytes += count;
    }
    if (bytes > 65_536) throw new Error("The QMD package metadata exceeds its byte bound.");
    metadata = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
  } finally { await file.close(); }
  if (!isPlainRecord(metadata) || metadata.name !== "@tobilu/qmd" || metadata.version !== "2.5.3") {
    throw new Error("Reranking requires exactly @tobilu/qmd@2.5.3.");
  }
  const module: unknown = await import(pathToFileURL(join(dirname(packagePath), "dist", "llm.js")).href);
  const LlamaCpp = (module as { LlamaCpp?: unknown }).LlamaCpp;
  if (typeof LlamaCpp !== "function") throw new Error("The installed QMD package has no compatible LlamaCpp export.");
  const profile = LlamaCpp as unknown as { RERANK_CONTEXT_SIZE: unknown; RERANK_TEMPLATE_OVERHEAD: unknown };
  if (profile.RERANK_CONTEXT_SIZE !== OH_RERANK_PROFILE_V1.contextSize || profile.RERANK_TEMPLATE_OVERHEAD !== TEMPLATE_OVERHEAD) {
    throw new Error("The QMD rerank context or template budget differs from the pinned profile.");
  }
  return LlamaCpp as new (options: unknown) => QmdLlamaCpp;
}

function tokenCount(tokens: unknown): number {
  if (!Array.isArray(tokens)) throw new Error("The rerank engine returned invalid tokenizer output.");
  return tokens.length;
}

/** Optional local Qwen3 rerank backend through the pinned @tobilu/qmd peer.
 * The model must already exist locally and match the pinned digest. Complete
 * query/document pairs must fit the model's context; no text is truncated.
 * Operations are serial. Closing drains admitted work and shares its outcome. */
export class OhQmdRerankBackendV1 implements OhRerankBackendV1 {
  readonly profile = OH_RERANK_PROFILE_V1;
  readonly #options: Readonly<{ modelPath: string; modelCacheDir?: string }>;
  #engine: QmdLlamaCpp | undefined;
  #loading: Promise<Ready> | undefined;
  #release: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  #closed = false;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(options: Readonly<{ modelPath: string; modelCacheDir?: string }>) {
    this.#options = { modelPath: localPath(options.modelPath, "model path"),
      ...(options.modelCacheDir === undefined ? {} : { modelCacheDir: localPath(options.modelCacheDir, "model cache directory") }) };
  }

  #dispose(): Promise<void> {
    return this.#release ??= Promise.resolve().then(async () => { await this.#engine?.dispose(); });
  }

  async #initialize(): Promise<Ready> {
    const verified = await verifyModel(this.#options.modelPath);
    const LlamaCpp = await qmdConstructor();
    const engine = new LlamaCpp({ inactivityTimeoutMs: 0,
      modelCacheDir: this.#options.modelCacheDir ?? dirname(verified.path), rerankModel: verified.path });
    this.#engine = engine;
    try {
      if (engine.rerankModelName !== verified.path) throw new Error("The rerank engine changed the local model path.");
      await engine.ensureLlama(false);
      const model = await engine.ensureRerankModel();
      const contexts = await engine.ensureRerankContexts();
      if (await realpath(model._modelPath) !== verified.path || fileIdentity(await stat(verified.path)) !== verified.identity) {
        throw new Error("The loaded rerank model differs from the verified local file.");
      }
      if (typeof model.tokenize !== "function" || !Array.isArray(contexts) || contexts.length < 1 || contexts.length > 4
        || contexts.some((context) => context?._llamaContext?.contextSize !== OH_RERANK_PROFILE_V1.contextSize
          || typeof context?._getEvaluationInput !== "function")) {
        throw new Error("The rerank engine needs compatible 4096-token contexts.");
      }
      return { engine, model, contexts, modelPath: verified.path };
    } catch (error) {
      await this.#dispose();
      throw error;
    }
  }

  rerank(query: string, documents: readonly OhRerankDocumentV1[]): Promise<readonly OhRerankResultV1[]> {
    if (this.#closed) return Promise.reject(new Error("The rerank backend is closed."));
    let parsedQuery: string, parsedDocuments: readonly OhRerankDocumentV1[];
    try { parsedQuery = parseOhRerankQueryV1(query); parsedDocuments = parseOhRerankDocumentsV1(documents); }
    catch (error) { return Promise.reject(error); }
    if (parsedDocuments.length === 0) return Promise.resolve([]);
    const operation = this.#pending.then(async () => {
      const { engine, model, contexts, modelPath } = await (this.#loading ??= this.#initialize());
      const queryTokens = tokenCount(model.tokenize(parsedQuery));
      const documentBudget = OH_RERANK_PROFILE_V1.contextSize - TEMPLATE_OVERHEAD - queryTokens;
      if (documentBudget < 0) throw new RangeError("The complete rerank query exceeds the 4096-token context; truncation is disabled.");
      // Admit every candidate before the first scoring call, including QMD's
      // truncation budget and the actual full template used by every context.
      for (const document of parsedDocuments) {
        if (tokenCount(model.tokenize(document.text)) > documentBudget
          || contexts.some((context) => tokenCount(context._getEvaluationInput(parsedQuery, document.text)) >= OH_RERANK_PROFILE_V1.contextSize)) {
          throw new RangeError("A complete rerank query/document pair exceeds the 4096-token context; truncation is disabled.");
        }
      }
      const raw = await engine.rerank(parsedQuery, parsedDocuments.map((document) => ({ file: document.key, text: document.text })));
      if (!isPlainRecord(raw) || !hasExactKeys(raw, ["results", "model"]) || raw.model !== modelPath
        || !Array.isArray(raw.results) || raw.results.length !== parsedDocuments.length) {
        throw new Error("The rerank engine returned an invalid result envelope.");
      }
      const scored: OhRerankResultV1[] = [];
      for (const row of raw.results) {
        if (!isPlainRecord(row) || !hasExactKeys(row, ["file", "index", "score"]) || typeof row.file !== "string"
          || !Number.isSafeInteger(row.index) || parsedDocuments[row.index as number]?.key !== row.file
          || typeof row.score !== "number" || !Number.isFinite(row.score) || row.score < 0 || row.score > 1) {
          throw new TypeError("The rerank engine returned an invalid score row.");
        }
        scored.push({ key: row.file, score: row.score, v: 1 });
      }
      const parsed = parseOhRerankResultsV1(scored, new Set(parsedDocuments.map((document) => document.key)));
      return [...parsed].sort((left, right) => right.score - left.score || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    });
    this.#pending = operation.catch(() => {});
    return operation;
  }

  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = this.#pending.then(() => this.#dispose());
    return this.#closing;
  }
}
