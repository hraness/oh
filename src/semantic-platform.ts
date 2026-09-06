import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";

import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex,
  safeCode, sha256Hex, type Sha256Hex } from "./canonical";
import type { KnowledgeGraphRecordV1 } from "./graph";
import type { OhSqliteStore } from "./sqlite/store";
import { OH_EMBEDDING_PROFILE_V1, recordDocument, semanticManifest,
  type QmdStore, type QmdStoreFactoryV1, type SemanticManifestV1 } from "./semantic-model";

export type SemanticFailure = Readonly<{
  _tag: "FilesystemFailure" | "BackendFailure" | "ManifestFailure" | "ResultFailure" | "AuthorityFailure" | "Closed";
  // Retained only for the existing Promise boundary; never log or serialize foreign causes.
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

export class SemanticPlatform extends Context.Tag("@hraness/oh/SemanticPlatform")<
  SemanticPlatform, SemanticPlatformService
>() {}

function foreign<A>(tag: SemanticFailure["_tag"], operation: () => Promise<A>): Effect.Effect<A, SemanticFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => ({ _tag: tag, cause }) });
}

const qmdModuleSpecifier: string = "@tobilu/qmd";
async function defaultQmdStoreFactory(options: Parameters<QmdStoreFactoryV1>[0]): Promise<QmdStore> {
  let module: unknown;
  try { module = await import(qmdModuleSpecifier); } catch {
    throw new Error("Semantic search needs the optional @tobilu/qmd@2.5.3 package.");
  }
  const createStore = (module as { createStore?: unknown }).createStore;
  if (typeof createStore !== "function") throw new Error("The installed QMD package has no compatible createStore export.");
  return await (createStore as QmdStoreFactoryV1)(options);
}

function parseManifest(text: string): SemanticManifestV1 {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("The semantic manifest is not JSON."); }
  if (canonicalJson(value) !== text || !isPlainRecord(value)
    || !hasExactKeys(value, ["entries", "profileSha256", "v"]) || value.v !== 1
    || value.profileSha256 !== canonicalSha256(OH_EMBEDDING_PROFILE_V1) || !isPlainRecord(value.entries)
    || Object.keys(value.entries).length > 65_536) throw new Error("The semantic manifest is incompatible or invalid.");
  const entries: Record<string, { key: string; recordSha256: Sha256Hex }> = {};
  for (const [filename, candidate] of Object.entries(value.entries)) {
    if (!/^[a-f0-9]{64}\.md$/u.test(filename) || !isPlainRecord(candidate)
      || !hasExactKeys(candidate, ["key", "recordSha256"])) throw new Error("The semantic manifest has an invalid entry.");
    const key = safeCode(candidate.key, 512);
    const recordSha256 = parseSha256Hex(candidate.recordSha256);
    if (key === null || recordSha256 === null || filename !== `${sha256Hex(key)}.md`) {
      throw new Error("The semantic manifest entry identity is invalid.");
    }
    entries[filename] = { key, recordSha256 };
  }
  return semanticManifest(entries);
}

/** Foreign filesystem and optional QMD calls are confined to this adapter. */
export function semanticPlatformLive(options: SemanticOptions): Layer.Layer<SemanticPlatform> {
  const cacheDirectory = resolve(options.cacheDirectory);
  const databasePath = resolve(options.databasePath ?? join(cacheDirectory, "qmd.sqlite"));
  const documents = join(cacheDirectory, "documents");
  const factory = options.storeFactory ?? defaultQmdStoreFactory;
  return Layer.succeed(SemanticPlatform, {
    prepare: foreign("FilesystemFailure", () => mkdir(documents, { recursive: true })).pipe(Effect.asVoid),
    loadManifest: foreign("FilesystemFailure", async () => {
      try { return await readFile(join(cacheDirectory, "manifest.json"), "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }).pipe(Effect.flatMap((text) => Effect.try({
      try: () => text === null ? semanticManifest({}) : parseManifest(text),
      catch: (cause): SemanticFailure => ({ _tag: "ManifestFailure", cause }),
    }))),
    open: foreign("BackendFailure", () => factory({ dbPath: databasePath, config: {
      collections: { oh: { path: documents, pattern: "*.md" } },
      models: { embed: OH_EMBEDDING_PROFILE_V1.model },
    } })),
    close: (store) => foreign("BackendFailure", () => store.close()),
    update: (store) => foreign("BackendFailure", () => store.update({ collections: ["oh"] })),
    embed: (store) => foreign("BackendFailure", () => store.embed({ collection: "oh", model: OH_EMBEDDING_PROFILE_V1.model })),
    search: (store, query, limit) => foreign("BackendFailure", () => store.searchVector(query, { collection: "oh", limit })),
    writeDocuments: (records) => foreign("FilesystemFailure", async () => {
      const entries: Record<string, { key: string; recordSha256: Sha256Hex }> = {};
      for (const record of records) {
        const filename = `${sha256Hex(record.key)}.md`;
        entries[filename] = { key: record.key, recordSha256: record.recordSha256 };
        const path = join(documents, filename);
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, recordDocument(record), { encoding: "utf8", mode: 0o600 });
        await rename(temporary, path);
      }
      const retained = new Set(Object.keys(entries));
      for (const filename of await readdir(documents)) {
        if (/^[a-f0-9]{64}\.md$/u.test(filename) && !retained.has(filename)) await unlink(join(documents, filename));
      }
      return semanticManifest(entries);
    }),
    publishManifest: (manifest) => foreign("FilesystemFailure", async () => {
      const path = join(cacheDirectory, "manifest.json");
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, canonicalJson(manifest), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    }),
    readAuthority: (authority, key) => Effect.try({
      try: () => authority.get(key),
      catch: (cause): SemanticFailure => ({ _tag: "AuthorityFailure", cause }),
    }),
  });
}
