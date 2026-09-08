/** Private first-response storage and one shared amendment ledger. Occupied jobs are never retried. */
import { constants } from "node:fs";
import { open, lstat, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { GatewayStudyBudget, gatewayStudyLedgerExposure, parseGatewayStudyResponse,
  type GatewayStudyLedgerEvent, type GatewayStudyRaw, type GatewayStudyResult, type GatewayStudyRequest, type GatewayStudyReservation } from "./gateway-study-transport-v3";
import type { GatewayJob } from "./gateway-study-plan-v3";

const PROFILE = "oh.memory-gateway-store.v3" as const;
const M = 1024 * 1024;
type StoreProfile = typeof PROFILE | "oh.memory-gateway-store.v5" | "oh.memory-gateway-store.v6";
type SavedResult = Pick<GatewayStudyResult, "requestSha256" | "rawSha256" | "rawBytes" | "usage" | "identity">;
type ResponseParser<R extends SavedResult> = (request: GatewayStudyRequest, reservation: GatewayStudyReservation, raw: GatewayStudyRaw) => R;
function fail(reason: string): never { throw new Error(`Gateway study store: ${reason}.`); }
function digest(s: string): string { if (!/^[a-f0-9]{64}$/.test(s)) fail("invalid digest"); return s; }
function same(a: unknown, b: unknown, reason: string): void { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); }
function parse(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
async function exists(p: string): Promise<boolean> {
  try { await lstat(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
async function directory(p: string): Promise<void> {
  const s = await lstat(p);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o700 || s.uid !== process.getuid?.()) fail("directory custody");
}
export async function readGatewayStudyFile(p: string, maximum = 8 * M): Promise<Uint8Array> {
  const h = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const a = await h.stat();
    if (!a.isFile() || a.nlink !== 1 || a.uid !== process.getuid?.() || (a.mode & 0o777) !== 0o600 || a.size > maximum) fail("private file custody or size");
    const raw = new Uint8Array(a.size);
    for (let offset = 0; offset < raw.length;) { const n = await h.read(raw, offset, raw.length - offset, offset); if (!n.bytesRead) fail("short read"); offset += n.bytesRead; }
    const b = await h.stat(), c = await lstat(p);
    if (a.dev !== b.dev || a.ino !== b.ino || a.size !== b.size || a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs
      || a.dev !== c.dev || a.ino !== c.ino || a.size !== c.size || a.mtimeMs !== c.mtimeMs || a.ctimeMs !== c.ctimeMs || c.isSymbolicLink()) fail("file changed during read");
    return raw;
  } finally { await h.close(); }
}
export async function writeGatewayStudyFile(p: string, raw: Uint8Array): Promise<void> {
  const h = await open(p, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { for (let offset = 0; offset < raw.length;) { const n = await h.write(raw, offset, raw.length - offset, offset); if (!n.bytesWritten) fail("short write"); offset += n.bytesWritten; } await h.sync(); }
  finally { await h.close(); }
  const parent = await open(dirname(p), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
}
export async function writeGatewayStudyJson(p: string, value: unknown) {
  const raw = new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n"); await writeGatewayStudyFile(p, raw);
  return { path: p, sha256: sha256Hex(raw) };
}
function gatewayJobPendingForProfile(job: GatewayJob, freezeSha256: string, profile: StoreProfile) {
  return { protocol: profile, freezeSha256: digest(freezeSha256), jobKey: digest(job.key), phase: job.phase,
    ordinal: job.ordinal, originalParentOrdinal: job.phase === "extract" ? job.original.ordinal : null,
    originalJobKey: job.phase === "extract" ? job.original.key : null, request: job.request };
}
export function gatewayJobPending(job: GatewayJob, freezeSha256: string) {
  return gatewayJobPendingForProfile(job, freezeSha256, PROFILE);
}
export function gatewayReservation(job: GatewayJob) {
  return new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }).reserve(job.request, job.key);
}

/** Read-only reconstruction authenticates the complete saved response and its ledger association. */
async function readGatewaySavedJobWithParser<R extends SavedResult>(directoryPath: string, freezeSha256: string, job: GatewayJob,
  events: readonly GatewayStudyLedgerEvent[], profile: StoreProfile, parseResponse: ResponseParser<R>): Promise<R> {
  const p = join(directoryPath, "jobs", digest(job.key)); await directory(p);
  same((await readdir(p)).sort(), ["pending.json", "reserved.json", "response.body", "response.json", "result.json", "settled.json"], "incomplete or unexpected occupied job");
  same(parse(await readGatewayStudyFile(join(p, "pending.json"))), gatewayJobPendingForProfile(job, freezeSha256, profile), "pending request changed");
  const reservation = gatewayReservation(job), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros };
  same(parse(await readGatewayStudyFile(join(p, "reserved.json"))), reserved, "reservation changed");
  const raw = parse(await readGatewayStudyFile(join(p, "response.json")));
  if (!isPlainRecord(raw) || !hasExactKeys(raw, ["requestSha256", "httpStatus", "bodyComplete", "receivedBytes", "transportError", "body"])) fail("response metadata shape");
  const body = await readGatewayStudyFile(join(p, "response.body"), M);
  same(raw.body, { bytes: body.byteLength, sha256: sha256Hex(body) }, "response bytes changed");
  const result = parseResponse(job.request, reservation, { ...raw, body } as GatewayStudyRaw);
  const settled = { v: 1, id: job.key, kind: "settled", micros: result.usage.micros };
  same(parse(await readGatewayStudyFile(join(p, "settled.json"))), settled, "settlement changed");
  same(events.filter(e => e.id === job.key), [reserved, settled], "ledger job binding");
  same(parse(await readGatewayStudyFile(join(p, "result.json"))), { protocol: profile, freezeSha256,
    jobKey: job.key, result }, "saved response projection changed");
  return result;
}

export async function readGatewaySavedJob(directoryPath: string, freezeSha256: string, job: GatewayJob,
  events: readonly GatewayStudyLedgerEvent[]): Promise<GatewayStudyResult> {
  return readGatewaySavedJobWithParser(directoryPath, freezeSha256, job, events, PROFILE, parseGatewayStudyResponse);
}

async function openGatewayStudyStoreWithParser<R extends SavedResult>(directoryPath: string, freezeSha256: string,
  profile: StoreProfile, parseResponse: ResponseParser<R>) {
  if (!isAbsolute(directoryPath) || resolve(directoryPath) !== directoryPath || await realpath(directoryPath) !== directoryPath) fail("noncanonical study path");
  digest(freezeSha256); await directory(directoryPath);
  const lockPath = join(directoryPath, "active.lock"), lock = await open(lockPath, "wx", 0o600), nonce = randomUUID();
  const lockValue = { protocol: profile, freezeSha256, pid: process.pid, nonce };
  await lock.writeFile(JSON.stringify(lockValue)); await lock.sync();
  const lockStat = await lock.stat(); let ledger: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const header = join(directoryPath, "store.json"), jobs = join(directoryPath, "jobs"), ledgerPath = join(directoryPath, "ledger.jsonl");
    if (!(await exists(header))) {
      if (await exists(jobs) || await exists(ledgerPath)) fail("orphaned store state");
      await mkdir(jobs, { mode: 0o700 });
      await writeGatewayStudyJson(header, { protocol: profile, freezeSha256 });
      await writeGatewayStudyFile(ledgerPath, new Uint8Array());
    }
    same(parse(await readGatewayStudyFile(header, 2048)), { protocol: profile, freezeSha256 }, "store header changed");
    await directory(jobs);
    const ledgerBefore = await lstat(ledgerPath);
    const ledgerRaw = await readGatewayStudyFile(ledgerPath, 8 * M), text = new TextDecoder("utf-8", { fatal: true }).decode(ledgerRaw);
    const validatedLedger = await lstat(ledgerPath), rootIdentity = await lstat(directoryPath), jobsIdentity = await lstat(jobs);
    if (ledgerBefore.dev !== validatedLedger.dev || ledgerBefore.ino !== validatedLedger.ino || ledgerBefore.size !== validatedLedger.size
      || ledgerBefore.mtimeMs !== validatedLedger.mtimeMs || ledgerBefore.ctimeMs !== validatedLedger.ctimeMs) fail("ledger changed before open");
    if (text !== "" && !text.endsWith("\n")) fail("partial ledger line");
    const events = text === "" ? [] : text.slice(0, -1).split("\n").map(line => {
      const e: unknown = JSON.parse(line);
      if (!isPlainRecord(e) || !hasExactKeys(e, ["v", "id", "kind", "micros"])) fail("ledger event shape");
      return e as GatewayStudyLedgerEvent;
    });
    const exposure = gatewayStudyLedgerExposure(events), occupied = new Set(await readdir(jobs));
    for (const key of occupied) { digest(key); await directory(join(jobs, key)); }
    for (const event of events) if (!occupied.has(event.id)) fail("ledger reservation without occupied job");
    ledger = await open(ledgerPath, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    let expectedLedger = text, expectedLedgerStat = validatedLedger;
    async function assertLedgerIdentity() {
      const handle = await ledger!.stat(), current = await lstat(ledgerPath);
      for (const stat of [handle, current]) {
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600
          || stat.dev !== expectedLedgerStat.dev || stat.ino !== expectedLedgerStat.ino || stat.size !== expectedLedgerStat.size
          || stat.mtimeMs !== expectedLedgerStat.mtimeMs || stat.ctimeMs !== expectedLedgerStat.ctimeMs) fail("ledger path or handle changed");
      }
      const rootNow = await lstat(directoryPath), jobsNow = await lstat(jobs);
      for (const [old, now] of [[rootIdentity, rootNow], [jobsIdentity, jobsNow]] as const) {
        if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== old.dev || now.ino !== old.ino
          || (now.mode & 0o777) !== 0o700 || now.uid !== process.getuid?.()) fail("store directory changed");
      }
    }
    await assertLedgerIdentity();
    let closed = false, writes = Promise.resolve();
    const ensure = () => { if (closed) fail("store is closed"); };
    return {
      exposure,
      get events(): readonly GatewayStudyLedgerEvent[] { return structuredClone(events); },
      keys: () => [...occupied].sort(),
      async lookup(job: GatewayJob) {
        ensure(); if (!occupied.has(job.key)) return null;
        return readGatewaySavedJobWithParser(directoryPath, freezeSha256, job, events, profile, parseResponse);
      },
      async begin(job: GatewayJob) {
        ensure(); digest(job.key); if (occupied.has(job.key)) fail("occupied first response cannot be retried");
        writes = writes.then(async () => {
          await assertLedgerIdentity();
          const p = join(jobs, job.key); await mkdir(p, { mode: 0o700 }); occupied.add(job.key);
          await writeGatewayStudyJson(join(p, "pending.json"), gatewayJobPendingForProfile(job, freezeSha256, profile));
        });
        await writes;
      },
      async record(job: GatewayJob, event: GatewayStudyLedgerEvent) {
        ensure(); if (!occupied.has(job.key) || event.id !== job.key) fail("ledger job identity");
        if (event.kind === "reserved") same(event, { v: 1, id: job.key, kind: "reserved", micros: gatewayReservation(job).micros }, "reservation bound changed");
        writes = writes.then(async () => {
          await assertLedgerIdentity();
          gatewayStudyLedgerExposure([...events, event]);
          const line = JSON.stringify(event) + "\n";
          await ledger!.appendFile(line); await ledger!.sync(); expectedLedger += line;
          const after = await ledger!.stat();
          if (after.dev !== expectedLedgerStat.dev || after.ino !== expectedLedgerStat.ino || after.size !== Buffer.byteLength(expectedLedger)) fail("ledger append changed identity or length");
          expectedLedgerStat = after; await assertLedgerIdentity(); events.push(structuredClone(event));
          await writeGatewayStudyJson(join(jobs, job.key, event.kind + ".json"), event);
        });
        await writes;
      },
      async capture(job: GatewayJob, raw: GatewayStudyRaw) {
        ensure(); if (!occupied.has(job.key) || raw.requestSha256 !== job.request.requestSha256) fail("raw capture request identity");
        if (events.filter(event => event.id === job.key && event.kind === "reserved").length !== 1) fail("capture without a durable reservation");
        const { body, ...metadata } = raw;
        await writeGatewayStudyFile(join(jobs, job.key, "response.body"), body);
        await writeGatewayStudyJson(join(jobs, job.key, "response.json"), { ...metadata, body: { bytes: body.byteLength, sha256: sha256Hex(body) } });
      },
      async complete(job: GatewayJob, result: R) {
        ensure(); if (!occupied.has(job.key) || result.requestSha256 !== job.request.requestSha256) fail("completion identity");
        await writeGatewayStudyJson(join(jobs, job.key, "result.json"), { protocol: profile, freezeSha256, jobKey: job.key, result });
        same(await readGatewaySavedJobWithParser(directoryPath, freezeSha256, job, events, profile, parseResponse), result, "new response reconstruction");
      },
      async close() {
        ensure(); closed = true;
        try {
          await writes; await ledger!.sync(); await assertLedgerIdentity();
          const disk = await readGatewayStudyFile(ledgerPath, 8 * M);
          if (sha256Hex(disk) !== sha256Hex(expectedLedger)) fail("durable ledger differs from accepted events");
          gatewayStudyLedgerExposure(events);
          const current = await lstat(lockPath);
          if (current.dev !== lockStat.dev || current.ino !== lockStat.ino) fail("lock ownership changed");
          same(parse(await readGatewayStudyFile(lockPath, 2048)), lockValue, "lock content changed");
          await ledger!.close(); ledger = null; await lock.close(); await unlink(lockPath);
        } catch (e) { await ledger?.close().catch(() => {}); await lock.close().catch(() => {}); throw e; }
      },
    };
  } catch (error) {
    await ledger?.close().catch(() => {}); await lock.close().catch(() => {});
    // Failed initialization remains occupied evidence; only explicit reviewed recovery can remove its lock.
    throw error;
  }
}

/** The original entry point keeps its strict v3 parser and on-disk profile. */
export function openGatewayStudyStore(directoryPath: string, freezeSha256: string) {
  return openGatewayStudyStoreWithParser(directoryPath, freezeSha256, PROFILE, parseGatewayStudyResponse);
}
/** Shared custody implementation; versioned wrappers fix the profile and response parser. */
export const gatewayStudyStoreInternals = Object.freeze({
  jobPending: gatewayJobPendingForProfile, readWithParser: readGatewaySavedJobWithParser, openWithParser: openGatewayStudyStoreWithParser,
});
