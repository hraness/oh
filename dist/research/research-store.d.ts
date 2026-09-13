import { OhRecordCodecRegistry } from "../contract";
import type { OhOperationV1 } from "../operation";
import { type OhCommitInputV1, type OhDependencyClosureV1, type OhHeadV1, type OhStoreV1 } from "../store";
import { type OhResearchPacketV1 } from "./research-packet";
export declare const OH_RESEARCH_STORE_LIMITS_V1: Readonly<{
    snapshotRecords: 8192;
}>;
export type OhResearchExportV1 = Readonly<{
    profile: "oh.research-export.v1";
    packet: OhResearchPacketV1;
    /** A source snapshot claim. This is not authority to write or publish at another host. */
    closure: OhDependencyClosureV1;
    v: 1;
}>;
/**
 * A sealed synchronous exact-byte allowlist over a privately branded, asynchronously
 * verified packet. This value-only codec cannot validate envelope keys or dependencies;
 * use commitOhResearchPacketV1 for the complete packet boundary. It is not a host acceptance policy.
 */
export declare function createOhResearchPacketCodecRegistryV1(packet: OhResearchPacketV1): OhRecordCodecRegistry;
export type OhResearchCommitInputV1 = Readonly<{
    store: OhStoreV1;
    packet: unknown;
    actorId: string;
    expectedHead: OhCommitInputV1["expectedHead"];
    operationId: string;
    instant: string;
}>;
/** Local explicit-target commit. Source authority records remain transported claims. */
export declare function commitOhResearchPacketV1(input: OhResearchCommitInputV1): Promise<OhOperationV1>;
/** Read a complete research snapshot at one exact local store head. Roots must
 * reach every source in the prepared packet; partial snapshots fail closed. */
export declare function exportOhResearchPacketV1(input: Readonly<{
    store: OhStoreV1;
    roots: readonly string[];
    head?: OhHeadV1;
}>): Promise<OhResearchExportV1>;
export declare function readOhResearchPacketV1(input: Parameters<typeof exportOhResearchPacketV1>[0]): Promise<OhResearchPacketV1>;
/** Checks bytes and closure. Authenticating the claimed exporting host is a caller responsibility. */
export declare function verifyOhResearchExportV1(foreign: unknown): Promise<OhResearchExportV1 | null>;
/** Import a snapshot as a new local CAS operation; never impersonates its source operation log. */
export declare function restoreOhResearchPacketV1(input: Omit<OhResearchCommitInputV1, "packet"> & Readonly<{
    exported: unknown;
}>): Promise<OhOperationV1>;
//# sourceMappingURL=research-store.d.ts.map