import { Context, Effect, Layer } from "effect";
import type { KnowledgeGraphRecordV1 } from "./graph";
import type { OhSqliteStore } from "./sqlite/store";
import { type QmdStore, type QmdStoreFactoryV1, type SemanticManifestV1 } from "./semantic-model";
export type SemanticFailure = Readonly<{
    _tag: "FilesystemFailure" | "BackendFailure" | "ManifestFailure" | "ResultFailure" | "AuthorityFailure" | "Closed";
    cause: unknown;
}>;
export type SemanticOptions = Readonly<{
    cacheDirectory: string;
    databasePath?: string;
    storeFactory?: QmdStoreFactoryV1;
}>;
export interface SemanticPlatformService {
    readonly prepare: Effect.Effect<void, SemanticFailure>;
    readonly loadManifest: Effect.Effect<SemanticManifestV1, SemanticFailure>;
    readonly open: Effect.Effect<QmdStore, SemanticFailure>;
    close(store: QmdStore): Effect.Effect<void, SemanticFailure>;
    update(store: QmdStore): Effect.Effect<unknown, SemanticFailure>;
    embed(store: QmdStore): Effect.Effect<unknown, SemanticFailure>;
    search(store: QmdStore, query: string, limit: number): Effect.Effect<unknown, SemanticFailure>;
    writeDocuments(records: readonly KnowledgeGraphRecordV1[]): Effect.Effect<SemanticManifestV1, SemanticFailure>;
    publishManifest(manifest: SemanticManifestV1): Effect.Effect<void, SemanticFailure>;
    readAuthority(authority: OhSqliteStore, key: string): Effect.Effect<KnowledgeGraphRecordV1 | null, SemanticFailure>;
}
declare const SemanticPlatform_base: Context.TagClass<SemanticPlatform, "@hraness/oh/SemanticPlatform", SemanticPlatformService>;
export declare class SemanticPlatform extends SemanticPlatform_base {
}
/** Foreign filesystem and optional QMD calls are confined to this adapter. */
export declare function semanticPlatformLive(options: SemanticOptions): Layer.Layer<SemanticPlatform>;
export {};
//# sourceMappingURL=semantic-platform.d.ts.map