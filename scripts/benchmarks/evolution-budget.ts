import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { gatewayStudyLedgerExposure } from "./gateway-study-transport-v3";
import { readGatewayStudyAuth } from "./gateway-study-v3";

export type EvolutionPin = Readonly<{ path: string; sha256: string }>;
export type EvolutionCampaign = Readonly<{
  protocol: "oh.memory.evolution-campaign.v1" | "oh.memory.evolution-campaign.v2";
  campaignId: string;
  storeDirectory: string;
  approval: string;
  additionalBudgetMicros: number;
  maximumCalls: number;
  historicalExposureMicros: number;
  historicalLedgers: readonly (EvolutionPin & Readonly<{ bytes: number }>)[];
  authAuthority: EvolutionPin;
  predecessor?: Readonly<{ campaignPin: EvolutionPin; terminalPhasePin: EvolutionPin; databasePin: EvolutionPin }>;
}>;
function fail(reason: string): never { throw new TypeError(`Evolution campaign: ${reason}.`); }
const integer = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0) && v <= max;
export function evolutionPin(value: unknown): EvolutionPin {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["path", "sha256"]) || typeof value.path !== "string"
    || !isAbsolute(value.path) || resolve(value.path) !== value.path || value.path.includes("\0") || value.path.length > 4096
    || typeof value.sha256 !== "string" || parseSha256Hex(value.sha256) === null) fail("invalid canonical file pin");
  return Object.freeze({ path: value.path, sha256: value.sha256 });
}
export async function readEvolutionPin(value: EvolutionPin, maximum = 2 * 1024 * 1024): Promise<Uint8Array> {
  const pin = evolutionPin(value), stat = await lstat(pin.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || await realpath(pin.path) !== pin.path) fail("pinned file type, size or alias");
  const raw = await readFile(pin.path);
  if (raw.length > maximum || sha256Hex(raw) !== pin.sha256) fail("pinned content changed");
  return raw;
}
export function parseEvolutionCampaign(value: unknown): EvolutionCampaign {
  const successor = isPlainRecord(value) && value.protocol === "oh.memory.evolution-campaign.v2";
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "campaignId", "storeDirectory", "approval", "additionalBudgetMicros", "maximumCalls",
    "historicalExposureMicros", "historicalLedgers", "authAuthority", ...(successor ? ["predecessor"] : [])])
    || !["oh.memory.evolution-campaign.v1", "oh.memory.evolution-campaign.v2"].includes(String(value.protocol))
    || typeof value.campaignId !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.campaignId)
    || typeof value.storeDirectory !== "string" || !isAbsolute(value.storeDirectory) || resolve(value.storeDirectory) !== value.storeDirectory
    || value.storeDirectory.includes("\0") || value.storeDirectory.length > 4096
    || typeof value.approval !== "string" || value.approval.length < 1 || Buffer.byteLength(value.approval) > 4096
    || !integer(value.additionalBudgetMicros, 1_000_000_000) || value.additionalBudgetMicros === 0
    || !integer(value.maximumCalls, 1_000_000) || value.maximumCalls === 0
    || !integer(value.historicalExposureMicros, 1_000_000_000)
    || !Array.isArray(value.historicalLedgers) || value.historicalLedgers.length < 1 || value.historicalLedgers.length > 32) fail("invalid explicit campaign limits");
  const ledgers = value.historicalLedgers.map((v: unknown) => {
    if (!isPlainRecord(v) || !hasExactKeys(v, ["path", "sha256", "bytes"]) || !integer(v.bytes, 32 * 1024 * 1024)) fail("invalid historical ledger");
    return Object.freeze({ ...evolutionPin({ path: v.path, sha256: v.sha256 }), bytes: v.bytes });
  });
  const authAuthority = evolutionPin(value.authAuthority);
  let predecessor: EvolutionCampaign["predecessor"];
  if (successor) {
    if (!isPlainRecord(value.predecessor) || !hasExactKeys(value.predecessor, ["campaignPin", "terminalPhasePin", "databasePin"])) fail("invalid predecessor pins");
    predecessor = Object.freeze({ campaignPin: evolutionPin(value.predecessor.campaignPin),
      terminalPhasePin: evolutionPin(value.predecessor.terminalPhasePin), databasePin: evolutionPin(value.predecessor.databasePin) });
  }
  const rolePaths = [...ledgers.map(l => l.path), authAuthority.path, ...Object.values(predecessor ?? {}).map(p => p.path)];
  if (new Set([...ledgers.map(l => l.path), authAuthority.path]).size !== ledgers.length + 1
    || new Set(rolePaths).size !== rolePaths.length || ledgers.reduce((sum, l) => sum + l.bytes, 0) > 64 * 1024 * 1024) fail("duplicate roles or aggregate historical bound");
  return Object.freeze({ protocol: value.protocol as EvolutionCampaign["protocol"], campaignId: value.campaignId, storeDirectory: value.storeDirectory, approval: value.approval,
    additionalBudgetMicros: value.additionalBudgetMicros, maximumCalls: value.maximumCalls,
    historicalExposureMicros: value.historicalExposureMicros, historicalLedgers: Object.freeze(ledgers), authAuthority,
    ...(predecessor === undefined ? {} : { predecessor }) });
}

/** Verify the closed ledgers once per phase, without rebuilding any historical study.
 * The descriptor declares complete ancestry; it cannot discover unknown concurrent campaigns.
 * All new reader, planner and judge jobs use the one campaign store and its additional cap. */
export async function verifyEvolutionCampaign(pin: EvolutionPin) {
  const raw = await readEvolutionPin(pin), campaign = parseEvolutionCampaign(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  const seen = new Set<string>();
  let exposure = 0;
  for (const ledger of campaign.historicalLedgers) {
    const bytes = await readEvolutionPin({ path: ledger.path, sha256: ledger.sha256 }, 32 * 1024 * 1024);
    if (bytes.length !== ledger.bytes) fail("historical ledger length changed");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text !== "" && !text.endsWith("\n")) fail("partial historical ledger");
    const events: unknown[] = text === "" ? [] : text.slice(0, -1).split("\n").map(line => JSON.parse(line));
    exposure += gatewayStudyLedgerExposure(events);
    for (const event of events) {
      if (isPlainRecord(event) && event.kind === "reserved") {
        if (typeof event.id !== "string" || seen.has(event.id)) fail("duplicate physical reservation across historical ledgers");
        seen.add(event.id);
      }
    }
  }
  if (campaign.protocol === "oh.memory.evolution-campaign.v2") {
    const { verifyEvolutionPredecessor } = await import("./evolution-predecessor");
    exposure += await verifyEvolutionPredecessor(campaign, exposure);
  }
  if (exposure !== campaign.historicalExposureMicros) fail("historical exposure does not reconcile");
  await readEvolutionPin(campaign.authAuthority);
  const auth = await readGatewayStudyAuth(campaign.authAuthority);
  await readEvolutionPin(pin);
  return Object.freeze({ campaign, auth, campaignSha256: canonicalSha256(campaign), historicalExposureMicros: exposure });
}
