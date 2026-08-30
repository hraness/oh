import {
  OhRecordCodecRegistry,
  type OhStoreV1,
} from "@hraness/oh/store";
import {
  createOhMemoryAgentV1,
  type OhMemoryFacadeOptionsV1,
  type OhMemoryRememberReceiptV1,
} from "@hraness/oh/experimental/memory";

// Compile-only consumer fixture for the portable public entrypoints. The Node
// runtime exercise lives in node-portable.mjs; this catches declaration drift.
export const portableCodecs = new OhRecordCodecRegistry();
export const portableMemoryFactory: typeof createOhMemoryAgentV1 = createOhMemoryAgentV1;
export type PortableMemoryOptions = OhMemoryFacadeOptionsV1;
export type PortableMemoryReceipt = OhMemoryRememberReceiptV1;
export type PortableStore = OhStoreV1;
