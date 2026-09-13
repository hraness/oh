import { expect, test } from "bun:test";
import fc from "fast-check";
import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeDomainCatalog } from "./knowledge-domain-catalog";
import { createKnowledgeSchemaRevisionV1, type KnowledgeSchemaRevisionV1 } from "./knowledge-ontology-contract-v1";
import { parseKnowledgeEntityId, type KnowledgeValueV1, type KnowledgeEntityV1 } from "./knowledge-ontology-v1";
import { parseSpongeKnowledgeProposalDraftV3, type SpongeKnowledgeProposalDraftV3 } from "./knowledge-proposal-v3";
import { compileSpongeKnowledgeProposalV3, type SpongeKnowledgeProposalCompilerAuthorityV3 } from "./knowledge-proposal-compiler-v3";
import { createKnowledgePreservedValueV1 } from "./knowledge-value-codecs-v1";

async function fixture() {
  const core = await spongeCoreKnowledgeCatalogV1();
  const concept = core.concepts.find((item) => item.identity.code === "entity")!;
  const object = core.predicates.find((item) => item.identity.code === "object")!;
  const actorId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const sourceId = parseKnowledgeEntityId(`kent_${"b".repeat(24)}`)!;
  const existingEntity = (entityId: typeof actorId): KnowledgeEntityV1 => ({ entityId, identityOperationId: "identity.fixture",
    identityRevision: 1, redirectEntityId: null, state: "active", v: 1 });
  const relationResult = await createKnowledgeSchemaRevisionV1({ kind: "predicate",
    identity: { namespace: "synthetic.external", code: "qualified-object", revision: 1, v: 1 },
    labels: [{ language: "en", text: "Qualified object", v: 1 }],
    definitions: [{ language: "en", text: "Synthetic predicate accepting a qualified value.", v: 1 }],
    previousRevisionSha256: null, reviewDecisionSha256: null, v: 1, vocabularySha256: core.vocabulary.revisionSha256,
    domainConcepts: [concept.ref], inversePredicate: null, qualifierPredicates: [object.ref], range: { kind: "any", v: 1 },
  });
  if (!relationResult.ok) throw new Error("Invalid synthetic schema.");
  const relation = relationResult.value;
  const draft: SpongeKnowledgeProposalDraftV3 = { v: 3,
    entities: [{ kind: "new", key: "horse", concepts: [concept.ref], name: { language: "en", text: "Horse" } },
      { kind: "existing", key: "source", entityId: sourceId }],
    contexts: [{ key: "hypothesis", scenario: "hypothetical", dimensions: [
      { predicate: object.ref, value: { kind: "string", value: "synthetic conditions", v: 1 } },
    ] }],
    facts: [{ key: "finding", subject: { kind: "key", key: "horse" }, predicate: relation.ref,
      object: { kind: "entity-key", entityKey: "source" }, stance: "reports", contextKey: "hypothesis",
      qualifiers: [{ predicate: object.ref, value: { kind: "integer", value: "42", v: 1 } }] }],
    evidence: [{ key: "support", factKey: "finding", source: { kind: "existing", entityId: sourceId },
      bearing: "supports", selector: "section 2", attribution: { kind: "agent-supplied", sourceUri: "https://example.org/source" } }],
    vocabularyDependencies: [relation.ref],
  };
  const authority: SpongeKnowledgeProposalCompilerAuthorityV3 = {
    externalOperationReceiptSha256: await sha256Text("external operation receipt"), authorEntityId: actorId,
    authoringPolicySha256: core.rightsPolicySha256, occurredAt: "2026-09-13T00:00:00.000Z", spaceId: "space.synthetic",
    schemas: [...core.schemas, relation], existingEntities: new Map([
      [actorId, { entity: existingEntity(actorId), concepts: [concept.ref] }],
      [sourceId, { entity: existingEntity(sourceId), concepts: [concept.ref] }],
    ]),
  };
  return { draft, authority, core, concept, relation, object, sourceId };
}

test("external compilation preserves qualifiers, contexts, trusted existing identity, and proposed/private attribution", async () => {
  const { draft, authority, sourceId, relation } = await fixture();
  const result = await compileSpongeKnowledgeProposalV3(draft, authority);
  expect(result).not.toBeNull();
  if (result === null) return;
  expect(result.entityIds["source"]).toBe(sourceId);
  expect(result.bundle.records.filter((record) => record.kind === "entity")).toHaveLength(1);
  const statements = result.bundle.records.filter((record) => record.kind === "statement");
  expect(statements.map((record) => record.value)).toContainEqual(expect.objectContaining({ predicate: relation.ref,
    object: { kind: "entity", entityId: sourceId, v: 1 }, qualifiers: [expect.objectContaining({ value: { kind: "integer", value: "42", v: 1 } })] }));
  const context = result.bundle.records.find((record) => record.kind === "context");
  expect(context?.value).toMatchObject({ scenario: "hypothetical" });
  const assertions = result.bundle.records.filter((record) => record.kind === "assertion");
  expect(assertions.every((record) => typeof record.value === "object" && record.value !== null
    && "state" in record.value && record.value.state === "proposed")).toBe(true);
  expect(result.bundle.records.find((record) => record.kind === "evidence")?.value)
    .toMatchObject({ disclosure: "private", observationSha256: null, sourceEntityId: sourceId });
  expect(result.sourceAttributions[0]).toMatchObject({ kind: "agent-supplied", sourceUri: "https://example.org/source", selector: "section 2" });
  expect(result.bundle.records.find((record) => record.kind === "activity")?.value)
    .toMatchObject({ actor: { kind: "entity", entityId: authority.authorEntityId },
      inputSha256s: expect.not.arrayContaining([authority.externalOperationReceiptSha256]) });
  expect(JSON.stringify(result.bundle.records.filter((record) => record.kind === "context")))
    .toContain(`urn:sponge:external-operation:sha256:${authority.externalOperationReceiptSha256}`);
  expect(result.schemaCandidates).toEqual([{ status: "unreviewed", schema: relation }]);
  expect(result.bundle.records.some((record) => record.kind === "schema" || record.kind === "vocabulary")).toBe(false);
});

test("all literal value families survive compilation including list references, media, time and preserved extensions", async () => {
  const { draft, authority, concept, core, sourceId } = await fixture();
  const domain = await spongeKnowledgeDomainCatalog();
  const unitResult = await createKnowledgeSchemaRevisionV1({ kind: "unit",
    identity: { namespace: "synthetic.external", code: "unit", revision: 1, v: 1 }, labels: [{ language: "en", text: "Unit", v: 1 }],
    definitions: [{ language: "en", text: "Synthetic unit", v: 1 }], previousRevisionSha256: null,
    reviewDecisionSha256: null, vocabularySha256: core.vocabulary.revisionSha256, v: 1,
    dimension: "length", offset: "0", scale: "1", symbol: "m" });
  if (!unitResult.ok) throw new Error("Invalid fixture unit.");
  const unit = unitResult.value;
  const extensionResult = await createKnowledgePreservedValueV1({ kind: "missing-value", state: "somevalue",
    captureSha256: await sha256Text("synthetic capture"), occurrence: "Q1$1/qualifiers/P1/0", v: 1 });
  if (!extensionResult.ok) throw new Error("Invalid fixture extension.");
  const time = { kind: "time", calendar: concept.ref, certainty: "exact", earliest: null, latest: null,
    precision: "year", timezone: null, value: "2026", v: 1 } as const;
  const literals: KnowledgeValueV1[] = [
    { kind: "text", language: "en", text: "Horse", v: 1 }, { kind: "string", value: "source value", v: 1 },
    { kind: "boolean", value: true, v: 1 }, { kind: "integer", value: "42", v: 1 },
    { kind: "decimal", value: "42.1", v: 1 }, { kind: "quantity", value: "42.1", lowerBound: "42",
      upperBound: "42.2", unit: unit.ref, uncertainty: { kind: "absolute", minus: "0.1", plus: "0.1", v: 1 }, v: 1 },
    time, { kind: "interval", start: time, end: null, v: 1 },
    { kind: "duration", iso8601: "PT1H", v: 1 }, { kind: "recurrence", calendar: concept.ref,
      startsAt: time, rule: "FREQ=YEARLY", v: 1 },
    { kind: "geometry", coordinates: [["1", "2"]], crs: concept.ref, geometryType: "point", precisionMeters: "1", v: 1 },
    { kind: "uri", uri: "https://example.org/", v: 1 }, { kind: "identifier", scheme: concept.ref, value: "A-1", v: 1 },
    { kind: "media", mediaType: "image/png", sourceEntityId: sourceId, sourceSha256: await sha256Text("synthetic image"), v: 1 },
    { kind: "entity", entityId: sourceId, v: 1 }, { kind: "list", values: [{ kind: "string", value: "ordered", v: 1 }], v: 1 },
    { kind: "set", values: [{ kind: "integer", value: "1", v: 1 }], v: 1 }, extensionResult.value,
  ];
  const values = [...literals, { kind: "list" as const, values: [{ kind: "entity-key" as const, entityKey: "horse" }], v: 1 as const }];
  const facts = values.map((object, index) => ({ ...draft.facts[0]!, key: `value.${index}`, object }));
  const result = await compileSpongeKnowledgeProposalV3({ ...draft, facts, evidence: [] }, {
    ...authority, schemas: [...authority.schemas, unit, ...domain.referencePack.schemas],
  });
  expect(result).not.toBeNull();
  if (result === null) return;
  const compiled = result.bundle.records.filter((record) => record.kind === "statement").map((record) => record.value);
  for (const literal of literals) expect(compiled).toContainEqual(expect.objectContaining({ object: literal }));
  expect(compiled).toContainEqual(expect.objectContaining({ object: {
    kind: "list", v: 1, values: [{ kind: "entity", entityId: result.entityIds["horse"], v: 1 }],
  } }));
});

test("untrusted entities, media, forged schema refs, undeclared qualifiers and extension digests are rejected", async () => {
  const { draft, authority, concept } = await fixture();
  const unauthorized = parseKnowledgeEntityId(`kent_${"c".repeat(24)}`)!;
  const mutateObject = (object: unknown) => ({ ...draft, facts: [{ ...draft.facts[0], object }] });
  const cases = [
    { ...draft, entities: [{ kind: "existing", key: "source", entityId: unauthorized }] },
    { ...draft, facts: [{ ...draft.facts[0], subject: { kind: "existing", entityId: unauthorized } }] },
    mutateObject({ kind: "entity", entityId: unauthorized, v: 1 }),
    mutateObject({ kind: "list", values: [{ kind: "entity", entityId: unauthorized, v: 1 }], v: 1 }),
    mutateObject({ kind: "media", mediaType: "image/png", sourceEntityId: unauthorized, sourceSha256: await sha256Text("x"), v: 1 }),
    { ...draft, facts: [{ ...draft.facts[0], predicate: { ...draft.facts[0]!.predicate, schemaSha256: await sha256Text("wrong") } }] },
    { ...draft, facts: [{ ...draft.facts[0], qualifiers: [{ predicate: concept.ref, value: { kind: "integer", value: "1", v: 1 } }] }] },
    mutateObject({ kind: "extension", schema: concept.ref, canonicalizerSha256: await sha256Text("test"),
      canonicalValue: '{"v":1}', valueSha256: await sha256Text("wrong"), mediaType: "application/json", v: 1 }),
    { ...draft, state: "accepted-for-purpose" },
    { ...draft, evidence: [{ ...draft.evidence[0], attribution: { kind: "verified-capture", sourceUri: null } }] },
  ];
  for (const value of cases) expect(await compileSpongeKnowledgeProposalV3(value, authority)).toBeNull();
});

test("domain, range and record limits hold while proposed memberships are sufficient for draft validation", async () => {
  const { draft, authority, relation, core } = await fixture();
  const other = core.concepts.find((item) => item.identity.code === "person")!;
  const domainResult = await createKnowledgeSchemaRevisionV1({ kind: "predicate", domainConcepts: [other.ref],
    identity: relation.identity, definitions: relation.definitions, labels: relation.labels,
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: relation.vocabularySha256, v: 1,
    inversePredicate: null, qualifierPredicates: [], range: { kind: "numeric", lowerBound: "0", upperBound: "1", unit: null, v: 1 } });
  if (!domainResult.ok) throw new Error("Invalid range fixture.");
  const schemas: KnowledgeSchemaRevisionV1[] = [...authority.schemas.filter((item) => item !== relation), domainResult.value];
  expect(await compileSpongeKnowledgeProposalV3({ ...draft, vocabularyDependencies: [], facts: [{ ...draft.facts[0],
    predicate: domainResult.value.ref, qualifiers: [], object: { kind: "integer", value: "2", v: 1 } }] },
  { ...authority, schemas })).toBeNull();
  expect(await compileSpongeKnowledgeProposalV3({ ...draft, evidence: [], facts: Array.from({ length: 128 }, (_, index) => ({
    ...draft.facts[0]!, key: `fact.${index}`,
  })) }, authority)).toBeNull();
  expect(await compileSpongeKnowledgeProposalV3(draft, authority)).not.toBeNull();
});

test("canonical draft order gives stable entity reuse and replay receipts", async () => {
  const { draft, authority } = await fixture();
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), async (reverseEntities, reverseDimensions) => {
    const reordered = { ...draft, entities: reverseEntities ? [...draft.entities].reverse() : draft.entities,
      contexts: draft.contexts.map((context) => ({ ...context,
        dimensions: reverseDimensions ? [...context.dimensions].reverse() : context.dimensions })) };
    const first = await compileSpongeKnowledgeProposalV3(draft, authority);
    const second = await compileSpongeKnowledgeProposalV3(reordered, authority);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    const canonical = parseSpongeKnowledgeProposalDraftV3(draft);
    expect(parseSpongeKnowledgeProposalDraftV3(JSON.parse(canonicalJson(canonical as unknown as JsonValue))))
      .toEqual(canonical);
  }), { numRuns: 10 });
});
