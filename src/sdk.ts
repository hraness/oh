import { opaqueId, type JsonValue } from "./canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordKindV1,
  type KnowledgeGraphRecordV1 } from "./graph";
import { renderOhAuthorLogV1, type OhAuthorLogRenderingV1, type OhAuthorLogViewV1 } from "./author-log";
import { recallOhV1, type OhRecallResponseV1, type OhRecallWindowV1 } from "./recall";
import type { OhRerankBackendV1 } from "./rerank-model";
import { searchOhV1, type OhSearchModeV1, type OhSearchResponseV1 } from "./search";
import type { OhSemanticSearchBackend } from "./semantic";
import { OhSqliteStore, type OhHeadV1, type OhReplayVerificationV1 } from "./sqlite/store";
import { synchronizeOhStoreV1, type OhOperationSyncTransportV1, type OhSyncResultV1 } from "./sync";
import type { OhOperationV1 } from "./operation";

export { defaultOhRecallViewV1, OH_RECALL_DATE_GRAMMAR_V1, OH_RECALL_LIMITS_V1, OH_RECALL_RENDERER_V1, recallOhV1,
  renderOhRecallV1, resolveRelativeDatesV1, resolveRelativeDateWindowV1 } from "./recall";
export { defaultOhAuthorLogViewV1, isOhDeclineAnswerV1, OH_AUTHOR_LOG_LIMITS_V1, OH_AUTHOR_LOG_READER_NOTE_V1,
  OH_AUTHOR_LOG_RENDERER_V1, OH_SESSION_ZOOM_READER_NOTE_V1, OH_SESSION_ZOOM_RENDERER_V1, renderOhAuthorLogV1,
  renderOhSessionZoomV1 } from "./author-log";
export type { OhAuthorLogRecordViewV1, OhAuthorLogRenderingV1, OhAuthorLogViewV1,
  OhSessionZoomRenderingV1 } from "./author-log";
export type { OhRecallDateRuleV1, OhRecallDateWindowV1, OhRecallDiagnosticV1, OhRecallEvidenceV1, OhRecallRecordViewV1,
  OhRecallRenderingV1, OhRecallResponseV1, OhRecallResultV1, OhRecallViewV1, OhRecallWindowV1 } from "./recall";

export type OhOpenOptionsV1 = Readonly<{
  databasePath?: string;
  rerankBackend?: OhRerankBackendV1;
  semanticBackend?: OhSemanticSearchBackend;
  spaceId?: string;
}>;

export class Oh {
  readonly store: OhSqliteStore;
  readonly semanticBackend: OhSemanticSearchBackend | undefined;
  readonly rerankBackend: OhRerankBackendV1 | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;
  readonly #pending = new Set<Promise<unknown>>();

  private constructor(store: OhSqliteStore, semanticBackend?: OhSemanticSearchBackend, rerankBackend?: OhRerankBackendV1) {
    this.store = store;
    this.semanticBackend = semanticBackend;
    this.rerankBackend = rerankBackend;
  }

  static open(options: OhOpenOptionsV1 = {}): Oh {
    return new Oh(new OhSqliteStore({ path: options.databasePath ?? ".oh/oh.sqlite",
      ...(options.spaceId === undefined ? {} : { spaceId: options.spaceId }) }),
      options.semanticBackend, options.rerankBackend);
  }

  #assertOpen(): void { if (this.#closed) throw new Error("Oh is closed."); }

  #admit<A>(operation: () => Promise<A>): Promise<A> {
    if (this.#closed) return Promise.reject(new Error("Oh is closed."));
    const pending = Promise.resolve().then(operation);
    this.#pending.add(pending);
    void pending.then(() => { this.#pending.delete(pending); }, () => { this.#pending.delete(pending); });
    return pending;
  }

  head(): OhHeadV1 { this.#assertOpen(); return this.store.head(); }

  put(input: Readonly<{
    actorId?: string;
    dependencies?: readonly string[];
    expectedHead?: Pick<OhHeadV1, "generation" | "operationSha256">;
    instant?: string;
    key: string;
    kind: KnowledgeGraphRecordKindV1;
    operationId?: string;
    value: JsonValue;
  }>): OhOperationV1 {
    this.#assertOpen();
    const record = createKnowledgeGraphRecordV1({ dependencies: [...(input.dependencies ?? [])].sort(),
      key: input.key, kind: input.kind, v: 1, value: input.value });
    const head = this.store.head();
    return this.store.commit({ actorId: input.actorId ?? "agent.local", changes: [{ kind: "put", record, v: 1 }],
      expectedHead: input.expectedHead ?? head, ...(input.instant === undefined ? {} : { instant: input.instant }),
      operationId: input.operationId ?? opaqueId("op_") });
  }

  tombstone(input: Readonly<{
    actorId?: string;
    expectedHead?: Pick<OhHeadV1, "generation" | "operationSha256">;
    instant?: string;
    key: string;
    operationId?: string;
  }>): OhOperationV1 {
    this.#assertOpen();
    const current = this.store.get(input.key);
    if (current === null) throw new Error(`No record exists at ${input.key}.`);
    const head = this.store.head();
    return this.store.commit({ actorId: input.actorId ?? "agent.local",
      changes: [{ key: input.key, kind: "tombstone", priorSha256: current.recordSha256, v: 1 }],
      expectedHead: input.expectedHead ?? head, ...(input.instant === undefined ? {} : { instant: input.instant }),
      operationId: input.operationId ?? opaqueId("op_") });
  }

  get(key: string): KnowledgeGraphRecordV1 | null { this.#assertOpen(); return this.store.get(key); }

  list(options?: Parameters<OhSqliteStore["list"]>[0]): readonly KnowledgeGraphRecordV1[] {
    this.#assertOpen();
    return this.store.list(options);
  }

  async indexSemantic(): Promise<Readonly<{ indexed: number; v: 1 }>> {
    return await this.#admit(async () => {
      if (this.semanticBackend === undefined) throw new Error("No local semantic backend is configured.");
      return await this.semanticBackend.index(this.store.snapshotRecords());
    });
  }

  async search(query: string, options: Readonly<{ limit?: number; mode?: OhSearchModeV1;
    rerankPoolSize?: number }> = {}): Promise<OhSearchResponseV1> {
    return await this.#admit(() => searchOhV1({ ...(this.semanticBackend === undefined ? {} : { backend: this.semanticBackend }),
      ...(this.rerankBackend === undefined ? {} : { reranker: this.rerankBackend }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.rerankPoolSize === undefined ? {} : { rerankPoolSize: options.rerankPoolSize }),
      query, store: this.store }));
  }

  /** Fused recall over bounded V1 searches; `asOf` defaults to no question instant. */
  async recall(queries: string | readonly string[], options: Readonly<{ asOf?: string | null; limit?: number;
    mode?: OhSearchModeV1; rerankPoolSize?: number; window?: OhRecallWindowV1 | null }> = {}): Promise<OhRecallResponseV1> {
    return await this.#admit(() => recallOhV1({ ...(this.semanticBackend === undefined ? {} : { backend: this.semanticBackend }),
      ...(this.rerankBackend === undefined ? {} : { reranker: this.rerankBackend }),
      asOf: options.asOf ?? null, ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.mode === undefined ? {} : { mode: options.mode }), ...(options.window === undefined ? {} : { window: options.window }),
      ...(options.rerankPoolSize === undefined ? {} : { rerankPoolSize: options.rerankPoolSize }),
      queries: typeof queries === "string" ? [queries] : queries, store: this.store }));
  }

  /**
   * Opt-in author-log memory: the complete log of one author's messages
   * (default `"user"`) beside fused recall of every other record for the
   * question, under a byte budget. Recall uses the question as its one query,
   * 100 results, and hybrid mode when a semantic backend is configured.
   */
  async authorLog(question: string, options: Readonly<{ asOf?: string | null; author?: string; budgetBytes?: number;
    limit?: number; logReserveBytes?: number; mode?: OhSearchModeV1; retrievedBytes?: number;
    view?: OhAuthorLogViewV1 }> = {}): Promise<OhAuthorLogRenderingV1> {
    const recall = await this.recall(question, { asOf: options.asOf ?? null, limit: options.limit ?? 100,
      mode: options.mode ?? (this.semanticBackend === undefined ? "keyword" : "hybrid") });
    return await this.#admit(async () => renderOhAuthorLogV1({ ranked: recall.results, records: this.store.snapshotRecords() }, {
      asOf: options.asOf ?? null, ...(options.author === undefined ? {} : { author: options.author }),
      ...(options.budgetBytes === undefined ? {} : { budgetBytes: options.budgetBytes }),
      ...(options.logReserveBytes === undefined ? {} : { logReserveBytes: options.logReserveBytes }),
      ...(options.retrievedBytes === undefined ? {} : { retrievedBytes: options.retrievedBytes }),
      ...(options.view === undefined ? {} : { view: options.view }) }));
  }

  async sync(transport: OhOperationSyncTransportV1, options?: Parameters<typeof synchronizeOhStoreV1>[2]): Promise<OhSyncResultV1> {
    return await this.#admit(() => synchronizeOhStoreV1(this.store, transport, options));
  }

  verify(): OhReplayVerificationV1 { this.#assertOpen(); return this.store.verifyReplay(); }

  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = (async () => {
      await Promise.allSettled([...this.#pending]);
      const failures: unknown[] = [];
      try { await this.semanticBackend?.close(); } catch (error) { failures.push(error); }
      try { await this.rerankBackend?.close(); } catch (error) { failures.push(error); }
      try { this.store.close(); } catch (error) { failures.push(error); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Oh resource release failed.");
    })();
    return this.#closing;
  }
}
