/** Durable storage and bounded contracts shared by execution and offline replay. */
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../../src/canonical";
import { parseBeamEvaluationDataV1 } from "../beam-evaluation";
import { apiTransportCustody as custody, API_BUDGET_LIMITS, type ApiConfig, type ApiLedgerBudget, type ApiLedgerEvent, type UnknownApiFilePin } from "./api-transport";

export type ApiWavePin = UnknownApiFilePin;
export const API_WAVE_LIMITS = Object.freeze({ jobs: 1000, parentsPerJob: 16, concurrency: 4, wavesPerSession: 5,
  sessionMs: 3600000, timeoutMs: 600000, planBytes: 1048576, recordBytes: 65536, journalBytes: 16777216,
  journalRecords: 12000, ownerBytes: 8192, requestBytes: 3145728, checkpointBytes: 16384,
  authorityBytes: 1048576, writerExitBytes: 65536, receiptBytes: 1048576 });
export function waveNeed(value: unknown, reason: string): asserts value {
  if (!value) throw new TypeError(`Memory lab API waves: ${reason}.`);
}
export function waveExact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  waveNeed(isPlainRecord(value) && hasExactKeys(value, keys), "unexpected or missing fields");
}
export function waveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  waveNeed(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= maximum, "integer bound");
}
export function waveHash(value: unknown): asserts value is string { waveNeed(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), "sha256 required"); }
export function waveId(value: unknown): asserts value is string { waveNeed(typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/u.test(value), "bounded identity required"); }
export function waveUuid(value: unknown): asserts value is string { waveNeed(typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value), "attempt UUID required"); }
export function wavePath(value: unknown): string {
  waveNeed(typeof value === "string" && value.length <= 4096 && !/[\u0000-\u001f\u007f]/u.test(value)
    && !/\p{Surrogate}/u.test(value) && isAbsolute(value) && resolve(value) === value, "canonical absolute path required"); return value;
}
export function wavePrivateDirectory(path: string): void {
  wavePath(path); const stat = lstatSync(path);
  waveNeed(realpathSync(path) === path && stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, "private owned directory required");
}
export function waveSyncDirectory(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function waveCreateDirectory(path: string): void { mkdirSync(path, { mode: 0o700 }); waveSyncDirectory(dirname(path)); }
export function waveFreeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(waveFreeze); Object.freeze(value); } return value; }
export const waveSame = (a: unknown, b: unknown): boolean => canonicalSha256(a) === canonicalSha256(b);
export function wavePin(path: string, maximum: number = API_WAVE_LIMITS.recordBytes): ApiWavePin {
  const raw = custody.readBytes(wavePath(path), maximum); return { path, bytes: raw.length, sha256: sha256Hex(raw) };
}
export function waveReadPin(value: unknown, maximum: number): { pin: ApiWavePin; raw: Buffer } {
  const pin = custody.parsePin(value, maximum); wavePath(pin.path); return { pin, raw: custody.readPin(pin) };
}
export function waveJson(raw: Uint8Array, maximum: number): unknown {
  waveNeed(raw.length <= maximum, "JSON byte bound");
  return parseBeamEvaluationDataV1(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw), maximum);
}
export function waveJsonPin(value: unknown, maximum: number): unknown { return waveJson(waveReadPin(value, maximum).raw, maximum); }
export function waveJsonPath(path: string, maximum: number = API_WAVE_LIMITS.recordBytes): unknown { return waveJson(custody.readBytes(path, maximum), maximum); }
export function waveWrite(path: string, value: unknown, maximum: number = API_WAVE_LIMITS.recordBytes): ApiWavePin {
  const raw = canonicalJson(value) + "\n"; waveNeed(Buffer.byteLength(raw) <= maximum, "artifact byte bound");
  custody.writeCapture(path, raw); const pin = { path, bytes: Buffer.byteLength(raw), sha256: sha256Hex(raw) };
  custody.readPin(pin); return pin;
}
export type ApiWaveJob = Readonly<{ id: string; profileId: string; requestSha256: string | null;
  maximumReservationMicros: number; maximumRequestBytes: number; dependencies: readonly string[] }>;
export type ApiWavePlan = Readonly<{ protocol: "oh.memory-lab-api-wave-plan.v1"; runId: string;
  policySha256: string; concurrency: number; requestTimeoutMs: 600000; jobs: readonly ApiWaveJob[] }>;
export function parseApiWavePlan(value: unknown, config: ApiConfig): ApiWavePlan {
  waveExact(value, ["protocol", "runId", "policySha256", "concurrency", "requestTimeoutMs", "jobs"]);
  waveNeed(value.protocol === "oh.memory-lab-api-wave-plan.v1" && value.requestTimeoutMs === API_WAVE_LIMITS.timeoutMs, "versioned wave plan required");
  waveId(value.runId); waveHash(value.policySha256); waveInteger(value.concurrency, 4); waveNeed(value.concurrency > 0, "positive concurrency required");
  waveNeed(Array.isArray(value.jobs) && value.jobs.length > 0 && value.jobs.length <= API_WAVE_LIMITS.jobs, "finite job inventory required");
  const seen = new Set<string>(); let maximum = 0;
  for (const row of value.jobs) {
    waveExact(row, ["id", "profileId", "requestSha256", "maximumReservationMicros", "maximumRequestBytes", "dependencies"]);
    waveId(row.id); waveNeed(!seen.has(row.id), "duplicate job");
    waveNeed(row.profileId === config.reader.id || row.profileId === config.judge.id, "declared profile required");
    waveInteger(row.maximumReservationMicros); waveNeed(row.maximumReservationMicros > 0, "positive reservation envelope required");
    maximum += row.maximumReservationMicros; waveInteger(maximum);
    waveInteger(row.maximumRequestBytes, API_WAVE_LIMITS.requestBytes); waveNeed(row.maximumRequestBytes > 0, "positive request envelope required");
    waveNeed(Array.isArray(row.dependencies) && row.dependencies.length <= API_WAVE_LIMITS.parentsPerJob, "dependency inventory bound");
    const parents = new Set<string>(); for (const id of row.dependencies) { waveId(id); waveNeed(seen.has(id) && !parents.has(id), "unique preceding dependency required"); parents.add(id); }
    if (row.requestSha256 === null) waveNeed(parents.size > 0, "only dependent requests may use an envelope"); else waveHash(row.requestSha256);
    seen.add(row.id);
  }
  return waveFreeze(value as unknown as ApiWavePlan);
}
export type WaveLedgerPrefix = Readonly<{ bytes: number; sha256: string }>;
export type WaveLedger = { raw: Buffer; events: ApiLedgerEvent[]; offsets: Array<{ start: number; end: number }>;
  exposure: number; reservations: number; unresolved: Set<string>; prefix: WaveLedgerPrefix };
export function waveLedger(budget: ApiLedgerBudget): WaveLedger {
  const raw = custody.pathPresent(budget.ledgerPath) ? custody.readBytes(budget.ledgerPath, API_BUDGET_LIMITS[budget.protocol].ledgerBytes) : Buffer.alloc(0);
  const events = custody.parseLedger(raw.toString("utf8"), budget), offsets: WaveLedger["offsets"] = [];
  let cursor = 0, exposure = 0, reservations = 0; const charges = new Map<string, number>(), unresolved = new Set<string>();
  for (const [index, line] of raw.toString("utf8").split("\n").slice(0, -1).entries()) {
    waveNeed(line.length > 0, "empty ledger event"); const event = events[index]; waveNeed(event, "ledger inventory mismatch"); waveUuid(event.id);
    offsets.push({ start: cursor, end: cursor + Buffer.byteLength(line) + 1 }); cursor += Buffer.byteLength(line) + 1;
    if (event.kind === "reserved") { reservations++; charges.set(event.id, event.micros); unresolved.add(event.id); exposure += event.micros; }
    else { unresolved.delete(event.id); exposure -= charges.get(event.id)! - event.micros; }
  }
  waveNeed(reservations <= budget.maxCalls, "historical call limit exceeded");
  return { raw, events, offsets, exposure, reservations, unresolved, prefix: { bytes: raw.length, sha256: sha256Hex(raw) } };
}
export function waveCheckPrefix(ledger: WaveLedger, value: unknown): WaveLedgerPrefix {
  waveExact(value, ["bytes", "sha256"]); waveInteger(value.bytes, ledger.raw.length); waveHash(value.sha256);
  waveNeed(value.bytes === 0 || ledger.raw[value.bytes - 1] === 10, "ledger prefix must end at event boundary");
  waveNeed(sha256Hex(ledger.raw.subarray(0, value.bytes)) === value.sha256, "ledger prefix changed");
  return { bytes: value.bytes, sha256: value.sha256 };
}
export type WaveJournalRecord = Readonly<{ protocol: "oh.memory-lab-api-wave-journal.v1"; sequence: number;
  previousSha256: string | null; kind: string; data: unknown; sha256: string }>;
export const WAVE_JOURNAL_KINDS = ["session", "wave", "checkpoint", "wave-close", "stopped", "closed"] as const;
export function waveReadJournal(path: string): WaveJournalRecord[] {
  const raw = custody.readBytes(path, API_WAVE_LIMITS.journalBytes);
  waveNeed(raw.length === 0 || raw.at(-1) === 10, "torn wave journal");
  const lines = raw.toString("utf8").split("\n").slice(0, -1); waveNeed(lines.length <= API_WAVE_LIMITS.journalRecords, "journal inventory bound");
  const records: WaveJournalRecord[] = []; let previous: string | null = null;
  for (const [sequence, line] of lines.entries()) {
    const value = waveJson(Buffer.from(line), API_WAVE_LIMITS.recordBytes);
    waveExact(value, ["protocol", "sequence", "previousSha256", "kind", "data", "sha256"]);
    waveNeed(value.protocol === "oh.memory-lab-api-wave-journal.v1" && value.sequence === sequence && value.previousSha256 === previous
      && typeof value.kind === "string" && WAVE_JOURNAL_KINDS.includes(value.kind as typeof WAVE_JOURNAL_KINDS[number]), "journal sequence or kind");
    const { sha256, ...payload } = value; waveHash(sha256); waveNeed(canonicalSha256(payload) === sha256, "journal digest changed");
    records.push(value as unknown as WaveJournalRecord); previous = sha256;
  }
  return records;
}
export function waveAppendJournal(path: string, records: WaveJournalRecord[], kind: typeof WAVE_JOURNAL_KINDS[number], data: unknown): WaveJournalRecord {
  const prior = waveReadJournal(path); waveNeed(waveSame(prior, records), "journal changed while owned");
  waveNeed(records.length < API_WAVE_LIMITS.journalRecords, "journal inventory bound");
  const payload = { protocol: "oh.memory-lab-api-wave-journal.v1" as const, sequence: records.length,
    previousSha256: records.at(-1)?.sha256 ?? null, kind, data };
  const record = { ...payload, sha256: canonicalSha256(payload) }, raw = canonicalJson(record) + "\n";
  waveNeed(Buffer.byteLength(raw) <= API_WAVE_LIMITS.recordBytes && lstatSync(path).size + Buffer.byteLength(raw) <= API_WAVE_LIMITS.journalBytes, "journal byte bound");
  const fd = openSync(path, "a"); try { const bytes = Buffer.from(raw); let offset = 0;
    while (offset < bytes.length) { const wrote = writeSync(fd, bytes, offset, bytes.length - offset); waveNeed(wrote > 0, "short journal write"); offset += wrote; } fsyncSync(fd);
  } finally { closeSync(fd); } waveSyncDirectory(dirname(path)); records.push(waveFreeze(record)); return record;
}
export function waveBudget(config: ApiConfig): { budget: ApiLedgerBudget; budgetPin: ApiWavePin } {
  const budgetPin = wavePin(config.budgetPath, 8192), budget = custody.parseBudget(waveJsonPin(budgetPin, 8192));
  wavePath(budget.ledgerPath); custody.privateLedgerParent(budget.ledgerPath); return { budget, budgetPin };
}
export function waveRequestCapturePath(budget: ApiLedgerBudget, id: string, suffix: string): string { return join(budget.ledgerPath + ".attempts", id + suffix); }
