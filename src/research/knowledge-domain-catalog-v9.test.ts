import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text } from "./integrity-domain";
import { spongeKnowledgeDomainCatalogV8 } from "./knowledge-domain-catalog-v8";
import { spongeKnowledgeDomainCatalogV9, SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9 } from "./knowledge-domain-catalog-v9";
import { verifyKnowledgeSchemaEvolutionV1 } from "./knowledge-ontology-contract-v1";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

const REVISED = new Set<string>(SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9);
const canonical = (value: unknown) => canonicalJson(value as JsonValue);

/** Replaces schema references with namespace/code so revision 1 and 2 compare by meaning. */
function meaning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(meaning);
  if (typeof value !== "object" || value === null) return value;
  const keys = Object.keys(value).sort().join(",");
  if (keys === "code,namespace,revision,schemaSha256,v") {
    const ref = value as { code: string; namespace: string };
    return `${ref.namespace}/${ref.code}`;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["previousRevisionSha256", "revisionSha256", "shapeSha256", "vocabularySha256"].includes(key))
    .map(([key, item]) => [key, key === "identity" ? { ...(item as object), revision: 0 } : meaning(item)]));
}

describe("revised guide catalog v9", () => {
  test("keeps catalog V8 and replaces each guide pack with a revision 2 successor", async () => {
    const [previous, catalog] = await Promise.all([spongeKnowledgeDomainCatalogV8(), spongeKnowledgeDomainCatalogV9()]);
    expect(String(previous.lock.lockSha256)).toBe("8aa1f4799df22973381f147d824c254a8159cc184494a287c793ca1592eb78a3");
    expect(catalog.packs.filter(pack => !REVISED.has(pack.packId))).toEqual(previous.packs.filter(pack => !REVISED.has(pack.packId)));
    expect(catalog.packs).toHaveLength(previous.packs.length);
    expect(catalog.lock.roots).toHaveLength(previous.lock.roots.length);
    expect(catalog.schemas).toHaveLength(previous.schemas.length);
    expect(catalog.historicalPacks).toEqual([...previous.historicalPacks,
      ...previous.packs.filter(pack => REVISED.has(pack.packId))]);
    expect(catalog.lock.lockSha256).not.toBe(previous.lock.lockSha256);
    expect(Object.isFrozen(catalog)).toBe(true);
    for (const packId of SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9) {
      const before = previous.packs.find(pack => pack.packId === packId);
      const after = catalog.packs.find(pack => pack.packId === packId);
      if (before === undefined || after === undefined) throw new Error(`Missing ${packId}.`);
      expect(after.revision).toBe(2);
      expect(after.previousManifestSha256).toBe(before.manifestSha256);
      expect(after.vocabulary.revision).toBe(2);
      expect(after.vocabulary.previousRevisionSha256).toBe(before.vocabulary.revisionSha256);
      expect(after.schemas.map(schema => schema.identity.code)).toEqual(before.schemas.map(schema => schema.identity.code));
      for (const schema of after.schemas) {
        const prior = before.schemas.find(item => item.identity.code === schema.identity.code);
        if (prior === undefined) throw new Error(`Missing ${packId}/${schema.identity.code}.`);
        expect(verifyKnowledgeSchemaEvolutionV1([prior, schema]).ok).toBe(true);
        expect(schema.vocabularySha256).toBe(after.vocabulary.revisionSha256);
        for (const ref of JSON.stringify(schema).matchAll(/"namespace":"(sponge\.[a-z-]+)","revision":(\d+)/g)) {
          if (REVISED.has(ref[1] as string)) expect(ref[2]).toBe("2");
        }
      }
      expect(meaning(after.schemas)).toEqual(meaning(before.schemas));
      expect(meaning(after.shapes)).toEqual(meaning(before.shapes));
      expect(meaning(after.queries)).toEqual(meaning(before.queries));
      expect(meaning(after.examples)).toEqual(meaning(before.examples));
      expect(meaning(after.display)).toEqual(meaning(before.display));
      expect(after.dependencies.map(pin => pin.packId)).toEqual(before.dependencies.map(pin => pin.packId));
      for (const pin of after.dependencies) {
        const expected = catalog.packs.find(pack => pack.packId === pin.packId);
        if (expected === undefined) throw new Error(`Missing dependency ${pin.packId}.`);
        expect(pin).toEqual(knowledgeVocabularyPackPinV1(expected));
      }
    }
  }, 60_000);

  test("pins each V2 guide byte for byte and keeps each V1 guide pinned by catalog V8", async () => {
    const [previous, catalog] = await Promise.all([spongeKnowledgeDomainCatalogV8(), spongeKnowledgeDomainCatalogV9()]);
    for (const packId of SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9) {
      const name = packId.slice("sponge.".length);
      const pack = catalog.packs.find(item => item.packId === packId);
      const before = previous.packs.find(item => item.packId === packId);
      if (pack === undefined || before === undefined) throw new Error(`Missing ${packId}.`);
      const guide = await readFile(new URL(`../../spec/research-v1/${name}-v2.md`, import.meta.url), "utf8");
      const legacy = await readFile(new URL(`../../spec/research-v1/${name}-v1.md`, import.meta.url), "utf8");
      expect(pack.sources).toEqual([{ contentSha256: await sha256Text(guide), license: "MIT", revision: "2026-09-26",
        uri: `https://github.com/hraness/oh/blob/main/spec/research-v1/${name}-v2.md`, v: 1 }]);
      expect(before.sources[0]?.contentSha256).toBe(await sha256Text(legacy));
      expect(guide).not.toMatch(/[–—]/);
      expect(guide).toContain(`revision 2 of \`${packId}\``);
      for (const path of [`${name}-v2.md`, `${name}-v2.json`]) {
        const source = await readFile(new URL(`../../spec/research-v1/${path}`, import.meta.url), "utf8");
        expect(await readFile(new URL(`../../site/public/spec/research-v1/${path}`, import.meta.url), "utf8")).toBe(source);
      }
      const discovery = JSON.parse(await readFile(new URL(`../../spec/research-v1/${name}-v2.json`, import.meta.url), "utf8"));
      expect(discovery).toEqual({
        v: 1,
        catalog: { factory: "spongeKnowledgeDomainCatalogV9", previousCatalogFactory: "spongeKnowledgeDomainCatalogV8",
          revisedPack: packId, packRevision: 2, previousPackRevision: 1 },
        previousGuide: `${name}-v1.md`,
        concepts: pack.schemas.filter(schema => schema.kind === "concept").map(schema => schema.identity.code),
        relations: pack.schemas.filter(schema => schema.kind === "predicate").map(schema => schema.identity.code),
        directDependencies: pack.dependencies.map(pin => pin.packId),
        queries: pack.queries.map(query => query.id),
        semanticCompleteness: "not-claimed",
        authority: "unadmitted",
      });
    }
  }, 30_000);

  test("resolves each revised pack's dependency closure and ignores order", async () => {
    const [previous, catalog] = await Promise.all([spongeKnowledgeDomainCatalogV8(), spongeKnowledgeDomainCatalogV9()]);
    for (const packId of SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9) {
      const pack = catalog.packs.find(item => item.packId === packId);
      const before = previous.packs.find(item => item.packId === packId);
      if (pack === undefined || before === undefined) throw new Error(`Missing ${packId}.`);
      const [next, prior] = await Promise.all([
        resolveKnowledgeVocabularyPacksV1({ manifests: catalog.packs, roots: [knowledgeVocabularyPackPinV1(pack)] }),
        resolveKnowledgeVocabularyPacksV1({ manifests: previous.packs, roots: [knowledgeVocabularyPackPinV1(before)] }),
      ]);
      if (!next.ok || !prior.ok) throw new Error(`Dependency resolution failed for ${packId}.`);
      expect(next.value.packs.map(item => item.packId)).toEqual(prior.value.packs.map(item => item.packId));
    }
    const reversed = await resolveKnowledgeVocabularyPacksV1({ manifests: [...catalog.packs].reverse(), roots: catalog.lock.roots });
    if (!reversed.ok) throw new Error("Catalog resolution failed.");
    expect(canonical(reversed.value.lock)).toBe(canonical(catalog.lock));
  }, 60_000);
});
