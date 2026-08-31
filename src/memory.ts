import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export * from "./memory-pages";

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
  createOhProjectionLiteralV1,
  createOhProjectionQueryV1,
  createOhProjectionRecordFactsV1,
  createOhProjectionSnapshotV1,
  evaluateOhProjectionV1,
  ohProjectionConstantV1,
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

/** Additive experimental query/pagination limits; V1 contracts are unchanged. */
export const OH_MEMORY_QUERY_LIMITS_V2 = Object.freeze({
  bindingBytes: 64 * 1024,
  bindings: 32,
  continuationBytes: 4 * 1024,
  continuationKeyMaximumBytes: 64,
  continuationKeyMinimumBytes: 32,
  maximumPageBytes: 8 * 1024 * 1024,
  maximumPageRows: 256,
  maximumProgramRows: OH_PROJECTION_LIMITS_V1.queryResults,
  minimumPageBytes: 64 * 1024,
  requestBytes: 80 * 1024,
});

export type OhMemoryEvaluationLimitsV2 = Readonly<{
  maximumDerivedTuples: number;
  maximumProofDepth: number;
  maximumProofNodes: number;
  maximumResultBytes: number;
  maximumRounds: number;
  maximumTotalProofNodes: number;
  maximumWorkUnits: number;
}>;

/**
 * A host-owned parameterized program. Parameter names refer only to variables
 * in the query body, never to rule variables or projected output variables.
 */
export type OhMemoryNamedProgramV2 = Readonly<{
  evaluation: OhMemoryEvaluationLimitsV2;
  maximumPageBytes: number;
  maximumRows: number;
  pageSize: number;
  parameters: readonly string[];
  programId: string;
  purpose: string;
  query: OhProjectionQueryV1;
  rulePack: OhProjectionRulePackV1;
  v: 2;
}>;

export type OhMemoryFacadeOptionsV2 = Readonly<
  Omit<OhMemoryFacadeOptionsV1, "programs"> & Readonly<{
    /** Raw HMAC key for continuations that must survive agent reconstruction. */
    continuationKey?: Uint8Array;
    programs: readonly OhMemoryNamedProgramV2[];
  }>
>;

export type OhMemoryIdentityV2 = Readonly<{
  bindings: Readonly<Record<string, JsonPrimitive>>;
  bindingsSha256: Sha256Hex;
  boundQuerySha256: Sha256Hex;
  canonical: OhMemoryLaneIdentityV1;
  compositeDatasetSha256: Sha256Hex;
  conflictPolicy: typeof OH_MEMORY_CONFLICT_POLICY_V1;
  evaluationSha256: Sha256Hex;
  memorySha256: Sha256Hex;
  programId: string;
  programSha256: Sha256Hex;
  projectionSha256: Sha256Hex;
  purpose: string;
  rulePackSha256: Sha256Hex;
  templateQuerySha256: Sha256Hex;
  v: 2;
  working: OhMemoryLaneIdentityV1;
}>;

export type OhMemoryResultRowV2 = Readonly<{
  premiseAuthority: "canonical" | "unknown" | "working";
  premiseLanes: readonly OhMemoryLaneV1[];
  proofsTruncated: boolean;
  resultRowSha256: Sha256Hex;
  supportCount: number;
  v: 2;
  values: readonly OhProjectionAtomV1[];
}>;

export type OhMemoryPageV2 = Readonly<{
  completeness: "complete" | "partial";
  endExclusive: number;
  hasMore: boolean;
  maximumPageBytes: number;
  pageSize: number;
  returnedRows: number;
  start: number;
  totalRows: number;
  truncation: Readonly<{
    reasons: readonly [];
    truncated: false;
    v: 2;
  }>;
  v: 2;
}>;

export type OhMemoryQueryResultV2 = Readonly<{
  authority: "derived";
  conflicts: Readonly<{ count: number; conflictsSha256: Sha256Hex; v: 2 }>;
  continuation: string | null;
  continuationSha256: Sha256Hex | null;
  explainCapability: Readonly<{ expiresAt: string; token: string; v: 2 }>;
  identity: OhMemoryIdentityV2;
  page: OhMemoryPageV2;
  projectionResultSha256: Sha256Hex;
  resultSha256: Sha256Hex;
  rows: readonly OhMemoryResultRowV2[];
  v: 2;
}>;

export type OhMemoryExplanationV2 = Readonly<{
  authority: "derived";
  explanationSha256: Sha256Hex;
  identity: OhMemoryIdentityV2;
  page: OhMemoryPageV2;
  pageRow: number;
  premiseAuthority: OhMemoryResultRowV2["premiseAuthority"];
  premiseLanes: readonly OhMemoryLaneV1[];
  proofs: readonly OhMemoryProofV1[];
  proofsTruncated: boolean;
  resultRowSha256: Sha256Hex;
  resultSha256: Sha256Hex;
  supportCount: number;
  v: 2;
  values: readonly OhProjectionAtomV1[];
}>;

export interface OhMemoryAgentV2 {
  explain(value: unknown): Promise<OhMemoryExplanationV2>;
  nominate(value: unknown): Promise<OhMemoryNominationV1>;
  query(value: unknown): Promise<OhMemoryQueryResultV2>;
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

type ResolvedMemoryProgramV2 = OhMemoryNamedProgramV2 & Readonly<{
  programSha256: Sha256Hex;
}>;

type StoredExplanationV2 = Readonly<{
  bytes: number;
  expiresAtMonotonicMs: number;
  identity: OhMemoryIdentityV2;
  page: OhMemoryPageV2;
  proofs: readonly (readonly OhMemoryProofV1[])[];
  resultSha256: Sha256Hex;
  rows: readonly OhMemoryResultRowV2[];
}>;

type OhMemoryContinuationIdentityV2 = Readonly<{
  bindingsSha256: Sha256Hex;
  memorySha256: Sha256Hex;
  nextOffset: number;
  pageSize: number;
  programSha256: Sha256Hex;
  projectionResultSha256: Sha256Hex;
  totalRows: number;
  v: 2;
}>;

type OhMemoryContinuationV2 = OhMemoryContinuationIdentityV2 & Readonly<{
  continuationSha256: Sha256Hex;
}>;

type OhMemoryContinuationEnvelopeV2 = OhMemoryContinuationV2 & Readonly<{
  continuationHmacSha256: Sha256Hex;
}>;

function ownDataKeysV2(value: unknown, maximum: number, label: string): readonly string[] {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a plain data object.`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > maximum) throw new RangeError(`${label} has too many entries.`);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} must have only string data properties.`);
  }
  const keys = ownKeys as string[];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} must have only enumerable data properties.`);
    }
  }
  return keys;
}

function continuationKeyV2(value: Uint8Array | undefined): Uint8Array {
  if (value === undefined) return Uint8Array.from(randomBytes(32));
  if (!(value instanceof Uint8Array)
    || value.byteLength < OH_MEMORY_QUERY_LIMITS_V2.continuationKeyMinimumBytes
    || value.byteLength > OH_MEMORY_QUERY_LIMITS_V2.continuationKeyMaximumBytes) {
    throw new RangeError("The V2 memory continuation key must be 32 through 64 raw bytes.");
  }
  return Uint8Array.from(value);
}

function positiveBounded(value: unknown, maximum: number, label: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function resolveEvaluationV2(value: unknown): OhMemoryEvaluationLimitsV2 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["maximumDerivedTuples", "maximumProofDepth",
    "maximumProofNodes", "maximumResultBytes", "maximumRounds", "maximumTotalProofNodes",
    "maximumWorkUnits"])) {
    throw new TypeError("A V2 memory program must declare every projection evaluation limit.");
  }
  return Object.freeze({
    maximumDerivedTuples: positiveBounded(value.maximumDerivedTuples,
      OH_PROJECTION_LIMITS_V1.derivedTuples, "maximumDerivedTuples"),
    maximumProofDepth: positiveBounded(value.maximumProofDepth,
      OH_PROJECTION_LIMITS_V1.proofDepth, "maximumProofDepth"),
    maximumProofNodes: positiveBounded(value.maximumProofNodes,
      OH_PROJECTION_LIMITS_V1.proofNodes, "maximumProofNodes"),
    maximumResultBytes: positiveBounded(value.maximumResultBytes,
      OH_PROJECTION_LIMITS_V1.resultBytes, "maximumResultBytes", 64 * 1024),
    maximumRounds: positiveBounded(value.maximumRounds,
      OH_PROJECTION_LIMITS_V1.rounds, "maximumRounds"),
    maximumTotalProofNodes: positiveBounded(value.maximumTotalProofNodes,
      OH_PROJECTION_LIMITS_V1.totalProofNodes, "maximumTotalProofNodes"),
    maximumWorkUnits: positiveBounded(value.maximumWorkUnits,
      OH_PROJECTION_LIMITS_V1.workUnits, "maximumWorkUnits"),
  });
}

function resolveProgramsV2(programs: readonly OhMemoryNamedProgramV2[]):
ReadonlyMap<string, ResolvedMemoryProgramV2> {
  if (!Array.isArray(programs) || programs.length < 1
    || programs.length > OH_MEMORY_LIMITS_V1.maximumPrograms) {
    throw new RangeError("Memory requires a bounded nonempty V2 named program registry.");
  }
  const resolved = new Map<string, ResolvedMemoryProgramV2>();
  for (const candidate of programs) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["evaluation", "maximumPageBytes",
      "maximumRows", "pageSize", "parameters", "programId", "purpose", "query", "rulePack", "v"])
      || candidate.v !== 2 || !Array.isArray(candidate.parameters)) {
      throw new TypeError("Invalid V2 named memory program.");
    }
    const programId = safeCode(candidate.programId, 128);
    const purpose = safeCode(candidate.purpose, 256);
    const query = parseOhProjectionQueryV1(candidate.query);
    const rulePack = parseOhProjectionRulePackV1(candidate.rulePack);
    const evaluation = resolveEvaluationV2(candidate.evaluation);
    const maximumRows = positiveBounded(candidate.maximumRows,
      OH_MEMORY_QUERY_LIMITS_V2.maximumProgramRows, "maximumRows");
    const pageSize = positiveBounded(candidate.pageSize,
      Math.min(maximumRows, OH_MEMORY_QUERY_LIMITS_V2.maximumPageRows), "pageSize");
    const maximumPageBytes = positiveBounded(candidate.maximumPageBytes,
      OH_MEMORY_QUERY_LIMITS_V2.maximumPageBytes, "maximumPageBytes",
      OH_MEMORY_QUERY_LIMITS_V2.minimumPageBytes);
    if (programId === null || purpose === null || query === null || rulePack === null
      || resolved.has(programId) || query.limit !== maximumRows
      || candidate.parameters.length > OH_MEMORY_QUERY_LIMITS_V2.bindings) {
      throw new TypeError("Invalid or duplicate V2 named memory program.");
    }
    const parameters = candidate.parameters.map((parameter) => safeCode(parameter, 128)).sort();
    if (parameters.some((parameter) => parameter === null)
      || new Set(parameters).size !== parameters.length) {
      throw new TypeError("A V2 memory program has invalid or duplicate parameters.");
    }
    const queryVariables = new Set(query.where.flatMap((literal) => literal.terms.flatMap((term) =>
      term.kind === "variable" ? [term.name] : [])));
    if ((parameters as readonly string[]).some((parameter) => !queryVariables.has(parameter)
      || query.find.includes(parameter))) {
      throw new TypeError("V2 parameters must be query-body variables that are not projected outputs.");
    }
    const detachedParameters = Object.freeze(parameters as string[]);
    const programPayload = {
      evaluation,
      maximumPageBytes,
      maximumRows,
      pageSize,
      parameters: detachedParameters,
      programId,
      purpose,
      querySha256: query.querySha256,
      rulePackSha256: rulePack.rulePackSha256,
      v: 2 as const,
    };
    const program = immutableClone({ evaluation, maximumPageBytes, maximumRows, pageSize,
      parameters: detachedParameters, programId, programSha256: canonicalSha256(programPayload),
      purpose, query, rulePack, v: 2 as const });
    resolved.set(programId, program);
  }
  return resolved;
}

function parsePrimitiveBindingV2(value: unknown): JsonPrimitive {
  if (value !== null && typeof value !== "boolean" && typeof value !== "number"
    && typeof value !== "string") throw new TypeError("Memory bindings must be JSON primitives.");
  if (typeof value === "string" && value.length > OH_PROJECTION_LIMITS_V1.atomBytes) {
    throw new RangeError("A memory binding exceeds the projection atom byte bound.");
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
    throw new TypeError("Memory bindings must be canonical finite JSON numbers.");
  }
  const serialized = canonicalJson(value);
  if (utf8ByteLength(serialized) > OH_PROJECTION_LIMITS_V1.atomBytes) {
    throw new RangeError("A memory binding exceeds the projection atom byte bound.");
  }
  return value as JsonPrimitive;
}

function parseQueryRequestV2(value: unknown): Readonly<{
  bindingsValue: Readonly<Record<string, JsonPrimitive>>;
  continuation: string | null;
  programId: string;
}> {
  let keys: readonly string[];
  try {
    keys = ownDataKeysV2(value, 4, "The parameterized memory query");
  } catch {
    throw new TypeError("Invalid parameterized memory query.");
  }
  if (keys.length !== 4 || !["bindings", "continuation", "programId", "v"]
    .every((key) => keys.includes(key))) {
    throw new TypeError("Invalid parameterized memory query.");
  }
  const record = value as Record<string, unknown>;
  if (record.v !== 2 || (record.continuation !== null
    && typeof record.continuation !== "string")) {
    throw new TypeError("Invalid parameterized memory query.");
  }
  const programId = safeCode(record.programId, 128);
  if (programId === null) throw new TypeError("Invalid parameterized memory query identity.");
  const continuation = record.continuation as string | null;
  if (typeof continuation === "string" && (continuation.length < 1
    || continuation.length > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes
    || utf8ByteLength(continuation) > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes)) {
    throw new RangeError("The memory continuation exceeds its byte bound.");
  }
  const bindingKeys = ownDataKeysV2(record.bindings, OH_MEMORY_QUERY_LIMITS_V2.bindings,
    "The parameterized memory query bindings");
  const bindingRecord = record.bindings as Record<string, unknown>;
  const bindings: Record<string, JsonPrimitive> = {};
  for (const key of bindingKeys) {
    if (safeCode(key, 128) === null) throw new TypeError("Invalid memory binding name.");
    bindings[key] = parsePrimitiveBindingV2(bindingRecord[key]);
  }
  const boundedRequest = { bindings, continuation, programId, v: 2 as const };
  if (utf8ByteLength(canonicalJson(boundedRequest)) > OH_MEMORY_QUERY_LIMITS_V2.requestBytes) {
    throw new RangeError("The parameterized memory query exceeds its canonical byte bound.");
  }
  return { bindingsValue: immutableClone(bindings), continuation, programId };
}

function parseBindingsV2(value: Readonly<Record<string, JsonPrimitive>>,
  parameters: readonly string[]): Readonly<{
  bindings: Readonly<Record<string, JsonPrimitive>>;
  bindingsSha256: Sha256Hex;
}> {
  if (!isPlainRecord(value) || !hasExactKeys(value, parameters)) {
    throw new TypeError("Memory query bindings must exactly match the host-declared parameters.");
  }
  const bindings: Record<string, JsonPrimitive> = {};
  for (const parameter of parameters) bindings[parameter] = value[parameter]!;
  if (utf8ByteLength(canonicalJson(bindings)) > OH_MEMORY_QUERY_LIMITS_V2.bindingBytes) {
    throw new RangeError("Memory query bindings exceed their canonical byte bound.");
  }
  const detached = immutableClone(bindings);
  return Object.freeze({ bindings: detached,
    bindingsSha256: canonicalSha256({ bindings: detached, parameters, v: 2 }) });
}

function bindQueryV2(query: OhProjectionQueryV1,
  bindings: Readonly<Record<string, JsonPrimitive>>): OhProjectionQueryV1 {
  const where = query.where.map((literal) => createOhProjectionLiteralV1({
    relation: literal.relation,
    terms: literal.terms.map((term) => term.kind === "variable" && Object.hasOwn(bindings, term.name)
      ? ohProjectionConstantV1(bindings[term.name]!) : term),
  }));
  return createOhProjectionQueryV1({ find: query.find, limit: query.limit,
    queryId: query.queryId, where });
}

function publicRowV2(row: OhProjectionResultRowV1,
  proofs: readonly OhMemoryProofV1[]): OhMemoryResultRowV2 {
  const lanes = new Set<OhMemoryLaneV1>();
  let unknown = row.proofsTruncated;
  for (const proof of proofs) unknown = collectLanes(proof, lanes) || unknown;
  const premiseLanes = [...lanes].sort() as readonly OhMemoryLaneV1[];
  const premiseAuthority: OhMemoryResultRowV2["premiseAuthority"] = unknown || premiseLanes.length === 0
    ? "unknown" : premiseLanes.includes("working") ? "working" : "canonical";
  const payload = { premiseAuthority, premiseLanes, proofsTruncated: row.proofsTruncated,
    supportCount: row.supportCount, v: 2 as const, values: row.values };
  return Object.freeze({ ...payload, resultRowSha256: canonicalSha256(payload) });
}

function continuationHmacV2(key: Uint8Array, value: OhMemoryContinuationV2): Buffer {
  return createHmac("sha256", key).update("oh.memory.continuation.v2\0", "utf8")
    .update(canonicalJson(value), "utf8").digest();
}

function encodeContinuationV2(value: OhMemoryContinuationIdentityV2,
  key: Uint8Array): Readonly<{ continuation: string; continuationSha256: Sha256Hex }> {
  const identity = immutableClone(value);
  const continuationSha256 = canonicalSha256(identity);
  const signed = immutableClone({ ...identity, continuationSha256 });
  const envelope: OhMemoryContinuationEnvelopeV2 = immutableClone({ ...signed,
    continuationHmacSha256: continuationHmacV2(key, signed).toString("hex") as Sha256Hex });
  const continuation = Buffer.from(canonicalJson(envelope), "utf8").toString("base64url");
  if (utf8ByteLength(continuation) > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes) {
    throw new RangeError("The issued memory continuation exceeds its byte bound.");
  }
  return Object.freeze({ continuation, continuationSha256 });
}

function parseContinuationV2(value: string, key: Uint8Array): OhMemoryContinuationV2 {
  if (value.length < 1 || utf8ByteLength(value) > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes
    || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError("Invalid memory continuation encoding.");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value
    || bytes.byteLength > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes) {
    throw new TypeError("Invalid memory continuation encoding.");
  }
  const text = bytes.toString("utf8");
  let decoded: unknown;
  try { decoded = JSON.parse(text); } catch { throw new TypeError("Invalid memory continuation JSON."); }
  if (!isPlainRecord(decoded)
    || !hasExactKeys(decoded, ["bindingsSha256", "continuationHmacSha256", "continuationSha256",
      "memorySha256", "nextOffset", "pageSize", "programSha256", "projectionResultSha256",
      "totalRows", "v"])
    || decoded.v !== 2) throw new TypeError("Invalid memory continuation payload.");
  const bindingsSha256 = parseSha256Hex(decoded.bindingsSha256);
  const continuationHmacSha256 = parseSha256Hex(decoded.continuationHmacSha256);
  const continuationSha256 = parseSha256Hex(decoded.continuationSha256);
  const memorySha256 = parseSha256Hex(decoded.memorySha256);
  const programSha256 = parseSha256Hex(decoded.programSha256);
  const projectionResultSha256 = parseSha256Hex(decoded.projectionResultSha256);
  if (bindingsSha256 === null || continuationHmacSha256 === null
    || continuationSha256 === null || memorySha256 === null || programSha256 === null
    || projectionResultSha256 === null
    || !Number.isSafeInteger(decoded.nextOffset) || (decoded.nextOffset as number) < 1
    || (decoded.nextOffset as number) > OH_MEMORY_QUERY_LIMITS_V2.maximumProgramRows
    || !Number.isSafeInteger(decoded.pageSize) || (decoded.pageSize as number) < 1
    || (decoded.pageSize as number) > OH_MEMORY_QUERY_LIMITS_V2.maximumPageRows
    || !Number.isSafeInteger(decoded.totalRows) || (decoded.totalRows as number) < 1
    || (decoded.totalRows as number) > OH_MEMORY_QUERY_LIMITS_V2.maximumProgramRows
    || (decoded.nextOffset as number) >= (decoded.totalRows as number)
    || (decoded.nextOffset as number) % (decoded.pageSize as number) !== 0) {
    throw new TypeError("Invalid memory continuation identity.");
  }
  const identity: OhMemoryContinuationIdentityV2 = { bindingsSha256, memorySha256,
    nextOffset: decoded.nextOffset as number,
    pageSize: decoded.pageSize as number, programSha256, projectionResultSha256,
    totalRows: decoded.totalRows as number, v: 2 as const };
  const signed: OhMemoryContinuationV2 = { ...identity, continuationSha256 };
  const envelope: OhMemoryContinuationEnvelopeV2 = { ...signed, continuationHmacSha256 };
  if (canonicalJson(envelope) !== text) throw new TypeError("Invalid memory continuation payload.");
  const expectedHmac = continuationHmacV2(key, signed);
  const receivedHmac = Buffer.from(continuationHmacSha256, "hex");
  if (!timingSafeEqual(expectedHmac, receivedHmac)) {
    throw new OhIntegrityError("The memory continuation is not an issued capability.");
  }
  if (canonicalSha256(identity) !== continuationSha256) {
    throw new OhIntegrityError("The memory continuation digest is invalid.");
  }
  return Object.freeze(signed);
}

function parseExplainRequestV2(value: unknown): Readonly<{
  pageRow: number;
  resultSha256: Sha256Hex;
  token: string;
}> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["pageRow", "resultSha256", "token", "v"])
    || value.v !== 2 || typeof value.token !== "string" || value.token.length !== 43
    || !Number.isSafeInteger(value.pageRow) || (value.pageRow as number) < 0) {
    throw new TypeError("Invalid V2 memory explanation request.");
  }
  const resultSha256 = parseSha256Hex(value.resultSha256);
  if (resultSha256 === null) throw new TypeError("Invalid V2 memory explanation result identity.");
  return { pageRow: value.pageRow as number, resultSha256, token: value.token };
}

/**
 * Creates the additive V2 memory facade. V2 adds only host-declared primitive
 * bindings and fail-closed stable pagination; V1 request and digest contracts
 * remain untouched.
 */
export async function createOhMemoryAgentV2(options: OhMemoryFacadeOptionsV2): Promise<OhMemoryAgentV2> {
  const memoryActorId = safeCode(options.actorId, 128);
  if (memoryActorId === null) throw new TypeError("Invalid host-bound memory actor ID.");
  const continuationKey = continuationKeyV2(options.continuationKey);
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
  const programs = resolveProgramsV2(options.programs);
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
  const explanations = new Map<string, StoredExplanationV2>();
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

  const query = async (value: unknown): Promise<OhMemoryQueryResultV2> => {
    const request = parseQueryRequestV2(value);
    const program = programs.get(request.programId);
    if (program === undefined) throw new TypeError("Unknown named V2 memory program.");
    const bound = parseBindingsV2(request.bindingsValue, program.parameters);
    const requestedContinuation = request.continuation === null
      ? null : parseContinuationV2(request.continuation, continuationKey);
    if (requestedContinuation !== null
      && (requestedContinuation.bindingsSha256 !== bound.bindingsSha256
        || requestedContinuation.pageSize !== program.pageSize
        || requestedContinuation.programSha256 !== program.programSha256
        || requestedContinuation.totalRows > program.maximumRows
        || requestedContinuation.nextOffset >= requestedContinuation.totalRows
        || requestedContinuation.nextOffset % program.pageSize !== 0)) {
      throw new OhIntegrityError("The memory continuation does not match this exact program, binding, and page identity.");
    }
    const boundQuery = bindQueryV2(program.query, bound.bindings);
    const working = await readLane({ authorityId: workingAuthorityId,
      binding: workingBinding, store: workingStore }, "working");
    const composite = createCompositeDataset(canonical, working, extractors);
    const projection = evaluateOhProjectionV1({ dataset: composite.dataset,
      options: program.evaluation, query: boundQuery, rulePack: program.rulePack,
      snapshot: composite.snapshot });
    if (projection.stats.truncated) {
      const reasons = projection.stats.truncationReasons.join(", ");
      throw new RangeError(`The V2 memory projection was truncated (${reasons}); no page was returned.`);
    }
    if (projection.rows.length > program.maximumRows) {
      throw new RangeError("The V2 memory projection exceeds its host-declared row bound.");
    }
    const identityPayload = {
      bindings: bound.bindings,
      bindingsSha256: bound.bindingsSha256,
      boundQuerySha256: boundQuery.querySha256,
      canonical: laneIdentity(canonical),
      compositeDatasetSha256: composite.dataset.datasetSha256,
      conflictPolicy: OH_MEMORY_CONFLICT_POLICY_V1,
      evaluationSha256: projection.identity.evaluationSha256,
      programId: program.programId,
      programSha256: program.programSha256,
      projectionSha256: projection.identity.projectionSha256,
      purpose: program.purpose,
      rulePackSha256: program.rulePack.rulePackSha256,
      templateQuerySha256: program.query.querySha256,
      v: 2 as const,
      working: laneIdentity(working),
    };
    const identity: OhMemoryIdentityV2 = immutableClone({ ...identityPayload,
      memorySha256: canonicalSha256(identityPayload) });
    if (requestedContinuation !== null
      && (requestedContinuation.memorySha256 !== identity.memorySha256
        || requestedContinuation.projectionResultSha256 !== projection.resultSha256)) {
      throw new OhIntegrityError("The memory continuation does not match this exact source and projection identity.");
    }
    if (requestedContinuation !== null
      && (requestedContinuation.totalRows !== projection.rows.length
        || requestedContinuation.nextOffset >= projection.rows.length
        || requestedContinuation.nextOffset % program.pageSize !== 0)) {
      throw new OhIntegrityError("The memory continuation does not match this exact row identity.");
    }
    const start = requestedContinuation?.nextOffset ?? 0;
    const endExclusive = Math.min(start + program.pageSize, projection.rows.length);
    const projectionRows = projection.rows.slice(start, endExclusive);
    const proofs = immutableClone(projectionRows.map((row) => row.proofs.map((proof) =>
      mapProof(proof, composite.sources, composite.factPolicies))));
    const rows = immutableClone(projectionRows.map((row, index) => publicRowV2(row, proofs[index]!)));
    const hasMore = endExclusive < projection.rows.length;
    const page: OhMemoryPageV2 = immutableClone({ completeness: hasMore ? "partial" : "complete",
      endExclusive, hasMore, maximumPageBytes: program.maximumPageBytes, pageSize: program.pageSize,
      returnedRows: rows.length, start, totalRows: projection.rows.length,
      truncation: { reasons: [], truncated: false, v: 2 as const }, v: 2 as const });
    const issuedContinuation = hasMore ? encodeContinuationV2({ bindingsSha256: bound.bindingsSha256,
      memorySha256: identity.memorySha256, nextOffset: endExclusive, pageSize: program.pageSize,
      programSha256: program.programSha256, projectionResultSha256: projection.resultSha256,
      totalRows: projection.rows.length, v: 2 }, continuationKey) : null;
    const continuation = issuedContinuation?.continuation ?? null;
    const continuationSha256 = issuedContinuation?.continuationSha256 ?? null;
    const conflicts = immutableClone({ count: composite.conflicts.length,
      conflictsSha256: canonicalSha256(composite.conflicts), v: 2 as const });
    const resultIdentityPayload = immutableClone({ authority: "derived" as const, conflicts,
      continuationSha256,
      identity, page, projectionResultSha256: projection.resultSha256, rows, v: 2 as const });
    const resultSha256 = canonicalSha256(resultIdentityPayload);
    const resultPayload = immutableClone({ ...resultIdentityPayload, continuation });
    const issuedAt = wallClock();
    const issuedAtMonotonic = monotonicClock();
    const expiresAtMs = issuedAt + capabilityLifetime;
    const expiresAtMonotonicMs = issuedAtMonotonic + capabilityLifetime;
    const expiresAt = isoInstant(new Date(expiresAtMs));
    const pageBytePreflight = { ...resultPayload,
      explainCapability: { expiresAt, token: "A".repeat(43), v: 2 as const }, resultSha256 };
    if (utf8ByteLength(canonicalJson(pageBytePreflight)) > program.maximumPageBytes) {
      throw new RangeError("The V2 memory page exceeds its host-declared canonical byte bound.");
    }
    for (const [existingToken, stored] of explanations) {
      if (issuedAtMonotonic >= stored.expiresAtMonotonicMs) deleteExplanation(existingToken);
    }
    const storedPayload = immutableClone({ expiresAtMonotonicMs, identity, page, proofs,
      resultSha256, rows });
    const storedBytes = utf8ByteLength(canonicalJson(storedPayload)) + 128;
    if (storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityEntryBytes
      || storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      throw new RangeError("The V2 memory explanation exceeds its retained capability bound.");
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
      explainCapability: { expiresAt, token, v: 2 as const }, resultSha256 });
    if (utf8ByteLength(canonicalJson(result)) > program.maximumPageBytes) {
      deleteExplanation(token);
      throw new RangeError("The V2 memory page exceeds its host-declared canonical byte bound.");
    }
    return result;
  };

  const explain = async (value: unknown): Promise<OhMemoryExplanationV2> => {
    const request = parseExplainRequestV2(value);
    const stored = explanations.get(request.token);
    const currentTime = monotonicClock();
    if (stored === undefined || stored.resultSha256 !== request.resultSha256
      || currentTime >= stored.expiresAtMonotonicMs) {
      deleteExplanation(request.token);
      throw new OhProfileError("The V2 memory explanation capability is absent, expired, or misbound.");
    }
    const row = stored.rows[request.pageRow];
    const proofs = stored.proofs[request.pageRow];
    if (row === undefined || proofs === undefined) throw new RangeError("The explanation page row is out of bounds.");
    const payload = { authority: "derived" as const, identity: stored.identity, page: stored.page,
      pageRow: request.pageRow, premiseAuthority: row.premiseAuthority,
      premiseLanes: row.premiseLanes, proofs, proofsTruncated: row.proofsTruncated,
      resultRowSha256: row.resultRowSha256, resultSha256: stored.resultSha256,
      supportCount: row.supportCount, v: 2 as const, values: row.values };
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
