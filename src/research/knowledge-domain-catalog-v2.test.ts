import { describe, expect, test } from "bun:test";
import { canonicalJson, type JsonValue } from "./document-domain";
import { parseSha256Hex, sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeDomainCatalog } from "./knowledge-domain-catalog";
import { spongeKnowledgeDomainCatalogV2, type SpongeKnowledgeDomainCatalogV2 } from "./knowledge-domain-catalog-v2";
import { createKnowledgeRightsDecisionV1, createKnowledgeTypeMembershipV1,
  evaluateKnowledgeShapeV1, parseKnowledgeGraphRecordV1, type KnowledgePredicateRevisionV1,
  type KnowledgeSchemaRevisionV1 } from "./knowledge-ontology-contract-v1";
import { createKnowledgeAssertionV1, parseKnowledgeEntityId, type KnowledgeEntityV1,
  type KnowledgeOntologyResult, type KnowledgeValueV1 } from "./knowledge-ontology-v1";
import { compileSpongeKnowledgeProposalV3, type SpongeKnowledgeProposalCompilerAuthorityV3 } from "./knowledge-proposal-compiler-v3";
import type { SpongeKnowledgeProposalDraftV3, SpongeKnowledgeProposalValueV3 } from "./knowledge-proposal-v3";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

function unwrap<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid test fixture ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function schema(catalog: SpongeKnowledgeDomainCatalogV2, identity: string): KnowledgeSchemaRevisionV1 {
  const found = catalog.schemas.find(item => `${item.identity.namespace.slice(7)}/${item.identity.code}` === identity);
  if (found === undefined) throw new Error(`Missing test schema ${identity}.`);
  return found;
}
async function fixture(subjectConcepts: readonly string[], predicateIdentity: string, target: string | KnowledgeValueV1) {
  const catalog = await spongeKnowledgeDomainCatalogV2();
  const core = await spongeCoreKnowledgeCatalogV1();
  const actorId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const entity: KnowledgeEntityV1 = { entityId: actorId, identityOperationId: "identity.qualified-profile-test",
    identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
  const object: SpongeKnowledgeProposalValueV3 = typeof target === "string"
    ? { kind: "entity-key", entityKey: "object" } : target;
  const draft: SpongeKnowledgeProposalDraftV3 = { v: 3, contexts: [], evidence: [], vocabularyDependencies: [],
    entities: [{ key: "subject", kind: "new", concepts: subjectConcepts.map(identity => schema(catalog, identity).ref),
      name: { language: "en", text: "Synthetic subject" } },
    ...(typeof target === "string" ? [{ key: "object", kind: "new" as const, concepts: [schema(catalog, target).ref],
      name: { language: "en", text: "Synthetic object" } }] : [])],
    facts: [{ key: "relation", subject: { kind: "key", key: "subject" }, predicate: schema(catalog, predicateIdentity).ref,
      object, qualifiers: [], contextKey: null, stance: "reports" }],
  };
  const authority: SpongeKnowledgeProposalCompilerAuthorityV3 = {
    externalOperationReceiptSha256: await sha256Text("qualified domain profile test receipt"), authorEntityId: actorId,
    authoringPolicySha256: core.rightsPolicySha256, occurredAt: "2026-09-13T00:00:00.000Z",
    spaceId: "space.qualified-profile-test", schemas: catalog.schemas,
    existingEntities: new Map([[actorId, { entity, concepts: [schema(catalog, "core/agent").ref] }]]),
  };
  return { catalog, draft, authority };
}

// Independently stated competency cases cover every domain relation, including intentional broad targets.
const relationCases = [
  ["language", "lexeme", "has-form", "language/form"],
  ["language", "lexeme", "has-sense", "language/sense"],
  ["language", "sense", "translation-of-sense", "language/sense"],
  ["language", "lexeme", "attested-in", "language/text-occurrence"],
  ["culture", "depiction", "depicts", "natural-world/taxon"],
  ["culture", "reference-occurrence", "alludes-to", "music/musical-work"],
  ["culture", "reference-occurrence", "named-after", "core/person"],
  ["culture", "reference-occurrence", "interpreted-as", "culture/motif"],
  ["natural-world", "physical-occurrence", "classified-under", "natural-world/natural-class"],
  ["natural-world", "observation", "observes", "natural-world/physical-occurrence"],
  ["natural-world", "observation", "observed-at", "core/place"],
  ["natural-world", "physical-occurrence", "has-feature", "natural-world/feature"],
  ["body", "bodily-phenomenon", "involves-structure", "body/anatomical-structure"],
  ["body", "experience-report", "reports-experience", "body/bodily-phenomenon"],
  ["body", "study-population", "estimates-prevalence", { kind: "decimal", value: "0.125", v: 1 }],
  ["body", "bodily-phenomenon", "proposes-mechanism", "body/mechanism-hypothesis"],
  ["research", "study", "tests", "substances/molecular-identity"],
  ["research", "study", "uses-method", "research/method"],
  ["research", "study", "produces-finding", "research/finding"],
  ["research", "correction", "supersedes", "research/publication-version"],
  ["substances", "sample", "sample-of", "substances/batch"],
  ["substances", "batch", "batch-of", "substances/product"],
  ["substances", "assay", "assays", "substances/sample"],
  ["substances", "offer", "offered-by", "organizations/legal-entity"],
  ["organizations", "legal-entity", "operates", "organizations/brand"],
  ["organizations", "role-assignment", "held-by", "core/person"],
  ["organizations", "announcement", "announces", "organizations/transaction"],
  ["organizations", "completion", "completes", "organizations/transaction"],
  ["editorial", "article", "reports-on", "natural-world/physical-occurrence"],
  ["editorial", "edition", "contains-placement", "editorial/placement"],
  ["editorial", "placement", "ranks-under", "editorial/ranking-assessment"],
  ["editorial", "article", "updates", "editorial/article"],
  ["software", "run", "evaluated-under", "software/benchmark-protocol"],
  ["software", "run", "uses-configuration", "software/configuration"],
  ["software", "run", "uses-dataset", "software/dataset-version"],
  ["software", "run", "produces", "software/measurement"],
  ["music", "performance", "performs", "music/arrangement"],
  ["music", "recording", "records", "music/performance"],
  ["music", "track", "appears-on", "music/release"],
  ["music", "similarity-assessment", "similar-under", "music/recording"],
  ["people", "public-profile-document", "describes-person", "core/person"],
  ["people", "profile-projection", "derived-from-record", "people/source-contact-record"],
  ["people", "interaction", "involves-person", "core/person"],
  ["people", "relationship-account", "accounts-for", "people/relationship"],
  ["finance", "instrument", "issued-by", "finance/issuer"],
  ["finance", "listing", "lists-instrument", "finance/instrument"],
  ["finance", "backtest-run", "tests-strategy", "finance/strategy-version"],
  ["finance", "backtest-run", "uses-dataset", "software/dataset-version"],
  ["formal-systems", "simulation", "instantiates", "formal-systems/rule-set-version"],
  ["formal-systems", "simulation", "starts-from", "formal-systems/initial-state"],
  ["formal-systems", "state-snapshot", "observed-at-tick", { kind: "integer", value: "4096", v: 1 }],
  ["formal-systems", "conjecture", "has-proof", "formal-systems/proof-artifact"],
  ["agent-work", "attempt", "uses-skill", "agent-work/skill-version"],
  ["agent-work", "attempt", "attempts", "agent-work/task"],
  ["agent-work", "attempt", "produces", "agent-work/trajectory"],
  ["agent-work", "attempt", "validated-by", "agent-work/check-result"],
] as const;
const deliberatelyOpenTargets = new Set(["culture/depicts", "culture/alludes-to", "culture/named-after", "research/tests"]);

describe("qualified domain catalog V2", () => {
  test("retains every published V1 byte and pins explicit revision lineage", async () => {
    const legacy = await spongeKnowledgeDomainCatalog();
    const catalog = await spongeKnowledgeDomainCatalogV2();
    expect<string>(await sha256Text(canonicalJson(catalog.historicalPacks as unknown as JsonValue)))
      .toBe("f46f14f829ab6d41a91988dd35a9f3b0423064c22c3d639169757a5a9b3c6d1a");
    expect(catalog.historicalPacks).toEqual(legacy.packs);
    expect(catalog.corePack).toEqual(legacy.corePack);
    expect(catalog.referencePack).toEqual(legacy.referencePack);
    expect(catalog.packs).toHaveLength(17);
    expect(catalog.lock.packs).toHaveLength(17);
    for (const pack of catalog.packs.filter(item => item.revision === 2)) {
      const previous = legacy.packs.find(item => item.packId === pack.packId)!;
      expect(pack.previousManifestSha256).toBe(previous.manifestSha256);
      expect(pack.vocabulary.previousRevisionSha256).toBe(previous.vocabulary.revisionSha256);
      for (const prior of previous.schemas) {
        const latest = pack.schemas.find(item => item.identity.code === prior.identity.code)!;
        expect(latest.identity.revision).toBe(2);
        expect(latest.previousRevisionSha256).toBe(prior.revisionSha256);
        expect(latest.vocabularySha256).toBe(pack.vocabulary.revisionSha256);
        expect(latest.revisionSha256).not.toBe(prior.revisionSha256);
      }
      for (const added of pack.schemas.filter(item => item.identity.revision === 1)) expect(added.previousRevisionSha256).toBeNull();
      expect(pack.dependencies).toEqual([catalog.corePack, catalog.foundationPack, catalog.referencePack].map(knowledgeVocabularyPackPinV1));
    }
    expect(catalog.packs.filter(item => item.revision === 2)).toHaveLength(14);
    expect(catalog.schemas.every(item => item.reviewDecisionSha256 === null)).toBe(true);
    expect(Object.isFrozen(catalog.historicalPacks)).toBe(true);
  });

  test("new profiles resolve independently and alongside unchanged historical profiles", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV2();
    for (const pack of catalog.packs.filter(item => item.revision === 2)) {
      const resolution = await resolveKnowledgeVocabularyPacksV1({ manifests: [catalog.corePack, catalog.referencePack, catalog.foundationPack, pack], roots: [knowledgeVocabularyPackPinV1(pack)] });
      expect(resolution.ok).toBe(true);
    }
    const newMusic = catalog.packs.find(item => item.packId === "sponge.music")!;
    const historicalLanguage = catalog.historicalPacks.find(item => item.packId === "sponge.language")!;
    expect((await resolveKnowledgeVocabularyPacksV1({
      manifests: [catalog.corePack, catalog.referencePack, catalog.foundationPack, historicalLanguage, newMusic],
      roots: [historicalLanguage, newMusic].map(knowledgeVocabularyPackPinV1),
    })).ok).toBe(true);
  });

  test("competency cases account for every domain predicate and every predicate has an optional executable rule", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV2();
    const covered = relationCases.map(([domain, , predicate]) => `${domain}/${predicate}`).sort();
    const actual: string[] = [];
    for (const pack of catalog.packs.filter(item => item.revision === 2)) {
      for (const predicate of pack.schemas.filter((item): item is KnowledgePredicateRevisionV1 => item.kind === "predicate")) {
        actual.push(`${pack.packId.slice(7)}/${predicate.identity.code}`);
        const rules = pack.shapes.flatMap(shape => shape.rules).filter(rule => rule.predicate.schemaSha256 === predicate.ref.schemaSha256);
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules) {
          expect(rule.cardinality.minimum).toBe(0);
          expect(rule.range).toEqual(predicate.range);
        }
      }
      for (const shape of pack.shapes) expect((await parseKnowledgeGraphRecordV1("shape", shape)).ok).toBe(true);
    }
    expect(actual.sort()).toEqual(covered);
    expect(covered).toHaveLength(56);
  });

  test.each(relationCases)("compiles %s/%s %s with its appropriate target and rejects wrong subject or value", async (domain, subject, predicate, target) => {
    const identity = `${domain}/${predicate}`;
    const { draft, authority } = await fixture([`${domain}/${subject}`], identity, target);
    const acceptedDraft = await compileSpongeKnowledgeProposalV3(draft, authority);
    expect(acceptedDraft).not.toBeNull();
    expect(acceptedDraft?.bundle.records.filter(record => record.kind === "assertion").every(record =>
      typeof record.value === "object" && record.value !== null && "state" in record.value && record.value.state === "proposed")).toBe(true);
    const wrongSubject = await fixture(["core/entity"], identity, target);
    expect(await compileSpongeKnowledgeProposalV3(wrongSubject.draft, authority)).toBeNull();
    const wrongTarget = await fixture([`${domain}/${subject}`], identity,
      deliberatelyOpenTargets.has(identity) ? { kind: "string", value: "unidentified target", v: 1 } : "core/entity");
    expect(await compileSpongeKnowledgeProposalV3(wrongTarget.draft, authority)).toBeNull();
  });

  test("a recording rejects a taxon, while an explicitly multiple-typed target may be a performance", async () => {
    const invalid = await fixture(["music/recording"], "music/records", "natural-world/taxon");
    expect(await compileSpongeKnowledgeProposalV3(invalid.draft, invalid.authority)).toBeNull();
    const multipleTypes = { ...invalid.draft, entities: invalid.draft.entities.map(entity => entity.key !== "object" || entity.kind !== "new"
      ? entity : { ...entity, concepts: [...entity.concepts, schema(invalid.catalog, "music/performance").ref] }) };
    expect(await compileSpongeKnowledgeProposalV3(multipleTypes, invalid.authority)).not.toBeNull();
    const material = await fixture(["substances/sample"], "substances/sample-of", "substances/material");
    expect(await compileSpongeKnowledgeProposalV3(material.draft, material.authority)).not.toBeNull();
    const cloudScheme = await fixture(["natural-world/physical-occurrence"], "natural-world/classified-under", "natural-world/classification-scheme");
    expect(await compileSpongeKnowledgeProposalV3(cloudScheme.draft, cloudScheme.authority)).toBeNull();
  });

  test("compiles real catalog units, calendars, coordinate systems and identifier schemes without injected schemas", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV2();
    const units = ["meter", "second", "kilogram", "gram", "milligram", "kelvin", "celsius", "dimensionless", "percent", "count"];
    for (const code of units) {
      const quantity: KnowledgeValueV1 = { kind: "quantity", value: "2.5", lowerBound: "2.4", upperBound: "2.6",
        uncertainty: null, unit: schema(catalog, `foundation/${code}`).ref, v: 1 };
      const positive = await fixture(["foundation/measurement"], "foundation/normalized-quantity", quantity);
      expect(await compileSpongeKnowledgeProposalV3(positive.draft, positive.authority)).not.toBeNull();
      expect(await compileSpongeKnowledgeProposalV3(positive.draft, { ...positive.authority,
        schemas: positive.authority.schemas.filter(item => item.ref.schemaSha256 !== quantity.unit.schemaSha256) })).toBeNull();
    }
    expect(schema(catalog, "foundation/celsius")).toMatchObject({ kind: "unit", dimension: "temperature", offset: "273.15", scale: "1" });
    expect(schema(catalog, "foundation/milligram")).toMatchObject({ kind: "unit", dimension: "mass", offset: "0", scale: "0.000001" });
    const values: readonly (readonly [string, KnowledgeValueV1])[] = [
      ["normalized-time", { kind: "time", calendar: schema(catalog, "reference/gregorian-calendar").ref,
        certainty: "exact", earliest: null, latest: null, precision: "year", timezone: null, value: "2026", v: 1 }],
      ["normalized-time", { kind: "time", calendar: schema(catalog, "foundation/julian-calendar").ref,
        certainty: "approximate", earliest: null, latest: null, precision: "year", timezone: null, value: "1500", v: 1 }],
      ["normalized-location", { kind: "geometry", coordinates: [["-66.1", "18.4"]],
        crs: schema(catalog, "foundation/wgs84-geographic-crs").ref, geometryType: "point", precisionMeters: "10", v: 1 }],
    ];
    for (const [predicate, value] of values) {
      const positive = await fixture(["core/entity"], `foundation/${predicate}`, value);
      const result = await compileSpongeKnowledgeProposalV3(positive.draft, positive.authority);
      expect(result).not.toBeNull();
      expect(result?.bundle.records.filter(record => record.kind === "statement").map(record => record.value))
        .toContainEqual(expect.objectContaining({ object: value }));
    }
    for (const [scheme, value] of [["wikidata-item", "Q1"], ["wikidata-property", "P31"], ["wikidata-lexeme", "L1"],
      ["wikidata-form", "L1-F1"], ["wikidata-sense", "L1-S1"], ["wikidata-entity-schema", "E1"],
      ["wikidata-statement", "Q1$00000000-0000-0000-0000-000000000001"], ["doi", "10.1000/182"], ["orcid", "0000-0002-1825-0097"]]) {
      const positive = await fixture(["core/entity"], "foundation/external-identifier", {
        kind: "identifier", scheme: schema(catalog, `foundation/${scheme}`).ref, value: value!, v: 1,
      });
      expect(await compileSpongeKnowledgeProposalV3(positive.draft, positive.authority)).not.toBeNull();
    }
  });

  test("source membership, subclass and part statements remain distinct unaccepted assertions", async () => {
    for (const relation of ["source-asserted-instance-of", "source-asserted-subclass-of", "source-asserted-part-of"]) {
      const { catalog, draft, authority } = await fixture(["core/entity"], `foundation/${relation}`, "core/entity");
      const qualified = { ...draft, facts: draft.facts.map(fact => ({ ...fact, qualifiers: [
        { predicate: schema(catalog, "foundation/source-property").ref, value: { kind: "identifier" as const,
          scheme: schema(catalog, "foundation/wikidata-property").ref,
          value: relation === "source-asserted-instance-of" ? "P31" : relation === "source-asserted-subclass-of" ? "P279" : "P361", v: 1 as const } },
        { predicate: schema(catalog, "foundation/source-rank").ref, value: { kind: "string" as const, value: "preferred", v: 1 as const } },
      ] })) };
      const result = await compileSpongeKnowledgeProposalV3(qualified, authority);
      expect(result).not.toBeNull();
      const memberships = result!.bundle.records.filter(record => record.kind === "type-membership");
      expect(memberships).toHaveLength(2);
      expect(memberships.every(record => typeof record.value === "object" && record.value !== null && "concept" in record.value
        && canonicalJson(record.value.concept as JsonValue) === canonicalJson(schema(catalog, "core/entity").ref as unknown as JsonValue))).toBe(true);
      expect(result!.bundle.records.some(record => record.kind === "review-decision" || record.kind === "rights-decision")).toBe(false);
      expect(result!.bundle.records.filter(record => record.kind === "statement").map(record => record.value))
        .toContainEqual(expect.objectContaining({ predicate: schema(catalog, `foundation/${relation}`).ref }));
    }
  });

  test("an optional profile accepts a partial reviewed entity while public disclosure stays blocked", async () => {
    const { catalog, draft, authority } = await fixture(["music/recording"], "music/records", "music/performance");
    const compiled = await compileSpongeKnowledgeProposalV3(draft, authority);
    if (compiled === null) throw new Error("Expected compilable shape fixture.");
    const proposed = await Promise.all(compiled.bundle.records.filter(record => record.kind === "assertion")
      .map(async record => unwrap(await parseKnowledgeGraphRecordV1("assertion", record.value)).value));
    const assertions = await Promise.all(proposed.map(async assertion => {
      const { assertionSha256: _digest, ...input } = assertion;
      return unwrap(await createKnowledgeAssertionV1({ ...input, acceptedPurposes: ["private-research"],
        state: "accepted-for-purpose", reviewActivitySha256: await sha256Text("synthetic reviewer activity") }));
    }));
    const memberships = await Promise.all(compiled.bundle.records.filter(record => record.kind === "type-membership").map(async record => {
      const { membershipSha256: _digest, ...input } = unwrap(await parseKnowledgeGraphRecordV1("type-membership", record.value)).value;
      const index = proposed.findIndex(assertion => assertion.assertionSha256 === input.assertionSha256);
      return unwrap(await createKnowledgeTypeMembershipV1({ ...input, assertionSha256: assertions[index]!.assertionSha256 }));
    }));
    const statements = await Promise.all(compiled.bundle.records.filter(record => record.kind === "statement")
      .map(async record => unwrap(await parseKnowledgeGraphRecordV1("statement", record.value)).value));
    const shape = catalog.packs.find(pack => pack.packId === "sponge.music")!.shapes.find(shape => shape.shape.code === "recording")!;
    const input = { assertions, disclosure: "private" as const, entityId: compiled.entityIds["subject"]!, evidence: [],
      memberships, purpose: "private-research", rightsDecisions: [], rootShape: shape.shape, shapes: [shape], statements };
    const partial = await evaluateKnowledgeShapeV1({ ...input, statements: statements.filter(statement => statement.predicate.code === "name") });
    expect(partial.passed).toBe(true);
    const denied = await evaluateKnowledgeShapeV1({ ...input, disclosure: "public" });
    expect(denied.passed).toBe(false);
    expect(denied.violations.map(violation => violation.code)).toContain("privacy-denied");
    const rightsDecisions = await Promise.all(statements.map(statement => createKnowledgeRightsDecisionV1({
      actorEntityId: parseKnowledgeEntityId(authority.authorEntityId)!, allowedDisclosures: ["private"], decidedAt: authority.occurredAt,
      policySha256: parseSha256Hex(authority.authoringPolicySha256)!, purposes: ["private-research"], subjectSha256: statement.statementSha256, v: 1,
    }).then(unwrap)));
    expect((await evaluateKnowledgeShapeV1({ ...input, rightsDecisions })).passed).toBe(true);
  });
});
