import {
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  orderedUnique,
  parseSha256Hex,
  safeCode,
  sha256Hex,
  sortUnique,
  utf8ByteLength,
  type JsonPrimitive,
  type Sha256Hex,
} from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import {
  knowledgeGraphRecordRefV1,
  OH_GRAPH_LIMITS_V1,
  OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  parseKnowledgeGraphRecordV1,
  type KnowledgeGraphRecordKindV1,
  type KnowledgeGraphRecordRefV1,
  type KnowledgeGraphRecordV1,
} from "./graph";

export const OH_PROJECTION_FORMAT_VERSION_V1 = 1 as const;
export const OH_PROJECTION_SEMANTICS_V1 = "oh.projection.positive-datalog.v1" as const;
export const OH_PROJECTION_INTERNAL_ENGINE_V1 = "oh.naive.positive.v1" as const;

export const OH_PROJECTION_LIMITS_V1 = Object.freeze({
  arity: 32,
  atomBytes: 16 * 1024,
  derivedTuples: 262_144,
  facts: 262_144,
  literalsPerRule: 64,
  proofDepth: 128,
  proofNodes: 4_096,
  queryLiterals: 64,
  queryMatches: 262_144,
  queryResults: 65_536,
  relations: 4_096,
  resultBytes: 16 * 1024 * 1024,
  rounds: 1_024,
  rules: 1_024,
  sourcesPerFact: 64,
  totalProofNodes: 65_536,
  variables: 256,
  workUnits: 16_777_216,
});

export type OhProjectionAtomV1 = JsonPrimitive;

export type OhProjectionSnapshotV1 = Readonly<{
  contractSha256: Sha256Hex;
  generation: number;
  graphRevisionSha256: Sha256Hex | null;
  operationSha256: Sha256Hex | null;
  recordRefs: readonly KnowledgeGraphRecordRefV1[];
  recordsSha256: Sha256Hex;
  sequence: number;
  snapshotSha256: Sha256Hex;
  spaceId: string;
  v: 1;
}>;

export type OhProjectionFactSourceV1 = Readonly<{
  key: string;
  recordSha256: Sha256Hex;
  v: 1;
}>;

export type OhProjectionFactV1 = Readonly<{
  factSha256: Sha256Hex;
  relation: string;
  sources: readonly OhProjectionFactSourceV1[];
  tuple: readonly OhProjectionAtomV1[];
  v: 1;
}>;

export type OhProjectionDatasetV1 = Readonly<{
  datasetSha256: Sha256Hex;
  extractorSha256: Sha256Hex;
  factPackId: string;
  factPackRevision: number;
  factPackSha256: Sha256Hex;
  facts: readonly OhProjectionFactV1[];
  factsSha256: Sha256Hex;
  snapshotSha256: Sha256Hex;
  v: 1;
}>;

const recordFactExtractorPayloadV1 = {
  factPackId: "oh.record-facts",
  factPackRevision: 1,
  relations: ["oh.dependency", "oh.record"],
  semantics: OH_PROJECTION_SEMANTICS_V1,
  v: 1,
} as const;

export const OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1 = Object.freeze({
  ...recordFactExtractorPayloadV1,
  extractorSha256: canonicalSha256(recordFactExtractorPayloadV1),
});

export type OhProjectionTermV1 =
  | Readonly<{ kind: "constant"; v: 1; value: OhProjectionAtomV1 }>
  | Readonly<{ kind: "variable"; name: string; v: 1 }>;

export type OhProjectionLiteralV1 = Readonly<{
  relation: string;
  terms: readonly OhProjectionTermV1[];
  v: 1;
}>;

export type OhProjectionRuleV1 = Readonly<{
  body: readonly OhProjectionLiteralV1[];
  head: OhProjectionLiteralV1;
  ruleId: string;
  ruleSha256: Sha256Hex;
  v: 1;
}>;

export type OhProjectionRulePackV1 = Readonly<{
  rulePackId: string;
  rulePackRevision: number;
  rulePackSha256: Sha256Hex;
  rules: readonly OhProjectionRuleV1[];
  rulesSha256: Sha256Hex;
  semantics: typeof OH_PROJECTION_SEMANTICS_V1;
  v: 1;
}>;

export type OhProjectionQueryV1 = Readonly<{
  find: readonly string[];
  limit: number;
  queryId: string;
  querySha256: Sha256Hex;
  where: readonly OhProjectionLiteralV1[];
  v: 1;
}>;

export type OhProjectionIdentityV1 = Readonly<{
  contractSha256: Sha256Hex;
  datasetSha256: Sha256Hex;
  engineSha256: Sha256Hex;
  evaluationSha256: Sha256Hex;
  projectionSha256: Sha256Hex;
  querySha256: Sha256Hex;
  rulePackSha256: Sha256Hex;
  semantics: typeof OH_PROJECTION_SEMANTICS_V1;
  snapshotSha256: Sha256Hex;
  v: 1;
}>;

export type OhProjectionProofV1 =
  | Readonly<{
    kind: "fact";
    relation: string;
    sources: readonly OhProjectionFactSourceV1[];
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
  }>
  | Readonly<{
    kind: "derived";
    premises: readonly OhProjectionProofV1[];
    premisesTruncated: boolean;
    relation: string;
    ruleId: string;
    ruleSha256: Sha256Hex;
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
  }>
  | Readonly<{
    kind: "truncated";
    reason: "cycle" | "depth" | "nodes";
    relation: string;
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
  }>;

export type OhProjectionResultRowV1 = Readonly<{
  proofs: readonly OhProjectionProofV1[];
  proofsTruncated: boolean;
  supportCount: number;
  values: readonly OhProjectionAtomV1[];
  v: 1;
}>;

export type OhProjectionResultV1 = Readonly<{
  authority: "derived";
  cache: Readonly<{ strategy: "full-rebuild"; v: 1 }>;
  engine: string;
  evaluation: Readonly<{
    maximumDerivedTuples: number;
    maximumProofDepth: number;
    maximumProofNodes: number;
    maximumResultBytes: number;
    maximumRounds: number;
    maximumTotalProofNodes: number;
    maximumWorkUnits: number;
    v: 1;
  }>;
  identity: OhProjectionIdentityV1;
  resultSha256: Sha256Hex;
  rows: readonly OhProjectionResultRowV1[];
  stats: Readonly<{
    baseFacts: number;
    derivedFacts: number;
    proofNodes: number;
    queryMatches: number;
    relations: number;
    rounds: number;
    proofsTruncated: boolean;
    truncated: boolean;
    truncationReasons: readonly ("query-limit" | "result-bytes")[];
    workUnits: number;
    v: 1;
  }>;
  v: 1;
}>;

export type OhProjectionEvaluationOptionsV1 = Readonly<{
  maximumDerivedTuples?: number;
  maximumProofDepth?: number;
  maximumProofNodes?: number;
  maximumResultBytes?: number;
  maximumRounds?: number;
  maximumTotalProofNodes?: number;
  maximumWorkUnits?: number;
}>;

export type OhProjectionInvalidationReasonV1 =
  | "dataset-changed"
  | "engine-changed"
  | "evaluation-changed"
  | "query-changed"
  | "rule-pack-changed"
  | "snapshot-changed";

export type OhProjectionInvalidationV1 =
  | Readonly<{ kind: "reusable"; v: 1 }>
  | Readonly<{
    kind: "full-rebuild";
    reasons: readonly OhProjectionInvalidationReasonV1[];
    v: 1;
  }>;

type ProjectionHeadInputV1 = Readonly<{
  generation: number;
  graphRevisionSha256: Sha256Hex | null;
  operationSha256: Sha256Hex | null;
  recordsSha256: Sha256Hex;
  sequence: number;
}>;

function nonnegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function positiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum
    ? value as number : null;
}

function projectionName(value: unknown, maximumLength = 128): string | null {
  return safeCode(value, maximumLength);
}

function compareCanonical(left: unknown, right: unknown): number {
  const leftKey = canonicalJson(left);
  const rightKey = canonicalJson(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function compareProjectionFacts(left: OhProjectionFactV1, right: OhProjectionFactV1): number {
  return compareCanonical([left.relation, left.tuple], [right.relation, right.tuple]);
}

const INVALID_PROJECTION_ATOM = Symbol("invalid-projection-atom");

function atom(value: unknown): OhProjectionAtomV1 | typeof INVALID_PROJECTION_ATOM {
  if (value !== null && typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
    return INVALID_PROJECTION_ATOM;
  }
  try {
    const encoded = canonicalJson(value);
    return utf8ByteLength(encoded) <= OH_PROJECTION_LIMITS_V1.atomBytes
      ? value as OhProjectionAtomV1 : INVALID_PROJECTION_ATOM;
  } catch {
    return INVALID_PROJECTION_ATOM;
  }
}

function tuple(value: unknown): readonly OhProjectionAtomV1[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > OH_PROJECTION_LIMITS_V1.arity) return null;
  const parsed = value.map(atom);
  return parsed.some((item) => item === INVALID_PROJECTION_ATOM)
    ? null : parsed as readonly OhProjectionAtomV1[];
}

function parseRecordRef(value: unknown): KnowledgeGraphRecordRefV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["dependencies", "key", "kind", "sha256", "v"])
    || value.v !== 1 || !Array.isArray(value.dependencies)) return null;
  const key = safeCode(value.key, 512);
  const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === value.kind);
  const sha256 = parseSha256Hex(value.sha256);
  const dependencies = value.dependencies.map((dependency) => safeCode(dependency, 512));
  if (key === null || kind === undefined || sha256 === null
    || dependencies.length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord
    || dependencies.some((dependency) => dependency === null)
    || !orderedUnique(dependencies as readonly string[], String)
    || dependencies.includes(key)) return null;
  return { dependencies: dependencies as readonly string[], key, kind, sha256, v: 1 };
}

export function createOhProjectionSnapshotV1(input: Readonly<{
  head: ProjectionHeadInputV1;
  records: readonly KnowledgeGraphRecordV1[];
  spaceId: string;
}>): OhProjectionSnapshotV1 {
  const spaceId = projectionName(input.spaceId);
  const generation = nonnegativeInteger(input.head.generation);
  const sequence = nonnegativeInteger(input.head.sequence);
  const operationSha256 = input.head.operationSha256 === null ? null : parseSha256Hex(input.head.operationSha256);
  const graphRevisionSha256 = input.head.graphRevisionSha256 === null
    ? null : parseSha256Hex(input.head.graphRevisionSha256);
  const declaredRecordsSha256 = parseSha256Hex(input.head.recordsSha256);
  if (spaceId === null || generation === null || sequence === null || generation !== sequence
    || (input.head.operationSha256 !== null && operationSha256 === null)
    || (input.head.graphRevisionSha256 !== null && graphRevisionSha256 === null)
    || ((sequence === 0) !== (operationSha256 === null))
    || ((sequence === 0) !== (graphRevisionSha256 === null))
    || declaredRecordsSha256 === null || input.records.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new TypeError("Invalid projection snapshot head.");
  }
  const records = input.records.map(parseKnowledgeGraphRecordV1);
  if (records.some((record) => record === null)) throw new TypeError("Invalid record in projection snapshot.");
  const recordRefs = sortUnique(
    (records as readonly KnowledgeGraphRecordV1[]).map(knowledgeGraphRecordRefV1),
    (reference) => reference.key,
  );
  const recordsSha256 = canonicalSha256(recordRefs);
  if (recordsSha256 !== declaredRecordsSha256) {
    throw new TypeError("Projection snapshot records do not reproduce the declared head.");
  }
  const keys = new Set(recordRefs.map((reference) => reference.key));
  if (recordRefs.some((reference) => reference.dependencies.some((dependency) => !keys.has(dependency)))) {
    throw new TypeError("Projection snapshot has a missing record dependency.");
  }
  const payload = {
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    generation,
    graphRevisionSha256,
    operationSha256,
    recordRefs,
    recordsSha256,
    sequence,
    spaceId,
    v: 1 as const,
  };
  return { ...payload, snapshotSha256: canonicalSha256(payload) };
}

export function parseOhProjectionSnapshotV1(value: unknown): OhProjectionSnapshotV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["contractSha256", "generation",
    "graphRevisionSha256", "operationSha256", "recordRefs", "recordsSha256", "sequence",
    "snapshotSha256", "spaceId", "v"]) || value.v !== 1 || !Array.isArray(value.recordRefs)
    || value.recordRefs.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) return null;
  const contractSha256 = parseSha256Hex(value.contractSha256);
  const generation = nonnegativeInteger(value.generation);
  const sequence = nonnegativeInteger(value.sequence);
  const graphRevisionSha256 = value.graphRevisionSha256 === null
    ? null : parseSha256Hex(value.graphRevisionSha256);
  const operationSha256 = value.operationSha256 === null ? null : parseSha256Hex(value.operationSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const snapshotSha256 = parseSha256Hex(value.snapshotSha256);
  const spaceId = projectionName(value.spaceId);
  const recordRefs = value.recordRefs.map(parseRecordRef);
  if (contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256 || generation === null || sequence === null
    || generation !== sequence || spaceId === null || recordsSha256 === null || snapshotSha256 === null
    || (value.graphRevisionSha256 !== null && graphRevisionSha256 === null)
    || (value.operationSha256 !== null && operationSha256 === null)
    || ((sequence === 0) !== (operationSha256 === null))
    || ((sequence === 0) !== (graphRevisionSha256 === null))
    || recordRefs.some((reference) => reference === null)) return null;
  const refs = recordRefs as readonly KnowledgeGraphRecordRefV1[];
  if (!orderedUnique(refs, (reference) => reference.key) || canonicalSha256(refs) !== recordsSha256) return null;
  const keys = new Set(refs.map((reference) => reference.key));
  if (refs.some((reference) => reference.dependencies.some((dependency) => !keys.has(dependency)))) return null;
  const payload = { contractSha256, generation, graphRevisionSha256, operationSha256,
    recordRefs: refs, recordsSha256, sequence, spaceId, v: 1 as const };
  return canonicalSha256(payload) === snapshotSha256 ? { ...payload, snapshotSha256 } : null;
}

export function createOhProjectionFactV1(input: Readonly<{
  relation: string;
  sources: readonly OhProjectionFactSourceV1[];
  tuple: readonly OhProjectionAtomV1[];
}>): OhProjectionFactV1 {
  const relation = projectionName(input.relation);
  const parsedTuple = tuple(input.tuple);
  if (relation === null || parsedTuple === null || input.sources.length < 1
    || input.sources.length > OH_PROJECTION_LIMITS_V1.sourcesPerFact) {
    throw new TypeError("Invalid projection fact.");
  }
  const sources = input.sources.map((source) => {
    if (!isPlainRecord(source) || !hasExactKeys(source, ["key", "recordSha256", "v"]) || source.v !== 1) {
      throw new TypeError("Invalid projection fact source.");
    }
    const key = safeCode(source.key, 512);
    const recordSha256 = parseSha256Hex(source.recordSha256);
    if (key === null || recordSha256 === null) throw new TypeError("Invalid projection fact source.");
    return { key, recordSha256, v: 1 as const };
  }).sort(compareCanonical);
  if (!orderedUnique(sources, (source) => source.key)) {
    throw new TypeError("Projection fact sources must have unique record keys.");
  }
  const payload = { relation, sources, tuple: parsedTuple, v: 1 as const };
  return { ...payload, factSha256: canonicalSha256(payload) };
}

export function parseOhProjectionFactV1(value: unknown): OhProjectionFactV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["factSha256", "relation", "sources", "tuple", "v"])
    || value.v !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.tuple)) return null;
  const factSha256 = parseSha256Hex(value.factSha256);
  try {
    const fact = createOhProjectionFactV1({ relation: value.relation as string,
      sources: value.sources as OhProjectionFactSourceV1[], tuple: value.tuple as OhProjectionAtomV1[] });
    return factSha256 !== null && fact.factSha256 === factSha256 ? fact : null;
  } catch {
    return null;
  }
}

function mergeProjectionFacts(facts: readonly OhProjectionFactV1[]): readonly OhProjectionFactV1[] {
  const grouped = new Map<string, { relation: string; sources: Map<string, OhProjectionFactSourceV1>;
    tuple: readonly OhProjectionAtomV1[] }>();
  for (const fact of facts) {
    const identity = canonicalJson([fact.relation, fact.tuple]);
    let group = grouped.get(identity);
    if (group === undefined) {
      group = { relation: fact.relation, sources: new Map(), tuple: fact.tuple };
      grouped.set(identity, group);
    }
    for (const source of fact.sources) {
      const existing = group.sources.get(source.key);
      if (existing !== undefined && existing.recordSha256 !== source.recordSha256) {
        throw new TypeError("One fact source key is bound to multiple record digests.");
      }
      group.sources.set(source.key, source);
    }
  }
  return [...grouped.values()].map((group) => createOhProjectionFactV1({ relation: group.relation,
    sources: [...group.sources.values()], tuple: group.tuple })).sort(compareProjectionFacts);
}

export function createOhProjectionDatasetV1(input: Readonly<{
  extractorSha256: Sha256Hex;
  factPackId: string;
  factPackRevision: number;
  facts: readonly OhProjectionFactV1[];
  snapshot: OhProjectionSnapshotV1;
}>): OhProjectionDatasetV1 {
  const snapshot = parseOhProjectionSnapshotV1(input.snapshot);
  const extractorSha256 = parseSha256Hex(input.extractorSha256);
  const factPackId = projectionName(input.factPackId);
  const factPackRevision = positiveInteger(input.factPackRevision);
  if (snapshot === null || extractorSha256 === null || factPackId === null || factPackRevision === null
    || input.facts.length > OH_PROJECTION_LIMITS_V1.facts) throw new TypeError("Invalid projection dataset.");
  const parsedFacts = input.facts.map(parseOhProjectionFactV1);
  if (parsedFacts.some((fact) => fact === null)) throw new TypeError("Invalid fact in projection dataset.");
  const facts = mergeProjectionFacts(parsedFacts as readonly OhProjectionFactV1[]);
  if (facts.length > OH_PROJECTION_LIMITS_V1.facts) throw new RangeError("Projection dataset has too many facts.");
  const refs = new Map(snapshot.recordRefs.map((reference) => [reference.key, reference.sha256]));
  for (const fact of facts) {
    for (const source of fact.sources) {
      if (refs.get(source.key) !== source.recordSha256) {
        throw new TypeError("Projection fact source is not present at the exact input snapshot.");
      }
    }
  }
  const factPackPayload = { extractorSha256, factPackId, factPackRevision,
    semantics: OH_PROJECTION_SEMANTICS_V1, v: 1 as const };
  const factPackSha256 = canonicalSha256(factPackPayload);
  const factsSha256 = canonicalSha256(facts);
  const payload = { extractorSha256, factPackId, factPackRevision, factPackSha256, facts,
    factsSha256, snapshotSha256: snapshot.snapshotSha256, v: 1 as const };
  return { ...payload, datasetSha256: canonicalSha256(payload) };
}

export function parseOhProjectionDatasetV1(value: unknown,
  snapshot: OhProjectionSnapshotV1): OhProjectionDatasetV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["datasetSha256", "extractorSha256", "factPackId",
    "factPackRevision", "factPackSha256", "facts", "factsSha256", "snapshotSha256", "v"])
    || value.v !== 1 || !Array.isArray(value.facts)) return null;
  const datasetSha256 = parseSha256Hex(value.datasetSha256);
  const declaredFactPackSha256 = parseSha256Hex(value.factPackSha256);
  const declaredFactsSha256 = parseSha256Hex(value.factsSha256);
  try {
    const dataset = createOhProjectionDatasetV1({ extractorSha256: value.extractorSha256 as Sha256Hex,
      factPackId: value.factPackId as string, factPackRevision: value.factPackRevision as number,
      facts: value.facts as OhProjectionFactV1[], snapshot });
    return datasetSha256 !== null && declaredFactPackSha256 === dataset.factPackSha256
        && declaredFactsSha256 === dataset.factsSha256 && value.snapshotSha256 === dataset.snapshotSha256
        && dataset.datasetSha256 === datasetSha256
      ? dataset : null;
  } catch {
    return null;
  }
}

export function ohProjectionVariableV1(name: string): OhProjectionTermV1 {
  const parsed = projectionName(name);
  if (parsed === null) throw new TypeError("Invalid projection variable name.");
  return { kind: "variable", name: parsed, v: 1 };
}

export function ohProjectionConstantV1(value: OhProjectionAtomV1): OhProjectionTermV1 {
  const parsed = atom(value);
  if (parsed === INVALID_PROJECTION_ATOM) throw new TypeError("Invalid projection constant.");
  return { kind: "constant", v: 1, value: parsed };
}

export function createOhProjectionLiteralV1(input: Readonly<{
  relation: string;
  terms: readonly OhProjectionTermV1[];
}>): OhProjectionLiteralV1 {
  const relation = projectionName(input.relation);
  if (relation === null || input.terms.length < 1 || input.terms.length > OH_PROJECTION_LIMITS_V1.arity) {
    throw new TypeError("Invalid projection literal.");
  }
  const terms = input.terms.map((term) => parseOhProjectionTermV1(term));
  if (terms.some((term) => term === null)) throw new TypeError("Invalid term in projection literal.");
  return { relation, terms: terms as readonly OhProjectionTermV1[], v: 1 };
}

export function parseOhProjectionTermV1(value: unknown): OhProjectionTermV1 | null {
  if (!isPlainRecord(value) || value.v !== 1) return null;
  if (value.kind === "variable" && hasExactKeys(value, ["kind", "name", "v"])) {
    const name = projectionName(value.name);
    return name === null ? null : { kind: "variable", name, v: 1 };
  }
  if (value.kind === "constant" && hasExactKeys(value, ["kind", "v", "value"])) {
    const parsed = atom(value.value);
    return parsed === INVALID_PROJECTION_ATOM ? null : { kind: "constant", v: 1, value: parsed };
  }
  return null;
}

export function parseOhProjectionLiteralV1(value: unknown): OhProjectionLiteralV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["relation", "terms", "v"])
    || value.v !== 1 || !Array.isArray(value.terms)) return null;
  try {
    return createOhProjectionLiteralV1({ relation: value.relation as string,
      terms: value.terms as OhProjectionTermV1[] });
  } catch {
    return null;
  }
}

function literalVariables(literal: OhProjectionLiteralV1): readonly string[] {
  return literal.terms.flatMap((term) => term.kind === "variable" ? [term.name] : []);
}

export function createOhProjectionRuleV1(input: Readonly<{
  body: readonly OhProjectionLiteralV1[];
  head: OhProjectionLiteralV1;
  ruleId: string;
}>): OhProjectionRuleV1 {
  const ruleId = projectionName(input.ruleId);
  const head = parseOhProjectionLiteralV1(input.head);
  if (ruleId === null || head === null || input.body.length < 1
    || input.body.length > OH_PROJECTION_LIMITS_V1.literalsPerRule) throw new TypeError("Invalid projection rule.");
  const body = input.body.map(parseOhProjectionLiteralV1);
  if (body.some((literal) => literal === null)) throw new TypeError("Invalid body literal in projection rule.");
  const bound = new Set((body as readonly OhProjectionLiteralV1[]).flatMap(literalVariables));
  if (literalVariables(head).some((variable) => !bound.has(variable))
    || bound.size > OH_PROJECTION_LIMITS_V1.variables) {
    throw new TypeError("Every projection rule head variable must be bound in its body.");
  }
  const payload = { body: body as readonly OhProjectionLiteralV1[], head, ruleId, v: 1 as const };
  return { ...payload, ruleSha256: canonicalSha256(payload) };
}

export function parseOhProjectionRuleV1(value: unknown): OhProjectionRuleV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["body", "head", "ruleId", "ruleSha256", "v"])
    || value.v !== 1 || !Array.isArray(value.body)) return null;
  const ruleSha256 = parseSha256Hex(value.ruleSha256);
  try {
    const rule = createOhProjectionRuleV1({ body: value.body as OhProjectionLiteralV1[],
      head: value.head as OhProjectionLiteralV1, ruleId: value.ruleId as string });
    return ruleSha256 !== null && rule.ruleSha256 === ruleSha256 ? rule : null;
  } catch {
    return null;
  }
}

export function createOhProjectionRulePackV1(input: Readonly<{
  rulePackId: string;
  rulePackRevision: number;
  rules: readonly OhProjectionRuleV1[];
}>): OhProjectionRulePackV1 {
  const rulePackId = projectionName(input.rulePackId);
  const rulePackRevision = positiveInteger(input.rulePackRevision);
  if (rulePackId === null || rulePackRevision === null || input.rules.length < 1
    || input.rules.length > OH_PROJECTION_LIMITS_V1.rules) throw new TypeError("Invalid projection rule pack.");
  const parsedRules = input.rules.map(parseOhProjectionRuleV1);
  if (parsedRules.some((rule) => rule === null)) throw new TypeError("Invalid rule in projection rule pack.");
  const rules = sortUnique(parsedRules as readonly OhProjectionRuleV1[], (rule) => rule.ruleId);
  const rulesSha256 = canonicalSha256(rules);
  const payload = { rulePackId, rulePackRevision, rules, rulesSha256,
    semantics: OH_PROJECTION_SEMANTICS_V1, v: 1 as const };
  return { ...payload, rulePackSha256: canonicalSha256(payload) };
}

export function parseOhProjectionRulePackV1(value: unknown): OhProjectionRulePackV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["rulePackId", "rulePackRevision",
    "rulePackSha256", "rules", "rulesSha256", "semantics", "v"]) || value.v !== 1
    || value.semantics !== OH_PROJECTION_SEMANTICS_V1 || !Array.isArray(value.rules)) return null;
  const rulePackSha256 = parseSha256Hex(value.rulePackSha256);
  const rulesSha256 = parseSha256Hex(value.rulesSha256);
  try {
    const pack = createOhProjectionRulePackV1({ rulePackId: value.rulePackId as string,
      rulePackRevision: value.rulePackRevision as number, rules: value.rules as OhProjectionRuleV1[] });
    return rulePackSha256 === pack.rulePackSha256 && rulesSha256 === pack.rulesSha256 ? pack : null;
  } catch {
    return null;
  }
}

export function createOhProjectionQueryV1(input: Readonly<{
  find: readonly string[];
  limit?: number;
  queryId: string;
  where: readonly OhProjectionLiteralV1[];
}>): OhProjectionQueryV1 {
  const queryId = projectionName(input.queryId);
  const limit = positiveInteger(input.limit ?? 1_000, OH_PROJECTION_LIMITS_V1.queryResults);
  if (queryId === null || limit === null || input.find.length < 1
    || input.find.length > OH_PROJECTION_LIMITS_V1.arity || input.where.length < 1
    || input.where.length > OH_PROJECTION_LIMITS_V1.queryLiterals) throw new TypeError("Invalid projection query.");
  const find = input.find.map((name) => projectionName(name));
  const where = input.where.map(parseOhProjectionLiteralV1);
  if (find.some((name) => name === null) || !orderedUnique([...find as string[]].sort(), String)
    || where.some((literal) => literal === null)) throw new TypeError("Invalid projection query variables or literals.");
  const bound = new Set((where as readonly OhProjectionLiteralV1[]).flatMap(literalVariables));
  if ((find as readonly string[]).some((name) => !bound.has(name)) || bound.size > OH_PROJECTION_LIMITS_V1.variables) {
    throw new TypeError("Every projected query variable must be bound in the query body.");
  }
  const payload = { find: find as readonly string[], limit, queryId,
    where: where as readonly OhProjectionLiteralV1[], v: 1 as const };
  return { ...payload, querySha256: canonicalSha256(payload) };
}

export function parseOhProjectionQueryV1(value: unknown): OhProjectionQueryV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["find", "limit", "queryId", "querySha256", "where", "v"])
    || value.v !== 1 || !Array.isArray(value.find) || !Array.isArray(value.where)) return null;
  const querySha256 = parseSha256Hex(value.querySha256);
  try {
    const query = createOhProjectionQueryV1({ find: value.find as string[], limit: value.limit as number,
      queryId: value.queryId as string, where: value.where as OhProjectionLiteralV1[] });
    return querySha256 !== null && query.querySha256 === querySha256 ? query : null;
  } catch {
    return null;
  }
}

export function createOhProjectionIdentityV1(input: Readonly<{
  dataset: OhProjectionDatasetV1;
  engine?: string;
  options?: OhProjectionEvaluationOptionsV1;
  query: OhProjectionQueryV1;
  rulePack: OhProjectionRulePackV1;
  snapshot: OhProjectionSnapshotV1;
}>): OhProjectionIdentityV1 {
  const snapshot = parseOhProjectionSnapshotV1(input.snapshot);
  const dataset = snapshot === null ? null : parseOhProjectionDatasetV1(input.dataset, snapshot);
  const query = parseOhProjectionQueryV1(input.query);
  const rulePack = parseOhProjectionRulePackV1(input.rulePack);
  if (snapshot === null || dataset === null || query === null || rulePack === null) {
    throw new TypeError("Invalid projection identity input.");
  }
  const engine = safeCode(input.engine ?? OH_PROJECTION_INTERNAL_ENGINE_V1, 256);
  if (engine === null) throw new TypeError("Invalid projection engine identity.");
  const evaluation = { ...resolveEvaluationOptions(input.options ?? {}), v: 1 as const };
  const payload = {
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    datasetSha256: dataset.datasetSha256,
    engineSha256: canonicalSha256({ engine, v: 1 }),
    evaluationSha256: canonicalSha256(evaluation),
    querySha256: query.querySha256,
    rulePackSha256: rulePack.rulePackSha256,
    semantics: OH_PROJECTION_SEMANTICS_V1,
    snapshotSha256: snapshot.snapshotSha256,
    v: 1 as const,
  };
  return { ...payload, projectionSha256: canonicalSha256(payload) };
}

export function parseOhProjectionIdentityV1(value: unknown): OhProjectionIdentityV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["contractSha256", "datasetSha256",
    "engineSha256", "evaluationSha256", "projectionSha256", "querySha256", "rulePackSha256",
    "semantics", "snapshotSha256", "v"])
    || value.v !== 1 || value.semantics !== OH_PROJECTION_SEMANTICS_V1) return null;
  const contractSha256 = parseSha256Hex(value.contractSha256);
  const datasetSha256 = parseSha256Hex(value.datasetSha256);
  const engineSha256 = parseSha256Hex(value.engineSha256);
  const evaluationSha256 = parseSha256Hex(value.evaluationSha256);
  const projectionSha256 = parseSha256Hex(value.projectionSha256);
  const querySha256 = parseSha256Hex(value.querySha256);
  const rulePackSha256 = parseSha256Hex(value.rulePackSha256);
  const snapshotSha256 = parseSha256Hex(value.snapshotSha256);
  if (contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256 || datasetSha256 === null
    || engineSha256 === null || evaluationSha256 === null || projectionSha256 === null
    || querySha256 === null || rulePackSha256 === null
    || snapshotSha256 === null) return null;
  const payload = { contractSha256, datasetSha256, engineSha256, evaluationSha256,
    querySha256, rulePackSha256,
    semantics: OH_PROJECTION_SEMANTICS_V1, snapshotSha256, v: 1 as const };
  return canonicalSha256(payload) === projectionSha256 ? { ...payload, projectionSha256 } : null;
}

export function invalidationForOhProjectionV1(previous: OhProjectionIdentityV1,
  next: OhProjectionIdentityV1): OhProjectionInvalidationV1 {
  const parsedPrevious = parseOhProjectionIdentityV1(previous);
  const parsedNext = parseOhProjectionIdentityV1(next);
  if (parsedPrevious === null || parsedNext === null) throw new TypeError("Invalid projection identity.");
  if (parsedPrevious.projectionSha256 === parsedNext.projectionSha256) return { kind: "reusable", v: 1 };
  const reasons: OhProjectionInvalidationReasonV1[] = [];
  if (parsedPrevious.snapshotSha256 !== parsedNext.snapshotSha256) reasons.push("snapshot-changed");
  if (parsedPrevious.datasetSha256 !== parsedNext.datasetSha256) reasons.push("dataset-changed");
  if (parsedPrevious.engineSha256 !== parsedNext.engineSha256) reasons.push("engine-changed");
  if (parsedPrevious.evaluationSha256 !== parsedNext.evaluationSha256) reasons.push("evaluation-changed");
  if (parsedPrevious.rulePackSha256 !== parsedNext.rulePackSha256) reasons.push("rule-pack-changed");
  if (parsedPrevious.querySha256 !== parsedNext.querySha256) reasons.push("query-changed");
  return { kind: "full-rebuild", reasons, v: 1 };
}

type TupleReference = Readonly<{ relation: string; tuple: readonly OhProjectionAtomV1[] }>;
type FactWitness = Readonly<{ kind: "fact"; sources: readonly OhProjectionFactSourceV1[] }>;
type DerivedWitness = Readonly<{
  kind: "derived";
  premises: readonly TupleReference[];
  rule: OhProjectionRuleV1;
}>;
type TupleState = Readonly<{
  tuple: readonly OhProjectionAtomV1[];
  witness: FactWitness | DerivedWitness;
}>;
type RelationState = Map<string, TupleState>;
type MaterializedProjection = Readonly<{
  baseFacts: number;
  derivedFacts: number;
  relations: Map<string, RelationState>;
  rounds: number;
}>;

function tupleKey(value: readonly OhProjectionAtomV1[]): string {
  return canonicalJson(value);
}

function referenceKey(reference: TupleReference): string {
  return canonicalJson([reference.relation, reference.tuple]);
}

function relationTuples(relations: Map<string, RelationState>, relation: string): readonly TupleState[] {
  return [...(relations.get(relation)?.values() ?? [])]
    .sort((left, right) => compareCanonical(left.tuple, right.tuple));
}

function setArity(arities: Map<string, number>, relation: string, arity: number): void {
  const existing = arities.get(relation);
  if (existing !== undefined && existing !== arity) {
    throw new TypeError(`Projection relation ${relation} is used with conflicting arities.`);
  }
  arities.set(relation, arity);
  if (arities.size > OH_PROJECTION_LIMITS_V1.relations) throw new RangeError("Projection uses too many relations.");
}

function validateProgramArities(dataset: OhProjectionDatasetV1, rulePack: OhProjectionRulePackV1,
  query: OhProjectionQueryV1): void {
  const arities = new Map<string, number>();
  for (const fact of dataset.facts) setArity(arities, fact.relation, fact.tuple.length);
  for (const rule of rulePack.rules) {
    setArity(arities, rule.head.relation, rule.head.terms.length);
    for (const literal of rule.body) setArity(arities, literal.relation, literal.terms.length);
  }
  for (const literal of query.where) setArity(arities, literal.relation, literal.terms.length);
}

type Binding = Map<string, OhProjectionAtomV1>;

function sameAtom(left: OhProjectionAtomV1, right: OhProjectionAtomV1): boolean {
  return left === right;
}

function unifyLiteral(literal: OhProjectionLiteralV1, state: TupleState, binding: Binding): Binding | null {
  const next = new Map(binding);
  for (let index = 0; index < literal.terms.length; index += 1) {
    const term = literal.terms[index] as OhProjectionTermV1;
    const value = state.tuple[index] as OhProjectionAtomV1;
    if (term.kind === "constant") {
      if (!sameAtom(term.value, value)) return null;
      continue;
    }
    if (next.has(term.name)) {
      if (!sameAtom(next.get(term.name) as OhProjectionAtomV1, value)) return null;
    } else next.set(term.name, value);
  }
  return next;
}

type BodyMatch = Readonly<{ binding: Binding; premises: readonly TupleReference[] }>;

type ProjectionWorkBudget = { maximum: number; units: number };

function consumeWorkUnit(budget: ProjectionWorkBudget): void {
  if (budget.units >= budget.maximum) throw new RangeError("Projection exceeds its work-unit bound.");
  budget.units += 1;
}

function matchBody(relations: Map<string, RelationState>, body: readonly OhProjectionLiteralV1[],
  maximumMatches: number, work: ProjectionWorkBudget): readonly BodyMatch[] {
  let matches: readonly BodyMatch[] = [{ binding: new Map(), premises: [] }];
  for (const literal of body) {
    const next: BodyMatch[] = [];
    const candidates = relationTuples(relations, literal.relation);
    for (const match of matches) {
      for (const candidate of candidates) {
        consumeWorkUnit(work);
        const binding = unifyLiteral(literal, candidate, match.binding);
        if (binding === null) continue;
        next.push({ binding, premises: [...match.premises, { relation: literal.relation,
          tuple: candidate.tuple }] });
        if (next.length > maximumMatches) throw new RangeError("Projection join exceeds its match bound.");
      }
    }
    matches = next;
    if (matches.length === 0) break;
  }
  return matches;
}

function instantiateHead(head: OhProjectionLiteralV1, binding: Binding): readonly OhProjectionAtomV1[] {
  return head.terms.map((term) => term.kind === "constant"
    ? term.value : binding.get(term.name) as OhProjectionAtomV1);
}

function canonicalWitness(witness: FactWitness | DerivedWitness): string {
  if (witness.kind === "fact") return canonicalJson(witness);
  return canonicalJson({ kind: witness.kind, premises: witness.premises, ruleSha256: witness.rule.ruleSha256 });
}

function materializeNaive(input: Readonly<{
  dataset: OhProjectionDatasetV1;
  maximumDerivedTuples: number;
  maximumRounds: number;
  rulePack: OhProjectionRulePackV1;
  work: ProjectionWorkBudget;
}>): MaterializedProjection {
  const relations = new Map<string, RelationState>();
  for (const fact of input.dataset.facts) {
    let relation = relations.get(fact.relation);
    if (relation === undefined) {
      relation = new Map();
      relations.set(fact.relation, relation);
    }
    relation.set(tupleKey(fact.tuple), { tuple: fact.tuple, witness: { kind: "fact", sources: fact.sources } });
  }
  let derivedFacts = 0;
  let rounds = 0;
  while (true) {
    const candidates = new Map<string, Readonly<{ relation: string; state: TupleState }>>();
    for (const rule of input.rulePack.rules) {
      for (const match of matchBody(relations, rule.body, OH_PROJECTION_LIMITS_V1.queryMatches, input.work)) {
        const derivedTuple = instantiateHead(rule.head, match.binding);
        const relation = relations.get(rule.head.relation);
        const key = tupleKey(derivedTuple);
        if (relation?.has(key) === true) continue;
        const state: TupleState = { tuple: derivedTuple,
          witness: { kind: "derived", premises: match.premises, rule } };
        const identity = referenceKey({ relation: rule.head.relation, tuple: derivedTuple });
        const existing = candidates.get(identity);
        if (existing === undefined || canonicalWitness(state.witness) < canonicalWitness(existing.state.witness)) {
          candidates.set(identity, { relation: rule.head.relation, state });
        }
      }
    }
    if (candidates.size === 0) break;
    if (rounds >= input.maximumRounds) throw new RangeError("Projection exceeds its evaluation round bound.");
    if (derivedFacts + candidates.size > input.maximumDerivedTuples) {
      throw new RangeError("Projection exceeds its derived tuple bound.");
    }
    const ordered = [...candidates.values()].sort((left, right) => compareCanonical(
      [left.relation, left.state.tuple], [right.relation, right.state.tuple]));
    for (const candidate of ordered) {
      let relation = relations.get(candidate.relation);
      if (relation === undefined) {
        relation = new Map();
        relations.set(candidate.relation, relation);
      }
      relation.set(tupleKey(candidate.state.tuple), candidate.state);
    }
    derivedFacts += candidates.size;
    rounds += 1;
  }
  return { baseFacts: input.dataset.facts.length, derivedFacts, relations, rounds };
}

function boundedOption(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const parsed = positiveInteger(value ?? fallback, maximum);
  if (parsed === null) throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
  return parsed;
}

type ResolvedEvaluationOptions = Readonly<{
  maximumDerivedTuples: number;
  maximumProofDepth: number;
  maximumProofNodes: number;
  maximumResultBytes: number;
  maximumRounds: number;
  maximumTotalProofNodes: number;
  maximumWorkUnits: number;
}>;

function resolveEvaluationOptions(options: OhProjectionEvaluationOptionsV1): ResolvedEvaluationOptions {
  const resolved = {
    maximumDerivedTuples: boundedOption(options.maximumDerivedTuples, OH_PROJECTION_LIMITS_V1.derivedTuples,
      OH_PROJECTION_LIMITS_V1.derivedTuples, "maximumDerivedTuples"),
    maximumProofDepth: boundedOption(options.maximumProofDepth, 32,
      OH_PROJECTION_LIMITS_V1.proofDepth, "maximumProofDepth"),
    maximumProofNodes: boundedOption(options.maximumProofNodes, 1_024,
      OH_PROJECTION_LIMITS_V1.proofNodes, "maximumProofNodes"),
    maximumResultBytes: boundedOption(options.maximumResultBytes, OH_PROJECTION_LIMITS_V1.resultBytes,
      OH_PROJECTION_LIMITS_V1.resultBytes, "maximumResultBytes"),
    maximumRounds: boundedOption(options.maximumRounds, OH_PROJECTION_LIMITS_V1.rounds,
      OH_PROJECTION_LIMITS_V1.rounds, "maximumRounds"),
    maximumTotalProofNodes: boundedOption(options.maximumTotalProofNodes,
      OH_PROJECTION_LIMITS_V1.totalProofNodes, OH_PROJECTION_LIMITS_V1.totalProofNodes,
      "maximumTotalProofNodes"),
    maximumWorkUnits: boundedOption(options.maximumWorkUnits, OH_PROJECTION_LIMITS_V1.workUnits,
      OH_PROJECTION_LIMITS_V1.workUnits, "maximumWorkUnits"),
  };
  if (resolved.maximumResultBytes < 64 * 1024) {
    throw new RangeError("maximumResultBytes must be at least 65536.");
  }
  return resolved;
}

type ProjectionResultBudget = { bytes: number; maximumBytes: number; nodes: number };
type ProjectionRowProofBudget = { nodes: number; result: ProjectionResultBudget };

function reserveResultBytes(budget: ProjectionResultBudget, value: unknown): boolean {
  const bytes = utf8ByteLength(canonicalJson(value));
  if (budget.bytes + bytes > budget.maximumBytes) return false;
  budget.bytes += bytes;
  return true;
}

function reserveProofNode(budget: ProjectionRowProofBudget, options: ResolvedEvaluationOptions,
  envelope: OhProjectionProofV1): boolean {
  if (budget.nodes >= options.maximumProofNodes
    || budget.result.nodes >= options.maximumTotalProofNodes
    || !reserveResultBytes(budget.result, envelope)) return false;
  budget.nodes += 1;
  budget.result.nodes += 1;
  return true;
}

function proofForReference(relations: Map<string, RelationState>, reference: TupleReference,
  budget: ProjectionRowProofBudget, options: ResolvedEvaluationOptions, depth: number,
  visiting: Set<string>): OhProjectionProofV1 | null {
  if (depth >= options.maximumProofDepth) {
    const proof = { kind: "truncated" as const, reason: "depth" as const,
      relation: reference.relation, tuple: reference.tuple, v: 1 as const };
    return reserveProofNode(budget, options, proof) ? proof : null;
  }
  const identity = referenceKey(reference);
  if (visiting.has(identity)) {
    const proof = { kind: "truncated" as const, reason: "cycle" as const,
      relation: reference.relation, tuple: reference.tuple, v: 1 as const };
    return reserveProofNode(budget, options, proof) ? proof : null;
  }
  const state = relations.get(reference.relation)?.get(tupleKey(reference.tuple));
  if (state === undefined) throw new Error("Projection proof references a tuple outside the materialized result.");
  if (state.witness.kind === "fact") {
    const proof = { kind: "fact" as const, relation: reference.relation, sources: state.witness.sources,
      tuple: reference.tuple, v: 1 as const };
    return reserveProofNode(budget, options, proof) ? proof : null;
  }
  const envelope = { kind: "derived" as const, premises: [], premisesTruncated: false,
    relation: reference.relation, ruleId: state.witness.rule.ruleId,
    ruleSha256: state.witness.rule.ruleSha256, tuple: reference.tuple, v: 1 as const };
  if (!reserveProofNode(budget, options, envelope)) return null;
  visiting.add(identity);
  try {
    const premises: OhProjectionProofV1[] = [];
    let premisesTruncated = false;
    for (const premise of state.witness.premises) {
      const proof = proofForReference(relations, premise, budget, options, depth + 1, visiting);
      if (proof === null) { premisesTruncated = true; break; }
      premises.push(proof);
    }
    return { kind: "derived", premises, premisesTruncated,
    relation: reference.relation, ruleId: state.witness.rule.ruleId,
    ruleSha256: state.witness.rule.ruleSha256, tuple: reference.tuple, v: 1 };
  } finally {
    visiting.delete(identity);
  }
}

function proofIsTruncated(proof: OhProjectionProofV1): boolean {
  return proof.kind === "truncated" || (proof.kind === "derived"
    && (proof.premisesTruncated || proof.premises.some(proofIsTruncated)));
}

type ProjectionParseBudget = {
  bytes: number;
  maximumBytes: number;
  maximumDepth: number;
  maximumNodes: number;
  nodes: number;
};

function reserveProjectionParseBytes(budget: ProjectionParseBudget, value: unknown): boolean {
  const bytes = utf8ByteLength(canonicalJson(value));
  if (budget.bytes + bytes > budget.maximumBytes) return false;
  budget.bytes += bytes;
  return true;
}

function parseProjectionFactSource(value: unknown): OhProjectionFactSourceV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["key", "recordSha256", "v"]) || value.v !== 1) {
    return null;
  }
  const key = safeCode(value.key, 512);
  const recordSha256 = parseSha256Hex(value.recordSha256);
  return key === null || recordSha256 === null ? null : { key, recordSha256, v: 1 };
}

function parseProjectionProofWithBudget(value: unknown, budget: ProjectionParseBudget,
  depth: number): OhProjectionProofV1 | null {
  if (depth > budget.maximumDepth || budget.nodes >= budget.maximumNodes
    || !isPlainRecord(value) || value.v !== 1) return null;
  const relation = projectionName(value.relation);
  const parsedTuple = tuple(value.tuple);
  if (relation === null || parsedTuple === null) return null;

  if (value.kind === "fact") {
    if (!hasExactKeys(value, ["kind", "relation", "sources", "tuple", "v"])
      || !Array.isArray(value.sources) || value.sources.length < 1
      || value.sources.length > OH_PROJECTION_LIMITS_V1.sourcesPerFact) return null;
    const sources = value.sources.map(parseProjectionFactSource);
    if (sources.some((source) => source === null)) return null;
    const parsedSources = sources as readonly OhProjectionFactSourceV1[];
    if (!orderedUnique(parsedSources, (source) => source.key)) return null;
    const proof = { kind: "fact" as const, relation, sources: parsedSources,
      tuple: parsedTuple, v: 1 as const };
    if (!reserveProjectionParseBytes(budget, proof)) return null;
    budget.nodes += 1;
    return proof;
  }

  if (value.kind === "truncated") {
    if (!hasExactKeys(value, ["kind", "reason", "relation", "tuple", "v"])
      || (value.reason !== "cycle" && value.reason !== "depth" && value.reason !== "nodes")) return null;
    const reason = value.reason as "cycle" | "depth" | "nodes";
    const proof = { kind: "truncated" as const, reason,
      relation, tuple: parsedTuple, v: 1 as const };
    if (!reserveProjectionParseBytes(budget, proof)) return null;
    budget.nodes += 1;
    return proof;
  }

  if (value.kind !== "derived" || !hasExactKeys(value, ["kind", "premises", "premisesTruncated",
    "relation", "ruleId", "ruleSha256", "tuple", "v"]) || !Array.isArray(value.premises)
    || value.premises.length > OH_PROJECTION_LIMITS_V1.literalsPerRule
    || typeof value.premisesTruncated !== "boolean") return null;
  const ruleId = projectionName(value.ruleId);
  const ruleSha256 = parseSha256Hex(value.ruleSha256);
  if (ruleId === null || ruleSha256 === null
    || (!value.premisesTruncated && value.premises.length === 0)
    || (value.premisesTruncated && value.premises.length === OH_PROJECTION_LIMITS_V1.literalsPerRule)) {
    return null;
  }
  const skeleton = { kind: "derived" as const, premises: [],
    premisesTruncated: value.premisesTruncated, relation, ruleId, ruleSha256,
    tuple: parsedTuple, v: 1 as const };
  if (!reserveProjectionParseBytes(budget, skeleton)) return null;
  budget.nodes += 1;
  const premises: OhProjectionProofV1[] = [];
  for (const premise of value.premises) {
    const parsed = parseProjectionProofWithBudget(premise, budget, depth + 1);
    if (parsed === null) return null;
    premises.push(parsed);
  }
  return { ...skeleton, premises };
}

/**
 * Parses one untrusted proof tree under the public hard depth, node, and byte
 * ceilings. Cached result envelopes should normally be parsed as a whole with
 * `parseOhProjectionResultV1`, which also applies their smaller declared limits.
 */
export function parseOhProjectionProofV1(value: unknown): OhProjectionProofV1 | null {
  try {
    const budget: ProjectionParseBudget = { bytes: 0,
      maximumBytes: OH_PROJECTION_LIMITS_V1.resultBytes,
      maximumDepth: OH_PROJECTION_LIMITS_V1.proofDepth,
      maximumNodes: OH_PROJECTION_LIMITS_V1.proofNodes, nodes: 0 };
    const proof = parseProjectionProofWithBudget(value, budget, 0);
    return proof !== null && utf8ByteLength(canonicalJson(proof)) <= budget.maximumBytes ? proof : null;
  } catch {
    return null;
  }
}

type OhProjectionResolvedEvaluationV1 = ResolvedEvaluationOptions & Readonly<{ v: 1 }>;

function parseProjectionEvaluation(value: unknown): OhProjectionResolvedEvaluationV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["maximumDerivedTuples", "maximumProofDepth",
    "maximumProofNodes", "maximumResultBytes", "maximumRounds", "maximumTotalProofNodes",
    "maximumWorkUnits", "v"]) || value.v !== 1) return null;
  const maximumDerivedTuples = positiveInteger(value.maximumDerivedTuples,
    OH_PROJECTION_LIMITS_V1.derivedTuples);
  const maximumProofDepth = positiveInteger(value.maximumProofDepth, OH_PROJECTION_LIMITS_V1.proofDepth);
  const maximumProofNodes = positiveInteger(value.maximumProofNodes, OH_PROJECTION_LIMITS_V1.proofNodes);
  const maximumResultBytes = positiveInteger(value.maximumResultBytes, OH_PROJECTION_LIMITS_V1.resultBytes);
  const maximumRounds = positiveInteger(value.maximumRounds, OH_PROJECTION_LIMITS_V1.rounds);
  const maximumTotalProofNodes = positiveInteger(value.maximumTotalProofNodes,
    OH_PROJECTION_LIMITS_V1.totalProofNodes);
  const maximumWorkUnits = positiveInteger(value.maximumWorkUnits, OH_PROJECTION_LIMITS_V1.workUnits);
  if (maximumDerivedTuples === null || maximumProofDepth === null || maximumProofNodes === null
    || maximumResultBytes === null || maximumResultBytes < 64 * 1024 || maximumRounds === null
    || maximumTotalProofNodes === null || maximumWorkUnits === null) return null;
  return { maximumDerivedTuples, maximumProofDepth, maximumProofNodes, maximumResultBytes,
    maximumRounds, maximumTotalProofNodes, maximumWorkUnits, v: 1 };
}

function parseProjectionResultRow(value: unknown, evaluation: OhProjectionResolvedEvaluationV1,
  resultBudget: ProjectionParseBudget): Readonly<{ nodes: number; row: OhProjectionResultRowV1 }> | null {
  if (!isPlainRecord(value) || !hasExactKeys(value,
    ["proofs", "proofsTruncated", "supportCount", "values", "v"]) || value.v !== 1
    || !Array.isArray(value.proofs) || value.proofs.length > OH_PROJECTION_LIMITS_V1.queryLiterals
    || typeof value.proofsTruncated !== "boolean") return null;
  const values = tuple(value.values);
  const supportCount = positiveInteger(value.supportCount, OH_PROJECTION_LIMITS_V1.queryMatches);
  if (values === null || supportCount === null || (!value.proofsTruncated && value.proofs.length === 0)) return null;
  if (!reserveProjectionParseBytes(resultBudget, { proofs: [], proofsTruncated: value.proofsTruncated,
    supportCount, values, v: 1 })) return null;
  const before = resultBudget.nodes;
  resultBudget.maximumNodes = Math.min(resultBudget.maximumNodes, before + evaluation.maximumProofNodes);
  const proofs: OhProjectionProofV1[] = [];
  for (const proof of value.proofs) {
    const parsed = parseProjectionProofWithBudget(proof, resultBudget, 0);
    if (parsed === null) return null;
    proofs.push(parsed);
  }
  resultBudget.maximumNodes = evaluation.maximumTotalProofNodes;
  const containsTruncation = proofs.some(proofIsTruncated);
  if ((!value.proofsTruncated && containsTruncation)
    || (value.proofsTruncated && proofs.length === OH_PROJECTION_LIMITS_V1.queryLiterals
      && !containsTruncation)) return null;
  return { nodes: resultBudget.nodes - before,
    row: { proofs, proofsTruncated: value.proofsTruncated, supportCount, values, v: 1 } };
}

/**
 * Parses a cached projection result as untrusted data. It verifies exact keys,
 * all aggregate and declared bounds, proof truncation markers, canonical row
 * order, engine/evaluation identity links, and `resultSha256`. Pass the
 * projection digest requested from a cache to reject identity substitution.
 */
export function parseOhProjectionResultV1(value: unknown,
  expectedProjectionSha256?: Sha256Hex): OhProjectionResultV1 | null {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, ["authority", "cache", "engine", "evaluation",
      "identity", "resultSha256", "rows", "stats", "v"]) || value.v !== 1
      || value.authority !== "derived" || !isPlainRecord(value.cache)
      || !hasExactKeys(value.cache, ["strategy", "v"]) || value.cache.strategy !== "full-rebuild"
      || value.cache.v !== 1 || !Array.isArray(value.rows)
      || value.rows.length > OH_PROJECTION_LIMITS_V1.queryResults || !isPlainRecord(value.stats)
      || !hasExactKeys(value.stats, ["baseFacts", "derivedFacts", "proofNodes", "proofsTruncated",
        "queryMatches", "relations", "rounds", "truncated", "truncationReasons", "v", "workUnits"])
      || value.stats.v !== 1 || !Array.isArray(value.stats.truncationReasons)
      || typeof value.stats.proofsTruncated !== "boolean" || typeof value.stats.truncated !== "boolean") return null;
    const engine = safeCode(value.engine, 256);
    const evaluation = parseProjectionEvaluation(value.evaluation);
    const identity = parseOhProjectionIdentityV1(value.identity);
    const resultSha256 = parseSha256Hex(value.resultSha256);
    const expected = expectedProjectionSha256 === undefined ? undefined
      : parseSha256Hex(expectedProjectionSha256);
    if (engine === null || evaluation === null || identity === null || resultSha256 === null
      || (expectedProjectionSha256 !== undefined && expected === null)
      || (expected !== undefined && identity.projectionSha256 !== expected)
      || identity.engineSha256 !== canonicalSha256({ engine, v: 1 })
      || identity.evaluationSha256 !== canonicalSha256(evaluation)) return null;

    const baseFacts = nonnegativeInteger(value.stats.baseFacts);
    const derivedFacts = nonnegativeInteger(value.stats.derivedFacts);
    const proofNodes = nonnegativeInteger(value.stats.proofNodes);
    const queryMatches = nonnegativeInteger(value.stats.queryMatches);
    const relations = nonnegativeInteger(value.stats.relations);
    const rounds = nonnegativeInteger(value.stats.rounds);
    const workUnits = nonnegativeInteger(value.stats.workUnits);
    if (baseFacts === null || baseFacts > OH_PROJECTION_LIMITS_V1.facts
      || derivedFacts === null || derivedFacts > evaluation.maximumDerivedTuples
      || proofNodes === null || proofNodes > evaluation.maximumTotalProofNodes
      || queryMatches === null || queryMatches > OH_PROJECTION_LIMITS_V1.queryMatches
      || relations === null || relations > OH_PROJECTION_LIMITS_V1.relations
      || rounds === null || rounds > evaluation.maximumRounds
      || workUnits === null || workUnits > evaluation.maximumWorkUnits
      || relations > baseFacts + derivedFacts || rounds > derivedFacts
      || ((rounds === 0) !== (derivedFacts === 0)) || queryMatches > workUnits) return null;
    const truncationReasons = value.stats.truncationReasons;
    if (truncationReasons.length > 2
      || !orderedUnique(truncationReasons, (reason) => reason === "query-limit" ? "0" : reason === "result-bytes" ? "1" : "x")
      || truncationReasons.some((reason) => reason !== "query-limit" && reason !== "result-bytes")
      || value.stats.truncated !== (truncationReasons.length > 0)) return null;

    const budget: ProjectionParseBudget = { bytes: 0, maximumBytes: evaluation.maximumResultBytes,
      maximumDepth: evaluation.maximumProofDepth, maximumNodes: evaluation.maximumTotalProofNodes, nodes: 0 };
    const rows: OhProjectionResultRowV1[] = [];
    let supportCount = 0;
    for (const row of value.rows) {
      const parsed = parseProjectionResultRow(row, evaluation, budget);
      if (parsed === null) return null;
      rows.push(parsed.row);
      supportCount += parsed.row.supportCount;
      if (supportCount > queryMatches) return null;
    }
    if (!orderedUnique(rows, (row) => canonicalJson(row.values)) || budget.nodes !== proofNodes
      || value.stats.proofsTruncated !== rows.some((row) => row.proofsTruncated)
      || (value.stats.truncated ? supportCount >= queryMatches : supportCount !== queryMatches)) return null;

    const reasons = truncationReasons as readonly ("query-limit" | "result-bytes")[];
    const payload = {
      authority: "derived" as const,
      cache: { strategy: "full-rebuild" as const, v: 1 as const },
      engine,
      evaluation,
      identity,
      rows,
      stats: { baseFacts, derivedFacts, proofNodes, proofsTruncated: value.stats.proofsTruncated,
        queryMatches, relations, rounds, truncated: value.stats.truncated,
        truncationReasons: reasons, v: 1 as const, workUnits },
      v: 1 as const,
    };
    const serialized = canonicalJson(payload);
    return utf8ByteLength(serialized) <= evaluation.maximumResultBytes
        && sha256Hex(serialized) === resultSha256
      ? { ...payload, resultSha256 } : null;
  } catch {
    return null;
  }
}

function buildProjectionResult(input: Readonly<{
  dataset: OhProjectionDatasetV1;
  engine: string;
  materialized: MaterializedProjection;
  options: ResolvedEvaluationOptions;
  query: OhProjectionQueryV1;
  rulePack: OhProjectionRulePackV1;
  snapshot: OhProjectionSnapshotV1;
  work: ProjectionWorkBudget;
}>): OhProjectionResultV1 {
  const matches = matchBody(input.materialized.relations, input.query.where,
    OH_PROJECTION_LIMITS_V1.queryMatches, input.work);
  const byValues = new Map<string, { match: BodyMatch; supportCount: number }>();
  for (const match of matches) {
    const values = input.query.find.map((name) => match.binding.get(name) as OhProjectionAtomV1);
    const key = tupleKey(values);
    const existing = byValues.get(key);
    if (existing === undefined) byValues.set(key, { match, supportCount: 1 });
    else byValues.set(key, { match: compareCanonical(match.premises, existing.match.premises) < 0
      ? match : existing.match, supportCount: existing.supportCount + 1 });
  }
  const ordered = [...byValues.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const resultBudget: ProjectionResultBudget = { bytes: 0,
    maximumBytes: input.options.maximumResultBytes - 64 * 1024, nodes: 0 };
  const rows: OhProjectionResultRowV1[] = [];
  let resultBytesTruncated = false;
  for (const [key, support] of ordered.slice(0, input.query.limit)) {
    const values = JSON.parse(key) as OhProjectionAtomV1[];
    if (!reserveResultBytes(resultBudget, { proofs: [], proofsTruncated: false,
      supportCount: support.supportCount, values, v: 1 })) {
      resultBytesTruncated = true;
      break;
    }
    const budget: ProjectionRowProofBudget = { nodes: 0, result: resultBudget };
    const proofs: OhProjectionProofV1[] = [];
    for (const premise of support.match.premises) {
      const proof = proofForReference(input.materialized.relations, premise, budget, input.options, 0, new Set());
      if (proof === null) break;
      proofs.push(proof);
    }
    const proofsTruncated = proofs.length !== support.match.premises.length || proofs.some(proofIsTruncated);
    rows.push({ proofs, proofsTruncated, supportCount: support.supportCount, values, v: 1 });
  }
  const queryLimitTruncated = ordered.length > input.query.limit;
  const truncationReasons = [
    ...(queryLimitTruncated ? ["query-limit" as const] : []),
    ...(resultBytesTruncated ? ["result-bytes" as const] : []),
  ];
  const truncated = truncationReasons.length > 0;
  const identity = createOhProjectionIdentityV1({ dataset: input.dataset, query: input.query,
    engine: input.engine, options: input.options, rulePack: input.rulePack, snapshot: input.snapshot });
  const payload = {
    authority: "derived" as const,
    cache: { strategy: "full-rebuild" as const, v: 1 as const },
    engine: input.engine,
    evaluation: { ...input.options, v: 1 as const },
    identity,
    rows,
    stats: { baseFacts: input.materialized.baseFacts, derivedFacts: input.materialized.derivedFacts,
      proofNodes: resultBudget.nodes, proofsTruncated: rows.some((row) => row.proofsTruncated),
      queryMatches: matches.length,
      relations: input.materialized.relations.size, rounds: input.materialized.rounds,
      truncated, truncationReasons, v: 1 as const, workUnits: input.work.units },
    v: 1 as const,
  };
  const serialized = canonicalJson(payload);
  if (utf8ByteLength(serialized) > input.options.maximumResultBytes) {
    throw new RangeError("Projection result exceeds its canonical byte bound.");
  }
  return { ...payload, resultSha256: sha256Hex(serialized) };
}

export function evaluateOhProjectionV1(input: Readonly<{
  dataset: OhProjectionDatasetV1;
  options?: OhProjectionEvaluationOptionsV1;
  query: OhProjectionQueryV1;
  rulePack: OhProjectionRulePackV1;
  snapshot: OhProjectionSnapshotV1;
}>): OhProjectionResultV1 {
  const snapshot = parseOhProjectionSnapshotV1(input.snapshot);
  const dataset = snapshot === null ? null : parseOhProjectionDatasetV1(input.dataset, snapshot);
  const rulePack = parseOhProjectionRulePackV1(input.rulePack);
  const query = parseOhProjectionQueryV1(input.query);
  if (snapshot === null || dataset === null || rulePack === null || query === null) {
    throw new TypeError("Invalid projection snapshot, dataset, rule pack, or query.");
  }
  const options = resolveEvaluationOptions(input.options ?? {});
  validateProgramArities(dataset, rulePack, query);
  const work = { maximum: options.maximumWorkUnits, units: 0 };
  const materialized = materializeNaive({ dataset,
    maximumDerivedTuples: options.maximumDerivedTuples, maximumRounds: options.maximumRounds, rulePack, work });
  return buildProjectionResult({ dataset, engine: OH_PROJECTION_INTERNAL_ENGINE_V1,
    materialized, options, query, rulePack, snapshot, work });
}

/**
 * Internal adapter seam. It is exported for package-owned optional engines,
 * not as authority: callers receive the same derived-only result envelope.
 */
export function evaluateOhProjectionWithMaterializerV1(input: Readonly<{
  dataset: OhProjectionDatasetV1;
  engine: string;
  materialize: (program: Readonly<{
    dataset: OhProjectionDatasetV1;
    maximumDerivedTuples: number;
    maximumRounds: number;
    query: OhProjectionQueryV1;
    rulePack: OhProjectionRulePackV1;
  }>) => Readonly<{ relationFacts: ReadonlyMap<string, readonly OhProjectionAtomV1[][]> }>;
  options?: OhProjectionEvaluationOptionsV1;
  query: OhProjectionQueryV1;
  rulePack: OhProjectionRulePackV1;
  snapshot: OhProjectionSnapshotV1;
}>): OhProjectionResultV1 {
  const snapshot = parseOhProjectionSnapshotV1(input.snapshot);
  const dataset = snapshot === null ? null : parseOhProjectionDatasetV1(input.dataset, snapshot);
  const rulePack = parseOhProjectionRulePackV1(input.rulePack);
  const query = parseOhProjectionQueryV1(input.query);
  const engine = safeCode(input.engine, 256);
  if (snapshot === null || dataset === null || rulePack === null || query === null || engine === null) {
    throw new TypeError("Invalid projection adapter input.");
  }
  const options = resolveEvaluationOptions(input.options ?? {});
  validateProgramArities(dataset, rulePack, query);
  const work = { maximum: options.maximumWorkUnits, units: 0 };
  const witnessMaterialization = materializeNaive({ dataset,
    maximumDerivedTuples: options.maximumDerivedTuples, maximumRounds: options.maximumRounds, rulePack, work });
  const external = input.materialize({ dataset,
    maximumDerivedTuples: options.maximumDerivedTuples, maximumRounds: options.maximumRounds, query, rulePack });
  const externalCanonical = new Map<string, readonly string[]>();
  for (const [relationName, tuples] of external.relationFacts) {
    const relation = projectionName(relationName);
    if (relation === null || tuples.length > OH_PROJECTION_LIMITS_V1.facts + options.maximumDerivedTuples) {
      throw new TypeError("Projection adapter returned an invalid relation.");
    }
    const parsed = tuples.map(tuple);
    if (parsed.some((value) => value === null)) throw new TypeError("Projection adapter returned an invalid tuple.");
    const keys: string[] = [];
    for (const value of parsed) {
      if (value === null) throw new TypeError("Projection adapter returned an invalid tuple.");
      keys.push(tupleKey(value));
    }
    externalCanonical.set(relation, [...new Set(keys)].sort());
  }
  const expectedCanonical = new Map([...witnessMaterialization.relations.entries()].map(([relation, states]) =>
    [relation, [...states.values()].map((state) => tupleKey(state.tuple)).sort()] as const));
  const relationNames = [...new Set([...externalCanonical.keys(), ...expectedCanonical.keys()])].sort();
  for (const relation of relationNames) {
    if (canonicalJson(externalCanonical.get(relation) ?? []) !== canonicalJson(expectedCanonical.get(relation) ?? [])) {
      throw new Error(`Projection adapter disagrees with Oh semantics for relation ${relation}.`);
    }
  }
  return buildProjectionResult({ dataset, engine,
    materialized: witnessMaterialization, options, query, rulePack, snapshot, work });
}

export type OhProjectionRecordFactOptionsV1 = Readonly<{
  includeDependencies?: boolean;
  includeRecords?: boolean;
}>;

/** Builds the stable structural fact layer shared by every domain fact pack. */
export function createOhProjectionRecordFactsV1(records: readonly KnowledgeGraphRecordV1[],
  options: OhProjectionRecordFactOptionsV1 = {}): readonly OhProjectionFactV1[] {
  if (records.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) throw new RangeError("Too many records for projection facts.");
  const parsedRecords = [...records]
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map((candidate) => {
      const record = parseKnowledgeGraphRecordV1(candidate);
      if (record === null) throw new TypeError("Invalid graph record for projection facts.");
      return record;
    });
  let projectedFactCount = 0;
  for (const record of parsedRecords) {
    if (options.includeRecords !== false) projectedFactCount += 1;
    if (options.includeDependencies !== false) projectedFactCount += record.dependencies.length;
    if (projectedFactCount > OH_PROJECTION_LIMITS_V1.facts) {
      throw new RangeError("Structural projection exceeds its fact bound.");
    }
  }
  const facts: OhProjectionFactV1[] = [];
  for (const record of parsedRecords) {
    const source = [{ key: record.key, recordSha256: record.recordSha256, v: 1 as const }];
    if (options.includeRecords !== false) {
      facts.push(createOhProjectionFactV1({ relation: "oh.record", sources: source,
        tuple: [record.key, record.kind, record.recordSha256] }));
    }
    if (options.includeDependencies !== false) {
      for (const dependency of record.dependencies) {
        facts.push(createOhProjectionFactV1({ relation: "oh.dependency", sources: source,
          tuple: [record.key, dependency] }));
      }
    }
  }
  return facts.sort(compareProjectionFacts);
}

export function isOhProjectionRecordKindV1(value: unknown): value is KnowledgeGraphRecordKindV1 {
  return OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.some((kind) => kind === value);
}
