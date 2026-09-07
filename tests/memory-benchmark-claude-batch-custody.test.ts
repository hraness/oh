import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../src/canonical";
import { checkPriorBatches } from "../scripts/benchmarks/claude-study";

const freezeSha256 = sha256Hex("synthetic freeze");
async function temporary(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "oh-claude-custody-test-"));
  try { await chmod(directory, 0o700); await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
function fixture(status: "paused" | "completed" = "paused") {
  const runId = randomUUID(), sourceSha256 = sha256Hex("synthetic source");
  const admission = { protocol: "oh.memory-claude-subscription-batch-admission.v1", runId, freezeSha256,
    sourceSha256, cliSha256: sha256Hex("synthetic CLI bytes"), start: "2026-01-01T00:00:00.000Z", maximumNewCalls: 1 };
  const started = JSON.stringify(admission, null, 2) + "\n";
  const receipt = { protocol: "oh.memory-claude-subscription-batch.v1", runId, freezeSha256, sourceSha256,
    start: admission.start, end: "2026-01-01T00:00:01.000Z", admissionSha256: sha256Hex(started),
    sourceVerifiedAtClose: true, cliVerifiedAtClose: true, storeClosed: true, comparisonArtifact: null,
    qualified: { version: "2.1.263 (Claude Code)", auth: { authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" } },
    newTransportInvocations: 1, maximumNewCalls: 1, interrupted: false, failed: false,
    result: { status, phase: "extract", completed: 1, required: status === "paused" ? 2 : 1 } };
  return { runId, admission, started, receipt };
}
async function writeStarted(directory: string, f: ReturnType<typeof fixture>): Promise<string> {
  const path = join(directory, `batch-${f.runId}-started.json`);
  await writeFile(path, f.started, { mode: 0o600, flag: "wx" });
  return path;
}
async function writeReceipt(directory: string, f: ReturnType<typeof fixture>, value: unknown = f.receipt): Promise<string> {
  const path = join(directory, `batch-${f.runId}.json`);
  await writeFile(path, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
  return path;
}

test("empty history and fully closed paused/completed batches permit progression without rewriting evidence", async () => {
  await temporary(async directory => {
    await checkPriorBatches(directory, freezeSha256);
    const paused = fixture("paused"), completed = fixture("completed");
    const paths = [await writeStarted(directory, paused), await writeReceipt(directory, paused),
      await writeStarted(directory, completed), await writeReceipt(directory, completed)];
    const before = await Promise.all(paths.map(path => readFile(path)));
    await checkPriorBatches(directory, freezeSha256);
    expect(await Promise.all(paths.map(path => readFile(path)))).toEqual(before);
  });
});

test("an admitted batch without its closed receipt rejects and its bytes remain available", async () => {
  await temporary(async directory => {
    const f = fixture(), path = await writeStarted(directory, f);
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow();
    expect((await readFile(path)).toString()).toBe(f.started);
  });
});

test("source, CLI or store-close failure remains blocking despite any otherwise completed transport work", async () => {
  for (const changed of [
    { failed: true }, { sourceVerifiedAtClose: false }, { cliVerifiedAtClose: false }, { storeClosed: false },
  ]) await temporary(async directory => {
    const f = fixture("completed");
    await writeStarted(directory, f);
    await writeReceipt(directory, f, { ...f.receipt, ...changed });
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow("custody review");
  });
});

test("closure must bind the exact admitted bytes, run and freeze", async () => {
  for (const changed of [
    { admissionSha256: sha256Hex("other admission") }, { runId: randomUUID() },
    { freezeSha256: sha256Hex("other freeze") }, { protocol: "other protocol" },
  ]) await temporary(async directory => {
    const f = fixture();
    await writeStarted(directory, f);
    await writeReceipt(directory, f, { ...f.receipt, ...changed });
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow();
  });
  await temporary(async directory => {
    const f = fixture();
    await writeStarted(directory, { ...f, started: f.started + " " });
    await writeReceipt(directory, f);
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow("custody review");
  });
});

test("corrupt, torn, oversized, foreign or filename-mismatched admissions are never silently skipped", async () => {
  for (const alter of [
    (f: ReturnType<typeof fixture>) => "{",
    (f: ReturnType<typeof fixture>) => " ".repeat(32769),
    (f: ReturnType<typeof fixture>) => JSON.stringify({ ...f.admission, freezeSha256: sha256Hex("other freeze") }),
    (f: ReturnType<typeof fixture>) => JSON.stringify({ ...f.admission, runId: randomUUID() }),
  ]) await temporary(async directory => {
    const f = fixture();
    await writeStarted(directory, { ...f, started: alter(f) });
    await writeReceipt(directory, f);
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow();
  });
});

test("corrupt and symlinked closure records cannot grant recovery authority", async () => {
  for (const invalid of ["{", "null", "\ufffd", " ".repeat(32769)]) await temporary(async directory => {
    const f = fixture();
    await writeStarted(directory, f);
    await writeFile(join(directory, `batch-${f.runId}.json`), invalid, { mode: 0o600, flag: "wx" });
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow();
  });
  await temporary(async directory => {
    const f = fixture();
    await writeStarted(directory, f);
    const target = join(directory, "synthetic-target.json");
    await writeFile(target, JSON.stringify(f.receipt), { mode: 0o600, flag: "wx" });
    await symlink(target, join(directory, `batch-${f.runId}.json`));
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow();
    expect(JSON.parse((await readFile(target)).toString())).toEqual(f.receipt);
  });
});

test("a valid newest batch does not hide an older unresolved admission", async () => {
  await temporary(async directory => {
    const older = fixture(), newer = fixture();
    await writeStarted(directory, older);
    await writeStarted(directory, newer); await writeReceipt(directory, newer);
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow();
  });
});

function capacity(unifiedWindows: Record<string, { resetsAt: number; utilization: number }>) {
  return { status: "allowed", isUsingOverage: false, overageStatus: "rejected", overageDisabledReason: "org_level_disabled",
    rateLimitType: null, resetsAt: null, unifiedWindows };
}

test("a persisted high-utilization pause prevents repeated calls until every qualifying window resets", async () => {
  const now = Math.floor(Date.now() / 1000), future = now + 86400, past = now - 86400;
  const windowsToPause: Parameters<typeof capacity>[0][] = [
    { five_hour: { resetsAt: future, utilization: 0.7 } },
    { five_hour: { resetsAt: past, utilization: 0.9 }, seven_day: { resetsAt: future, utilization: 0.8 } },
  ];
  for (const windows of windowsToPause) await temporary(async directory => {
    const f = fixture();
    await writeStarted(directory, f);
    await writeReceipt(directory, f, { ...f.receipt, capacityPause: capacity(windows) });
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow("capacity pause remains active");
  });
  for (const pause of [null, capacity({ five_hour: { resetsAt: past, utilization: 0.9 }, seven_day: { resetsAt: future, utilization: 0.69 } }), capacity({})]) {
    await temporary(async directory => {
      const f = fixture();
      await writeStarted(directory, f);
      await writeReceipt(directory, f, { ...f.receipt, capacityPause: pause });
      await checkPriorBatches(directory, freezeSha256);
      expect(JSON.parse((await readFile(join(directory, `batch-${f.runId}.json`))).toString()).capacityPause).toEqual(pause);
    });
  }
});

test("malformed persisted capacity metadata never clears a pause", async () => {
  const future = Math.floor(Date.now() / 1000) + 86400;
  const valid = capacity({ five_hour: { resetsAt: future, utilization: 0.8 } });
  const malformed: unknown[] = ["bad", {}, { ...valid, isUsingOverage: true }, { ...valid, unifiedWindows: [] },
    { ...valid, unifiedWindows: { five_hour: { resetsAt: "later", utilization: 0.8 } } },
    { ...valid, unifiedWindows: { five_hour: { resetsAt: future + 0.5, utilization: 0.8 } } },
    { ...valid, unifiedWindows: { five_hour: { resetsAt: future, utilization: -1 } } },
    { ...valid, unifiedWindows: { five_hour: { resetsAt: future, utilization: null } } },
    { ...valid, unifiedWindows: { five_hour: { resetsAt: future, utilization: 0.8, unexpected: true } } },
    { ...valid, unifiedWindows: { "invalid key": { resetsAt: future, utilization: 0.8 } } }];
  for (const pause of malformed) await temporary(async directory => {
    const f = fixture();
    await writeStarted(directory, f);
    await writeReceipt(directory, f, { ...f.receipt, capacityPause: pause });
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow("invalid prior capacity");
  });
});
