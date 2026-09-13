import { canonicalJson, type JsonValue } from "./document-domain";
import { knowledgeDeclarativeJson, freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import {
  parseKnowledgeEntityId, parseKnowledgeSchemaRefV1, parseKnowledgeValueV1,
  SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1, SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1,
  SPONGE_KNOWLEDGE_SCENARIOS_V1,
  type KnowledgeEntityId, type KnowledgeSchemaRefV1, type KnowledgeValueV1,
  type KnowledgeAssertionStanceV1, type KnowledgeEvidenceBearingV1, type KnowledgeScenarioV1,
} from "./knowledge-ontology-v1";
import { hasExactDataKeys, isPlainRecord } from "./unknown";

export type SpongeKnowledgeEntityReferenceV3 =
  | Readonly<{ kind: "key"; key: string }>
  | Readonly<{ kind: "existing"; entityId: KnowledgeEntityId }>;
export type SpongeKnowledgeProposalValueV3 =
  | Exclude<KnowledgeValueV1, { kind: "list" | "set" }>
  | Readonly<{ kind: "entity-key"; entityKey: string }>
  | Readonly<{ kind: "list"; values: readonly SpongeKnowledgeProposalValueV3[]; v: 1 }>
  | Readonly<{ kind: "set"; values: readonly SpongeKnowledgeProposalValueV3[]; v: 1 }>;
export type SpongeKnowledgeProposalDimensionV3 = Readonly<{
  predicate: KnowledgeSchemaRefV1; value: SpongeKnowledgeProposalValueV3;
}>;
export type SpongeKnowledgeProposalEntityV3 =
  | Readonly<{ key: string; kind: "new"; concepts: readonly KnowledgeSchemaRefV1[];
    name: Readonly<{ language: string; text: string }> }>
  | Readonly<{ key: string; kind: "existing"; entityId: KnowledgeEntityId }>;
export type SpongeKnowledgeProposalDraftV3 = Readonly<{
  v: 3;
  entities: readonly SpongeKnowledgeProposalEntityV3[];
  facts: readonly Readonly<{
    key: string; subject: SpongeKnowledgeEntityReferenceV3; predicate: KnowledgeSchemaRefV1;
    object: SpongeKnowledgeProposalValueV3; qualifiers: readonly SpongeKnowledgeProposalDimensionV3[];
    contextKey: string | null; stance: KnowledgeAssertionStanceV1;
  }>[];
  contexts: readonly Readonly<{
    key: string; scenario: KnowledgeScenarioV1; dimensions: readonly SpongeKnowledgeProposalDimensionV3[];
  }>[];
  evidence: readonly Readonly<{
    key: string; factKey: string; source: SpongeKnowledgeEntityReferenceV3;
    bearing: KnowledgeEvidenceBearingV1; selector: string | null;
    attribution: Readonly<{ kind: "agent-supplied"; sourceUri: string | null }>;
  }>[];
  vocabularyDependencies: readonly KnowledgeSchemaRefV1[];
}>;

function key(value: unknown): value is string {
  return typeof value === "string" && value.length <= 96 && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(value);
}
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function ref(value: unknown): KnowledgeSchemaRefV1 | null {
  const parsed = parseKnowledgeSchemaRefV1(value);
  return parsed.ok ? parsed.value : null;
}
function refs(value: unknown): readonly KnowledgeSchemaRefV1[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const parsed = value.map(ref);
  if (parsed.some((item) => item === null)) return null;
  const sorted = (parsed as KnowledgeSchemaRefV1[]).sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  return new Set(sorted.map(canonical)).size === sorted.length ? sorted : null;
}
function entityReference(value: unknown): SpongeKnowledgeEntityReferenceV3 | null {
  if (!isPlainRecord(value)) return null;
  if (value["kind"] === "key" && hasExactDataKeys(value, ["kind", "key"]) && key(value["key"])) {
    return { kind: "key", key: value["key"] };
  }
  if (value["kind"] === "existing" && hasExactDataKeys(value, ["kind", "entityId"])) {
    const entityId = parseKnowledgeEntityId(value["entityId"]);
    if (entityId !== null) return { kind: "existing", entityId };
  }
  return null;
}
function draftValue(value: unknown, depth = 0): SpongeKnowledgeProposalValueV3 | null {
  if (depth > 16 || !isPlainRecord(value)) return null;
  if (value["kind"] === "entity-key" && hasExactDataKeys(value, ["kind", "entityKey"]) && key(value["entityKey"])) {
    return { kind: "entity-key", entityKey: value["entityKey"] };
  }
  if ((value["kind"] === "list" || value["kind"] === "set")
    && hasExactDataKeys(value, ["kind", "values", "v"]) && value["v"] === 1 && Array.isArray(value["values"])
    && value["values"].length <= 256) {
    const values = value["values"].map((item) => draftValue(item, depth + 1));
    if (values.some((item) => item === null)) return null;
    const parsed = values as SpongeKnowledgeProposalValueV3[];
    if (value["kind"] === "set") {
      parsed.sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
      if (new Set(parsed.map(canonical)).size !== parsed.length) return null;
    }
    return { kind: value["kind"], values: parsed, v: 1 };
  }
  const parsed = parseKnowledgeValueV1(value);
  return parsed.ok ? parsed.value : null;
}
function dimensions(value: unknown): readonly SpongeKnowledgeProposalDimensionV3[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const parsed: SpongeKnowledgeProposalDimensionV3[] = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactDataKeys(item, ["predicate", "value"])) return null;
    const predicate = ref(item["predicate"]);
    const child = draftValue(item["value"]);
    if (predicate === null || child === null) return null;
    parsed.push({ predicate, value: child });
  }
  parsed.sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  return new Set(parsed.map(canonical)).size === parsed.length ? parsed : null;
}

/** No actor, review, publication, merge, installed-state, or source-verification claims are accepted. */
export function parseSpongeKnowledgeProposalDraftV3(foreign: unknown): SpongeKnowledgeProposalDraftV3 | null {
  const value = knowledgeDeclarativeJson(foreign, 256 * 1_024);
  if (!isPlainRecord(value) || !hasExactDataKeys(value,
    ["v", "entities", "facts", "contexts", "evidence", "vocabularyDependencies"]) || value["v"] !== 3
    || !Array.isArray(value["entities"]) || value["entities"].length > 32
    || !Array.isArray(value["facts"]) || value["facts"].length > 128
    || !Array.isArray(value["contexts"]) || value["contexts"].length > 32
    || !Array.isArray(value["evidence"]) || value["evidence"].length > 128) return null;
  const entities: SpongeKnowledgeProposalEntityV3[] = [];
  for (const item of value["entities"]) {
    if (!isPlainRecord(item) || !key(item["key"])) return null;
    if (item["kind"] === "existing" && hasExactDataKeys(item, ["key", "kind", "entityId"])) {
      const entityId = parseKnowledgeEntityId(item["entityId"]);
      if (entityId === null) return null;
      entities.push({ key: item["key"], kind: "existing", entityId });
    } else if (item["kind"] === "new" && hasExactDataKeys(item, ["key", "kind", "concepts", "name"])
      && isPlainRecord(item["name"]) && hasExactDataKeys(item["name"], ["language", "text"])) {
      const concepts = refs(item["concepts"]);
      const name = parseKnowledgeValueV1({ kind: "text", v: 1, ...item["name"] });
      if (concepts === null || concepts.length === 0 || concepts.length > 16 || !name.ok || name.value.kind !== "text") return null;
      entities.push({ key: item["key"], kind: "new", concepts,
        name: { language: name.value.language, text: name.value.text } });
    } else return null;
  }
  const facts: SpongeKnowledgeProposalDraftV3["facts"][number][] = [];
  for (const item of value["facts"]) {
    if (!isPlainRecord(item) || !hasExactDataKeys(item,
      ["key", "subject", "predicate", "object", "qualifiers", "contextKey", "stance"]) || !key(item["key"])) return null;
    const subject = entityReference(item["subject"]);
    const predicate = ref(item["predicate"]);
    const object = draftValue(item["object"]);
    const qualifiers = dimensions(item["qualifiers"]);
    const stance = SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1.find((candidate) => candidate === item["stance"]);
    if (subject === null || predicate === null || object === null || qualifiers === null || stance === undefined
      || !(item["contextKey"] === null || key(item["contextKey"]))) return null;
    facts.push({ key: item["key"], subject, predicate, object, qualifiers, contextKey: item["contextKey"], stance });
  }
  const contexts: SpongeKnowledgeProposalDraftV3["contexts"][number][] = [];
  for (const item of value["contexts"]) {
    if (!isPlainRecord(item) || !hasExactDataKeys(item, ["key", "scenario", "dimensions"]) || !key(item["key"])) return null;
    const scenario = SPONGE_KNOWLEDGE_SCENARIOS_V1.find((candidate) => candidate === item["scenario"]);
    const parsed = dimensions(item["dimensions"]);
    if (scenario === undefined || parsed === null) return null;
    contexts.push({ key: item["key"], scenario, dimensions: parsed });
  }
  const evidence: SpongeKnowledgeProposalDraftV3["evidence"][number][] = [];
  for (const item of value["evidence"]) {
    if (!isPlainRecord(item) || !hasExactDataKeys(item,
      ["key", "factKey", "source", "bearing", "selector", "attribution"]) || !key(item["key"]) || !key(item["factKey"])
      || !(item["selector"] === null || typeof item["selector"] === "string" && item["selector"].length > 0 && item["selector"].length <= 4_096)
      || !isPlainRecord(item["attribution"]) || !hasExactDataKeys(item["attribution"], ["kind", "sourceUri"])
      || item["attribution"]["kind"] !== "agent-supplied") return null;
    const source = entityReference(item["source"]);
    const bearing = SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1.find((candidate) => candidate === item["bearing"]);
    const sourceUri = item["attribution"]["sourceUri"];
    if (source === null || bearing === undefined || !(sourceUri === null || typeof sourceUri === "string")) return null;
    if (sourceUri !== null && !parseKnowledgeValueV1({ kind: "uri", uri: sourceUri, v: 1 }).ok) return null;
    evidence.push({ key: item["key"], factKey: item["factKey"], source, bearing,
      selector: item["selector"], attribution: { kind: "agent-supplied", sourceUri } });
  }
  const vocabularyDependencies = refs(value["vocabularyDependencies"]);
  if (vocabularyDependencies === null || facts.length + entities.length + contexts.length + evidence.length === 0) return null;
  const all = [...entities, ...facts, ...contexts, ...evidence];
  if (new Set(all.map((item) => item.key)).size !== all.length) return null;
  const entityKeys = new Set(entities.map((item) => item.key));
  const contextKeys = new Set(contexts.map((item) => item.key));
  const factKeys = new Set(facts.map((item) => item.key));
  const validReference = (item: SpongeKnowledgeEntityReferenceV3) => item.kind === "existing" || entityKeys.has(item.key);
  const validValue = (item: SpongeKnowledgeProposalValueV3): boolean => item.kind === "entity-key" ? entityKeys.has(item.entityKey)
    : item.kind === "list" || item.kind === "set" ? item.values.every(validValue) : true;
  if (facts.some((item) => !validReference(item.subject) || !validValue(item.object)
      || item.qualifiers.some((dimension) => !validValue(dimension.value))
      || item.contextKey !== null && !contextKeys.has(item.contextKey))
    || contexts.some((item) => item.dimensions.some((dimension) => !validValue(dimension.value)))
    || evidence.some((item) => !validReference(item.source) || !factKeys.has(item.factKey))) return null;
  const sortKeys = <T extends { key: string }>(items: T[]) => items.sort((a, b) => a.key < b.key ? -1 : 1);
  return freezeKnowledgeDeclaration({ v: 3, entities: sortKeys(entities), facts: sortKeys(facts),
    contexts: sortKeys(contexts), evidence: sortKeys(evidence), vocabularyDependencies });
}
