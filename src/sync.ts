import { isProxy } from "node:util/types";

import {
  canonicalJson,
  canonicalSha256,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  utf8ByteLength,
  type Sha256Hex,
} from "./canonical";
import { OH_CONTRACT_MANIFEST_V1, parseOhContractManifestV1, type OhContractManifestV1 } from "./contract";
import { OH_GRAPH_LIMITS_V1 } from "./graph";
import { OH_CONTRACT_ID_V1 } from "./ontology";
import { OH_OPERATION_MAX_BYTES_V1, parseOhOperationV1, type OhOperationV1 } from "./operation";
import type { OhSqliteStore } from "./sqlite/store";
import type { OhHeadRefV1 } from "./store";

export const OH_SYNC_PROTOCOL_V1 = "oh.sync.v1" as const;

export type OhSyncHeadV1 = Readonly<{
  operationSha256: Sha256Hex | null;
  sequence: number;
  v: 1;
}>;

const OH_SYNC_BUNDLE_MAX_OPERATIONS_V1 = 1000;
const OH_SYNC_BUNDLE_KEYS_V1 = [
  "bundleSha256", "contractSha256", "operations", "protocol", "spaceId", "v",
] as const;
const OH_SYNC_HEAD_KEYS_V1 = ["operationSha256", "sequence", "v"] as const;
const OH_SYNC_HEAD_REF_KEYS_V1 = ["operationSha256", "sequence"] as const;
const OH_OPERATION_KEYS_V1 = [
  "actorId", "changes", "contractId", "graphRevisionSha256", "instant", "operationId",
  "operationSha256", "parentOperationSha256", "recordsSha256", "sequence", "spaceId", "v",
] as const;
const OH_PUT_CHANGE_KEYS_V1 = ["kind", "record", "v"] as const;
const OH_TOMBSTONE_CHANGE_KEYS_V1 = ["key", "kind", "priorSha256", "v"] as const;
const OH_RECORD_KEYS_V1 = ["dependencies", "key", "kind", "recordSha256", "v", "value"] as const;
const OH_SYNC_INGRESS_VALUE_DEPTH_V1 = 128;
const OH_SYNC_INGRESS_VALUE_NODES_V1 = OH_GRAPH_LIMITS_V1.recordBytes;
const OH_SYNC_INGRESS_OPERATION_DEPTH_V1 = OH_SYNC_INGRESS_VALUE_DEPTH_V1 + 4;
const OH_SYNC_INGRESS_OPERATION_NODES_V1 = OH_OPERATION_MAX_BYTES_V1;
export const OH_SYNC_BUNDLE_MAX_BYTES_V1 = OH_OPERATION_MAX_BYTES_V1 + 4 * 1024;
const OH_SYNC_INGRESS_BUNDLE_NODES_V1 = OH_SYNC_INGRESS_OPERATION_NODES_V1 + 4 * 1024;

type SyncIngressBudgetV1 = {
  bytes: number;
  maximumBytes: number;
  maximumNodes: number;
  nodes: number;
};

type SyncIngressTraversalLimitsV1 = Readonly<{
  maximumBytes: number;
  maximumDepth: number;
  maximumNodes: number;
}>;

function exactDataRecordV1(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if ((prototype !== Object.prototype && prototype !== null)
      || keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string")
      || expectedKeys.some((key) => !keys.includes(key))) return null;
    const detached = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable
        || descriptor.get !== undefined || descriptor.set !== undefined) return null;
      Object.defineProperty(detached, key, { configurable: false, enumerable: true,
        value: descriptor.value, writable: false });
    }
    return detached;
  } catch {
    return null;
  }
}

function exactDataArrayV1(
  value: unknown,
  maximumLength: number,
  clone = true,
): readonly unknown[] | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length)
      || length < 0 || length > maximumLength) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length")
      || keys.some((key) => key !== "length" && (typeof key !== "string"
        || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) return null;
    const detached: unknown[] | null = clone ? [] : null;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable
        || descriptor.get !== undefined || descriptor.set !== undefined) return null;
      detached?.push(descriptor.value);
    }
    return detached ?? value as readonly unknown[];
  } catch {
    return null;
  }
}

function stagedSyncOperationV1(
  value: unknown,
  bundleBudget: SyncIngressBudgetV1,
): Record<string, unknown> | null {
  const operation = exactDataRecordV1(value, OH_OPERATION_KEYS_V1);
  if (operation === null || operation.v !== 1 || operation.contractId !== OH_CONTRACT_ID_V1
    || safeCode(operation.actorId) === null || safeCode(operation.operationId) === null
    || safeCode(operation.spaceId) === null || parseCanonicalInstantV1(operation.instant) === null
    || parseSha256Hex(operation.operationSha256) === null
    || parseSha256Hex(operation.graphRevisionSha256) === null
    || parseSha256Hex(operation.recordsSha256) === null) return null;
  const parentOperationSha256 = operation.parentOperationSha256 === null
    ? null : parseSha256Hex(operation.parentOperationSha256);
  const sequence = Number.isSafeInteger(operation.sequence) && (operation.sequence as number) > 0
    ? operation.sequence as number : null;
  if (sequence === null || (operation.parentOperationSha256 !== null && parentOperationSha256 === null)
    || ((sequence === 1) !== (parentOperationSha256 === null))) return null;
  const changes = exactDataArrayV1(
    operation.changes, OH_GRAPH_LIMITS_V1.changesPerOperation, false);
  if (changes === null || changes.length === 0) return null;
  const aggregateDataBudget: SyncIngressBudgetV1 = {
    bytes: 0,
    maximumBytes: OH_OPERATION_MAX_BYTES_V1,
    maximumNodes: OH_SYNC_INGRESS_OPERATION_NODES_V1,
    nodes: 0,
  };
  for (const change of changes) {
    const put = exactDataRecordV1(change, OH_PUT_CHANGE_KEYS_V1);
    if (put !== null && put.kind === "put" && put.v === 1) {
      const record = exactDataRecordV1(put.record, OH_RECORD_KEYS_V1);
      if (record === null) return null;
      const valuePreflight = preflightSyncIngressValueV1(record.value, aggregateDataBudget);
      const dependenciesPreflight = preflightSyncIngressDependenciesV1(
        record.dependencies, aggregateDataBudget);
      if (valuePreflight === null || dependenciesPreflight === null) return null;
      continue;
    }
    const tombstone = exactDataRecordV1(change, OH_TOMBSTONE_CHANGE_KEYS_V1);
    if (tombstone === null || tombstone.kind !== "tombstone" || tombstone.v !== 1) return null;
  }
  const detached = boundedSyncIngressV1(operation, {
    maximumBytes: OH_OPERATION_MAX_BYTES_V1,
    maximumDepth: OH_SYNC_INGRESS_OPERATION_DEPTH_V1,
    maximumNodes: OH_SYNC_INGRESS_OPERATION_NODES_V1,
  }, bundleBudget, true);
  return detached === null ? null : detached.value as Record<string, unknown>;
}

function canonicalStringBytesV1(value: string, maximumBytes: number): number {
  if (value.length + 2 > maximumBytes) throw new RangeError("String exceeds its canonical byte budget.");
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("Invalid Unicode string.");
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Invalid Unicode string.");
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
    if (bytes > maximumBytes) throw new RangeError("String exceeds its canonical byte budget.");
  }
  return bytes;
}

function boundedSyncIngressV1(
  value: unknown,
  limits: SyncIngressTraversalLimitsV1,
  aggregate: SyncIngressBudgetV1 | null,
  clone: boolean,
): Readonly<{ value: unknown }> | null {
  const ancestors = new Set<object>();
  const budget: SyncIngressBudgetV1 = {
    bytes: 0,
    maximumBytes: limits.maximumBytes,
    maximumNodes: limits.maximumNodes,
    nodes: 0,
  };
  const canSpendBytes = (count: number): boolean => budget.bytes + count <= budget.maximumBytes
    && (aggregate === null || aggregate.bytes + count <= aggregate.maximumBytes);
  const spendBytes = (count: number): void => {
    if (!canSpendBytes(count)) throw new RangeError("Sync ingress exceeds its canonical byte budget.");
    budget.bytes += count;
    if (aggregate !== null) aggregate.bytes += count;
  };
  const canSpendNodes = (count: number): boolean => budget.nodes + count <= budget.maximumNodes
    && (aggregate === null || aggregate.nodes + count <= aggregate.maximumNodes);
  const spendNode = (): void => {
    if (!canSpendNodes(1)) throw new RangeError("Sync ingress exceeds its node budget.");
    budget.nodes += 1;
    if (aggregate !== null) aggregate.nodes += 1;
  };
  const detach = (candidate: unknown, depth: number): unknown => {
    if (depth > limits.maximumDepth) throw new RangeError("Sync ingress exceeds its depth budget.");
    spendNode();
    if (candidate === null) {
      spendBytes(4);
      return candidate;
    }
    if (typeof candidate === "boolean") {
      spendBytes(candidate ? 4 : 5);
      return candidate;
    }
    if (typeof candidate === "string") {
      spendBytes(canonicalStringBytesV1(candidate, Math.min(
        budget.maximumBytes - budget.bytes,
        aggregate === null ? Number.MAX_SAFE_INTEGER : aggregate.maximumBytes - aggregate.bytes,
      )));
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) throw new TypeError("Invalid number.");
      spendBytes(utf8ByteLength(canonicalJson(candidate)));
      return candidate;
    }
    if (typeof candidate !== "object" || isProxy(candidate)) throw new TypeError("Invalid data value.");
    if (ancestors.has(candidate)) throw new TypeError("Cyclic data value.");
    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, "length");
        const length = lengthDescriptor?.value;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0
          || !canSpendNodes(length)
          || !canSpendBytes(2 + Math.max(0, length - 1) + length)) {
          throw new TypeError("Invalid or over-budget data array.");
        }
        const keys = Reflect.ownKeys(candidate);
        if (keys.length !== length + 1 || !keys.includes("length")
          || keys.some((key) => key !== "length" && (typeof key !== "string"
            || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) {
          throw new TypeError("Invalid data array.");
        }
        spendBytes(2 + Math.max(0, length - 1));
        const detached: unknown[] | null = clone ? [] : null;
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (descriptor === undefined || !descriptor.enumerable
            || descriptor.get !== undefined || descriptor.set !== undefined) {
            throw new TypeError("Invalid data array entry.");
          }
          const item = detach(descriptor.value, depth + 1);
          detached?.push(item);
        }
        return detached === null ? candidate : Object.freeze(detached);
      }
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Invalid data object.");
      }
      let containerBytes = 2;
      let properties = 0;
      for (const key in candidate) {
        if (!Object.hasOwn(candidate, key)) continue;
        properties += 1;
        if (!canSpendNodes(properties)) throw new RangeError("Sync ingress exceeds its node budget.");
        const remainingBytes = Math.min(
          budget.maximumBytes - budget.bytes - containerBytes - properties,
          aggregate === null ? Number.MAX_SAFE_INTEGER
            : aggregate.maximumBytes - aggregate.bytes - containerBytes - properties,
        );
        containerBytes += (properties === 1 ? 0 : 1)
          + canonicalStringBytesV1(key, remainingBytes) + 1;
        if (!canSpendBytes(containerBytes + properties)) {
          throw new RangeError("Sync ingress exceeds its canonical byte budget.");
        }
      }
      const keys = Reflect.ownKeys(candidate);
      if (keys.length !== properties || keys.some((key) => typeof key !== "string")) {
        throw new TypeError("Invalid data object.");
      }
      spendBytes(containerBytes);
      const detached: Record<string, unknown> | null = clone
        ? Object.create(null) as Record<string, unknown>
        : null;
      for (const key of keys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (descriptor === undefined || !descriptor.enumerable
          || descriptor.get !== undefined || descriptor.set !== undefined) {
          throw new TypeError("Invalid data property.");
        }
        const item = detach(descriptor.value, depth + 1);
        if (detached !== null) {
          Object.defineProperty(detached, key, { configurable: false, enumerable: true,
            value: item, writable: false });
        }
      }
      return detached === null ? candidate : Object.freeze(detached);
    } finally {
      ancestors.delete(candidate);
    }
  };
  try {
    return Object.freeze({ value: detach(value, 0) });
  } catch {
    return null;
  }
}

function preflightSyncIngressValueV1(
  value: unknown,
  aggregate: SyncIngressBudgetV1,
): Readonly<{ value: unknown }> | null {
  return boundedSyncIngressV1(value, {
    maximumBytes: OH_GRAPH_LIMITS_V1.recordBytes,
    maximumDepth: OH_SYNC_INGRESS_VALUE_DEPTH_V1,
    maximumNodes: OH_SYNC_INGRESS_VALUE_NODES_V1,
  }, aggregate, false);
}

function preflightSyncIngressDependenciesV1(
  value: unknown,
  aggregate: SyncIngressBudgetV1,
): Readonly<{ value: unknown }> | null {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value)) {
      return null;
    }
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0
      || length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord) return null;
    // Every valid dependency is an ASCII record key of at most 512 characters.
    const maximumBytes = length === 0 ? 2 : 1 + length * 515;
    return boundedSyncIngressV1(value, {
      maximumBytes,
      maximumDepth: 1,
      maximumNodes: length + 1,
    }, aggregate, false);
  } catch {
    return null;
  }
}

function syncIngressBundleBudgetV1(spaceId: string): SyncIngressBudgetV1 {
  const emptyBundle = {
    bundleSha256: "0".repeat(64),
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    operations: [],
    protocol: OH_SYNC_PROTOCOL_V1,
    spaceId,
    v: 1,
  };
  return {
    bytes: utf8ByteLength(canonicalJson(emptyBundle)),
    maximumBytes: OH_SYNC_BUNDLE_MAX_BYTES_V1,
    maximumNodes: OH_SYNC_INGRESS_BUNDLE_NODES_V1,
    // Root, five scalar fields, and the operations array.
    nodes: 7,
  };
}

function spendSyncIngressBudgetV1(
  budget: SyncIngressBudgetV1,
  bytes: number,
  nodes = 0,
): boolean {
  if (budget.bytes + bytes > budget.maximumBytes
    || budget.nodes + nodes > budget.maximumNodes) return false;
  budget.bytes += bytes;
  budget.nodes += nodes;
  return true;
}

function measureSyncOperationV1(operation: OhOperationV1): SyncIngressBudgetV1 | null {
  const measurement: SyncIngressBudgetV1 = {
    bytes: 0,
    maximumBytes: OH_OPERATION_MAX_BYTES_V1,
    maximumNodes: OH_SYNC_INGRESS_OPERATION_NODES_V1,
    nodes: 0,
  };
  return boundedSyncIngressV1(operation, {
    maximumBytes: OH_OPERATION_MAX_BYTES_V1,
    maximumDepth: OH_SYNC_INGRESS_OPERATION_DEPTH_V1,
    maximumNodes: OH_SYNC_INGRESS_OPERATION_NODES_V1,
  }, measurement, false) === null ? null : measurement;
}

function buildOhSyncBundleV1(
  parsedSpaceId: string,
  operations: readonly OhOperationV1[],
  largestFittingPrefix: boolean,
): OhSyncBundleV1 {
  let priorSequence: number | null = null;
  let priorSha256: Sha256Hex | null = null;
  const parsed: OhOperationV1[] = [];
  const bundleBudget = syncIngressBundleBudgetV1(parsedSpaceId);
  for (const candidate of operations) {
    const operation = parseOhOperationV1(candidate);
    if (operation === null || operation.spaceId !== parsedSpaceId
      || (priorSequence !== null && operation.sequence !== priorSequence + 1)
      || (priorSequence !== null && operation.parentOperationSha256 !== priorSha256)) {
      throw new TypeError("Sync operations must form one ordered chain.");
    }
    const measurement = measureSyncOperationV1(operation);
    if (measurement === null) {
      throw new RangeError("Sync operation exceeds its canonical byte, node, or depth limit.");
    }
    if (!spendSyncIngressBudgetV1(bundleBudget,
      measurement.bytes + (parsed.length === 0 ? 0 : 1), measurement.nodes)) {
      if (largestFittingPrefix && parsed.length > 0) break;
      throw new RangeError("Sync bundle exceeds its canonical byte or node limit.");
    }
    parsed.push(operation);
    priorSequence = operation.sequence;
    priorSha256 = operation.operationSha256;
  }
  const payload = { contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    operations: parsed, protocol: OH_SYNC_PROTOCOL_V1, spaceId: parsedSpaceId, v: 1 as const };
  return { ...payload, bundleSha256: canonicalSha256(payload) };
}

function parseSyncHeadRefEnvelopeV1(value: Record<string, unknown>): OhHeadRefV1 | null {
  const operationSha256 = value.operationSha256 === null
    ? null
    : parseSha256Hex(value.operationSha256);
  const sequence = Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0
    && !Object.is(value.sequence, -0)
    ? value.sequence as number
    : null;
  return sequence !== null
    && (value.operationSha256 === null || operationSha256 !== null)
    && ((sequence === 0) === (operationSha256 === null))
    ? { operationSha256, sequence }
    : null;
}

export function parseOhSyncHeadRefV1(value: unknown): OhHeadRefV1 | null {
  const reference = exactDataRecordV1(value, OH_SYNC_HEAD_REF_KEYS_V1);
  return reference === null ? null : parseSyncHeadRefEnvelopeV1(reference);
}

export function parseOhSyncHeadV1(value: unknown): OhSyncHeadV1 | null {
  const envelope = exactDataRecordV1(value, OH_SYNC_HEAD_KEYS_V1);
  if (envelope === null || envelope.v !== 1) return null;
  const reference = parseSyncHeadRefEnvelopeV1(envelope);
  return reference === null ? null : { ...reference, v: 1 };
}

export type OhSyncBundleV1 = Readonly<{
  bundleSha256: Sha256Hex;
  contractSha256: Sha256Hex;
  operations: readonly OhOperationV1[];
  protocol: typeof OH_SYNC_PROTOCOL_V1;
  spaceId: string;
  v: 1;
}>;

export function createOhSyncBundleV1(
  spaceId: string,
  operations: readonly OhOperationV1[],
  options: Readonly<{ largestFittingPrefix?: boolean }> = {},
): OhSyncBundleV1 {
  const parsedSpaceId = safeCode(spaceId);
  const largestFittingPrefix = options.largestFittingPrefix ?? false;
  if (parsedSpaceId === null || operations.length > OH_SYNC_BUNDLE_MAX_OPERATIONS_V1
    || typeof largestFittingPrefix !== "boolean") {
    throw new TypeError("Invalid sync bundle.");
  }
  return buildOhSyncBundleV1(parsedSpaceId, operations, largestFittingPrefix);
}

export function parseOhSyncBundleV1(value: unknown): OhSyncBundleV1 | null {
  const envelope = exactDataRecordV1(value, OH_SYNC_BUNDLE_KEYS_V1);
  if (envelope === null || envelope.protocol !== OH_SYNC_PROTOCOL_V1 || envelope.v !== 1) return null;
  const bundleSha256 = parseSha256Hex(envelope.bundleSha256);
  const contractSha256 = parseSha256Hex(envelope.contractSha256);
  const spaceId = safeCode(envelope.spaceId);
  if (bundleSha256 === null || contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256
    || spaceId === null) return null;
  const operations = exactDataArrayV1(envelope.operations, OH_SYNC_BUNDLE_MAX_OPERATIONS_V1);
  if (operations === null) return null;
  const detachedOperations: unknown[] = [];
  const bundleBudget = syncIngressBundleBudgetV1(spaceId);
  for (const operation of operations) {
    if (detachedOperations.length > 0 && !spendSyncIngressBudgetV1(bundleBudget, 1)) return null;
    const detached = stagedSyncOperationV1(operation, bundleBudget);
    if (detached === null) return null;
    detachedOperations.push(detached);
  }
  try {
    const created = createOhSyncBundleV1(spaceId, detachedOperations as OhOperationV1[]);
    if (detachedOperations.some((operation, index) =>
      canonicalJson(operation) !== canonicalJson(created.operations[index]))) return null;
    return created.bundleSha256 === bundleSha256 ? { ...created, bundleSha256 } : null;
  } catch { return null; }
}

export interface OhOperationSyncTransportV1 {
  handshake(manifest: OhContractManifestV1): Promise<void>;
  head(spaceId: string): Promise<OhSyncHeadV1>;
  pull(spaceId: string, afterSequence: number, limit: number): Promise<OhSyncBundleV1>;
  push(bundle: OhSyncBundleV1): Promise<OhSyncHeadV1>;
}

export type OhSyncResultV1 = Readonly<{
  head: OhSyncHeadV1;
  pulled: number;
  pushed: number;
  rounds: number;
  v: 1;
}>;

/**
 * Reconciles only fast-forward histories. Concurrent heads fail closed and leave
 * both logs intact for an explicit merge operation.
 */
export async function synchronizeOhStoreV1(
  store: OhSqliteStore,
  transport: OhOperationSyncTransportV1,
  options: Readonly<{ batchSize?: number; maximumRounds?: number; remoteId?: string }> = {},
): Promise<OhSyncResultV1> {
  const batchSize = options.batchSize ?? 100;
  const maximumRounds = options.maximumRounds ?? 100;
  const remoteId = safeCode(options.remoteId ?? "default");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000
    || !Number.isSafeInteger(maximumRounds) || maximumRounds < 1 || maximumRounds > 10_000
    || remoteId === null) throw new TypeError("Invalid sync options.");
  await transport.handshake(OH_CONTRACT_MANIFEST_V1);
  let pulled = 0;
  let pushed = 0;
  const settled = (head: OhSyncHeadV1, rounds: number): OhSyncResultV1 => {
    store.updateSyncState(remoteId, { pulledSequence: head.sequence,
      pushedSequence: head.sequence, remoteHeadSha256: head.operationSha256 });
    return { head, pulled, pushed, rounds, v: 1 };
  };
  for (let round = 1; round <= maximumRounds; round += 1) {
    const remote = parseOhSyncHeadV1(await transport.head(store.spaceId));
    if (remote === null) throw new Error("The sync transport returned an invalid head.");
    const local = store.head();
    if (local.sequence === remote.sequence) {
      if (local.operationSha256 !== remote.operationSha256) {
        throw new Error("Sync conflict: equal sequence numbers have different heads.");
      }
      return settled(remote, round);
    }
    if (local.sequence < remote.sequence) {
      const bundle = parseOhSyncBundleV1(await transport.pull(store.spaceId, local.sequence, batchSize));
      const terminal = bundle?.operations.at(-1);
      if (bundle === null || bundle.operations.length === 0
        || bundle.operations.length > batchSize
        || bundle.spaceId !== store.spaceId
        || bundle.operations[0]?.sequence !== local.sequence + 1
        || bundle.operations[0]?.parentOperationSha256 !== local.operationSha256
        || terminal === undefined || terminal.sequence > remote.sequence
        || (terminal.sequence === remote.sequence
          && terminal.operationSha256 !== remote.operationSha256)) {
        throw new Error("Sync conflict: remote history does not extend the local head.");
      }
      store.importOperations({
        expectedHead: {
          operationSha256: local.operationSha256,
          sequence: local.sequence,
        },
        operations: bundle.operations,
      });
      pulled += bundle.operations.length;
      const afterPull = store.head();
      if (afterPull.sequence === remote.sequence
        && afterPull.operationSha256 === remote.operationSha256) {
        const confirmed = parseOhSyncHeadV1(await transport.head(store.spaceId));
        if (confirmed === null) throw new Error("The sync transport returned an invalid head.");
        const confirmedLocal = store.head();
        if (confirmed.sequence === remote.sequence
          && confirmed.operationSha256 === remote.operationSha256
          && confirmedLocal.sequence === confirmed.sequence
          && confirmedLocal.operationSha256 === confirmed.operationSha256) {
          return settled(confirmed, round);
        }
      }
    } else {
      const candidates = store.changesSince({
        operationSha256: remote.operationSha256,
        sequence: remote.sequence,
      }, {
        limit: batchSize,
        through: {
          operationSha256: local.operationSha256,
          sequence: local.sequence,
        },
      }).operations;
      if (candidates.length === 0 || candidates[0]?.sequence !== remote.sequence + 1
        || candidates[0]?.parentOperationSha256 !== remote.operationSha256) {
        throw new Error("Sync conflict: local history does not extend the remote head.");
      }
      const bundle = createOhSyncBundleV1(store.spaceId, candidates, {
        largestFittingPrefix: true,
      });
      const operations = bundle.operations;
      const head = parseOhSyncHeadV1(await transport.push(bundle));
      if (head === null) throw new Error("The sync transport returned an invalid push head.");
      if (head.sequence !== operations.at(-1)?.sequence
        || head.operationSha256 !== operations.at(-1)?.operationSha256) {
        throw new Error("The sync transport acknowledged a different head.");
      }
      pushed += operations.length;
      const afterPush = store.head();
      if (afterPush.sequence === head.sequence
        && afterPush.operationSha256 === head.operationSha256) {
        const confirmed = parseOhSyncHeadV1(await transport.head(store.spaceId));
        if (confirmed === null) throw new Error("The sync transport returned an invalid head.");
        const confirmedLocal = store.head();
        if (confirmed.sequence === head.sequence
          && confirmed.operationSha256 === head.operationSha256
          && confirmedLocal.sequence === confirmed.sequence
          && confirmedLocal.operationSha256 === confirmed.operationSha256) {
          return settled(confirmed, round);
        }
      }
    }
  }
  throw new Error("Sync did not settle within maximumRounds.");
}

export type LibSqlValueV1 = ArrayBuffer | Date | Uint8Array | bigint | boolean | null | number | string;
export type LibSqlStatementV1 = { args?: LibSqlValueV1[]; sql: string };
export type LibSqlResultV1 = Readonly<{ rows: readonly (Readonly<Record<string, unknown>> | readonly unknown[])[] }>;
export interface LibSqlClientV1 {
  execute(statement: LibSqlStatementV1 | string): Promise<LibSqlResultV1>;
  batch(statements: LibSqlStatementV1[], mode?: "deferred" | "read" | "write"): Promise<readonly LibSqlResultV1[]>;
}

function rowValue(row: Readonly<Record<string, unknown>> | readonly unknown[], key: string, index: number): unknown {
  return Array.isArray(row) ? row[index] : (row as Readonly<Record<string, unknown>>)[key];
}

/** A zero-dependency adapter for clients implementing @libsql/client's execute/batch shape. */
export function createLibSqlOperationSyncTransportV1(client: LibSqlClientV1): OhOperationSyncTransportV1 {
  let ready: Promise<void> | null = null;
  const setup = async (manifest: OhContractManifestV1): Promise<void> => {
    if (parseOhContractManifestV1(manifest) === null) throw new Error("Unsupported contract manifest.");
    await client.batch([
      { sql: `CREATE TABLE IF NOT EXISTS oh_sync_contracts (
        contract_id TEXT PRIMARY KEY, contract_sha256 TEXT NOT NULL, manifest_json TEXT NOT NULL
      ) STRICT` },
      { sql: `CREATE TABLE IF NOT EXISTS oh_sync_operations (
        space_id TEXT NOT NULL, sequence INTEGER NOT NULL, operation_sha256 TEXT NOT NULL UNIQUE,
        operation_json TEXT NOT NULL, PRIMARY KEY(space_id, sequence)
      ) STRICT` },
      { sql: "INSERT INTO oh_sync_contracts(contract_id, contract_sha256, manifest_json) VALUES (?, ?, ?) ON CONFLICT(contract_id) DO NOTHING",
        args: [manifest.contractId, manifest.contractSha256, canonicalJson(manifest)] },
    ], "write");
    const result = await client.execute({ sql: "SELECT contract_sha256, manifest_json FROM oh_sync_contracts WHERE contract_id = ?",
      args: [manifest.contractId] });
    const row = result.rows[0];
    if (row === undefined || rowValue(row, "contract_sha256", 0) !== manifest.contractSha256
      || rowValue(row, "manifest_json", 1) !== canonicalJson(manifest)) {
      throw new Error("Remote contract manifest mismatch.");
    }
  };
  const ensure = (manifest = OH_CONTRACT_MANIFEST_V1): Promise<void> => {
    ready ??= setup(manifest).catch((error) => { ready = null; throw error; });
    return ready;
  };
  const head = async (spaceId: string): Promise<OhSyncHeadV1> => {
    await ensure();
    const result = await client.execute({ sql: `SELECT sequence, operation_sha256 FROM oh_sync_operations
      WHERE space_id = ? ORDER BY sequence DESC LIMIT 1`, args: [spaceId] });
    const row = result.rows[0];
    if (row === undefined) return { operationSha256: null, sequence: 0, v: 1 };
    const sequence = Number(rowValue(row, "sequence", 0));
    const operationSha256 = parseSha256Hex(rowValue(row, "operation_sha256", 1));
    if (!Number.isSafeInteger(sequence) || sequence < 1 || operationSha256 === null) throw new Error("Invalid remote head.");
    return { operationSha256, sequence, v: 1 };
  };
  return {
    handshake: async (manifest) => {
      const parsed = parseOhContractManifestV1(manifest);
      if (parsed === null) throw new Error("Unsupported contract manifest.");
      await ensure(parsed);
    },
    head,
    pull: async (spaceId, afterSequence, limit) => {
      const parsedSpaceId = safeCode(spaceId);
      if (parsedSpaceId === null
        || !Number.isSafeInteger(afterSequence) || afterSequence < 0 || Object.is(afterSequence, -0)
        || !Number.isSafeInteger(limit) || limit < 1 || limit > OH_SYNC_BUNDLE_MAX_OPERATIONS_V1) {
        throw new TypeError("Invalid sync pull request.");
      }
      await ensure();
      const bundleBudget = syncIngressBundleBudgetV1(parsedSpaceId);
      const result = await client.execute({ sql: `SELECT operation_json FROM (
          SELECT sequence, operation_json,
            row_number() OVER (ORDER BY sequence) AS ordinal,
            sum(length(CAST(operation_json AS BLOB))) OVER (
              ORDER BY sequence ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS cumulative_bytes
          FROM (
            SELECT sequence, operation_json FROM oh_sync_operations
            WHERE space_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
          )
        ) WHERE ordinal = 1 OR cumulative_bytes + ordinal - 1 <= ? ORDER BY sequence`,
        args: [parsedSpaceId, afterSequence, limit,
          bundleBudget.maximumBytes - bundleBudget.bytes] });
      const rows = result.rows;
      if (!Array.isArray(rows) || rows.length > limit) {
        throw new Error("Remote sync pull exceeded its requested row limit.");
      }
      const operations = rows.map((row) => {
        const json = rowValue(row, "operation_json", 0);
        if (typeof json !== "string") throw new Error("Invalid remote operation JSON.");
        if (utf8ByteLength(json) > OH_OPERATION_MAX_BYTES_V1) {
          throw new Error("Remote operation JSON exceeds the canonical operation byte limit.");
        }
        const operation = parseOhOperationV1(JSON.parse(json));
        if (operation === null || canonicalJson(operation) !== json) throw new Error("Invalid remote operation.");
        return operation;
      });
      return createOhSyncBundleV1(parsedSpaceId, operations);
    },
    push: async (value) => {
      await ensure();
      const bundle = parseOhSyncBundleV1(value);
      if (bundle === null) throw new Error("Invalid outgoing sync bundle.");
      if (bundle.operations.length === 0) return head(bundle.spaceId);
      const remote = await head(bundle.spaceId);
      const first = bundle.operations[0] as OhOperationV1;
      const last = bundle.operations.at(-1) as OhOperationV1;
      if (remote.sequence >= last.sequence) {
        const result = await client.execute({ sql: `SELECT sequence, operation_sha256, operation_json
          FROM oh_sync_operations WHERE space_id = ? AND sequence >= ? AND sequence <= ?
          ORDER BY sequence LIMIT ?`, args: [bundle.spaceId, first.sequence, last.sequence,
            bundle.operations.length] });
        const rows = result.rows;
        if (!Array.isArray(rows) || rows.length !== bundle.operations.length) {
          throw new Error("Sync conflict: remote history does not contain the exact pushed operations.");
        }
        for (let index = 0; index < bundle.operations.length; index += 1) {
          const operation = bundle.operations[index] as OhOperationV1;
          const row = rows[index];
          if (row === undefined) {
            throw new Error("Sync conflict: remote history does not contain the exact pushed operations.");
          }
          const sequence = Number(rowValue(row, "sequence", 0));
          const operationSha256 = parseSha256Hex(rowValue(row, "operation_sha256", 1));
          const operationJson = rowValue(row, "operation_json", 2);
          const expectedJson = canonicalJson(operation);
          if (sequence !== operation.sequence || operationSha256 !== operation.operationSha256
            || typeof operationJson !== "string"
            || utf8ByteLength(operationJson) > OH_OPERATION_MAX_BYTES_V1
            || operationJson !== expectedJson) {
            throw new Error("Sync conflict: remote history differs from the pushed operations.");
          }
        }
        return { operationSha256: last.operationSha256, sequence: last.sequence, v: 1 };
      }
      if (first.sequence !== remote.sequence + 1 || first.parentOperationSha256 !== remote.operationSha256) {
        throw new Error("Sync conflict: pushed history does not extend the remote head.");
      }
      await client.batch(bundle.operations.map((operation) => ({
        sql: "INSERT INTO oh_sync_operations(space_id, sequence, operation_sha256, operation_json) VALUES (?, ?, ?, ?)",
        args: [bundle.spaceId, operation.sequence, operation.operationSha256, canonicalJson(operation)],
      })), "write");
      return { operationSha256: last.operationSha256, sequence: last.sequence, v: 1 };
    },
  };
}
