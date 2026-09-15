import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import { createSpongeMeasurementResultsPackV1 } from "./knowledge-measurement-results";
import { parseKnowledgeGraphRecordV1, type KnowledgeSchemaRevisionV1 } from "./knowledge-ontology-contract-v1";
import {
  parseKnowledgeEntityId, type KnowledgeEntityV1, type KnowledgeStatementV1, type KnowledgeValueV1,
} from "./knowledge-ontology-v1";
import {
  compileSpongeKnowledgeProposalV3, type SpongeCompiledKnowledgeProposalV3, type SpongeKnowledgeProposalCompilerAuthorityV3,
} from "./knowledge-proposal-compiler-v3";
import type { SpongeKnowledgeProposalDraftV3, SpongeKnowledgeProposalValueV3 } from "./knowledge-proposal-v3";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

const setup = spongeKnowledgeDomainCatalogV5().then(async previous => {
  const pack = await createSpongeMeasurementResultsPackV1(previous);
  const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: [...previous.packs, pack], roots: [knowledgeVocabularyPackPinV1(pack)] });
  if (!resolved.ok) throw new Error(`Cannot resolve measurement pack: ${resolved.error.field}.`);
  return { previous, pack, resolved: resolved.value, schemas: resolved.value.packs.flatMap(item => item.schemas) };
});
type Setup = Awaited<typeof setup>;
function schema(context: Setup, identity: string): KnowledgeSchemaRevisionV1 {
  const found = context.schemas.find(item => `${item.identity.namespace.slice(7)}/${item.identity.code}` === identity);
  if (found === undefined) throw new Error(`Missing measurement test schema ${identity}.`);
  return found;
}
async function authority(context: Setup): Promise<SpongeKnowledgeProposalCompilerAuthorityV3> {
  const core = await spongeCoreKnowledgeCatalogV1();
  const actorId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const entity: KnowledgeEntityV1 = { entityId: actorId, identityOperationId: "identity.measurement-results-test",
    identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
  return { externalOperationReceiptSha256: await sha256Text("measurement results synthetic compiler fixture"),
    authorEntityId: actorId, authoringPolicySha256: core.rightsPolicySha256, occurredAt: "2026-09-15T00:00:00.000Z",
    spaceId: "space.measurement-results", schemas: context.schemas,
    existingEntities: new Map([[actorId, { entity, concepts: [schema(context, "core/agent").ref] }]]) };
}
function entity(context: Setup, key: string, identity: string): SpongeKnowledgeProposalDraftV3["entities"][number] {
  return { key, kind: "new", concepts: [schema(context, identity).ref], name: { language: "en", text: `Synthetic ${key}` } };
}
function fact(context: Setup, key: string, subject: string, predicate: string, target: string | KnowledgeValueV1): SpongeKnowledgeProposalDraftV3["facts"][number] {
  const object: SpongeKnowledgeProposalValueV3 = typeof target === "string" ? { kind: "entity-key", entityKey: target } : target;
  return { key: `fact.${key}`, subject: { kind: "key", key: subject }, predicate: schema(context, predicate).ref, object,
    contextKey: null, qualifiers: [], stance: "reports" };
}
function draft(entities: SpongeKnowledgeProposalDraftV3["entities"], facts: SpongeKnowledgeProposalDraftV3["facts"]): SpongeKnowledgeProposalDraftV3 {
  return { v: 3, entities, facts, contexts: [], evidence: [], vocabularyDependencies: [] };
}
function statements(compiled: SpongeCompiledKnowledgeProposalV3): KnowledgeStatementV1[] {
  return compiled.bundle.records.filter(item => item.kind === "statement").map(item => item.value as KnowledgeStatementV1);
}
function read(context: Setup, compiled: SpongeCompiledKnowledgeProposalV3, subject: string, predicate: string): KnowledgeValueV1 {
  const values = statements(compiled).filter(item => item.subject === subject && item.predicate.schemaSha256 === schema(context, predicate).ref.schemaSha256).map(item => item.object);
  if (values.length !== 1) throw new Error(`Expected one ${predicate}, found ${values.length}.`);
  return values[0]!;
}
function follow(context: Setup, compiled: SpongeCompiledKnowledgeProposalV3, subject: string, predicate: string): string {
  const value = read(context, compiled, subject, predicate);
  if (value.kind !== "entity") throw new Error(`Expected entity for ${predicate}.`);
  return value.entityId;
}
const text = (value: string): KnowledgeValueV1 => ({ kind: "string", value, v: 1 });
function time(context: Setup): KnowledgeValueV1 {
  return { kind: "time", value: "2026-09-14", calendar: schema(context, "reference/gregorian-calendar").ref,
    certainty: "exact", earliest: null, latest: null, precision: "day", timezone: null, v: 1 };
}
function quantity(context: Setup, value: string, unit: string, lowerBound: string | null = null, upperBound: string | null = null): KnowledgeValueV1 {
  return { kind: "quantity", value, unit: schema(context, `foundation/${unit}`).ref, lowerBound, upperBound, uncertainty: null, v: 1 };
}

// Competency cases are stated independently of the implementation's endpoint table.
const cases = [
  ["software-result-measurement", "software/measurement", "foundation/measurement"],
  ["measurement-model-version", "foundation/measurement", "software/model-version"],
  ["measurement-metric", "foundation/measurement", "measurement-results/metric-definition"],
  ["metric-definition-text", "measurement-results/metric-definition", text("Macro-average of per-category correctness; larger is better.")],
  ["measurement-dataset-split", "foundation/measurement", "measurement-results/dataset-split"],
  ["split-of-dataset-version", "measurement-results/dataset-split", "software/dataset-version"],
  ["split-selector", "measurement-results/dataset-split", text("test/v2/eligible.jsonl")],
  ["definition-evidence", "measurement-results/metric-definition", "identity-context/evidence-item"],
  ["definition-evidence", "measurement-results/dataset-split", "identity-context/evidence-bundle"],
  ["observation-has-measurement", "natural-world/observation", "foundation/measurement"],
  ["finding-has-measurement", "research/finding", "foundation/measurement"],
  ["backtest-has-measurement", "finance/backtest-run", "foundation/measurement"],
  ["measurement-at-location", "foundation/measurement", "core/place"],
  ["measurement-evidence", "foundation/measurement", "identity-context/evidence-item"],
  ["measurement-evidence", "foundation/measurement", "identity-context/evidence-bundle"],
  ["measurement-feature", "foundation/measurement", "natural-world/feature"],
] as const;

describe("measurement results v1", () => {
  test("resolves a minimal V5 dependency closure, preserves published declarations and binds discovery to its guide", async () => {
    const { pack, previous, resolved } = await setup;
    expect(pack.schemas.filter(item => item.kind === "concept")).toHaveLength(2);
    expect(pack.schemas.filter(item => item.kind === "predicate")).toHaveLength(14);
    const expectedDependencies = ["sponge.core", "sponge.finance", "sponge.foundation", "sponge.identity-context", "sponge.natural-world", "sponge.reference", "sponge.research", "sponge.software"];
    expect(pack.dependencies.map(item => item.packId)).toEqual(expectedDependencies);
    expect(resolved.packs.map(item => item.packId).sort()).toEqual([...expectedDependencies, pack.packId].sort());
    expect(String(previous.lock.lockSha256)).toBe("ad2f239537cd14021102a12c7e870c1a27fb695e4a51c123f6a7d28bbca0a2bd");
    expect((await createSpongeMeasurementResultsPackV1(previous)).manifestSha256).toBe(pack.manifestSha256);
    for (const item of resolved.packs.filter(item => item.packId !== pack.packId)) {
      const published = previous.packs.find(prior => prior.packId === item.packId);
      if (published === undefined) throw new Error(`Missing published dependency ${item.packId}.`);
      expect(item.manifestSha256).toBe(published.manifestSha256);
    }
    for (const declaration of pack.schemas) expect((await parseKnowledgeGraphRecordV1("schema", declaration)).ok).toBe(true);
    expect(pack.shapes).toHaveLength(2);
    for (const shape of pack.shapes) {
      expect((await parseKnowledgeGraphRecordV1("shape", shape)).ok).toBe(true);
      expect(shape.closed).toBe(false);
      expect(shape.rules.every(rule => rule.cardinality.minimum === 0 && rule.cardinality.maximum === null)).toBe(true);
    }
    const guide = await readFile(new URL("../../spec/research-v1/measurement-results-v1.md", import.meta.url), "utf8");
    expect(pack.sources[0]?.contentSha256).toBe(await sha256Text(guide));
    const discovery = JSON.parse(await readFile(new URL("../../spec/research-v1/measurement-results-v1.json", import.meta.url), "utf8"));
    expect(discovery.catalog).toEqual({ factory: "spongeKnowledgeDomainCatalogV6", builder: "createSpongeMeasurementResultsPackV1", baseFactory: "spongeKnowledgeDomainCatalogV5", additionalPack: pack.packId, additionalPackRevision: 1 });
    expect(discovery.concepts).toEqual(pack.schemas.filter(item => item.kind === "concept").map(item => item.identity.code));
    expect(discovery.relations).toEqual(pack.schemas.filter(item => item.kind === "predicate").map(item => item.identity.code));
    expect(discovery.queries).toEqual(pack.queries.map(item => item.id));
    expect(new Set(cases.map(item => item[0])).size).toBe(14);
  });

  test.each(cases)("compiles %s from %s and rejects a wrong domain or range", async (predicate, subject, target) => {
    const context = await setup;
    const entities = [entity(context, "subject", subject), ...(typeof target === "string" ? [entity(context, "object", target)] : [])];
    const proposal = draft(entities, [fact(context, "result", "subject", `measurement-results/${predicate}`, typeof target === "string" ? "object" : target)]);
    const trusted = await authority(context);
    const compiled = await compileSpongeKnowledgeProposalV3(proposal, trusted);
    expect(compiled).not.toBeNull();
    expect(compiled?.bundle.records.filter(item => item.kind === "assertion").every(item => typeof item.value === "object" && item.value !== null && "state" in item.value && item.value.state === "proposed")).toBe(true);
    expect(await compileSpongeKnowledgeProposalV3({ ...proposal, entities: [entity(context, "subject", "core/entity"), ...entities.slice(1)] }, trusted)).toBeNull();
    const wrongRange = typeof target === "string"
      ? { ...proposal, entities: [entities[0]!, entity(context, "object", "core/entity")] }
      : { ...proposal, facts: [{ ...proposal.facts[0]!, object: { kind: "decimal", value: "1", v: 1 } }] };
    expect(await compileSpongeKnowledgeProposalV3(wrongRange, trusted)).toBeNull();
  });

  test("traverses a compiled benchmark score to its exact model, split, metric, protocol and attributed source", async () => {
    const context = await setup;
    const entities = [
      ["run", "software/run"], ["result", "software/measurement"], ["measurement", "foundation/measurement"],
      ["model", "software/model-version"], ["dataset", "software/dataset-version"], ["split", "measurement-results/dataset-split"],
      ["metric", "measurement-results/metric-definition"], ["protocol", "software/benchmark-protocol"], ["configuration", "software/configuration"],
      ["evidence", "identity-context/evidence-item"], ["source", "research/publication-version"],
    ].map(([key, identity]) => entity(context, key!, identity!));
    const score = quantity(context, "0.75", "dimensionless");
    const facts = [
      fact(context, "produces", "run", "software/produces", "result"),
      fact(context, "bridges", "result", "measurement-results/software-result-measurement", "measurement"),
      fact(context, "model", "measurement", "measurement-results/measurement-model-version", "model"),
      fact(context, "quantity", "measurement", "foundation/normalized-quantity", score),
      fact(context, "metric", "measurement", "measurement-results/measurement-metric", "metric"),
      fact(context, "metric-definition", "metric", "measurement-results/metric-definition-text", text("Macro-average correctness across the three retained test categories; larger is better.")),
      fact(context, "split", "measurement", "measurement-results/measurement-dataset-split", "split"),
      fact(context, "dataset", "split", "measurement-results/split-of-dataset-version", "dataset"),
      fact(context, "selector", "split", "measurement-results/split-selector", text("test/v2/eligible.jsonl")),
      fact(context, "protocol", "run", "software/evaluated-under", "protocol"),
      fact(context, "configuration", "run", "software/uses-configuration", "configuration"),
      fact(context, "run-dataset", "run", "software/uses-dataset", "dataset"),
      fact(context, "method", "measurement", "foundation/measurement-method", "protocol"),
      fact(context, "time", "measurement", "foundation/measured-at", time(context)),
      fact(context, "evidence", "measurement", "measurement-results/measurement-evidence", "evidence"),
      fact(context, "metric-source", "metric", "measurement-results/definition-evidence", "evidence"),
      fact(context, "split-source", "split", "measurement-results/definition-evidence", "evidence"),
      fact(context, "source", "evidence", "identity-context/evidence-source", "source"),
      fact(context, "locator", "evidence", "identity-context/evidence-excerpt", text("Retained revision r2, Table 3, row 4")),
      fact(context, "capture-time", "evidence", "identity-context/captured-at", time(context)),
    ];
    const quantityFact = facts.find(item => item.key === "fact.quantity")!;
    const proposal = { ...draft(entities, facts.map(item => item === quantityFact ? { ...item, qualifiers: [{
      predicate: schema(context, "foundation/version-context").ref, value: { kind: "entity-key" as const, entityKey: "source" },
    }] } : item)), evidence: [{ key: "table", factKey: "fact.quantity", source: { kind: "key" as const, key: "source" },
      bearing: "supports" as const, selector: "Table 3, row 4", attribution: { kind: "agent-supplied" as const, sourceUri: "https://example.org/synthetic-benchmark/r2" } }] };
    const compiled = await compileSpongeKnowledgeProposalV3(proposal, await authority(context));
    expect(compiled).not.toBeNull();
    if (compiled === null) throw new Error("Expected benchmark proposal.");
    const result = follow(context, compiled, compiled.entityIds["run"]!, "software/produces");
    const measurement = follow(context, compiled, result, "measurement-results/software-result-measurement");
    expect(result).not.toBe(measurement);
    expect(read(context, compiled, measurement, "foundation/normalized-quantity")).toEqual(score);
    expect(follow(context, compiled, measurement, "measurement-results/measurement-model-version")).toBe(compiled.entityIds["model"]!);
    const split = follow(context, compiled, measurement, "measurement-results/measurement-dataset-split");
    expect(follow(context, compiled, split, "measurement-results/split-of-dataset-version")).toBe(compiled.entityIds["dataset"]!);
    expect(read(context, compiled, split, "measurement-results/split-selector")).toEqual(text("test/v2/eligible.jsonl"));
    const metric = follow(context, compiled, measurement, "measurement-results/measurement-metric");
    expect(read(context, compiled, metric, "measurement-results/metric-definition-text")).toEqual(text("Macro-average correctness across the three retained test categories; larger is better."));
    expect(follow(context, compiled, measurement, "foundation/measurement-method")).toBe(follow(context, compiled, compiled.entityIds["run"]!, "software/evaluated-under"));
    const evidence = follow(context, compiled, measurement, "measurement-results/measurement-evidence");
    expect(follow(context, compiled, evidence, "identity-context/evidence-source")).toBe(compiled.entityIds["source"]!);
    expect(read(context, compiled, evidence, "identity-context/evidence-excerpt")).toEqual(text("Retained revision r2, Table 3, row 4"));
    expect(statements(compiled).find(item => item.predicate.schemaSha256 === schema(context, "foundation/normalized-quantity").ref.schemaSha256)?.qualifiers).toEqual([{
      predicate: schema(context, "foundation/version-context").ref, value: { kind: "entity", entityId: compiled.entityIds["source"]!, v: 1 }, v: 1,
    }]);
    expect(compiled.sourceAttributions).toContainEqual(expect.objectContaining({ kind: "agent-supplied", sourceEntityId: compiled.entityIds["source"], selector: "Table 3, row 4", sourceUri: "https://example.org/synthetic-benchmark/r2" }));
    const query = context.pack.queries.find(item => item.id === "benchmark-score")!;
    expect(proposal.facts.every(item => query.predicates.some(ref => ref.schemaSha256 === item.predicate.schemaSha256))).toBe(true);
    // A software result cannot acquire foundation quantities by name equality.
    expect(await compileSpongeKnowledgeProposalV3({ ...proposal, facts: proposal.facts.map(item => item.key === "fact.quantity" ? { ...item, subject: { kind: "key", key: "result" } } : item) }, await authority(context))).toBeNull();
    // A generic artifact is not an exact model version.
    expect(await compileSpongeKnowledgeProposalV3({ ...proposal, entities: proposal.entities.map(item => item.key === "model" ? entity(context, "model", "core/artifact") : item) }, await authority(context))).toBeNull();
  });

  test("traverses cloud altitude with bounds, time, place, feature, method, reference surface and evidence intact", async () => {
    const context = await setup;
    const entities = [["observation", "natural-world/observation"], ["cloud", "natural-world/physical-occurrence"],
      ["measurement", "foundation/measurement"], ["feature", "natural-world/feature"], ["place", "core/place"],
      ["method", "research/method"], ["surface", "core/concept"], ["evidence", "identity-context/evidence-item"], ["source", "research/publication-version"]]
      .map(([key, identity]) => entity(context, key!, identity!));
    const altitude = quantity(context, "1200", "meter", "1150", "1250");
    const facts = [
      fact(context, "observes", "observation", "natural-world/observes", "cloud"),
      fact(context, "observation-place", "observation", "natural-world/observed-at", "place"),
      fact(context, "measurement", "observation", "measurement-results/observation-has-measurement", "measurement"),
      fact(context, "subject", "measurement", "foundation/measurement-of", "cloud"),
      fact(context, "feature", "measurement", "measurement-results/measurement-feature", "feature"),
      { ...fact(context, "quantity", "measurement", "foundation/normalized-quantity", altitude), qualifiers: [{
        predicate: schema(context, "foundation/scope-context").ref, value: { kind: "entity-key" as const, entityKey: "surface" },
      }] },
      fact(context, "time", "measurement", "foundation/measured-at", time(context)),
      fact(context, "place", "measurement", "measurement-results/measurement-at-location", "place"),
      fact(context, "method", "measurement", "foundation/measurement-method", "method"),
      fact(context, "evidence", "measurement", "measurement-results/measurement-evidence", "evidence"),
      fact(context, "source", "evidence", "identity-context/evidence-source", "source"),
      fact(context, "excerpt", "evidence", "identity-context/evidence-excerpt", text("Cloud-base observation, 1200 m above local ground level")),
    ];
    const compiled = await compileSpongeKnowledgeProposalV3(draft(entities, facts), await authority(context));
    if (compiled === null) throw new Error("Expected cloud proposal.");
    const measurement = follow(context, compiled, compiled.entityIds["observation"]!, "measurement-results/observation-has-measurement");
    expect(follow(context, compiled, measurement, "foundation/measurement-of")).toBe(follow(context, compiled, compiled.entityIds["observation"]!, "natural-world/observes"));
    expect(read(context, compiled, measurement, "foundation/normalized-quantity")).toEqual(altitude);
    expect(read(context, compiled, measurement, "foundation/measured-at")).toEqual(time(context));
    expect(follow(context, compiled, measurement, "measurement-results/measurement-at-location")).toBe(compiled.entityIds["place"]!);
    expect(follow(context, compiled, measurement, "measurement-results/measurement-feature")).toBe(compiled.entityIds["feature"]!);
    expect(follow(context, compiled, measurement, "foundation/measurement-method")).toBe(compiled.entityIds["method"]!);
    expect(follow(context, compiled, follow(context, compiled, measurement, "measurement-results/measurement-evidence"), "identity-context/evidence-source")).toBe(compiled.entityIds["source"]!);
    expect(statements(compiled).find(item => item.predicate.schemaSha256 === schema(context, "foundation/normalized-quantity").ref.schemaSha256)?.qualifiers[0]?.value).toEqual({ kind: "entity", entityId: compiled.entityIds["surface"]!, v: 1 });
    const query = context.pack.queries.find(item => item.id === "cloud-observation")!;
    expect(facts.every(item => query.predicates.some(ref => ref.schemaSha256 === item.predicate.schemaSha256))).toBe(true);
  });

  test("keeps missing context absent and separates a finding's measurement from a backtest's", async () => {
    const context = await setup;
    const entities = [["study", "research/study"], ["finding", "research/finding"], ["backtest", "finance/backtest-run"],
      ["strategy", "finance/strategy-version"], ["dataset", "software/dataset-version"], ["finding-result", "foundation/measurement"],
      ["backtest-result", "foundation/measurement"]].map(([key, identity]) => entity(context, key!, identity!));
    const facts = [fact(context, "finding", "study", "research/produces-finding", "finding"),
      fact(context, "finding-result", "finding", "measurement-results/finding-has-measurement", "finding-result"),
      fact(context, "backtest-result", "backtest", "measurement-results/backtest-has-measurement", "backtest-result"),
      fact(context, "strategy", "backtest", "finance/tests-strategy", "strategy"),
      fact(context, "dataset", "backtest", "finance/uses-dataset", "dataset")];
    const compiled = await compileSpongeKnowledgeProposalV3(draft(entities, facts), await authority(context));
    if (compiled === null) throw new Error("Expected partial finding/backtest proposal.");
    expect(follow(context, compiled, compiled.entityIds["finding"]!, "measurement-results/finding-has-measurement")).not.toBe(follow(context, compiled, compiled.entityIds["backtest"]!, "measurement-results/backtest-has-measurement"));
    expect(statements(compiled).some(item => item.predicate.schemaSha256 === schema(context, "foundation/normalized-quantity").ref.schemaSha256)).toBe(false);
    expect(statements(compiled).some(item => item.predicate.schemaSha256 === schema(context, "measurement-results/measurement-metric").ref.schemaSha256)).toBe(false);
    expect(context.pack.schemas.some(item => item.kind === "unit")).toBe(false);
    const query = context.pack.queries.find(item => item.id === "research-and-backtest-results")!;
    expect(facts.every(item => query.predicates.some(ref => canonicalJson(ref as unknown as JsonValue) === canonicalJson(item.predicate as unknown as JsonValue)))).toBe(true);
  });
});
