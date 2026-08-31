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
import {
  OhCloudflareEmbeddingClientV1,
  openOhLibSqlSemanticCacheV1,
  type OhSemanticAuthorityRefV1,
} from "@hraness/oh/semantic-cloud";
import {
  createOhMemoryPageRecordV1,
  type OhMemoryPageValueV1,
} from "@hraness/oh/memory-page";

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
export const portableCloudEmbeddingClient: typeof OhCloudflareEmbeddingClientV1 =
  OhCloudflareEmbeddingClientV1;
export const portableSemanticCacheFactory: typeof openOhLibSqlSemanticCacheV1 =
  openOhLibSqlSemanticCacheV1;
export type PortableSemanticAuthority = OhSemanticAuthorityRefV1;
export const portableMemoryPageFactory: typeof createOhMemoryPageRecordV1 =
  createOhMemoryPageRecordV1;
export type PortableMemoryPage = OhMemoryPageValueV1;
