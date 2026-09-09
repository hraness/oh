import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { parseEvolutionCampaign, verifyEvolutionCampaign, type EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
import { makeEvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { openImmutableEvolutionPredecessor } from "../scripts/benchmarks/evolution-predecessor";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "oh-predecessor-#?% space-é-"))); roots.push(root);
  let ordinal = 0;
  const pin = async (name: string, value: unknown) => { const path = join(root, `${ordinal++}-${name}`), bytes = JSON.stringify(value); await writeFile(path, bytes); return { path, sha256: sha256Hex(bytes) }; };
  const ledgerPath = join(root, "legacy.jsonl"), ledger = JSON.stringify({ v: 1, id: "prior", kind: "reserved", micros: 900 }) + "\n";
  await writeFile(ledgerPath, ledger);
  const authAuthority = await pin("auth.json", { schema: "oh.gateway-v3-authority.v1", project: "oh", scope: "hraness", environment: "development" });
  const parent: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "parent", storeDirectory: join(root, "parent"),
    approval: "Synthetic fixture; zero provider calls", additionalBudgetMicros: 100_000, maximumCalls: 10, historicalExposureMicros: 900,
    historicalLedgers: [{ path: ledgerPath, sha256: sha256Hex(ledger), bytes: Buffer.byteLength(ledger) }], authAuthority };
  const campaignPin = await pin("parent.json", parent);
  const store = await openEvolutionStore({ directory: parent.storeDirectory, campaign: parent });
  const successful = makeEvolutionRequest("gpt4o-official-snapshot-judge", [{ role: "user", content: "Synthetic successful request" }]);
  const failed = makeEvolutionRequest("gpt4o-official-snapshot-judge", [{ role: "user", content: "Synthetic unknown request" }]);
  store.admit(successful); store.admit(failed);
  const body = new TextEncoder().encode(JSON.stringify({ model: successful.model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "yes" } }],
    usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 } }));
  store.capture(successful, { body, complete: true, receivedBytes: body.length, httpStatus: 200, error: null }); store.finalize(successful);
  const budget = store.summary(); await store.close();
  const databasePath = join(parent.storeDirectory, "campaign.sqlite"), databasePin = { path: databasePath, sha256: sha256Hex(await readFile(databasePath)) };
  const receipt = { protocol: "oh.memory.evolution-phase.v1", phase: "judge", verified: true, complete: true, interrupted: false, errors: [], campaignSha256: canonicalSha256(parent), budget };
  const terminalPhasePin = await pin("terminal.json", receipt);
  const successor: EvolutionCampaign = { ...parent, protocol: "oh.memory.evolution-campaign.v2", campaignId: "successor", storeDirectory: join(root, "successor"),
    additionalBudgetMicros: 10_000, historicalExposureMicros: budget.combinedExposureMicros,
    predecessor: { campaignPin, terminalPhasePin, databasePin } };
  return { root, pin, parent, successor, receipt, budget, databasePath, failed };
}

test("successor counts settled and unresolved predecessor exposure once without changing old authority or bytes", async () => {
  const f = await fixture(), oldBytes = await readFile(f.databasePath), descriptor = await f.pin("successor.json", f.successor);
  const verified = await verifyEvolutionCampaign(descriptor);
  expect(verified.historicalExposureMicros).toBe(900 + f.budget.confirmedMicros + f.budget.unresolvedMicros);
  expect(verified.campaign.additionalBudgetMicros).toBe(10_000);
  expect(f.budget.unresolvedMicros).toBe(f.failed.reservationMicros);
  expect(await readFile(f.databasePath)).toEqual(oldBytes);
  expect(parseEvolutionCampaign(f.parent)).toEqual(f.parent);
  const next = await openEvolutionStore({ directory: f.successor.storeDirectory, campaign: verified.campaign });
  try { expect(next.summary()).toMatchObject({ calls: 0, exposureMicros: 0, historicalExposureMicros: f.budget.combinedExposureMicros }); }
  finally { await next.close(); }
});

test("successor refuses changed totals, duplicate ancestry roles and incomplete or foreign receipts", async () => {
  const f = await fixture();
  await expect(verifyEvolutionCampaign(await f.pin("wrong-history.json", { ...f.successor, historicalExposureMicros: 900 }))).rejects.toThrow("does not reconcile");
  for (const changed of [{ complete: false }, { verified: false }, { interrupted: true }, { errors: [{}] }, { campaignSha256: "0".repeat(64) },
    { budget: { ...f.budget, calls: f.budget.calls - 1 } }, { budget: { ...f.budget, confirmedMicros: f.budget.confirmedMicros + 1, unresolvedMicros: f.budget.unresolvedMicros - 1 } }]) {
    const terminalPhasePin = await f.pin("bad-terminal.json", { ...f.receipt, ...changed });
    await expect(verifyEvolutionCampaign(await f.pin("bad-successor.json", { ...f.successor, predecessor: { ...f.successor.predecessor, terminalPhasePin } }))).rejects.toThrow();
  }
  expect(() => parseEvolutionCampaign({ ...f.parent, predecessor: f.successor.predecessor })).toThrow();
  expect(() => parseEvolutionCampaign({ ...f.successor, predecessor: { ...f.successor.predecessor, terminalPhasePin: f.successor.authAuthority } })).toThrow();
});

test("successor refuses active, changed, aliased or uncheckpointed predecessor databases", async () => {
  const f = await fixture(), descriptor = await f.pin("successor.json", f.successor);
  for (const name of ["active.lock", "campaign.sqlite-wal", "campaign.sqlite-shm"]) {
    const path = join(f.parent.storeDirectory, name); await writeFile(path, "");
    await expect(verifyEvolutionCampaign(descriptor)).rejects.toThrow("drained"); await rm(path);
  }
  const link = join(f.root, "alias.sqlite"); await symlink(f.databasePath, link);
  await expect(verifyEvolutionCampaign(await f.pin("aliased.json", { ...f.successor, predecessor: { ...f.successor.predecessor, databasePin: { ...f.successor.predecessor!.databasePin, path: link } } }))).rejects.toThrow();
  const db = new Database(f.databasePath); db.query("UPDATE jobs SET charge=charge+1 WHERE status='settled'").run(); db.close();
  await expect(verifyEvolutionCampaign(descriptor)).rejects.toThrow("bytes changed");
  const newDatabasePin = { path: f.databasePath, sha256: sha256Hex(await readFile(f.databasePath)) };
  await expect(verifyEvolutionCampaign(await f.pin("changed-accounting.json", { ...f.successor, predecessor: { ...f.successor.predecessor, databasePin: newDatabasePin } }))).rejects.toThrow("accounting");
});


test("immutable predecessor URI opens escaped paths read-only without creating journals or files", async () => {
  const f = await fixture(), before = await readFile(f.databasePath), names = await readdir(f.parent.storeDirectory);
  const db = openImmutableEvolutionPredecessor(f.databasePath);
  try {
    expect(db.query<{ calls: number }, []>("SELECT count(*) AS calls FROM jobs").get()?.calls).toBe(f.budget.calls);
    expect(() => db.query("UPDATE jobs SET charge=0").run()).toThrow("readonly");
    expect(() => db.query("CREATE TABLE unexpected(value TEXT)").run()).toThrow("readonly");
  } finally { db.close(); }
  expect(await readFile(f.databasePath)).toEqual(before);
  expect(await readdir(f.parent.storeDirectory)).toEqual(names);
  const missing = join(f.parent.storeDirectory, "absent #?%.sqlite");
  expect(() => openImmutableEvolutionPredecessor(missing)).toThrow();
  expect(await readdir(f.parent.storeDirectory)).toEqual(names);
});
