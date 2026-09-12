import { type JsonValue } from "./canonical";
import { type KnowledgeGraphRecordKindV1, type KnowledgeGraphRecordV1 } from "./graph";
import { type OhRecallResponseV1, type OhRecallWindowV1 } from "./recall";
import { type OhSearchModeV1, type OhSearchResponseV1 } from "./search";
import type { OhSemanticSearchBackend } from "./semantic";
import { OhSqliteStore, type OhHeadV1, type OhReplayVerificationV1 } from "./sqlite/store";
import { synchronizeOhStoreV1, type OhOperationSyncTransportV1, type OhSyncResultV1 } from "./sync";
import type { OhOperationV1 } from "./operation";
export { defaultOhRecallViewV1, OH_RECALL_DATE_GRAMMAR_V1, OH_RECALL_LIMITS_V1, OH_RECALL_RENDERER_V1, recallOhV1, renderOhRecallV1, resolveRelativeDateWindowV1 } from "./recall";
export type { OhRecallDateRuleV1, OhRecallDateWindowV1, OhRecallDiagnosticV1, OhRecallEvidenceV1, OhRecallRecordViewV1, OhRecallRenderingV1, OhRecallResponseV1, OhRecallResultV1, OhRecallViewV1, OhRecallWindowV1 } from "./recall";
export type OhOpenOptionsV1 = Readonly<{
    databasePath?: string;
    semanticBackend?: OhSemanticSearchBackend;
    spaceId?: string;
}>;
export declare class Oh {
    #private;
    readonly store: OhSqliteStore;
    readonly semanticBackend: OhSemanticSearchBackend | undefined;
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
    /** Fused recall over bounded V1 searches; `asOf` defaults to no question instant. */
    recall(queries: string | readonly string[], options?: Readonly<{
        asOf?: string | null;
        limit?: number;
        mode?: OhSearchModeV1;
        window?: OhRecallWindowV1 | null;
    }>): Promise<OhRecallResponseV1>;
    sync(transport: OhOperationSyncTransportV1, options?: Parameters<typeof synchronizeOhStoreV1>[2]): Promise<OhSyncResultV1>;
    verify(): OhReplayVerificationV1;
    close(): Promise<void>;
}
//# sourceMappingURL=sdk.d.ts.map