import type { KnowledgeGraphRecordV1 as OhGraphRecord } from "../graph";
import { type JsonValue } from "./document-domain";
import { type Sha256Hex } from "./integrity-domain";
import { type KnowledgeGraphRecordKindV1 } from "./knowledge-ontology-contract-v1";
export declare const OH_RESEARCH_PACKET_PROFILE_V1: "oh.research-packet.v1";
export declare const OH_RESEARCH_PACKET_LIMITS_V1: Readonly<{
    records: 1024;
    sourceBytes: number;
    packetBytes: number;
    recordBytes: number;
    dependenciesPerRecord: 4096;
}>;
export type OhResearchSourceRecordV1 = Readonly<{
    kind: KnowledgeGraphRecordKindV1;
    recordKey: string;
    recordSha256: Sha256Hex;
    value: JsonValue;
}>;
export type OhResearchRecordValueV1 = Readonly<{
    profile: typeof OH_RESEARCH_PACKET_PROFILE_V1;
    source: OhResearchSourceRecordV1;
    v: 1;
}>;
export type OhResearchPacketV1 = Readonly<{
    profile: typeof OH_RESEARCH_PACKET_PROFILE_V1;
    dependencyPolicy: "explicit-source-digests-and-schema-refs.v1";
    /** A transport packet supplies no review, identity-head, disclosure or host-authority decision. */
    authority: "unasserted";
    /** Hash of the complete ordered source identity/alias manifest. Exact snapshots
     * replay; changed snapshots may repeat unchanged source records under new keys. */
    sourceBindingSha256: Sha256Hex;
    records: readonly OhGraphRecord[];
    packetSha256: Sha256Hex;
    v: 1;
}>;
/** Immutable transport key; this is never a replacement for a source's semantic identity. */
export declare function ohResearchRecordKeyV1(kind: KnowledgeGraphRecordKindV1, sourceSha256: string, sourceBindingSha256: string): string;
/** Internal proof of preparation, not a claim that any host has accepted the records. */
export declare function isPreparedOhResearchPacketV1(value: unknown): value is OhResearchPacketV1;
/**
 * Performs asynchronous source codec/hash verification, then binds every declared
 * graph-digest dependency and exact schema reference to an immutable envelope key.
 * Logical entity IDs and opaque policy/artifact digests remain source data. No
 * identity-head, schema installation, factual truth or permission is inferred.
 */
export declare function prepareOhResearchPacketV1(foreign: unknown): Promise<OhResearchPacketV1>;
/** Verify a serialized packet by regenerating its source, dependency mapping and both digest layers. */
export declare function verifyOhResearchPacketV1(foreign: unknown): Promise<OhResearchPacketV1 | null>;
//# sourceMappingURL=research-packet.d.ts.map