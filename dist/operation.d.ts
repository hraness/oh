import { type Sha256Hex } from "./canonical";
import { OH_CONTRACT_ID_V1 } from "./ontology";
import { type KnowledgeGraphChangeV1 } from "./graph";
export { graphRevisionSha256V1 } from "./graph";
export declare const OH_OPERATION_MAX_BYTES_V1: number;
export type OhOperationPayloadV1 = Readonly<{
    actorId: string;
    changes: readonly KnowledgeGraphChangeV1[];
    contractId: typeof OH_CONTRACT_ID_V1;
    graphRevisionSha256: Sha256Hex;
    instant: string;
    operationId: string;
    parentOperationSha256: Sha256Hex | null;
    recordsSha256: Sha256Hex;
    sequence: number;
    spaceId: string;
    v: 1;
}>;
export type OhOperationV1 = OhOperationPayloadV1 & Readonly<{
    operationSha256: Sha256Hex;
}>;
export declare function createOhOperationV1(input: OhOperationPayloadV1): OhOperationV1;
export declare function parseOhOperationV1(value: unknown): OhOperationV1 | null;
//# sourceMappingURL=operation.d.ts.map