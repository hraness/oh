import { Database } from "bun:sqlite";
import { lstatSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { parseEvolutionCampaign, type EvolutionCampaign } from "./evolution-budget";
import { validateEvolutionRequest, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";

const MAX_RAW = 2 * 1024 * 1024, MAX_REQUEST = 8 * 1024 * 1024, MAX_RESULT = 2 * 1024 * 1024;
// Replay streams bounded rows rather than retaining prompts/raw responses or rereading ancestry per call.
const MAX_REPLAY_BYTES = 4 * 1024 * 1024 * 1024;
export type EvolutionRaw = Readonly<{ httpStatus: number | null; body: Uint8Array; complete: boolean;
  receivedBytes: number; error: "network" | "body-read" | "response-bound" | null; serviceMs?: number }>;
type Status = "reserved" | "captured" | "settled";
type Row = { key: string; repeat: number; request: string; reservation: number; charge: number; status: Status;
  raw: Uint8Array | null; raw_sha: string | null; raw_meta: string | null; result: string | null };
type Entry = Readonly<{ key: string; requestSha256: string; repeat: number; reservation: number; charge: number;
  status: Status; parsed: EvolutionResponse | null; rawSha256: string | null; serviceMs: number | null; bytes: number }>;
function fail(reason: string): never { throw new Error(`Evolution store: ${reason}.`); }
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= maximum;
}
function boundedJson(value: unknown, maximum: number): unknown {
  if (typeof value !== "string" || Buffer.byteLength(value) > maximum) fail("bounded stored JSON required");
  const parsed: unknown = JSON.parse(value), queue: Array<readonly [unknown, number]> = [[parsed, 0]];
  let nodes = 0;
  while (queue.length) {
    const [item, depth] = queue.pop()!;
    if (++nodes > 20_000 || depth > 32) fail("stored JSON structure bound exceeded");
    if (item !== null && typeof item === "object") for (const child of Object.values(item)) queue.push([child, depth + 1]);
  }
  return parsed;
}
function rawMetadata(value: unknown, rawBytes: number): Omit<EvolutionRaw, "body"> {
  if (!isPlainRecord(value) || !hasExactKeys(value, Object.hasOwn(value, "serviceMs")
    ? ["httpStatus", "complete", "receivedBytes", "error", "serviceMs"] : ["httpStatus", "complete", "receivedBytes", "error"])
    || Object.hasOwn(value, "serviceMs") && (typeof value.serviceMs !== "number" || !Number.isFinite(value.serviceMs)
      || value.serviceMs < 0 || Object.is(value.serviceMs, -0) || value.serviceMs > 86_400_000)
    || typeof value.complete !== "boolean" || !integer(value.receivedBytes) || value.receivedBytes < rawBytes
    || value.error !== null && value.error !== "network" && value.error !== "body-read" && value.error !== "response-bound"
    || value.httpStatus !== null && (!integer(value.httpStatus, 599) || value.httpStatus < 100)
    || value.complete && (value.error !== null || value.receivedBytes !== rawBytes)) fail("invalid captured transport metadata");
  return value as Omit<EvolutionRaw, "body">;
}

/** One durable, exclusive campaign owner. Reopen authenticates every occupied row once.
 * New writes use validated in-memory totals and SQLite data_version under BEGIN IMMEDIATE;
 * another connection's mutation invalidates the owner instead of silently changing its budget.
 * Unknown dispatches retain their full reservation, and no first response is retried. */
export async function openEvolutionStore(input: Readonly<{ directory: string; campaign: EvolutionCampaign }>) {
  const campaign = parseEvolutionCampaign(input.campaign), directory = resolve(input.directory);
  if (directory !== input.directory || directory !== campaign.storeDirectory) fail("store path must match the campaign's canonical store directory");
  await mkdir(directory, { mode: 0o700, recursive: true });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory
    || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.()) fail("private store directory required");
  const lockPath = join(directory, "active.lock"), lock = await open(lockPath, "wx", 0o600);
  const lockIdentity = await lock.stat();
  async function releaseLock(): Promise<void> {
    await lock.close();
    try {
      const current = await lstat(lockPath);
      // A replaced directory/lock belongs to a different owner; never remove its custody marker.
      if (current.dev === lockIdentity.dev && current.ino === lockIdentity.ino && !current.isSymbolicLink()) await unlink(lockPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  let database: Database | undefined;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, campaignId: campaign.campaignId })); await lock.sync();
    const path = join(directory, "campaign.sqlite");
    try {
      const s = await lstat(path);
      if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid?.() || s.size > MAX_REPLAY_BYTES + 128 * 1024 * 1024) fail("invalid database path or bound");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    database = new Database(path, { create: true });
    await chmod(path, 0o600);
    const db = database;
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    db.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, repeat INTEGER NOT NULL, request TEXT NOT NULL, reservation INTEGER NOT NULL, charge INTEGER NOT NULL, status TEXT NOT NULL, raw BLOB, raw_sha TEXT, raw_meta TEXT, result TEXT);");
    const expectedColumns = ["key", "repeat", "request", "reservation", "charge", "status", "raw", "raw_sha", "raw_meta", "result"];
    if (canonicalSha256(db.query<{ name: string }, []>("PRAGMA table_info(jobs)").all().map(column => column.name)) !== canonicalSha256(expectedColumns)
      || db.query<{ count: number }, []>("SELECT count(*) AS count FROM sqlite_master WHERE type IN ('trigger','view')").get()!.count !== 0) fail("incompatible or augmented store schema");
    const identity = canonicalSha256({ protocol: "oh.memory.evolution-store.v1", campaign });
    let closed = false, poisoned = false, closeResult: Promise<void> | undefined;
    const entries = new Map<string, Entry>();
    let exposure = 0, confirmed = 0, totalBytes = 0, pendingBytes = 0, expectedDataVersion = 0;
    const storageReserve = (status: Status) => status === "reserved" ? MAX_RAW + MAX_RESULT + 1024 : status === "captured" ? MAX_RESULT : 0;
    const dataVersion = () => db.query<{ data_version: number }, []>("PRAGMA data_version").get()!.data_version;
    function ensureUnchanged(): void {
      if (closed) fail("store closed");
      try {
        const current = lstatSync(directory), currentLock = lstatSync(lockPath);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino
          || current.uid !== stat.uid || (current.mode & 0o777) !== 0o700 || realpathSync(directory) !== campaign.storeDirectory
          || currentLock.isSymbolicLink() || currentLock.dev !== lockIdentity.dev || currentLock.ino !== lockIdentity.ino) {
          throw new Error("custody changed");
        }
      } catch { poisoned = true; fail("campaign store directory or lock identity changed"); }
      if (poisoned || dataVersion() !== expectedDataVersion) { poisoned = true; fail("external database mutation; reopen and replay required"); }
    }
    const key = (request: EvolutionRequest, repeat = 0) => {
      const checked = validateEvolutionRequest(request);
      if (!integer(repeat, 100)) fail("invalid preregistered repeat index");
      return canonicalSha256({ campaignId: campaign.campaignId, profileSha256: checked.profileSha256, requestSha256: checked.requestSha256, repeat });
    };
    function validateRow(found: Row): Entry {
      const request = validateEvolutionRequest(boundedJson(found.request, MAX_REQUEST) as EvolutionRequest);
      if (!integer(found.repeat, 100) || found.key !== key(request, found.repeat)
        || !integer(found.reservation) || found.reservation === 0 || found.reservation !== request.reservationMicros
        || !integer(found.charge) || found.charge > found.reservation
        || !["reserved", "captured", "settled"].includes(found.status)) fail("stored key, repeat, reservation, charge or status changed");
      let parsed: EvolutionResponse | null = null;
      let serviceMs: number | null = null;
      const bytes = Buffer.byteLength(found.request) + (found.raw?.length ?? 0)
        + (typeof found.raw_meta === "string" ? Buffer.byteLength(found.raw_meta) : 0)
        + (typeof found.result === "string" ? Buffer.byteLength(found.result) : 0);
      if (found.status === "reserved") {
        if (found.charge !== found.reservation || found.raw !== null || found.raw_sha !== null
          || found.raw_meta !== null || found.result !== null) fail("reserved row must retain its complete untouched reservation");
      } else {
        if (!(found.raw instanceof Uint8Array) || found.raw.length > MAX_RAW || found.raw_sha !== sha256Hex(found.raw)
          || typeof found.raw_meta !== "string") fail("missing or altered captured response");
        const meta = rawMetadata(boundedJson(found.raw_meta, 1024), found.raw.length);
        serviceMs = meta.serviceMs ?? null;
        // A malformed provider response is still a valid captured first response, fully charged.
        if (meta.complete === true && meta.error === null && meta.httpStatus === 200) {
          try { parsed = parseEvolutionResponse(found.raw, request); } catch { /* Unverifiable response remains occupied. */ }
        }
        if (parsed !== null && (!integer(parsed.usage.micros) || parsed.usage.micros > found.reservation)) fail("unverifiable settled usage");
        if (found.status === "captured") {
          if (found.charge !== found.reservation || found.result !== null) fail("captured row must retain its complete reservation");
        } else if (parsed === null || found.charge !== parsed.usage.micros || found.result === null
          || canonicalSha256(boundedJson(found.result, MAX_RESULT)) !== canonicalSha256(parsed)) fail("settled response replay changed");
      }
      return Object.freeze({ key: found.key, requestSha256: request.requestSha256, repeat: found.repeat,
        reservation: found.reservation, charge: found.charge, status: found.status, parsed, rawSha256: found.raw_sha, serviceMs, bytes });
    }
    function checkTotals(): void {
      if (!integer(exposure, campaign.additionalBudgetMicros) || !integer(confirmed, exposure)
        || entries.size > campaign.maximumCalls || !integer(totalBytes + pendingBytes, MAX_REPLAY_BYTES)) fail("replayed call, storage or spending cap exceeded");
    }
    db.transaction(() => {
      const count = db.query<{ count: number }, []>("SELECT count(*) AS count FROM jobs").get()!.count;
      if (!integer(count, campaign.maximumCalls)) fail("occupied call count exceeds campaign cap");
      const metadataShape = db.query<{ count: number; bytes: number; key_bytes: number }, []>("SELECT count(*) AS count,coalesce(max(length(CAST(value AS BLOB))),0) AS bytes,coalesce(max(length(CAST(key AS BLOB))),0) AS key_bytes FROM metadata").get()!;
      if (metadataShape.count > 1 || metadataShape.bytes > 64 || metadataShape.key_bytes > 8) fail("invalid campaign metadata bounds");
      const meta = db.query<{ key: string; value: string }, []>("SELECT key,value FROM metadata").all();
      if (meta.length === 0) {
        if (count !== 0) fail("occupied store is missing campaign identity");
        db.query("INSERT INTO metadata(key,value) VALUES ('identity',?)").run(identity);
      } else if (meta.length !== 1 || meta[0]!.key !== "identity" || meta[0]!.value !== identity) fail("campaign identity/cap changed for occupied store");
      const oversized = db.query<{ count: number }, [number, number, number]>(
        "SELECT count(*) AS count FROM jobs WHERE typeof(key)!='text' OR length(key)!=64 OR typeof(repeat)!='integer' OR typeof(request)!='text' OR length(CAST(request AS BLOB))>? OR typeof(reservation)!='integer' OR typeof(charge)!='integer' OR typeof(status)!='text' OR length(status)>8 OR (raw IS NOT NULL AND typeof(raw)!='blob') OR length(raw)>? OR (raw_sha IS NOT NULL AND (typeof(raw_sha)!='text' OR length(raw_sha)!=64)) OR (raw_meta IS NOT NULL AND typeof(raw_meta)!='text') OR length(raw_meta)>1024 OR (result IS NOT NULL AND typeof(result)!='text') OR length(CAST(result AS BLOB))>?",
      ).get(MAX_REQUEST, MAX_RAW, MAX_RESULT)!.count;
      if (oversized !== 0) fail("stored row exceeds byte bounds");
      const aggregate = db.query<{ bytes: number }, []>("SELECT coalesce(sum(length(CAST(request AS BLOB))+coalesce(length(raw),0)+coalesce(length(CAST(raw_meta AS BLOB)),0)+coalesce(length(CAST(result AS BLOB)),0)),0) AS bytes FROM jobs").get()!.bytes;
      if (!integer(aggregate, MAX_REPLAY_BYTES)) fail("aggregate stored response bound exceeded");
      for (const row of db.query<Row, []>("SELECT * FROM jobs ORDER BY key").iterate()) {
        const entry = validateRow(row);
        if (entries.has(entry.key)) fail("duplicate stored physical request");
        entries.set(entry.key, entry); exposure += entry.charge; totalBytes += entry.bytes;
        pendingBytes += storageReserve(entry.status);
        if (entry.status === "settled") confirmed += entry.charge;
      }
      checkTotals();
      expectedDataVersion = dataVersion();
    }).immediate();

    function entryFor(request: EvolutionRequest, repeat: number): Entry | undefined {
      ensureUnchanged();
      const found = entries.get(key(request, repeat));
      if (found !== undefined && (found.requestSha256 !== request.requestSha256 || found.repeat !== repeat)) fail("stored request changed");
      return found;
    }
    const summary = () => {
      ensureUnchanged();
      return { calls: entries.size, exposureMicros: exposure, confirmedMicros: confirmed, unresolvedMicros: exposure - confirmed,
        additionalBudgetMicros: campaign.additionalBudgetMicros, maximumCalls: campaign.maximumCalls,
        historicalExposureMicros: campaign.historicalExposureMicros, combinedExposureMicros: campaign.historicalExposureMicros + exposure };
    };
    return {
      key, summary,
      lookup(request: EvolutionRequest, repeat = 0) {
        const found = entryFor(request, repeat);
        if (found === undefined) return { kind: "miss" as const };
        if (found.status !== "settled") return { kind: "occupied" as const, status: found.status };
        return { kind: "hit" as const, result: found.parsed! };
      },
      readServiceMs(request: EvolutionRequest, repeat = 0): number | null {
        const found = entryFor(request, repeat);
        if (found === undefined || found.status === "reserved") fail("no captured request timing");
        return found.serviceMs;
      },
      readRaw(request: EvolutionRequest, repeat = 0): Uint8Array {
        return db.transaction(() => {
          const found = entryFor(request, repeat);
          if (found === undefined || found.status === "reserved" || found.rawSha256 === null) fail("no captured raw response");
          const row = db.query<{ raw: Uint8Array; raw_sha: string }, [string]>("SELECT raw,raw_sha FROM jobs WHERE key=?").get(found.key);
          if (row === null || !(row.raw instanceof Uint8Array) || row.raw.length > MAX_RAW
            || row.raw_sha !== found.rawSha256 || sha256Hex(row.raw) !== found.rawSha256) fail("captured raw response changed");
          return row.raw.slice();
        }).immediate();
      },
      admit(request: EvolutionRequest, repeat = 0) {
        const checked = validateEvolutionRequest(request), id = key(checked, repeat), encoded = JSON.stringify(checked);
        const bytes = Buffer.byteLength(encoded);
        if (bytes > MAX_REQUEST) fail("request byte bound exceeded");
        db.transaction(() => {
          ensureUnchanged();
          if (entryFor(checked, repeat) !== undefined) fail("occupied physical request cannot be retried");
          if (entries.size >= campaign.maximumCalls || exposure + checked.reservationMicros > campaign.additionalBudgetMicros
            || totalBytes + pendingBytes + bytes + storageReserve("reserved") > MAX_REPLAY_BYTES) fail("call, storage or spending cap reached before dispatch");
          db.query("INSERT INTO jobs(key,repeat,request,reservation,charge,status) VALUES (?,?,?,?,?,'reserved')")
            .run(id, repeat, encoded, checked.reservationMicros, checked.reservationMicros);
        }).immediate();
        entries.set(id, Object.freeze({ key: id, requestSha256: checked.requestSha256, repeat,
          reservation: checked.reservationMicros, charge: checked.reservationMicros, status: "reserved", parsed: null, rawSha256: null, serviceMs: null, bytes }));
        exposure += checked.reservationMicros; totalBytes += bytes; pendingBytes += storageReserve("reserved");
        return { key: id, micros: checked.reservationMicros };
      },
      capture(request: EvolutionRequest, raw: EvolutionRaw, repeat = 0) {
        if (!(raw.body instanceof Uint8Array) || raw.body.length > MAX_RAW) fail("invalid bounded transport capture");
        const meta = rawMetadata({ httpStatus: raw.httpStatus, complete: raw.complete, receivedBytes: raw.receivedBytes, error: raw.error,
          ...(raw.serviceMs === undefined ? {} : { serviceMs: raw.serviceMs }) }, raw.body.length);
        const body = raw.body.slice(), rawSha = sha256Hex(body), encodedMeta = JSON.stringify(meta);
        let next!: Entry, previous!: Entry;
        db.transaction(() => {
          ensureUnchanged(); previous = entryFor(request, repeat)!;
          if (previous === undefined || previous.status !== "reserved") fail("capture requires a reserved first response");
          next = validateRow({ key: previous.key, repeat, request: JSON.stringify(validateEvolutionRequest(request)),
            reservation: previous.reservation, charge: previous.charge, status: "captured", raw: body,
            raw_sha: rawSha, raw_meta: encodedMeta, result: null });
          if (totalBytes + pendingBytes + next.bytes - previous.bytes - storageReserve("reserved") + storageReserve("captured") > MAX_REPLAY_BYTES) fail("capture storage bound exceeded");
          const changed = db.query("UPDATE jobs SET raw=?,raw_sha=?,raw_meta=?,status='captured' WHERE key=? AND status='reserved'")
            .run(body, rawSha, encodedMeta, previous.key);
          if (changed.changes !== 1) fail("capture requires a reserved first response");
        }).immediate();
        entries.set(next.key, next); totalBytes += next.bytes - previous.bytes;
        pendingBytes += storageReserve("captured") - storageReserve("reserved");
      },
      finalize(request: EvolutionRequest, repeat = 0) {
        let found!: Entry, result!: EvolutionResponse, encoded = "";
        db.transaction(() => {
          ensureUnchanged(); found = entryFor(request, repeat)!;
          if (found === undefined || found.status === "reserved") fail("no captured response to finalize");
          if (found.parsed === null) fail("captured transport or response is unverifiable; complete reservation remains charged");
          result = found.parsed;
          if (found.status === "captured") {
            encoded = JSON.stringify(result);
            if (Buffer.byteLength(encoded) > MAX_RESULT || totalBytes + pendingBytes + Buffer.byteLength(encoded) - storageReserve("captured") > MAX_REPLAY_BYTES) fail("settled result storage bound exceeded");
            const changed = db.query("UPDATE jobs SET result=?,charge=?,status='settled' WHERE key=? AND status='captured'")
              .run(encoded, result.usage.micros, found.key);
            if (changed.changes !== 1) fail("captured first response changed during settlement");
          }
        }).immediate();
        if (found.status === "captured") {
          const bytes = Buffer.byteLength(encoded);
          entries.set(found.key, Object.freeze({ ...found, status: "settled", charge: result.usage.micros, bytes: found.bytes + bytes }));
          exposure += result.usage.micros - found.charge; confirmed += result.usage.micros; totalBytes += bytes;
          pendingBytes -= storageReserve("captured");
        }
        return result;
      },
      close() {
        if (closeResult !== undefined) return closeResult;
        closed = true;
        closeResult = (async () => { try { db.close(); } finally { await releaseLock(); } })();
        return closeResult;
      },
    };
  } catch (error) { try { database?.close(); } finally { await releaseLock(); } throw error; }
}
export type EvolutionStore = Awaited<ReturnType<typeof openEvolutionStore>>;
