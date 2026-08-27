import {
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  parseSha256Hex,
  safeCode,
  type Sha256Hex,
} from "./canonical";
import { OH_CONTRACT_MANIFEST_V1, parseOhContractManifestV1, type OhContractManifestV1 } from "./contract";
import { parseOhOperationV1, type OhOperationV1 } from "./operation";
import type { OhSqliteStore } from "./sqlite/store";

export const OH_SYNC_PROTOCOL_V1 = "oh.sync.v1" as const;

export type OhSyncHeadV1 = Readonly<{
  operationSha256: Sha256Hex | null;
  sequence: number;
  v: 1;
}>;

export type OhSyncBundleV1 = Readonly<{
  bundleSha256: Sha256Hex;
  contractSha256: Sha256Hex;
  operations: readonly OhOperationV1[];
  protocol: typeof OH_SYNC_PROTOCOL_V1;
  spaceId: string;
  v: 1;
}>;

export function createOhSyncBundleV1(spaceId: string, operations: readonly OhOperationV1[]): OhSyncBundleV1 {
  const parsedSpaceId = safeCode(spaceId);
  if (parsedSpaceId === null || operations.length > 1000) throw new TypeError("Invalid sync bundle.");
  let priorSequence: number | null = null;
  let priorSha256: Sha256Hex | null = null;
  const parsed: OhOperationV1[] = [];
  for (const candidate of operations) {
    const operation = parseOhOperationV1(candidate);
    if (operation === null || operation.spaceId !== parsedSpaceId
      || (priorSequence !== null && operation.sequence !== priorSequence + 1)
      || (priorSequence !== null && operation.parentOperationSha256 !== priorSha256)) {
      throw new TypeError("Sync operations must form one ordered chain.");
    }
    parsed.push(operation);
    priorSequence = operation.sequence;
    priorSha256 = operation.operationSha256;
  }
  const payload = { contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    operations: parsed, protocol: OH_SYNC_PROTOCOL_V1, spaceId: parsedSpaceId, v: 1 as const };
  return { ...payload, bundleSha256: canonicalSha256(payload) };
}

export function parseOhSyncBundleV1(value: unknown): OhSyncBundleV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["bundleSha256", "contractSha256", "operations", "protocol", "spaceId", "v"])
    || value.protocol !== OH_SYNC_PROTOCOL_V1 || value.v !== 1 || !Array.isArray(value.operations)) return null;
  const bundleSha256 = parseSha256Hex(value.bundleSha256);
  const contractSha256 = parseSha256Hex(value.contractSha256);
  if (bundleSha256 === null || contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256) return null;
  try {
    const created = createOhSyncBundleV1(value.spaceId as string, value.operations as OhOperationV1[]);
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
  for (let round = 1; round <= maximumRounds; round += 1) {
    const local = store.head();
    const remote = await transport.head(store.spaceId);
    if (local.sequence === remote.sequence) {
      if (local.operationSha256 !== remote.operationSha256) {
        throw new Error("Sync conflict: equal sequence numbers have different heads.");
      }
      store.updateSyncState(remoteId, { pulledSequence: local.sequence,
        pushedSequence: local.sequence, remoteHeadSha256: remote.operationSha256 });
      return { head: remote, pulled, pushed, rounds: round, v: 1 };
    }
    if (local.sequence < remote.sequence) {
      const bundle = parseOhSyncBundleV1(await transport.pull(store.spaceId, local.sequence, batchSize));
      if (bundle === null || bundle.operations.length === 0
        || bundle.operations[0]?.sequence !== local.sequence + 1
        || bundle.operations[0]?.parentOperationSha256 !== local.operationSha256) {
        throw new Error("Sync conflict: remote history does not extend the local head.");
      }
      for (const operation of bundle.operations) {
        store.importOperation(operation);
        pulled += 1;
      }
    } else {
      const operations = store.exportOperations(remote.sequence, batchSize);
      if (operations.length === 0 || operations[0]?.sequence !== remote.sequence + 1
        || operations[0]?.parentOperationSha256 !== remote.operationSha256) {
        throw new Error("Sync conflict: local history does not extend the remote head.");
      }
      const head = await transport.push(createOhSyncBundleV1(store.spaceId, operations));
      if (head.sequence !== operations.at(-1)?.sequence
        || head.operationSha256 !== operations.at(-1)?.operationSha256) {
        throw new Error("The sync transport acknowledged a different head.");
      }
      pushed += operations.length;
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
      await ensure();
      const result = await client.execute({ sql: `SELECT operation_json FROM oh_sync_operations
        WHERE space_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`, args: [spaceId, afterSequence, limit] });
      const operations = result.rows.map((row) => {
        const json = rowValue(row, "operation_json", 0);
        if (typeof json !== "string") throw new Error("Invalid remote operation JSON.");
        const operation = parseOhOperationV1(JSON.parse(json));
        if (operation === null || canonicalJson(operation) !== json) throw new Error("Invalid remote operation.");
        return operation;
      });
      return createOhSyncBundleV1(spaceId, operations);
    },
    push: async (value) => {
      await ensure();
      const bundle = parseOhSyncBundleV1(value);
      if (bundle === null) throw new Error("Invalid outgoing sync bundle.");
      if (bundle.operations.length === 0) return head(bundle.spaceId);
      const remote = await head(bundle.spaceId);
      const first = bundle.operations[0] as OhOperationV1;
      const last = bundle.operations.at(-1) as OhOperationV1;
      if (remote.sequence === last.sequence && remote.operationSha256 === last.operationSha256) return remote;
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
