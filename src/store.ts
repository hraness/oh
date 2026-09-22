import {
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  type JsonValue,
  type Sha256Hex,
} from "./canonical";
import {
  OH_CONTRACT_MANIFEST_V1,
  OhRecordCodecRegistry,
} from "./contract";
export { OhRecordCodecRegistry } from "./contract";
import {
  canonicalKnowledgeGraphChangesV1,
  createKnowledgeGraphRecordV1,
  graphRevisionSha256V1,
  knowledgeGraphRecordRefV1,
  OH_GRAPH_LIMITS_V1,
  OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  parseKnowledgeGraphRecordV1,
  type KnowledgeGraphChangeV1,
  type KnowledgeGraphRecordKindV1,
  type KnowledgeGraphRecordV1,
} from "./graph";
export {
  isOhConflictError,
  isOhDependencyError,
  isOhIntegrityError,
  isOhOperationSizeError,
  isOhProfileError,
  OH_OPERATION_SIZE_ERROR_CODE_V1,
  OhConflictError,
  OhDependencyError,
  OhIntegrityError,
  OhOperationSizeError,
  OhProfileError,
} from "./errors";
import {
  OhConflictError,
  OhDependencyError,
  OhIntegrityError,
  OhProfileError,
} from "./errors";
import {
  createOhOperationV1,
  parseOhOperationV1,
  type OhOperationV1,
} from "./operation";

export type OhHeadV1 = Readonly<{
  generation: number;
  graphRevisionSha256: Sha256Hex | null;
  operationSha256: Sha256Hex | null;
  recordsSha256: Sha256Hex;
  sequence: number;
  v: 1;
}>;

export type OhHeadRefV1 = Pick<OhHeadV1, "operationSha256" | "sequence">;

export type OhCommitInputV1 = Readonly<{
  actorId: string;
  changes: readonly KnowledgeGraphChangeV1[];
  expectedHead: Pick<OhHeadV1, "generation" | "operationSha256">;
  instant?: string;
  maximumOperationBytes?: number;
  operationId: string;
}>;

export type OhSnapshotV1 = Readonly<{
  head: OhHeadV1;
  records: readonly KnowledgeGraphRecordV1[];
  v: 1;
}>;

export type OhChangesPageV1 = Readonly<{
  from: OhHeadRefV1;
  hasMore: boolean;
  operations: readonly OhOperationV1[];
  through: OhHeadV1;
  to: OhHeadRefV1;
  v: 1;
}>;

export type OhStoreVerificationV1 = Readonly<{
  head: OhHeadV1;
  integrity: "verified";
  operations: number;
  records: number;
  v: 1;
}>;

export type OhStoreCapabilitiesV1 = Readonly<{
  changesSince: true;
  dependencyClosureExport: true;
  exactSnapshots: true;
  operationReplication: boolean;
  semanticBundleCommit: true;
  v: 1;
  wholeSpacePurge: boolean;
}>;

export type OhStoreProfileV1 = Readonly<{
  applicationProfileSha256: Sha256Hex | null;
  capabilities: OhStoreCapabilitiesV1;
  profileId: string;
  profileKind: "canonical" | "working";
  profileSha256: Sha256Hex;
  v: 1;
}>;

export type OhStoreBindingV1 = Readonly<{
  bindingSha256: Sha256Hex;
  contractSha256: Sha256Hex;
  profile: OhStoreProfileV1;
  realmId: string;
  spaceId: string;
  v: 1;
}>;

export const OH_CANONICAL_STORE_PROFILE_V1 = createOhStoreProfileV1({
  applicationProfileSha256: null,
  capabilities: {
    changesSince: true,
    dependencyClosureExport: true,
    exactSnapshots: true,
    operationReplication: true,
    semanticBundleCommit: true,
    v: 1,
    wholeSpacePurge: false,
  },
  profileId: "oh.store.canonical.v1",
  profileKind: "canonical",
  v: 1,
});

export const OH_WORKING_STORE_PROFILE_V1 = createOhStoreProfileV1({
  applicationProfileSha256: null,
  capabilities: {
    changesSince: true,
    dependencyClosureExport: true,
    exactSnapshots: true,
    operationReplication: false,
    semanticBundleCommit: true,
    v: 1,
    wholeSpacePurge: true,
  },
  profileId: "oh.store.working.v1",
  profileKind: "working",
  v: 1,
});

export type OhDependencyClosureV1 = Readonly<{
  binding: OhStoreBindingV1;
  closureSha256: Sha256Hex;
  head: OhHeadV1;
  records: readonly KnowledgeGraphRecordV1[];
  roots: readonly string[];
  v: 1;
}>;

export const OH_DEPENDENCY_CLOSURE_LIMITS_V1 = Object.freeze({
  bytes: 64 * 1024 * 1024,
  records: 8_192,
  roots: 1_024,
});

export type OhSpacePurgeReceiptV1 = Readonly<{
  bindingSha256: Sha256Hex;
  priorHead: OhHeadV1;
  purgedAt: string;
  receiptSha256: Sha256Hex;
  spaceId: string;
  v: 1;
}>;

export class OhPurgedSpaceError extends Error {
  readonly receipt: OhSpacePurgeReceiptV1;

  constructor(receipt: OhSpacePurgeReceiptV1) {
    super(`Oh space ${receipt.spaceId} was purged at ${receipt.purgedAt}.`);
    this.name = "OhPurgedSpaceError";
    this.receipt = receipt;
  }
}

export interface OhStoreV1 {
  readonly binding: OhStoreBindingV1;
  changesSince(
    from: OhHeadRefV1,
    options?: Readonly<{ limit?: number; through?: OhHeadRefV1 }>,
  ): Promise<OhChangesPageV1>;
  close(): Promise<void>;
  commit(input: OhCommitInputV1): Promise<OhOperationV1>;
  exportDependencyClosure(input: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
    roots: readonly string[];
  }>): Promise<OhDependencyClosureV1>;
  head(): Promise<OhHeadV1>;
  snapshot(options?: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
  }>): Promise<OhSnapshotV1>;
  verify(): Promise<OhStoreVerificationV1>;
}

/** Kept separate so an agent-facing store object never carries deletion authority. */
export interface OhStoreHostControlV1 {
  readonly binding: OhStoreBindingV1;
  purgeWorkingSpace(input: Readonly<{ purgedAt?: string }>): Promise<OhSpacePurgeReceiptV1>;
}

export type OhStoreAuthorityV1 = Readonly<{
  host: OhStoreHostControlV1;
  store: OhStoreV1;
}>;

const EMPTY_RECORDS_SHA256 = canonicalSha256([]);

export function emptyOhHeadV1(): OhHeadV1 {
  return {
    generation: 0,
    graphRevisionSha256: null,
    operationSha256: null,
    recordsSha256: EMPTY_RECORDS_SHA256,
    sequence: 0,
    v: 1,
  };
}

export function parseOhHeadV1(value: unknown): OhHeadV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["generation", "graphRevisionSha256",
    "operationSha256", "recordsSha256", "sequence", "v"]) || value.v !== 1) return null;
  const graphRevisionSha256 = value.graphRevisionSha256 === null
    ? null : parseSha256Hex(value.graphRevisionSha256);
  const operationSha256 = value.operationSha256 === null
    ? null : parseSha256Hex(value.operationSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const generation = Number.isSafeInteger(value.generation) && (value.generation as number) >= 0
    ? value.generation as number : null;
  const sequence = Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0
    ? value.sequence as number : null;
  return generation !== null && sequence !== null && generation === sequence
      && recordsSha256 !== null
      && (value.graphRevisionSha256 === null || graphRevisionSha256 !== null)
      && (value.operationSha256 === null || operationSha256 !== null)
      && ((sequence === 0) === (operationSha256 === null))
      && ((sequence === 0) === (graphRevisionSha256 === null))
    ? { generation, graphRevisionSha256, operationSha256, recordsSha256, sequence, v: 1 }
    : null;
}

export function parseOhHeadRefV1(value: unknown): OhHeadRefV1 | null {
  const complete = parseOhHeadV1(value);
  if (complete !== null) {
    return { operationSha256: complete.operationSha256, sequence: complete.sequence };
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, ["operationSha256", "sequence"])) return null;
  const operationSha256 = value.operationSha256 === null ? null : parseSha256Hex(value.operationSha256);
  const sequence = Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0
    ? value.sequence as number : null;
  return sequence !== null && (value.operationSha256 === null || operationSha256 !== null)
      && ((sequence === 0) === (operationSha256 === null))
    ? { operationSha256, sequence } : null;
}

function parseCapabilities(value: unknown): OhStoreCapabilitiesV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["changesSince", "dependencyClosureExport",
    "exactSnapshots", "operationReplication", "semanticBundleCommit", "v", "wholeSpacePurge"])
    || value.changesSince !== true || value.dependencyClosureExport !== true
    || value.exactSnapshots !== true || typeof value.operationReplication !== "boolean"
    || value.semanticBundleCommit !== true || value.v !== 1
    || typeof value.wholeSpacePurge !== "boolean") return null;
  return { changesSince: true, dependencyClosureExport: true, exactSnapshots: true,
    operationReplication: value.operationReplication, semanticBundleCommit: true, v: 1,
    wholeSpacePurge: value.wholeSpacePurge };
}

type OhStoreProfileInputV1 = Omit<OhStoreProfileV1, "profileSha256">;

export function createOhStoreProfileV1(input: OhStoreProfileInputV1): OhStoreProfileV1 {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["applicationProfileSha256", "capabilities",
    "profileId", "profileKind", "v"]) || input.v !== 1) throw new TypeError("Invalid Oh store profile input.");
  const profileId = safeCode(input.profileId);
  const applicationProfileSha256 = input.applicationProfileSha256 === null
    ? null : parseSha256Hex(input.applicationProfileSha256);
  const capabilities = parseCapabilities(input.capabilities);
  if (profileId === null || capabilities === null
    || (input.applicationProfileSha256 !== null && applicationProfileSha256 === null)
    || (input.profileKind !== "canonical" && input.profileKind !== "working")) {
    throw new TypeError("Invalid Oh store profile input.");
  }
  if (input.profileKind === "working"
    && (capabilities.operationReplication || !capabilities.wholeSpacePurge)) {
    throw new OhProfileError("A working profile must disable operation replication and permit whole-space purge.");
  }
  if (input.profileKind === "canonical" && capabilities.wholeSpacePurge) {
    throw new OhProfileError("A canonical profile cannot permit whole-space purge.");
  }
  const payload = { applicationProfileSha256, capabilities: Object.freeze(capabilities), profileId,
    profileKind: input.profileKind, v: 1 as const };
  return Object.freeze({ ...payload, profileSha256: canonicalSha256(payload) });
}

export function parseOhStoreProfileV1(value: unknown): OhStoreProfileV1 | null {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "profileSha256")) return null;
  const digest = parseSha256Hex(value.profileSha256);
  const { profileSha256: _profileSha256, ...input } = value;
  try {
    const created = createOhStoreProfileV1(input as unknown as OhStoreProfileInputV1);
    return digest !== null && created.profileSha256 === digest ? created : null;
  } catch { return null; }
}

export function createOhStoreBindingV1(input: Readonly<{
  profile: OhStoreProfileV1;
  realmId: string;
  spaceId: string;
  v: 1;
}>): OhStoreBindingV1 {
  const profile = parseOhStoreProfileV1(input.profile);
  const realmId = safeCode(input.realmId);
  const spaceId = safeCode(input.spaceId);
  if (input.v !== 1 || profile === null || realmId === null || spaceId === null) {
    throw new TypeError("Invalid Oh store binding input.");
  }
  const payload = { contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    profile, realmId, spaceId, v: 1 as const };
  return Object.freeze({ ...payload, bindingSha256: canonicalSha256(payload) });
}

export function parseOhStoreBindingV1(value: unknown): OhStoreBindingV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["bindingSha256", "contractSha256",
    "profile", "realmId", "spaceId", "v"]) || value.v !== 1
    || value.contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256) return null;
  const bindingSha256 = parseSha256Hex(value.bindingSha256);
  const profile = parseOhStoreProfileV1(value.profile);
  try {
    if (bindingSha256 === null || profile === null) return null;
    const created = createOhStoreBindingV1({ profile, realmId: value.realmId as string,
      spaceId: value.spaceId as string, v: 1 });
    return created.bindingSha256 === bindingSha256 ? created : null;
  } catch { return null; }
}

function sortedRecords(records: Iterable<KnowledgeGraphRecordV1>): readonly KnowledgeGraphRecordV1[] {
  return [...records].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

function verifyDependencies(records: ReadonlyMap<string, KnowledgeGraphRecordV1>): void {
  for (const record of records.values()) {
    for (const dependency of record.dependencies) {
      if (!records.has(dependency)) throw new OhDependencyError(`Missing dependency ${dependency} for ${record.key}.`);
    }
  }
}

export function replayOhOperationsV1(
  spaceId: string,
  values: readonly OhOperationV1[],
  maximumRecords: number = OH_GRAPH_LIMITS_V1.recordsPerSnapshot,
): OhSnapshotV1 {
  const parsedSpaceId = safeCode(spaceId);
  if (parsedSpaceId === null || !Number.isSafeInteger(maximumRecords) || maximumRecords < 1
    || maximumRecords > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new TypeError("Invalid operation replay input.");
  }
  const records = new Map<string, KnowledgeGraphRecordV1>();
  const operationIds = new Set<string>();
  let head = emptyOhHeadV1();
  for (const value of values) {
    const operation = parseOhOperationV1(value);
    if (operation === null || operation.spaceId !== parsedSpaceId
      || operation.sequence !== head.sequence + 1
      || operation.parentOperationSha256 !== head.operationSha256
      || operationIds.has(operation.operationId)) {
      throw new OhIntegrityError("Operation replay chain is broken.");
    }
    operationIds.add(operation.operationId);
    for (const change of operation.changes) {
      if (change.kind === "put") records.set(change.record.key, change.record);
      else {
        const prior = records.get(change.key);
        if (prior?.recordSha256 !== change.priorSha256) {
          throw new OhIntegrityError("Replay tombstone does not match its prior record.");
        }
        records.delete(change.key);
      }
    }
    if (records.size > maximumRecords) throw new RangeError("Operation replay exceeds its record bound.");
    verifyDependencies(records);
    const refs = sortedRecords(records.values()).map(knowledgeGraphRecordRefV1);
    const recordsSha256 = canonicalSha256(refs);
    const graphRevisionSha256 = graphRevisionSha256V1({ changes: operation.changes,
      operationId: operation.operationId, parentGraphRevisionSha256: head.graphRevisionSha256,
      recordsSha256, revision: operation.sequence });
    if (recordsSha256 !== operation.recordsSha256
      || graphRevisionSha256 !== operation.graphRevisionSha256) {
      throw new OhIntegrityError("Replay does not reproduce an operation head.");
    }
    head = { generation: operation.sequence, graphRevisionSha256,
      operationSha256: operation.operationSha256, recordsSha256,
      sequence: operation.sequence, v: 1 };
  }
  return { head, records: sortedRecords(records.values()), v: 1 };
}

export const OH_RECORD_REVISIONS_LIMITS_V1 = Object.freeze({
  changesPerKey: 65_536,
  operationsPerRead: 1_000,
});

/**
 * One append-only log change that touched a single record key. A put carries
 * the digest it wrote; a tombstone carries the prior digest it removed, which
 * is exactly what the operation log persists for each change kind.
 */
export type OhRecordRevisionChangeV1 = Readonly<{
  kind: "put" | "tombstone";
  recordSha256: Sha256Hex;
  sequence: number;
  v: 1;
}>;

/**
 * Derived revision facts for one record key, read from the append-only log.
 * The kernel reports counts and nothing else: no threshold, ranking, or trust
 * judgement belongs here.
 *
 * `revisions` is the number of puts after the first one — how many times the
 * key was written again. `distinctPutDigests` counts the contents those puts
 * stored, so while `tombstones` is zero a put count above the digest count
 * means the key was rewritten with bytes it already held. Once the key was
 * tombstoned that comparison no longer separates a rewrite from a content
 * change, because removing and restoring identical bytes changes the record
 * twice while storing one digest. `latestKind` is `"put"` when the last observed
 * change materialized the record and `"tombstone"` when it removed it. The
 * counts follow one record key: a correction an application models as a new
 * record superseding an older one is a separate key with its own counts.
 *
 * A reader that hits its change bound returns `truncated: true`. Truncation
 * drops the oldest changes, never the newest, so `latestKind`, `latestSequence`
 * and `through` stay exact while `changes`, `puts`, `tombstones`, `revisions`
 * and `distinctPutDigests` become lower bounds and `oldestObservedSequence`
 * describes only the observed window.
 */
export type OhRecordRevisionsV1 = Readonly<{
  changes: number;
  distinctPutDigests: number;
  key: string;
  latestKind: "put" | "tombstone" | null;
  latestSequence: number | null;
  oldestObservedSequence: number | null;
  puts: number;
  revisions: number;
  through: number;
  tombstones: number;
  truncated: boolean;
  v: 1;
}>;

export function parseOhRecordRevisionChangeV1(value: unknown): OhRecordRevisionChangeV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["kind", "recordSha256", "sequence", "v"])
    || value.v !== 1 || (value.kind !== "put" && value.kind !== "tombstone")) return null;
  const recordSha256 = parseSha256Hex(value.recordSha256);
  const sequence = Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0
    ? value.sequence as number : null;
  return recordSha256 !== null && sequence !== null
    ? { kind: value.kind, recordSha256, sequence, v: 1 } : null;
}

/**
 * Reduces a bounded, unordered set of log changes for one key into its
 * revision facts. Changes are sorted by sequence here, so no caller depends on
 * a read order, and a repeated sequence is rejected because the log admits one
 * change per key per operation.
 */
export function reduceOhRecordRevisionsV1(input: Readonly<{
  changes: readonly unknown[];
  key: string;
  through: number;
  truncated?: boolean;
}>): OhRecordRevisionsV1 {
  if (!isPlainRecord(input) || !Array.isArray(input.changes)) {
    throw new TypeError("Invalid record revision input.");
  }
  const key = safeCode(input.key, 512);
  const through = Number.isSafeInteger(input.through) && input.through >= 0 ? input.through : null;
  const truncated = input.truncated ?? false;
  if (key === null || through === null || typeof truncated !== "boolean") {
    throw new TypeError("Invalid record revision input.");
  }
  if (input.changes.length > OH_RECORD_REVISIONS_LIMITS_V1.changesPerKey) {
    throw new RangeError(`A record revision read accepts at most ${OH_RECORD_REVISIONS_LIMITS_V1.changesPerKey} changes.`);
  }
  const parsed: OhRecordRevisionChangeV1[] = [];
  const sequences = new Set<number>();
  for (const value of input.changes) {
    const change = parseOhRecordRevisionChangeV1(value);
    if (change === null) throw new TypeError("Invalid record revision change.");
    if (change.sequence > through) throw new RangeError("A record revision change is ahead of its through sequence.");
    if (sequences.has(change.sequence)) throw new TypeError("A record key has two changes at one sequence.");
    sequences.add(change.sequence);
    parsed.push(change);
  }
  parsed.sort((left, right) => left.sequence - right.sequence);
  const digests = new Set<Sha256Hex>();
  let puts = 0;
  let tombstones = 0;
  for (const change of parsed) {
    if (change.kind === "put") { puts += 1; digests.add(change.recordSha256); } else tombstones += 1;
  }
  const latest = parsed.at(-1) ?? null;
  return {
    changes: parsed.length,
    distinctPutDigests: digests.size,
    key,
    latestKind: latest === null ? null : latest.kind,
    latestSequence: latest?.sequence ?? null,
    oldestObservedSequence: parsed[0]?.sequence ?? null,
    puts,
    revisions: puts === 0 ? 0 : puts - 1,
    through,
    tombstones,
    truncated,
    v: 1,
  };
}

/**
 * Collects one key's log changes from already parsed operations, so a reader
 * with a change feed rather than local SQL derives the same facts. It reads
 * operations; it never mutates or commits.
 *
 * The caller names the space. A sequence numbers an operation within one space,
 * so operations from the wrong space would otherwise reduce to counts that look
 * plausible and are wrong, which inferring the space from the feed cannot
 * detect. The operations must also be one contiguous run in sequence order,
 * because a feed missing a page would otherwise lower every count with nothing
 * reporting it. Contiguity between separate calls stays the caller's to
 * maintain: this function sees only what it is given.
 */
export function ohRecordRevisionChangesFromOperationsV1(input: Readonly<{
  key: string;
  operations: readonly OhOperationV1[];
  spaceId: string;
}>): readonly OhRecordRevisionChangeV1[] {
  if (!isPlainRecord(input) || !Array.isArray(input.operations)) {
    throw new TypeError("Invalid record revision operation input.");
  }
  const key = safeCode(input.key, 512);
  const spaceId = safeCode(input.spaceId);
  if (key === null) throw new TypeError("Invalid record key.");
  if (spaceId === null) throw new TypeError("Invalid space ID.");
  if (input.operations.length > OH_RECORD_REVISIONS_LIMITS_V1.operationsPerRead) {
    throw new RangeError(`A record revision read accepts at most ${OH_RECORD_REVISIONS_LIMITS_V1.operationsPerRead} operations.`);
  }
  const changes: OhRecordRevisionChangeV1[] = [];
  let prior: OhOperationV1 | null = null;
  for (const value of input.operations) {
    const operation = parseOhOperationV1(value);
    if (operation === null) throw new OhIntegrityError("A revision source operation is invalid.");
    if (operation.spaceId !== spaceId) {
      throw new TypeError(`A revision source operation belongs to ${operation.spaceId}, not ${spaceId}.`);
    }
    if (prior !== null && (operation.sequence !== prior.sequence + 1
      || operation.parentOperationSha256 !== prior.operationSha256)) {
      throw new TypeError("Record revision operations must be one contiguous run in sequence order.");
    }
    prior = operation;
    for (const change of operation.changes) {
      if (change.kind === "put" && change.record.key === key) {
        changes.push({ kind: "put", recordSha256: change.record.recordSha256, sequence: operation.sequence, v: 1 });
      } else if (change.kind === "tombstone" && change.key === key) {
        changes.push({ kind: "tombstone", recordSha256: change.priorSha256, sequence: operation.sequence, v: 1 });
      }
    }
    if (changes.length > OH_RECORD_REVISIONS_LIMITS_V1.changesPerKey) {
      throw new RangeError(`A record revision read accepts at most ${OH_RECORD_REVISIONS_LIMITS_V1.changesPerKey} changes.`);
    }
  }
  return changes;
}

export function transitionOhSnapshotV1(input: Readonly<{
  actorId: string;
  changes: readonly KnowledgeGraphChangeV1[];
  instant: string;
  maximumOperationBytes?: number;
  operationId: string;
  snapshot: OhSnapshotV1;
  spaceId: string;
}>): Readonly<{ operation: OhOperationV1; snapshot: OhSnapshotV1 }> {
  const actorId = safeCode(input.actorId);
  const operationId = safeCode(input.operationId);
  const spaceId = safeCode(input.spaceId);
  const instant = parseCanonicalInstantV1(input.instant);
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  if (actorId === null || operationId === null || spaceId === null || instant === null
    || changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation) {
    throw new TypeError("Invalid graph transition input.");
  }
  const head = parseOhHeadV1(input.snapshot.head);
  if (input.snapshot.v !== 1 || head === null || !Array.isArray(input.snapshot.records)) {
    throw new OhIntegrityError("The transition snapshot is invalid.");
  }
  const records = new Map<string, KnowledgeGraphRecordV1>();
  for (const value of input.snapshot.records) {
    const record = parseKnowledgeGraphRecordV1(value);
    if (record === null || records.has(record.key)) {
      throw new OhIntegrityError("The transition snapshot contains an invalid record.");
    }
    records.set(record.key, record);
  }
  verifyDependencies(records);
  const priorRecordsSha256 = canonicalSha256(sortedRecords(records.values()).map(knowledgeGraphRecordRefV1));
  if (priorRecordsSha256 !== head.recordsSha256) {
    throw new OhIntegrityError("The transition snapshot does not reproduce its head.");
  }
  for (const change of changes) {
    if (change.kind === "put") records.set(change.record.key, change.record);
    else {
      const prior = records.get(change.key);
      if (prior === undefined || prior.recordSha256 !== change.priorSha256) {
        throw new OhConflictError(`The prior digest for ${change.key} does not match the snapshot.`);
      }
      records.delete(change.key);
    }
  }
  if (records.size > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new RangeError("Graph transition exceeds its record snapshot limit.");
  }
  verifyDependencies(records);
  const nextRecords = sortedRecords(records.values());
  const recordsSha256 = canonicalSha256(nextRecords.map(knowledgeGraphRecordRefV1));
  const graphRevisionSha256 = graphRevisionSha256V1({ changes, operationId,
    parentGraphRevisionSha256: head.graphRevisionSha256, recordsSha256,
    revision: head.sequence + 1 });
  const operation = createOhOperationV1(
    { actorId, changes, contractId: OH_CONTRACT_MANIFEST_V1.contractId,
      graphRevisionSha256, instant, operationId,
      parentOperationSha256: head.operationSha256, recordsSha256,
      sequence: head.sequence + 1, spaceId, v: 1 },
    input.maximumOperationBytes === undefined ? {} : {
      maximumOperationBytes: input.maximumOperationBytes,
    },
  );
  const nextHead: OhHeadV1 = { generation: operation.sequence, graphRevisionSha256,
    operationSha256: operation.operationSha256, recordsSha256,
    sequence: operation.sequence, v: 1 };
  return { operation, snapshot: { head: nextHead, records: nextRecords, v: 1 } };
}

function normalizeRoots(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > OH_DEPENDENCY_CLOSURE_LIMITS_V1.roots) {
    throw new RangeError(`A dependency closure needs 1 through ${OH_DEPENDENCY_CLOSURE_LIMITS_V1.roots} roots.`);
  }
  const roots = values.map((value) => safeCode(value, 512));
  if (roots.some((value) => value === null)) throw new TypeError("Invalid dependency closure root.");
  const sorted = [...roots as string[]].sort();
  if (sorted.some((value, index) => index > 0 && sorted[index - 1] === value)) {
    throw new TypeError("Dependency closure roots must be unique.");
  }
  return sorted;
}

function closureRecords(
  available: ReadonlyMap<string, KnowledgeGraphRecordV1>,
  roots: readonly string[],
  maximumRecords: number,
  maximumBytes: number = OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes - 64 * 1024,
): readonly KnowledgeGraphRecordV1[] {
  const selected = new Map<string, KnowledgeGraphRecordV1>();
  const pending = [...roots];
  let selectedBytes = 0;
  while (pending.length > 0) {
    const key = pending.pop() as string;
    if (selected.has(key)) continue;
    const record = available.get(key);
    if (record === undefined) throw new OhDependencyError(`Dependency closure record ${key} is missing.`);
    selectedBytes += Buffer.byteLength(canonicalJson(record), "utf8") + 1;
    if (selectedBytes > maximumBytes) throw new RangeError("Dependency closure exceeds its canonical byte bound.");
    selected.set(key, record);
    if (selected.size > maximumRecords) throw new RangeError("Dependency closure exceeds its record bound.");
    pending.push(...record.dependencies);
  }
  return sortedRecords(selected.values());
}

export function createOhDependencyClosureV1(input: Readonly<{
  binding: OhStoreBindingV1;
  maximumRecords?: number;
  roots: readonly string[];
  snapshot: OhSnapshotV1;
}>): OhDependencyClosureV1 {
  const binding = parseOhStoreBindingV1(input.binding);
  const head = parseOhHeadV1(input.snapshot.head);
  const maximumRecords = input.maximumRecords ?? OH_DEPENDENCY_CLOSURE_LIMITS_V1.records;
  if (binding === null || head === null || !Number.isSafeInteger(maximumRecords)
    || maximumRecords < 1 || maximumRecords > OH_DEPENDENCY_CLOSURE_LIMITS_V1.records) {
    throw new TypeError("Invalid dependency closure input.");
  }
  const roots = normalizeRoots(input.roots);
  const available = new Map<string, KnowledgeGraphRecordV1>();
  for (const value of input.snapshot.records) {
    const record = parseKnowledgeGraphRecordV1(value);
    if (record === null || available.has(record.key)) throw new OhIntegrityError("Snapshot contains an invalid record.");
    available.set(record.key, record);
  }
  const recordsSha256 = canonicalSha256(sortedRecords(available.values()).map(knowledgeGraphRecordRefV1));
  if (recordsSha256 !== head.recordsSha256) throw new OhIntegrityError("Snapshot records do not reproduce its head.");
  const records = closureRecords(available, roots, maximumRecords);
  const payload = { binding, head, records, roots, v: 1 as const };
  const closure = { ...payload, closureSha256: canonicalSha256(payload) };
  if (Buffer.byteLength(canonicalJson(closure), "utf8") > OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes) {
    throw new RangeError("Dependency closure exceeds its canonical byte bound.");
  }
  return Object.freeze(closure);
}

export function parseOhDependencyClosureV1(value: unknown): OhDependencyClosureV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["binding", "closureSha256", "head",
    "records", "roots", "v"]) || value.v !== 1 || !Array.isArray(value.records)
    || !Array.isArray(value.roots) || value.records.length > OH_DEPENDENCY_CLOSURE_LIMITS_V1.records) return null;
  const binding = parseOhStoreBindingV1(value.binding);
  const head = parseOhHeadV1(value.head);
  const closureSha256 = parseSha256Hex(value.closureSha256);
  if (binding === null || head === null || closureSha256 === null) return null;
  const records = new Map<string, KnowledgeGraphRecordV1>();
  for (const item of value.records) {
    const record = parseKnowledgeGraphRecordV1(item);
    if (record === null || records.has(record.key)) return null;
    records.set(record.key, record);
  }
  try {
    const roots = normalizeRoots(value.roots as string[]);
    if (canonicalJson(roots) !== canonicalJson(value.roots)) return null;
    const exact = closureRecords(records, roots, OH_DEPENDENCY_CLOSURE_LIMITS_V1.records);
    if (canonicalJson(exact) !== canonicalJson(value.records)) return null;
    const payload = { binding, head, records: exact, roots, v: 1 as const };
    const parsed = { ...payload, closureSha256 };
    return canonicalSha256(payload) === closureSha256
        && Buffer.byteLength(canonicalJson(parsed), "utf8") <= OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes
      ? Object.freeze(parsed) : null;
  } catch { return null; }
}

export function verifyOhDependencyClosureV1(value: unknown):
  | Readonly<{ closure: OhDependencyClosureV1; ok: true }>
  | Readonly<{ ok: false; reason: "invalid-closure" }> {
  const closure = parseOhDependencyClosureV1(value);
  return closure === null ? { ok: false, reason: "invalid-closure" } : { closure, ok: true };
}

/**
 * Strong adoption check. Unlike structural self-verification, this also binds
 * the capsule to the exact store binding and head selected by trusted host code.
 */
export function verifyOhDependencyClosureAgainstV1(value: unknown, expected: Readonly<{
  binding: OhStoreBindingV1;
  head: OhHeadV1;
}>):
  | Readonly<{ closure: OhDependencyClosureV1; ok: true; verification: "expected-authority-and-head" }>
  | Readonly<{ ok: false; reason: "binding-mismatch" | "head-mismatch" | "invalid-closure" | "invalid-expectation" }> {
  const binding = parseOhStoreBindingV1(expected.binding);
  const head = parseOhHeadV1(expected.head);
  if (binding === null || head === null) return { ok: false, reason: "invalid-expectation" };
  const closure = parseOhDependencyClosureV1(value);
  if (closure === null) return { ok: false, reason: "invalid-closure" };
  if (closure.binding.bindingSha256 !== binding.bindingSha256) return { ok: false, reason: "binding-mismatch" };
  if (canonicalJson(closure.head) !== canonicalJson(head)) return { ok: false, reason: "head-mismatch" };
  return { closure, ok: true, verification: "expected-authority-and-head" };
}

export function createOhSpacePurgeReceiptV1(input: Readonly<{
  binding: OhStoreBindingV1;
  priorHead: OhHeadV1;
  purgedAt: string;
}>): OhSpacePurgeReceiptV1 {
  const binding = parseOhStoreBindingV1(input.binding);
  const priorHead = parseOhHeadV1(input.priorHead);
  const purgedAt = parseCanonicalInstantV1(input.purgedAt);
  if (binding === null || priorHead === null || purgedAt === null
    || binding.profile.profileKind !== "working"
    || !binding.profile.capabilities.wholeSpacePurge) {
    throw new OhProfileError("Only a bound working realm can produce a purge receipt.");
  }
  const payload = { bindingSha256: binding.bindingSha256, priorHead, purgedAt,
    spaceId: binding.spaceId, v: 1 as const };
  return Object.freeze({ ...payload, receiptSha256: canonicalSha256(payload) });
}

export function parseOhSpacePurgeReceiptV1(value: unknown): OhSpacePurgeReceiptV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["bindingSha256", "priorHead", "purgedAt",
    "receiptSha256", "spaceId", "v"]) || value.v !== 1) return null;
  const bindingSha256 = parseSha256Hex(value.bindingSha256);
  const priorHead = parseOhHeadV1(value.priorHead);
  const purgedAt = parseCanonicalInstantV1(value.purgedAt);
  const receiptSha256 = parseSha256Hex(value.receiptSha256);
  const spaceId = safeCode(value.spaceId);
  if (bindingSha256 === null || priorHead === null || purgedAt === null
    || receiptSha256 === null || spaceId === null) return null;
  const payload = { bindingSha256, priorHead, purgedAt, spaceId, v: 1 as const };
  return canonicalSha256(payload) === receiptSha256
    ? Object.freeze({ ...payload, receiptSha256 }) : null;
}

export type OhSemanticBundleV1 = Readonly<{
  actorId: string;
  expectedHead: Pick<OhHeadV1, "generation" | "operationSha256">;
  instant: string | null;
  operationId: string;
  puts: readonly Readonly<{
    dependencies: readonly string[];
    key: string;
    kind: KnowledgeGraphRecordKindV1;
    v: 1;
    value: unknown;
  }>[];
  tombstones: readonly Readonly<{
    key: string;
    priorSha256: Sha256Hex;
    v: 1;
  }>[];
  v: 1;
}>;

/** A strict model-facing ingress: every put must have a registered codec. */
export class OhSemanticBundleIngressV1 {
  readonly #codecs: OhRecordCodecRegistry;
  readonly #store: OhStoreV1;

  constructor(store: OhStoreV1, codecs: OhRecordCodecRegistry) {
    this.#store = store;
    this.#codecs = codecs.seal();
  }

  async commit(value: unknown): Promise<OhOperationV1> {
    if (!isPlainRecord(value) || !hasExactKeys(value, ["actorId", "expectedHead", "instant",
      "operationId", "puts", "tombstones", "v"]) || value.v !== 1
      || !Array.isArray(value.puts) || !Array.isArray(value.tombstones)
      || value.puts.length + value.tombstones.length < 1
      || value.puts.length + value.tombstones.length > OH_GRAPH_LIMITS_V1.changesPerOperation) {
      throw new TypeError("Invalid semantic bundle.");
    }
    const actorId = safeCode(value.actorId);
    const operationId = safeCode(value.operationId);
    const expected = value.expectedHead;
    const instant = value.instant === null ? undefined : parseCanonicalInstantV1(value.instant);
    if (actorId === null || operationId === null || !isPlainRecord(expected)
      || !hasExactKeys(expected, ["generation", "operationSha256"])
      || !Number.isSafeInteger(expected.generation) || (expected.generation as number) < 0
      || (expected.operationSha256 !== null && parseSha256Hex(expected.operationSha256) === null)
      || (((expected.generation as number) === 0) !== (expected.operationSha256 === null))
      || (value.instant !== null && instant === null)) throw new TypeError("Invalid semantic bundle identity.");
    const changes: KnowledgeGraphChangeV1[] = [];
    for (const item of value.puts) {
      if (!isPlainRecord(item) || !hasExactKeys(item, ["dependencies", "key", "kind", "v", "value"])
        || item.v !== 1 || !Array.isArray(item.dependencies)
        || !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.some((kind) => kind === item.kind)) {
        throw new TypeError("Invalid semantic bundle put.");
      }
      const parsed = this.#codecs.parseRequired(item.kind as KnowledgeGraphRecordKindV1, item.value);
      if (parsed === null) throw new TypeError(`The ${String(item.kind)} codec rejected a semantic value.`);
      const record = createKnowledgeGraphRecordV1({ dependencies: item.dependencies as string[],
        key: item.key as string, kind: item.kind as KnowledgeGraphRecordKindV1, v: 1, value: parsed });
      changes.push({ kind: "put", record, v: 1 });
    }
    for (const item of value.tombstones) {
      if (!isPlainRecord(item) || !hasExactKeys(item, ["key", "priorSha256", "v"]) || item.v !== 1) {
        throw new TypeError("Invalid semantic bundle tombstone.");
      }
      const priorSha256 = parseSha256Hex(item.priorSha256);
      if (typeof item.key !== "string" || priorSha256 === null) throw new TypeError("Invalid semantic bundle tombstone.");
      changes.push({ key: item.key, kind: "tombstone", priorSha256, v: 1 });
    }
    const canonical = canonicalKnowledgeGraphChangesV1(changes);
    return await this.#store.commit({ actorId, changes: canonical,
      expectedHead: { generation: expected.generation as number,
        operationSha256: expected.operationSha256 as Sha256Hex | null },
      ...(typeof instant === "string" ? { instant } : {}), operationId });
  }
}
