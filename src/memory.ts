import { randomBytes } from "node:crypto";

import {
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  utf8ByteLength,
  type JsonPrimitive,
  type Sha256Hex,
} from "./canonical";
import { type OhRecordCodecRegistry } from "./contract";
import {
  createKnowledgeGraphRecordV1,
  knowledgeGraphRecordRefV1,
  type KnowledgeGraphRecordV1,
} from "./graph";
import {
  OH_PROJECTION_SEMANTICS_V1,
  OH_PROJECTION_LIMITS_V1,
  createOhProjectionDatasetV1,
  createOhProjectionFactV1,
  createOhProjectionRecordFactsV1,
  createOhProjectionSnapshotV1,
  evaluateOhProjectionV1,
  parseOhProjectionQueryV1,
  parseOhProjectionRulePackV1,
  type OhProjectionAtomV1,
  type OhProjectionDatasetV1,
  type OhProjectionEvaluationOptionsV1,
  type OhProjectionFactV1,
  type OhProjectionProofV1,
  type OhProjectionQueryV1,
  type OhProjectionResultRowV1,
  type OhProjectionRulePackV1,
  type OhProjectionSnapshotV1,
} from "./projection";
import {
  OhIntegrityError,
  OH_DEPENDENCY_CLOSURE_LIMITS_V1,
  OhProfileError,
  OhSemanticBundleIngressV1,
  parseOhHeadV1,
  parseOhStoreBindingV1,
  verifyOhDependencyClosureAgainstV1,
  type OhDependencyClosureV1,
  type OhHeadV1,
  type OhSnapshotV1,
  type OhStoreBindingV1,
  type OhStoreV1,
} from "./store";
export const OH_MEMORY_FORMAT_VERSION_V1 = 1 as const;
export const OH_MEMORY_CONFLICT_POLICY_V1 = "visible-conflicts.v1" as const;
export const OH_MEMORY_LIMITS_V1 = Object.freeze({
  explainCapabilityEntryBytes: 32 * 1024 * 1024,
  explainCapabilities: 256,
  explainCapabilityLifetimeMs: 15 * 60 * 1_000,
  explainCapabilityTotalBytes: 64 * 1024 * 1024,
  factsPerRecordPerExtractor: 512,
  maximumExtractorInvocations: 262_144,
  maximumExtractors: 32,
  maximumNominationRoutes: 64,
  maximumPrograms: 128,
  maximumRecordsPerLane: 8_192,
  maximumSyntheticRecords: 16_384,
  rememberBytes: 8 * 1024 * 1024,
  resultBytes: 32 * 1024 * 1024,
  snapshotBytesPerLane: 32 * 1024 * 1024,
  relationsPerExtractor: 64,
});

const memoryFactPackPayload = Object.freeze({
  factPackId: "oh.memory.composite-facts",
  factPackRevision: 1,
  relations: Object.freeze(["memory.agreement", "memory.conflict", "memory.dependency", "memory.record"]),
  semantics: OH_PROJECTION_SEMANTICS_V1,
  v: 1 as const,
});

export const OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1 = Object.freeze({
  ...memoryFactPackPayload,
  extractorSha256: canonicalSha256(memoryFactPackPayload),
});

export type OhMemoryLaneV1 = "canonical" | "working";

export type OhMemoryAuthoritySourceV1 = Readonly<{
  authorityId: string;
  bindingSha256: Sha256Hex;
  head: OhHeadV1;
  key: string;
  lane: OhMemoryLaneV1;
  recordSha256: Sha256Hex;
  snapshotSha256: Sha256Hex;
  v: 1;
}>;

export type OhMemoryProofV1 =
  | Readonly<{
    factPolicy: OhMemoryFactPolicyV1;
    kind: "fact";
    relation: string;
    sources: readonly OhMemoryAuthoritySourceV1[];
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
  }>
  | Readonly<{
    kind: "derived";
    premises: readonly OhMemoryProofV1[];
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

export type OhMemoryLaneIdentityV1 = Readonly<{
  authorityId: string;
  bindingSha256: Sha256Hex;
  datasetSha256: Sha256Hex;
  head: OhHeadV1;
  lane: OhMemoryLaneV1;
  snapshotSha256: Sha256Hex;
  v: 1;
}>;

export type OhMemoryIdentityV1 = Readonly<{
  canonical: OhMemoryLaneIdentityV1;
  compositeDatasetSha256: Sha256Hex;
  conflictPolicy: typeof OH_MEMORY_CONFLICT_POLICY_V1;
  evaluationSha256: Sha256Hex;
  memorySha256: Sha256Hex;
  programId: string;
  projectionSha256: Sha256Hex;
  purpose: string;
  querySha256: Sha256Hex;
  rulePackSha256: Sha256Hex;
  v: 1;
  working: OhMemoryLaneIdentityV1;
}>;

export type OhMemoryConflictV1 = Readonly<{
  canonicalRecordSha256: Sha256Hex;
  key: string;
  v: 1;
  workingRecordSha256: Sha256Hex;
}>;

export type OhMemoryResultRowV1 = Readonly<{
  premiseAuthority: "canonical" | "unknown" | "working";
  premiseLanes: readonly OhMemoryLaneV1[];
  proofsTruncated: boolean;
  resultRowSha256: Sha256Hex;
  supportCount: number;
  v: 1;
  values: readonly OhProjectionAtomV1[];
}>;

export type OhMemoryQueryResultV1 = Readonly<{
  authority: "derived";
  conflicts: readonly OhMemoryConflictV1[];
  explainCapability: Readonly<{ expiresAt: string; token: string; v: 1 }>;
  identity: OhMemoryIdentityV1;
  projectionResultSha256: Sha256Hex;
  resultSha256: Sha256Hex;
  rows: readonly OhMemoryResultRowV1[];
  v: 1;
}>;

export type OhMemoryRememberReceiptV1 = Readonly<{
  actorId: string;
  authorityId: string;
  bindingSha256: Sha256Hex;
  head: OhHeadV1;
  instant: string;
  lane: "working";
  operationSha256: Sha256Hex;
  receiptSha256: Sha256Hex;
  requestId: string;
  status: "committed";
  v: 1;
}>;

export type OhMemoryExplanationV1 = Readonly<{
  authority: "derived";
  explanationSha256: Sha256Hex;
  identity: OhMemoryIdentityV1;
  premiseAuthority: OhMemoryResultRowV1["premiseAuthority"];
  premiseLanes: readonly OhMemoryLaneV1[];
  proofs: readonly OhMemoryProofV1[];
  proofsTruncated: boolean;
  resultRowSha256: Sha256Hex;
  resultSha256: Sha256Hex;
  supportCount: number;
  v: 1;
  values: readonly OhProjectionAtomV1[];
}>;

export type OhMemoryNominationV1 = Readonly<{
  closure: OhDependencyClosureV1;
  destinationPurpose: string;
  nominationId: string;
  nominationSha256: Sha256Hex;
  source: Readonly<{
    authorityId: string;
    bindingSha256: Sha256Hex;
    head: OhHeadV1;
    lane: "working";
    v: 1;
  }>;
  status: "prepared";
  v: 1;
}>;

export type OhMemoryNamedProgramV1 = Readonly<{
  evaluation?: OhProjectionEvaluationOptionsV1;
  programId: string;
  purpose: string;
  query: OhProjectionQueryV1;
  rulePack: OhProjectionRulePackV1;
}>;

export type OhMemoryNominationRouteV1 = Readonly<{
  destinationPurpose: string;
  nominationId: string;
}>;

export type OhMemoryFactPolicyV1 =
  | Readonly<{
    extractorSha256: Sha256Hex;
    factPackId: string;
    kind: "built-in";
    v: 1;
  }>
  | Readonly<{
    extractorId: string;
    extractorSha256: Sha256Hex;
    kind: "domain";
    v: 1;
  }>;

export type OhMemoryFactDeclarationV1 = Readonly<{
  relation: string;
  tuple: readonly JsonPrimitive[];
  v: 1;
}>;

/** Host-owned, digest-identified domain projection; it cannot choose sources. */
export type OhMemoryFactExtractorV1 = Readonly<{
  extract(input: Readonly<{
    lane: OhMemoryLaneV1;
    record: KnowledgeGraphRecordV1;
  }>): readonly OhMemoryFactDeclarationV1[];
  extractorId: string;
  extractorSha256: Sha256Hex;
  relations: readonly string[];
}>;

export type OhMemoryFacadeOptionsV1 = Readonly<{
  actorId: string;
  canonical: Readonly<{
    authorityId: string;
    expectedBindingSha256: Sha256Hex;
    expectedHead: OhHeadV1;
    store: OhStoreV1;
  }>;
  explainCapabilityLifetimeMs?: number;
  extractors?: readonly OhMemoryFactExtractorV1[];
  monotonicNow?: () => number;
  nominationRoutes?: readonly OhMemoryNominationRouteV1[];
  now?: () => Date;
  programs: readonly OhMemoryNamedProgramV1[];
  working: Readonly<{
    authorityId: string;
    codecs: OhRecordCodecRegistry;
    expectedBindingSha256: Sha256Hex;
    store: OhStoreV1;
  }>;
}>;

export interface OhMemoryAgentV1 {
  explain(value: unknown): Promise<OhMemoryExplanationV1>;
  nominate(value: unknown): Promise<OhMemoryNominationV1>;
  query(value: unknown): Promise<OhMemoryQueryResultV1>;
  remember(value: unknown): Promise<OhMemoryRememberReceiptV1>;
}

type LaneSnapshot = Readonly<{
  authorityId: string;
  binding: OhStoreBindingV1;
  dataset: OhProjectionDatasetV1;
  lane: OhMemoryLaneV1;
  projectionSnapshot: OhProjectionSnapshotV1;
  snapshot: OhSnapshotV1;
}>;

type SyntheticSource = Readonly<{
  physical: OhMemoryAuthoritySourceV1;
  record: KnowledgeGraphRecordV1;
}>;

type StoredExplanation = Readonly<{
  bytes: number;
  expiresAtMonotonicMs: number;
  identity: OhMemoryIdentityV1;
  proofs: readonly (readonly OhMemoryProofV1[])[];
  resultSha256: Sha256Hex;
  rows: readonly OhMemoryResultRowV1[];
}>;

const builtInFactPolicy: OhMemoryFactPolicyV1 = Object.freeze({
  extractorSha256: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.extractorSha256,
  factPackId: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.factPackId,
  kind: "built-in",
  v: 1,
});

function immutableClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => immutableClone(item))) as T;
  }
  if (value !== null && typeof value === "object") {
    if (!isPlainRecord(value)) throw new TypeError("Memory output contains a non-JSON object.");
    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(cloned, key, { configurable: false, enumerable: true,
        value: immutableClone(value[key]), writable: false });
    }
    return Object.freeze(cloned) as T;
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactHead(left: OhHeadV1, right: OhHeadV1): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function authorityId(value: unknown): string {
  const parsed = safeCode(value, 128);
  if (parsed === null) throw new TypeError("Invalid memory authority ID.");
  return parsed;
}

function bindingFor(store: OhStoreV1, expected: Sha256Hex, lane: OhMemoryLaneV1): OhStoreBindingV1 {
  const binding = parseOhStoreBindingV1(store.binding);
  if (binding === null || binding.bindingSha256 !== parseSha256Hex(expected)) {
    throw new OhIntegrityError(`The ${lane} store is not the host-bound authority.`);
  }
  if (binding.profile.profileKind !== lane) {
    throw new OhProfileError(`The ${lane} memory lane has the wrong store profile.`);
  }
  return binding;
}

function laneIdentity(value: LaneSnapshot): OhMemoryLaneIdentityV1 {
  return Object.freeze({
    authorityId: value.authorityId,
    bindingSha256: value.binding.bindingSha256,
    datasetSha256: value.dataset.datasetSha256,
    head: value.snapshot.head,
    lane: value.lane,
    snapshotSha256: value.projectionSnapshot.snapshotSha256,
    v: 1,
  });
}

function datasetForSnapshot(binding: OhStoreBindingV1, snapshot: OhSnapshotV1): Readonly<{
  dataset: OhProjectionDatasetV1;
  projectionSnapshot: OhProjectionSnapshotV1;
}> {
  const projectionSnapshot = createOhProjectionSnapshotV1({
    head: snapshot.head,
    records: snapshot.records,
    spaceId: binding.spaceId,
  });
  const dataset = createOhProjectionDatasetV1({
    extractorSha256: canonicalSha256({ extractor: "oh.memory.lane-structural", v: 1 }),
    factPackId: "oh.memory.lane-structural",
    factPackRevision: 1,
    facts: createOhProjectionRecordFactsV1(snapshot.records),
    snapshot: projectionSnapshot,
  });
  return { dataset, projectionSnapshot };
}

async function readLane(
  authority: Readonly<{ authorityId: string; binding: OhStoreBindingV1; store: OhStoreV1 }>,
  lane: OhMemoryLaneV1,
  expectedHead?: OhHeadV1,
): Promise<LaneSnapshot> {
  const returnedHead = expectedHead ?? await authority.store.head();
  const head = parseOhHeadV1(immutableClone(returnedHead));
  if (head === null) throw new OhIntegrityError(`The ${lane} store returned an invalid head.`);
  const returnedSnapshot = await authority.store.snapshot({
    head: { operationSha256: head.operationSha256, sequence: head.sequence },
    maximumRecords: OH_MEMORY_LIMITS_V1.maximumRecordsPerLane,
  });
  if (!isPlainRecord(returnedSnapshot)
    || !hasExactKeys(returnedSnapshot, ["head", "records", "v"])
    || returnedSnapshot.v !== 1 || !Array.isArray(returnedSnapshot.records)) {
    throw new OhIntegrityError(`The ${lane} store returned an invalid snapshot envelope.`);
  }
  const detached = immutableClone(returnedSnapshot);
  const detachedHead = parseOhHeadV1(detached.head);
  if (detachedHead === null) throw new OhIntegrityError(`The ${lane} store returned an invalid snapshot head.`);
  const snapshot: OhSnapshotV1 = immutableClone({ head: detachedHead,
    records: detached.records, v: 1 });
  if (!exactHead(snapshot.head, head)) {
    throw new OhIntegrityError(`The ${lane} snapshot differs from its pinned head.`);
  }
  if (utf8ByteLength(canonicalJson(snapshot)) > OH_MEMORY_LIMITS_V1.snapshotBytesPerLane) {
    throw new RangeError(`The ${lane} memory snapshot exceeds its canonical byte bound.`);
  }
  const projected = datasetForSnapshot(authority.binding, snapshot);
  return Object.freeze({ authorityId: authority.authorityId, binding: authority.binding,
    dataset: projected.dataset, lane, projectionSnapshot: projected.projectionSnapshot, snapshot });
}

function syntheticKey(lane: OhMemoryLaneV1, recordSha256: Sha256Hex): string {
  return `memory-source:${lane}:${recordSha256}`;
}

function createSyntheticSources(lanes: readonly LaneSnapshot[]): Readonly<{
  records: readonly KnowledgeGraphRecordV1[];
  sources: ReadonlyMap<string, SyntheticSource>;
}> {
  const sources = new Map<string, SyntheticSource>();
  for (const lane of lanes) {
    for (const physicalRecord of lane.snapshot.records) {
      const key = syntheticKey(lane.lane, physicalRecord.recordSha256);
      const record = createKnowledgeGraphRecordV1({ dependencies: [], key, kind: "view", v: 1,
        value: { authorityId: lane.authorityId, bindingSha256: lane.binding.bindingSha256,
          key: physicalRecord.key, lane: lane.lane, recordSha256: physicalRecord.recordSha256,
          snapshotSha256: lane.projectionSnapshot.snapshotSha256, v: 1 } });
      const physical = Object.freeze({ authorityId: lane.authorityId,
        bindingSha256: lane.binding.bindingSha256,
        head: lane.snapshot.head, key: physicalRecord.key, lane: lane.lane,
        recordSha256: physicalRecord.recordSha256,
        snapshotSha256: lane.projectionSnapshot.snapshotSha256, v: 1 as const });
      if (sources.has(key)) throw new OhIntegrityError("A memory lane contains a duplicate source digest.");
      sources.set(key, Object.freeze({ physical, record }));
    }
  }
  if (sources.size > OH_MEMORY_LIMITS_V1.maximumSyntheticRecords) {
    throw new RangeError("The composite memory snapshot has too many records.");
  }
  const records = [...sources.values()].map(({ record }) => record)
    .sort((left, right) => compareText(left.key, right.key));
  return { records, sources };
}

function sourceFor(
  sources: ReadonlyMap<string, SyntheticSource>,
  lane: OhMemoryLaneV1,
  record: KnowledgeGraphRecordV1,
) {
  const source = sources.get(syntheticKey(lane, record.recordSha256));
  if (source === undefined) throw new OhIntegrityError("A composite memory source is missing.");
  return [{ key: source.record.key, recordSha256: source.record.recordSha256, v: 1 as const }];
}

function createCompositeDataset(canonical: LaneSnapshot, working: LaneSnapshot,
  extractors: readonly OhMemoryFactExtractorV1[]): Readonly<{
  conflicts: readonly OhMemoryConflictV1[];
  dataset: OhProjectionDatasetV1;
  factPolicies: ReadonlyMap<string, OhMemoryFactPolicyV1>;
  snapshot: OhProjectionSnapshotV1;
  sources: ReadonlyMap<string, SyntheticSource>;
}> {
  const synthetic = createSyntheticSources([canonical, working]);
  const extractorInvocations = synthetic.records.length * extractors.length;
  if (extractorInvocations > OH_MEMORY_LIMITS_V1.maximumExtractorInvocations) {
    throw new RangeError("The composite memory extractor invocation count exceeds its explicit bound.");
  }
  const facts: OhProjectionFactV1[] = [];
  const factDigests = new Set<Sha256Hex>();
  const factPolicies = new Map<string, OhMemoryFactPolicyV1>();
  const addFact = (fact: OhProjectionFactV1, policy: OhMemoryFactPolicyV1) => {
    if (facts.length >= OH_PROJECTION_LIMITS_V1.facts) {
      throw new RangeError("The composite memory fact set exceeds its explicit bound.");
    }
    if (factDigests.has(fact.factSha256)) {
      throw new OhIntegrityError("A memory fact extractor emitted the same exact fact twice.");
    }
    const priorPolicy = factPolicies.get(fact.relation);
    if (priorPolicy !== undefined && canonicalJson(priorPolicy) !== canonicalJson(policy)) {
      throw new OhIntegrityError("A memory relation has more than one fact policy.");
    }
    facts.push(fact);
    factDigests.add(fact.factSha256);
    factPolicies.set(fact.relation, policy);
  };
  const byLane = new Map<OhMemoryLaneV1, Map<string, KnowledgeGraphRecordV1>>([
    ["canonical", new Map(canonical.snapshot.records.map((record) => [record.key, record]))],
    ["working", new Map(working.snapshot.records.map((record) => [record.key, record]))],
  ]);
  for (const lane of [canonical, working] as const) {
    for (const record of lane.snapshot.records) {
      const extractorRecord = immutableClone(record);
      const source = sourceFor(synthetic.sources, lane.lane, record);
      addFact(createOhProjectionFactV1({ relation: "memory.record", sources: source,
        tuple: [lane.lane, record.key, record.kind, record.recordSha256] }), builtInFactPolicy);
      for (const dependency of record.dependencies) {
        addFact(createOhProjectionFactV1({ relation: "memory.dependency", sources: source,
          tuple: [lane.lane, record.key, dependency] }), builtInFactPolicy);
      }
      for (const extractor of extractors) {
        const declared = extractor.extract(Object.freeze({ lane: lane.lane, record: extractorRecord }));
        if (!Array.isArray(declared)
          || declared.length > OH_MEMORY_LIMITS_V1.factsPerRecordPerExtractor) {
          throw new RangeError("A memory fact extractor exceeded its per-record bound.");
        }
        for (const fact of declared) {
          if (!isPlainRecord(fact) || !hasExactKeys(fact, ["relation", "tuple", "v"])
            || fact.v !== 1 || !Array.isArray(fact.tuple) || typeof fact.relation !== "string"
            || !extractor.relations.includes(fact.relation)) {
            throw new TypeError("A memory fact extractor returned an invalid or reserved fact.");
          }
          addFact(createOhProjectionFactV1({ relation: fact.relation, sources: source, tuple: fact.tuple }),
            Object.freeze({ extractorId: extractor.extractorId,
              extractorSha256: extractor.extractorSha256, kind: "domain", v: 1 }));
        }
      }
    }
  }
  const conflicts: OhMemoryConflictV1[] = [];
  const canonicalByKey = byLane.get("canonical")!;
  const workingByKey = byLane.get("working")!;
  for (const key of [...canonicalByKey.keys()].filter((candidate) => workingByKey.has(candidate)).sort()) {
    const canonicalRecord = canonicalByKey.get(key)!;
    const workingRecord = workingByKey.get(key)!;
    const sources = [
      ...sourceFor(synthetic.sources, "canonical", canonicalRecord),
      ...sourceFor(synthetic.sources, "working", workingRecord),
    ];
    if (canonicalRecord.recordSha256 === workingRecord.recordSha256) {
      addFact(createOhProjectionFactV1({ relation: "memory.agreement", sources,
        tuple: [key, canonicalRecord.recordSha256] }), builtInFactPolicy);
    } else {
      addFact(createOhProjectionFactV1({ relation: "memory.conflict", sources,
        tuple: [key, canonicalRecord.recordSha256, workingRecord.recordSha256] }), builtInFactPolicy);
      conflicts.push(Object.freeze({ canonicalRecordSha256: canonicalRecord.recordSha256,
        key, v: 1, workingRecordSha256: workingRecord.recordSha256 }));
    }
  }
  const recordRefs = synthetic.records.map(knowledgeGraphRecordRefV1)
    .sort((left, right) => compareText(left.key, right.key));
  const sourceIdentity = {
    canonical: laneIdentity(canonical),
    conflictPolicy: OH_MEMORY_CONFLICT_POLICY_V1,
    recordRefs,
    v: 1 as const,
    working: laneIdentity(working),
  };
  const head: OhHeadV1 = Object.freeze({ generation: 1,
    graphRevisionSha256: canonicalSha256({ kind: "oh.memory.composite-graph", sourceIdentity }),
    operationSha256: canonicalSha256({ kind: "oh.memory.composite-operation", sourceIdentity }),
    recordsSha256: canonicalSha256(recordRefs), sequence: 1, v: 1 });
  const snapshot = createOhProjectionSnapshotV1({ head, records: synthetic.records,
    spaceId: "oh.memory.composite" });
  const dataset = createOhProjectionDatasetV1({
    extractorSha256: canonicalSha256({
      builtIn: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.extractorSha256,
      extensions: extractors.map(({ extractorId, extractorSha256, relations }) => ({
        extractorId, extractorSha256, relations,
      })),
      v: 1,
    }),
    factPackId: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.factPackId,
    factPackRevision: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.factPackRevision,
    facts,
    snapshot,
  });
  return Object.freeze({ conflicts: Object.freeze(conflicts), dataset, factPolicies, snapshot,
    sources: synthetic.sources });
}

function mapProof(proof: OhProjectionProofV1,
  sources: ReadonlyMap<string, SyntheticSource>,
  factPolicies: ReadonlyMap<string, OhMemoryFactPolicyV1>): OhMemoryProofV1 {
  if (proof.kind === "truncated") return Object.freeze({ ...proof });
  if (proof.kind === "derived") {
    return Object.freeze({ ...proof,
      premises: Object.freeze(proof.premises.map((premise) => mapProof(premise, sources, factPolicies))) });
  }
  const physical = proof.sources.map((source) => {
    const mapped = sources.get(source.key);
    if (mapped === undefined || mapped.record.recordSha256 !== source.recordSha256) {
      throw new OhIntegrityError("A projection proof has no exact physical memory source.");
    }
    return mapped.physical;
  }).sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
  const factPolicy = factPolicies.get(proof.relation);
  if (factPolicy === undefined) throw new OhIntegrityError("A projection proof has no memory fact policy.");
  return Object.freeze({ factPolicy, kind: "fact", relation: proof.relation,
    sources: Object.freeze(physical), tuple: proof.tuple, v: 1 });
}

function collectLanes(proof: OhMemoryProofV1, lanes: Set<OhMemoryLaneV1>): boolean {
  if (proof.kind === "truncated") return true;
  if (proof.kind === "fact") {
    for (const source of proof.sources) lanes.add(source.lane);
    return false;
  }
  let unknown = proof.premisesTruncated;
  for (const premise of proof.premises) unknown = collectLanes(premise, lanes) || unknown;
  return unknown;
}

function publicRow(row: OhProjectionResultRowV1,
  proofs: readonly OhMemoryProofV1[]): OhMemoryResultRowV1 {
  const lanes = new Set<OhMemoryLaneV1>();
  let unknown = row.proofsTruncated;
  for (const proof of proofs) unknown = collectLanes(proof, lanes) || unknown;
  const premiseLanes = [...lanes].sort() as readonly OhMemoryLaneV1[];
  const premiseAuthority: OhMemoryResultRowV1["premiseAuthority"] = unknown || premiseLanes.length === 0
    ? "unknown" : premiseLanes.includes("working") ? "working" : "canonical";
  const payload = { premiseAuthority, premiseLanes, proofsTruncated: row.proofsTruncated,
    supportCount: row.supportCount, v: 1 as const, values: row.values };
  return Object.freeze({ ...payload, resultRowSha256: canonicalSha256(payload) });
}

function resolvePrograms(programs: readonly OhMemoryNamedProgramV1[]): ReadonlyMap<string, OhMemoryNamedProgramV1> {
  if (programs.length < 1 || programs.length > OH_MEMORY_LIMITS_V1.maximumPrograms) {
    throw new RangeError("Memory requires a bounded nonempty named program registry.");
  }
  const resolved = new Map<string, OhMemoryNamedProgramV1>();
  for (const program of programs) {
    const programId = safeCode(program.programId, 128);
    const purpose = safeCode(program.purpose, 256);
    const query = parseOhProjectionQueryV1(program.query);
    const rulePack = parseOhProjectionRulePackV1(program.rulePack);
    if (programId === null || purpose === null || query === null || rulePack === null
      || resolved.has(programId)) {
      throw new TypeError("Invalid or duplicate named memory program.");
    }
    resolved.set(programId, immutableClone({ ...(program.evaluation === undefined ? {}
      : { evaluation: { ...program.evaluation } }), programId, purpose, query, rulePack }));
  }
  return resolved;
}

function resolveExtractors(extractors: readonly OhMemoryFactExtractorV1[]): readonly OhMemoryFactExtractorV1[] {
  if (extractors.length > OH_MEMORY_LIMITS_V1.maximumExtractors) {
    throw new RangeError("The memory domain extractor registry is too large.");
  }
  const claimedRelations = new Set<string>();
  const resolved = extractors.map((extractor) => {
    const extractorId = safeCode(extractor.extractorId, 128);
    const extractorSha256 = parseSha256Hex(extractor.extractorSha256);
    if (extractorId === null || extractorSha256 === null || typeof extractor.extract !== "function"
      || !Array.isArray(extractor.relations) || extractor.relations.length < 1
      || extractor.relations.length > OH_MEMORY_LIMITS_V1.relationsPerExtractor) {
      throw new TypeError("Invalid memory domain fact extractor.");
    }
    const relations = extractor.relations.map((relation) => safeCode(relation, 128)).sort();
    if (relations.some((relation) => relation === null
      || relation.startsWith("memory.") || relation.startsWith("oh."))
      || new Set(relations).size !== relations.length) {
      throw new TypeError("A memory domain fact extractor has invalid or reserved relations.");
    }
    for (const relation of relations as string[]) {
      if (claimedRelations.has(relation)) {
        throw new TypeError("Memory domain fact extractor relations must have one owner.");
      }
      claimedRelations.add(relation);
    }
    return Object.freeze({ extract: extractor.extract, extractorId, extractorSha256,
      relations: Object.freeze(relations as string[]) });
  }).sort((left, right) => compareText(left.extractorId, right.extractorId));
  if (new Set(resolved.map(({ extractorId }) => extractorId)).size !== resolved.length) {
    throw new TypeError("Duplicate memory domain fact extractor ID.");
  }
  return Object.freeze(resolved);
}

function resolveNominationRoutes(routes: readonly OhMemoryNominationRouteV1[]):
ReadonlyMap<string, OhMemoryNominationRouteV1> {
  if (routes.length > OH_MEMORY_LIMITS_V1.maximumNominationRoutes) {
    throw new RangeError("The memory nomination route registry is too large.");
  }
  const resolved = new Map<string, OhMemoryNominationRouteV1>();
  for (const route of routes) {
    const nominationId = safeCode(route.nominationId, 128);
    const destinationPurpose = safeCode(route.destinationPurpose, 256);
    if (nominationId === null || destinationPurpose === null || resolved.has(nominationId)) {
      throw new TypeError("Invalid or duplicate memory nomination route.");
    }
    resolved.set(nominationId, Object.freeze({ destinationPurpose, nominationId }));
  }
  return resolved;
}

function parseQueryRequest(value: unknown): Readonly<{ programId: string }> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["programId", "v"])
    || value.v !== 1) throw new TypeError("Invalid named memory query.");
  const programId = safeCode(value.programId, 128);
  if (programId === null) throw new TypeError("Invalid named memory query identity.");
  return { programId };
}

function parseExplainRequest(value: unknown): Readonly<{
  row: number;
  resultSha256: Sha256Hex;
  token: string;
}> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["resultSha256", "row", "token", "v"])
    || value.v !== 1 || typeof value.token !== "string" || value.token.length !== 43
    || !Number.isSafeInteger(value.row) || (value.row as number) < 0) {
    throw new TypeError("Invalid memory explanation request.");
  }
  const resultSha256 = parseSha256Hex(value.resultSha256);
  if (resultSha256 === null) throw new TypeError("Invalid memory explanation result identity.");
  return { resultSha256, row: value.row as number, token: value.token };
}

function parseNominationRequest(value: unknown): Readonly<{
  nominationId: string;
  roots: readonly string[];
}> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["nominationId", "roots", "v"])
    || value.v !== 1 || !Array.isArray(value.roots) || value.roots.length < 1
    || value.roots.length > OH_DEPENDENCY_CLOSURE_LIMITS_V1.roots) {
    throw new TypeError("Invalid memory nomination request.");
  }
  const nominationId = safeCode(value.nominationId, 128);
  const roots = value.roots.map((root) => safeCode(root, 512)).sort();
  if (nominationId === null || roots.some((root) => root === null)
    || new Set(roots).size !== roots.length) throw new TypeError("Invalid memory nomination identity.");
  return { nominationId, roots: roots as readonly string[] };
}

function isoInstant(date: Date): string {
  const value = date.toISOString();
  if (parseCanonicalInstantV1(value) === null) throw new TypeError("The memory clock returned an invalid instant.");
  return value;
}

function clockMilliseconds(now: () => Date): number {
  const milliseconds = now().getTime();
  if (!Number.isFinite(milliseconds)) throw new TypeError("The memory clock returned an invalid date.");
  return milliseconds;
}

function monotonicMilliseconds(now: () => number): number {
  const milliseconds = now();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new TypeError("The memory monotonic clock returned an invalid value.");
  }
  return milliseconds;
}

/**
 * Creates a model-facing memory surface over two host-bound physical Oh
 * authorities. The returned object has no store, locator, rule, sync, canonical
 * write, or purge handle.
 */
export async function createOhMemoryAgentV1(options: OhMemoryFacadeOptionsV1): Promise<OhMemoryAgentV1> {
  const memoryActorId = safeCode(options.actorId, 128);
  if (memoryActorId === null) throw new TypeError("Invalid host-bound memory actor ID.");
  const canonicalStore = options.canonical.store;
  const workingStore = options.working.store;
  const workingCodecs = options.working.codecs;
  const canonicalAuthorityId = authorityId(options.canonical.authorityId);
  const workingAuthorityId = authorityId(options.working.authorityId);
  if (canonicalAuthorityId === workingAuthorityId) {
    throw new OhProfileError("Working and canonical memory must be distinct physical authorities.");
  }
  const canonicalBinding = bindingFor(canonicalStore,
    options.canonical.expectedBindingSha256, "canonical");
  const workingBinding = bindingFor(workingStore,
    options.working.expectedBindingSha256, "working");
  const expectedCanonicalHead = parseOhHeadV1(options.canonical.expectedHead);
  if (expectedCanonicalHead === null) throw new TypeError("Invalid pinned canonical memory head.");
  const programs = resolvePrograms(options.programs);
  const extractors = resolveExtractors(options.extractors ?? []);
  const nominationRoutes = resolveNominationRoutes(options.nominationRoutes ?? []);
  const ingress = new OhSemanticBundleIngressV1(workingStore, workingCodecs);
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const capabilityLifetime = options.explainCapabilityLifetimeMs
    ?? OH_MEMORY_LIMITS_V1.explainCapabilityLifetimeMs;
  if (!Number.isSafeInteger(capabilityLifetime) || capabilityLifetime < 1_000
    || capabilityLifetime > 60 * 60 * 1_000) {
    throw new RangeError("Invalid memory explanation capability lifetime.");
  }
  const canonical = await readLane({ authorityId: canonicalAuthorityId,
    binding: canonicalBinding, store: canonicalStore }, "canonical", expectedCanonicalHead);
  const explanations = new Map<string, StoredExplanation>();
  let explanationBytes = 0;
  let lastMonotonicMs = -1;
  let lastWallClockMs = Number.NEGATIVE_INFINITY;
  const wallClock = () => {
    const milliseconds = clockMilliseconds(now);
    if (milliseconds < lastWallClockMs) throw new OhProfileError("The memory wall clock regressed.");
    lastWallClockMs = milliseconds;
    return milliseconds;
  };
  const monotonicClock = () => {
    const milliseconds = monotonicMilliseconds(monotonicNow);
    if (milliseconds < lastMonotonicMs) throw new OhProfileError("The memory monotonic clock regressed.");
    lastMonotonicMs = milliseconds;
    return milliseconds;
  };
  const deleteExplanation = (token: string) => {
    const stored = explanations.get(token);
    if (stored !== undefined && explanations.delete(token)) explanationBytes -= stored.bytes;
  };

  const remember = async (value: unknown): Promise<OhMemoryRememberReceiptV1> => {
    if (utf8ByteLength(canonicalJson(value)) > OH_MEMORY_LIMITS_V1.rememberBytes) {
      throw new RangeError("The memory semantic bundle exceeds its canonical byte bound.");
    }
    if (!isPlainRecord(value) || !hasExactKeys(value,
      ["expectedHead", "puts", "requestId", "tombstones", "v"]) || value.v !== 1) {
      throw new TypeError("Invalid memory remember request.");
    }
    const requestId = safeCode(value.requestId, 128);
    if (requestId === null) throw new TypeError("Invalid memory remember request identity.");
    const operationId = `memory_${canonicalSha256({ actorId: memoryActorId,
      bindingSha256: workingBinding.bindingSha256, requestId, v: 1 }).slice(0, 48)}`;
    const operation = await ingress.commit({ actorId: memoryActorId,
      expectedHead: value.expectedHead, instant: isoInstant(new Date(wallClock())), operationId,
      puts: value.puts, tombstones: value.tombstones, v: 1 });
    const head: OhHeadV1 = { generation: operation.sequence,
      graphRevisionSha256: operation.graphRevisionSha256,
      operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
      sequence: operation.sequence, v: 1 };
    const payload = { actorId: operation.actorId, authorityId: workingAuthorityId,
      bindingSha256: workingBinding.bindingSha256, head, instant: operation.instant,
      lane: "working" as const, operationSha256: operation.operationSha256, requestId,
      status: "committed" as const, v: 1 as const };
    return immutableClone({ ...payload, receiptSha256: canonicalSha256(payload) });
  };

  const query = async (value: unknown): Promise<OhMemoryQueryResultV1> => {
    const request = parseQueryRequest(value);
    const program = programs.get(request.programId);
    if (program === undefined) throw new TypeError("Unknown named memory program.");
    const working = await readLane({ authorityId: workingAuthorityId,
      binding: workingBinding, store: workingStore }, "working");
    const composite = createCompositeDataset(canonical, working, extractors);
    const projection = evaluateOhProjectionV1({ dataset: composite.dataset,
      ...(program.evaluation === undefined ? {} : { options: program.evaluation }),
      query: program.query, rulePack: program.rulePack, snapshot: composite.snapshot });
    const identityPayload = {
      canonical: laneIdentity(canonical),
      compositeDatasetSha256: composite.dataset.datasetSha256,
      conflictPolicy: OH_MEMORY_CONFLICT_POLICY_V1,
      evaluationSha256: projection.identity.evaluationSha256,
      programId: program.programId,
      projectionSha256: projection.identity.projectionSha256,
      purpose: program.purpose,
      querySha256: program.query.querySha256,
      rulePackSha256: program.rulePack.rulePackSha256,
      v: 1 as const,
      working: laneIdentity(working),
    };
    const identity: OhMemoryIdentityV1 = immutableClone({ ...identityPayload,
      memorySha256: canonicalSha256(identityPayload) });
    const proofs = immutableClone(projection.rows.map((row) =>
      row.proofs.map((proof) => mapProof(proof, composite.sources, composite.factPolicies))));
    const rows = immutableClone(projection.rows.map((row, index) => publicRow(row, proofs[index]!)));
    const resultPayload = immutableClone({ authority: "derived" as const,
      conflicts: composite.conflicts, identity, projectionResultSha256: projection.resultSha256,
      rows, v: 1 as const });
    const resultSha256 = canonicalSha256(resultPayload);
    const issuedAt = wallClock();
    const issuedAtMonotonic = monotonicClock();
    const expiresAtMs = issuedAt + capabilityLifetime;
    const expiresAtMonotonicMs = issuedAtMonotonic + capabilityLifetime;
    const expiresAt = isoInstant(new Date(expiresAtMs));
    for (const [existingToken, stored] of explanations) {
      if (issuedAtMonotonic >= stored.expiresAtMonotonicMs) deleteExplanation(existingToken);
    }
    const storedPayload = immutableClone({ expiresAtMonotonicMs, identity, proofs, resultSha256, rows });
    const storedBytes = utf8ByteLength(canonicalJson(storedPayload)) + 128;
    if (storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityEntryBytes
      || storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      throw new RangeError("The memory explanation exceeds its retained capability bound.");
    }
    while (explanations.size >= OH_MEMORY_LIMITS_V1.explainCapabilities
      || explanationBytes + storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      const oldest = explanations.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      deleteExplanation(oldest);
    }
    let token = randomBytes(32).toString("base64url");
    while (explanations.has(token)) token = randomBytes(32).toString("base64url");
    explanations.set(token, immutableClone({ ...storedPayload, bytes: storedBytes }));
    explanationBytes += storedBytes;
    const result = immutableClone({ ...resultPayload,
      explainCapability: { expiresAt, token, v: 1 as const }, resultSha256 });
    if (utf8ByteLength(canonicalJson(result)) > OH_MEMORY_LIMITS_V1.resultBytes) {
      deleteExplanation(token);
      throw new RangeError("The composite memory result exceeds its canonical byte bound.");
    }
    return result;
  };

  const explain = async (value: unknown): Promise<OhMemoryExplanationV1> => {
    const request = parseExplainRequest(value);
    const stored = explanations.get(request.token);
    const currentTime = monotonicClock();
    if (stored === undefined || stored.resultSha256 !== request.resultSha256
      || currentTime >= stored.expiresAtMonotonicMs) {
      deleteExplanation(request.token);
      throw new OhProfileError("The memory explanation capability is absent, expired, or misbound.");
    }
    const row = stored.rows[request.row];
    const proofs = stored.proofs[request.row];
    if (row === undefined || proofs === undefined) throw new RangeError("The explanation row is out of bounds.");
    const payload = { authority: "derived" as const, identity: stored.identity,
      premiseAuthority: row.premiseAuthority, premiseLanes: row.premiseLanes, proofs,
      proofsTruncated: row.proofsTruncated, resultRowSha256: row.resultRowSha256,
      resultSha256: stored.resultSha256, supportCount: row.supportCount, v: 1 as const,
      values: row.values };
    return immutableClone({ ...payload, explanationSha256: canonicalSha256(payload) });
  };

  const nominate = async (value: unknown): Promise<OhMemoryNominationV1> => {
    const request = parseNominationRequest(value);
    const route = nominationRoutes.get(request.nominationId);
    if (route === undefined) throw new TypeError("Unknown named memory nomination route.");
    const head = parseOhHeadV1(immutableClone(await workingStore.head()));
    if (head === null) throw new OhIntegrityError("The working nomination store returned an invalid head.");
    const closure = await workingStore.exportDependencyClosure({ head: {
      operationSha256: head.operationSha256, sequence: head.sequence }, roots: request.roots });
    const verified = verifyOhDependencyClosureAgainstV1(closure, { binding: workingBinding, head });
    if (!verified.ok) throw new OhIntegrityError("The working nomination closure failed exact verification.");
    if (canonicalJson(verified.closure.roots) !== canonicalJson(request.roots)) {
      throw new OhIntegrityError("The working nomination closure substituted different roots.");
    }
    const source = Object.freeze({ authorityId: workingAuthorityId,
      bindingSha256: workingBinding.bindingSha256, head, lane: "working" as const, v: 1 as const });
    const payload = { closure: verified.closure, destinationPurpose: route.destinationPurpose,
      nominationId: route.nominationId, source, status: "prepared" as const, v: 1 as const };
    return immutableClone({ ...payload, nominationSha256: canonicalSha256(payload) });
  };

  return Object.freeze({ explain, nominate, query, remember });
}
