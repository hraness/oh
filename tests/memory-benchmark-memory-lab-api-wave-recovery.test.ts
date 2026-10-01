import { afterEach, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { prepareApiRequest, type ApiConfig, type ApiLedgerEvent } from "../scripts/benchmarks/memory-lab/api-transport";
import { ApiLabWaveTransport, type ApiWaveBoundary, type ApiWavePin, type ApiWavePlan } from "../scripts/benchmarks/memory-lab/api-wave";
import { verifyApiWaveRun } from "../scripts/benchmarks/memory-lab/api-wave-replay";
import { closeUnknownApiWaveBatch, prepareApiWaveClosureEvidence, verifyUnknownApiWaveBatch } from "../scripts/benchmarks/memory-lab/api-wave-recovery";

// Run in an empty external environment. No provider, real key, actual campaign,
// or user data is used; even the supervisor evidence is an invented declaration.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); delete process.env.VERTEX_API_KEY; });
const baseTime = Date.parse("2026-10-01T06:00:00Z");
const messages = [{ role: "user" as const, content: "Invented batch closure fixture: a toy fox holds a blue paper map." }];
function pin(path: string): ApiWavePin { const raw = readFileSync(path); return { path, bytes: raw.length, sha256: sha256Hex(raw) }; }
function save(path: string, value: unknown): ApiWavePin { writeFileSync(path, JSON.stringify(value) + "\n", { mode: 0o600 }); return pin(path); }
function tree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(directory: string, relative: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name), path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, name); else if (entry.isSymbolicLink()) result[name] = `symlink:${readlinkSync(path)}`;
      else result[name] = sha256Hex(readFileSync(path));
    }
  }
  visit(root, ""); return result;
}
function reply(): Response {
  return Response.json({ modelVersion: "gemini-3.8-flash", candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Invented captured answer." }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 0, totalTokenCount: 12 } });
}
async function fixture(mode: "all-unknown" | "one-unknown" | "captured-unsettled" | "partial-reservation" = "all-unknown", options: { sendDelayMs?: number } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oh-api-wave-closure-invented-"))); roots.push(root);
  const cache = join(root, "cache"), run = join(root, "run"); mkdirSync(cache, { mode: 0o700 }); mkdirSync(run, { mode: 0o700 });
  const ledgerPath = join(cache, "ledger.jsonl"), budgetPath = join(root, "budget.json"), journalPath = join(run, "waves.jsonl");
  const config: ApiConfig = { budgetPath,
    reader: { id: "invented-reader", model: "gemini-3.8-flash", keyEnv: "VERTEX_API_KEY", maximumOutput: 64 },
    judge: { id: "unused-judge", model: "grok-4.7", keyEnv: "XAI_API_KEY", maximumOutput: 64 } };
  save(budgetPath, { protocol: "oh.memory-lab-api-budget.v2", maxUsd: 5, maxCalls: 100, expiresAt: "2026-10-03T00:00:00Z", ledgerPath });
  const request = prepareApiRequest(config.reader, messages);
  const planValue: ApiWavePlan = { protocol: "oh.memory-lab-api-wave-plan.v1", runId: "invented-closure-run",
    policySha256: canonicalSha256({ invented: true, closure: "accounting-only" }), concurrency: 4, requestTimeoutMs: 600000,
    jobs: Array.from({ length: 4 }, (_, i) => ({ id: `job-${i}`, profileId: config.reader.id, requestSha256: request.requestSha256,
      maximumReservationMicros: request.reservationMicros, maximumRequestBytes: Buffer.byteLength(request.raw), dependencies: [] })) };
  const plan = save(join(root, "plan.json"), planValue); process.env.VERTEX_API_KEY = "invented-wave-recovery-not-a-credential";
  let calls = 0, current = baseTime;
  const fetcher = Object.assign(async () => {
    const index = calls++;
    if (mode === "all-unknown" || mode === "one-unknown" && index === 0) throw Error("invented unknown provider outcome");
    return reply();
  }, { preconnect() { throw Error("invented fixture cannot connect"); } }) as typeof fetch;
  const transport = await ApiLabWaveTransport.open({ config, plan, journalPath, concurrency: 4, requestTimeoutMs: 600000,
    now: () => current, fetcher, onBoundary(point: ApiWaveBoundary, identity) {
      if (point === "wave-intent") current = baseTime + (options.sendDelayMs ?? 0);
      if (identity.jobId === "job-0" && (mode === "captured-unsettled" && point === "result-capture"
        || mode === "partial-reservation" && point === "reservation")) throw Error("invented durable boundary fault");
    } });
  try {
    const pending = transport.invokeWave(planValue.jobs.map(row => ({ jobId: row.id, messages, dependencyReceipts: [] })));
    if (mode === "partial-reservation") await expect(pending).rejects.toThrow("invented durable");
    else expect((await pending).status).toBe("stopped");
  } finally { transport.close(); }
  delete process.env.VERTEX_API_KEY;
  const replayInput = { config, plan, journalPath }, evidence = prepareApiWaveClosureEvidence(replayInput);
  const owner = JSON.parse(readFileSync(evidence.owner.path, "utf8")) as { ownerId: string };
  const exit = { protocol: "oh.memory-lab-api-wave-writer-exit.v1", evidenceBasis: "reviewed-supervisor-attestation",
    supervisor: "invented-offline-supervisor", sessionId: 1, completionId: "invented-exited-session", exitCode: 0,
    observedExitedAt: "2026-10-01T06:01:00.000Z", ownerId: owner.ownerId, ownerSha256: evidence.owner.sha256,
    journalSha256: evidence.journal.sha256, attemptIds: evidence.members.map(row => row.attemptId), localInvocations: "all-exited", runResumable: false };
  const writerExit = save(join(root, "writer-exit.json"), exit);
  const authority = { protocol: "oh.memory-lab-api-wave-closure-authority.v1", approved: true, reviewId: "invented-independent-closure-review",
    owner: evidence.owner, plan: evidence.plan, journal: evidence.journal, budget: evidence.budget, ledgerPrefix: evidence.ledgerPrefix,
    members: evidence.members, plannedJobs: evidence.plannedJobs, writerExit };
  const input = { config, authority: save(join(root, "closure-authority.json"), authority) };
  return { root, run, config, ledgerPath, journalPath, plan, request, replayInput, evidence, exit, authority, input,
    prefix: readFileSync(ledgerPath), receiptPath: join(run, "batch-accounting-closure.json"), calls: () => calls };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function ledger(f: Fixture): ApiLedgerEvent[] { return readFileSync(f.ledgerPath, "utf8").trim().split("\n").map(line => JSON.parse(line) as ApiLedgerEvent); }

test("all four unknown siblings close at full reservation without usage, accepted results, retries or new sends", async () => {
  const f = await fixture(); expect(f.calls()).toBe(4);
  const before = tree(f.root);
  expect(prepareApiWaveClosureEvidence(f.replayInput)).toEqual(f.evidence); expect(tree(f.root)).toEqual(before);
  expect(() => verifyUnknownApiWaveBatch(f.input)).toThrow("incomplete"); expect(tree(f.root)).toEqual(before);
  const receipt = closeUnknownApiWaveBatch(f.input);
  expect(receipt).toMatchObject({ trialStatus: "stopped", runResumable: false, providerCalls: 0, invoiceVerified: false,
    acceptedResult: false, retryAuthorized: false, writerExitEvidenceBasis: "reviewed-supervisor-attestation" });
  expect(receipt.actions).toHaveLength(4);
  for (const action of receipt.actions) expect(action).toMatchObject({ action: "retain-unknown", retainedMicros: f.request.reservationMicros,
    providerOutcome: "unknown", usage: null, acceptedResult: false, retryAuthorized: false });
  expect(ledger(f)).toEqual([...JSON.parse("[" + f.prefix.toString().trim().split("\n").join(",") + "]"), ...receipt.actions.map(action => action.settlement)]);
  expect(ledger(f).filter(row => row.kind === "settled").reduce((total, row) => total + row.micros, 0)).toBe(4 * f.request.reservationMicros);
  const closed = tree(f.root);
  expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt); expect(closeUnknownApiWaveBatch(f.input)).toEqual(receipt);
  expect(tree(f.root)).toEqual(closed); expect(f.calls()).toBe(4);
  expect(verifyApiWaveRun(f.replayInput)).toMatchObject({ status: "stopped", completedJobs: 0, attemptedCalls: 4, providerCalls: 0, resumable: false });
  expect(readdirSync(f.ledgerPath + ".attempts").some(name => name.endsWith(".result.json"))).toBeFalse();
  expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
});

test("receipt-before-append and every partial settlement prefix replay exactly once", async () => {
  const f = await fixture(), receipt = closeUnknownApiWaveBatch(f.input), complete = readFileSync(f.ledgerPath), receiptRaw = readFileSync(f.receiptPath);
  const events = receipt.actions.map(action => Buffer.from(JSON.stringify(action.settlement) + "\n"));
  for (let applied = 0; applied < 4; applied++) {
    writeFileSync(f.ledgerPath, Buffer.concat([f.prefix, ...events.slice(0, applied)]), { mode: 0o600 });
    const before = tree(f.root);
    expect(() => verifyUnknownApiWaveBatch(f.input)).toThrow("incomplete"); expect(tree(f.root)).toEqual(before);
    expect(closeUnknownApiWaveBatch(f.input)).toEqual(receipt); expect(readFileSync(f.ledgerPath)).toEqual(complete);
    expect(readFileSync(f.receiptPath)).toEqual(receiptRaw); expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt);
    expect(closeUnknownApiWaveBatch(f.input)).toEqual(receipt); expect(ledger(f)).toHaveLength(8); expect(f.calls()).toBe(4);
  }
});

test("settled successful siblings remain in the reviewed inventory while only the unknown sibling is retained", async () => {
  const f = await fixture("one-unknown"), before = ledger(f);
  expect(f.evidence.members).toHaveLength(4); expect(before.filter(row => row.kind === "settled")).toHaveLength(3);
  const receipt = closeUnknownApiWaveBatch(f.input);
  expect(receipt.actions.map(action => action.action)).toEqual(["retain-unknown", "already-settled", "already-settled", "already-settled"]);
  expect(receipt.actions[0]).toMatchObject({ usage: null, retainedMicros: f.request.reservationMicros, acceptedResult: false });
  for (const action of receipt.actions.slice(1)) { expect(action.usage).not.toBeNull(); expect(action.settlement).toBeNull(); expect(action.acceptedResult).toBeFalse(); }
  expect(ledger(f)).toEqual([...before, receipt.actions[0]!.settlement!]); expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt);
  expect(verifyApiWaveRun(f.replayInput)).toMatchObject({ status: "stopped", completedJobs: 3 }); expect(f.calls()).toBe(4);
});

test("a captured result without settlement closes only accounting and cannot promote the stopped trial", async () => {
  const f = await fixture("captured-unsettled"), member = f.evidence.members[0]!;
  expect(member.resultCapture).not.toBeNull(); expect(member.settlementOffset).toBeNull(); expect(member.checkpoint).toBeNull();
  const receipt = closeUnknownApiWaveBatch(f.input);
  expect(receipt.actions[0]).toMatchObject({ action: "settle-captured", providerOutcome: "captured", acceptedResult: false, retryAuthorized: false });
  expect(receipt.actions[0]!.usage).not.toBeNull(); expect(receipt.actions[0]!.retainedMicros).toBe(member.capturedMicros!);
  expect(receipt.actions[0]!.retainedMicros).toBeLessThan(f.request.reservationMicros);
  expect(existsSync(join(f.run, "job-0.checkpoint.json"))).toBeFalse();
  expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt);
  expect(verifyApiWaveRun(f.replayInput)).toMatchObject({ status: "stopped", completedJobs: 3, resumable: false });
  expect(receipt.trialStatus).toBe("stopped"); expect(f.calls()).toBe(4);
});

test("partial wave reservation inventories every sibling and creates no phantom settlements", async () => {
  const f = await fixture("partial-reservation"); expect(f.calls()).toBe(0);
  expect(f.evidence.members).toHaveLength(4);
  const receipt = closeUnknownApiWaveBatch(f.input);
  expect(receipt.actions.map(action => action.action)).toEqual(["retain-unknown", "not-reserved", "not-reserved", "not-reserved"]);
  for (const action of receipt.actions.slice(1)) expect(action).toMatchObject({ retainedMicros: 0, settlement: null, usage: null, acceptedResult: false, retryAuthorized: false });
  expect(ledger(f)).toHaveLength(2); expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt); expect(f.calls()).toBe(0);
});

test("a self-consistent forged closure cutoff cannot relabel an owned reservation as not reserved", async () => {
  const f = await fixture("partial-reservation"), legitimate = closeUnknownApiWaveBatch(f.input);
  // Recreate the invented receipt-before-settlement state, then forge both the
  // authority and receipt consistently. A mere receipt-digest check is not enough.
  writeFileSync(f.ledgerPath, f.prefix);
  const cutoff = { bytes: 0, sha256: sha256Hex(Buffer.alloc(0)) };
  const members = f.authority.members.map(row => ({ ...row, reservationOffset: null, settlementOffset: null, capturedMicros: null }));
  const authority = save(join(f.root, "forged-cutoff-authority.json"), { ...f.authority, ledgerPrefix: cutoff, members });
  const forged = { ...legitimate, authority, ledgerPrefixBefore: cutoff, actions: legitimate.actions.map(action => ({ ...action,
    action: "not-reserved", retainedMicros: 0, settlementOffset: null, settlement: null, providerOutcome: "not-dispatched",
    providerTerminalVerified: false, usage: null })) };
  save(f.receiptPath, forged); const input = { config: f.config, authority }, before = tree(f.root);
  expect(ledger(f).map(row => row.kind)).toEqual(["reserved"]);
  expect(() => prepareApiWaveClosureEvidence(f.replayInput)).toThrow("closure prefix");
  expect(() => verifyApiWaveRun(f.replayInput)).toThrow("closure prefix");
  expect(() => closeUnknownApiWaveBatch(input)).toThrow("closure prefix");
  expect(() => verifyUnknownApiWaveBatch(input)).toThrow("closure prefix");
  expect(tree(f.root)).toEqual(before); expect(f.calls()).toBe(0); expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
  save(f.receiptPath, legitimate);
  expect(closeUnknownApiWaveBatch(f.input)).toEqual(legitimate); expect(verifyUnknownApiWaveBatch(f.input)).toEqual(legitimate);
  expect(ledger(f)).toHaveLength(2);
});

test("omitted, duplicate, reordered and misbound sibling authorities fail without writes", async () => {
  const f = await fixture("one-unknown");
  const changes = [
    { members: f.authority.members.slice(1) }, { members: [...f.authority.members.slice(0, 3), f.authority.members[0]!] },
    { members: [...f.authority.members].reverse() }, { plannedJobs: 3 }, { approved: false },
    { members: f.authority.members.map((row, i) => i === 0 ? { ...row, attemptId: randomUUID() } : row) },
    { ledgerPrefix: { ...f.authority.ledgerPrefix, bytes: 0 } }, { extra: true },
  ];
  for (const change of changes) {
    const authority = save(join(f.root, "bad-authority.json"), { ...f.authority, ...change }), input = { config: f.config, authority }, before = tree(f.root);
    expect(() => closeUnknownApiWaveBatch(input)).toThrow(); expect(() => verifyUnknownApiWaveBatch(input)).toThrow(); expect(tree(f.root)).toEqual(before);
    expect(existsSync(f.receiptPath)).toBeFalse(); expect(f.calls()).toBe(4);
  }
});

test("supervisor exit binds the whole owner, exact attempts and nonresumable terminal state", async () => {
  const f = await fixture();
  const changes = [{ ownerId: randomUUID() }, { ownerSha256: "f".repeat(64) }, { journalSha256: "e".repeat(64) },
    { attemptIds: f.exit.attemptIds.slice(1) }, { attemptIds: [...f.exit.attemptIds.slice(0, 3), f.exit.attemptIds[0]!] },
    { attemptIds: [...f.exit.attemptIds].reverse() }, { localInvocations: "running" }, { runResumable: true },
    { evidenceBasis: "independent-os-observation" }, { sessionId: 0 }, { exitCode: null },
    { observedExitedAt: "2026-10-01T06:01:00Z" }, { observedExitedAt: "2026-02-30T06:01:00.000Z" }, { extra: true }];
  for (const change of changes) {
    const writerExit = save(join(f.root, "bad-exit.json"), { ...f.exit, ...change });
    const authority = save(join(f.root, "bad-authority.json"), { ...f.authority, writerExit }), before = tree(f.root);
    expect(() => closeUnknownApiWaveBatch({ config: f.config, authority })).toThrow(); expect(tree(f.root)).toEqual(before);
    expect(existsSync(f.receiptPath)).toBeFalse(); expect(f.calls()).toBe(4);
  }
});

test("a supervisor exit cannot predate owner creation or the last send admission", async () => {
  const sendDelayMs = 2000, f = await fixture("all-unknown", { sendDelayMs });
  for (const offset of [-1, sendDelayMs - 1]) {
    const writerExit = save(join(f.root, "early-exit.json"), { ...f.exit, observedExitedAt: new Date(baseTime + offset).toISOString() });
    const authority = save(join(f.root, "early-authority.json"), { ...f.authority, writerExit }), input = { config: f.config, authority };
    const before = tree(f.root);
    expect(() => closeUnknownApiWaveBatch(input)).toThrow(); expect(() => verifyUnknownApiWaveBatch(input)).toThrow();
    expect(tree(f.root)).toEqual(before); expect(existsSync(f.receiptPath)).toBeFalse(); expect(f.calls()).toBe(4);
  }
  const writerExit = save(join(f.root, "boundary-exit.json"), { ...f.exit, observedExitedAt: new Date(baseTime + sendDelayMs).toISOString() });
  const authority = save(join(f.root, "boundary-authority.json"), { ...f.authority, writerExit }), input = { config: f.config, authority };
  const receipt = closeUnknownApiWaveBatch(input);
  expect(receipt.actions.every(action => action.action === "retain-unknown")).toBeTrue();
  expect(verifyUnknownApiWaveBatch(input)).toEqual(receipt); expect(f.calls()).toBe(4);
});

test("nested captures and missing-response expectations are rechecked after acquiring the recovery lock", async () => {
  for (const mode of ["captured-unsettled", "all-unknown"] as const) {
    const f = await fixture(mode), member = f.evidence.members[0]!;
    const target = mode === "captured-unsettled" ? member.resultCapture!.path
      : join(f.ledgerPath + ".attempts", `${member.attemptId}.response.json`);
    const original = existsSync(target) ? readFileSync(target) : null, ledgerBefore = readFileSync(f.ledgerPath);
    const realFsync = fs.fsyncSync; let injected = false;
    const sync = spyOn(fs, "fsyncSync").mockImplementation(fd => {
      realFsync(fd);
      const lockPath = f.ledgerPath + ".lock";
      if (injected || !existsSync(lockPath)) return;
      const held = fs.fstatSync(fd), lock = fs.lstatSync(lockPath);
      if (held.ino !== lock.ino || held.dev !== lock.dev) return;
      // Mutate only after the new closure owner's lock bytes are durable. This
      // leaves its earlier inspection valid and exercises the under-lock reread.
      injected = true;
      if (mode === "captured-unsettled") writeFileSync(target, "{}\n");
      else save(target, { httpStatus: 200, body: JSON.stringify({ invented: "late unvalidated response" }) });
    });
    try {
      expect(() => closeUnknownApiWaveBatch(f.input)).toThrow(); expect(injected).toBeTrue();
      expect(readFileSync(f.ledgerPath)).toEqual(ledgerBefore); expect(existsSync(f.receiptPath)).toBeFalse();
      expect(existsSync(f.ledgerPath + ".lock")).toBeFalse(); expect(existsSync(f.ledgerPath + ".recovery.lock")).toBeFalse();
      expect(f.calls()).toBe(4);
    } finally {
      sync.mockRestore();
      if (original === null) rmSync(target, { force: true }); else writeFileSync(target, original, { mode: 0o600 });
    }
    expect(prepareApiWaveClosureEvidence(f.replayInput)).toEqual(f.evidence);
  }
});

test("native and recovery locks, including dangling symlinks, block closure and verification without takeover", async () => {
  const f = await fixture(), missing = join(f.root, "absent-lock-target");
  for (const closed of [false, true]) {
    if (closed) closeUnknownApiWaveBatch(f.input);
    for (const suffix of [".lock", ".recovery.lock"]) for (const dangling of [false, true]) {
      const path = f.ledgerPath + suffix;
      if (dangling) symlinkSync(missing, path); else save(path, { pid: process.pid, inventedOwner: "another fixture owner" });
      const before = tree(f.root);
      try {
        expect(() => closeUnknownApiWaveBatch(f.input)).toThrow("absent native and recovery locks");
        expect(() => verifyUnknownApiWaveBatch(f.input)).toThrow("absent native and recovery locks");
        expect(() => prepareApiWaveClosureEvidence(f.replayInput)).toThrow("absent native and recovery locks");
        expect(tree(f.root)).toEqual(before);
        if (dangling) { expect(lstatSync(path).isSymbolicLink()).toBeTrue(); expect(readlinkSync(path)).toBe(missing); expect(existsSync(missing)).toBeFalse(); }
      } finally { rmSync(path); }
    }
  }
  expect(f.calls()).toBe(4);
});

test("complete accounting remains read-only and idempotent after later valid ledger growth", async () => {
  const f = await fixture(), receipt = closeUnknownApiWaveBatch(f.input), nextId = randomUUID();
  appendFileSync(f.ledgerPath, ["reserved", "settled"].map(kind => JSON.stringify({ v: 1, id: nextId, kind, micros: 1 }) + "\n").join(""));
  const before = tree(f.root);
  expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt); expect(closeUnknownApiWaveBatch(f.input)).toEqual(receipt);
  expect(tree(f.root)).toEqual(before); expect(ledger(f)).toHaveLength(10); expect(f.calls()).toBe(4);
  expect(verifyApiWaveRun(f.replayInput)).toMatchObject({ status: "stopped", plannedJobs: 4, completedJobs: 0 });
});

test("later outstanding reservations cannot be hidden behind a completed batch receipt", async () => {
  const f = await fixture(), receipt = closeUnknownApiWaveBatch(f.input), id = randomUUID();
  appendFileSync(f.ledgerPath, JSON.stringify({ v: 1, id, kind: "reserved", micros: 1 }) + "\n");
  const before = tree(f.root);
  expect(() => verifyUnknownApiWaveBatch(f.input)).toThrow("unreviewed outstanding");
  expect(() => closeUnknownApiWaveBatch(f.input)).toThrow("unreviewed outstanding"); expect(tree(f.root)).toEqual(before);
  appendFileSync(f.ledgerPath, JSON.stringify({ v: 1, id, kind: "settled", micros: 1 }) + "\n");
  expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt); expect(f.calls()).toBe(4);
});

test("changed authority, supervisor, receipt or late provider capture cannot rewrite settled accounting", async () => {
  const f = await fixture(), receipt = closeUnknownApiWaveBatch(f.input), settled = readFileSync(f.ledgerPath);
  for (const path of [f.input.authority.path, f.authority.writerExit.path, f.receiptPath]) {
    const prior = readFileSync(path);
    try {
      writeFileSync(path, "{}\n"); const changed = tree(f.root);
      expect(() => closeUnknownApiWaveBatch(f.input)).toThrow(); expect(() => verifyUnknownApiWaveBatch(f.input)).toThrow();
      expect(tree(f.root)).toEqual(changed); expect(readFileSync(f.ledgerPath)).toEqual(settled);
    } finally { writeFileSync(path, prior, { mode: 0o600 }); }
    expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt);
  }
  const attempt = f.evidence.members[0]!.attemptId, late = join(f.ledgerPath + ".attempts", `${attempt}.response.json`);
  save(late, { httpStatus: 200, body: JSON.stringify({ invented: "late and unaudited" }) }); const changed = tree(f.root);
  expect(() => closeUnknownApiWaveBatch(f.input)).toThrow(); expect(() => verifyUnknownApiWaveBatch(f.input)).toThrow();
  expect(tree(f.root)).toEqual(changed); expect(readFileSync(f.ledgerPath)).toEqual(settled); expect(f.calls()).toBe(4);
});

test("wrong amounts, wrong sibling order, torn writes and missing prior receipts fail closed during partial recovery", async () => {
  const f = await fixture(), receipt = closeUnknownApiWaveBatch(f.input), receiptRaw = readFileSync(f.receiptPath);
  const first = receipt.actions[0]!.settlement!, second = receipt.actions[1]!.settlement!;
  for (const suffix of ["{", JSON.stringify({ ...first, micros: first.micros - 1 }) + "\n", JSON.stringify(second) + "\n",
    JSON.stringify(first) + "\n" + JSON.stringify({ v: 1, id: randomUUID(), kind: "reserved", micros: 1 }) + "\n"]) {
    writeFileSync(f.ledgerPath, Buffer.concat([f.prefix, Buffer.from(suffix)])); const before = tree(f.root);
    expect(() => closeUnknownApiWaveBatch(f.input)).toThrow(); expect(() => verifyUnknownApiWaveBatch(f.input)).toThrow(); expect(tree(f.root)).toEqual(before);
  }
  writeFileSync(f.ledgerPath, Buffer.concat([f.prefix, Buffer.from(JSON.stringify(first) + "\n")])); rmSync(f.receiptPath);
  const before = tree(f.root); expect(() => closeUnknownApiWaveBatch(f.input)).toThrow(); expect(() => verifyUnknownApiWaveBatch(f.input)).toThrow();
  expect(tree(f.root)).toEqual(before); expect(f.calls()).toBe(4);
  writeFileSync(f.ledgerPath, f.prefix); writeFileSync(f.receiptPath, receiptRaw, { mode: 0o600 });
  expect(closeUnknownApiWaveBatch(f.input)).toEqual(receipt); expect(verifyUnknownApiWaveBatch(f.input)).toEqual(receipt);
});
