import {
  OhRecordCodecRegistry,
  type OhStoreV1,
} from "@hraness/oh/store";
import {
  OhMemoryContinuationError,
  createOhMemoryAgentV1,
  createOhMemoryAgentV2,
  createOhMemoryAuthorityV1,
  type OhMemoryAdoptionReplacementV1,
  type OhMemoryAuthorityOptionsV1,
  type OhMemoryContinuationErrorReasonV2,
  type OhMemoryFacadeOptionsV1,
  type OhMemoryFacadeOptionsV2,
  type OhMemoryQueryResultV2,
  type OhMemoryRememberReceiptV1,
} from "@hraness/oh/memory";
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
export const portableMemoryAuthorityFactory: typeof createOhMemoryAuthorityV1 =
  createOhMemoryAuthorityV1;
export const portableMemoryContinuationError: typeof OhMemoryContinuationError =
  OhMemoryContinuationError;
export const portableMemoryContinuationKey:
NonNullable<OhMemoryFacadeOptionsV2["continuationKey"]> = new Uint8Array(32);
export type PortableMemoryOptions = OhMemoryFacadeOptionsV1;
export type PortableMemoryOptionsV2 = OhMemoryFacadeOptionsV2;
export type PortableMemoryAuthorityOptions = OhMemoryAuthorityOptionsV1;
export type PortableMemoryAdoptionReplacement = OhMemoryAdoptionReplacementV1;
export type PortableMemoryContinuationErrorReason = OhMemoryContinuationErrorReasonV2;
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
