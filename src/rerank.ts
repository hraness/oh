import { createRequire } from "node:module";
import { join } from "node:path";

import {
  OH_RERANK_LIMITS_V1,
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

type QmdLlamaContext = Readonly<{ _llamaContext: { contextSize: number } }>;
type QmdLlamaCpp = Readonly<{
  ensureLlama(allowBuild: boolean): Promise<unknown>;
  ensureRerankContexts(): Promise<readonly QmdLlamaContext[]>;
  rerank(query: string, documents: readonly { file: string; text: string }[]): Promise<unknown>;
  dispose(): Promise<void>;
}>;

/** Optional local Qwen3 rerank backend through the pinned @tobilu/qmd peer.
 * The model path must already exist locally; this boundary never downloads.
 * Operations are serial and the backend must be closed to release the model. */
export class OhQmdRerankBackendV1 implements OhRerankBackendV1 {
  readonly profile = OH_RERANK_PROFILE_V1;
  readonly #options: Readonly<{ modelPath: string; modelCacheDir?: string }>;
  #engine: QmdLlamaCpp | undefined;
  #closed = false;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(options: Readonly<{ modelPath: string; modelCacheDir?: string }>) {
    if (typeof options.modelPath !== "string" || options.modelPath.length === 0 || options.modelPath.length > 4_096
      || options.modelPath.includes("\0")) throw new TypeError("The rerank model path must be a bounded local path.");
    if (options.modelCacheDir !== undefined && (typeof options.modelCacheDir !== "string"
      || options.modelCacheDir.length === 0 || options.modelCacheDir.length > 4_096
      || options.modelCacheDir.includes("\0"))) throw new TypeError("The rerank model cache directory must be a bounded local path.");
    this.#options = options;
  }

  async #load(): Promise<QmdLlamaCpp> {
    if (this.#engine !== undefined) return this.#engine;
    let module: unknown;
    try {
      const require = createRequire(import.meta.url);
      const packageJson = require.resolve("@tobilu/qmd/package.json");
      module = await import(join(packageJson, "..", "dist", "llm.js"));
    } catch {
      throw new Error("Reranking needs the optional @tobilu/qmd@2.5.3 package.");
    }
    const LlamaCpp = (module as { LlamaCpp?: unknown }).LlamaCpp;
    if (typeof LlamaCpp !== "function") throw new Error("The installed QMD package has no compatible LlamaCpp export.");
    const engine = new (LlamaCpp as new (options: unknown) => QmdLlamaCpp)({
      inactivityTimeoutMs: 0,
      modelCacheDir: this.#options.modelCacheDir,
      rerankModel: this.#options.modelPath,
    }) as QmdLlamaCpp;
    await engine.ensureLlama(false);
    const contexts = await engine.ensureRerankContexts();
    if (contexts.length < 1 || contexts[0]!._llamaContext.contextSize !== OH_RERANK_PROFILE_V1.contextSize) {
      await engine.dispose().catch(() => {});
      throw new Error(`The rerank engine context size is not ${OH_RERANK_PROFILE_V1.contextSize}.`);
    }
    this.#engine = engine;
    return engine;
  }

  rerank(query: string, documents: readonly OhRerankDocumentV1[]): Promise<readonly OhRerankResultV1[]> {
    if (this.#closed) return Promise.reject(new Error("The rerank backend is closed."));
    const parsedQuery = parseOhRerankQueryV1(query);
    const parsedDocuments = parseOhRerankDocumentsV1(documents);
    if (parsedDocuments.length === 0) return Promise.resolve([]);
    const operation = this.#pending.then(async () => {
      const engine = await this.#load();
      const raw = await engine.rerank(parsedQuery,
        parsedDocuments.map((document) => ({ file: document.key, text: document.text })));
      const results = (raw as { results?: unknown }).results;
      if (!Array.isArray(results)) throw new Error("The rerank engine returned an invalid result envelope.");
      const keys = new Set(parsedDocuments.map((document) => document.key));
      const scored = results.map((value) => {
        if (value === null || typeof value !== "object") throw new TypeError("The rerank engine returned an invalid score row.");
        const row = value as Readonly<Record<string, unknown>>;
        const key = typeof row.file === "string" ? row.file : typeof row.key === "string" ? row.key : undefined;
        const score = typeof row.score === "number" ? row.score : Number.NaN;
        return { key, score, v: 1 } as { key: string | undefined; score: number; v: 1 };
      });
      const parsed = parseOhRerankResultsV1(
        scored.map((row) => ({ key: row.key ?? "", score: row.score, v: 1 })), keys);
      return [...parsed].sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
    });
    this.#pending = operation.catch(() => {});
    return operation;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pending.catch(() => {});
    if (this.#engine !== undefined) await this.#engine.dispose();
  }
}
