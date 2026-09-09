#!/usr/bin/env bun
/**
 * Offline synthetic SQLite process-death atomicity benchmark.
 *
 * Parent:  bun run bench:stress:sqlite --expected-source-sha256 SOURCE_SHA256 --output ABS_NEW_OUTPUT_JSON
 * Child:   bun <helper> --oh-death-child <ABS_REPO> <ABS_CASE_DIR> <NONCE> <KIND> <PHASE>
 *
 * The child mode is internal: it is only ever entered through the explicit
 * Bun.spawn argument vector below, never through a shell or a generated
 * executable. It proves that a SIGKILL delivered BETWEEN two SQL statements
 * inside the real BEGIN IMMEDIATE transaction of OhSqliteStore#commit leaves
 * the database at its previous durable prefix. It is not a power-failure,
 * media-failure, or fsync-durability test.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync, writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  beginStressRun, finishStressRun, parseStressArguments, writeStressReport,
  type StressFinish, type StressRun,
} from "./stress-common";

/* ------------------------------------------------------------------ tripwire */

let networkAttempts = 0;
let childFetchInstalled = false;
const denyFetch = ((..._parameters: readonly unknown[]): never => {
  networkAttempts += 1;
  throw new Error("network access is forbidden in this offline benchmark");
}) as unknown as typeof fetch;

/**
 * The owned child keeps its own counted rejecting network boundary, installed before it imports
 * any native or repository module. Merely importing this helper installs nothing.
 */
function installChildNetworkTripwire(): () => void {
  if (childFetchInstalled) throw new Error("the child network tripwire is already installed");
  childFetchInstalled = true;
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true, enumerable: true, value: denyFetch, writable: true,
  });
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    childFetchInstalled = false;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true, enumerable: true, value: original, writable: true,
    });
  };
}

/* ----------------------------------------------------------------- constants */

const PROTOCOL = "oh-sqlite-process-death-atomicity-v1";
const BARRIER_PROTOCOL = "oh-sqlite-death-barrier-v1";
const CHILD_FLAG = "--oh-death-child";
const BUN_EXECUTABLE = process.execPath;
const DB_FILE = "oh.sqlite";
const CASE_FILE = "case.json";

const KINDS = ["insert", "update", "tombstone"] as const;
const PHASES = ["before-commit", "mid-early", "mid-late", "after-commit"] as const;
type Kind = (typeof KINDS)[number];
type Phase = (typeof PHASES)[number];

const RECORD_COUNT = 64;
const MID_EARLY_MUTATION = 1;
const MID_LATE_MUTATION = 63;
const BARRIER_DEADLINE_MS = 10_000;
const EXIT_DEADLINE_MS = 5_000;
const CHILD_BLOCK_MS = 15_000;
const STREAM_LIMIT_BYTES = 64 * 1024;
const BARRIER_LINE_LIMIT = 4096;

const SPACE_ID = "death.space";
const ACTOR_ID = "agent.death";
const BASELINE_OPERATION_ID = "op_baseline";
const TARGET_OPERATION_ID = "op_target";
const PROBE_OPERATION_ID = "op_probe_new";
const BASELINE_INSTANT = "2026-01-01T00:00:00.000Z";
const TARGET_INSTANT = "2026-01-02T00:00:00.000Z";
const OLD_MARKER = "ohbaselineoldmarker";
const NEW_MARKER = "ohtargetnewmarker";

const normalizeSql = (sql: string): string => sql.replace(/\s+/gu, " ").trim();
const UPSERT_RECORD_SQL = normalizeSql(`INSERT INTO oh_records(space_id, record_key, kind,
  record_sha256, record_json, operation_sha256, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(space_id, record_key) DO UPDATE SET kind = excluded.kind,
  record_sha256 = excluded.record_sha256, record_json = excluded.record_json,
  operation_sha256 = excluded.operation_sha256, sequence = excluded.sequence`);
const DELETE_RECORD_SQL = normalizeSql("DELETE FROM oh_records WHERE space_id = ? AND record_key = ?");

/* --------------------------------------------------------------------- types */

type Sha256 = string;
type CanonicalModule = typeof import("../../src/canonical");
type GraphModule = typeof import("../../src/graph");
type PureStoreModule = typeof import("../../src/store");
type DriverModule = typeof import("../../src/sqlite/driver");
type SqliteStoreModule = typeof import("../../src/sqlite/store");

type GraphRecord = import("../../src/graph").KnowledgeGraphRecordV1;
type GraphChange = import("../../src/graph").KnowledgeGraphChangeV1;
type OhHead = import("../../src/store").OhHeadV1;
type OhSnapshot = import("../../src/store").OhSnapshotV1;
type CommitInput = import("../../src/store").OhCommitInputV1;
type Store = InstanceType<SqliteStoreModule["OhSqliteStore"]>;
type OhOperation = ReturnType<Store["commit"]>;
type SearchResult = ReturnType<Store["searchKeyword"]>[number];
type ReplayVerification = ReturnType<Store["verifyReplay"]>;
type NativeDatabase = import("../../src/sqlite/driver").OhSqliteDatabase;

/** Helper-local synthetic boundary shapes used by the receiver-bound proxies only. */
type Row = Readonly<Record<string, unknown>>;
interface Query {
  all(...parameters: readonly unknown[]): Row[];
  get(...parameters: readonly unknown[]): Row | null;
  run(...parameters: readonly unknown[]): unknown;
}
interface Db { readonly inTransaction: boolean; close(throwOnError?: boolean): void; query(sql: string): Query }

type Api = Readonly<{
  OhSqliteStore: SqliteStoreModule["OhSqliteStore"];
  canonicalJson: CanonicalModule["canonicalJson"];
  createKnowledgeGraphRecordV1: GraphModule["createKnowledgeGraphRecordV1"];
  emptyOhHeadV1: PureStoreModule["emptyOhHeadV1"];
  isOhConflictError: SqliteStoreModule["isOhConflictError"];
  openOhSqliteDatabase: DriverModule["openOhSqliteDatabase"];
  transitionOhSnapshotV1: PureStoreModule["transitionOhSnapshotV1"];
}>;
void (undefined as unknown as OhSnapshot);
void (undefined as unknown as SearchResult);
void (undefined as unknown as ReplayVerification);

type ExpectedState = Readonly<{
  head: OhHead; operations: readonly OhOperation[]; records: readonly GraphRecord[];
}>;
type TokenProbe = Readonly<{ key: string; marker: string; recordSha256: Sha256; token: string }>;
type Fixture = Readonly<{
  baseline: ExpectedState; baselineChanges: readonly GraphChange[];
  conflictChanges: readonly GraphChange[]; emptyHead: OhHead; kind: Kind;
  prefixRecords: (mutations: number) => readonly GraphRecord[];
  target: ExpectedState; targetChanges: readonly GraphChange[];
  targetKeys: readonly string[]; targetSql: string; tokens: readonly TokenProbe[];
}>;
type BarrierExpectation = Readonly<{
  headOperationSha256: Sha256 | null; headSequence: number; inTransaction: boolean;
  mutations: number; operationRows: number; recordRows: number; recordsSha256: Sha256;
  targetOperationRow: boolean;
}>;

/* ------------------------------------------------------------------- helpers */

const sha256 = (value: string | Uint8Array): Sha256 => createHash("sha256").update(value).digest("hex");
const pad = (value: number): string => String(value).padStart(4, "0");
const range = (count: number): readonly number[] => Array.from({ length: count }, (_, index) => index);

function bounded(text: string, limit = 240): string {
  return text.replace(/[^\w :;,.\-'()#]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit);
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

async function loadApi(repositoryRoot: string): Promise<Api> {
  const url = (relativePath: string): string =>
    pathToFileURL(join(repositoryRoot, relativePath)).href;
  const canonical = await import(url("src/canonical.ts")) as CanonicalModule;
  const graph = await import(url("src/graph.ts")) as GraphModule;
  const pure = await import(url("src/store.ts")) as PureStoreModule;
  const driver = await import(url("src/sqlite/driver.ts")) as DriverModule;
  const sqlite = await import(url("src/sqlite/store.ts")) as SqliteStoreModule;
  return {
    OhSqliteStore: sqlite.OhSqliteStore,
    canonicalJson: canonical.canonicalJson,
    createKnowledgeGraphRecordV1: graph.createKnowledgeGraphRecordV1,
    emptyOhHeadV1: pure.emptyOhHeadV1,
    isOhConflictError: sqlite.isOhConflictError,
    openOhSqliteDatabase: driver.openOhSqliteDatabase,
    transitionOhSnapshotV1: pure.transitionOhSnapshotV1,
  };
}

/* ------------------------------------------------------------------ fixtures */

function buildFixture(api: Api, kind: Kind): Fixture {
  const baselineRecords = range(RECORD_COUNT).map((index) => api.createKnowledgeGraphRecordV1({
    dependencies: [], key: `entity:base-${pad(index)}`, kind: "entity", v: 1,
    value: { marker: OLD_MARKER, note: "oh death baseline row", ordinal: index,
      token: `ohtokenold${pad(index)}`, v: 1 },
  }));
  const targetRecords = kind === "tombstone" ? [] : range(RECORD_COUNT).map((index) =>
    api.createKnowledgeGraphRecordV1({
      dependencies: [],
      key: kind === "insert" ? `entity:next-${pad(index)}` : `entity:base-${pad(index)}`,
      kind: "entity", v: 1,
      value: { marker: NEW_MARKER, note: "oh death target row", ordinal: index,
        token: `ohtokennew${pad(index)}`, v: 1 },
    }));
  const baselineChanges: readonly GraphChange[] =
    baselineRecords.map((record) => ({ kind: "put", record, v: 1 }));
  const targetChanges: readonly GraphChange[] = kind === "tombstone"
    ? baselineRecords.map((record) => ({ key: record.key, kind: "tombstone",
        priorSha256: record.recordSha256, v: 1 }))
    : targetRecords.map((record) => ({ kind: "put", record, v: 1 }));

  const emptyHead = api.emptyOhHeadV1();
  const baseline = api.transitionOhSnapshotV1({ actorId: ACTOR_ID, changes: baselineChanges,
    instant: BASELINE_INSTANT, operationId: BASELINE_OPERATION_ID,
    snapshot: { head: emptyHead, records: [], v: 1 }, spaceId: SPACE_ID });
  const target = api.transitionOhSnapshotV1({ actorId: ACTOR_ID, changes: targetChanges,
    instant: TARGET_INSTANT, operationId: TARGET_OPERATION_ID,
    snapshot: baseline.snapshot, spaceId: SPACE_ID });

  const canonicalChanges = target.operation.changes;
  const targetKeys = canonicalChanges.map((change) =>
    change.kind === "put" ? change.record.key : change.key);
  assert(canonicalChanges.length === RECORD_COUNT, "the target operation must carry 64 changes");
  assert(targetKeys.every((key, index) => index === 0 || (targetKeys[index - 1] as string) < key),
    "the target changes must be in ascending canonical key order");
  assert(baseline.operation.sequence === 1 && target.operation.sequence === 2,
    "the fixture operation chain is wrong");
  const expectedFinalRecords = kind === "insert" ? 128 : kind === "update" ? 64 : 0;
  assert(baseline.snapshot.records.length === RECORD_COUNT
    && target.snapshot.records.length === expectedFinalRecords, "the fixture record counts are wrong");

  const tokenOf = (record: GraphRecord): string => String((record.value as { token: string }).token);
  const tokens: readonly TokenProbe[] = [
    ...baselineRecords.map((record) => ({ key: record.key, marker: OLD_MARKER,
      recordSha256: record.recordSha256, token: tokenOf(record) })),
    ...targetRecords.map((record) => ({ key: record.key, marker: NEW_MARKER,
      recordSha256: record.recordSha256, token: tokenOf(record) })),
  ];

  const prefixRecords = (mutations: number): readonly GraphRecord[] => {
    const records = new Map(baselineRecords.map((record) => [record.key, record] as const));
    for (const change of canonicalChanges.slice(0, mutations)) {
      if (change.kind === "put") records.set(change.record.key, change.record);
      else records.delete(change.key);
    }
    return [...records.values()].sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  };

  const conflictChanges: readonly GraphChange[] = [{ kind: "put", v: 1,
    record: api.createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:probe-0000",
      kind: "entity", v: 1,
      value: { marker: NEW_MARKER, note: "oh death conflict probe", ordinal: 0,
        token: "ohtokenprobe0000", v: 1 } }) }];

  return {
    baseline: { head: baseline.snapshot.head, operations: [baseline.operation],
      records: baseline.snapshot.records },
    baselineChanges, conflictChanges, emptyHead, kind, prefixRecords,
    target: { head: target.snapshot.head, operations: [baseline.operation, target.operation],
      records: target.snapshot.records },
    targetChanges, targetKeys,
    targetSql: kind === "tombstone" ? DELETE_RECORD_SQL : UPSERT_RECORD_SQL, tokens,
  };
}

const rowProjection = (api: Api, records: readonly GraphRecord[]): ReadonlyArray<Record<string, string>> =>
  records.map((record) => ({ record_json: api.canonicalJson(record), record_key: record.key,
    record_sha256: record.recordSha256 }));

const rowsSha256 = (api: Api, records: readonly GraphRecord[]): Sha256 =>
  sha256(api.canonicalJson(rowProjection(api, records)));

function barrierExpectation(api: Api, fixture: Fixture, phase: Phase): BarrierExpectation {
  const mutations = phase === "before-commit" ? 0
    : phase === "mid-early" ? MID_EARLY_MUTATION
    : phase === "mid-late" ? MID_LATE_MUTATION : RECORD_COUNT;
  const records = phase === "before-commit" ? fixture.baseline.records
    : phase === "after-commit" ? fixture.target.records : fixture.prefixRecords(mutations);
  const committed = phase === "after-commit";
  return {
    headOperationSha256: (committed ? fixture.target.head : fixture.baseline.head).operationSha256,
    headSequence: committed ? 2 : 1,
    inTransaction: phase === "mid-early" || phase === "mid-late",
    mutations, operationRows: phase === "before-commit" ? 1 : 2, recordRows: records.length,
    recordsSha256: rowsSha256(api, records), targetOperationRow: phase !== "before-commit",
  };
}

/* ----------------------------------------------------- receiver-bound proxies */

function instrumentDatabase(
  realDatabase: Db, targetSql: string,
  beforeTargetRun: (parameters: readonly unknown[]) => void,
  onTargetRun: (parameters: readonly unknown[], result: unknown) => void,
): Db {
  const bind = (target: object, property: PropertyKey): unknown => {
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? (value as (...p: readonly unknown[]) => unknown).bind(target) : value;
  };
  const wrapStatement = (statement: Query): Query => new Proxy(statement, {
    get(target, property) {
      if (property !== "run") return bind(target, property);
      const run = Reflect.get(target, property, target);
      if (typeof run !== "function") return bind(target, property);
      return (...parameters: readonly unknown[]) => {
        beforeTargetRun(parameters);
        const result: unknown = (run as (...p: readonly unknown[]) => unknown).apply(target, [...parameters]);
        onTargetRun(parameters, result);
        return result;
      };
    },
  });
  return new Proxy(realDatabase, {
    get(target, property) {
      if (property !== "query") return bind(target, property);
      const query = Reflect.get(target, property, target);
      if (typeof query !== "function") return bind(target, property);
      return (sql: string) => {
        const statement = (query as (value: string) => Query).call(target, sql);
        return normalizeSql(sql) === targetSql ? wrapStatement(statement) : statement;
      };
    },
  });
}

/* ----------------------------------------------------------------- child mode */

function note(code: string): void {
  writeSync(2, `oh-death-child: ${bounded(code, 200)}\n`);
}

function observe(api: Api, database: Db): Readonly<{
  headOperationSha256: string | null; headSequence: number; operationDigests: readonly string[];
  operationJson: readonly string[]; rowsSha256: Sha256; rowCount: number;
}> {
  const rows = database.query(`SELECT record_key, record_sha256, record_json FROM oh_records
    WHERE space_id = ? ORDER BY record_key`).all(SPACE_ID).map((row) => ({
      record_json: String(row.record_json), record_key: String(row.record_key),
      record_sha256: String(row.record_sha256) }));
  const space = database.query(`SELECT sequence, head_operation_sha256 FROM oh_spaces
    WHERE space_id = ?`).get(SPACE_ID);
  assert(space !== null && space !== undefined, "the space row is missing");
  const operations = database.query(`SELECT operation_sha256, operation_json FROM oh_operations
    WHERE space_id = ? ORDER BY sequence`).all(SPACE_ID);
  return {
    headOperationSha256: space.head_operation_sha256 === null ? null : String(space.head_operation_sha256),
    headSequence: Number(space.sequence),
    operationDigests: operations.map((row) => String(row.operation_sha256)),
    operationJson: operations.map((row) => String(row.operation_json)),
    rowCount: rows.length, rowsSha256: sha256(api.canonicalJson(rows)),
  };
}

function haltAtBarrier(payload: Record<string, unknown>): never {
  assert(networkAttempts === 0, "the network tripwire fired");
  const line = `${JSON.stringify(payload)}\n`;
  assert(line.length <= BARRIER_LINE_LIMIT, "the barrier line exceeds its bound");
  writeSync(1, line);
  Bun.sleepSync(CHILD_BLOCK_MS);
  throw new Error("the parent did not terminate this child at its barrier");
}

function executeCase(
  api: Api, fixture: Fixture, dbPath: string,
  identity: Readonly<{ caseId: string; kind: Kind; nonce: string; phase: Phase }>,
): never {
  const expectation = barrierExpectation(api, fixture, identity.phase);
  const baselineDigest = fixture.baseline.head.operationSha256;
  const targetDigest = fixture.target.head.operationSha256;
  const barrierIndex = identity.phase === "mid-early" ? MID_EARLY_MUTATION
    : identity.phase === "mid-late" ? MID_LATE_MUTATION : null;

  const nativeDatabase: NativeDatabase = api.openOhSqliteDatabase(dbPath);
  // Validated boundary: the driver database exposes exactly the observed query/close/inTransaction surface.
  const realDatabase = nativeDatabase as unknown as Db;
  let armed = false;
  let mutations = 0;
  const readMutations = (): number => mutations;
  const seenKeys = new Set<string>();

  const emit = (inTransaction: boolean): never => {
    const observed = observe(api, realDatabase);
    assert(observed.rowsSha256 === expectation.recordsSha256, "the observed record prefix is not exact");
    assert(observed.rowCount === expectation.recordRows, "the observed record count is wrong");
    assert(observed.headOperationSha256 === expectation.headOperationSha256
      && observed.headSequence === expectation.headSequence, "the observed space head is wrong");
    assert(observed.operationDigests.length === expectation.operationRows, "the operation log count is wrong");
    assert(observed.operationDigests[0] === baselineDigest, "the baseline operation row is missing");
    const targetPresent = observed.operationDigests.length === 2;
    assert(targetPresent === expectation.targetOperationRow
      && (!targetPresent || observed.operationDigests[1] === targetDigest),
      "the target operation row does not match its expectation");
    return haltAtBarrier({
      baselineOperationSha256: baselineDigest, caseId: identity.caseId,
      expectedMutations: expectation.mutations, expectedRecordRows: expectation.recordRows,
      expectedRecordsSha256: expectation.recordsSha256,
      headOperationSha256: observed.headOperationSha256, headSequence: observed.headSequence,
      inTransaction, kind: identity.kind, mutations, nonce: identity.nonce,
      operationRows: observed.operationDigests.length, phase: identity.phase,
      protocol: BARRIER_PROTOCOL, recordRows: observed.rowCount,
      recordsSha256: observed.rowsSha256, targetOperationRow: targetPresent,
      targetOperationSha256: targetDigest, v: 1,
    });
  };

  type RecordState = Readonly<{ json: string; sha256: string }>;
  type Probes = Readonly<{ changesProbe: Query; countProbe: Query; recordProbe: Query }>;
  let probes: Probes | null = null;
  const probeSet = (): Probes => {
    if (probes === null) {
      probes = {
        changesProbe: realDatabase.query("SELECT changes() AS changed"),
        countProbe: realDatabase.query(
          "SELECT count(*) AS record_rows FROM oh_records WHERE space_id = ?"),
        recordProbe: realDatabase.query(`SELECT record_sha256, record_json FROM oh_records
          WHERE space_id = ? AND record_key = ?`),
      };
    }
    return probes;
  };
  const canonicalTargetChanges = (fixture.target.operations[1] as OhOperation).changes;
  const baselineByKey = new Map(
    fixture.baseline.records.map((record) => [record.key, record] as const));
  const expectedPut = (index: number): GraphRecord | null => {
    const change = canonicalTargetChanges[index];
    return change !== undefined && change.kind === "put" ? change.record : null;
  };
  const recordStateOf = (key: string): RecordState | null => {
    const row = probeSet().recordProbe.get(SPACE_ID, key);
    if (row === null || row === undefined) return null;
    return { json: String(row.record_json), sha256: String(row.record_sha256) };
  };
  const recordRowCount = (): number =>
    Number((probeSet().countProbe.get(SPACE_ID) ?? { record_rows: -1 }).record_rows);
  const assertRecordState = (key: string, expected: GraphRecord | null, label: string): void => {
    const state = recordStateOf(key);
    if (expected === null) assert(state === null, label);
    else {
      assert(state !== null && state.sha256 === expected.recordSha256
        && state.json === api.canonicalJson(expected), label);
    }
  };

  const beforeTargetRun = (parameters: readonly unknown[]): void => {
    if (!armed) return;
    const key = parameters[1];
    assert(typeof key === "string", "a target record mutation lacks its record key");
    assert(key === fixture.targetKeys[mutations], "a target record mutation used an unexpected key");
    assert(!seenKeys.has(key), "a target record mutation repeated a key");
    probeSet();
    assertRecordState(key, baselineByKey.get(key) ?? null,
      "a target record mutation did not start from its expected fixture record state");
    assert(recordRowCount() === fixture.prefixRecords(mutations).length,
      "the current record count before a target record mutation is wrong");
  };

  const onTargetRun = (parameters: readonly unknown[], result: unknown): void => {
    if (!armed) return;
    const directChanges = Number((probeSet().changesProbe.get() ?? { changed: -1 }).changed);
    const native = (result as { changes?: unknown } | null)?.changes;
    const nativeType = typeof native;
    const nativeText = nativeType === "number" || nativeType === "bigint" ? String(native) : "none";
    assert(nativeType === "number" && Number.isFinite(native as number),
      `a target record mutation returned a non-finite native change statistic: type ${nativeType}`);
    assert(directChanges === 1,
      "a target record mutation did not change exactly one row by direct SQL: "
      + `direct ${directChanges}; native ${nativeText} (${nativeType})`);
    const key = parameters[1] as string;
    mutations += 1;
    seenKeys.add(key);
    assertRecordState(key, expectedPut(mutations - 1),
      "a target record mutation did not leave its expected fixture record state");
    assert(recordRowCount() === fixture.prefixRecords(mutations).length,
      "the current record count after a target record mutation is wrong");
    if (barrierIndex !== null && mutations === barrierIndex) {
      assert(realDatabase.inTransaction === true, "the mid-transaction barrier is not inside a transaction");
      emit(true);
    }
  };

  const database = instrumentDatabase(realDatabase, fixture.targetSql, beforeTargetRun, onTargetRun);
  const store = new api.OhSqliteStore({ database: database as unknown as NativeDatabase, spaceId: SPACE_ID });
  store.commit({ actorId: ACTOR_ID, changes: fixture.baselineChanges,
    expectedHead: { generation: fixture.emptyHead.generation,
      operationSha256: fixture.emptyHead.operationSha256 },
    instant: BASELINE_INSTANT, operationId: BASELINE_OPERATION_ID });

  const durable = observe(api, realDatabase);
  assert(mutations === 0 && !armed, "the baseline commit must not be counted");
  assert(durable.rowsSha256 === rowsSha256(api, fixture.baseline.records)
    && durable.rowCount === RECORD_COUNT, "the durable baseline records are wrong");
  assert(durable.headOperationSha256 === baselineDigest && durable.headSequence === 1,
    "the durable baseline head is wrong");
  assert(durable.operationDigests.length === 1
    && durable.operationJson[0] === api.canonicalJson(fixture.baseline.operations[0]),
    "the durable baseline operation bytes are wrong");
  assert(realDatabase.inTransaction === false, "the baseline commit left a transaction open");

  if (identity.phase === "before-commit") emit(false);

  armed = true;
  const operation = store.commit({ actorId: ACTOR_ID, changes: fixture.targetChanges,
    expectedHead: { generation: fixture.baseline.head.generation,
      operationSha256: fixture.baseline.head.operationSha256 },
    instant: TARGET_INSTANT, operationId: TARGET_OPERATION_ID });
  assert(identity.phase === "after-commit", "a mid-transaction barrier was never reached");
  assert(readMutations() === RECORD_COUNT, "the target commit did not run 64 record mutations");
  assert(operation.operationSha256 === targetDigest, "the committed operation digest is wrong");
  assert(realDatabase.inTransaction === false, "the target commit left a transaction open");
  return emit(false);
}

async function runChild(args: readonly string[]): Promise<void> {
  try {
    assert(args.length === 5, "invalid child argument count");
    const [repoArg, caseArg, nonce, kindArg, phaseArg] = args as [string, string, string, string, string];
    assert(isAbsolute(repoArg) && isAbsolute(caseArg)
      && !repoArg.includes("\0") && !caseArg.includes("\0"), "invalid child paths");
    assert(/^[0-9a-f]{32}$/u.test(nonce), "invalid case nonce");
    const kind = KINDS.find((candidate) => candidate === kindArg);
    const phase = PHASES.find((candidate) => candidate === phaseArg);
    assert(kind !== undefined && phase !== undefined, "invalid case identity");
    const caseDir = realpathSync(caseArg);
    const stat = lstatSync(caseDir);
    assert(stat.isDirectory() && (stat.mode & 0o777) === 0o700, "unowned case directory");
    const ownership = JSON.parse(readFileSync(join(caseDir, CASE_FILE), "utf8")) as Record<string, unknown>;
    assert(ownership.nonce === nonce && ownership.kind === kind && ownership.phase === phase
      && ownership.dbFile === DB_FILE && typeof ownership.caseId === "string",
      "case authorization mismatch");
    const dbPath = join(caseDir, DB_FILE);
    assert(lstatSync(dbPath, { throwIfNoEntry: false }) === undefined,
      "the case database already exists");
    const api = await loadApi(realpathSync(repoArg));
    assert(networkAttempts === 0, "the network tripwire fired during setup");
    executeCase(api, buildFixture(api, kind), dbPath,
      { caseId: String(ownership.caseId), kind, nonce, phase });
  } catch (error) {
    note(error instanceof Error ? error.message : "unknown child failure");
    process.exitCode = 3;
  }
}

/* -------------------------------------------------------------- stream reader */

export type StreamReader = Readonly<{
  cancel: () => Promise<boolean>; completed: () => boolean;
  drain: (timeoutMs: number) => Promise<boolean>; fragment: () => string;
  lineCount: () => number; overflowed: () => boolean;
  next: (timeoutMs: number) => Promise<string | null>; readErrors: () => number; tail: () => string;
}>;

export function readLines(stream: ReadableStream<Uint8Array> | null, limit: number): StreamReader {
  const lines: string[] = [];
  const reader = stream?.getReader() ?? null;
  let consumed = 0;
  let buffer = "";
  let bytes = 0;
  let overflow = false;
  let done = false;
  let clean = false;
  let readErrors = 0;
  let wake: (() => void) | null = null;
  const wakeReader = (callback: (() => void) | null): void => { callback?.(); };
  const pumped = (async () => {
    if (reader === null) { done = true; clean = true; return; }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { buffer += decoder.decode(); clean = true; break; }
        bytes += chunk.value.byteLength;
        if (bytes > limit) { overflow = true; break; }
        buffer += decoder.decode(chunk.value, { stream: true });
        for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
          lines.push(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
        }
        wakeReader(wake);
      }
    } catch { readErrors += 1; clean = false; }
    done = true;
    wakeReader(wake);
  })();
  const settled = (): boolean => done && clean && !overflow && readErrors === 0;
  return {
    async cancel() {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        return await Promise.race([
          (async () => { await reader?.cancel(); await pumped; return true; })(),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), EXIT_DEADLINE_MS); }),
        ]);
      } catch { return false; }
      finally { if (timer !== null) clearTimeout(timer); }
    },
    completed: settled,
    async drain(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (!done) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { wake = null; resolve(); }, Math.min(remaining, 25));
          wake = () => { clearTimeout(timer); wake = null; resolve(); };
        });
      }
      await pumped.catch(() => undefined);
      return settled();
    },
    fragment: () => buffer,
    lineCount: () => lines.length,
    async next(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (consumed < lines.length) { consumed += 1; return lines[consumed - 1] ?? null; }
        if (done || overflow) return null;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { wake = null; resolve(); }, Math.min(remaining, 50));
          wake = () => { clearTimeout(timer); wake = null; resolve(); };
        });
      }
    },
    overflowed: () => overflow,
    readErrors: () => readErrors,
    tail: () => bounded(lines.slice(0, 4).join(" | "), 300),
  };
}

/* --------------------------------------------------------- parent verification */

function assertStoreState(api: Api, store: Store, expected: ExpectedState, label: string):
Record<string, unknown> {
  const head = store.head();
  assert(api.canonicalJson(head) === api.canonicalJson(expected.head), `${label}: head`);
  const records = store.snapshotRecords();
  assert(api.canonicalJson(records) === api.canonicalJson(expected.records), `${label}: records`);
  const operations = store.exportOperations(0, 1000);
  assert(api.canonicalJson(operations) === api.canonicalJson(expected.operations), `${label}: operations`);
  const descending = [...store.log(50)].reverse();
  assert(api.canonicalJson(descending) === api.canonicalJson(expected.operations), `${label}: log`);
  const replay = store.verifyReplay();
  assert(replay.sqliteIntegrity === "ok" && replay.operations === expected.operations.length
    && replay.records === expected.records.length
    && api.canonicalJson(replay.head) === api.canonicalJson(expected.head), `${label}: replay`);
  return { headOperationSha256: head.operationSha256, headSequence: head.sequence,
    operations: operations.length, records: records.length, recordsSha256: head.recordsSha256,
    sqliteIntegrity: replay.sqliteIntegrity };
}

function assertFullTextEvidence(
  api: Api, store: Store, fixture: Fixture, expected: ExpectedState, label: string,
): Record<string, unknown> {
  const current = new Map(expected.records.map((record) => [record.key, record.recordSha256] as const));
  const present = fixture.tokens.filter((probe) => current.get(probe.key) === probe.recordSha256);
  const absent = fixture.tokens.filter((probe) => current.get(probe.key) !== probe.recordSha256);
  assert(present.length === expected.records.length, `${label}: token coverage`);
  const byKey = (values: readonly SearchResult[]): ReadonlyArray<Record<string, string>> =>
    [...values].map((value) => ({ key: value.key, recordSha256: value.recordSha256 }))
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const expectedFor = (marker: string): ReadonlyArray<Record<string, string>> =>
    present.filter((probe) => probe.marker === marker)
      .map((probe) => ({ key: probe.key, recordSha256: probe.recordSha256 }))
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const oldHits = byKey(store.searchKeyword(OLD_MARKER, 100));
  const newHits = byKey(store.searchKeyword(NEW_MARKER, 100));
  assert(api.canonicalJson(oldHits) === api.canonicalJson(expectedFor(OLD_MARKER)), `${label}: old marker`);
  assert(api.canonicalJson(newHits) === api.canonicalJson(expectedFor(NEW_MARKER)), `${label}: new marker`);
  for (const probe of present) {
    const hits = store.searchKeyword(probe.token, 100);
    assert(hits.length === 1 && hits[0]?.key === probe.key
      && hits[0]?.recordSha256 === probe.recordSha256, `${label}: token probe must resolve`);
  }
  for (const probe of absent) {
    assert(store.searchKeyword(probe.token, 100).length === 0, `${label}: stale token must vanish`);
  }
  return { absentTokens: absent.length, newMarkerHits: newHits.length, oldMarkerHits: oldHits.length,
    presentTokens: present.length,
    sha256: sha256(api.canonicalJson({ newHits, oldHits, present: present.length, absent: absent.length })) };
}

function expectConflict(api: Api, work: () => unknown, label: string): string {
  try { work(); } catch (error) {
    if (api.isOhConflictError(error)) return "OhConflictError";
    throw error;
  }
  throw new Error(`${label}: a rejected commit unexpectedly succeeded`);
}

function runRetryChecks(api: Api, store: Store, fixture: Fixture): Record<string, unknown> {
  const input: CommitInput = { actorId: ACTOR_ID, changes: fixture.targetChanges,
    expectedHead: { generation: fixture.baseline.head.generation,
      operationSha256: fixture.baseline.head.operationSha256 },
    instant: TARGET_INSTANT, operationId: TARGET_OPERATION_ID };
  const expectedOperation = fixture.target.operations[1] as OhOperation;
  const first = store.commit(input);
  assert(api.canonicalJson(first) === api.canonicalJson(expectedOperation), "retry: operation bytes");
  assertStoreState(api, store, fixture.target, "retry");
  const repeated = store.commit(input);
  assert(api.canonicalJson(repeated) === api.canonicalJson(expectedOperation), "retry: repeat operation");
  assert(store.log(50).length === 2, "retry: the repeat created a new operation");
  const staleHeadNewOperationId = expectConflict(api,
    () => store.commit({ ...input, operationId: PROBE_OPERATION_ID }), "stale head");
  const reusedOperationChangedContent = expectConflict(api,
    () => store.commit({ ...input, changes: fixture.conflictChanges }), "changed content");
  assertStoreState(api, store, fixture.target, "post-rejection");
  return { firstOperationSha256: first.operationSha256, operationsAfterRetry: 2,
    repeatedOperationSha256: repeated.operationSha256, reusedOperationChangedContent,
    staleHeadNewOperationId };
}

/* --------------------------------------------------------------- parent mode */

type SpawnedChild = Readonly<{
  exitCode: number | null; exited: Promise<number>; killed: boolean;
  signalCode: NodeJS.Signals | null; stderr: ReadableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>; kill: (signal?: NodeJS.Signals) => void;
}>;

async function awaitExit(child: SpawnedChild, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const result = await Promise.race([child.exited.then(() => "exited" as const), timeout]);
    return result === "exited";
  } catch { return false; }
  finally { if (timer !== null) clearTimeout(timer); }
}

function parseBarrier(
  api: Api, line: string, fixture: Fixture, expectation: BarrierExpectation,
  identity: Readonly<{ caseId: string; kind: Kind; nonce: string; phase: Phase }>,
): Record<string, unknown> {
  assert(line.length <= BARRIER_LINE_LIMIT, "the barrier line exceeds its bound");
  const parsed = JSON.parse(line) as Record<string, unknown>;
  const check = (condition: boolean, label: string): void => assert(condition, `barrier: ${label}`);
  check(parsed.protocol === BARRIER_PROTOCOL && parsed.v === 1, "protocol");
  check(parsed.caseId === identity.caseId && parsed.kind === identity.kind
    && parsed.phase === identity.phase && parsed.nonce === identity.nonce, "identity");
  check(parsed.mutations === expectation.mutations
    && parsed.expectedMutations === expectation.mutations, "mutation counter");
  check(parsed.inTransaction === expectation.inTransaction, "transaction state");
  check(parsed.recordRows === expectation.recordRows
    && parsed.expectedRecordRows === expectation.recordRows, "record rows");
  check(parsed.recordsSha256 === expectation.recordsSha256
    && parsed.expectedRecordsSha256 === expectation.recordsSha256, "record prefix digest");
  check(parsed.headOperationSha256 === expectation.headOperationSha256
    && parsed.headSequence === expectation.headSequence, "space head");
  check(parsed.operationRows === expectation.operationRows
    && parsed.targetOperationRow === expectation.targetOperationRow, "operation log");
  check(parsed.baselineOperationSha256 === fixture.baseline.head.operationSha256
    && parsed.targetOperationSha256 === fixture.target.head.operationSha256, "operation identity");
  void api;
  return { headOperationSha256: parsed.headOperationSha256, inTransaction: parsed.inTransaction,
    mutations: parsed.mutations, operationRows: parsed.operationRows,
    recordRows: parsed.recordRows, recordsSha256: parsed.recordsSha256 };
}

async function runParent(run: StressRun): Promise<void> {
  const helperPath = import.meta.path;
  const helperSha256Before = run.helperSha256Before;
  const repositoryRoot = run.root;

  const startedAt = Date.now();
  const failures: string[] = [];
  const cases: Array<Record<string, unknown>> = [];
  const retained: string[] = [];
  const counters = { barriers: 0, cells: 0, children: 0, kills: 0, reopened: 0, retried: 0 };
  let root: string | null = null;
  let cleanupComplete = false;
  let identityBefore: Record<string, unknown> = {};
  let sourceSha256After: string | null = null;
  let finish: StressFinish | null = null;

  try {
    const api = await loadApi(repositoryRoot);
    const before = run.identityBefore;
    identityBefore = { architecture: before.architecture, bun: before.bun, dirty: before.dirty,
      platform: before.platform, sourceSha256: before.sourceSha256 };

    root = realpathSync(mkdtempSync(join(tmpdir(), "oh-death-")));
    chmodSync(root, 0o700);

    const matrix = KINDS.flatMap((kind) => PHASES.map((phase) => ({ kind, phase })));
    assert(new Set(matrix.map((cell) => `${cell.kind}|${cell.phase}`)).size === 12,
      "the matrix must hold twelve distinct cells");

    for (const [index, cell] of matrix.entries()) {
      counters.cells += 1;
      const caseId = `${index + 1}-${cell.kind}-${cell.phase}`;
      const caseStarted = Date.now();
      const record: Record<string, unknown> = { caseId, kind: cell.kind, phase: cell.phase,
        status: "failed" };
      const caseDir = join(root, `case-${caseId}`);
      let child: SpawnedChild | null = null;
      let exitEstablished = true;
      let storeClosed = true;
      let haltMatrix = false;
      let store: Store | null = null;
      let out: StreamReader | null = null;
      let err: StreamReader | null = null;
      try {
        mkdirSync(caseDir, { mode: 0o700 });
        chmodSync(caseDir, 0o700);
        const scratch = join(caseDir, "tmp");
        mkdirSync(scratch, { mode: 0o700 });
        const nonce = randomBytes(16).toString("hex");
        writeFileSync(join(caseDir, CASE_FILE),
          JSON.stringify({ caseId, dbFile: DB_FILE, kind: cell.kind, nonce, phase: cell.phase, v: 1 }),
          { flag: "wx", mode: 0o600 });
        const dbPath = join(caseDir, DB_FILE);
        assert(lstatSync(dbPath, { throwIfNoEntry: false }) === undefined,
          "the fixed case database name already exists");

        const fixture = buildFixture(api, cell.kind);
        const expectation = barrierExpectation(api, fixture, cell.phase);

        child = Bun.spawn({
          cmd: [BUN_EXECUTABLE, helperPath, CHILD_FLAG, repositoryRoot, caseDir, nonce,
            cell.kind, cell.phase],
          cwd: caseDir,
          env: { LANG: "C", PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: scratch, TZ: "UTC" },
          stderr: "pipe", stdin: "ignore", stdout: "pipe",
        }) as unknown as SpawnedChild;
        exitEstablished = false;
        counters.children += 1;
        out = readLines(child.stdout, STREAM_LIMIT_BYTES);
        err = readLines(child.stderr, STREAM_LIMIT_BYTES);

        const line = await out.next(BARRIER_DEADLINE_MS);
        assert(!out.overflowed() && !err.overflowed(), "a child stream exceeded its byte limit");
        assert(line !== null, "the child produced no barrier before its deadline");
        const barrier = parseBarrier(api, line, fixture, expectation,
          { caseId, kind: cell.kind, nonce, phase: cell.phase });
        counters.barriers += 1;
        record.barrier = barrier;

        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        exitEstablished = await awaitExit(child, EXIT_DEADLINE_MS);
        assert(exitEstablished, "the killed child never reported its exit");
        assert(child.signalCode === "SIGKILL", "the child did not exit by our SIGKILL");
        counters.kills += 1;
        record.exit = { exitCode: child.exitCode, signal: child.signalCode };
        const drainedOut = await out.drain(EXIT_DEADLINE_MS);
        const drainedErr = await err.drain(EXIT_DEADLINE_MS);
        assert(drainedOut && drainedErr, "a child stream did not drain before its deadline");
        assert(out.completed() && err.completed(), "a child stream did not reach a clean end of stream");
        assert(out.readErrors() === 0 && err.readErrors() === 0, "a child stream reported a read error");
        assert(!out.overflowed() && !err.overflowed(), "a child stream exceeded its byte limit");
        assert(out.fragment() === "" && err.fragment() === "",
          "a child stream ended with an unterminated fragment");
        assert(out.lineCount() === 1, "the child wrote more than one stdout line");
        const diagnostics = err.tail();
        assert(await out.cancel(), "stdout reader cleanup did not complete");
        assert(await err.cancel(), "stderr reader cleanup did not complete");

        const expected = cell.phase === "after-commit" ? fixture.target : fixture.baseline;
        storeClosed = false;
        store = new api.OhSqliteStore({ path: dbPath, spaceId: SPACE_ID });
        const reopened = assertStoreState(api, store, expected, "reopen");
        const reopenedFts = assertFullTextEvidence(api, store, fixture, expected, "reopen");
        counters.reopened += 1;
        record.reopened = { ...reopened, fts: reopenedFts };

        record.retry = runRetryChecks(api, store, fixture);
        counters.retried += 1;
        const final = assertStoreState(api, store, fixture.target, "final");
        const finalFts = assertFullTextEvidence(api, store, fixture, fixture.target, "final");
        record.final = { ...final, fts: finalFts };
        assert(run.networkAttempts() === 0, "the network tripwire fired");
        record.status = "passed";
        if (diagnostics.length > 0) record.childDiagnostics = diagnostics;
      } catch (error) {
        const message = bounded(error instanceof Error ? error.message : "unknown case failure");
        record.failure = message;
        failures.push(`${caseId}: ${message}`);
      } finally {
        if (store === null) {
          if (!storeClosed) {
            const message = "the reopened store left unknown custody; its directory is retained";
            record.status = "failed";
            record.failure = record.failure ?? message;
            failures.push(`${caseId}: ${message}`);
          }
        } else {
          try { store.close(); storeClosed = true; } catch {
            const message = "the reopened store failed to close; its directory is retained";
            record.status = "failed";
            record.failure = record.failure ?? message;
            failures.push(`${caseId}: ${message}`);
          }
        }
        if (child !== null) {
          try {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          } catch { /* already gone */ }
          exitEstablished = await awaitExit(child, EXIT_DEADLINE_MS);
          if (exitEstablished) {
            record.exit = record.exit ?? { exitCode: child.exitCode, signal: child.signalCode };
            if (record.status !== "passed") {
              const stdoutDrained = out === null || await out.drain(EXIT_DEADLINE_MS);
              const stderrDrained = err === null || await err.drain(EXIT_DEADLINE_MS);
              record.diagnosticStreams = { stdoutDrained, stderrDrained };
              const diagnostics = err?.tail() ?? "";
              if (diagnostics.length > 0) record.childDiagnostics = diagnostics;
            }
          }
        }
        const outClosed = out === null || await out.cancel();
        const errClosed = err === null || await err.cancel();
        const streamsClosed = outClosed && errClosed;
        if (!streamsClosed) {
          record.status = "failed";
          const message = "child stream cleanup did not complete; its directory is retained";
          record.failure = record.failure ?? message;
          failures.push(`${caseId}: ${message}`);
        }
        record.durationMs = Date.now() - caseStarted;
        let directoryRemoved = false;
        if (exitEstablished && storeClosed && streamsClosed) {
          try { rmSync(caseDir, { force: true, recursive: true }); directoryRemoved = true; }
          catch {
            const message = "the case directory could not be removed; it is retained";
            record.status = "failed";
            record.failure = record.failure ?? message;
            failures.push(`${caseId}: ${message}`);
          }
        } else if (!exitEstablished) {
          failures.push(`${caseId}: the child exit could not be established; its directory is retained`);
        }
        record.cleanup = { childExited: exitEstablished, directoryRemoved, storeClosed, streamsClosed };
        if (!directoryRemoved) {
          record.status = "failed";
          retained.push(caseId);
          haltMatrix = true;
        }
        cases.push(record);
      }
      if (haltMatrix) break;
    }

    assert(retained.length === 0, "an owned case directory was retained; the run cannot finish");
    if (root !== null) {
      rmSync(root, { force: true, recursive: true });
      cleanupComplete = true;
      root = null;
    }
    finish = await finishStressRun(run);
    sourceSha256After = finish.identityAfter.sourceSha256;
  } catch (error) {
    failures.push(bounded(error instanceof Error ? error.message : "unknown run failure"));
  } finally {
    if (root !== null && retained.length === 0) {
      try { rmSync(root, { force: true, recursive: true }); cleanupComplete = true; }
      catch (error) { failures.push(bounded(`cleanup: ${String(error)}`)); }
    }
  }

  const helperSha256After = finish?.helperSha256After ?? sha256(readFileSync(helperPath));
  const observedNetworkAttempts = networkAttempts + run.networkAttempts();
  const passedCases = cases.filter((entry) => entry.status === "passed").length;
  const passed = failures.length === 0 && passedCases === 12 && counters.cells === 12
    && counters.children === 12 && counters.barriers === 12 && counters.kills === 12
    && counters.reopened === 12 && counters.retried === 12 && observedNetworkAttempts === 0
    && cleanupComplete && retained.length === 0 && finish !== null
    && helperSha256Before === helperSha256After
    && sourceSha256After === run.expectedSourceSha256;

  const evidence = {
    cases: cases.map((entry) => ({ barrier: entry.barrier ?? null, caseId: entry.caseId,
      cleanup: entry.cleanup ?? null,
      exit: entry.exit ?? null, final: entry.final ?? null, kind: entry.kind, phase: entry.phase,
      reopened: entry.reopened ?? null, retry: entry.retry ?? null, status: entry.status })),
    counters, helperSha256: helperSha256After, modelCalls: 0,
    networkAttempts: observedNetworkAttempts,
    protocol: PROTOCOL, sourceSha256: sourceSha256After,
  };

  const report = {
    architecture: identityBefore.architecture ?? process.arch,
    bun: identityBefore.bun ?? Bun.version,
    cases, cleanup: { complete: cleanupComplete, retainedCases: retained },
    counters, evidenceSha256: sha256(JSON.stringify(evidence)),
    failures: failures.slice(0, 24),
    helperSha256After, helperSha256Before,
    matrix: { kinds: KINDS, midEarlyMutation: MID_EARLY_MUTATION, midLateMutation: MID_LATE_MUTATION,
      phases: PHASES, recordsPerOperation: RECORD_COUNT },
    modelCalls: 0, networkAttempts: observedNetworkAttempts,
    observed: { cleanupComplete, expectedSourceSha256: run.expectedSourceSha256,
      finished: finish !== null, guardNetworkAttempts: finish?.networkAttempts ?? null,
      identitySha256After: finish?.identityAfter.sourceSha256 ?? null,
      retainedCases: retained.length },
    oracle: "Pure emptyOhHeadV1 + transitionOhSnapshotV1 snapshot transition over exact synthetic "
      + "fixture record sets with fixed instants; independent of SQLite persistence. It is not an "
      + "independent reimplementation of canonical hashing.",
    platform: identityBefore.platform ?? process.platform,
    protocol: PROTOCOL,
    qualification: "SIGKILL delivered between two SQL statements inside the real BEGIN IMMEDIATE "
      + "transaction of OhSqliteStore#commit, with the driver PRAGMAs unchanged (WAL, "
      + "synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000, trusted_schema=OFF). Scope is "
      + "process termination while the host keeps running: not power loss, media failure, or fsync "
      + "durability, and not an interruption inside a SQLite VM instruction or a registered function.",
    sourceSha256After, sourceSha256Before: identityBefore.sourceSha256 ?? null,
    status: passed ? "passed" : "failed",
    timings: { durationMs: Date.now() - startedAt },
  };

  await writeStressReport(run, report);
  process.exitCode = passed ? 0 : 1;
}

/* --------------------------------------------------------------------- entry */

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === CHILD_FLAG) {
    const restoreChildFetch = installChildNetworkTripwire();
    try { await runChild(argv.slice(1)); } finally { restoreChildFetch(); }
    return;
  }
  const run = await beginStressRun(new URL(import.meta.url), parseStressArguments(argv));
  try { await runParent(run); } finally { run.restoreFetch(); }
}

if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    writeSync(2, `oh-death: ${bounded(error instanceof Error ? error.message : "invalid invocation")}\n`);
    if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 2;
  }
}
