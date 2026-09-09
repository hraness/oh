import { lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { gatewayStudyStoreInternals, readGatewayStudyFile } from "./gateway-study-store-v3";
import { gatewayStudyLedgerExposure, makeGatewayStudyRequest, type GatewayStudyLedgerEvent, type GatewayStudyRequest } from "./gateway-study-transport-v3";
import { parseGatewayStudyV6, type GatewayStudyV6Result } from "./gateway-study-transport-v6";
import { labPaidCacheJob } from "./lab-paid-cache";

export const LEGACY_LAB_PAID_NAMESPACE = "03cb4fe173c695c88442c53fc414d3abe1f7eeefcc5efb9992a6d0283cea64e4" as const;
const PROFILE = "oh.memory-gateway-lab-cache.v1" as const;
type Pin = Readonly<{ path: string; sha256: string; bytes: number }>;
function fail(reason: string): never { throw new Error(`Legacy judge replay: ${reason}.`); }
function digest(value: string) { if (!/^[a-f0-9]{64}$/.test(value)) fail("invalid digest"); return value; }
function same(a: unknown, b: unknown, reason: string) { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); }
async function privateDirectory(path: string) { const s = await lstat(path); if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o700 || s.uid !== process.getuid?.() || await realpath(path) !== path) fail("noncanonical private cache directory"); }
async function pinned(pin: Pin) { digest(pin.sha256); if (!Number.isSafeInteger(pin.bytes) || pin.bytes < 0) fail("invalid ledger pin"); const value = await readGatewayStudyFile(pin.path, pin.bytes); if (value.byteLength !== pin.bytes || sha256Hex(value) !== pin.sha256) fail("legacy ledger changed"); return value; }
function events(raw: Uint8Array) { const text = new TextDecoder("utf-8", { fatal: true }).decode(raw); if (text !== "" && !text.endsWith("\n")) fail("partial ledger"); const values = text === "" ? [] : text.slice(0, -1).split("\n").map(line => JSON.parse(line)) as GatewayStudyLedgerEvent[]; gatewayStudyLedgerExposure(values); return values; }

/** A miss is the only nonfatal non-result; occupied or malformed evidence stops replay. */
export async function replayLegacyLabPaidJudge(input: Readonly<{ directory: string; ledger: Pin; request: GatewayStudyRequest }>): Promise<Readonly<{ kind: "miss" }> | Readonly<{ kind: "hit"; result: GatewayStudyV6Result }>> {
  const directory = input.directory, ledgerPin = Object.freeze({ ...input.ledger }), supplied = structuredClone(input.request);
  if (resolve(directory) !== directory || ledgerPin.path !== join(directory, "ledger.jsonl")) fail("cache path binding");
  const request = makeGatewayStudyRequest({ phase: "judge", messages: supplied.body.messages });
  if (canonicalSha256(request) !== canonicalSha256(supplied)) fail("noncanonical judge request");
  await privateDirectory(directory); await privateDirectory(join(directory, "jobs"));
  const header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readGatewayStudyFile(join(directory, "store.json"))));
  same(header, { protocol: PROFILE, freezeSha256: LEGACY_LAB_PAID_NAMESPACE }, "cache header changed");
  const job = labPaidCacheJob(LEGACY_LAB_PAID_NAMESPACE, request);
  const ledger = events(await pinned(ledgerPin));
  try { await lstat(join(directory, "jobs", job.key)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { if (ledger.some(event => event.id === job.key)) fail("ledger records missing occupied job"); await pinned(ledgerPin); return { kind: "miss" }; } throw error; }
  const result = await gatewayStudyStoreInternals.readWithParser(directory, LEGACY_LAB_PAID_NAMESPACE, job, ledger, PROFILE, parseGatewayStudyV6);
  await pinned(ledgerPin);
  return { kind: "hit", result };
}
