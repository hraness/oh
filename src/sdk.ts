import { opaqueId, type JsonValue } from "./canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordKindV1,
  type KnowledgeGraphRecordV1 } from "./graph";
import { searchOhV1, type OhSearchModeV1, type OhSearchResponseV1 } from "./search";
import type { OhSemanticSearchBackendV1 } from "./semantic";
import { OhSqliteStore, type OhHeadV1, type OhReplayVerificationV1 } from "./sqlite/store";
import { synchronizeOhStoreV1, type OhOperationSyncTransportV1, type OhSyncResultV1 } from "./sync";
import type { OhOperationV1 } from "./operation";

export type OhOpenOptionsV1 = Readonly<{
  databasePath?: string;
  semanticBackend?: OhSemanticSearchBackendV1;
  spaceId?: string;
}>;

export class Oh {
  readonly store: OhSqliteStore;
  readonly semanticBackend: OhSemanticSearchBackendV1 | undefined;
  #closed = false;

  private constructor(store: OhSqliteStore, semanticBackend?: OhSemanticSearchBackendV1) {
    this.store = store;
    this.semanticBackend = semanticBackend;
  }

  static open(options: OhOpenOptionsV1 = {}): Oh {
    return new Oh(new OhSqliteStore({ path: options.databasePath ?? ".oh/oh.sqlite",
      ...(options.spaceId === undefined ? {} : { spaceId: options.spaceId }) }),
      options.semanticBackend);
  }

  head(): OhHeadV1 { return this.store.head(); }

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
    const current = this.store.get(input.key);
    if (current === null) throw new Error(`No record exists at ${input.key}.`);
    const head = this.store.head();
    return this.store.commit({ actorId: input.actorId ?? "agent.local",
      changes: [{ key: input.key, kind: "tombstone", priorSha256: current.recordSha256, v: 1 }],
      expectedHead: input.expectedHead ?? head, ...(input.instant === undefined ? {} : { instant: input.instant }),
      operationId: input.operationId ?? opaqueId("op_") });
  }

  get(key: string): KnowledgeGraphRecordV1 | null { return this.store.get(key); }

  list(options?: Parameters<OhSqliteStore["list"]>[0]): readonly KnowledgeGraphRecordV1[] {
    return this.store.list(options);
  }

  async indexSemantic(): Promise<Readonly<{ indexed: number; v: 1 }>> {
    if (this.semanticBackend === undefined) throw new Error("No local semantic backend is configured.");
    return await this.semanticBackend.index(this.store.snapshotRecords());
  }

  async search(query: string, options: Readonly<{ limit?: number; mode?: OhSearchModeV1 }> = {}): Promise<OhSearchResponseV1> {
    return await searchOhV1({ ...(this.semanticBackend === undefined ? {} : { backend: this.semanticBackend }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.mode === undefined ? {} : { mode: options.mode }), query, store: this.store });
  }

  async sync(transport: OhOperationSyncTransportV1, options?: Parameters<typeof synchronizeOhStoreV1>[2]): Promise<OhSyncResultV1> {
    return await synchronizeOhStoreV1(this.store, transport, options);
  }

  verify(): OhReplayVerificationV1 { return this.store.verifyReplay(); }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try { await this.semanticBackend?.close(); } finally { this.store.close(); }
  }
}
