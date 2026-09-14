import { describe, expect, test } from "bun:test";
import { readWikidataInventorySourcesV1 } from "../scripts/capture-wikidata-inventory";
import { canonicalJson, type JsonValue } from "../src/research/document-domain";
import { sha256Text } from "../src/research/integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "../src/research/knowledge-core-v1";
import { spongeKnowledgeDomainCatalog } from "../src/research/knowledge-domain-catalog";
import { spongeKnowledgeDomainCatalogV2 } from "../src/research/knowledge-domain-catalog-v2";
import { spongeKnowledgeDomainCatalogV3 } from "../src/research/knowledge-domain-catalog-v3";
import type { KnowledgePredicateRevisionV1, KnowledgeSchemaRevisionV1 } from "../src/research/knowledge-ontology-contract-v1";
import { parseKnowledgeEntityId, type KnowledgeEntityV1 } from "../src/research/knowledge-ontology-v1";
import { compileSpongeKnowledgeProposalV3, type SpongeKnowledgeProposalCompilerAuthorityV3 } from "../src/research/knowledge-proposal-compiler-v3";
import type { SpongeKnowledgeProposalDraftV3, SpongeKnowledgeProposalValueV3 } from "../src/research/knowledge-proposal-v3";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "../src/research/knowledge-vocabulary-pack-v1";
import { createKnowledgeWikidataImportPreviewV2, KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2,
  type KnowledgeWikidataImportResultV2 } from "../src/research/knowledge-wikidata-import-v2";
import { createKnowledgeWikidataMappingPreviewV1, spongeKnowledgeWikidataMappingCatalogV1,
  verifyKnowledgeWikidataMappingPreviewV1 } from "../src/research/knowledge-wikidata-mappings-v1";
import { createKnowledgeWikidataMappingPreviewV2, spongeKnowledgeWikidataMappingCatalogV2,
  verifyKnowledgeWikidataMappingPreviewV2, type KnowledgeWikidataMappingPreviewV2 } from "../src/research/knowledge-wikidata-mappings-v2";

const directory = new URL("../spec/research-v1/wikidata/2026-09-13", import.meta.url).pathname;
// Full property captures independently selected for this semantic slice, not inventory datatype rows.
const reviewed = [
  ["P50", "author", 2528636255, "60d1b0837173d401a3ed0fcb9769691e3a62e3f7307167595b43f8bd0e133cfa"],
  ["P136", "genre", 2544600023, "6bf5951fe86505a3fdeeaee23cb52e482ddd799eeff7878908a27c566fec7590"],
  ["P144", "based-on", 2544603547, "6491923b1a2a232b2a304b2d10587b0d56ebdf85f31b38cb8e28cf7af5ec65cf"],
  ["P170", "creator", 2534300026, "522ab3639a5487087e8479abf4c310cf3e5f0cd19dded0dec5435ec001c93e63"],
  ["P175", "performer", 2542419149, "426d54d7ea13be9941cc2a65a9bcf92853ccdd2a7fe09071ed6631ef06d5cbcc"],
  ["P277", "programmed-in", 2527096569, "19d54b17eddb66f0fc6662853c1f5160946ff468775672640ea452174327d3c1"],
  ["P407", "language-of-work-or-name", 2544572361, "72be35a6524dd893406c7d8b4a585e397c2d7c3f0e6e14f11b6c5894a1d6bfc6"],
  ["P414", "stock-exchange", 2503386869, "f52af3ce24b2313cb2d6f565faab9a2b184061dc25265ecd7bae46af0145af63"],
  ["P527", "has-part", 2544660189, "e9374ff970896dfef5e706054d269be2e20dc7600c7e01275791c15b9262da51"],
  ["P629", "version-edition-or-translation-of", 2537669859, "5df98fe0198569e121f82be1203c8d8ba3262ee2e52147f7ed0d4673450f2740"],
  ["P703", "found-in-taxon", 2511372721, "e6ed9c7ac12e7be27bbf989ac69986fcf16e7a27c2e2dc2c690719d7188dbc56"],
  ["P921", "main-subject", 2537871557, "9b89c62a2b15c46724e6f21c88c8672c36665f421150a42704dc1108916b4d19"],
] as const;

function unwrap<T>(result: KnowledgeWikidataImportResultV2<T>): T {
  if (!result.ok) throw new Error(`Invalid source fixture: ${result.error.field}:${result.error.code}`);
  return result.value;
}
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function statement(property: string, id = `Q1$${property}`, object = "Q5", datatype = "wikibase-item") {
  return { id, type: "statement", rank: "normal", mainsnak: { property, datatype, snaktype: "value",
    datavalue: { type: "wikibase-entityid", value: { id: object, "entity-type": "item", "numeric-id": Number(object.slice(1)) } } } };
}
function capture(claims: unknown, revision = 10) {
  return { requestedId: "Q1", resolvedId: "Q1", sourceUri: "https://www.wikidata.org/w/api.php",
    capturedAt: "2026-09-13T00:00:00.000Z", redirects: [], coverage: { kind: "complete-entity" },
    body: JSON.stringify({ type: "item", id: "Q1", lastrevid: revision, claims }) };
}
function input(claims: unknown) {
  return { v: 2, properties: "all-present", mappingVersion: "arbitrary-caller-label", captures: [capture(claims)] };
}
function schema(catalog: { schemas: readonly KnowledgeSchemaRevisionV1[] }, identity: string): KnowledgeSchemaRevisionV1 {
  const result = catalog.schemas.find(item => `${item.identity.namespace.slice(7)}/${item.identity.code}` === identity);
  if (result === undefined) throw new Error(`Missing fixture schema: ${identity}`);
  return result;
}
function predicate(catalog: { schemas: readonly KnowledgeSchemaRevisionV1[] }, identity: string): KnowledgePredicateRevisionV1 {
  const result = schema(catalog, identity);
  if (result.kind !== "predicate") throw new Error(`Expected fixture predicate: ${identity}`);
  return result;
}

async function compilerFixture(code: string) {
  const catalog = await spongeKnowledgeDomainCatalogV3();
  const core = await spongeCoreKnowledgeCatalogV1();
  const actorId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const actor: KnowledgeEntityV1 = { entityId: actorId, identityOperationId: "identity.source-relations-test",
    identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
  const entityConcept = schema(catalog, "core/entity").ref;
  const draft: SpongeKnowledgeProposalDraftV3 = { v: 3, contexts: [], evidence: [], vocabularyDependencies: [],
    entities: ["subject", "object"].map(key => ({ key, kind: "new", concepts: [entityConcept],
      name: { language: "en", text: `Synthetic ${key}` } })),
    facts: [{ key: "source-relation", subject: { kind: "key", key: "subject" },
      predicate: predicate(catalog, `source-relations/source-asserted-${code}`).ref,
      object: { kind: "entity-key", entityKey: "object" }, qualifiers: [], contextKey: null, stance: "reports" }],
  };
  const authority: SpongeKnowledgeProposalCompilerAuthorityV3 = {
    externalOperationReceiptSha256: await sha256Text("source relations independent test receipt"), authorEntityId: actorId,
    authoringPolicySha256: core.rightsPolicySha256, occurredAt: "2026-09-13T00:00:00.000Z",
    spaceId: "space.source-relations-test", schemas: catalog.schemas,
    existingEntities: new Map([[actorId, { entity: actor, concepts: [schema(catalog, "core/agent").ref] }]]),
  };
  return { catalog, draft, authority };
}

describe("source-relations catalog compatibility", () => {
  test("adds one pack without changing either historical catalog, foundation or shapes", async () => {
    const original = await spongeKnowledgeDomainCatalog();
    const previous = await spongeKnowledgeDomainCatalogV2();
    const current = await spongeKnowledgeDomainCatalogV3();
    expect(original.lock.lockSha256).toBe("2d5fe02a59b7fcb15dc9a88bb7e04e0dafa97c9b439c592d65bfb612123e0113");
    expect(previous.lock.lockSha256).toBe("7cf05faa31b5e790cc5a2de00efd6776a25d54cfc676a524e173022775f1c81f");
    expect(await sha256Text(canonical(original.packs))).toBe("f46f14f829ab6d41a91988dd35a9f3b0423064c22c3d639169757a5a9b3c6d1a");
    expect(await sha256Text(canonical(previous.packs))).toBe("b3960a791526ee9ac152b687104ab4bb79255f64fac99414932fec986a5636e4");
    expect(current.packs.filter(pack => pack.packId !== "sponge.source-relations")).toEqual(previous.packs);
    expect(current.foundationPack).toEqual(previous.foundationPack);
    expect(current.historicalPacks).toEqual(previous.historicalPacks);
    expect(current.packs.flatMap(pack => pack.shapes)).toEqual(previous.packs.flatMap(pack => pack.shapes));
    expect(current.packs.flatMap(pack => pack.shapes)).toHaveLength(40);
    expect(current.packs).toHaveLength(18);
    expect(current.schemas).toHaveLength(239);
    expect(current.lock.packs).toHaveLength(18);
    expect(current.lock.lockSha256).not.toBe(previous.lock.lockSha256);
    const pack = current.packs.find(item => item.packId === "sponge.source-relations")!;
    expect(pack.revision).toBe(1);
    expect(pack.previousManifestSha256).toBeNull();
    expect(pack.schemas).toHaveLength(12);
    expect(pack.shapes).toEqual([]);
    expect(pack.schemas.every(item => item.kind === "predicate" && item.reviewDecisionSha256 === null)).toBe(true);
    expect((await resolveKnowledgeVocabularyPacksV1({ manifests: current.packs, roots: current.lock.roots })).ok).toBe(true);
    const isolated = await resolveKnowledgeVocabularyPacksV1({ manifests: [current.corePack, current.referencePack,
      current.foundationPack, pack], roots: [knowledgeVocabularyPackPinV1(pack)] });
    expect(isolated.ok).toBe(true);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(pack.schemas)).toBe(true);
  });

  test("pins complete captured property revisions and exact independent predicate targets", async () => {
    const sources = await readWikidataInventorySourcesV1(directory);
    const catalog = await spongeKnowledgeWikidataMappingCatalogV2();
    const current = await spongeKnowledgeDomainCatalogV3();
    const previous = await spongeKnowledgeWikidataMappingCatalogV1();
    expect(previous.catalogSha256).toBe("faee779d4eb1d6a95f62447fd3add431958a4f637eed6e4037bf0388f5d79427");
    expect(previous.mappings).toHaveLength(3);
    expect(catalog.v).toBe(2);
    expect(catalog.mappingVersion).toBe("sponge.wikidata-source-mappings.v2");
    expect(catalog.mappings).toHaveLength(15);
    expect(catalog.mappings.map(mapping => mapping.source.propertyId).sort())
      .toEqual([...previous.mappings.map(mapping => mapping.source.propertyId), ...reviewed.map(([id]) => id)].sort());
    for (const prior of previous.mappings) {
      expect(catalog.mappings.find(mapping => mapping.source.propertyId === prior.source.propertyId)).toEqual({ ...prior, v: 2 });
    }
    const entity = schema(current, "core/entity").ref;
    for (const [id, code, revision, captureSha256] of reviewed) {
      const source = sources.find(item => item.key === `entity-${id}`)!;
      expect(source.kind).toBe("entity");
      expect(source.bodySha256).toBe(captureSha256);
      const property = JSON.parse(source.body).entities[id];
      expect(property.lastrevid).toBe(revision);
      expect(property.datatype).toBe("wikibase-item");
      expect(property.claims).toBeDefined();
      expect(current.packs.find(pack => pack.packId === "sponge.source-relations")?.sources)
        .toContainEqual({ contentSha256: captureSha256, license: "CC0-1.0", revision: String(revision), uri: source.sourceUri, v: 1 });
      const target = predicate(current, `source-relations/source-asserted-${code}`);
      const mapping = catalog.mappings.find(item => item.source.propertyId === id)!;
      expect(mapping).toEqual({ source: { propertyId: id, datatype: "wikibase-item", revision, captureSha256 },
        target: target.ref, relation: "source-attribution", localMembershipInference: false, identityMerge: false, v: 2 });
      expect(target.domainConcepts).toEqual([entity]);
      expect(target.range).toEqual({ concepts: [entity], kind: "entity-concepts", v: 1 });
      expect(target.inversePredicate).toBeNull();
      expect(target.qualifierPredicates).toContainEqual(schema(current, "foundation/source-property").ref);
      expect(target.qualifierPredicates).toContainEqual(schema(current, "foundation/source-rank").ref);
      expect(target.qualifierPredicates).toContainEqual(schema(current, "foundation/source-statement").ref);
    }
    expect(Object.isFrozen(catalog.mappings)).toBe(true);
  });

  test("keeps the old mapping preview digest readable under its original verifier", async () => {
    const request = input(Object.fromEntries(["P31", "P279", "P361", "P999999"].map(id => [id, [statement(id)]])));
    const previous = unwrap(await createKnowledgeWikidataMappingPreviewV1(request));
    const current = unwrap(await createKnowledgeWikidataMappingPreviewV2(request));
    expect(previous.previewSha256).toBe("cb8df2c6eba1560dd18f09f0ff9b49c71860b31f3f3631f6a42de18f5b2b1c9e");
    expect(await verifyKnowledgeWikidataMappingPreviewV1(JSON.parse(JSON.stringify(previous)), request))
      .toEqual({ ok: true, value: previous });
    expect(current.v).toBe(2);
    expect(current.sourcePreviewSha256).toBe(previous.sourcePreviewSha256);
    expect(current.previewSha256).not.toBe(previous.previewSha256);
    expect((await verifyKnowledgeWikidataMappingPreviewV1(current, request)).ok).toBe(false);
    expect((await verifyKnowledgeWikidataMappingPreviewV2(previous, request)).ok).toBe(false);
  });
});

describe("source-relations mapping evidence", () => {
  test("maps all fifteen reviewed item relations while keeping each candidate unadmitted", async () => {
    const ids = ["P31", "P279", "P361", ...reviewed.map(([id]) => id)];
    const request = input(Object.fromEntries(ids.map(id => [id, [statement(id)]])));
    const source = unwrap(await createKnowledgeWikidataImportPreviewV2(request));
    const preview = unwrap(await createKnowledgeWikidataMappingPreviewV2(request));
    expect(preview.candidates).toHaveLength(15);
    expect(preview.gaps).toEqual([]);
    expect(preview.scope).toBe("retained-main-statements");
    expect(preview.sourcePreviewSha256).toBe(source.previewSha256);
    expect(preview.mappingCatalogSha256).toBe((await spongeKnowledgeWikidataMappingCatalogV2()).catalogSha256);
    expect(preview.candidates.map(candidate => candidate.mapping.source.propertyId).sort()).toEqual(ids.sort());
    expect(preview.candidates.map(candidate => candidate.source)).toEqual(source.sourceAssertions);
    for (const candidate of preview.candidates) {
      expect(candidate.status).toBe("requires-local-identity-and-proposal-review");
      expect(candidate.eligibleForAdmission).toBe(false);
      expect(candidate.normalization).toBe("none");
      expect(candidate.mapping.localMembershipInference).toBe(false);
      expect(candidate.mapping.identityMerge).toBe(false);
      expect(candidate.source.eligibleForAdmission).toBe(false);
      expect(candidate.source.interpretation).toBe("source-asserted");
      expect(candidate.object).toEqual({ entityId: "Q5", uri: "http://www.wikidata.org/entity/Q5" });
    }
    expect(await verifyKnowledgeWikidataMappingPreviewV2(JSON.parse(JSON.stringify(preview)), request))
      .toEqual({ ok: true, value: preview });
  });

  test("retains rank, qualifier order, repeated snaks and separate reference groups without promoting qualifier relations", async () => {
    const ordinal = { snaktype: "value", property: "P1545", datatype: "string", datavalue: { type: "string", value: "2" } };
    const author = { ...statement("P50"), rank: "deprecated", qualifiers: {
      P1545: [ordinal, ordinal], P175: [statement("P175").mainsnak], P580: [{ snaktype: "somevalue", property: "P580", datatype: "time" }],
    }, "qualifiers-order": ["P580", "P1545", "P175"], references: [
      { hash: "reference-one", snaks: { P854: [{ property: "P854", datatype: "url", snaktype: "value",
        datavalue: { type: "string", value: "https://example.org/first" } }] }, "snaks-order": ["P854"] },
      { hash: "reference-two", snaks: { P854: [{ property: "P854", datatype: "url", snaktype: "value",
        datavalue: { type: "string", value: "https://example.org/second" } }] }, "snaks-order": ["P854"] },
    ] };
    const request = input({ P50: [author], P170: [{ ...statement("P170"), rank: "preferred" }] });
    const preview = unwrap(await createKnowledgeWikidataMappingPreviewV2(request));
    expect(preview.candidates).toHaveLength(2);
    const retained = preview.candidates.find(candidate => candidate.mapping.source.propertyId === "P50")!;
    expect(retained.source.rawStatement).toEqual(author);
    expect(retained.source.rank).toBe("deprecated");
    expect(preview.candidates.find(candidate => candidate.mapping.source.propertyId === "P170")?.source.rank).toBe("preferred");
    expect(preview.candidates.some(candidate => candidate.mapping.source.propertyId === "P175")).toBe(false);
    expect(preview.candidates.every(candidate => !candidate.eligibleForAdmission)).toBe(true);
    const source = unwrap(await createKnowledgeWikidataImportPreviewV2(request));
    const occurrences = source.records.filter(record => record.kind === "snak" && record.selector.kind === "statement"
      && record.selector.propertyId === "P50").map(record => canonical(record.selector));
    expect(occurrences).toHaveLength(7);
    expect(new Set(occurrences).size).toBe(7);
    expect(await verifyKnowledgeWikidataMappingPreviewV2(JSON.parse(JSON.stringify(preview)), request))
      .toEqual({ ok: true, value: preview });
  });

  test("separates unknown values, no values, absent properties and omitted source groups", async () => {
    const missing = (state: "somevalue" | "novalue") => ({ ...statement("P50", `Q1$${state}`),
      mainsnak: { property: "P50", datatype: "wikibase-item", snaktype: state } });
    const request = input({ P50: [missing("somevalue"), missing("novalue")], P2302: [statement("P2302")] });
    const source = unwrap(await createKnowledgeWikidataImportPreviewV2(request));
    const preview = unwrap(await createKnowledgeWikidataMappingPreviewV2(request));
    expect(preview.candidates).toEqual([]);
    expect(preview.gaps).toHaveLength(3);
    expect(preview.gaps.map(gap => gap.reason).sort()).toEqual(["property-not-mapped", "source-value-not-an-item", "source-value-not-an-item"]);
    expect(source.records.filter(record => record.kind === "snak" && record.value.kind === "absence")
      .map(record => record.kind === "snak" && record.value.kind === "absence" ? record.value.state : null)).toEqual(["somevalue", "novalue"]);
    expect(preview.gaps.some(gap => gap.source.predicate.propertyId === "P175")).toBe(false);
    const selected = { ...input({ P50: [statement("P50")], P170: [statement("P170")] }), properties: ["P50"] };
    const selectedSource = unwrap(await createKnowledgeWikidataImportPreviewV2(selected));
    const selectedPreview = unwrap(await createKnowledgeWikidataMappingPreviewV2(selected));
    expect(selectedPreview.candidates).toHaveLength(1);
    expect(selectedPreview.gaps).toEqual([]);
    expect(selectedSource.omissions).toContainEqual(expect.objectContaining({ propertyId: "P170", reason: "property-not-selected" }));
    const bounded = { ...input({ P50: [statement("P50")], P170: [statement("P170")] }),
      bounds: { ...KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2, maxStatements: 1 } };
    const boundedSource = unwrap(await createKnowledgeWikidataImportPreviewV2(bounded));
    const boundedPreview = unwrap(await createKnowledgeWikidataMappingPreviewV2(bounded));
    expect(boundedPreview.candidates.length + boundedPreview.gaps.length).toBe(1);
    expect(boundedSource.omissions).toContainEqual(expect.objectContaining({ reason: "statement-bound", count: 1 }));
    expect(boundedSource.coverage.every(row => !row.definitiveAnswer)).toBe(true);
  });

  test("duplicate GUIDs cannot substitute values across properties or captures", async () => {
    const sameGuid = "Q1$duplicate";
    const first = capture({ P50: [statement("P50", sameGuid, "Q5", "string")], P170: [statement("P170", sameGuid, "Q6")] });
    const second = capture({ P50: [statement("P50", sameGuid, "Q7")], P170: [statement("P170", sameGuid, "Q8")] }, 11);
    const request = { ...input({}), captures: [first, second] };
    const preview = unwrap(await createKnowledgeWikidataMappingPreviewV2(request));
    const firstSha = await sha256Text(first.body);
    const secondSha = await sha256Text(second.body);
    expect(preview.candidates).toHaveLength(3);
    expect(preview.gaps).toHaveLength(1);
    expect(preview.gaps[0]?.source.captureSha256).toBe(firstSha);
    expect(preview.gaps[0]?.source.predicate.propertyId).toBe("P50");
    expect(preview.gaps[0]?.reason).toBe("source-value-not-an-item");
    expect(preview.candidates.map(candidate => `${candidate.source.captureSha256}:${candidate.source.predicate.propertyId}:${candidate.object.entityId}`).sort())
      .toEqual([`${firstSha}:P170:Q6`, `${secondSha}:P50:Q7`, `${secondSha}:P170:Q8`].sort());
    expect(preview.candidates.every(candidate => candidate.source.selector.statementId === sameGuid)).toBe(true);
  });

  test("caller labels and source constraints cannot select a mapping or create authority", async () => {
    const claims = { P50: [statement("P50")], P2302: [statement("P2302")] };
    const original = unwrap(await createKnowledgeWikidataMappingPreviewV2(input(claims)));
    const requested = { ...input(claims), mappingVersion: "sponge.wikidata-source-mappings.v999-installed-and-approved" };
    const relabeled = unwrap(await createKnowledgeWikidataMappingPreviewV2(requested));
    expect(relabeled.mappingCatalogSha256).toBe(original.mappingCatalogSha256);
    expect(relabeled.candidates).toEqual(original.candidates);
    expect(relabeled.gaps).toEqual(original.gaps);
    expect(relabeled.sourcePreviewSha256).not.toBe(original.sourcePreviewSha256);
    expect(relabeled.gaps[0]?.source.predicate.propertyId).toBe("P2302");
    expect((await createKnowledgeWikidataMappingPreviewV2({ ...requested, eligibleForAdmission: true })).ok).toBe(false);
  });

  const tamperCases: readonly (readonly [string, (preview: KnowledgeWikidataMappingPreviewV2) => unknown])[] = [
    ["target schema digest", preview => ({ ...preview, candidates: preview.candidates.map(candidate => ({ ...candidate,
      mapping: { ...candidate.mapping, target: { ...candidate.mapping.target, schemaSha256: "0".repeat(64) } } })) })],
    ["target namespace", preview => ({ ...preview, candidates: preview.candidates.map(candidate => ({ ...candidate,
      mapping: { ...candidate.mapping, target: { ...candidate.mapping.target, namespace: "sponge.music" } } })) })],
    ["object identity", preview => ({ ...preview, candidates: preview.candidates.map(candidate => ({ ...candidate,
      object: { entityId: "Q6", uri: "http://www.wikidata.org/entity/Q6" } })) })],
    ["catalog digest", preview => ({ ...preview, mappingCatalogSha256: "0".repeat(64) })],
    ["capture digest", preview => ({ ...preview, candidates: preview.candidates.map(candidate => ({ ...candidate,
      source: { ...candidate.source, captureSha256: "0".repeat(64) } })) })],
    ["statement selector", preview => ({ ...preview, candidates: preview.candidates.map(candidate => ({ ...candidate,
      source: { ...candidate.source, selector: { ...candidate.source.selector, statementIndex: 1 } } })) })],
    ["property revision", preview => ({ ...preview, candidates: preview.candidates.map(candidate => ({ ...candidate,
      mapping: { ...candidate.mapping, source: { ...candidate.mapping.source, revision: candidate.mapping.source.revision + 1 } } })) })],
    ["dropped gaps", preview => ({ ...preview, gaps: [] })],
    ["admission authority", preview => ({ ...preview, candidates: preview.candidates.map(candidate => ({ ...candidate, eligibleForAdmission: true })) })],
  ];
  test.each(tamperCases)("rejects transported %s tampering", async (_name, mutate) => {
    const request = input({ P50: [statement("P50")], P999999: [statement("P999999")] });
    const preview = unwrap(await createKnowledgeWikidataMappingPreviewV2(request));
    expect(await verifyKnowledgeWikidataMappingPreviewV2(mutate(preview), request))
      .toEqual({ ok: false, error: { code: "integrity-mismatch", field: "mapping-preview", retryable: false } });
  });
});

describe("source relationships retain their semantic scope", () => {
  test.each(reviewed)("%s compiles only with installed schemas and explicit entity identities", async (_id, code) => {
    const { catalog, draft, authority } = await compilerFixture(code);
    const compiled = await compileSpongeKnowledgeProposalV3(draft, authority);
    expect(compiled).not.toBeNull();
    const memberships = compiled!.bundle.records.filter(record => record.kind === "type-membership");
    expect(memberships).toHaveLength(2);
    expect(memberships.every(record => typeof record.value === "object" && record.value !== null && "concept" in record.value
      && canonical(record.value.concept) === canonical(schema(catalog, "core/entity").ref))).toBe(true);
    expect(compiled!.bundle.records.some(record => record.kind === "review-decision" || record.kind === "rights-decision")).toBe(false);
    expect(compiled!.bundle.records.filter(record => record.kind === "assertion").every(record => typeof record.value === "object"
      && record.value !== null && "state" in record.value && record.value.state === "proposed")).toBe(true);
    const stringObject: SpongeKnowledgeProposalValueV3 = { kind: "string", value: "Q5", v: 1 };
    expect(await compileSpongeKnowledgeProposalV3({ ...draft, facts: draft.facts.map(fact => ({ ...fact, object: stringObject })) }, authority)).toBeNull();
    const previous = await spongeKnowledgeDomainCatalogV2();
    expect(await compileSpongeKnowledgeProposalV3(draft, { ...authority, schemas: previous.schemas })).toBeNull();
  });

  test("source meanings stay distinct from constrained local relationships", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV3();
    const cases = [
      ["performer", "music/performs", [/performer/iu, /work|role/iu]],
      ["language-of-work-or-name", "language/translation-of-sense", [/language/iu, /work/iu, /name/iu]],
      ["version-edition-or-translation-of", "foundation/version-of", [/version/iu, /edition/iu, /translation/iu]],
      ["stock-exchange", "finance/lists-instrument", [/exchange/iu, /company/iu]],
      ["found-in-taxon", "substances/sample-of", [/taxon/iu]],
      ["programmed-in", "software/uses-configuration", [/programming language/iu]],
    ] as const;
    for (const [code, local, concepts] of cases) {
      const source = predicate(catalog, `source-relations/source-asserted-${code}`);
      const constrained = predicate(catalog, local);
      expect(source.ref).not.toEqual(constrained.ref);
      const definition = source.definitions.map(item => item.text).join(" ");
      for (const concept of concepts) expect(definition).toMatch(concept);
      if (local !== "foundation/version-of") {
        const { draft, authority } = await compilerFixture(code);
        expect(await compileSpongeKnowledgeProposalV3({ ...draft, facts: draft.facts.map(fact => ({ ...fact,
          predicate: constrained.ref })) }, authority)).toBeNull();
      }
    }
    expect(predicate(catalog, "source-relations/source-asserted-has-part").inversePredicate).toBeNull();
    expect(predicate(catalog, "source-relations/source-asserted-author").ref)
      .not.toEqual(predicate(catalog, "source-relations/source-asserted-creator").ref);
  });
});
