import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "./document-domain";
import { parseSha256Hex, sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import { spongeKnowledgeDomainCatalogV8 } from "./knowledge-domain-catalog-v8";
import { createSpongeCitationPackV1 } from "./knowledge-citation";
import { createSpongeEvidenceGradingPackV1 } from "./knowledge-evidence-grading";
import { createSpongeResearchOpsPackV1 } from "./knowledge-research-ops";
import { createSpongeSourcePolicyPackV1 } from "./knowledge-source-policy";
import { createSpongeSourceQualityPackV1 } from "./knowledge-source-quality";
import { createSpongeTemporalRolesPackV1 } from "./knowledge-temporal-roles";
import {
  createKnowledgeRightsDecisionV1, createKnowledgeTypeMembershipV1,
  evaluateKnowledgeShapeV1, parseKnowledgeGraphRecordV1,
} from "./knowledge-ontology-contract-v1";
import {
  createKnowledgeAssertionV1, parseKnowledgeEntityId, type KnowledgeEntityV1, type KnowledgeOntologyResult,
  type KnowledgeSchemaRefV1, type KnowledgeStatementV1,
} from "./knowledge-ontology-v1";
import { compileSpongeKnowledgeProposalV3, type SpongeKnowledgeProposalCompilerAuthorityV3 } from "./knowledge-proposal-compiler-v3";
import type { SpongeKnowledgeProposalDraftV3, SpongeKnowledgeProposalValueV3 } from "./knowledge-proposal-v3";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";

type Fact = SpongeKnowledgeProposalDraftV3["facts"][number];
type Compiled = NonNullable<Awaited<ReturnType<typeof compileSpongeKnowledgeProposalV3>>>;
const entityValue = (entityKey: string) => ({ kind: "entity-key", entityKey }) as const;
const stringValue = (value: string) => ({ kind: "string", value, v: 1 }) as const;
const intValue = (value: string) => ({ kind: "integer", value, v: 1 }) as const;
const decValue = (value: string) => ({ kind: "decimal", value, v: 1 }) as const;
const boolValue = (value: boolean) => ({ kind: "boolean", value, v: 1 }) as const;
const uriValue = (uri: string) => ({ kind: "uri", uri, v: 1 }) as const;
const canonical = (value: unknown) => canonicalJson(value as JsonValue);
function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid test record: ${result.error.field}:${result.error.code}.`);
  return result.value;
}

// Catalog construction verifies every schema digest; allow real crypto time under load.
setDefaultTimeout(30_000);

const PACK_SPECS = [
  ["sponge.temporal-roles", "temporal-roles", "createSpongeTemporalRolesPackV1", ["sponge.core", "sponge.foundation", "sponge.reference"], 0, 10],
  ["sponge.evidence-grading", "evidence-grading", "createSpongeEvidenceGradingPackV1",
    ["sponge.content-occurrences", "sponge.core", "sponge.foundation", "sponge.reference", "sponge.research", "sponge.temporal-roles"], 5, 16],
  ["sponge.citation", "citation", "createSpongeCitationPackV1", ["sponge.core", "sponge.foundation", "sponge.reference"], 3, 7],
  ["sponge.research-ops", "research-ops", "createSpongeResearchOpsPackV1",
    ["sponge.core", "sponge.foundation", "sponge.reference", "sponge.temporal-roles"], 7, 16],
  ["sponge.source-quality", "source-quality", "createSpongeSourceQualityPackV1", ["sponge.core", "sponge.foundation", "sponge.reference"], 3, 9],
  ["sponge.source-policy", "source-policy", "createSpongeSourcePolicyPackV1", ["sponge.core", "sponge.foundation", "sponge.reference"], 2, 10],
] as const;

async function fixture() {
  const [previous, catalog] = await Promise.all([spongeKnowledgeDomainCatalogV7(), spongeKnowledgeDomainCatalogV8()]);
  const core = await spongeCoreKnowledgeCatalogV1();
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const found = catalog.schemas.find(schema => schema.identity.namespace === packId && schema.identity.code === code);
    if (found === undefined) throw new Error(`Missing fixture schema ${packId}/${code}.`);
    return found.ref;
  };
  const pack = (packId: string): KnowledgeVocabularyPackManifestV1 => {
    const found = catalog.packs.find(item => item.packId === packId);
    if (found === undefined) throw new Error(`Missing fixture pack ${packId}.`);
    return found;
  };
  const actorId = parseKnowledgeEntityId(`kent_${"b".repeat(24)}`)!;
  const actor: KnowledgeEntityV1 = { entityId: actorId, identityOperationId: "identity.fixture", identityRevision: 1,
    redirectEntityId: null, state: "active", v: 1 };
  const authority: SpongeKnowledgeProposalCompilerAuthorityV3 = {
    authorEntityId: actorId, authoringPolicySha256: core.rightsPolicySha256,
    externalOperationReceiptSha256: await sha256Text("synthetic research evidence operation"),
    occurredAt: "2026-09-16T00:00:00.000Z", spaceId: "space.research-evidence", schemas: catalog.schemas,
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
  const temporal = (code: string, value: string): Fact["qualifiers"] => [
    { predicate: ref("sponge.temporal-roles", code), value: time(value) }];
  const draft = (entities: SpongeKnowledgeProposalDraftV3["entities"], facts: readonly Fact[],
    evidence: SpongeKnowledgeProposalDraftV3["evidence"] = [],
    vocabularyDependencies = PACK_SPECS.flatMap(([packId]) => pack(packId).schemas.map(schema => schema.ref))
  ): SpongeKnowledgeProposalDraftV3 => ({
    v: 3, entities, facts, contexts: [], evidence: evidence.map(item => ({ ...item, factKey: `fact.${item.factKey}` })),
    vocabularyDependencies,
  });
  return { previous, catalog, pack, ref, authority, newEntity, fact, time, temporal, draft };
}

function statements(result: Compiled): KnowledgeStatementV1[] {
  return result.bundle.records.filter(record => record.kind === "statement").map(record => record.value as KnowledgeStatementV1);
}
function outgoing(rows: readonly KnowledgeStatementV1[], subject: string, code: string): KnowledgeStatementV1[] {
  return rows.filter(row => row.subject === subject && row.predicate.code === code);
}
async function proposedAssertions(result: Compiled) {
  return await Promise.all(result.bundle.records.filter(record => record.kind === "assertion")
    .map(async record => required(await parseKnowledgeGraphRecordV1("assertion", record.value)).value));
}
async function evaluate(f: Awaited<ReturnType<typeof fixture>>, result: Compiled, pack: KnowledgeVocabularyPackManifestV1, entityKey: string) {
  const proposed = await proposedAssertions(result);
  const assertions = await Promise.all(proposed.map(async assertion => {
    const { assertionSha256: _digest, ...input } = assertion;
    return required(await createKnowledgeAssertionV1({ ...input, acceptedPurposes: ["private-research"],
      state: "accepted-for-purpose", reviewActivitySha256: await sha256Text("synthetic review activity") }));
  }));
  const memberships = await Promise.all(result.bundle.records.filter(record => record.kind === "type-membership").map(async record => {
    const { membershipSha256: _digest, ...input } = required(await parseKnowledgeGraphRecordV1("type-membership", record.value)).value;
    const index = proposed.findIndex(assertion => assertion.assertionSha256 === input.assertionSha256);
    return required(await createKnowledgeTypeMembershipV1({ ...input, assertionSha256: assertions[index]!.assertionSha256 }));
  }));
  const rightsDecisions = await Promise.all(statements(result).map(statement => createKnowledgeRightsDecisionV1({
    actorEntityId: parseKnowledgeEntityId(f.authority.authorEntityId)!, allowedDisclosures: ["private"], decidedAt: f.authority.occurredAt,
    policySha256: parseSha256Hex(f.authority.authoringPolicySha256)!, purposes: ["private-research"], subjectSha256: statement.statementSha256, v: 1,
  }).then(required)));
  const entity = result.entityIds[entityKey]!;
  const concept = memberships.find(membership => membership.entityId === entity)?.concept;
  const root = pack.shapes.find(shape => shape.appliesToConcepts.some(item => canonical(item) === canonical(concept)));
  if (root === undefined) throw new Error(`No shape applies to ${entityKey}.`);
  return evaluateKnowledgeShapeV1({ assertions, disclosure: "private", entityId: entity, evidence: [],
    memberships, purpose: "private-research", rightsDecisions, rootShape: root.shape, shapes: pack.shapes, statements: statements(result) });
}

describe("research evidence packs V1", () => {
  test("all six packs pin exact dependencies, rebuild deterministically and parse as graph records", async () => {
    const f = await fixture();
    const before = canonical(f.previous);
    const rebuilt: Record<string, KnowledgeVocabularyPackManifestV1> = {
      "sponge.temporal-roles": await createSpongeTemporalRolesPackV1(f.previous),
      "sponge.citation": await createSpongeCitationPackV1(f.previous),
      "sponge.source-quality": await createSpongeSourceQualityPackV1(f.previous),
      "sponge.source-policy": await createSpongeSourcePolicyPackV1(f.previous),
      "sponge.evidence-grading": await createSpongeEvidenceGradingPackV1(f.previous, f.catalog.temporalRolesPack),
      "sponge.research-ops": await createSpongeResearchOpsPackV1(f.previous, f.catalog.temporalRolesPack),
    };
    for (const [packId, , , dependencies, concepts, predicates] of PACK_SPECS) {
      const pack = f.pack(packId);
      expect(pack.schemas.filter(schema => schema.kind === "concept")).toHaveLength(concepts);
      expect(pack.schemas.filter(schema => schema.kind === "predicate")).toHaveLength(predicates);
      expect(pack.dependencies.map(pin => pin.packId)).toEqual([...dependencies]);
      for (const pin of pack.dependencies) {
        const source = pin.packId.startsWith("sponge.") && f.catalog.packs.some(item => item.packId === pin.packId)
          ? f.catalog.packs.find(item => item.packId === pin.packId)! : f.previous.packs.find(item => item.packId === pin.packId)!;
        expect(pin).toEqual(knowledgeVocabularyPackPinV1(source));
      }
      expect(rebuilt[packId]!.manifestSha256).toBe(pack.manifestSha256);
      expect(Object.isFrozen(pack)).toBe(true);
      expect((await parseKnowledgeGraphRecordV1("vocabulary", pack.vocabulary)).ok).toBe(true);
      for (const schema of pack.schemas) expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
      for (const shape of pack.shapes) expect((await parseKnowledgeGraphRecordV1("shape", shape)).ok).toBe(true);
    }
    expect(canonical(f.previous)).toBe(before);
  });

  test("guide hashes, machine discovery manifests and exact public mirrors agree", async () => {
    const f = await fixture();
    for (const [packId, short, builder, dependencies] of PACK_SPECS) {
      const pack = f.pack(packId);
      const path = `spec/research-v1/${short}-v1`;
      const guide = await readFile(new URL(`../../${path}.md`, import.meta.url), "utf8");
      const raw = await readFile(new URL(`../../${path}.json`, import.meta.url), "utf8");
      const discovery = JSON.parse(raw);
      expect(await readFile(new URL(`../../site/public/${path}.md`, import.meta.url), "utf8")).toBe(guide);
      expect(await readFile(new URL(`../../site/public/${path}.json`, import.meta.url), "utf8")).toBe(raw);
      expect(discovery.catalog).toEqual({ factory: "spongeKnowledgeDomainCatalogV8", additionalPack: packId, additionalPackRevision: 1 });
      expect(discovery.builder).toBe(builder);
      expect(discovery.previousCatalogFactory).toBe("spongeKnowledgeDomainCatalogV7");
      expect(discovery.queryKind).toBe("declarative-predicate-inventory");
      expect(discovery.directDependencies).toEqual(dependencies);
      expect(pack.sources[0]?.contentSha256).toBe(await sha256Text(guide));
      expect(pack.schemas.filter(schema => schema.kind === "concept").map(schema => schema.identity.code)).toEqual(discovery.concepts);
      expect(pack.schemas.filter(schema => schema.kind === "predicate").map(schema => schema.identity.code)).toEqual(discovery.relations);
      expect(pack.queries.every(query => query.description.startsWith("Declarative join guidance, not an executable query:"))).toBe(true);
    }
  });

  test("temporal roles qualify V8 predicates but cannot reopen a frozen V7 allowlist", async () => {
    const f = await fixture();
    const entities = [f.newEntity("record", "sponge.core", "information-resource"),
      f.newEntity("grade", "sponge.evidence-grading", "epistemic-grade-descriptor"),
      f.newEntity("person", "sponge.core", "person"), f.newEntity("company", "sponge.organizations", "legal-entity")];
    const graded = [f.fact("grade", "record", "sponge.evidence-grading", "epistemic-grade", entityValue("grade"),
      [...f.temporal("event-time", "2026-01-15"), ...f.temporal("reviewed-at", "2026-09-10")])];
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, graded), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const row = outgoing(statements(result), result.entityIds["record"]!, "epistemic-grade")[0]!;
    expect(row.qualifiers.map(qualifier => qualifier.predicate.code).sort()).toEqual(["event-time", "reviewed-at"]);
    const heldBy = [f.fact("held", "person", "sponge.organizations", "held-by", entityValue("company"),
      f.temporal("reviewed-at", "2026-09-10"))];
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, heldBy), f.authority)).toBeNull();
  });

  test("a graded record keeps stratum, tier, corroboration and criteria era as separate evidence", async () => {
    const f = await fixture();
    const pack = f.pack("sponge.evidence-grading");
    const entities = [f.newEntity("record", "sponge.core", "information-resource"),
      f.newEntity("stratum.clinical", "sponge.evidence-grading", "evidence-stratum"),
      f.newEntity("tier.clinical.a", "sponge.evidence-grading", "stratum-tier"),
      f.newEntity("stratum.community", "sponge.evidence-grading", "evidence-stratum"),
      f.newEntity("tier.community.c", "sponge.evidence-grading", "stratum-tier"),
      f.newEntity("grade.emerging", "sponge.evidence-grading", "epistemic-grade-descriptor"),
      f.newEntity("corro.contested", "sponge.evidence-grading", "corroboration-descriptor"),
      f.newEntity("era.2026", "sponge.research", "method"), f.newEntity("source.b", "sponge.core", "source")];
    const facts = [
      f.fact("stratum", "record", "sponge.evidence-grading", "of-stratum", entityValue("stratum.clinical")),
      f.fact("tier", "record", "sponge.evidence-grading", "of-tier", entityValue("tier.clinical.a")),
      f.fact("ladder", "tier.clinical.a", "sponge.evidence-grading", "tier-in-stratum", entityValue("stratum.clinical")),
      f.fact("rank", "tier.clinical.a", "sponge.evidence-grading", "tier-rank", intValue("1")),
      f.fact("community-ladder", "tier.community.c", "sponge.evidence-grading", "tier-in-stratum", entityValue("stratum.community")),
      f.fact("grade", "record", "sponge.evidence-grading", "epistemic-grade", entityValue("grade.emerging"),
        f.temporal("reviewed-at", "2026-09-10")),
      f.fact("corroboration", "record", "sponge.evidence-grading", "corroboration-state", entityValue("corro.contested")),
      f.fact("corroborator", "record", "sponge.evidence-grading", "corroborated-by", entityValue("source.b")),
      f.fact("era", "record", "sponge.evidence-grading", "assessed-under", entityValue("era.2026")),
      f.fact("novelty", "record", "sponge.evidence-grading", "corpus-novelty", stringValue("new")),
    ];
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    const record = result.entityIds["record"]!;
    expect(outgoing(rows, record, "of-stratum")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["stratum.clinical"]!, v: 1 });
    expect(outgoing(rows, record, "corroborated-by")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["source.b"]!, v: 1 });
    expect(outgoing(rows, record, "assessed-under")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["era.2026"]!, v: 1 });
    expect(outgoing(rows, record, "corpus-novelty")[0]?.object).toEqual(stringValue("new"));
    // Ladders are recorded evidence, not enforced membership: the compiler still
    // admits a community tier asserted inside the clinical stratum.
    const cross = [f.fact("cross", "tier.community.c", "sponge.evidence-grading", "tier-in-stratum", entityValue("stratum.clinical"))];
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, cross), f.authority)).not.toBeNull();
    const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: f.catalog.packs, roots: [knowledgeVocabularyPackPinV1(pack)] });
    expect(resolved.ok && resolved.value.packs.some(item => item.packId === "sponge.temporal-roles")).toBe(true);
  });

  test("a bounded absence finding satisfies its shape; a scope-less record fails it", async () => {
    const f = await fixture();
    const pack = f.pack("sponge.evidence-grading");
    const entities = [f.newEntity("absence", "sponge.evidence-grading", "absence-finding"),
      f.newEntity("corpus", "sponge.core", "source"), f.newEntity("method", "sponge.research", "method")];
    const facts = [
      f.fact("outcome", "absence", "sponge.evidence-grading", "absence-outcome", stringValue("no-result"),
        f.temporal("searched-at", "2026-09-14")),
      f.fact("scope", "absence", "sponge.evidence-grading", "search-scope",
        { kind: "text", language: "en", text: "registry X entries 2020-2026 for compound Y", v: 1 }),
      f.fact("within", "absence", "sponge.evidence-grading", "searched-within", entityValue("corpus")),
      f.fact("method", "absence", "sponge.evidence-grading", "search-method", entityValue("method")),
    ];
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const complete = await evaluate(f, result, pack, "absence");
    expect(complete).toMatchObject({ complete: true, passed: true, truncation: null, violations: [] });
    const partial = await compileSpongeKnowledgeProposalV3(f.draft(
      [f.newEntity("absence.partial", "sponge.evidence-grading", "absence-finding")], []), f.authority);
    expect(partial).not.toBeNull();
    if (partial === null) return;
    const failed = await evaluate(f, partial, pack, "absence.partial");
    expect(failed.passed).toBe(false);
    expect(failed.violations.length).toBeGreaterThan(0);
  });

  test("verbatim binding ties a numeric claim to a retained version and selector; corrections append", async () => {
    const f = await fixture();
    const entities = [f.newEntity("claim", "sponge.core", "information-resource"),
      f.newEntity("correction", "sponge.research", "correction"),
      f.newEntity("payload", "sponge.content-occurrences", "retained-content-version")];
    const facts = [
      f.fact("payload", "claim", "sponge.evidence-grading", "bound-payload", entityValue("payload")),
      f.fact("selector", "claim", "sponge.evidence-grading", "bound-selector", stringValue("revenue was 12.5 billion")),
      f.fact("corrects", "correction", "sponge.evidence-grading", "corrects", entityValue("claim"),
        f.temporal("superseded-at", "2026-09-15")),
    ];
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    expect(outgoing(rows, result.entityIds["claim"]!, "bound-payload")[0]?.object)
      .toEqual({ kind: "entity", entityId: result.entityIds["payload"]!, v: 1 });
    const correction = outgoing(rows, result.entityIds["correction"]!, "corrects")[0]!;
    expect(correction.object).toEqual({ kind: "entity", entityId: result.entityIds["claim"]!, v: 1 });
    expect(correction.qualifiers.map(qualifier => qualifier.predicate.code)).toEqual(["superseded-at"]);
    // The corrected claim remains a separate entity; nothing rewrote it.
    expect(result.entityIds["claim"]!).not.toBe(result.entityIds["correction"]!);
  });

  test("a citation cluster orders items with locators, quotation selectors and stated intent", async () => {
    const f = await fixture();
    const entities = [f.newEntity("paper", "sponge.core", "work"), f.newEntity("cluster", "sponge.citation", "citation-cluster"),
      f.newEntity("cited.a", "sponge.core", "source"), f.newEntity("cited.b", "sponge.content-occurrences", "retained-content-version"),
      f.newEntity("intent.support", "sponge.citation", "citation-intent-descriptor"),
      f.newEntity("intent.method", "sponge.citation", "citation-intent-descriptor"),
      f.newEntity("level.expression", "sponge.citation", "wemi-level-descriptor")];
    const facts = [
      f.fact("from", "cluster", "sponge.citation", "cited-from", entityValue("paper")),
      f.fact("item.a", "cluster", "sponge.citation", "cites-item", entityValue("cited.a"), [
        { predicate: f.ref("sponge.citation", "citation-order"), value: intValue("1") },
        { predicate: f.ref("sponge.citation", "citation-intent"), value: entityValue("intent.support") },
      ]),
      f.fact("item.b", "cluster", "sponge.citation", "cites-item", entityValue("cited.b"), [
        { predicate: f.ref("sponge.citation", "citation-order"), value: intValue("2") },
        { predicate: f.ref("sponge.citation", "citation-locator"), value: stringValue("table 3") },
        { predicate: f.ref("sponge.citation", "quotation-selector"), value: stringValue("participants n=412") },
        { predicate: f.ref("sponge.citation", "citation-intent"), value: entityValue("intent.method") },
      ]),
      f.fact("level", "cited.b", "sponge.citation", "wemi-level", entityValue("level.expression")),
    ];
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    const items = outgoing(rows, result.entityIds["cluster"]!, "cites-item");
    expect(items).toHaveLength(2);
    const byOrder = items.map(item => item.qualifiers.find(qualifier => qualifier.predicate.code === "citation-order")?.value);
    expect(byOrder).toEqual([intValue("1"), intValue("2")]);
    expect(items[1]?.qualifiers.find(qualifier => qualifier.predicate.code === "citation-intent")?.value)
      .toEqual({ kind: "entity", entityId: result.entityIds["intent.method"]!, v: 1 });
    // A citation-cluster cannot be its own citing entity's item qualifier on an undeclared predicate.
    const invalid = [f.fact("bad", "cluster", "sponge.citation", "cited-from", entityValue("paper"),
      [{ predicate: f.ref("sponge.citation", "citation-order"), value: intValue("1") }])];
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, invalid), f.authority)).toBeNull();
  });

  test("a monitor, run ledger, rejection and review event record their declared scope", async () => {
    const f = await fixture();
    const pack = f.pack("sponge.research-ops");
    const entities = [f.newEntity("inquiry", "sponge.core", "inquiry"), f.newEntity("monitor", "sponge.research-ops", "research-monitor"),
      f.newEntity("run", "sponge.research-ops", "monitor-run"), f.newEntity("venue", "sponge.core", "source"),
      f.newEntity("rejection", "sponge.research-ops", "rejection-record"), f.newEntity("candidate", "sponge.core", "information-resource"),
      f.newEntity("review", "sponge.research-ops", "review-event"), f.newEntity("outcome.keep", "sponge.research-ops", "review-outcome-descriptor"),
      f.newEntity("policy", "sponge.research-ops", "publication-policy"), f.newEntity("class.review", "sponge.research-ops", "policy-class-descriptor"),
      f.newEntity("record", "sponge.core", "information-resource")];
    const facts = [
      f.fact("watches", "monitor", "sponge.research-ops", "monitors-inquiry", entityValue("inquiry")),
      f.fact("target", "monitor", "sponge.research-ops", "monitor-target", entityValue("venue")),
      f.fact("cadence", "monitor", "sponge.research-ops", "monitor-cadence-days", intValue("30")),
      f.fact("status", "monitor", "sponge.research-ops", "monitor-status", stringValue("active")),
      f.fact("ran", "run", "sponge.research-ops", "run-of-monitor", entityValue("monitor"),
        f.temporal("searched-at", "2026-09-14")),
      f.fact("scope", "run", "sponge.research-ops", "run-scope",
        { kind: "text", language: "en", text: "venue RSS items tagged compound-y", v: 1 }),
      f.fact("admitted", "run", "sponge.research-ops", "admitted-in-run", entityValue("record")),
      f.fact("in-run", "rejection", "sponge.research-ops", "rejected-in-run", entityValue("run")),
      f.fact("of", "rejection", "sponge.research-ops", "rejection-of", entityValue("candidate")),
      f.fact("reason", "rejection", "sponge.research-ops", "rejection-reason",
        { kind: "text", language: "en", text: "marketing channel outside declared scope", v: 1 }),
      f.fact("reviewed", "review", "sponge.research-ops", "review-of", entityValue("record"),
        f.temporal("reviewed-at", "2026-09-15")),
      f.fact("outcome", "review", "sponge.research-ops", "review-outcome", entityValue("outcome.keep")),
      f.fact("policy-class", "policy", "sponge.research-ops", "policy-class", entityValue("class.review")),
      f.fact("applies", "policy", "sponge.research-ops", "policy-applies-to", entityValue("record")),
      f.fact("window", "policy", "sponge.research-ops", "reassessment-window-days", intValue("90")),
      f.fact("reference", "policy", "sponge.research-ops", "policy-reference", uriValue("https://example.org/policy#v3")),
    ];
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    expect(outgoing(rows, result.entityIds["rejection"]!, "rejection-of")[0]?.object)
      .toEqual({ kind: "entity", entityId: result.entityIds["candidate"]!, v: 1 });
    expect(outgoing(rows, result.entityIds["review"]!, "review-of")[0]?.qualifiers[0]?.predicate.code).toBe("reviewed-at");
    expect(outgoing(rows, result.entityIds["policy"]!, "reassessment-window-days")[0]?.object).toEqual(intValue("90"));
    for (const key of ["monitor", "run", "rejection", "review", "policy"]) {
      const evaluation = await evaluate(f, result, pack, key);
      expect(evaluation).toMatchObject({ complete: true, passed: true, violations: [] });
    }
  });

  test("a scorecard records measured parameters and a capability policy records a decision", async () => {
    const f = await fixture();
    const quality = f.pack("sponge.source-quality");
    const policy = f.pack("sponge.source-policy");
    const entities = [f.newEntity("source", "sponge.core", "source"), f.newEntity("card", "sponge.source-quality", "source-scorecard"),
      f.newEntity("maturity.calibrated", "sponge.source-quality", "maturity-descriptor"),
      f.newEntity("domain.china-a", "sponge.core", "concept"),
      f.newEntity("veto.sponsor", "sponge.source-quality", "veto-rule"),
      f.newEntity("decision", "sponge.source-policy", "capability-policy"),
      f.newEntity("status.denied", "sponge.source-policy", "policy-status-descriptor")];
    const facts = [
      f.fact("of", "card", "sponge.source-quality", "scorecard-source", entityValue("source")),
      f.fact("horizon", "card", "sponge.source-quality", "horizon-days", intValue("180")),
      f.fact("rate", "card", "sponge.source-quality", "hit-rate", decValue("0.62")),
      f.fact("observations", "card", "sponge.source-quality", "observation-count", intValue("42")),
      f.fact("preregistered", "card", "sponge.source-quality", "preregistered-sample", intValue("40")),
      f.fact("maturity", "card", "sponge.source-quality", "scorecard-maturity", entityValue("maturity.calibrated")),
      f.fact("domain", "card", "sponge.source-quality", "applies-to-domain", entityValue("domain.china-a")),
      f.fact("veto-text", "veto.sponsor", "sponge.source-quality", "veto-rule-text",
        { kind: "text", language: "en", text: "undisclosed issuer sponsorship", v: 1 }),
      f.fact("veto", "card", "sponge.source-quality", "triggered-veto", entityValue("veto.sponsor")),
      f.fact("policy-for", "decision", "sponge.source-policy", "policy-for-source", entityValue("source")),
      f.fact("policy-status", "decision", "sponge.source-policy", "policy-status", entityValue("status.denied")),
      f.fact("storage", "decision", "sponge.source-policy", "capability-storage", boolValue(false)),
      f.fact("features", "decision", "sponge.source-policy", "capability-features", boolValue(false)),
      f.fact("ml", "decision", "sponge.source-policy", "capability-ml", boolValue(false)),
      f.fact("network", "decision", "sponge.source-policy", "capability-network", boolValue(false)),
      f.fact("labels", "decision", "sponge.source-policy", "capability-labels", boolValue(false)),
      f.fact("reason", "decision", "sponge.source-policy", "policy-reason",
        { kind: "text", language: "en", text: "license prohibits derived features", v: 1 }),
      f.fact("terms", "decision", "sponge.source-policy", "terms-reference", uriValue("https://example.org/terms")),
      f.fact("revision", "decision", "sponge.source-policy", "policy-revision", intValue("7")),
    ];
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    const card = result.entityIds["card"]!;
    expect(outgoing(rows, card, "hit-rate")[0]?.object).toEqual(decValue("0.62"));
    expect(outgoing(rows, card, "preregistered-sample")[0]?.object).toEqual(intValue("40"));
    const decision = outgoing(rows, result.entityIds["decision"]!, "capability-storage")[0]!;
    expect(decision.object).toEqual(boolValue(false));
    // A hit rate outside 0..1 fails the numeric bound.
    const bad = [f.fact("rate", "card", "sponge.source-quality", "hit-rate", decValue("1.5"))];
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, bad), f.authority)).toBeNull();
    for (const [pack, key] of [[quality, "card"], [policy, "decision"]] as const) {
      const evaluation = await evaluate(f, result, pack, key);
      expect(evaluation).toMatchObject({ complete: true, passed: true, violations: [] });
    }
  });
});
