import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { readGatewayStudyAuth, verifyGatewayStudyAuthority, type GatewayStudyAuth } from "./gateway-study-v3";
import { readGatewayStudyFile } from "./gateway-study-store-v3";
import { gatewayStudyLedgerExposure, type GatewayStudyLedgerEvent } from "./gateway-study-transport-v3";

type Pin = Readonly<{ path: string; sha256: string }>;
type LedgerPin = Pin & Readonly<{ bytes: number }>;
export type LabPaidBudgetInput = Readonly<{ authority: Pin; ledgers: readonly LedgerPin[];
  expectedExposureMicros: number; absentLedgerPaths: readonly string[] }>;
export type LabPaidBudgetVerification = Readonly<{ auth: GatewayStudyAuth; priorExposureMicros: number;
  fingerprint: string; recheck(): Promise<void> }>;
type AuthorityVerifier = Readonly<{ verifyAuthority: typeof verifyGatewayStudyAuthority;
  readAuth: typeof readGatewayStudyAuth }>;
const MAX_BYTES = 32 * 1024 * 1024, MAX_MICROS = 40_000_000;
function fail(reason: string): never { throw new Error(`Lab paid budget: ${reason}.`); }
function integer(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0); }
function path(v: unknown): string {
  if (typeof v !== "string" || !isAbsolute(v) || resolve(v) !== v || v.includes("\0") || v.length > 4096) fail("noncanonical absolute path");
  return v;
}
function pin(v: unknown): Pin {
  if (!isPlainRecord(v) || !hasExactKeys(v, ["path", "sha256"]) || typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sha256)) fail("invalid pin");
  return Object.freeze({ path: path(v.path), sha256: v.sha256 });
}
function parseInput(v: unknown): LabPaidBudgetInput {
  if (!isPlainRecord(v) || !hasExactKeys(v, ["authority", "ledgers", "expectedExposureMicros", "absentLedgerPaths"])
    || !Array.isArray(v.ledgers) || v.ledgers.length < 1 || v.ledgers.length > 16
    || !Array.isArray(v.absentLedgerPaths) || v.absentLedgerPaths.length < 1 || v.absentLedgerPaths.length > 16
    || !integer(v.expectedExposureMicros) || v.expectedExposureMicros > MAX_MICROS) fail("invalid bounded descriptor");
  const authority = pin(v.authority), ledgers = v.ledgers.map((l: unknown) => {
    if (!isPlainRecord(l) || !hasExactKeys(l, ["path", "sha256", "bytes"]) || !integer(l.bytes) || l.bytes > MAX_BYTES) fail("invalid ledger pin");
    return Object.freeze({ ...pin({ path: l.path, sha256: l.sha256 }), bytes: l.bytes });
  }), absentLedgerPaths = v.absentLedgerPaths.map(path);
  const paths = [authority.path, ...ledgers.map(l => l.path), ...absentLedgerPaths];
  if (new Set(paths).size !== paths.length) fail("duplicate paths across descriptor roles");
  if (ledgers.reduce((sum, l) => sum + l.bytes, 0) > MAX_BYTES) fail("aggregate ledger byte limit");
  return Object.freeze({ authority, ledgers: Object.freeze(ledgers), expectedExposureMicros: v.expectedExposureMicros,
    absentLedgerPaths: Object.freeze(absentLedgerPaths) });
}
async function readPin(p: Pin, maximum: number, bytes?: number): Promise<Uint8Array> {
  if (await realpath(p.path) !== p.path) fail("canonical file path alias");
  const raw = await readGatewayStudyFile(p.path, maximum);
  if (bytes !== undefined && raw.length !== bytes || sha256Hex(raw) !== p.sha256) fail("pinned file bytes changed");
  return raw;
}
async function absent(paths: readonly string[]): Promise<void> {
  for (const p of paths) {
    if (await realpath(dirname(p)) !== dirname(p)) fail("canonical absent-path parent alias");
    try { await lstat(p); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    fail("declared absent ledger exists"); // Includes dangling symlinks.
  }
}
function events(raw: Uint8Array): readonly GatewayStudyLedgerEvent[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (text !== "" && !text.endsWith("\n")) fail("partial ledger line");
  const parsed: unknown[] = text === "" ? [] : text.slice(0, -1).split("\n").map(line => JSON.parse(line));
  gatewayStudyLedgerExposure(parsed); // Exact native grammar, pairing, settlement bounds and per-ledger prefixes.
  return parsed as readonly GatewayStudyLedgerEvent[];
}

/** Test seam only for the fixed historical authority; all custody, pins and native accounting remain real. */
export function createLabPaidBudgetVerifier(verifier: AuthorityVerifier) {
  async function verifyLabPaidBudgetInput(value: LabPaidBudgetInput): Promise<LabPaidBudgetVerification> {
    const input = parseInput(value); // Detach caller-owned mutable objects before the first await.
    async function inspect() {
      await absent(input.absentLedgerPaths);
      await readPin(input.authority, 1024 * 1024);
      const original = await verifier.verifyAuthority(input.authority);
      const originalPin = pin({ path: original.path, sha256: original.sha256 });
      if (!integer(original.bytes) || original.bytes > 16 * 1024 * 1024 || original.exposureMicros !== 21_655_385) fail("original authority ledger anchor");
      if (input.ledgers.some(l => l.path === originalPin.path || l.sha256 === originalPin.sha256)
        || input.absentLedgerPaths.includes(originalPin.path) || input.authority.path === originalPin.path) fail("original ledger must remain separate");
      await readPin(originalPin, 16 * 1024 * 1024, original.bytes);
      const auth = Object.freeze({ ...await verifier.readAuth(input.authority) });
      const seen = new Set<string>();
      let priorExposureMicros = 0;
      // The caller attests this is the complete native ancestry in oldest-to-newest order.
      // This verifier cannot discover omitted unknown descendants or serialize old runners.
      for (const ledger of input.ledgers) {
        const parsed = events(await readPin(ledger, MAX_BYTES, ledger.bytes));
        const pending = new Map<string, number>();
        let running = priorExposureMicros;
        for (const e of parsed) {
          if (e.kind === "reserved") {
            if (seen.has(e.id)) fail("duplicate physical reservation across ledgers");
            seen.add(e.id); pending.set(e.id, e.micros); running += e.micros;
          } else { running -= pending.get(e.id)! - e.micros; pending.delete(e.id); }
          if (!Number.isSafeInteger(running) || running > MAX_MICROS) fail("combined historical prefix exceeds amendment cap");
        }
        priorExposureMicros = running; // Unsettled reservations retain their full charge.
      }
      if (priorExposureMicros !== input.expectedExposureMicros) fail("recomputed exposure does not match descriptor");
      await readPin(input.authority, 1024 * 1024);
      await absent(input.absentLedgerPaths);
      return { auth, priorExposureMicros, fingerprint: canonicalSha256({ protocol: "oh.lab-paid-budget.v1", input, original, auth, priorExposureMicros }) };
    }
    const initial = await inspect();
    return Object.freeze({ ...initial, async recheck() {
      if ((await inspect()).fingerprint !== initial.fingerprint) fail("verified budget input changed");
    } });
  }
  /** Production callers use the descriptor pin; expectedExposure alone conveys no authority. */
  async function verifyPinnedLabPaidBudgetInput(value: Pin): Promise<LabPaidBudgetVerification> {
    const descriptor = pin(value);
    const raw = await readPin(descriptor, 1024 * 1024);
    const input = parseInput(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
    const verified = await verifyLabPaidBudgetInput(input);
    await readPin(descriptor, 1024 * 1024);
    return Object.freeze({ ...verified,
      fingerprint: canonicalSha256({ descriptor, budgetFingerprint: verified.fingerprint }),
      async recheck() { await readPin(descriptor, 1024 * 1024); await verified.recheck(); },
    });
  }
  return { verifyLabPaidBudgetInput, verifyPinnedLabPaidBudgetInput };
}
const production = createLabPaidBudgetVerifier({ verifyAuthority: verifyGatewayStudyAuthority, readAuth: readGatewayStudyAuth });
export const verifyLabPaidBudgetInput = production.verifyLabPaidBudgetInput;
export const verifyPinnedLabPaidBudgetInput = production.verifyPinnedLabPaidBudgetInput;
