import { type JsonValue, type Sha256Hex } from "./canonical";
import { OH_GRAPH_FORMAT_VERSION_V1, type KnowledgeGraphRecordKindV1 } from "./graph";
import { OH_CONTRACT_ID_V1, OH_ONTOLOGY_VERSION_V1 } from "./ontology";
import { OH_SCHEMA_FORMAT_VERSION_V1 } from "./schema";
export type OhContractManifestV1 = Readonly<{
    contractId: typeof OH_CONTRACT_ID_V1;
    contractSha256: Sha256Hex;
    graphFormatVersion: typeof OH_GRAPH_FORMAT_VERSION_V1;
    ontologyVersion: typeof OH_ONTOLOGY_VERSION_V1;
    recordKinds: readonly KnowledgeGraphRecordKindV1[];
    schemaFormatVersion: typeof OH_SCHEMA_FORMAT_VERSION_V1;
    v: 1;
}>;
export declare const OH_CONTRACT_MANIFEST_V1: OhContractManifestV1;
/** Accepts only the complete, byte-equivalent V1 contract manifest. */
export declare function parseOhContractManifestV1(value: unknown): OhContractManifestV1 | null;
export type OhRecordCodec<T extends JsonValue = JsonValue> = Readonly<{
    kind: KnowledgeGraphRecordKindV1;
    parse(value: unknown): T | null;
}>;
/** Optional semantic validation layered over the immutable generic record envelope. */
export declare class OhRecordCodecRegistry {
    #private;
    register(codec: OhRecordCodec): this;
    parse(kind: KnowledgeGraphRecordKindV1, value: unknown): JsonValue | null;
    has(kind: KnowledgeGraphRecordKindV1): boolean;
    /** Parses only through an explicitly registered codec. */
    parseRequired(kind: KnowledgeGraphRecordKindV1, value: unknown): JsonValue | null;
    /** Prevents the validation policy from changing after an ingress is created. */
    seal(): this;
    get sealed(): boolean;
}
//# sourceMappingURL=contract.d.ts.map