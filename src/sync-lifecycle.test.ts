import { describe, expect, test } from "bun:test";

import { canonicalJson } from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { OhSqliteStore } from "./sqlite/store";
import { createLibSqlOperationSyncTransportV1, synchronizeOhStoreV1,
  type LibSqlClientV1, type OhOperationSyncTransportV1 } from "./sync";

function clientWithSetup(batch: LibSqlClientV1["batch"]): LibSqlClientV1 {
  return {
    batch,
    execute: async (statement) => ({ rows: typeof statement !== "string"
      && statement.sql.includes("SELECT contract_sha256, manifest_json")
      ? [{ contract_sha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
        manifest_json: canonicalJson(OH_CONTRACT_MANIFEST_V1) }]
      : [] }),
  };
}

describe("sync Effect lifecycle compatibility", () => {
  test("one failed initialization settles every admitted waiter before a later retry", async () => {
    const gate = Promise.withResolvers<void>();
    const failure = Object.freeze({ code: "synthetic setup refusal" });
    let attempts = 0;
    const transport = createLibSqlOperationSyncTransportV1(clientWithSetup(async () => {
      attempts++;
      if (attempts === 1) { await gate.promise; throw failure; }
      return [];
    }));
    const calls = [transport.handshake(OH_CONTRACT_MANIFEST_V1), transport.head("default"), transport.pull("default", 0, 1)];
    // Attach all rejection observers before releasing the shared attempt.
    const outcomes = Promise.allSettled(calls);
    expect(attempts).toBe(1);
    gate.resolve();
    for (const outcome of await outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") expect(outcome.reason).toBe(failure);
    }
    expect(attempts).toBe(1);
    expect(await transport.head("default")).toEqual({ operationSha256: null, sequence: 0, v: 1 });
    await transport.handshake(OH_CONTRACT_MANIFEST_V1);
    expect(attempts).toBe(2);
  });

  test("concurrent successful initialization is performed once", async () => {
    const gate = Promise.withResolvers<void>();
    let attempts = 0;
    const transport = createLibSqlOperationSyncTransportV1(clientWithSetup(async () => {
      attempts++;
      await gate.promise;
      return [];
    }));
    const ready = Promise.all(Array.from({ length: 20 }, () => transport.head("default")));
    expect(attempts).toBe(1);
    gate.resolve();
    expect(await ready).toHaveLength(20);
    expect(attempts).toBe(1);
  });

  test("the sync facade preserves non-Error transport rejection identity without retry", async () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    const failure = Object.freeze({ code: "synthetic handshake rejection" });
    let calls = 0;
    const transport: OhOperationSyncTransportV1 = {
      handshake: async () => { calls++; throw failure; },
      head: async () => { throw new Error("unexpected head"); },
      pull: async () => { throw new Error("unexpected pull"); },
      push: async () => { throw new Error("unexpected push"); },
    };
    try {
      await expect(synchronizeOhStoreV1(store, transport)).rejects.toBe(failure);
      expect(calls).toBe(1);
      expect(store.head().sequence).toBe(0);
    } finally { store.close(); }
  });

  test("an eager adapter construction failure still returns a rejected Promise", async () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    const descriptor = Object.getOwnPropertyDescriptor(store, "spaceId")!;
    const failure = new Error("synthetic store getter");
    Object.defineProperty(store, "spaceId", { configurable: true, get: () => { throw failure; } });
    try {
      const pending = synchronizeOhStoreV1(store, createLibSqlOperationSyncTransportV1(clientWithSetup(async () => [])));
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).rejects.toBe(failure);
    } finally {
      Object.defineProperty(store, "spaceId", descriptor);
      store.close();
    }
  });

  test("a defective shared setup response settles waiters and permits a later attempt", async () => {
    const defect = new Error("synthetic response getter defect");
    let attempts = 0;
    const client = clientWithSetup(async () => { attempts++; return []; });
    const execute = client.execute;
    client.execute = async (statement) => {
      if (attempts === 1) return { get rows(): never { throw defect; } };
      return await execute(statement);
    };
    const transport = createLibSqlOperationSyncTransportV1(client);
    const results = await Promise.allSettled([transport.head("default"), transport.handshake(OH_CONTRACT_MANIFEST_V1)]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toBe(defect);
    }
    expect(await transport.head("default")).toMatchObject({ sequence: 0 });
    expect(attempts).toBe(2);
  });
});
