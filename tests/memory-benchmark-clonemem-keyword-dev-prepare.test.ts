import { expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { sha256Hex } from "../src/canonical";
import { cloneMemKeywordDevCodePins, prepareCloneMemKeywordDevelopment } from "../scripts/benchmarks/clonemem-keyword-dev-prepare";
import { CLONEMEM_KEYWORD_DEV_INPUT_SHA256, parseCloneMemKeywordDevInputPins } from "../scripts/benchmarks/clonemem-keyword-dev-source";
import { ROOT } from "../scripts/benchmarks/io";

test("preparation rejects a different campaign before opening any source or creating output", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-keyword-prepare-")));
  try {
    const pin = async (name: string, value: string) => {
      const path = join(directory, name); await writeFile(path, value, { mode: 0o600 });
      return { path, sha256: sha256Hex(value) };
    };
    const authority = await pin("authority.json", JSON.stringify({ schema: "oh.gateway-v3-authority.v1",
      project: "fixture", scope: "fixture", environment: "development" }));
    const ledgers = [];
    for (let index = 0; index < 27; index++) {
      const micros = index < 25 ? 10_000_000 : index === 25 ? 3_259_158 : 0;
      const id = index.toString(16).padStart(64, "0");
      const text = micros === 0 ? "" : [{ v: 1, id, kind: "reserved", micros },
        { v: 1, id, kind: "settled", micros }].map(value => JSON.stringify(value)).join("\n") + "\n";
      ledgers.push({ ...await pin(`ledger-${index}.jsonl`, text), bytes: Buffer.byteLength(text) });
    }
    const campaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "oh-clonemem-keyword-dev-20260922-v1",
      storeDirectory: join(directory, "unused-store"), approval: "Synthetic fixture; no dispatch authorized",
      additionalBudgetMicros: 5_000_000, maximumCalls: 876, historicalExposureMicros: 253_259_158,
      historicalLedgers: ledgers, authAuthority: authority };
    // Correct pin syntax/digests but deliberately absent paths prove that a wrong
    // campaign is stopped before the full real-corpus source loader is reached.
    const inputPins = parseCloneMemKeywordDevInputPins(Object.fromEntries(Object.entries(CLONEMEM_KEYWORD_DEV_INPUT_SHA256)
      .map(([key, sha256]) => [key, { path: join(directory, `absent-${key}`), sha256 }])));
    const variants = [{ ...campaign, campaignId: "different-study" }, { ...campaign, additionalBudgetMicros: 5_000_001 },
      { ...campaign, maximumCalls: 877 }, { ...campaign, historicalLedgers: ledgers.slice(0, 26) }];
    for (const [index, variant] of variants.entries()) {
      const campaignPin = await pin(`wrong-${index}.json`, JSON.stringify(variant)), outputDirectory = join(directory, `output-${index}`);
      await expect(prepareCloneMemKeywordDevelopment({ inputPins, campaignPin, outputDirectory }))
        .rejects.toThrow("campaign identity or limits");
      await expect(lstat(outputDirectory)).rejects.toThrow("ENOENT");
      await expect(lstat(campaign.storeDirectory)).rejects.toThrow("ENOENT");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("code inventory covers retrieval, native custody and request surfaces with exact local bytes", async () => {
  const pins = await cloneMemKeywordDevCodePins(), paths = pins.map(pin => relative(ROOT, pin.path));
  expect(paths.length).toBeLessThanOrEqual(515);
  expect(new Set(paths).size).toBe(paths.length);
  expect(paths).toEqual([...paths].sort());
  // Deliberately check behavior-critical boundaries, not an implementation's
  // incidental current file count or an unrelated closed-study inventory.
  for (const path of ["src/search.ts", "src/sqlite/store.ts", "src/sqlite/migrations.ts", "src/sdk.ts", "src/canonical.ts",
    "scripts/benchmarks/clonemem-keyword-policy.ts", "scripts/benchmarks/clonemem-keyword-dev-source.ts",
    "scripts/benchmarks/clonemem-keyword-dev-prepare.ts", "scripts/benchmarks/clonemem-dataset.ts",
    "scripts/benchmarks/clonemem-retrieval.ts", "scripts/benchmarks/paired-memory-study.ts",
    "scripts/benchmarks/paired-memory-study-run.ts", "scripts/benchmarks/evolution-model.ts",
    "scripts/benchmarks/evolution-budget.ts", "scripts/benchmarks/evolution-store.ts", "scripts/benchmarks/evolution-transport.ts",
    "scripts/benchmarks/lab-paid-queue.ts", "package.json", "bun.lock", "benchmarks/profiles/clonemem-source-v1.json"]) {
    expect(paths).toContain(path);
  }
  for (const pin of pins) {
    expect(await realpath(pin.path)).toBe(pin.path);
    expect(pin.sha256).toBe(sha256Hex(await readFile(pin.path)));
  }
});
