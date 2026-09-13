import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { spongeKnowledgeDomainCatalog } from "./knowledge-domain-catalog";
import { knowledgeDeclarativeJson } from "./knowledge-declarative-json";
import { createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1 } from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackLockV1,
  createKnowledgeVocabularyPackManifestV1,
  knowledgeVocabularyPackPinV1,
  parseKnowledgeVocabularyPackLockV1,
  parseKnowledgeVocabularyPackManifestV1,
  resolveKnowledgeVocabularyPacksV1,
  verifyKnowledgeVocabularyPackLockV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";
function unwrap<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.field}:${result.error.code}`);
  return result.value;
}
function body(pack: KnowledgeVocabularyPackManifestV1) {
  return Object.fromEntries(Object.entries(pack).filter(([key]) => key !== "manifestSha256"));
}

describe("declarative vocabulary pack contracts", () => {
  test("round-trips immutable manifests and their complete pinned lock", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    for (const pack of catalog.packs) {
      expect(await parseKnowledgeVocabularyPackManifestV1(JSON.parse(JSON.stringify(pack)))).toEqual({ ok: true, value: pack });
      expect(Object.isFrozen(pack)).toBe(true);
      expect(Object.isFrozen(pack.schemas)).toBe(true);
      expect(Object.isFrozen(pack.vocabulary.labels)).toBe(true);
    }
    expect(await parseKnowledgeVocabularyPackLockV1(catalog.lock)).toEqual({ ok: true, value: catalog.lock });
    const verified = unwrap(await verifyKnowledgeVocabularyPackLockV1({ lock: catalog.lock, manifests: catalog.packs }));
    expect(verified.lock).toEqual(catalog.lock);
  });

  test("returns the same closure when supplied manifests arrive in any order", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    await fc.assert(fc.asyncProperty(fc.shuffledSubarray([...catalog.packs], { minLength: catalog.packs.length, maxLength: catalog.packs.length }), async (manifests) => {
      const resolved = unwrap(await resolveKnowledgeVocabularyPacksV1({ manifests, roots: catalog.lock.roots }));
      expect(resolved.lock).toEqual(catalog.lock);
      expect(resolved.packs[0]?.packId).toBe("sponge.core");
      expect(resolved.packs[1]?.packId).toBe("sponge.reference");
    }), { numRuns: 12 });
  });

  test("rejects digest tampering, namespace capture, mutable aliases and undeclared fields", async () => {
    const { corePack } = await spongeKnowledgeDomainCatalog();
    expect((await parseKnowledgeVocabularyPackManifestV1({ ...corePack, migrationNotes: "Changed after signing." }))).toMatchObject({ ok: false, error: { code: "digest-mismatch" } });
    expect((await createKnowledgeVocabularyPackManifestV1({ ...body(corePack), packId: "attacker.core" }))).toMatchObject({ ok: false, error: { code: "authority-violation" } });
    expect((await createKnowledgeVocabularyPackManifestV1({ ...body(corePack), execute: "file:///private/data" })).ok).toBe(false);
    expect((await createKnowledgeVocabularyPackManifestV1({ ...body(corePack), supportedCodecs: ["javascript"] })).ok).toBe(false);
    expect((await createKnowledgeVocabularyPackManifestV1({ ...body(corePack), dependencies: [{ ...knowledgeVocabularyPackPinV1(corePack), revision: "latest" }] })).ok).toBe(false);
    expect((await createKnowledgeVocabularyPackManifestV1({ ...body(corePack), dependencies: [knowledgeVocabularyPackPinV1(corePack)] })).ok).toBe(false);
    expect((await createKnowledgeVocabularyPackManifestV1({ ...body(corePack), revision: 2 })).ok).toBe(false);
  });

  test("rejects missing dependencies, mismatched exact pins, duplicate namespaces and hidden lock entries", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    const domain = catalog.packs.find((pack) => pack.packId === "sponge.language");
    if (domain === undefined) throw new Error("Missing fixture domain.");
    expect(await resolveKnowledgeVocabularyPacksV1({ manifests: [domain], roots: [knowledgeVocabularyPackPinV1(domain)] })).toMatchObject({ ok: false, error: { code: "dependency-missing" } });
    expect(await resolveKnowledgeVocabularyPacksV1({ manifests: catalog.packs, roots: [{ ...knowledgeVocabularyPackPinV1(domain), revision: 2 }] })).toMatchObject({ ok: false, error: { code: "digest-mismatch" } });
    expect(await resolveKnowledgeVocabularyPacksV1({ manifests: [...catalog.packs, domain], roots: [knowledgeVocabularyPackPinV1(domain)] })).toMatchObject({ ok: false, error: { code: "authority-violation" } });
    const excessive = unwrap(await createKnowledgeVocabularyPackLockV1({ packs: catalog.lock.packs, roots: [knowledgeVocabularyPackPinV1(domain)], v: 1 }));
    expect(await verifyKnowledgeVocabularyPackLockV1({ lock: excessive, manifests: catalog.packs })).toMatchObject({ ok: false, error: { field: "lock.closure" } });
    expect((await parseKnowledgeVocabularyPackLockV1({ ...catalog.lock, lockSha256: "0".repeat(64) })).ok).toBe(false);
  });

  test("cannot resolve foreign schema refs just because unrelated packs were supplied", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    const language = catalog.packs.find((pack) => pack.packId === "sponge.language");
    const music = catalog.packs.find((pack) => pack.packId === "sponge.music");
    const musicSchema = music?.schemas[0];
    if (language === undefined || musicSchema === undefined) throw new Error("Missing fixture.");
    const changed = unwrap(await createKnowledgeVocabularyPackManifestV1({ ...body(language), display: { labelPredicates: [musicSchema.ref], v: 1 } }));
    expect(await resolveKnowledgeVocabularyPacksV1({ manifests: catalog.packs.map((pack) => pack.packId === language.packId ? changed : pack), roots: [knowledgeVocabularyPackPinV1(changed)] })).toMatchObject({ ok: false, error: { code: "dependency-missing" } });
  });

  test("requires schema references to have the declared concept and predicate roles", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    const language = catalog.packs.find((pack) => pack.packId === "sponge.language");
    if (language === undefined) throw new Error("Missing fixture.");
    const concept = language.schemas.find((schema) => schema.kind === "concept");
    const corePredicate = catalog.corePack.schemas.find((schema) => schema.kind === "predicate");
    if (concept?.kind !== "concept" || corePredicate === undefined) throw new Error("Missing schema.");
    const { ref, revisionSha256, ...input } = concept;
    expect(ref.schemaSha256).toBe(revisionSha256);
    const hostile = unwrap(await createKnowledgeSchemaRevisionV1({ ...input, broader: [corePredicate.ref] }));
    const pack = unwrap(await createKnowledgeVocabularyPackManifestV1({ ...body(language), examples: [], queries: [], shapes: [], schemas: [hostile] }));
    const result = await resolveKnowledgeVocabularyPacksV1({ manifests: [catalog.corePack, catalog.referencePack, pack], roots: [knowledgeVocabularyPackPinV1(pack)] });
    expect(result).toMatchObject({ ok: false, error: { field: "packs.broader" } });
  });

  test("shape inheritance needs a real installed shape definition and remains cycle-safe", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    const language = catalog.packs.find((pack) => pack.packId === "sponge.language");
    const original = language?.shapes[0];
    const otherConcept = language?.schemas.find((schema) => schema.kind === "concept" && schema.ref.code !== original?.shape.code);
    if (language === undefined || original === undefined || otherConcept === undefined) throw new Error("Missing fixture.");
    const { shapeSha256, ...input } = original;
    expect(shapeSha256).toHaveLength(64);
    const root = unwrap(await createKnowledgeExecutableShapeV1({ ...input, extends: [otherConcept.ref] }));
    const missing = unwrap(await createKnowledgeVocabularyPackManifestV1({ ...body(language), shapes: [root] }));
    expect(await resolveKnowledgeVocabularyPacksV1({ manifests: [catalog.corePack, catalog.referencePack, missing], roots: [knowledgeVocabularyPackPinV1(missing)] })).toMatchObject({ ok: false, error: { code: "dependency-missing", field: "packs.shape-inheritance" } });
    const other = unwrap(await createKnowledgeExecutableShapeV1({ ...input, extends: [original.shape], shape: otherConcept.ref }));
    const cyclic = unwrap(await createKnowledgeVocabularyPackManifestV1({ ...body(language), shapes: [root, other].sort((left, right) => left.shape.code < right.shape.code ? -1 : 1) }));
    expect(await resolveKnowledgeVocabularyPacksV1({ manifests: [catalog.corePack, catalog.referencePack, cyclic], roots: [knowledgeVocabularyPackPinV1(cyclic)] })).toMatchObject({ ok: false, error: { code: "cycle-detected", field: "packs.shape-inheritance" } });
  });

  test("never invokes accessor or toJSON code and rejects cycles, sparse arrays and excess bounds", async () => {
    const { corePack } = await spongeKnowledgeDomainCatalog();
    let calls = 0;
    const accessor = { ...body(corePack), get migrationNotes() { calls++; throw new Error("executed"); } };
    expect((await createKnowledgeVocabularyPackManifestV1(accessor)).ok).toBe(false);
    expect((await createKnowledgeVocabularyPackManifestV1({ ...body(corePack), toJSON() { calls++; return {}; } })).ok).toBe(false);
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(knowledgeDeclarativeJson(cycle)).toBeUndefined();
    expect(knowledgeDeclarativeJson(Array(2))).toBeUndefined();
    expect(knowledgeDeclarativeJson({ [Symbol("hidden")]: true })).toBeUndefined();
    expect(knowledgeDeclarativeJson({ payload: "a".repeat(65_537) }, 65_536)).toBeUndefined();
    expect(knowledgeDeclarativeJson(Array(8_000).fill("a".repeat(1_024)), 65_536)).toBeUndefined();
    expect((await createKnowledgeVocabularyPackManifestV1({ ...body(corePack), schemas: Array(513).fill(corePack.schemas[0]) })).ok).toBe(false);
    expect(calls).toBe(0);
  });

  test("arbitrary JSON foreign values produce typed failures rather than throwing", async () => {
    await fc.assert(fc.asyncProperty(fc.jsonValue(), async (value) => {
      expect((await parseKnowledgeVocabularyPackManifestV1(value)).ok).toBe(false);
      expect((await parseKnowledgeVocabularyPackLockV1(value)).ok).toBe(false);
    }), { numRuns: 60 });
  });
});
