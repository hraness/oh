import {
  OhRecordCodecRegistry,
  type OhStoreV1,
} from "@hraness/oh/store";
import {
  createOhMemoryAgentV1,
  createOhMemoryAgentV2,
  type OhMemoryFacadeOptionsV1,
  type OhMemoryFacadeOptionsV2,
  type OhMemoryQueryResultV2,
  type OhMemoryRememberReceiptV1,
} from "@hraness/oh/experimental/memory";

// Compile-only consumer fixture for the portable public entrypoints. The Node
// runtime exercise lives in node-portable.mjs; this catches declaration drift.
export const portableCodecs = new OhRecordCodecRegistry();
export const portableMemoryFactory: typeof createOhMemoryAgentV1 = createOhMemoryAgentV1;
export const portableMemoryFactoryV2: typeof createOhMemoryAgentV2 = createOhMemoryAgentV2;
export const portableMemoryContinuationKey:
NonNullable<OhMemoryFacadeOptionsV2["continuationKey"]> = new Uint8Array(32);
export type PortableMemoryOptions = OhMemoryFacadeOptionsV1;
export type PortableMemoryOptionsV2 = OhMemoryFacadeOptionsV2;
export type PortableMemoryResultV2 = OhMemoryQueryResultV2;
export type PortableMemoryReceipt = OhMemoryRememberReceiptV1;
export type PortableStore = OhStoreV1;
