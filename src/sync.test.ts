import { describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";

import { canonicalJson, canonicalSha256, type JsonValue } from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { createKnowledgeGraphRecordV1, OH_GRAPH_LIMITS_V1, OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  type KnowledgeGraphRecordKindV1 } from "./graph";
import { createOhOperationV1, OH_OPERATION_MAX_BYTES_V1 } from "./operation";
import { OhSqliteStore } from "./sqlite/store";
import { createLibSqlOperationSyncTransportV1, createOhSyncBundleV1, parseOhSyncBundleV1,
  OH_SYNC_PROTOCOL_V1, parseOhSyncHeadRefV1, parseOhSyncHeadV1,
  synchronizeOhStoreV1, type LibSqlClientV1, type LibSqlStatementV1,
  type LibSqlResultV1,
  type OhOperationSyncTransportV1, type OhSyncBundleV1, type OhSyncHeadV1 } from "./sync";

const record = (key: string, name: string) => createKnowledgeGraphRecordV1({
  dependencies: [], key, kind: "entity", v: 1, value: { name },
});

class MemoryTransport implements OhOperationSyncTransportV1 {
  readonly store = new OhSqliteStore({ path: ":memory:" });
  handshakes = 0;

  async handshake(manifest: typeof OH_CONTRACT_MANIFEST_V1): Promise<void> {
    if (manifest.contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256) throw new Error("contract mismatch");
    this.handshakes += 1;
  }
  async head(spaceId: string): Promise<OhSyncHeadV1> {
    if (spaceId !== this.store.spaceId) throw new Error("space mismatch");
    const head = this.store.head();
    return { operationSha256: head.operationSha256, sequence: head.sequence, v: 1 };
  }
  async pull(spaceId: string, afterSequence: number, limit: number): Promise<OhSyncBundleV1> {
    return createOhSyncBundleV1(spaceId, this.store.exportOperations(afterSequence, limit));
  }
  async push(bundle: OhSyncBundleV1): Promise<OhSyncHeadV1> {
    for (const operation of bundle.operations) this.store.importOperation(operation);
    return await this.head(bundle.spaceId);
  }
  close(): void { this.store.close(); }
}

function put(store: OhSqliteStore, key: string, name: string, operationId: string): void {
  store.commit({ actorId: "agent.test", changes: [{ kind: "put", record: record(key, name), v: 1 }],
    expectedHead: store.head(), operationId });
}

describe("operation sync", () => {
  test("passes an immutable contract manifest to an untrusted transport", async () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    const transport: OhOperationSyncTransportV1 = {
      handshake: async (manifest) => {
        expect(Object.isFrozen(manifest)).toBe(true);
        expect(Object.isFrozen(manifest.recordKinds)).toBe(true);
        expect(manifest.recordKinds).toBe(OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1);
        expect(() => (manifest.recordKinds as KnowledgeGraphRecordKindV1[]).pop()).toThrow(TypeError);
      },
      head: async () => ({ operationSha256: null, sequence: 0, v: 1 }),
      pull: async () => { throw new Error("Unexpected pull."); },
      push: async () => { throw new Error("Unexpected push."); },
    };
    expect(await synchronizeOhStoreV1(store, transport)).toMatchObject({ pulled: 0, pushed: 0 });
    expect(OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1).toHaveLength(18);
    store.close();
  });

  test("round-trips fast-forward logs and settles idempotently", async () => {
    const remote = new MemoryTransport();
    const first = new OhSqliteStore({ path: ":memory:" });
    const second = new OhSqliteStore({ path: ":memory:" });
    put(first, "entity:a", "A", "op_a");
    put(first, "entity:b", "B", "op_b");
    expect(await synchronizeOhStoreV1(first, remote)).toMatchObject({ pulled: 0, pushed: 2 });
    expect(await synchronizeOhStoreV1(second, remote)).toMatchObject({ pulled: 2, pushed: 0 });
    expect(second.head().operationSha256).toBe(first.head().operationSha256);
    put(second, "entity:c", "C", "op_c");
    expect(await synchronizeOhStoreV1(second, remote)).toMatchObject({ pushed: 1 });
    expect(await synchronizeOhStoreV1(first, remote)).toMatchObject({ pulled: 1 });
    expect(await synchronizeOhStoreV1(first, remote)).toMatchObject({ pulled: 0, pushed: 0 });
    expect(remote.handshakes).toBeGreaterThanOrEqual(5);
    first.close(); second.close(); remote.close();
  });

  test("settles on the terminal pull or push without reserving an observation round", async () => {
    const pullRemote = new MemoryTransport();
    put(pullRemote.store, "entity:remote-1", "Remote 1", "op_remote_1");
    put(pullRemote.store, "entity:remote-2", "Remote 2", "op_remote_2");
    put(pullRemote.store, "entity:remote-3", "Remote 3", "op_remote_3");
    const pulled = new OhSqliteStore({ path: ":memory:" });
    const pullHead = pullRemote.store.head();
    expect(await synchronizeOhStoreV1(pulled, pullRemote, {
      batchSize: 1,
      maximumRounds: 3,
    })).toMatchObject({ head: { operationSha256: pullHead.operationSha256,
      sequence: pullHead.sequence }, pulled: 3, pushed: 0, rounds: 3 });

    const pushRemote = new MemoryTransport();
    const pushed = new OhSqliteStore({ path: ":memory:" });
    put(pushed, "entity:local", "Local", "op_local");
    const pushHead = pushed.head();
    expect(await synchronizeOhStoreV1(pushed, pushRemote, {
      maximumRounds: 1,
    })).toMatchObject({ head: { operationSha256: pushHead.operationSha256,
      sequence: pushHead.sequence }, pulled: 0, pushed: 1, rounds: 1 });
    pulled.close(); pullRemote.close(); pushed.close(); pushRemote.close();
  });

  test("samples the local head after an awaited remote head read", async () => {
    const local = new OhSqliteStore({ path: ":memory:" });
    put(local, "entity:first", "First", "op_first");
    const remote = new MemoryTransport();
    remote.store.importOperation(local.exportOperations()[0]);
    let mutated = false;
    const transport: OhOperationSyncTransportV1 = {
      handshake: async (manifest) => remote.handshake(manifest),
      head: async (spaceId) => {
        const captured = await remote.head(spaceId);
        if (!mutated) {
          mutated = true;
          put(local, "entity:second", "Second", "op_second");
        }
        return captured;
      },
      pull: async (spaceId, afterSequence, limit) => remote.pull(spaceId, afterSequence, limit),
      push: async (bundle) => remote.push(bundle),
    };
    const result = await synchronizeOhStoreV1(local, transport, { maximumRounds: 1 });
    expect(result).toMatchObject({ head: { operationSha256: local.head().operationSha256,
      sequence: 2 }, pulled: 0, pushed: 1, rounds: 1 });
    expect(remote.store.head().operationSha256).toBe(local.head().operationSha256);
    local.close(); remote.close();
  });

  test("does not settle a pushed tail when the remote advances before confirmation", async () => {
    const local = new OhSqliteStore({ path: ":memory:" });
    put(local, "entity:local", "Local", "op_local");
    const remote = new MemoryTransport();
    let advanced = false;
    const transport: OhOperationSyncTransportV1 = {
      handshake: async (manifest) => remote.handshake(manifest),
      head: async (spaceId) => remote.head(spaceId),
      pull: async (spaceId, afterSequence, limit) => remote.pull(spaceId, afterSequence, limit),
      push: async (bundle) => {
        const acknowledged = await remote.push(bundle);
        if (!advanced) {
          advanced = true;
          put(remote.store, "entity:remote", "Remote", "op_remote");
        }
        return acknowledged;
      },
    };
    expect(await synchronizeOhStoreV1(local, transport, { maximumRounds: 2 }))
      .toMatchObject({ pulled: 1, pushed: 1, rounds: 2 });
    expect(local.head()).toEqual(remote.store.head());
    local.close();
    remote.close();
  });

  test("does not settle a pulled tail when the remote advances during the pull", async () => {
    const local = new OhSqliteStore({ path: ":memory:" });
    const remote = new MemoryTransport();
    put(remote.store, "entity:first", "First", "op_first");
    let advanced = false;
    const transport: OhOperationSyncTransportV1 = {
      handshake: async (manifest) => remote.handshake(manifest),
      head: async (spaceId) => remote.head(spaceId),
      pull: async (spaceId, afterSequence, limit) => {
        const bundle = await remote.pull(spaceId, afterSequence, limit);
        if (!advanced) {
          advanced = true;
          put(remote.store, "entity:second", "Second", "op_second");
        }
        return bundle;
      },
      push: async (bundle) => remote.push(bundle),
    };
    expect(await synchronizeOhStoreV1(local, transport, { maximumRounds: 2 }))
      .toMatchObject({ pulled: 2, pushed: 0, rounds: 2 });
    expect(local.head()).toEqual(remote.store.head());
    local.close();
    remote.close();
  });

  test("rechecks the local head after awaiting terminal confirmation", async () => {
    const local = new OhSqliteStore({ path: ":memory:" });
    put(local, "entity:first", "First", "op_first");
    const remote = new MemoryTransport();
    let headReads = 0;
    const transport: OhOperationSyncTransportV1 = {
      handshake: async (manifest) => remote.handshake(manifest),
      head: async (spaceId) => {
        headReads += 1;
        const captured = await remote.head(spaceId);
        if (headReads === 2) put(local, "entity:second", "Second", "op_second");
        return captured;
      },
      pull: async (spaceId, afterSequence, limit) => remote.pull(spaceId, afterSequence, limit),
      push: async (bundle) => remote.push(bundle),
    };
    expect(await synchronizeOhStoreV1(local, transport, { maximumRounds: 2 }))
      .toMatchObject({ pulled: 0, pushed: 2, rounds: 2 });
    expect(local.head()).toEqual(remote.store.head());
    local.close();
    remote.close();
  });

  test("rechecks a pulled local head after awaiting terminal confirmation", async () => {
    const local = new OhSqliteStore({ path: ":memory:" });
    const remote = new MemoryTransport();
    put(remote.store, "entity:first", "First", "op_first");
    let headReads = 0;
    const transport: OhOperationSyncTransportV1 = {
      handshake: async (manifest) => remote.handshake(manifest),
      head: async (spaceId) => {
        headReads += 1;
        const captured = await remote.head(spaceId);
        if (headReads === 2) put(local, "entity:second", "Second", "op_second");
        return captured;
      },
      pull: async (spaceId, afterSequence, limit) => remote.pull(spaceId, afterSequence, limit),
      push: async (bundle) => remote.push(bundle),
    };
    expect(await synchronizeOhStoreV1(local, transport, { maximumRounds: 2 }))
      .toMatchObject({ pulled: 1, pushed: 1, rounds: 2 });
    expect(local.head()).toEqual(remote.store.head());
    local.close();
    remote.close();
  });

  test("counts a fetched pull page when another actor imports it first", async () => {
    const local = new OhSqliteStore({ path: ":memory:" });
    const remote = new MemoryTransport();
    put(remote.store, "entity:remote", "Remote", "op_remote");
    let raced = false;
    const transport: OhOperationSyncTransportV1 = {
      handshake: async (manifest) => remote.handshake(manifest),
      head: async (spaceId) => remote.head(spaceId),
      pull: async (spaceId, afterSequence, limit) => {
        const bundle = await remote.pull(spaceId, afterSequence, limit);
        if (!raced) {
          raced = true;
          local.importOperation(bundle.operations[0]);
        }
        return bundle;
      },
      push: async (bundle) => remote.push(bundle),
    };
    expect(await synchronizeOhStoreV1(local, transport, { maximumRounds: 1 }))
      .toMatchObject({ pulled: 1, pushed: 0, rounds: 1 });
    expect(local.head().operationSha256).toBe(remote.store.head().operationSha256);
    local.close(); remote.close();
  });

  test("rejects diverged heads without modifying either log", async () => {
    const remote = new MemoryTransport();
    const local = new OhSqliteStore({ path: ":memory:" });
    put(local, "entity:base", "Base", "op_base");
    await synchronizeOhStoreV1(local, remote);
    put(local, "entity:local", "Local", "op_local");
    put(remote.store, "entity:remote", "Remote", "op_remote");
    await expect(synchronizeOhStoreV1(local, remote)).rejects.toThrow("different heads");
    expect(local.get("entity:local")).not.toBeNull();
    expect(remote.store.get("entity:remote")).not.toBeNull();
    local.close(); remote.close();
  });

  test("binds every bundle byte to its digest", () => {
    const source = new OhSqliteStore({ path: ":memory:" });
    source.commit({ actorId: "agent.test", changes: [
      { kind: "put", record: record("entity:a", "A"), v: 1 },
      { kind: "put", record: record("entity:b", "B"), v: 1 },
    ], expectedHead: source.head(), operationId: "op_a_and_b" });
    const bundle = createOhSyncBundleV1(source.spaceId, source.exportOperations());
    expect(parseOhSyncBundleV1(bundle)).toEqual(bundle);
    expect(parseOhSyncBundleV1({ ...bundle, spaceId: "other" })).toBeNull();
    expect(parseOhSyncBundleV1({ ...bundle, contractSha256: "a".repeat(64) })).toBeNull();
    const extraChange = JSON.parse(JSON.stringify(bundle)) as {
      operations: Array<{ changes: Array<Record<string, unknown>> }>;
    };
    const firstExtraChange = extraChange.operations[0]?.changes[0];
    if (firstExtraChange === undefined) throw new Error("Expected one graph change.");
    firstExtraChange.extra = true;
    expect(parseOhSyncBundleV1(extraChange)).toBeNull();
    const reorderedChanges = JSON.parse(JSON.stringify(bundle)) as {
      operations: Array<{ changes: Array<Record<string, unknown>> }>;
    };
    reorderedChanges.operations[0]?.changes.reverse();
    expect(parseOhSyncBundleV1(reorderedChanges)).toBeNull();

    let accessorReads = 0;
    const accessorBundle = { ...bundle } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessorBundle, "protocol", { enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); } });
    expect(parseOhSyncBundleV1(accessorBundle)).toBeNull();
    const operation = bundle.operations[0];
    if (operation === undefined) throw new Error("Expected one bundled operation.");
    expect(parseOhSyncBundleV1({ ...bundle,
      operations: Array.from({ length: 1001 }, () => operation) })).toBeNull();
    const oversizedChanges = JSON.parse(JSON.stringify(bundle)) as {
      operations: Array<{ changes: Array<Record<string, unknown>> }>;
    };
    const firstChange = oversizedChanges.operations[0]?.changes[0];
    if (firstChange === undefined) throw new Error("Expected one graph change.");
    oversizedChanges.operations[0]!.changes = Array.from({ length: 8193 }, () => firstChange);
    expect(parseOhSyncBundleV1(oversizedChanges)).toBeNull();
    const accessorOperation = { ...operation } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessorOperation, "operationSha256", { enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); } });
    expect(parseOhSyncBundleV1({ ...bundle, operations: [accessorOperation] })).toBeNull();
    expect(accessorReads).toBe(0);

    let proxyReads = 0;
    const proxyBundle = new Proxy(bundle, {
      get() { proxyReads += 1; throw new Error("must not execute"); },
    });
    const proxyOperation = new Proxy(operation, {
      get() { proxyReads += 1; throw new Error("must not execute"); },
    });
    expect(parseOhSyncBundleV1(proxyBundle)).toBeNull();
    expect(parseOhSyncBundleV1({ ...bundle, operations: [proxyOperation] })).toBeNull();
    expect(proxyReads).toBe(0);
    source.close();
  });

  test("bounds deeply nested and oversized record values before detaching them", () => {
    const nestedValue = (depth: number): unknown => {
      let value: unknown = "leaf";
      for (let index = 0; index < depth; index += 1) value = { child: value };
      return value;
    };
    const bundleWithValue = (spaceId: string, value: unknown): OhSyncBundleV1 => {
      const source = new OhSqliteStore({ path: ":memory:", spaceId });
      const deepRecord = createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:deep",
        kind: "entity", v: 1, value: value as JsonValue });
      source.commit({ actorId: "agent.test", changes: [{ kind: "put", record: deepRecord, v: 1 }],
        expectedHead: source.head(), operationId: "op_deep" });
      const payload = { contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
        operations: source.exportOperations(), protocol: OH_SYNC_PROTOCOL_V1, spaceId, v: 1 as const };
      const bundle = { ...payload, bundleSha256: canonicalSha256(payload) };
      source.close();
      return bundle;
    };
    expect(parseOhSyncBundleV1(bundleWithValue("null-value", null))).not.toBeNull();
    const atLimit = bundleWithValue("depth-at-limit", nestedValue(128));
    expect(parseOhSyncBundleV1(atLimit)).toEqual(atLimit);
    expect(parseOhSyncBundleV1(bundleWithValue("depth-over-limit", nestedValue(129)))).toBeNull();
    const byteLimit = bundleWithValue("bytes-at-limit",
      "x".repeat(OH_GRAPH_LIMITS_V1.recordBytes - 2));
    expect(parseOhSyncBundleV1(byteLimit)).toEqual(byteLimit);

    type MutableBundle = {
      operations: Array<{ changes: Array<{ record?: {
        dependencies?: unknown;
        value?: unknown;
      } }> }>;
    };
    const oversized = JSON.parse(JSON.stringify(atLimit)) as MutableBundle;
    const oversizedRecord = oversized.operations[0]?.changes[0]?.record;
    if (oversizedRecord === undefined) throw new Error("Expected one mutable record.");
    oversizedRecord.value = "x".repeat(OH_GRAPH_LIMITS_V1.recordBytes - 1);
    expect(parseOhSyncBundleV1(oversized)).toBeNull();

    const amplified = JSON.parse(JSON.stringify(atLimit)) as MutableBundle;
    const amplifiedRecord = amplified.operations[0]?.changes[0]?.record;
    if (amplifiedRecord === undefined) throw new Error("Expected one mutable record.");
    const sharedLeaf = { payload: "x".repeat(64 * 1024) };
    amplifiedRecord.value = Array.from({ length: 17 }, () => sharedLeaf);
    expect(parseOhSyncBundleV1(amplified)).toBeNull();

    const dependencyAmplified = JSON.parse(JSON.stringify(atLimit)) as MutableBundle;
    const sharedPut = dependencyAmplified.operations[0]?.changes[0];
    if (sharedPut?.record === undefined) throw new Error("Expected one mutable put.");
    sharedPut.record.dependencies = Array.from({ length: OH_GRAPH_LIMITS_V1.dependenciesPerRecord },
      (_, index) => `a${String(index).padStart(4, "0")}${"x".repeat(507)}`);
    dependencyAmplified.operations[0]!.changes = Array.from({ length: 2048 }, () => sharedPut);
    expect(parseOhSyncBundleV1(dependencyAmplified)).toBeNull();
  });

  test("bounds cumulative canonical data across a multi-operation bundle", () => {
    const largeRecord = createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:large",
      kind: "entity", v: 1, value: "x".repeat(OH_GRAPH_LIMITS_V1.recordBytes - 2) });
    const operations = [] as ReturnType<typeof createOhOperationV1>[];
    for (let sequence = 1; sequence <= 65; sequence += 1) {
      const parentOperationSha256 = operations.at(-1)?.operationSha256 ?? null;
      operations.push(createOhOperationV1({
        actorId: "agent.test",
        changes: [{ kind: "put", record: largeRecord, v: 1 }],
        contractId: OH_CONTRACT_MANIFEST_V1.contractId,
        graphRevisionSha256: canonicalSha256(`graph:${sequence}`),
        instant: "2026-09-06T00:00:00.000Z",
        operationId: `op_large_${sequence}`,
        parentOperationSha256,
        recordsSha256: canonicalSha256(`records:${sequence}`),
        sequence,
        spaceId: "bundle-budget",
        v: 1,
      }));
    }
    expect(() => createOhSyncBundleV1("bundle-budget", operations)).toThrow(RangeError);
    const prefix = createOhSyncBundleV1("bundle-budget", operations, {
      largestFittingPrefix: true,
    });
    expect(prefix.operations.length).toBeGreaterThan(0);
    expect(prefix.operations.length).toBeLessThan(operations.length);
    const payload = { contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
      operations, protocol: OH_SYNC_PROTOCOL_V1, spaceId: "bundle-budget", v: 1 as const };
    expect(parseOhSyncBundleV1({ ...payload, bundleSha256: canonicalSha256(payload) })).toBeNull();
  });

  test("strictly parses transport heads", () => {
    const digest = canonicalSha256("head");
    expect(parseOhSyncHeadV1({ operationSha256: null, sequence: 0, v: 1 }))
      .toEqual({ operationSha256: null, sequence: 0, v: 1 });
    expect(parseOhSyncHeadV1({ operationSha256: digest, sequence: 1, v: 1 }))
      .toEqual({ operationSha256: digest, sequence: 1, v: 1 });
    expect(parseOhSyncHeadV1({ operationSha256: null, sequence: 1, v: 1 })).toBeNull();
    expect(parseOhSyncHeadV1({ operationSha256: null, sequence: -0, v: 1 })).toBeNull();
    expect(parseOhSyncHeadV1({ extra: true, operationSha256: digest, sequence: 1, v: 1 })).toBeNull();
    expect(parseOhSyncHeadRefV1({ operationSha256: null, sequence: 0 }))
      .toEqual({ operationSha256: null, sequence: 0 });
    expect(parseOhSyncHeadRefV1({ operationSha256: digest, sequence: 1 }))
      .toEqual({ operationSha256: digest, sequence: 1 });
    expect(parseOhSyncHeadRefV1({ generation: 0, graphRevisionSha256: null,
      operationSha256: null, recordsSha256: canonicalSha256([]), sequence: 0, v: 1 }))
      .toBeNull();
    expect(parseOhSyncHeadRefV1({ operationSha256: null, sequence: -0 })).toBeNull();

    let accessorReads = 0;
    const accessor = { operationSha256: null, sequence: 0 } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessor, "v", { enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); } });
    expect(parseOhSyncHeadV1(accessor)).toBeNull();
    const accessorReference = { operationSha256: null } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessorReference, "sequence", { enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); } });
    expect(parseOhSyncHeadRefV1(accessorReference)).toBeNull();
    expect(accessorReads).toBe(0);

    let proxyReads = 0;
    const proxy = new Proxy({ operationSha256: null, sequence: 0, v: 1 }, {
      get() { proxyReads += 1; throw new Error("must not execute"); },
    });
    expect(parseOhSyncHeadV1(proxy)).toBeNull();
    const proxyReference = new Proxy({ operationSha256: null, sequence: 0 }, {
      get() { proxyReads += 1; throw new Error("must not execute"); },
    });
    expect(parseOhSyncHeadRefV1(proxyReference)).toBeNull();
    expect(proxyReads).toBe(0);
  });

  test("rolls back a valid pulled prefix when a later operation is invalid", async () => {
    const source = new OhSqliteStore({ path: ":memory:" });
    const local = new OhSqliteStore({ path: ":memory:" });
    put(source, "entity:first", "First", "op_first");
    put(source, "entity:second", "Second", "op_second");
    const [first, second] = source.exportOperations();
    if (first === undefined || second === undefined) throw new Error("Expected two source operations.");
    const { operationSha256: _operationSha256, ...payload } = second;
    const hostileSecond = createOhOperationV1({
      ...payload,
      graphRevisionSha256: canonicalSha256("hostile graph revision"),
      recordsSha256: canonicalSha256("hostile records"),
    });
    const bundle = createOhSyncBundleV1(source.spaceId, [first, hostileSecond]);
    const transport: OhOperationSyncTransportV1 = {
      handshake: async () => undefined,
      head: async () => ({ operationSha256: hostileSecond.operationSha256, sequence: 2, v: 1 }),
      pull: async () => bundle,
      push: async () => { throw new Error("unexpected push"); },
    };
    await expect(synchronizeOhStoreV1(local, transport)).rejects.toThrow("does not reproduce");
    expect(local.head().sequence).toBe(0);
    expect(local.snapshotRecords()).toEqual([]);
    local.close();
    source.close();
  });

  test("rejects a pulled terminal that differs from the observed remote head before import", async () => {
    const source = new OhSqliteStore({ path: ":memory:" });
    const local = new OhSqliteStore({ path: ":memory:" });
    put(source, "entity:fork", "Fork", "op_fork");
    const bundle = createOhSyncBundleV1(source.spaceId, source.exportOperations());
    const transport: OhOperationSyncTransportV1 = {
      handshake: async () => undefined,
      head: async () => ({ operationSha256: canonicalSha256("different remote head"),
        sequence: 1, v: 1 }),
      pull: async () => bundle,
      push: async () => { throw new Error("unexpected push"); },
    };
    await expect(synchronizeOhStoreV1(local, transport))
      .rejects.toThrow("remote history does not extend");
    expect(local.head().sequence).toBe(0);
    expect(local.snapshotRecords()).toEqual([]);
    local.close();
    source.close();
  });

  test("rejects a pull response above the requested batch bound before import", async () => {
    const source = new OhSqliteStore({ path: ":memory:" });
    const local = new OhSqliteStore({ path: ":memory:" });
    put(source, "entity:first", "First", "op_first");
    put(source, "entity:second", "Second", "op_second");
    const bundle = createOhSyncBundleV1(source.spaceId, source.exportOperations());
    const sourceHead = source.head();
    const transport: OhOperationSyncTransportV1 = {
      handshake: async () => undefined,
      head: async () => ({ operationSha256: sourceHead.operationSha256,
        sequence: sourceHead.sequence, v: 1 }),
      pull: async (_spaceId, _afterSequence, limit) => {
        expect(limit).toBe(1);
        return bundle;
      },
      push: async () => { throw new Error("unexpected push"); },
    };
    await expect(synchronizeOhStoreV1(local, transport, { batchSize: 1 }))
      .rejects.toThrow("remote history does not extend");
    expect(local.head().sequence).toBe(0);
    expect(local.snapshotRecords()).toEqual([]);
    local.close();
    source.close();
  });

  test("runs the libSQL/Turso seam against SQLite-compatible statements", async () => {
    const database = new Database(":memory:", { strict: true });
    const execute = (statement: LibSqlStatementV1 | string): LibSqlResultV1 => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : statement.args ?? [];
      const bindings: SQLQueryBindings[] = args.map((value) => value instanceof Date
        ? value.toISOString() : value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      if (/^\s*SELECT\b/iu.test(sql)) {
        return { rows: database.query<Record<string, unknown>, SQLQueryBindings[]>(sql).all(...bindings) };
      }
      database.query<never, SQLQueryBindings[]>(sql).run(...bindings);
      return { rows: [] };
    };
    const client: LibSqlClientV1 = {
      execute: async (statement) => execute(statement),
      batch: async (statements) => database.transaction((items: LibSqlStatementV1[]) =>
        items.map((statement) => execute(statement)))(statements),
    };
    const transport = createLibSqlOperationSyncTransportV1(client);
    const source = new OhSqliteStore({ path: ":memory:" });
    put(source, "entity:a", "A", "op_a");
    await expect(transport.handshake({ ...OH_CONTRACT_MANIFEST_V1,
      ontologyVersion: "9.9.9" } as unknown as typeof OH_CONTRACT_MANIFEST_V1))
      .rejects.toThrow("Unsupported contract manifest");
    await transport.handshake(OH_CONTRACT_MANIFEST_V1);
    const pushed = await transport.push(createOhSyncBundleV1(source.spaceId, source.exportOperations()));
    expect(pushed).toEqual({ operationSha256: source.head().operationSha256, sequence: 1, v: 1 });
    expect((await transport.pull(source.spaceId, 0, 100)).operations).toEqual(source.exportOperations());
    expect(await transport.push(createOhSyncBundleV1(source.spaceId, source.exportOperations()))).toEqual(pushed);
    source.close();
    database.close();
  });

  test("acknowledges an exact pushed tail after libSQL history advances", async () => {
    const database = new Database(":memory:", { strict: true });
    const replayLimits: number[] = [];
    const execute = (statement: LibSqlStatementV1 | string): LibSqlResultV1 => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : statement.args ?? [];
      if (sql.includes("SELECT sequence, operation_sha256, operation_json")) {
        replayLimits.push(Number(args[3]));
      }
      const bindings: SQLQueryBindings[] = args.map((value) => value instanceof Date
        ? value.toISOString() : value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      if (/^\s*SELECT\b/iu.test(sql)) {
        return { rows: database.query<Record<string, unknown>, SQLQueryBindings[]>(sql).all(...bindings) };
      }
      database.query<never, SQLQueryBindings[]>(sql).run(...bindings);
      return { rows: [] };
    };
    const client: LibSqlClientV1 = {
      execute: async (statement) => execute(statement),
      batch: async (statements) => database.transaction((items: LibSqlStatementV1[]) =>
        items.map((statement) => execute(statement)))(statements),
    };
    const transport = createLibSqlOperationSyncTransportV1(client);
    const source = new OhSqliteStore({ path: ":memory:" });
    put(source, "entity:a", "A", "op_a");
    put(source, "entity:b", "B", "op_b");
    put(source, "entity:c", "C", "op_c");
    const operations = source.exportOperations();
    const [first, second, third] = operations;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("Expected three source operations.");
    }
    const submitted = createOhSyncBundleV1(source.spaceId, [first, second]);
    const later = createOhSyncBundleV1(source.spaceId, [third]);
    await transport.push(submitted);
    await transport.push(later);
    expect(await transport.push(submitted)).toEqual({
      operationSha256: second.operationSha256,
      sequence: 2,
      v: 1,
    });
    expect(replayLimits.at(-1)).toBe(submitted.operations.length);

    database.query("UPDATE oh_sync_operations SET operation_json = ? WHERE space_id = ? AND sequence = 1")
      .run("{}", source.spaceId);
    await expect(transport.push(submitted)).rejects.toThrow("differs from the pushed operations");
    database.query("UPDATE oh_sync_operations SET operation_json = ? WHERE space_id = ? AND sequence = 1")
      .run(canonicalJson(first), source.spaceId);
    database.query("DELETE FROM oh_sync_operations WHERE space_id = ? AND sequence = 2")
      .run(source.spaceId);
    await expect(transport.push(submitted)).rejects.toThrow("does not contain the exact pushed operations");
    source.close();
    database.close();
  });

  test("paginates synchronization when valid history exceeds the bundle byte budget", async () => {
    const database = new Database(":memory:", { strict: true });
    const execute = (statement: LibSqlStatementV1 | string): LibSqlResultV1 => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : statement.args ?? [];
      const bindings: SQLQueryBindings[] = args.map((value) => value instanceof Date
        ? value.toISOString() : value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      if (/^\s*SELECT\b/iu.test(sql)) {
        return { rows: database.query<Record<string, unknown>, SQLQueryBindings[]>(sql).all(...bindings) };
      }
      database.query<never, SQLQueryBindings[]>(sql).run(...bindings);
      return { rows: [] };
    };
    const client: LibSqlClientV1 = {
      execute: async (statement) => execute(statement),
      batch: async (statements) => database.transaction((items: LibSqlStatementV1[]) =>
        items.map((statement) => execute(statement)))(statements),
    };
    const transport = createLibSqlOperationSyncTransportV1(client);
    const source = new OhSqliteStore({ path: ":memory:" });
    const destination = new OhSqliteStore({ path: ":memory:" });
    const value = "x".repeat(OH_GRAPH_LIMITS_V1.recordBytes - 2);
    for (let page = 0; page < 2; page += 1) {
      const changes = Array.from({ length: 32 }, (_, index) => ({
        kind: "put" as const,
        record: createKnowledgeGraphRecordV1({ dependencies: [],
          key: `entity:large-${page}${String(index).padStart(2, "0")}`,
          kind: "entity", v: 1, value }),
        v: 1 as const,
      }));
      source.commit({ actorId: "agent.test", changes, expectedHead: source.head(),
        operationId: `op_large_page_${page}` });
    }
    expect(await synchronizeOhStoreV1(source, transport, {
      batchSize: 100,
      maximumRounds: 2,
    })).toMatchObject({ pulled: 0, pushed: 2, rounds: 2 });
    expect(await synchronizeOhStoreV1(destination, transport, {
      batchSize: 100,
      maximumRounds: 2,
    })).toMatchObject({ pulled: 2, pushed: 0, rounds: 2 });
    expect(destination.head()).toEqual(source.head());
    destination.close();
    source.close();
    database.close();
  }, 30_000);

  test("bounds libSQL pull results and raw operation JSON before parsing", async () => {
    let pullRows: readonly (Readonly<Record<string, unknown>> | readonly unknown[])[] = [];
    const client: LibSqlClientV1 = {
      batch: async () => [],
      execute: async (statement) => {
        const sql = typeof statement === "string" ? statement : statement.sql;
        if (sql.includes("SELECT contract_sha256")) {
          return { rows: [{ contract_sha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
            manifest_json: canonicalJson(OH_CONTRACT_MANIFEST_V1) }] };
        }
        return { rows: pullRows };
      },
    };
    const transport = createLibSqlOperationSyncTransportV1(client);
    let rowReads = 0;
    const overLimit = new Array(2) as (Readonly<Record<string, unknown>> | readonly unknown[])[];
    Object.defineProperty(overLimit, "0", { configurable: true, enumerable: true,
      get() { rowReads += 1; throw new Error("must not read an over-limit row"); } });
    pullRows = overLimit;
    await expect(transport.pull("default", 0, 1)).rejects.toThrow("requested row limit");
    expect(rowReads).toBe(0);

    pullRows = [{ operation_json: "x".repeat(OH_OPERATION_MAX_BYTES_V1 + 1) }];
    await expect(transport.pull("default", 0, 1)).rejects.toThrow("operation byte limit");
    await expect(transport.pull("default", -0, 1)).rejects.toThrow(TypeError);
    await expect(transport.pull("default", 0, 1001)).rejects.toThrow(TypeError);
  });
});
