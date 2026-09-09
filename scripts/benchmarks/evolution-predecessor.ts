import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { parseEvolutionCampaign, readEvolutionPin, type EvolutionCampaign, type EvolutionPin } from "./evolution-budget";

function fail(reason: string): never { throw new TypeError(`Evolution predecessor: ${reason}.`); }
const equal = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
const integer = (v: unknown, max = 1_000_000_000): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0) && v <= max;
const MAX_DATABASE = 4 * 1024 * 1024 * 1024 + 128 * 1024 * 1024;

async function drained(directory: string) {
  for (const name of ["active.lock", "campaign.sqlite-wal", "campaign.sqlite-shm"]) {
    try { await lstat(join(directory, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    fail("predecessor must be drained and checkpointed");
  }
}

/** Hash a closed database in bounded chunks; never load a multi-gigabyte file into memory. */
async function databaseIdentity(pin: EvolutionPin) {
  const initial = await lstat(pin.path);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size < 1 || initial.size > MAX_DATABASE || await realpath(pin.path) !== pin.path) fail("invalid closed database path or size");
  const file = await open(pin.path, "r");
  try {
    const current = await file.stat();
    if (current.dev !== initial.dev || current.ino !== initial.ino || current.size !== initial.size) fail("closed database identity changed");
    const hash = createHash("sha256"), chunk = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    while (bytes < initial.size) {
      const result = await file.read(chunk, 0, Math.min(chunk.length, initial.size - bytes), bytes);
      if (result.bytesRead === 0) fail("closed database truncated");
      hash.update(chunk.subarray(0, result.bytesRead)); bytes += result.bytesRead;
    }
    const final = await file.stat();
    if (final.dev !== current.dev || final.ino !== current.ino || final.size !== current.size || final.mtimeMs !== current.mtimeMs || final.ctimeMs !== current.ctimeMs
      || hash.digest("hex") !== pin.sha256) fail("closed database bytes changed");
    return { dev: final.dev, ino: final.ino, size: final.size, mtimeMs: final.mtimeMs, ctimeMs: final.ctimeMs };
  } finally { await file.close(); }
}

/** A V2 campaign adds one closed V1 campaign's current exposure exactly once.
 * It neither raises that old cap nor imports/relabels any old request capture. */
export async function verifyEvolutionPredecessor(campaign: EvolutionCampaign, legacyExposure: number): Promise<number> {
  const predecessor = campaign.predecessor;
  if (campaign.protocol !== "oh.memory.evolution-campaign.v2" || predecessor === undefined) fail("explicit V2 predecessor required");
  const parent = parseEvolutionCampaign(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEvolutionPin(predecessor.campaignPin))));
  if (parent.protocol !== "oh.memory.evolution-campaign.v1" || parent.campaignId === campaign.campaignId || parent.storeDirectory === campaign.storeDirectory
    || !equal(parent.authAuthority, campaign.authAuthority) || !equal(parent.historicalLedgers, campaign.historicalLedgers)
    || parent.historicalExposureMicros !== legacyExposure || predecessor.databasePin.path !== join(parent.storeDirectory, "campaign.sqlite")) fail("predecessor authority, ancestry or store differs");
  const directory = await lstat(parent.storeDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || await realpath(parent.storeDirectory) !== parent.storeDirectory
    || (directory.mode & 0o777) !== 0o700 || directory.uid !== process.getuid?.()) fail("private predecessor directory required");
  const receipt: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEvolutionPin(predecessor.terminalPhasePin, 128 * 1024 * 1024)));
  if (!isPlainRecord(receipt) || receipt.protocol !== "oh.memory.evolution-phase.v1" || !["reader", "judge"].includes(String(receipt.phase))
    || receipt.verified !== true || receipt.complete !== true || receipt.interrupted !== false || !Array.isArray(receipt.errors) || receipt.errors.length !== 0
    || receipt.campaignSha256 !== canonicalSha256(parent) || !isPlainRecord(receipt.budget)) fail("completed verified predecessor phase required");
  const b = receipt.budget;
  if (!hasExactKeys(b, ["calls", "exposureMicros", "confirmedMicros", "unresolvedMicros", "additionalBudgetMicros", "maximumCalls", "historicalExposureMicros", "combinedExposureMicros"])
    || !integer(b.calls, parent.maximumCalls) || !integer(b.exposureMicros, parent.additionalBudgetMicros) || !integer(b.confirmedMicros) || !integer(b.unresolvedMicros)
    || b.confirmedMicros + b.unresolvedMicros !== b.exposureMicros || b.additionalBudgetMicros !== parent.additionalBudgetMicros
    || b.maximumCalls !== parent.maximumCalls || b.historicalExposureMicros !== legacyExposure || b.combinedExposureMicros !== legacyExposure + b.exposureMicros) fail("predecessor budget does not reconcile");
  await drained(parent.storeDirectory);
  const identity = await databaseIdentity(predecessor.databasePin);
  // Immutable read-only opening cannot create journals or modify the retired store.
  const url = pathToFileURL(predecessor.databasePin.path); url.searchParams.set("immutable", "1");
  const db = new Database(url.href, { readonly: true, strict: true });
  try {
    const metadata = db.query<{ key: string; value: string }, []>("SELECT key,value FROM metadata").all();
    if (metadata.length !== 1 || metadata[0]?.key !== "identity" || metadata[0]?.value !== canonicalSha256({ protocol: "oh.memory.evolution-store.v1", campaign: parent })) fail("predecessor database authority changed");
    const totals = db.query<{ calls: number; exposure: number; confirmed: number; invalid: number }, []>(
      "SELECT count(*) AS calls, coalesce(sum(charge),0) AS exposure, coalesce(sum(CASE WHEN status='settled' THEN charge ELSE 0 END),0) AS confirmed, coalesce(sum(CASE WHEN typeof(charge)!='integer' OR typeof(reservation)!='integer' OR typeof(status)!='text' OR charge<0 OR charge>reservation OR reservation<=0 OR reservation>1000000000 OR status NOT IN ('reserved','captured','settled') OR (status!='settled' AND charge!=reservation) THEN 1 ELSE 0 END),0) AS invalid FROM jobs").get()!;
    if (totals.invalid !== 0 || totals.calls !== b.calls || totals.exposure !== b.exposureMicros || totals.confirmed !== b.confirmedMicros) fail("stale phase or changed predecessor accounting");
  } finally { db.close(); }
  const after = await lstat(predecessor.databasePin.path);
  if (!after.isFile() || after.isSymbolicLink() || !equal(identity, { dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs })) fail("predecessor changed during verification");
  await drained(parent.storeDirectory);
  await readEvolutionPin(predecessor.campaignPin); await readEvolutionPin(predecessor.terminalPhasePin, 128 * 1024 * 1024);
  return b.exposureMicros;
}
