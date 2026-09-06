import { Deferred, Effect, Exit, Option, Ref } from "effect";
import { canonicalJson, parseSha256Hex, safeCode, utf8ByteLength } from "./canonical";
import { OH_CONTRACT_MANIFEST_V1, parseOhContractManifestV1, type OhContractManifestV1 } from "./contract";
import { OH_OPERATION_MAX_BYTES_V1, parseOhOperationV1, type OhOperationV1 } from "./operation";
import { createOhSyncBundleV1, parseOhSyncBundleV1, OH_SYNC_BUNDLE_MAX_OPERATIONS_V1,
  syncIngressBundleBudgetV1, type OhSyncHeadV1 } from "./sync-model";
import { LibSqlSyncClient, syncInvalid, type SyncFailure, type SyncTransportService } from "./sync-platform";

function invalid(message: string): SyncFailure {
  return { _tag: "ValidationFailure", cause: new Error(message) };
}

function conflict(message: string): SyncFailure {
  return { _tag: "SyncConflict", cause: new Error(message) };
}

function rowValue(row: Readonly<Record<string, unknown>> | readonly unknown[], key: string, index: number): unknown {
  return Array.isArray(row) ? row[index] : (row as Readonly<Record<string, unknown>>)[key];
}

/** A shared initialization attempt retains its result for every admitted waiter. */
export const makeLibSqlSyncTransport: Effect.Effect<SyncTransportService, never, LibSqlSyncClient> = Effect.gen(function* () {
  const client = yield* LibSqlSyncClient;
  const ready = yield* Ref.make<Option.Option<Deferred.Deferred<void, SyncFailure>>>(Option.none());
  const setup = (manifest: OhContractManifestV1): Effect.Effect<void, SyncFailure> => Effect.gen(function* () {
    if (parseOhContractManifestV1(manifest) === null) return yield* Effect.fail(invalid("Unsupported contract manifest."));
    yield* client.batch([
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
    const result = yield* client.execute({ sql: "SELECT contract_sha256, manifest_json FROM oh_sync_contracts WHERE contract_id = ?",
      args: [manifest.contractId] });
    const row = result.rows[0];
    if (row === undefined || rowValue(row, "contract_sha256", 0) !== manifest.contractSha256
      || rowValue(row, "manifest_json", 1) !== canonicalJson(manifest)) {
      return yield* Effect.fail(invalid("Remote contract manifest mismatch."));
    }
  });

  const ensure = (manifest = OH_CONTRACT_MANIFEST_V1): Effect.Effect<void, SyncFailure> => Effect.uninterruptible(
    Effect.gen(function* () {
      const candidate = yield* Deferred.make<void, SyncFailure>();
      const selected = yield* Ref.modify(ready, (current) => Option.isSome(current)
        ? [current.value, current] as const
        : [candidate, Option.some(candidate)] as const);
      if (selected !== candidate) return yield* Deferred.await(selected);
      const result = yield* Effect.exit(setup(manifest));
      // A failed shared attempt may be retried by a later call, while its
      // admitted waiters all observe this exact failure, including defects.
      if (Exit.isFailure(result)) yield* Ref.set(ready, Option.none());
      yield* Deferred.done(candidate, result);
      return yield* result;
    }),
  );

  const head = (spaceId: string): Effect.Effect<OhSyncHeadV1, SyncFailure> => Effect.gen(function* () {
    yield* ensure();
    const result = yield* client.execute({ sql: `SELECT sequence, operation_sha256 FROM oh_sync_operations
      WHERE space_id = ? ORDER BY sequence DESC LIMIT 1`, args: [spaceId] });
    const row = result.rows[0];
    if (row === undefined) return { operationSha256: null, sequence: 0, v: 1 };
    const sequence = Number(rowValue(row, "sequence", 0));
    const operationSha256 = parseSha256Hex(rowValue(row, "operation_sha256", 1));
    if (!Number.isSafeInteger(sequence) || sequence < 1 || operationSha256 === null) {
      return yield* Effect.fail(invalid("Invalid remote head."));
    }
    return { operationSha256, sequence, v: 1 };
  });
  return {
    handshake: (manifest) => Effect.gen(function* () {
      const parsed = parseOhContractManifestV1(manifest);
      if (parsed === null) return yield* Effect.fail(invalid("Unsupported contract manifest."));
      yield* ensure(parsed);
    }),
    head,
    pull: (spaceId, afterSequence, limit) => Effect.gen(function* () {
      const parsedSpaceId = safeCode(spaceId);
      if (parsedSpaceId === null
        || !Number.isSafeInteger(afterSequence) || afterSequence < 0 || Object.is(afterSequence, -0)
        || !Number.isSafeInteger(limit) || limit < 1 || limit > OH_SYNC_BUNDLE_MAX_OPERATIONS_V1) {
        return yield* Effect.fail(syncInvalid(new TypeError("Invalid sync pull request.")));
      }
      yield* ensure();
      const bundleBudget = syncIngressBundleBudgetV1(parsedSpaceId);
      const result = yield* client.execute({ sql: `SELECT operation_json FROM (
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
        return yield* Effect.fail(invalid("Remote sync pull exceeded its requested row limit."));
      }
      const operations: OhOperationV1[] = [];
      for (const row of rows) {
        const json = rowValue(row, "operation_json", 0);
        if (typeof json !== "string") return yield* Effect.fail(invalid("Invalid remote operation JSON."));
        if (utf8ByteLength(json) > OH_OPERATION_MAX_BYTES_V1) {
          return yield* Effect.fail(invalid("Remote operation JSON exceeds the canonical operation byte limit."));
        }
        const raw: unknown = yield* Effect.try({ try: () => JSON.parse(json) as unknown, catch: syncInvalid });
        const operation = parseOhOperationV1(raw);
        if (operation === null || canonicalJson(operation) !== json) return yield* Effect.fail(invalid("Invalid remote operation."));
        operations.push(operation);
      }
      return yield* Effect.try({ try: () => createOhSyncBundleV1(parsedSpaceId, operations), catch: syncInvalid });
    }),
    push: (value) => Effect.gen(function* () {
      yield* ensure();
      const bundle = parseOhSyncBundleV1(value);
      if (bundle === null) return yield* Effect.fail(invalid("Invalid outgoing sync bundle."));
      if (bundle.operations.length === 0) return yield* head(bundle.spaceId);
      const remote = yield* head(bundle.spaceId);
      const first = bundle.operations[0];
      const last = bundle.operations.at(-1);
      if (first === undefined || last === undefined) return yield* Effect.fail(invalid("Invalid outgoing sync bundle."));
      if (remote.sequence >= last.sequence) {
        const result = yield* client.execute({ sql: `SELECT sequence, operation_sha256, operation_json
          FROM oh_sync_operations WHERE space_id = ? AND sequence >= ? AND sequence <= ?
          ORDER BY sequence LIMIT ?`, args: [bundle.spaceId, first.sequence, last.sequence,
            bundle.operations.length] });
        const rows = result.rows;
        if (!Array.isArray(rows) || rows.length !== bundle.operations.length) {
          return yield* Effect.fail(conflict("Sync conflict: remote history does not contain the exact pushed operations."));
        }
        for (let index = 0; index < bundle.operations.length; index += 1) {
          const operation = bundle.operations[index];
          const row = rows[index];
          if (row === undefined || operation === undefined) {
            return yield* Effect.fail(conflict("Sync conflict: remote history does not contain the exact pushed operations."));
          }
          const sequence = Number(rowValue(row, "sequence", 0));
          const operationSha256 = parseSha256Hex(rowValue(row, "operation_sha256", 1));
          const operationJson = rowValue(row, "operation_json", 2);
          const expectedJson = canonicalJson(operation);
          if (sequence !== operation.sequence || operationSha256 !== operation.operationSha256
            || typeof operationJson !== "string"
            || utf8ByteLength(operationJson) > OH_OPERATION_MAX_BYTES_V1
            || operationJson !== expectedJson) {
            return yield* Effect.fail(conflict("Sync conflict: remote history differs from the pushed operations."));
          }
        }
        return { operationSha256: last.operationSha256, sequence: last.sequence, v: 1 };
      }
      if (first.sequence !== remote.sequence + 1 || first.parentOperationSha256 !== remote.operationSha256) {
        return yield* Effect.fail(conflict("Sync conflict: pushed history does not extend the remote head."));
      }
      yield* client.batch(bundle.operations.map((operation) => ({
        sql: "INSERT INTO oh_sync_operations(space_id, sequence, operation_sha256, operation_json) VALUES (?, ?, ?, ?)",
        args: [bundle.spaceId, operation.sequence, operation.operationSha256, canonicalJson(operation)],
      })), "write");
      return { operationSha256: last.operationSha256, sequence: last.sequence, v: 1 };
    }),
  } satisfies SyncTransportService;
});
