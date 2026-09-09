import { test, expect } from "bun:test";
import { mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import { parseEvolutionCampaign, verifyEvolutionCampaign } from "../scripts/benchmarks/evolution-budget";

test("evolution campaign recomputes full historical reservations and preserves unresolved exposure", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "oh-evolution-budget-")));
  try {
    const pin = async (name: string, text: string) => { const path = join(dir, name); await writeFile(path, text); return { path, sha256: sha256Hex(text) }; };
    const authority = await pin("authority.json", JSON.stringify({ schema: "oh.gateway-v3-authority.v1", project: "oh", scope: "hraness", environment: "development" }));
    const lines = [{ v: 1, id: "a".repeat(64), kind: "reserved", micros: 1000 },
      { v: 1, id: "a".repeat(64), kind: "settled", micros: 400 }, { v: 1, id: "b".repeat(64), kind: "reserved", micros: 500 }].map(v => JSON.stringify(v)).join("\n") + "\n";
    const ledger = { ...await pin("ledger.jsonl", lines), bytes: Buffer.byteLength(lines) };
    const campaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "test", storeDirectory: join(dir, "campaign-store"), approval: "Fixture approval", additionalBudgetMicros: 10_000,
      maximumCalls: 10, historicalExposureMicros: 900, historicalLedgers: [ledger], authAuthority: authority };
    const config = await pin("campaign.json", JSON.stringify(campaign));
    expect((await verifyEvolutionCampaign(config)).historicalExposureMicros).toBe(900);
    expect(parseEvolutionCampaign(campaign).additionalBudgetMicros).toBe(10_000);
    const wrong = await pin("wrong.json", JSON.stringify({ ...campaign, historicalExposureMicros: 400 }));
    await expect(verifyEvolutionCampaign(wrong)).rejects.toThrow("does not reconcile");
    const duplicate = { ...await pin("duplicate.jsonl", lines), bytes: Buffer.byteLength(lines) };
    const dup = await pin("dup-campaign.json", JSON.stringify({ ...campaign, historicalLedgers: [ledger, duplicate], historicalExposureMicros: 1800 }));
    await expect(verifyEvolutionCampaign(dup)).rejects.toThrow("duplicate physical");
    await writeFile(ledger.path, lines.replace('"micros":500', '"micros":0'));
    await expect(verifyEvolutionCampaign(config)).rejects.toThrow("pinned content changed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("evolution campaign rejects ambiguous caps, paths and unknown configuration fields", () => {
  const good = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "test", storeDirectory: "/example/campaign-store", approval: "Test only", additionalBudgetMicros: 1000, maximumCalls: 1,
    historicalExposureMicros: 0, historicalLedgers: [{ path: "/tmp/ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/tmp/authority", sha256: "b".repeat(64) } };
  for (const value of [0, -1, 0.5, NaN, Infinity, 1_000_000_001]) expect(() => parseEvolutionCampaign({ ...good, additionalBudgetMicros: value })).toThrow();
  expect(() => parseEvolutionCampaign({ ...good, arbitraryEndpoint: "https://example.com" })).toThrow();
  expect(() => parseEvolutionCampaign({ ...good, authAuthority: good.historicalLedgers[0] })).toThrow();
  expect(() => parseEvolutionCampaign({ ...good, historicalLedgers: [{ ...good.historicalLedgers[0], path: "relative" }] })).toThrow();
  for (const storeDirectory of [undefined, "relative", "/example/../tmp/store", "/example/store/", "/example/\0store"]) {
    expect(() => parseEvolutionCampaign({ ...good, storeDirectory })).toThrow();
  }
  const { storeDirectory: _path, ...missing } = good;
  expect(() => parseEvolutionCampaign(missing)).toThrow();
  expect(parseEvolutionCampaign(good).storeDirectory).toBe(good.storeDirectory);
});
