import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "./document-domain";
import { parseSha256Hex, sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeDomainCatalogV6 } from "./knowledge-domain-catalog-v6";
import {
  createKnowledgeRightsDecisionV1, createKnowledgeTypeMembershipV1, evaluateKnowledgeShapeV1, parseKnowledgeGraphRecordV1,
} from "./knowledge-ontology-contract-v1";
import {
  createKnowledgeAssertionV1, parseKnowledgeEntityId, type KnowledgeEntityV1, type KnowledgeOntologyResult,
  type KnowledgeSchemaRefV1, type KnowledgeStatementV1,
} from "./knowledge-ontology-v1";
import { createSpongeParticipationRolesPackV1 } from "./knowledge-participation-roles";
import { compileSpongeKnowledgeProposalV3, type SpongeKnowledgeProposalCompilerAuthorityV3 } from "./knowledge-proposal-compiler-v3";
import type { SpongeKnowledgeProposalDraftV3, SpongeKnowledgeProposalValueV3 } from "./knowledge-proposal-v3";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

const namespace = "sponge.participation-roles";
type Fact = SpongeKnowledgeProposalDraftV3["facts"][number];
type Compiled = NonNullable<Awaited<ReturnType<typeof compileSpongeKnowledgeProposalV3>>>;
const entityValue = (entityKey: string) => ({ kind: "entity-key", entityKey }) as const;
const stringValue = (value: string) => ({ kind: "string", value, v: 1 }) as const;
const canonical = (value: unknown) => canonicalJson(value as JsonValue);
function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid test record: ${result.error.field}:${result.error.code}.`);
  return result.value;
}

async function fixture() {
  const previous = await spongeKnowledgeDomainCatalogV6();
  const pack = await createSpongeParticipationRolesPackV1(previous);
  const core = await spongeCoreKnowledgeCatalogV1();
  const schemas = [...previous.schemas, ...pack.schemas];
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const found = schemas.find(schema => schema.identity.namespace === packId && schema.identity.code === code);
    if (found === undefined) throw new Error(`Missing fixture schema ${packId}/${code}.`);
    return found.ref;
  };
  const actorId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const actor: KnowledgeEntityV1 = { entityId: actorId, identityOperationId: "identity.fixture", identityRevision: 1,
    redirectEntityId: null, state: "active", v: 1 };
  const authority: SpongeKnowledgeProposalCompilerAuthorityV3 = {
    authorEntityId: actorId, authoringPolicySha256: core.rightsPolicySha256,
    externalOperationReceiptSha256: await sha256Text("synthetic participation operation"),
    occurredAt: "2026-09-15T00:00:00.000Z", spaceId: "space.participation", schemas,
    existingEntities: new Map([[actorId, { entity: actor, concepts: [ref("sponge.core", "agent")] }]]),
  };
  const newEntity = (key: string, packId: string, code: string, name = key) => ({
    key, kind: "new", concepts: [ref(packId, code)], name: { language: "en", text: name },
  }) as const;
  const fact = (key: string, subject: string, packId: string, code: string, object: SpongeKnowledgeProposalValueV3,
    qualifiers: Fact["qualifiers"] = []): Fact => ({ key: `fact.${key}`, subject: { kind: "key", key: subject },
    predicate: ref(packId, code), object, qualifiers, contextKey: null, stance: "reports" });
  const time = (value: string) => ({ kind: "time", calendar: ref("sponge.reference", "gregorian-calendar"),
    certainty: "exact", earliest: null, latest: null, precision: "day", timezone: null, value, v: 1 }) as const;
  const interval = (start: string, end: string | null) => ({ kind: "interval", start: time(start), end: end === null ? null : time(end), v: 1 }) as const;
  const scope = (source: string, start: string, end: string | null): Fact["qualifiers"] => [
    { predicate: ref("sponge.reference", "valid-during"), value: interval(start, end) },
    { predicate: ref("sponge.reference", "source-context"), value: entityValue(source) },
  ];
  const version = (source: string): Fact["qualifiers"] => [
    { predicate: ref("sponge.foundation", "version-context"), value: entityValue(source) },
  ];
  const draft = (entities: SpongeKnowledgeProposalDraftV3["entities"], facts: readonly Fact[],
    evidence: SpongeKnowledgeProposalDraftV3["evidence"] = []): SpongeKnowledgeProposalDraftV3 => ({
    v: 3, entities, facts, contexts: [], evidence: evidence.map(item => ({ ...item, factKey: `fact.${item.factKey}` })),
    vocabularyDependencies: pack.schemas.map(schema => schema.ref),
  });
  return { previous, pack, ref, authority, newEntity, fact, scope, interval, version, draft };
}

function statements(result: Compiled): KnowledgeStatementV1[] {
  return result.bundle.records.filter(record => record.kind === "statement").map(record => record.value as KnowledgeStatementV1);
}
function outgoing(rows: readonly KnowledgeStatementV1[], subject: string, code: string): KnowledgeStatementV1[] {
  return rows.filter(row => row.subject === subject && row.predicate.code === code);
}
function expectQueryCoverage(query: readonly KnowledgeSchemaRefV1[], facts: readonly Fact[]) {
  const declared = new Set(query.map(canonical));
  for (const fact of facts) for (const ref of [fact.predicate, ...fact.qualifiers.map(qualifier => qualifier.predicate)]) {
    expect(declared.has(canonical(ref))).toBe(true);
  }
}
async function proposedAssertions(result: Compiled) {
  return await Promise.all(result.bundle.records.filter(record => record.kind === "assertion")
    .map(async record => required(await parseKnowledgeGraphRecordV1("assertion", record.value)).value));
}

describe("participation and roles V1", () => {
  test("adds exactly five schemas with truthful pinned dependencies and immutable V6 history", async () => {
    const previous = await spongeKnowledgeDomainCatalogV6();
    const before = canonical(previous);
    const pack = await createSpongeParticipationRolesPackV1(previous);
    expect(pack.schemas.filter(schema => schema.kind === "concept")).toHaveLength(2);
    expect(pack.schemas.filter(schema => schema.kind === "predicate")).toHaveLength(3);
    expect(pack.dependencies.map(pin => pin.packId)).toEqual([
      "sponge.bridge-relations", "sponge.core", "sponge.foundation", "sponge.organizations", "sponge.reference",
    ]);
    for (const pin of pack.dependencies) expect(pin).toEqual(knowledgeVocabularyPackPinV1(previous.packs.find(item => item.packId === pin.packId)!));
    const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: [...previous.packs, pack], roots: [knowledgeVocabularyPackPinV1(pack)] });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.packs).toHaveLength(21);
      expect(resolved.value.packs.some(item => ["sponge.content-occurrences", "sponge.measurement-results", "sponge.monetary-values"].includes(item.packId))).toBe(false);
    }
    expect(canonical(previous)).toBe(before);
    expect(previous.lock).toMatchObject({ lockSha256: "bbe7945e131128390b872d0fa05428f0ada30912d97ce61ca224b424bec93c1f" });
    expect((await createSpongeParticipationRolesPackV1(previous)).manifestSha256).toBe(pack.manifestSha256);
    const retained = new Set([...previous.historicalPacks, ...previous.packs, pack].flatMap(item => item.schemas.map(schema => schema.revisionSha256)));
    expect(retained.size).toBe(477);
    expect(Object.isFrozen(pack)).toBe(true);
    expect((await parseKnowledgeGraphRecordV1("vocabulary", pack.vocabulary)).ok).toBe(true);
    for (const schema of pack.schemas) expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
    for (const shape of pack.shapes) expect((await parseKnowledgeGraphRecordV1("shape", shape)).ok).toBe(true);
  });

  test("guide hash, machine discovery, exact public mirrors and optional shape agree", async () => {
    const { pack } = await fixture();
    const path = "spec/research-v1/participation-roles-v1";
    const guide = await readFile(new URL(`../../${path}.md`, import.meta.url), "utf8");
    const raw = await readFile(new URL(`../../${path}.json`, import.meta.url), "utf8");
    const discovery = JSON.parse(raw);
    expect(await readFile(new URL(`../../site/public/${path}.md`, import.meta.url), "utf8")).toBe(guide);
    expect(await readFile(new URL(`../../site/public/${path}.json`, import.meta.url), "utf8")).toBe(raw);
    expect(discovery.catalog).toEqual({ factory: "spongeKnowledgeDomainCatalogV7", additionalPack: namespace, additionalPackRevision: 1 });
    expect(discovery.builder).toBe("createSpongeParticipationRolesPackV1");
    expect(discovery.previousCatalogFactory).toBe("spongeKnowledgeDomainCatalogV6");
    expect(discovery.queryKind).toBe("declarative-predicate-inventory");
    expect(pack.sources[0]?.contentSha256).toBe(await sha256Text(guide));
    expect(pack.schemas.filter(schema => schema.kind === "concept").map(schema => schema.identity.code)).toEqual(discovery.concepts);
    expect(pack.schemas.filter(schema => schema.kind === "predicate").map(schema => schema.identity.code)).toEqual(discovery.relations);
    expect(pack.dependencies.map(pin => pin.packId)).toEqual(discovery.directDependencies);
    expect(pack.queries.every(query => query.description.startsWith("Declarative join guidance, not an executable query:"))).toBe(true);
    expect(pack.shapes).toHaveLength(1);
    expect(pack.shapes[0]?.closed).toBe(false);
    expect(pack.shapes[0]?.rules.map(rule => [rule.predicate.code, rule.cardinality.minimum, rule.cardinality.maximum])).toEqual([
      ["assigned-role", 0, null], ["participant", 0, null], ["participation-in", 0, null],
    ]);
  });

  test("compiles two dated organization roles for the same person with separate source evidence", async () => {
    const f = await fixture();
    const assignments = [
      { key: "executive", start: "2018-01-01", end: "2021-12-31" },
      { key: "adviser", start: "2022-01-01", end: null },
    ];
    const entities = [f.newEntity("person", "sponge.core", "person", "Synthetic Lea"),
      f.newEntity("company", "sponge.organizations", "legal-entity"), f.newEntity("source", "sponge.core", "source"),
      ...assignments.flatMap(item => [f.newEntity(`assignment.${item.key}`, "sponge.organizations", "role-assignment"),
        f.newEntity(`role.${item.key}`, namespace, "role-descriptor", item.key), f.newEntity(`source.${item.key}`, "sponge.core", "source")])];
    const facts = assignments.flatMap(item => {
      const scoped = f.scope(`source.${item.key}`, item.start, item.end);
      return [f.fact(`holder.${item.key}`, `assignment.${item.key}`, "sponge.organizations", "held-by", entityValue("person"), scoped),
        f.fact(`organization.${item.key}`, `assignment.${item.key}`, "sponge.bridge-relations", "role-assignment-at-organization", entityValue("company"), scoped),
        f.fact(`role.${item.key}`, `assignment.${item.key}`, namespace, "assigned-role", entityValue(`role.${item.key}`), [...scoped, ...f.version(`source.${item.key}`)]),
        f.fact(`source.${item.key}`, `source.${item.key}`, "sponge.foundation", "version-of", entityValue("source"))];
    });
    expectQueryCoverage(f.pack.queries.find(query => query.id === "dated-organization-roles")!.predicates, facts);
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts, assignments.map(item => ({
      key: `evidence.${item.key}`, factKey: `role.${item.key}`, source: { kind: "key", key: `source.${item.key}` }, bearing: "supports",
      selector: `source-section:${item.key}`, attribution: { kind: "agent-supplied", sourceUri: "https://example.org/company-history" },
    }))), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    const heldRoles = rows.filter(row => row.predicate.code === "held-by" && row.object.kind === "entity" && row.object.entityId === result.entityIds["person"]);
    expect(heldRoles).toHaveLength(2);
    for (const item of assignments) {
      const assignment = result.entityIds[`assignment.${item.key}`]!;
      expect(outgoing(rows, assignment, "held-by")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["person"]!, v: 1 });
      expect(outgoing(rows, assignment, "role-assignment-at-organization")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["company"]!, v: 1 });
      const role = outgoing(rows, assignment, "assigned-role")[0]!;
      expect(role.object).toEqual({ kind: "entity", entityId: result.entityIds[`role.${item.key}`]!, v: 1 });
      expect(role.qualifiers).toContainEqual({ predicate: f.ref("sponge.reference", "valid-during"), value: f.interval(item.start, item.end), v: 1 });
      expect(role.qualifiers).toContainEqual({ predicate: f.ref("sponge.foundation", "version-context"), value: { kind: "entity", entityId: result.entityIds[`source.${item.key}`]!, v: 1 }, v: 1 });
      const assertion = (await proposedAssertions(result)).find(value => value.statementSha256 === role.statementSha256)!;
      expect(assertion).toMatchObject({ state: "proposed", stance: "reports", acceptedPurposes: [], confidence: null });
      expect(result.bundle.records.filter(record => record.kind === "evidence").map(record => record.value)).toContainEqual(expect.objectContaining({
        assertionSha256: assertion.assertionSha256, sourceEntityId: result.entityIds[`source.${item.key}`]!, observationSha256: null, bearing: "supports",
      }));
    }
    expect(result.entityIds["assignment.executive"]!).not.toBe(result.entityIds["assignment.adviser"]!);
    expect(result.sourceAttributions).toHaveLength(2);
    expect(result.sourceAttributions.every(item => item.kind === "agent-supplied")).toBe(true);
    expect(rows.some(row => row.predicate.code === "operates")).toBe(false);
  });

  test("credits stay on their exact recording or translated edition without inheriting across versions", async () => {
    const f = await fixture();
    const credits = [
      { key: "original", subject: "recording.original", role: "role.engineer", day: "2020-06-01" },
      { key: "remix", subject: "recording.remix", role: "role.engineer", day: "2023-06-01" },
      { key: "translation", subject: "edition.es", role: "role.translator", day: "2024-06-01" },
    ];
    const entities = [f.newEntity("person", "sponge.core", "person", "Synthetic Lea"),
      f.newEntity("recording.original", "sponge.music", "recording"), f.newEntity("recording.remix", "sponge.music", "recording"),
      f.newEntity("work", "sponge.core", "work"), f.newEntity("edition.en", "sponge.core", "work"), f.newEntity("edition.es", "sponge.core", "work"),
      f.newEntity("role.engineer", namespace, "role-descriptor", "Recording engineer"), f.newEntity("role.translator", namespace, "role-descriptor", "Translator"),
      f.newEntity("source", "sponge.core", "source"), f.newEntity("source.version", "sponge.core", "source"),
      ...credits.map(item => f.newEntity(`credit.${item.key}`, namespace, "participation"))];
    const facts = credits.flatMap(item => {
      const scoped = [...f.scope("source.version", item.day, item.day), ...f.version("source.version")];
      return [f.fact(`participant.${item.key}`, `credit.${item.key}`, namespace, "participant", entityValue("person"), scoped),
        f.fact(`subject.${item.key}`, `credit.${item.key}`, namespace, "participation-in", entityValue(item.subject), scoped),
        f.fact(`role.${item.key}`, `credit.${item.key}`, namespace, "assigned-role", entityValue(item.role), scoped)];
    });
    facts.push(f.fact("edition.en", "edition.en", "sponge.foundation", "version-of", entityValue("work")),
      f.fact("edition.es", "edition.es", "sponge.foundation", "version-of", entityValue("work")),
      f.fact("source.version", "source.version", "sponge.foundation", "version-of", entityValue("source")));
    expectQueryCoverage(f.pack.queries.find(query => query.id === "scoped-credits")!.predicates, facts);
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts, credits.map(item => ({
      key: `evidence.${item.key}`, factKey: `role.${item.key}`, source: { kind: "key", key: "source.version" }, bearing: "quotation",
      selector: `credits-row:${item.key}`, attribution: { kind: "agent-supplied", sourceUri: "https://example.org/credits" },
    }))), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    for (const item of credits) {
      const credit = result.entityIds[`credit.${item.key}`]!;
      expect(outgoing(rows, credit, "participant")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["person"]!, v: 1 });
      expect(outgoing(rows, credit, "assigned-role")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds[item.role]!, v: 1 });
      const subject = outgoing(rows, credit, "participation-in");
      expect(subject).toHaveLength(1);
      expect(subject[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds[item.subject]!, v: 1 });
      expect(subject[0]?.qualifiers).toContainEqual({ predicate: f.ref("sponge.reference", "source-context"), value: { kind: "entity", entityId: result.entityIds["source.version"]!, v: 1 }, v: 1 });
    }
    const credited = rows.filter(row => row.predicate.code === "participation-in").map(row => row.object);
    expect(credited).not.toContainEqual({ kind: "entity", entityId: result.entityIds["edition.en"]!, v: 1 });
    expect(credited).not.toContainEqual({ kind: "entity", entityId: result.entityIds["work"]!, v: 1 });
    expect(result.entityIds["recording.original"]!).not.toBe(result.entityIds["recording.remix"]!);
    expect(result.sourceAttributions.map(item => item.selector).sort()).toEqual(credits.map(item => `credits-row:${item.key}`).sort());
    expect((await proposedAssertions(result)).every(item => item.state === "proposed")).toBe(true);
  });

  test("compiler enforces participant and role types while the focal entity range remains deliberately broad", async () => {
    const f = await fixture();
    const entities = [f.newEntity("participation", namespace, "participation"), f.newEntity("role", namespace, "role-descriptor"),
      f.newEntity("assignment", "sponge.organizations", "role-assignment"), f.newEntity("person", "sponge.core", "person"),
      f.newEntity("organization", "sponge.core", "organization"), f.newEntity("recording", "sponge.music", "recording")];
    const valid = [f.fact("participant", "participation", namespace, "participant", entityValue("person")),
      f.fact("subject", "participation", namespace, "participation-in", entityValue("recording")),
      f.fact("role", "participation", namespace, "assigned-role", entityValue("role")),
      f.fact("assignment.role", "assignment", namespace, "assigned-role", entityValue("role"))];
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, valid), f.authority)).not.toBeNull();
    for (const row of valid) expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...row, subject: { kind: "key", key: "person" } }]), f.authority)).toBeNull();
    for (const object of [entityValue("recording"), entityValue("role"), stringValue("person")]) {
      expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[0]!, object }]), f.authority)).toBeNull();
    }
    for (const object of [entityValue("person"), entityValue("recording"), stringValue("translator")]) {
      for (const row of valid.slice(2)) expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...row, object }]), f.authority)).toBeNull();
    }
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[0]!, object: entityValue("organization") }]), f.authority)).not.toBeNull();
    for (const target of ["person", "organization", "role"]) {
      expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[1]!, object: entityValue(target) }]), f.authority)).not.toBeNull();
    }
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[1]!, object: stringValue("unidentified event") }]), f.authority)).toBeNull();
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[0]!, qualifiers: [
      { predicate: f.ref("sponge.reference", "valid-during"), value: stringValue("sometime") },
    ] }]), f.authority)).toBeNull();
  });

  test("partial participation compiles and passes the optional open shape without inventing missing claims", async () => {
    const f = await fixture();
    const result = await compileSpongeKnowledgeProposalV3(f.draft([f.newEntity("partial", namespace, "participation")], []), f.authority);
    if (result === null) throw new Error("Expected compilable partial participation.");
    const rows = statements(result);
    expect(rows.map(row => row.predicate.code)).toEqual(["name"]);
    const proposed = await proposedAssertions(result);
    // Synthetic review records exercise the evaluator, not any host admission operation.
    const assertions = await Promise.all(proposed.map(async assertion => {
      const { assertionSha256: _digest, ...input } = assertion;
      return required(await createKnowledgeAssertionV1({ ...input, acceptedPurposes: ["private-research"],
        state: "accepted-for-purpose", reviewActivitySha256: await sha256Text("synthetic participation reviewer activity") }));
    }));
    const memberships = await Promise.all(result.bundle.records.filter(record => record.kind === "type-membership").map(async record => {
      const { membershipSha256: _digest, ...input } = required(await parseKnowledgeGraphRecordV1("type-membership", record.value)).value;
      const index = proposed.findIndex(assertion => assertion.assertionSha256 === input.assertionSha256);
      return required(await createKnowledgeTypeMembershipV1({ ...input, assertionSha256: assertions[index]!.assertionSha256 }));
    }));
    const rightsDecisions = await Promise.all(rows.map(statement => createKnowledgeRightsDecisionV1({
      actorEntityId: parseKnowledgeEntityId(f.authority.authorEntityId)!, allowedDisclosures: ["private"], decidedAt: f.authority.occurredAt,
      policySha256: parseSha256Hex(f.authority.authoringPolicySha256)!, purposes: ["private-research"], subjectSha256: statement.statementSha256, v: 1,
    }).then(required)));
    const evaluation = await evaluateKnowledgeShapeV1({ assertions, disclosure: "private", entityId: result.entityIds["partial"]!, evidence: [],
      memberships, purpose: "private-research", rightsDecisions, rootShape: f.pack.shapes[0]!.shape, shapes: f.pack.shapes, statements: rows });
    expect(evaluation).toMatchObject({ complete: true, passed: true, truncation: null, violations: [] });
    expect(result.sourceAttributions).toHaveLength(0);
  });
});
