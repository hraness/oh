/** External global reservation for the frozen v6 runner. It never admits or dispatches a model call. */
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { gatewayStudyLedgerExposure, type GatewayStudyLedgerEvent } from "../benchmarks/gateway-study-transport-v3";
import { verifyPinnedLabPaidBudgetInput, type LabPaidBudgetVerification } from "../benchmarks/lab-paid-budget";
import { verifyGatewayStudyAuthority } from "../benchmarks/gateway-study-v3";
import { isAbsolute, resolve } from "node:path";

export type GatewayV6GlobalBudgetPin = Readonly<{ path: string; sha256: string }>;
export type GatewayV6GlobalBudgetContext = Readonly<{ freeze: GatewayV6GlobalBudgetPin; authority: GatewayV6GlobalBudgetPin;
  sourceSha256: string; sourceGitHead: string; v6LedgerPath: string; requiredAncestryLedgers: readonly [GatewayV6GlobalBudgetPin, GatewayV6GlobalBudgetPin, GatewayV6GlobalBudgetPin] }>;
export type GatewayV6GlobalBudgetRead = (pin: GatewayV6GlobalBudgetPin, maximum: number) => Promise<Uint8Array>;
export type GatewayV6GlobalBudgetReservation = Readonly<{
  protocol: "oh.gateway-v6-global-budget-reservation.v1"; recordedAt: string; freeze: GatewayV6GlobalBudgetPin;
  sourceSha256: string; sourceGitHead: string; budgetInput: GatewayV6GlobalBudgetPin;
  priorExposureMicros: 25_744_095; maximumNewExposureMicros: 11_804_182; capMicros: 40_000_000;
  bound: Readonly<{ remainingReaders: 28; readerMicros: 170_570; knownCompletedReaders: 331; knownTerminalReaders: 1;
    knownPhysicalJudgeRequests: 205; knownJudgeMicros: 2_566_092; unknownJudgeMaximumRequests: 28;
    unknownJudgeMaximumEachMicros: 323_840; unknownJudgeMicros: 9_067_520; totalMicros: 11_804_182; totalSha256: string }>;
}>;
export type GatewayV6GlobalBudgetEvidence = Readonly<{ pins: readonly GatewayV6GlobalBudgetPin[]; priorExposureMicros: number;
  nativeExposureMicros: number; globalExposureMicros: number; maximumNewExposureMicros: number; capMicros: number }>;

const MAX = 40_000_000, PRIOR = 25_744_095, BOUND = 11_804_182, MAX_BYTES = 32 * 1024 * 1024;
const TOTAL_SHA = "bb3bec2510cb6eb532e1812a66fde32e90afe9b342b09fe07f368fa631a71968";
function fail(reason: string): never { throw new Error(`Gateway v6 global budget: ${reason}.`); }
function integer(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0); }
function hash(v: unknown): v is string { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
function path(v: unknown): v is string { return typeof v === "string" && isAbsolute(v) && resolve(v) === v && !v.includes("\0") && v.length <= 4096; }
function pin(v: unknown): GatewayV6GlobalBudgetPin {
  if (!isPlainRecord(v) || !hasExactKeys(v, ["path", "sha256"]) || !path(v.path) || !hash(v.sha256)) fail("pin");
  return Object.freeze({ path: v.path, sha256: v.sha256 });
}
function time(v: unknown): string { if (typeof v !== "string" || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail("timestamp"); return v; }
function same(a: unknown, b: unknown, reason: string) { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); }
function decode(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
function readEvents(raw: Uint8Array): readonly GatewayStudyLedgerEvent[] {
  if (raw.length > MAX_BYTES) fail("ledger bytes"); const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (text !== "" && !text.endsWith("\n")) fail("partial ledger");
  const values: unknown[] = text === "" ? [] : text.slice(0, -1).split("\n").map(line => JSON.parse(line));
  gatewayStudyLedgerExposure(values); return values as readonly GatewayStudyLedgerEvent[];
}
type Descriptor = Readonly<{ authority: GatewayV6GlobalBudgetPin; ledgers: readonly (GatewayV6GlobalBudgetPin & Readonly<{ bytes: number }>)[];
  expectedExposureMicros: number; absentLedgerPaths: readonly string[] }>;
function descriptor(v: unknown): Descriptor {
  if (!isPlainRecord(v) || !hasExactKeys(v, ["authority", "ledgers", "expectedExposureMicros", "absentLedgerPaths"])
    || !Array.isArray(v.ledgers) || v.ledgers.length < 1 || v.ledgers.length > 16 || !integer(v.expectedExposureMicros)
    || !Array.isArray(v.absentLedgerPaths) || v.absentLedgerPaths.length < 1 || v.absentLedgerPaths.length > 16) fail("budget descriptor");
  const ledgers = v.ledgers.map(value => {
    if (!isPlainRecord(value) || !hasExactKeys(value, ["path", "sha256", "bytes"]) || !integer(value.bytes) || value.bytes > MAX_BYTES) fail("ledger pin");
    return Object.freeze({ ...pin({ path: value.path, sha256: value.sha256 }), bytes: value.bytes });
  });
  const absent = v.absentLedgerPaths.map(value => { if (!path(value)) fail("absent path"); return value; });
  if (new Set([pin(v.authority).path, ...ledgers.map(x => x.path), ...absent]).size !== 1 + ledgers.length + absent.length) fail("descriptor duplicate path");
  return Object.freeze({ authority: pin(v.authority), ledgers: Object.freeze(ledgers), expectedExposureMicros: v.expectedExposureMicros, absentLedgerPaths: Object.freeze(absent) });
}
export function parseGatewayV6GlobalBudgetReservation(value: unknown): GatewayV6GlobalBudgetReservation {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "recordedAt", "freeze", "sourceSha256", "sourceGitHead", "budgetInput", "priorExposureMicros", "maximumNewExposureMicros", "capMicros", "bound"])) fail("reservation shape");
  const b = value.bound;
  if (!isPlainRecord(b) || !hasExactKeys(b, ["remainingReaders", "readerMicros", "knownCompletedReaders", "knownTerminalReaders", "knownPhysicalJudgeRequests", "knownJudgeMicros", "unknownJudgeMaximumRequests", "unknownJudgeMaximumEachMicros", "unknownJudgeMicros", "totalMicros", "totalSha256"])) fail("bound shape");
  const expected = { remainingReaders: 28, readerMicros: 170_570, knownCompletedReaders: 331, knownTerminalReaders: 1, knownPhysicalJudgeRequests: 205, knownJudgeMicros: 2_566_092, unknownJudgeMaximumRequests: 28, unknownJudgeMaximumEachMicros: 323_840, unknownJudgeMicros: 9_067_520, totalMicros: BOUND, totalSha256: TOTAL_SHA } as const;
  same(b, expected, "bound changed");
  if (value.protocol !== "oh.gateway-v6-global-budget-reservation.v1" || !hash(value.sourceSha256) || typeof value.sourceGitHead !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceGitHead)
    || value.priorExposureMicros !== PRIOR || value.maximumNewExposureMicros !== BOUND || value.capMicros !== MAX) fail("reservation constants");
  return Object.freeze({ protocol: value.protocol, recordedAt: time(value.recordedAt), freeze: pin(value.freeze), sourceSha256: value.sourceSha256,
    sourceGitHead: value.sourceGitHead, budgetInput: pin(value.budgetInput), priorExposureMicros: PRIOR, maximumNewExposureMicros: BOUND, capMicros: MAX, bound: expected });
}
function assertContext(reservation: GatewayV6GlobalBudgetReservation, context: GatewayV6GlobalBudgetContext) {
  same(reservation.freeze, pin(context.freeze), "freeze binding");
  if (!hash(context.sourceSha256) || !/^[a-f0-9]{40}$/.test(context.sourceGitHead) || !path(context.v6LedgerPath)
    || context.requiredAncestryLedgers.length !== 3 || context.requiredAncestryLedgers.some(value => !hash(value.sha256) || !path(value.path))
    || reservation.sourceSha256 !== context.sourceSha256 || reservation.sourceGitHead !== context.sourceGitHead) fail("source binding");
}
function prefix(events: readonly GatewayStudyLedgerEvent[], prior: number, maximum: number, seen: Set<string>): number {
  let exposure = 0; const pending = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "reserved") { if (seen.has(event.id)) fail("cross-ledger reservation reuse"); seen.add(event.id); pending.set(event.id, event.micros); exposure += event.micros; }
    else { const reserved = pending.get(event.id); if (reserved === undefined) fail("native settlement"); pending.delete(event.id); exposure -= reserved - event.micros; }
    if (!Number.isSafeInteger(exposure) || exposure > maximum || prior + exposure > MAX) fail("reserved global prefix exceeded");
  }
  return exposure;
}
async function verified(read: GatewayV6GlobalBudgetRead, value: GatewayV6GlobalBudgetPin, maximum: number, bytes?: number) {
  const p = pin(value), raw = await read(p, maximum); if (raw.length > maximum || (bytes !== undefined && raw.length !== bytes) || sha256Hex(raw) !== p.sha256) fail("pinned bytes"); return raw;
}
type OriginalLedger = Readonly<{ path: string; sha256: string; bytes: number; exposureMicros: number }>;
type AuthorityVerifier = (pin: GatewayV6GlobalBudgetPin) => Promise<OriginalLedger>;

/** Before the target v6 ledger exists, retain the native descriptor verifier's stricter absent-path check. */
export async function verifyGatewayV6GlobalBudgetPreparation(reservationPin: GatewayV6GlobalBudgetPin, context: GatewayV6GlobalBudgetContext,
  read: GatewayV6GlobalBudgetRead, verifyBudget: (pin: GatewayV6GlobalBudgetPin) => Promise<LabPaidBudgetVerification> = verifyPinnedLabPaidBudgetInput): Promise<GatewayV6GlobalBudgetEvidence> {
  const reservation = parseGatewayV6GlobalBudgetReservation(decode(await verified(read, reservationPin, 128 * 1024))); assertContext(reservation, context);
  const descriptorValue = descriptor(decode(await verified(read, reservation.budgetInput, 1024 * 1024)));
  if (descriptorValue.authority.sha256 !== pin(context.authority).sha256 || descriptorValue.expectedExposureMicros !== PRIOR
    || descriptorValue.absentLedgerPaths.filter(value => value === context.v6LedgerPath).length !== 1) fail("preparation descriptor binding");
  for (const anchor of context.requiredAncestryLedgers) if (!descriptorValue.ledgers.some(ledger => ledger.path === anchor.path && ledger.sha256 === anchor.sha256)) fail("required ancestry ledger");
  await verified(read, context.authority, 1024 * 1024);
  const budget = await verifyBudget(reservation.budgetInput);
  if (budget.priorExposureMicros !== PRIOR) fail("preparation prior");
  await budget.recheck(); await verified(read, reservationPin, 128 * 1024);
  return Object.freeze({ pins: Object.freeze([pin(reservationPin), reservation.budgetInput, reservation.freeze]), priorExposureMicros: PRIOR,
    nativeExposureMicros: 0, globalExposureMicros: PRIOR, maximumNewExposureMicros: BOUND, capMicros: MAX });
}

/** Replays immutable ancestry after the sole declared v6-ledger absence has become the authenticated native ledger. */
export async function verifyGatewayV6GlobalBudgetReplay(reservationPin: GatewayV6GlobalBudgetPin, context: GatewayV6GlobalBudgetContext,
  nativeLedger: GatewayV6GlobalBudgetPin, read: GatewayV6GlobalBudgetRead, assertAbsent: (paths: readonly string[]) => Promise<void>,
  verifyAuthority: AuthorityVerifier = verifyGatewayStudyAuthority): Promise<GatewayV6GlobalBudgetEvidence> {
  const reservation = parseGatewayV6GlobalBudgetReservation(decode(await verified(read, reservationPin, 128 * 1024))); assertContext(reservation, context);
  const descriptorValue = descriptor(decode(await verified(read, reservation.budgetInput, 1024 * 1024)));
  if (descriptorValue.authority.sha256 !== pin(context.authority).sha256) fail("freeze authority binding");
  if (descriptorValue.expectedExposureMicros !== PRIOR || !descriptorValue.absentLedgerPaths.includes(context.v6LedgerPath)
    || descriptorValue.absentLedgerPaths.filter(value => value === context.v6LedgerPath).length !== 1) fail("v6 absent target");
  for (const anchor of context.requiredAncestryLedgers) if (!descriptorValue.ledgers.some(ledger => ledger.path === anchor.path && ledger.sha256 === anchor.sha256)) fail("required ancestry ledger");
  await verified(read, context.authority, 1024 * 1024);
  const original = await verifyAuthority(descriptorValue.authority);
  if (!path(original.path) || !hash(original.sha256) || !integer(original.bytes) || original.exposureMicros !== 21_655_385
    || descriptorValue.ledgers.some(ledger => ledger.path === original.path || ledger.sha256 === original.sha256)) fail("original authority anchor");
  await verified(read, { path: original.path, sha256: original.sha256 }, 16 * 1024 * 1024, original.bytes);
  await assertAbsent(descriptorValue.absentLedgerPaths.filter(value => value !== context.v6LedgerPath));
  const seen = new Set<string>(); let exposure = 0; const pins: GatewayV6GlobalBudgetPin[] = [pin(reservationPin), reservation.budgetInput, reservation.freeze, descriptorValue.authority, pin(context.authority)];
  for (const ledger of descriptorValue.ledgers) {
    const events = readEvents(await verified(read, { path: ledger.path, sha256: ledger.sha256 }, ledger.bytes, ledger.bytes)); let local = 0; const pending = new Map<string, number>();
    for (const event of events) {
      if (event.kind === "reserved") { if (seen.has(event.id)) fail("cross-ledger reservation reuse"); seen.add(event.id); pending.set(event.id, event.micros); local += event.micros; }
      else { const reserved = pending.get(event.id); if (reserved === undefined) fail("cross-ledger settlement"); pending.delete(event.id); local -= reserved - event.micros; }
      if (!Number.isSafeInteger(exposure + local) || exposure + local > MAX) fail("ancestry prefix cap");
    }
    exposure += local; pins.push(ledger);
  }
  if (exposure !== PRIOR) fail("ancestry exposure");
  const target = pin(nativeLedger); if (target.path !== context.v6LedgerPath) fail("native ledger path");
  const nativeExposureMicros = prefix(readEvents(await verified(read, target, 8 * 1024 * 1024)), PRIOR, BOUND, seen);
  await verified(read, reservationPin, 128 * 1024); await verified(read, reservation.budgetInput, 1024 * 1024);
  return Object.freeze({ pins: Object.freeze([...pins, { path: original.path, sha256: original.sha256 }, target]), priorExposureMicros: PRIOR, nativeExposureMicros,
    globalExposureMicros: PRIOR + nativeExposureMicros, maximumNewExposureMicros: BOUND, capMicros: MAX });
}
