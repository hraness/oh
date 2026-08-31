import {
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  orderedUnique,
  parseSha256Hex,
  safeCode,
  sortUnique,
  type JsonValue,
  type Sha256Hex,
} from "./canonical";

export const OH_GRAPH_FORMAT_VERSION_V1 = 1 as const;
export const OH_GRAPH_LIMITS_V1 = Object.freeze({
  changesPerOperation: 8_192,
  dependenciesPerRecord: 4_096,
  recordBytes: 1024 * 1024,
  recordsPerSnapshot: 65_536,
});

export const OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 = [
  "activity", "assertion", "context", "dependency-manifest", "edition", "entity",
  "evidence", "identity-operation", "inquiry", "inquiry-event", "review-decision",
  "rights-decision", "schema", "shape", "statement", "type-membership", "view",
  "vocabulary",
] as const;
export type KnowledgeGraphRecordKindV1 = (typeof OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1)[number];

export type KnowledgeGraphRecordV1 = Readonly<{
  dependencies: readonly string[];
  key: string;
  kind: KnowledgeGraphRecordKindV1;
  recordSha256: Sha256Hex;
  v: 1;
  value: JsonValue;
}>;
export type KnowledgeGraphRecordInputV1 = Omit<KnowledgeGraphRecordV1, "recordSha256">;

export type KnowledgeGraphRecordRefV1 = Readonly<{
  dependencies: readonly string[];
  key: string;
  kind: KnowledgeGraphRecordKindV1;
  sha256: Sha256Hex;
  v: 1;
}>;

const KNOWLEDGE_GRAPH_RECORD_KEYS_V1 = [
  "dependencies", "key", "kind", "recordSha256", "v", "value",
] as const;

function exactKnowledgeGraphRecordEnvelopeV1(value: unknown): Record<string, unknown> | null {
  try {
    if (!isPlainRecord(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== KNOWLEDGE_GRAPH_RECORD_KEYS_V1.length
      || ownKeys.some((key) => typeof key !== "string")
      || KNOWLEDGE_GRAPH_RECORD_KEYS_V1.some((key) => !ownKeys.includes(key))) return null;
    const detached: Record<string, unknown> = {};
    for (const key of KNOWLEDGE_GRAPH_RECORD_KEYS_V1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable
        || descriptor.get !== undefined || descriptor.set !== undefined) return null;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch {
    return null;
  }
}

function exactGraphDependenciesV1(value: unknown): readonly unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length)
      || length < 0 || length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || !ownKeys.includes("length")
      || ownKeys.some((key) => key !== "length" && (typeof key !== "string"
        || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) return null;
    const detached: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable
        || descriptor.get !== undefined || descriptor.set !== undefined) return null;
      detached.push(descriptor.value);
    }
    return detached;
  } catch {
    return null;
  }
}

function recordKey(value: unknown): string | null {
  return typeof value === "string" && value.length <= 512
      && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value)
    ? value : null;
}

export function createKnowledgeGraphRecordV1(input: KnowledgeGraphRecordInputV1): KnowledgeGraphRecordV1 {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["dependencies", "key", "kind", "v", "value"])
    || input.v !== 1) throw new TypeError("Invalid graph record input.");
  const dependencyInput = exactGraphDependenciesV1(input.dependencies);
  if (dependencyInput === null) throw new TypeError("Invalid graph record dependencies.");
  const key = recordKey(input.key);
  const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === input.kind);
  if (key === null || kind === undefined) throw new TypeError("Invalid graph record identity.");
  const dependencies = dependencyInput.map(recordKey);
  if (dependencies.some((dependency) => dependency === null)
    || !orderedUnique(dependencies as string[], String) || dependencies.includes(key)) {
    throw new TypeError("Graph dependencies must be ordered, unique, and non-reflexive.");
  }
  const valueJson = canonicalJson(input.value);
  if (Buffer.byteLength(valueJson, "utf8") > OH_GRAPH_LIMITS_V1.recordBytes) {
    throw new RangeError("Graph record value exceeds its canonical byte limit.");
  }
  const payload = { dependencies: dependencies as string[], key, kind, v: 1 as const, value: input.value };
  return { ...payload, recordSha256: canonicalSha256(payload) };
}

export function parseKnowledgeGraphRecordV1(value: unknown): KnowledgeGraphRecordV1 | null {
  const envelope = exactKnowledgeGraphRecordEnvelopeV1(value);
  if (envelope === null) return null;
  const recordSha256 = parseSha256Hex(envelope.recordSha256);
  const input = {
    dependencies: envelope.dependencies,
    key: envelope.key,
    kind: envelope.kind,
    v: envelope.v,
    value: envelope.value,
  };
  try {
    const created = createKnowledgeGraphRecordV1(input as unknown as KnowledgeGraphRecordInputV1);
    return recordSha256 !== null && created.recordSha256 === recordSha256
      ? { ...created, recordSha256 } : null;
  } catch { return null; }
}

export function knowledgeGraphRecordRefV1(record: KnowledgeGraphRecordV1): KnowledgeGraphRecordRefV1 {
  return { dependencies: record.dependencies, key: record.key, kind: record.kind,
    sha256: record.recordSha256, v: 1 };
}

export type KnowledgeGraphChangeV1 =
  | Readonly<{ kind: "put"; record: KnowledgeGraphRecordV1; v: 1 }>
  | Readonly<{ key: string; kind: "tombstone"; priorSha256: Sha256Hex; v: 1 }>;

export type KnowledgeGraphRevisionV1 = Readonly<{
  changes: readonly KnowledgeGraphChangeV1[];
  graphRevisionSha256: Sha256Hex;
  operationId: string;
  parentGraphRevisionSha256: Sha256Hex | null;
  recordRefs: readonly KnowledgeGraphRecordRefV1[];
  recordsSha256: Sha256Hex;
  revision: number;
  v: 1;
}>;

function changeKey(change: KnowledgeGraphChangeV1): string {
  return change.kind === "put" ? change.record.key : change.key;
}

export function canonicalKnowledgeGraphChangesV1(changes: readonly KnowledgeGraphChangeV1[]): readonly KnowledgeGraphChangeV1[] {
  const normalized: KnowledgeGraphChangeV1[] = [];
  for (const change of changes) {
    if (!isPlainRecord(change) || change.v !== 1) throw new TypeError("Invalid graph change.");
    if (change.kind === "put") {
      const record = parseKnowledgeGraphRecordV1(change.record);
      if (record === null) throw new TypeError("Invalid graph record in change.");
      normalized.push({ kind: "put", record, v: 1 });
    } else if (change.kind === "tombstone") {
      const key = recordKey(change.key);
      const priorSha256 = parseSha256Hex(change.priorSha256);
      if (key === null || priorSha256 === null) throw new TypeError("Invalid graph tombstone.");
      normalized.push({ key, kind: "tombstone", priorSha256, v: 1 });
    } else throw new TypeError("Unknown graph change kind.");
  }
  return sortUnique(normalized, changeKey);
}

/** Hashes the canonical graph transition envelope used by snapshots and operations. */
export function graphRevisionSha256V1(input: Readonly<{
  changes: readonly KnowledgeGraphChangeV1[];
  operationId: string;
  parentGraphRevisionSha256: Sha256Hex | null;
  recordsSha256: Sha256Hex;
  revision: number;
}>): Sha256Hex {
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  const operationId = safeCode(input.operationId);
  const parentGraphRevisionSha256 = input.parentGraphRevisionSha256 === null
    ? null : parseSha256Hex(input.parentGraphRevisionSha256);
  const recordsSha256 = parseSha256Hex(input.recordsSha256);
  const revision = Number.isSafeInteger(input.revision) && input.revision > 0 ? input.revision : null;
  if (changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation
    || operationId === null || recordsSha256 === null || revision === null
    || (input.parentGraphRevisionSha256 !== null && parentGraphRevisionSha256 === null)
    || ((revision === 1) !== (parentGraphRevisionSha256 === null))) {
    throw new TypeError("Invalid graph revision digest input.");
  }
  return canonicalSha256({ changes, operationId, parentGraphRevisionSha256, recordsSha256, revision, v: 1 });
}

export function createKnowledgeGraphRevisionV1(input: Readonly<{
  changes: readonly KnowledgeGraphChangeV1[];
  operationId: string;
  parent: KnowledgeGraphRevisionV1 | null;
}>): KnowledgeGraphRevisionV1 {
  if (input.parent !== null && parseKnowledgeGraphRevisionV1(input.parent) === null) {
    throw new TypeError("Invalid parent graph revision.");
  }
  const operationId = safeCode(input.operationId);
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  if (operationId === null || changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation) throw new TypeError("Invalid graph revision.");
  const byKey = new Map((input.parent?.recordRefs ?? []).map((ref) => [ref.key, ref]));
  for (const change of changes) {
    if (change.kind === "put") {
      for (const dependency of change.record.dependencies) {
        if (!byKey.has(dependency) && !changes.some((candidate) => candidate.kind === "put" && candidate.record.key === dependency)) {
          throw new TypeError(`Missing graph dependency: ${dependency}`);
        }
      }
      byKey.set(change.record.key, knowledgeGraphRecordRefV1(change.record));
    } else {
      const prior = byKey.get(change.key);
      if (prior === undefined || prior.sha256 !== change.priorSha256) throw new TypeError("Tombstone prior digest does not match.");
      byKey.delete(change.key);
    }
  }
  if (byKey.size > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new RangeError("Graph revision exceeds its record snapshot limit.");
  }
  for (const ref of byKey.values()) {
    if (ref.dependencies.some((dependency) => !byKey.has(dependency))) {
      throw new TypeError(`Missing graph dependency after revision: ${ref.key}`);
    }
  }
  const recordRefs = [...byKey.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const recordsSha256 = canonicalSha256(recordRefs);
  const payload = { changes, operationId, parentGraphRevisionSha256: input.parent?.graphRevisionSha256 ?? null,
    recordRefs, recordsSha256, revision: (input.parent?.revision ?? 0) + 1, v: 1 as const };
  return { ...payload, graphRevisionSha256: graphRevisionSha256V1(payload) };
}

export function parseKnowledgeGraphRevisionV1(value: unknown): KnowledgeGraphRevisionV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["changes", "graphRevisionSha256", "operationId",
    "parentGraphRevisionSha256", "recordRefs", "recordsSha256", "revision", "v"]) || value.v !== 1
    || !Array.isArray(value.changes) || !Array.isArray(value.recordRefs)
    || value.recordRefs.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) return null;
  const graphRevisionSha256 = parseSha256Hex(value.graphRevisionSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const parentGraphRevisionSha256 = value.parentGraphRevisionSha256 === null
    ? null : parseSha256Hex(value.parentGraphRevisionSha256);
  const operationId = safeCode(value.operationId);
  const revision = Number.isSafeInteger(value.revision) && (value.revision as number) > 0 ? value.revision as number : null;
  let changes: readonly KnowledgeGraphChangeV1[];
  try { changes = canonicalKnowledgeGraphChangesV1(value.changes as KnowledgeGraphChangeV1[]); } catch { return null; }
  const refs: KnowledgeGraphRecordRefV1[] = [];
  for (const item of value.recordRefs) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["dependencies", "key", "kind", "sha256", "v"])
      || item.v !== 1 || !Array.isArray(item.dependencies)) return null;
    const dependencies = item.dependencies.map(recordKey);
    const key = recordKey(item.key);
    const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === item.kind);
    const sha256 = parseSha256Hex(item.sha256);
    if (key === null || kind === undefined || sha256 === null
      || dependencies.some((dependency) => dependency === null)
      || dependencies.length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord
      || !orderedUnique(dependencies as string[], String) || dependencies.includes(key)) return null;
    refs.push({ dependencies: dependencies as string[], key, kind, sha256, v: 1 });
  }
  if (graphRevisionSha256 === null || recordsSha256 === null || operationId === null || revision === null
    || (value.parentGraphRevisionSha256 !== null && parentGraphRevisionSha256 === null)
    || !orderedUnique(refs, (ref) => ref.key) || canonicalSha256(refs) !== recordsSha256) return null;
  const keys = new Set(refs.map((ref) => ref.key));
  if (refs.some((ref) => ref.dependencies.some((dependency) => !keys.has(dependency)))) return null;
  const payload = { changes, operationId, parentGraphRevisionSha256, recordRefs: refs,
    recordsSha256, revision, v: 1 as const };
  try {
    return graphRevisionSha256V1(payload) === graphRevisionSha256 ? { ...payload, graphRevisionSha256 } : null;
  } catch { return null; }
}

/** Deterministically reduces a revision chain and rejects gaps, forks, and false snapshots. */
export function reduceKnowledgeGraphRevisionsV1(revisions: readonly KnowledgeGraphRevisionV1[]): KnowledgeGraphRevisionV1 | null {
  if (revisions.length === 0 || revisions.length > 65_536) return null;
  const ordered = [...revisions].sort((left, right) => left.revision - right.revision);
  let parent: KnowledgeGraphRevisionV1 | null = null;
  const operationIds = new Set<string>();
  for (const candidate of ordered) {
    const current = parseKnowledgeGraphRevisionV1(candidate);
    if (current === null || current.revision !== (parent?.revision ?? 0) + 1
      || current.parentGraphRevisionSha256 !== (parent?.graphRevisionSha256 ?? null)
      || operationIds.has(current.operationId)) return null;
    try {
      const rebuilt = createKnowledgeGraphRevisionV1({ changes: current.changes, operationId: current.operationId, parent });
      if (rebuilt.graphRevisionSha256 !== current.graphRevisionSha256) return null;
    } catch { return null; }
    operationIds.add(current.operationId);
    parent = current;
  }
  return parent;
}
