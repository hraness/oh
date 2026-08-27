import { type JsonValue } from "./canonical";
import { type KnowledgeGraphRecordKindV1, type KnowledgeGraphRecordV1 } from "./graph";
import { type OhSearchModeV1, type OhSearchResponseV1 } from "./search";
import type { OhSemanticSearchBackendV1 } from "./semantic";
import { OhSqliteStore, type OhHeadV1, type OhReplayVerificationV1 } from "./sqlite/store";
import { synchronizeOhStoreV1, type OhOperationSyncTransportV1, type OhSyncResultV1 } from "./sync";
import type { OhOperationV1 } from "./operation";
export type OhOpenOptionsV1 = Readonly<{
    databasePath?: string;
    semanticBackend?: OhSemanticSearchBackendV1;
    spaceId?: string;
}>;
export declare class Oh {
    #private;
    readonly store: OhSqliteStore;
    readonly semanticBackend: OhSemanticSearchBackendV1 | undefined;
    private constructor();
    static open(options?: OhOpenOptionsV1): Oh;
    head(): OhHeadV1;
    put(input: Readonly<{
        actorId?: string;
        dependencies?: readonly string[];
        expectedHead?: Pick<OhHeadV1, "generation" | "operationSha256">;
        instant?: string;
        key: string;
        kind: KnowledgeGraphRecordKindV1;
        operationId?: string;
        value: JsonValue;
    }>): OhOperationV1;
    tombstone(input: Readonly<{
        actorId?: string;
        expectedHead?: Pick<OhHeadV1, "generation" | "operationSha256">;
        instant?: string;
        key: string;
        operationId?: string;
    }>): OhOperationV1;
    get(key: string): KnowledgeGraphRecordV1 | null;
    list(options?: Parameters<OhSqliteStore["list"]>[0]): readonly KnowledgeGraphRecordV1[];
    indexSemantic(): Promise<Readonly<{
        indexed: number;
        v: 1;
    }>>;
    search(query: string, options?: Readonly<{
        limit?: number;
        mode?: OhSearchModeV1;
    }>): Promise<OhSearchResponseV1>;
    sync(transport: OhOperationSyncTransportV1, options?: Parameters<typeof synchronizeOhStoreV1>[2]): Promise<OhSyncResultV1>;
    verify(): OhReplayVerificationV1;
    close(): Promise<void>;
}
//# sourceMappingURL=sdk.d.ts.map