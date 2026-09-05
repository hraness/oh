import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";

export * from "./memory-pages";

import {
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  orderedUnique,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  utf8ByteLength,
  type JsonPrimitive,
  type Sha256Hex,
} from "./canonical";
import { type OhRecordCodecRegistry } from "./contract";
import {
  canonicalKnowledgeGraphChangesV1,
  createKnowledgeGraphRecordV1,
  knowledgeGraphRecordRefV1,
  type KnowledgeGraphChangeV1,
  type KnowledgeGraphRecordV1,
} from "./graph";
import { parseOhOperationV1 } from "./operation";
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
  OhConflictError,
  OhIntegrityError,
  OH_DEPENDENCY_CLOSURE_LIMITS_V1,
  OhProfileError,
  OhSemanticBundleIngressV1,
  parseOhDependencyClosureV1,
  parseOhHeadV1,
  parseOhHeadRefV1,
  parseOhStoreBindingV1,
  verifyOhDependencyClosureAgainstV1,
  type OhDependencyClosureV1,
  type OhHeadV1,
  type OhHeadRefV1,
  type OhSnapshotV1,
  type OhStoreBindingV1,
  type OhStoreV1,
} from "./store";
export const OH_MEMORY_FORMAT_VERSION_V1 = 1 as const;
export const OH_MEMORY_CONFLICT_POLICY_V1 = "visible-conflicts.v1" as const;
export const OH_MEMORY_LIMITS_V1 = Object.freeze({
  detachedCanonicalBreadth: 65_536,
  detachedCanonicalDepth: 128,
  detachedCanonicalNodes: 1_048_576,
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

/** Additive query and pagination limits; V1 contracts are unchanged. */
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

export type OhMemoryContinuationErrorReasonV2 = "authentication" | "encoding" | "identity";

/** A caller-supplied V2 continuation cannot be decoded, authenticated, or rebound exactly. */
export class OhMemoryContinuationError extends OhIntegrityError {
  declare readonly code: "memory-continuation";
  declare readonly reason: OhMemoryContinuationErrorReasonV2;

  constructor(reason: OhMemoryContinuationErrorReasonV2, message: string) {
    super(message);
    this.name = "OhMemoryContinuationError";
    Object.defineProperties(this, {
      code: { configurable: false, enumerable: true, value: "memory-continuation", writable: false },
      reason: { configurable: false, enumerable: true, value: reason, writable: false },
    });
  }
}

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

export const OH_MEMORY_AUTHORITY_LIMITS_V1 = Object.freeze({
  adoptionReplacements: 128,
  adoptionRequestBytes: OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes + 192 * 1024,
  canonicalAdvanceOperations: 16_384,
  canonicalAdvancePages: 64,
  canonicalChangeFeedPage: 1_000,
  canonicalChangeFeedPageBytes: 64 * 1024 * 1024,
  retainedExplanationRoutes: OH_MEMORY_LIMITS_V1.explainCapabilities,
  reportedAdoptionConflicts: 128,
});

export type OhMemoryCanonicalAdvanceReceiptV1 = Readonly<{
  authorityId: string;
  bindingSha256: Sha256Hex;
  head: OhHeadV1;
  priorHead: OhHeadV1;
  receiptSha256: Sha256Hex;
  status: "advanced" | "unchanged";
  v: 1;
}>;

export type OhMemoryAdoptionConflictEntryV1 = Readonly<{
  canonicalRecordSha256: Sha256Hex | null;
  key: string;
  nominatedRecordSha256: Sha256Hex;
  v: 1;
}>;

/** Host-only compare-and-swap evidence for one intentional canonical replacement. */
export type OhMemoryAdoptionReplacementV1 = Readonly<{
  expectedPriorRecordSha256: Sha256Hex;
  key: string;
  v: 1;
}>;

export type OhMemoryAdoptionConflictV1 = Readonly<{
  actualHead: OhHeadV1;
  conflicts: readonly OhMemoryAdoptionConflictEntryV1[];
  conflictsSha256: Sha256Hex;
  expectedHead: OhHeadV1;
  reportedConflicts: number;
  totalConflicts: number;
  truncated: boolean;
  v: 1;
}>;

export class OhMemoryAdoptionConflictError extends OhConflictError {
  declare readonly conflict: OhMemoryAdoptionConflictV1;

  constructor(conflict: OhMemoryAdoptionConflictV1) {
    super("The nominated records conflict with the current canonical memory head.");
    this.name = "OhMemoryAdoptionConflictError";
    Object.defineProperty(this, "conflict", { configurable: false, enumerable: true,
      value: immutableClone(conflict), writable: false });
  }
}

export type OhMemoryAdoptionReceiptV1 = Readonly<{
  actorId: string;
  authorityId: string;
  bindingSha256: Sha256Hex;
  head: OhHeadV1;
  nominationSha256: Sha256Hex;
  operationSha256: Sha256Hex | null;
  priorHead: OhHeadV1;
  receiptSha256: Sha256Hex;
  status: "adopted" | "already-present";
  v: 1;
}>;

export interface OhMemoryHostControlV1 {
  adoptNomination(value: unknown): Promise<OhMemoryAdoptionReceiptV1>;
  advanceCanonical(value: unknown): Promise<OhMemoryCanonicalAdvanceReceiptV1>;
}

export type OhMemoryAuthorityV1 = Readonly<{
  agent: OhMemoryAgentV2;
  host: OhMemoryHostControlV1;
}>;

export type OhMemoryAuthorityOptionsV1 = OhMemoryFacadeOptionsV2 & Readonly<{
  adoptionActorId: string;
}>;

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

type DetachedCanonicalData = Readonly<{
  canonical: string;
  value: unknown;
}>;

function canonicalStringByteLength(
  value: string,
  label: string,
  path: string,
  maximumBytes: number,
): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} contains invalid Unicode at ${path}.`);
      }
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${label} contains invalid Unicode at ${path}.`);
    } else if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
      || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
    if (bytes > maximumBytes) {
      throw new RangeError(`${label} exceeds its canonical byte bound.`);
    }
  }
  return bytes;
}

/**
 * Takes one descriptor-based JSON snapshot of an external value. No accessor is
 * invoked, proxies are refused at every depth, and callers validate and execute
 * only the returned frozen graph and its matching canonical bytes.
 */
function detachCanonicalData(
  value: unknown,
  label: string,
  maximumBytes: number,
): DetachedCanonicalData {
  const ancestors = new Set<object>();
  let bytes = 0;
  let nodes = 0;
  const spendBytes = (count: number): void => {
    bytes += count;
    if (bytes > maximumBytes) throw new RangeError(`${label} exceeds its canonical byte bound.`);
  };
  const detach = (candidate: unknown, path: string, depth: number): unknown => {
    if (depth > OH_MEMORY_LIMITS_V1.detachedCanonicalDepth) {
      throw new RangeError(`${label} exceeds its canonical nesting depth bound.`);
    }
    nodes += 1;
    if (nodes > OH_MEMORY_LIMITS_V1.detachedCanonicalNodes) {
      throw new RangeError(`${label} exceeds its canonical node bound.`);
    }
    if (candidate === null) {
      spendBytes(4);
      return candidate;
    }
    if (typeof candidate === "boolean") {
      spendBytes(candidate ? 4 : 5);
      return candidate;
    }
    if (typeof candidate === "string") {
      spendBytes(canonicalStringByteLength(candidate, label, path, maximumBytes - bytes));
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) {
        throw new TypeError(`${label} contains a noncanonical number at ${path}.`);
      }
      spendBytes(utf8ByteLength(canonicalJson(candidate)));
      return candidate;
    }
    if (typeof candidate !== "object") {
      throw new TypeError(`${label} contains a non-JSON value at ${path}.`);
    }
    if (isProxy(candidate)) throw new TypeError(`${label} contains a proxy at ${path}.`);
    if (ancestors.has(candidate)) throw new TypeError(`${label} contains a cycle at ${path}.`);
    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, "length");
        const length = lengthDescriptor?.value;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
          throw new TypeError(`${label} contains an invalid array at ${path}.`);
        }
        if (length > OH_MEMORY_LIMITS_V1.detachedCanonicalBreadth) {
          throw new RangeError(`${label} exceeds its canonical breadth bound.`);
        }
        if (length > OH_MEMORY_LIMITS_V1.detachedCanonicalNodes - nodes) {
          throw new RangeError(`${label} exceeds its canonical node bound.`);
        }
        spendBytes(2 + Math.max(0, length - 1));
        const keys = Reflect.ownKeys(candidate);
        if (keys.length !== length + 1 || !keys.includes("length")
          || keys.some((key) => key !== "length" && (typeof key !== "string"
            || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) {
          throw new TypeError(`${label} contains a non-data array at ${path}.`);
        }
        const detached: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (descriptor === undefined || !descriptor.enumerable
            || descriptor.get !== undefined || descriptor.set !== undefined) {
            throw new TypeError(`${label} contains a non-data array entry at ${path}[${index}].`);
          }
          detached.push(detach(descriptor.value, `${path}[${index}]`, depth + 1));
        }
        return Object.freeze(detached);
      }
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} contains a non-plain object at ${path}.`);
      }
      const keys = Reflect.ownKeys(candidate);
      if (keys.some((key) => typeof key !== "string")) {
        throw new TypeError(`${label} contains a symbol property at ${path}.`);
      }
      if (keys.length > OH_MEMORY_LIMITS_V1.detachedCanonicalBreadth) {
        throw new RangeError(`${label} exceeds its canonical breadth bound.`);
      }
      if (keys.length > OH_MEMORY_LIMITS_V1.detachedCanonicalNodes - nodes) {
        throw new RangeError(`${label} exceeds its canonical node bound.`);
      }
      spendBytes(2 + Math.max(0, keys.length - 1));
      const detached: Record<string, unknown> = {};
      for (const key of keys as string[]) {
        spendBytes(canonicalStringByteLength(key, label, `${path}.<key>`,
          maximumBytes - bytes - 1) + 1);
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (descriptor === undefined || !descriptor.enumerable
          || descriptor.get !== undefined || descriptor.set !== undefined) {
          throw new TypeError(`${label} contains a non-data property at ${path}.${key}.`);
        }
        Object.defineProperty(detached, key, { configurable: false, enumerable: true,
          value: detach(descriptor.value, `${path}.${key}`, depth + 1), writable: false });
      }
      return Object.freeze(detached);
    } finally {
      ancestors.delete(candidate);
    }
  };
  const detached = detach(value, "$root", 0);
  const canonical = canonicalJson(detached);
  if (utf8ByteLength(canonical) !== bytes) {
    throw new OhIntegrityError(`${label} canonical byte accounting did not reproduce its snapshot.`);
  }
  return Object.freeze({ canonical, value: detached });
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

function parseDetachedStoreHead(value: unknown, label: string): OhHeadV1 {
  const head = parseOhHeadV1(detachCanonicalData(value, `${label} head`, 4 * 1024).value);
  if (head === null) throw new OhIntegrityError(`${label} returned an invalid head.`);
  return immutableClone(head);
}

function parseDetachedStoreSnapshot(
  value: unknown,
  label: string,
  expectedHead: OhHeadV1,
  spaceId: string,
): Readonly<{ projectionSnapshot: OhProjectionSnapshotV1; snapshot: OhSnapshotV1 }> {
  const detachedSnapshot = detachCanonicalData(value, `${label} snapshot`,
    OH_MEMORY_LIMITS_V1.snapshotBytesPerLane);
  if (!isPlainRecord(detachedSnapshot.value)
    || !hasExactKeys(detachedSnapshot.value, ["head", "records", "v"])
    || detachedSnapshot.value.v !== 1 || !Array.isArray(detachedSnapshot.value.records)) {
    throw new OhIntegrityError(`${label} returned an invalid snapshot envelope.`);
  }
  const detached = detachedSnapshot.value as Record<string, unknown>;
  const detachedHead = parseOhHeadV1(detached.head);
  if (detachedHead === null) throw new OhIntegrityError(`${label} returned an invalid snapshot head.`);
  const snapshot: OhSnapshotV1 = immutableClone({ head: detachedHead,
    records: detached.records as OhSnapshotV1["records"], v: 1 });
  if (!exactHead(snapshot.head, expectedHead)) {
    throw new OhIntegrityError(`${label} snapshot differs from its pinned head.`);
  }
  let projectionSnapshot: OhProjectionSnapshotV1;
  try {
    projectionSnapshot = createOhProjectionSnapshotV1({
      head: snapshot.head,
      records: snapshot.records,
      spaceId,
    });
  } catch {
    throw new OhIntegrityError(`${label} returned invalid snapshot records.`);
  }
  return Object.freeze({ projectionSnapshot, snapshot });
}

function datasetForSnapshot(
  binding: OhStoreBindingV1,
  snapshot: OhSnapshotV1,
  validatedProjectionSnapshot?: OhProjectionSnapshotV1,
): Readonly<{
  dataset: OhProjectionDatasetV1;
  projectionSnapshot: OhProjectionSnapshotV1;
}> {
  const projectionSnapshot = validatedProjectionSnapshot ?? createOhProjectionSnapshotV1({
    head: snapshot.head, records: snapshot.records, spaceId: binding.spaceId });
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
  const label = `The ${lane} store`;
  const head = expectedHead === undefined
    ? parseDetachedStoreHead(await authority.store.head(), label)
    : immutableClone(expectedHead);
  const returnedSnapshot = await authority.store.snapshot({
    head: { operationSha256: head.operationSha256, sequence: head.sequence },
    maximumRecords: OH_MEMORY_LIMITS_V1.maximumRecordsPerLane,
  });
  const parsed = parseDetachedStoreSnapshot(returnedSnapshot, label, head,
    authority.binding.spaceId);
  const projected = datasetForSnapshot(authority.binding, parsed.snapshot,
    parsed.projectionSnapshot);
  return Object.freeze({ authorityId: authority.authorityId, binding: authority.binding,
    dataset: projected.dataset, lane, projectionSnapshot: projected.projectionSnapshot,
    snapshot: parsed.snapshot });
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
  const detached = detachCanonicalData(value, "The named memory query",
    OH_MEMORY_QUERY_LIMITS_V2.requestBytes).value;
  if (!isPlainRecord(detached) || !hasExactKeys(detached, ["programId", "v"])
    || detached.v !== 1) throw new TypeError("Invalid named memory query.");
  const programId = safeCode(detached.programId, 128);
  if (programId === null) throw new TypeError("Invalid named memory query identity.");
  return { programId };
}

function parseExplainRequest(value: unknown): Readonly<{
  row: number;
  resultSha256: Sha256Hex;
  token: string;
}> {
  const detached = detachCanonicalData(value, "The memory explanation request",
    OH_MEMORY_QUERY_LIMITS_V2.requestBytes).value;
  if (!isPlainRecord(detached)
    || !hasExactKeys(detached, ["resultSha256", "row", "token", "v"])
    || detached.v !== 1 || typeof detached.token !== "string" || detached.token.length !== 43
    || !Number.isSafeInteger(detached.row) || (detached.row as number) < 0) {
    throw new TypeError("Invalid memory explanation request.");
  }
  const resultSha256 = parseSha256Hex(detached.resultSha256);
  if (resultSha256 === null) throw new TypeError("Invalid memory explanation result identity.");
  return { resultSha256, row: detached.row as number, token: detached.token };
}

function parseNominationRequest(value: unknown): Readonly<{
  nominationId: string;
  roots: readonly string[];
}> {
  const detached = detachCanonicalData(value, "The memory nomination request",
    OH_MEMORY_QUERY_LIMITS_V2.requestBytes * 8).value;
  if (!isPlainRecord(detached) || !hasExactKeys(detached, ["nominationId", "roots", "v"])
    || detached.v !== 1 || !Array.isArray(detached.roots) || detached.roots.length < 1
    || detached.roots.length > OH_DEPENDENCY_CLOSURE_LIMITS_V1.roots) {
    throw new TypeError("Invalid memory nomination request.");
  }
  const nominationId = safeCode(detached.nominationId, 128);
  const roots = detached.roots.map((root) => safeCode(root, 512)).sort();
  if (nominationId === null || roots.some((root) => root === null)
    || new Set(roots).size !== roots.length) throw new TypeError("Invalid memory nomination identity.");
  return { nominationId, roots: roots as readonly string[] };
}

function parseDetachedMemoryNominationV1(value: unknown): OhMemoryNominationV1 | null {
  try {
    const keys = ownDataKeysV2(value, 7, "The memory nomination");
    if (keys.length !== 7 || !["closure", "destinationPurpose", "nominationId",
      "nominationSha256", "source", "status", "v"].every((key) => keys.includes(key))) return null;
    const record = value as Record<string, unknown>;
    if (record.status !== "prepared" || record.v !== 1) return null;
    const closure = parseOhDependencyClosureV1(record.closure);
    const destinationPurpose = safeCode(record.destinationPurpose, 256);
    const nominationId = safeCode(record.nominationId, 128);
    const nominationSha256 = parseSha256Hex(record.nominationSha256);
    if (closure === null || destinationPurpose === null || nominationId === null
      || nominationSha256 === null || closure.binding.profile.profileKind !== "working"
      || [...ownDataKeysV2(record.source, 5, "The memory nomination source")].sort().join("\0")
        !== ["authorityId", "bindingSha256", "head", "lane", "v"].sort().join("\0")) return null;
    const sourceRecord = record.source as Record<string, unknown>;
    if (sourceRecord.lane !== "working" || sourceRecord.v !== 1) return null;
    const authorityIdValue = safeCode(sourceRecord.authorityId, 128);
    const bindingSha256 = parseSha256Hex(sourceRecord.bindingSha256);
    const head = parseOhHeadV1(sourceRecord.head);
    if (authorityIdValue === null || bindingSha256 === null || head === null
      || bindingSha256 !== closure.binding.bindingSha256
      || !exactHead(head, closure.head)) return null;
    const source = { authorityId: authorityIdValue, bindingSha256, head,
      lane: "working" as const, v: 1 as const };
    const payload = { closure, destinationPurpose, nominationId, source,
      status: "prepared" as const, v: 1 as const };
    return canonicalSha256(payload) === nominationSha256
      ? immutableClone({ ...payload, nominationSha256 }) : null;
  } catch {
    return null;
  }
}

export function parseOhMemoryNominationV1(value: unknown): OhMemoryNominationV1 | null {
  try {
    const detached = detachCanonicalData(value, "The memory nomination",
      OH_MEMORY_AUTHORITY_LIMITS_V1.adoptionRequestBytes);
    return parseDetachedMemoryNominationV1(detached.value);
  } catch {
    return null;
  }
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
  const expectedCanonicalHead = parseMemoryAuthorityHead(options.canonical.expectedHead,
    "pinned canonical");
  const programs = resolvePrograms(options.programs);
  const extractors = resolveExtractors(options.extractors ?? []);
  const nominationRoutes = resolveNominationRoutes(options.nominationRoutes ?? []);
  const ingress = new OhSemanticBundleIngressV1(
    capacityGuardedWorkingStore(workingStore, workingBinding),
    workingCodecs,
  );
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
    const detached = detachCanonicalData(value, "The memory semantic bundle",
      OH_MEMORY_LIMITS_V1.rememberBytes).value;
    if (!isPlainRecord(detached) || !hasExactKeys(detached,
      ["expectedHead", "puts", "requestId", "tombstones", "v"]) || detached.v !== 1) {
      throw new TypeError("Invalid memory remember request.");
    }
    const requestId = safeCode(detached.requestId, 128);
    if (requestId === null) throw new TypeError("Invalid memory remember request identity.");
    const operationId = `memory_${canonicalSha256({ actorId: memoryActorId,
      bindingSha256: workingBinding.bindingSha256, requestId, v: 1 }).slice(0, 48)}`;
    const returnedOperation = await ingress.commit({ actorId: memoryActorId,
      expectedHead: detached.expectedHead, instant: isoInstant(new Date(wallClock())), operationId,
      puts: detached.puts, tombstones: detached.tombstones, v: 1 });
    const operation = parseOhOperationV1(detachCanonicalData(returnedOperation,
      "The returned working memory operation", OH_MEMORY_LIMITS_V1.rememberBytes * 2).value);
    if (operation === null || operation.actorId !== memoryActorId
      || operation.operationId !== operationId || operation.spaceId !== workingBinding.spaceId) {
      throw new OhIntegrityError("The working authority returned a different memory operation.");
    }
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
    const head = parseOhHeadV1(detachCanonicalData(await workingStore.head(),
      "The working nomination store head", 4 * 1024).value);
    if (head === null) throw new OhIntegrityError("The working nomination store returned an invalid head.");
    const returnedClosure = await workingStore.exportDependencyClosure({ head: {
      operationSha256: head.operationSha256, sequence: head.sequence }, roots: request.roots });
    const closure = detachCanonicalData(returnedClosure, "The working nomination closure",
      OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes).value;
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

type OhMemoryRuntimeV2 = {
  readonly capabilityLifetime: number;
  explanationBytes: number;
  readonly explanations: Map<string, StoredExplanationV2>;
  lastMonotonicMs: number;
  lastWallClockMs: number;
  readonly monotonicNow: () => number;
  readonly now: () => Date;
};

function createOhMemoryRuntimeV2(options: OhMemoryFacadeOptionsV2): OhMemoryRuntimeV2 {
  const capabilityLifetime = options.explainCapabilityLifetimeMs
    ?? OH_MEMORY_LIMITS_V1.explainCapabilityLifetimeMs;
  if (!Number.isSafeInteger(capabilityLifetime) || capabilityLifetime < 1_000
    || capabilityLifetime > 60 * 60 * 1_000) {
    throw new RangeError("Invalid memory explanation capability lifetime.");
  }
  return {
    capabilityLifetime,
    explanationBytes: 0,
    explanations: new Map<string, StoredExplanationV2>(),
    lastMonotonicMs: -1,
    lastWallClockMs: Number.NEGATIVE_INFINITY,
    monotonicNow: options.monotonicNow ?? (() => performance.now()),
    now: options.now ?? (() => new Date()),
  };
}

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
  let detached: unknown;
  let detachedCanonical = "";
  let keys: readonly string[];
  try {
    const detachedData = detachCanonicalData(value, "The parameterized memory query",
      OH_MEMORY_QUERY_LIMITS_V2.requestBytes);
    detached = detachedData.value;
    detachedCanonical = detachedData.canonical;
  } catch (error) {
    if (error instanceof RangeError) throw error;
    if (error instanceof Error && error.message.includes("$root.bindings")) {
      throw new TypeError("Memory bindings must be JSON primitives.");
    }
    throw new TypeError("Invalid parameterized memory query.");
  }
  try {
    keys = ownDataKeysV2(detached, 4, "The parameterized memory query");
  } catch (error) {
    if (error instanceof Error && error.message.includes("$root.bindings")) {
      throw new TypeError("Memory bindings must be JSON primitives.");
    }
    throw new TypeError("Invalid parameterized memory query.");
  }
  if (keys.length !== 4 || !["bindings", "continuation", "programId", "v"]
    .every((key) => keys.includes(key))) {
    throw new TypeError("Invalid parameterized memory query.");
  }
  if (utf8ByteLength(detachedCanonical) > OH_MEMORY_QUERY_LIMITS_V2.requestBytes) {
    throw new RangeError("The parameterized memory query exceeds its canonical byte bound.");
  }
  const record = detached as Record<string, unknown>;
  if (record.v !== 2) {
    throw new TypeError("Invalid parameterized memory query.");
  }
  if (record.continuation !== null && typeof record.continuation !== "string") {
    throw new OhMemoryContinuationError("encoding", "Invalid memory continuation encoding.");
  }
  const programId = safeCode(record.programId, 128);
  if (programId === null) throw new TypeError("Invalid parameterized memory query identity.");
  const continuation = record.continuation as string | null;
  if (typeof continuation === "string" && (continuation.length < 1
    || continuation.length > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes
    || utf8ByteLength(continuation) > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes)) {
    throw new OhMemoryContinuationError("encoding",
      "The memory continuation exceeds its byte bound.");
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
    || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new OhMemoryContinuationError("encoding", "Invalid memory continuation encoding.");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value
    || bytes.byteLength > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes) {
    throw new OhMemoryContinuationError("encoding", "Invalid memory continuation encoding.");
  }
  const text = bytes.toString("utf8");
  let decoded: unknown;
  try { decoded = JSON.parse(text); } catch {
    throw new OhMemoryContinuationError("encoding", "Invalid memory continuation JSON.");
  }
  if (!isPlainRecord(decoded)
    || !hasExactKeys(decoded, ["bindingsSha256", "continuationHmacSha256", "continuationSha256",
      "memorySha256", "nextOffset", "pageSize", "programSha256", "projectionResultSha256",
      "totalRows", "v"])
    || decoded.v !== 2) {
    throw new OhMemoryContinuationError("encoding", "Invalid memory continuation payload.");
  }
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
    throw new OhMemoryContinuationError("identity", "Invalid memory continuation identity.");
  }
  const identity: OhMemoryContinuationIdentityV2 = { bindingsSha256, memorySha256,
    nextOffset: decoded.nextOffset as number,
    pageSize: decoded.pageSize as number, programSha256, projectionResultSha256,
    totalRows: decoded.totalRows as number, v: 2 as const };
  const signed: OhMemoryContinuationV2 = { ...identity, continuationSha256 };
  const envelope: OhMemoryContinuationEnvelopeV2 = { ...signed, continuationHmacSha256 };
  if (canonicalJson(envelope) !== text) {
    throw new OhMemoryContinuationError("encoding", "Invalid memory continuation payload.");
  }
  const expectedHmac = continuationHmacV2(key, signed);
  const receivedHmac = Buffer.from(continuationHmacSha256, "hex");
  if (!timingSafeEqual(expectedHmac, receivedHmac)) {
    throw new OhMemoryContinuationError("authentication",
      "The memory continuation is not an issued capability.");
  }
  if (canonicalSha256(identity) !== continuationSha256) {
    throw new OhMemoryContinuationError("identity", "The memory continuation digest is invalid.");
  }
  return Object.freeze(signed);
}

function parseExplainRequestV2(value: unknown): Readonly<{
  pageRow: number;
  resultSha256: Sha256Hex;
  token: string;
}> {
  const detached = detachCanonicalData(value, "The V2 memory explanation request",
    OH_MEMORY_QUERY_LIMITS_V2.requestBytes).value;
  if (!isPlainRecord(detached)
    || !hasExactKeys(detached, ["pageRow", "resultSha256", "token", "v"])
    || detached.v !== 2 || typeof detached.token !== "string" || detached.token.length !== 43
    || !Number.isSafeInteger(detached.pageRow) || (detached.pageRow as number) < 0) {
    throw new TypeError("Invalid V2 memory explanation request.");
  }
  const resultSha256 = parseSha256Hex(detached.resultSha256);
  if (resultSha256 === null) throw new TypeError("Invalid V2 memory explanation result identity.");
  return { pageRow: detached.pageRow as number, resultSha256, token: detached.token };
}

/**
 * Creates the additive V2 memory facade. V2 adds only host-declared primitive
 * bindings and fail-closed stable pagination; V1 request and digest contracts
 * remain untouched.
 */
async function createOhMemoryAgentV2WithRuntime(
  options: OhMemoryFacadeOptionsV2,
  sharedRuntime?: OhMemoryRuntimeV2,
): Promise<OhMemoryAgentV2> {
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
  const expectedCanonicalHead = parseMemoryAuthorityHead(options.canonical.expectedHead,
    "pinned canonical");
  const programs = resolveProgramsV2(options.programs);
  const extractors = resolveExtractors(options.extractors ?? []);
  const nominationRoutes = resolveNominationRoutes(options.nominationRoutes ?? []);
  const ingress = new OhSemanticBundleIngressV1(
    capacityGuardedWorkingStore(workingStore, workingBinding),
    workingCodecs,
  );
  const runtime = sharedRuntime ?? createOhMemoryRuntimeV2(options);
  const canonical = await readLane({ authorityId: canonicalAuthorityId,
    binding: canonicalBinding, store: canonicalStore }, "canonical", expectedCanonicalHead);
  const wallClock = () => {
    const milliseconds = clockMilliseconds(runtime.now);
    if (milliseconds < runtime.lastWallClockMs) {
      throw new OhProfileError("The memory wall clock regressed.");
    }
    runtime.lastWallClockMs = milliseconds;
    return milliseconds;
  };
  const monotonicClock = () => {
    const milliseconds = monotonicMilliseconds(runtime.monotonicNow);
    if (milliseconds < runtime.lastMonotonicMs) {
      throw new OhProfileError("The memory monotonic clock regressed.");
    }
    runtime.lastMonotonicMs = milliseconds;
    return milliseconds;
  };
  const deleteExplanation = (token: string) => {
    const stored = runtime.explanations.get(token);
    if (stored !== undefined && runtime.explanations.delete(token)) {
      runtime.explanationBytes -= stored.bytes;
    }
  };

  const remember = async (value: unknown): Promise<OhMemoryRememberReceiptV1> => {
    const detached = detachCanonicalData(value, "The memory semantic bundle",
      OH_MEMORY_LIMITS_V1.rememberBytes).value;
    if (!isPlainRecord(detached) || !hasExactKeys(detached,
      ["expectedHead", "puts", "requestId", "tombstones", "v"]) || detached.v !== 1) {
      throw new TypeError("Invalid memory remember request.");
    }
    const requestId = safeCode(detached.requestId, 128);
    if (requestId === null) throw new TypeError("Invalid memory remember request identity.");
    const operationId = `memory_${canonicalSha256({ actorId: memoryActorId,
      bindingSha256: workingBinding.bindingSha256, requestId, v: 1 }).slice(0, 48)}`;
    const returnedOperation = await ingress.commit({ actorId: memoryActorId,
      expectedHead: detached.expectedHead, instant: isoInstant(new Date(wallClock())), operationId,
      puts: detached.puts, tombstones: detached.tombstones, v: 1 });
    const operation = parseOhOperationV1(detachCanonicalData(returnedOperation,
      "The returned working memory operation", OH_MEMORY_LIMITS_V1.rememberBytes * 2).value);
    if (operation === null || operation.actorId !== memoryActorId
      || operation.operationId !== operationId || operation.spaceId !== workingBinding.spaceId) {
      throw new OhIntegrityError("The working authority returned a different memory operation.");
    }
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
      throw new OhMemoryContinuationError("identity",
        "The memory continuation does not match this exact program, binding, and page identity.");
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
      throw new OhMemoryContinuationError("identity",
        "The memory continuation does not match this exact source and projection identity.");
    }
    if (requestedContinuation !== null
      && (requestedContinuation.totalRows !== projection.rows.length
        || requestedContinuation.nextOffset >= projection.rows.length
        || requestedContinuation.nextOffset % program.pageSize !== 0)) {
      throw new OhMemoryContinuationError("identity",
        "The memory continuation does not match this exact row identity.");
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
    const expiresAtMs = issuedAt + runtime.capabilityLifetime;
    const expiresAtMonotonicMs = issuedAtMonotonic + runtime.capabilityLifetime;
    const expiresAt = isoInstant(new Date(expiresAtMs));
    const pageBytePreflight = { ...resultPayload,
      explainCapability: { expiresAt, token: "A".repeat(43), v: 2 as const }, resultSha256 };
    if (utf8ByteLength(canonicalJson(pageBytePreflight)) > program.maximumPageBytes) {
      throw new RangeError("The V2 memory page exceeds its host-declared canonical byte bound.");
    }
    for (const [existingToken, stored] of runtime.explanations) {
      if (issuedAtMonotonic >= stored.expiresAtMonotonicMs) deleteExplanation(existingToken);
    }
    const storedPayload = immutableClone({ expiresAtMonotonicMs, identity, page, proofs,
      resultSha256, rows });
    const storedBytes = utf8ByteLength(canonicalJson(storedPayload)) + 128;
    if (storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityEntryBytes
      || storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      throw new RangeError("The V2 memory explanation exceeds its retained capability bound.");
    }
    while (runtime.explanations.size >= OH_MEMORY_LIMITS_V1.explainCapabilities
      || runtime.explanationBytes + storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      const oldest = runtime.explanations.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      deleteExplanation(oldest);
    }
    let token = randomBytes(32).toString("base64url");
    while (runtime.explanations.has(token)) token = randomBytes(32).toString("base64url");
    runtime.explanations.set(token, immutableClone({ ...storedPayload, bytes: storedBytes }));
    runtime.explanationBytes += storedBytes;
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
    const stored = runtime.explanations.get(request.token);
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
    const head = parseOhHeadV1(detachCanonicalData(await workingStore.head(),
      "The working nomination store head", 4 * 1024).value);
    if (head === null) throw new OhIntegrityError("The working nomination store returned an invalid head.");
    const returnedClosure = await workingStore.exportDependencyClosure({ head: {
      operationSha256: head.operationSha256, sequence: head.sequence }, roots: request.roots });
    const closure = detachCanonicalData(returnedClosure, "The working nomination closure",
      OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes).value;
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

export async function createOhMemoryAgentV2(
  options: OhMemoryFacadeOptionsV2,
): Promise<OhMemoryAgentV2> {
  return await createOhMemoryAgentV2WithRuntime(options);
}

function parseDetachedMemoryAuthorityHead(value: unknown, label: string): OhHeadV1 {
  const head = parseOhHeadV1(value);
  if (head === null) throw new TypeError(`Invalid ${label} memory head.`);
  return immutableClone(head);
}

function parseMemoryAuthorityHead(value: unknown, label: string): OhHeadV1 {
  return parseDetachedMemoryAuthorityHead(detachCanonicalData(value,
    `The ${label} memory head`, 4 * 1024).value, label);
}

function parseCanonicalAdvanceRequest(value: unknown): Readonly<{
  expectedHead: OhHeadV1;
  nextHead: OhHeadV1;
}> {
  const detached = detachCanonicalData(value, "The canonical memory advance request",
    OH_MEMORY_QUERY_LIMITS_V2.requestBytes).value;
  if (!isPlainRecord(detached) || !hasExactKeys(detached, ["expectedHead", "nextHead", "v"])
    || detached.v !== 1) throw new TypeError("Invalid canonical memory advance request.");
  return Object.freeze({
    expectedHead: parseDetachedMemoryAuthorityHead(detached.expectedHead, "expected canonical"),
    nextHead: parseDetachedMemoryAuthorityHead(detached.nextHead, "next canonical"),
  });
}

function parseAdoptionRequest(value: unknown): Readonly<{
  expectedCanonicalHead: OhHeadV1;
  nomination: OhMemoryNominationV1;
  replacements: readonly OhMemoryAdoptionReplacementV1[];
}> {
  const detached = detachCanonicalData(value, "The memory adoption request",
    OH_MEMORY_AUTHORITY_LIMITS_V1.adoptionRequestBytes).value;
  if (!isPlainRecord(detached)
    || (!hasExactKeys(detached, ["expectedCanonicalHead", "nomination", "v"])
      && !hasExactKeys(detached, ["expectedCanonicalHead", "nomination", "replacements", "v"]))
    || detached.v !== 1) throw new TypeError("Invalid memory adoption request.");
  const nomination = parseDetachedMemoryNominationV1(detached.nomination);
  if (nomination === null) throw new TypeError("Invalid memory adoption nomination.");
  const replacementValues = "replacements" in detached ? detached.replacements : [];
  if (!Array.isArray(replacementValues)
    || replacementValues.length > OH_MEMORY_AUTHORITY_LIMITS_V1.adoptionReplacements) {
    throw new TypeError("Invalid memory adoption replacements.");
  }
  const nominatedByKey = new Map(nomination.closure.records.map((record) => [record.key, record]));
  const replacements = replacementValues.map((replacement) => {
    if (!isPlainRecord(replacement)
      || !hasExactKeys(replacement, ["expectedPriorRecordSha256", "key", "v"])
      || replacement.v !== 1) throw new TypeError("Invalid memory adoption replacement.");
    const key = safeCode(replacement.key, 512);
    const expectedPriorRecordSha256 = parseSha256Hex(replacement.expectedPriorRecordSha256);
    const nominated = key === null ? undefined : nominatedByKey.get(key);
    if (key === null || expectedPriorRecordSha256 === null || nominated === undefined) {
      throw new TypeError("Invalid memory adoption replacement.");
    }
    return { expectedPriorRecordSha256, key, v: 1 as const };
  }).sort((left, right) => compareText(left.key, right.key));
  if (!orderedUnique(replacements, (replacement) => replacement.key)) {
    throw new TypeError("Memory adoption replacement keys must be unique.");
  }
  return Object.freeze({
    expectedCanonicalHead: parseDetachedMemoryAuthorityHead(detached.expectedCanonicalHead,
      "expected canonical adoption"),
    nomination,
    replacements: immutableClone(replacements),
  });
}

function headRef(head: OhHeadV1): OhHeadRefV1 {
  return Object.freeze({ operationSha256: head.operationSha256, sequence: head.sequence });
}

async function proveCanonicalDescendant(
  authority: Readonly<{ authorityId: string; binding: OhStoreBindingV1; store: OhStoreV1 }>,
  priorHead: OhHeadV1,
  nextHead: OhHeadV1,
  requiredFirstHead?: OhHeadV1,
): Promise<LaneSnapshot> {
  if (nextHead.sequence <= priorHead.sequence) {
    throw new OhConflictError("The next canonical memory head is not a descendant of the current pin.");
  }
  const distance = nextHead.sequence - priorHead.sequence;
  if (distance > OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalAdvanceOperations
    || Math.ceil(distance / OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalChangeFeedPage)
      > OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalAdvancePages) {
    throw new RangeError("The canonical memory advance exceeds its total proof bound; advance in host-reviewed chunks.");
  }
  const through = headRef(nextHead);
  let cursor = headRef(priorHead);
  let pageCount = 0;
  let reachedHead: OhHeadV1 | null = null;
  let firstHead: OhHeadV1 | null = null;
  while (cursor.sequence < through.sequence) {
    if (pageCount >= OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalAdvancePages) {
      throw new RangeError("The canonical memory advance exceeded its page proof bound; advance in host-reviewed chunks.");
    }
    pageCount += 1;
    const remaining = through.sequence - cursor.sequence;
    const limit = Math.min(remaining, OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalChangeFeedPage);
    const returnedData = detachCanonicalData(
      await authority.store.changesSince(cursor, { limit, through }),
      "The canonical change-feed page",
      OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalChangeFeedPageBytes,
    ).value;
    const returned = returnedData as Record<string, unknown>;
    if (!isPlainRecord(returned) || !hasExactKeys(returned,
      ["from", "hasMore", "operations", "through", "to", "v"])
      || returned.v !== 1 || typeof returned.hasMore !== "boolean"
      || !Array.isArray(returned.operations) || returned.operations.length > limit) {
      throw new OhIntegrityError("The canonical change feed returned an invalid page envelope.");
    }
    const from = parseOhHeadRefV1(returned.from);
    const returnedThrough = parseOhHeadV1(returned.through);
    const returnedTo = parseOhHeadRefV1(returned.to);
    if (from === null || returnedThrough === null || returnedTo === null
      || canonicalJson(from) !== canonicalJson(cursor)
      || !exactHead(returnedThrough, nextHead)) {
      throw new OhIntegrityError("The canonical change feed changed its pinned bounds.");
    }
    let reached = cursor;
    for (const value of returned.operations) {
      const operation = parseOhOperationV1(value);
      if (operation === null || operation.spaceId !== authority.binding.spaceId
        || operation.sequence !== reached.sequence + 1
        || operation.parentOperationSha256 !== reached.operationSha256) {
        throw new OhIntegrityError("The canonical change feed contains a gap or different authority.");
      }
      reached = Object.freeze({ operationSha256: operation.operationSha256,
        sequence: operation.sequence });
      reachedHead = immutableClone({ generation: operation.sequence,
        graphRevisionSha256: operation.graphRevisionSha256,
        operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
        sequence: operation.sequence, v: 1 });
      firstHead ??= reachedHead;
    }
    if (canonicalJson(reached) !== canonicalJson(returnedTo)
      || (returned.hasMore && returned.operations.length === 0)
      || (returned.hasMore && reached.sequence >= through.sequence)
      || reached.sequence > through.sequence
      || (!returned.hasMore && canonicalJson(reached) !== canonicalJson(through))) {
      throw new OhIntegrityError("The canonical change feed did not prove the requested descendant.");
    }
    cursor = reached;
  }
  if (reachedHead === null || !exactHead(reachedHead, nextHead)) {
    throw new OhIntegrityError("The canonical change feed did not prove the requested full head.");
  }
  if (requiredFirstHead !== undefined
    && (firstHead === null || !exactHead(firstHead, requiredFirstHead))) {
    throw new OhIntegrityError("The returned adoption operation is not on the current canonical path.");
  }
  return await readLane(authority, "canonical", nextHead);
}

function canonicalAdvanceReceipt(
  authorityIdValue: string,
  bindingSha256: Sha256Hex,
  priorHead: OhHeadV1,
  head: OhHeadV1,
  status: OhMemoryCanonicalAdvanceReceiptV1["status"],
): OhMemoryCanonicalAdvanceReceiptV1 {
  const payload = { authorityId: authorityIdValue, bindingSha256, head, priorHead, status,
    v: 1 as const };
  return immutableClone({ ...payload, receiptSha256: canonicalSha256(payload) });
}

function adoptionReceipt(
  actorId: string,
  authorityIdValue: string,
  bindingSha256: Sha256Hex,
  nominationSha256: Sha256Hex,
  operationSha256: Sha256Hex | null,
  priorHead: OhHeadV1,
  head: OhHeadV1,
  status: OhMemoryAdoptionReceiptV1["status"],
): OhMemoryAdoptionReceiptV1 {
  const payload = { actorId, authorityId: authorityIdValue, bindingSha256, head,
    nominationSha256, operationSha256, priorHead, status, v: 1 as const };
  return immutableClone({ ...payload, receiptSha256: canonicalSha256(payload) });
}

function adoptionDifferences(
  snapshot: OhSnapshotV1,
  records: readonly KnowledgeGraphRecordV1[],
): readonly OhMemoryAdoptionConflictEntryV1[] {
  const canonicalByKey = new Map(snapshot.records.map((record) => [record.key, record]));
  return immutableClone(records.flatMap((record) => {
    const canonicalRecord = canonicalByKey.get(record.key);
    return canonicalRecord?.recordSha256 === record.recordSha256 ? [] : [{
      canonicalRecordSha256: canonicalRecord?.recordSha256 ?? null,
      key: record.key,
      nominatedRecordSha256: record.recordSha256,
      v: 1 as const,
    }];
  }).sort((left, right) => compareText(left.key, right.key)));
}

function unauthorizedAdoptionDifferences(
  reviewedSnapshot: OhSnapshotV1,
  currentSnapshot: OhSnapshotV1,
  records: readonly KnowledgeGraphRecordV1[],
  replacements: readonly OhMemoryAdoptionReplacementV1[],
): readonly OhMemoryAdoptionConflictEntryV1[] {
  const reviewedByKey = new Map(reviewedSnapshot.records.map((record) => [record.key, record]));
  const currentByKey = new Map(currentSnapshot.records.map((record) => [record.key, record]));
  const replacementByKey = new Map(replacements.map((replacement) => [replacement.key,
    replacement.expectedPriorRecordSha256]));
  const conflicts = records.flatMap((nominated) => {
    const reviewed = reviewedByKey.get(nominated.key);
    const expectedPriorRecordSha256 = replacementByKey.get(nominated.key);
    const alreadyEqual = reviewed?.recordSha256 === nominated.recordSha256;
    const authorized = reviewed === undefined
      ? expectedPriorRecordSha256 === undefined
      : alreadyEqual
        ? expectedPriorRecordSha256 === undefined
          || expectedPriorRecordSha256 === reviewed.recordSha256
        : expectedPriorRecordSha256 === reviewed.recordSha256;
    if (authorized) return [];
    return [{
      canonicalRecordSha256: currentByKey.get(nominated.key)?.recordSha256 ?? null,
      key: nominated.key,
      nominatedRecordSha256: nominated.recordSha256,
      v: 1 as const,
    }];
  });
  return immutableClone(conflicts
    .sort((left, right) => compareText(left.key, right.key)));
}

async function assertWorkingCommitCapacity(
  store: OhStoreV1,
  binding: OhStoreBindingV1,
  changes: readonly KnowledgeGraphChangeV1[],
  head: OhHeadV1,
): Promise<void> {
  const returnedSnapshot = await store.snapshot({
    head: { operationSha256: head.operationSha256, sequence: head.sequence },
    maximumRecords: OH_MEMORY_LIMITS_V1.maximumRecordsPerLane,
  });
  const { snapshot } = parseDetachedStoreSnapshot(returnedSnapshot,
    "The working capacity store", head, binding.spaceId);
  const recordsByKey = new Map(snapshot.records.map((record) => [record.key, record]));
  for (const change of canonicalKnowledgeGraphChangesV1(changes)) {
    if (change.kind === "put") recordsByKey.set(change.record.key, change.record);
    else recordsByKey.delete(change.key);
  }
  if (recordsByKey.size > OH_MEMORY_LIMITS_V1.maximumRecordsPerLane) {
    throw new RangeError("The remembered working memory would exceed its record snapshot bound.");
  }
  const nextSequence = snapshot.head.sequence + 1;
  if (!Number.isSafeInteger(nextSequence)) {
    throw new RangeError("The remembered working memory would exceed its head sequence bound.");
  }
  const records = [...recordsByKey.values()]
    .sort((left, right) => compareText(left.key, right.key));
  const placeholderDigest = canonicalSha256({ kind: "oh.memory.remember-capacity", v: 1 });
  const prospective: OhSnapshotV1 = {
    head: {
      generation: nextSequence,
      graphRevisionSha256: placeholderDigest,
      operationSha256: placeholderDigest,
      recordsSha256: canonicalSha256(records.map(knowledgeGraphRecordRefV1)),
      sequence: nextSequence,
      v: 1,
    },
    records,
    v: 1,
  };
  if (utf8ByteLength(canonicalJson(prospective)) > OH_MEMORY_LIMITS_V1.snapshotBytesPerLane) {
    throw new RangeError("The remembered working memory would exceed its snapshot byte bound.");
  }
}

function capacityGuardedWorkingStore(store: OhStoreV1, binding: OhStoreBindingV1): OhStoreV1 {
  const guarded: OhStoreV1 = {
    binding,
    changesSince: async (from, options) => await store.changesSince(from, options),
    close: async () => await store.close(),
    commit: async (input) => {
      const current = parseDetachedStoreHead(await store.head(),
        "The working capacity store");
      // The store owns exact operation-id replay. A stale expected head may
      // therefore be either a harmless replay or a conflict. Delegate it
      // unchanged so a hypothetical reapplication cannot reject a replay.
      if (
        current.generation === input.expectedHead.generation
        && current.operationSha256 === input.expectedHead.operationSha256
      ) await assertWorkingCommitCapacity(store, binding, input.changes, current);
      return await store.commit(input);
    },
    exportDependencyClosure: async (input) => await store.exportDependencyClosure(input),
    head: async () => await store.head(),
    snapshot: async (options) => await store.snapshot(options),
    verify: async () => await store.verify(),
  };
  return Object.freeze(guarded);
}

function assertAdoptionSnapshotCapacity(
  snapshot: OhSnapshotV1,
  changedRecords: readonly KnowledgeGraphRecordV1[],
): void {
  const recordsByKey = new Map(snapshot.records.map((record) => [record.key, record]));
  for (const record of changedRecords) recordsByKey.set(record.key, record);
  if (recordsByKey.size > OH_MEMORY_LIMITS_V1.maximumRecordsPerLane) {
    throw new RangeError("The adopted canonical memory would exceed its record snapshot bound.");
  }
  const nextSequence = snapshot.head.sequence + 1;
  if (!Number.isSafeInteger(nextSequence)) {
    throw new RangeError("The adopted canonical memory would exceed its head sequence bound.");
  }
  const records = [...recordsByKey.values()]
    .sort((left, right) => compareText(left.key, right.key));
  const placeholderDigest = canonicalSha256({ kind: "oh.memory.adoption-capacity", v: 1 });
  const prospective: OhSnapshotV1 = {
    head: {
      generation: nextSequence,
      graphRevisionSha256: placeholderDigest,
      operationSha256: placeholderDigest,
      recordsSha256: canonicalSha256(records.map(knowledgeGraphRecordRefV1)),
      sequence: nextSequence,
      v: 1,
    },
    records,
    v: 1,
  };
  if (utf8ByteLength(canonicalJson(prospective)) > OH_MEMORY_LIMITS_V1.snapshotBytesPerLane) {
    throw new RangeError("The adopted canonical memory would exceed its canonical snapshot byte bound.");
  }
}

function adoptionConflict(
  expectedHead: OhHeadV1,
  actualHead: OhHeadV1,
  completeConflicts: readonly OhMemoryAdoptionConflictEntryV1[],
): OhMemoryAdoptionConflictError {
  const sorted = immutableClone([...completeConflicts]
    .sort((left, right) => compareText(left.key, right.key)));
  const conflicts = immutableClone(sorted.slice(0,
    OH_MEMORY_AUTHORITY_LIMITS_V1.reportedAdoptionConflicts));
  const conflict = immutableClone({ actualHead, conflicts,
    conflictsSha256: canonicalSha256({ conflicts: sorted, v: 1 }), expectedHead,
    reportedConflicts: conflicts.length, totalConflicts: sorted.length,
    truncated: conflicts.length !== sorted.length, v: 1 as const });
  return new OhMemoryAdoptionConflictError(conflict);
}

/**
 * Creates the stable two-lane memory boundary. The agent object carries no
 * canonical mutation handle; trusted host code retains serialized rollover and
 * reviewed adoption controls separately.
 */
export async function createOhMemoryAuthorityV1(
  options: OhMemoryAuthorityOptionsV1,
): Promise<OhMemoryAuthorityV1> {
  const memoryActorId = safeCode(options.actorId, 128);
  const adoptionActorId = safeCode(options.adoptionActorId, 128);
  if (memoryActorId === null || adoptionActorId === null) {
    throw new TypeError("Invalid host-bound memory authority actor ID.");
  }
  const canonicalStore = options.canonical.store;
  const workingStore = options.working.store;
  const canonicalAuthorityId = authorityId(options.canonical.authorityId);
  const workingAuthorityId = authorityId(options.working.authorityId);
  if (canonicalAuthorityId === workingAuthorityId) {
    throw new OhProfileError("Working and canonical memory must be distinct physical authorities.");
  }
  const canonicalBinding = bindingFor(canonicalStore,
    options.canonical.expectedBindingSha256, "canonical");
  const workingBinding = bindingFor(workingStore,
    options.working.expectedBindingSha256, "working");
  const initialCanonicalHead = parseMemoryAuthorityHead(options.canonical.expectedHead,
    "initial canonical");
  const workingCodecs = options.working.codecs;
  const explainCapabilityLifetimeMs = options.explainCapabilityLifetimeMs;
  const monotonicNow = options.monotonicNow;
  const now = options.now;
  const continuationKey = continuationKeyV2(options.continuationKey);
  const programs = Object.freeze([...resolveProgramsV2(options.programs).values()].map((program) =>
    immutableClone({ evaluation: program.evaluation, maximumPageBytes: program.maximumPageBytes,
      maximumRows: program.maximumRows, pageSize: program.pageSize, parameters: program.parameters,
      programId: program.programId, purpose: program.purpose, query: program.query,
      rulePack: program.rulePack, v: 2 as const })));
  const extractors = resolveExtractors(options.extractors ?? []);
  const nominationRoutes = Object.freeze([...resolveNominationRoutes(options.nominationRoutes ?? []).values()]);
  const routesById = new Map(nominationRoutes.map((route) => [route.nominationId, route]));
  const runtime = createOhMemoryRuntimeV2(options);

  const createAgentAt = async (expectedHead: OhHeadV1) => await createOhMemoryAgentV2WithRuntime({
    actorId: memoryActorId,
    canonical: { authorityId: canonicalAuthorityId,
      expectedBindingSha256: canonicalBinding.bindingSha256, expectedHead, store: canonicalStore },
    continuationKey,
    ...(explainCapabilityLifetimeMs === undefined ? {} : {
      explainCapabilityLifetimeMs,
    }),
    extractors,
    ...(monotonicNow === undefined ? {} : { monotonicNow }),
    nominationRoutes,
    ...(now === undefined ? {} : { now }),
    programs,
    working: { authorityId: workingAuthorityId, codecs: workingCodecs,
      expectedBindingSha256: workingBinding.bindingSha256, store: workingStore },
  }, runtime);

  let activeCanonicalHead = initialCanonicalHead;
  let activeAgent = await createAgentAt(activeCanonicalHead);
  const agent: OhMemoryAgentV2 = Object.freeze({
    async explain(value: unknown) {
      const selected = activeAgent;
      return await selected.explain(value);
    },
    nominate(value: unknown) {
      const selected = activeAgent;
      return selected.nominate(value);
    },
    async query(value: unknown) {
      const selected = activeAgent;
      return await selected.query(value);
    },
    remember(value: unknown) {
      const selected = activeAgent;
      return selected.remember(value);
    },
  });

  let hostTail: Promise<void> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = hostTail.then(operation);
    hostTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const installCanonicalHead = async (head: OhHeadV1): Promise<void> => {
    const nextAgent = await createAgentAt(head);
    activeAgent = nextAgent;
    activeCanonicalHead = immutableClone(head);
  };

  const canonicalAuthority = Object.freeze({ authorityId: canonicalAuthorityId,
    binding: canonicalBinding, store: canonicalStore });
  const readPhysicalCanonicalHead = async (): Promise<OhHeadV1> =>
    parseMemoryAuthorityHead(await canonicalStore.head(), "physical canonical");

  const advanceCanonical = (value: unknown): Promise<OhMemoryCanonicalAdvanceReceiptV1> => {
    let request: ReturnType<typeof parseCanonicalAdvanceRequest>;
    try { request = parseCanonicalAdvanceRequest(value); } catch (error) { return Promise.reject(error); }
    return serialized(async () => {
      const priorHead = activeCanonicalHead;
      if (!exactHead(request.expectedHead, priorHead)) {
        throw new OhConflictError("The expected canonical memory head does not match the current pin.");
      }
      if (exactHead(request.nextHead, priorHead)) {
        return canonicalAdvanceReceipt(canonicalAuthorityId, canonicalBinding.bindingSha256,
          priorHead, priorHead, "unchanged");
      }
      await proveCanonicalDescendant(canonicalAuthority, priorHead, request.nextHead);
      await installCanonicalHead(request.nextHead);
      return canonicalAdvanceReceipt(canonicalAuthorityId, canonicalBinding.bindingSha256,
        priorHead, request.nextHead, "advanced");
    });
  };

  const adoptNomination = (value: unknown): Promise<OhMemoryAdoptionReceiptV1> => {
    let request: ReturnType<typeof parseAdoptionRequest>;
    try { request = parseAdoptionRequest(value); } catch (error) { return Promise.reject(error); }
    return serialized(async () => {
      const route = routesById.get(request.nomination.nominationId);
      if (route === undefined || route.destinationPurpose !== request.nomination.destinationPurpose) {
        throw new OhProfileError("The memory nomination is not bound to this adoption route.");
      }
      if (request.nomination.source.authorityId !== workingAuthorityId
        || request.nomination.source.bindingSha256 !== workingBinding.bindingSha256
        || request.nomination.closure.binding.bindingSha256 !== workingBinding.bindingSha256) {
        throw new OhProfileError("The memory nomination is not from the bound working authority.");
      }
      const returnedReexport = await workingStore.exportDependencyClosure({
        head: headRef(request.nomination.source.head),
        maximumRecords: OH_DEPENDENCY_CLOSURE_LIMITS_V1.records,
        roots: request.nomination.closure.roots,
      });
      const reexported = detachCanonicalData(returnedReexport, "The working re-exported nomination",
        OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes);
      if (reexported.canonical !== canonicalJson(request.nomination.closure)) {
        throw new OhIntegrityError("The working authority did not re-export the nominated closure exactly.");
      }

      const priorHead = activeCanonicalHead;
      const physicalHead = await readPhysicalCanonicalHead();
      const replacementConflictsAt = async (currentLane: LaneSnapshot) => {
        if (request.replacements.length === 0) return [];
        const reviewedLane = exactHead(request.expectedCanonicalHead, currentLane.snapshot.head)
          ? currentLane
          : await readLane(canonicalAuthority, "canonical", request.expectedCanonicalHead);
        return unauthorizedAdoptionDifferences(reviewedLane.snapshot, currentLane.snapshot,
          request.nomination.closure.records, request.replacements);
      };
      if (!exactHead(physicalHead, priorHead)) {
        const physicalLane = await proveCanonicalDescendant(canonicalAuthority, priorHead, physicalHead);
        const physicalDifferences = adoptionDifferences(physicalLane.snapshot,
          request.nomination.closure.records);
        if (physicalDifferences.length === 0) {
          const replacementConflicts = await replacementConflictsAt(physicalLane);
          if (replacementConflicts.length > 0) {
            throw adoptionConflict(request.expectedCanonicalHead, physicalHead, replacementConflicts);
          }
          await installCanonicalHead(physicalHead);
          return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
            canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
            priorHead, physicalHead, "already-present");
        }
        throw adoptionConflict(request.expectedCanonicalHead, physicalHead, physicalDifferences);
      }

      const lane = await readLane(canonicalAuthority, "canonical", priorHead);
      const differences = adoptionDifferences(lane.snapshot, request.nomination.closure.records);
      if (!exactHead(request.expectedCanonicalHead, priorHead)) {
        if (differences.length === 0) {
          const replacementConflicts = await replacementConflictsAt(lane);
          if (replacementConflicts.length > 0) {
            throw adoptionConflict(request.expectedCanonicalHead, priorHead, replacementConflicts);
          }
          return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
            canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
            priorHead, priorHead, "already-present");
        }
        throw adoptionConflict(request.expectedCanonicalHead, priorHead, differences);
      }
      if (differences.length === 0) {
        const replacementConflicts = await replacementConflictsAt(lane);
        if (replacementConflicts.length > 0) {
          throw adoptionConflict(request.expectedCanonicalHead, priorHead, replacementConflicts);
        }
        return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
          canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
          priorHead, priorHead, "already-present");
      }
      const unauthorized = unauthorizedAdoptionDifferences(lane.snapshot, lane.snapshot,
        request.nomination.closure.records, request.replacements);
      if (unauthorized.length > 0) {
        throw adoptionConflict(request.expectedCanonicalHead, priorHead, unauthorized);
      }
      const changedKeys = new Set(differences.map(({ key }) => key));
      const changedRecords = request.nomination.closure.records
        .filter(({ key }) => changedKeys.has(key));
      if (changedRecords.length === 0) {
        return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
          canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
          priorHead, priorHead, "already-present");
      }
      assertAdoptionSnapshotCapacity(lane.snapshot, changedRecords);
      const changes = canonicalKnowledgeGraphChangesV1(changedRecords
        .map((record): KnowledgeGraphChangeV1 => ({ kind: "put", record, v: 1 })));
      const operationId = `memory_adopt_${canonicalSha256({ actorId: adoptionActorId,
        bindingSha256: canonicalBinding.bindingSha256,
        nominationSha256: request.nomination.nominationSha256,
        priorHead, v: 1 }).slice(0, 48)}`;
      let returnedOperation: unknown;
      try {
        returnedOperation = await canonicalStore.commit({ actorId: adoptionActorId, changes,
          expectedHead: { generation: priorHead.generation,
            operationSha256: priorHead.operationSha256 }, operationId });
      } catch (error) {
        if (!(error instanceof OhConflictError)) throw error;
        const actualHead = await readPhysicalCanonicalHead();
        const actualLane = exactHead(actualHead, priorHead)
          ? await readLane(canonicalAuthority, "canonical", actualHead)
          : await proveCanonicalDescendant(canonicalAuthority, priorHead, actualHead);
        const actualDifferences = adoptionDifferences(actualLane.snapshot,
          request.nomination.closure.records);
        if (actualDifferences.length === 0) {
          if (!exactHead(actualHead, priorHead)) {
            await installCanonicalHead(actualHead);
          }
          return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
            canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
            priorHead, actualHead, "already-present");
        }
        throw adoptionConflict(request.expectedCanonicalHead, actualHead, actualDifferences);
      }
      const operation = parseOhOperationV1(detachCanonicalData(returnedOperation,
        "The returned canonical adoption operation",
        OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalChangeFeedPageBytes).value);
      if (operation === null || operation.actorId !== adoptionActorId
        || operation.operationId !== operationId || operation.spaceId !== canonicalBinding.spaceId
        || operation.parentOperationSha256 !== priorHead.operationSha256
        || operation.sequence !== priorHead.sequence + 1
        || canonicalJson(operation.changes) !== canonicalJson(changes)) {
        throw new OhIntegrityError("The canonical authority returned a different adoption operation.");
      }
      const head: OhHeadV1 = immutableClone({ generation: operation.sequence,
        graphRevisionSha256: operation.graphRevisionSha256,
        operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
        sequence: operation.sequence, v: 1 });
      const actualHead = await readPhysicalCanonicalHead();
      if (!exactHead(actualHead, head)) {
        const actualLane = exactHead(actualHead, priorHead)
          ? await readLane(canonicalAuthority, "canonical", actualHead)
          : await proveCanonicalDescendant(canonicalAuthority, priorHead, actualHead, head);
        const actualDifferences = adoptionDifferences(actualLane.snapshot,
          request.nomination.closure.records);
        if (actualDifferences.length !== 0) {
          throw adoptionConflict(request.expectedCanonicalHead, actualHead, actualDifferences);
        }
        await installCanonicalHead(actualHead);
        return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
          canonicalBinding.bindingSha256, request.nomination.nominationSha256, null,
          priorHead, actualHead, "already-present");
      }
      await installCanonicalHead(actualHead);
      return adoptionReceipt(adoptionActorId, canonicalAuthorityId,
        canonicalBinding.bindingSha256, request.nomination.nominationSha256,
        operation.operationSha256, priorHead, actualHead, "adopted");
    });
  };

  return Object.freeze({ agent, host: Object.freeze({ adoptNomination, advanceCanonical }) });
}
