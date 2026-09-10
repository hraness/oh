import type { KnowledgeGraphRecordV1 } from "./graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1, type QmdStoreFactoryV1 } from "./semantic-model";
import { makeSemanticBoundary } from "./semantic-runtime";
import type { OhSqliteStore } from "./sqlite/store";

export { OH_EMBEDDING_PROFILE_V1, cosineSimilarityV1, formatOhEmbeddingDocumentV1,
  formatOhEmbeddingQueryV1, normalizeOhEmbeddingV1 } from "./semantic-model";
export type { OhEmbeddingProfileV1, OhSemanticSearchBackendV1,
  OhSemanticSearchResultV1, QmdStoreFactoryV1 } from "./semantic-model";

/**
 * Optional, rebuildable local QMD index. SQLite records remain authoritative;
 * every returned hit is rejoined to its exact current record digest.
 */
export class OhQmdSemanticBackendV1 implements OhSemanticSearchBackendV1 {
  readonly profile = OH_EMBEDDING_PROFILE_V1;
  readonly #boundary;

  constructor(options: Readonly<{ cacheDirectory: string; databasePath?: string; storeFactory?: QmdStoreFactoryV1 }>) {
    this.#boundary = makeSemanticBoundary(options);
  }

  index(records: readonly KnowledgeGraphRecordV1[]): ReturnType<OhSemanticSearchBackendV1["index"]> {
    return this.#boundary.index(records);
  }

  search(query: string, limit: number, authority: OhSqliteStore): ReturnType<OhSemanticSearchBackendV1["search"]> {
    return this.#boundary.search(query, limit, authority);
  }

  close(): Promise<void> {
    return this.#boundary.close();
  }
}

export { OhHostedSemanticBackendV2 } from "./semantic-hosted";
export { OH_HOSTED_EMBEDDING_PROFILE_V2, OH_HOSTED_PROFILE_SHA256_V2, OH_HOSTED_LIMITS_V1,
  normalizeOhHostedEmbeddingV2, parseOhHostedSnapshotV1 } from "./semantic-hosted-model";
export type { OhHostedEmbeddingProfileV2, OhSemanticSearchBackendV2, OhSemanticSearchBackend,
  OhHostedSnapshotV1, OhHostedSettlementV1 } from "./semantic-hosted-model";
