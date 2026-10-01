import { afterEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../src/canonical";
import { ApiLabTransport, closeUnknownApiAttempt, prepareApiRequest, verifyUnknownApiAttempt, type UnknownApiFilePin } from "../scripts/benchmarks/memory-lab/api-transport";

const roots: string[] = [], previousKey = process.env.XAI_API_KEY;
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); if (previousKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = previousKey; });
const now = () => Date.parse("2026-10-01T06:00:00Z");
const messages = [{ role: "user" as const, content: "Invented offline accounting fixture." }];
function pin(path: string): UnknownApiFilePin { const raw = readFileSync(path); return { path, bytes: raw.length, sha256: sha256Hex(raw) }; }
function save(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value) + "\n", { mode: 0o600 }); return pin(path); }
async function fixture(protocol = "oh.memory-lab-api-budget.v2", extended = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oh-unknown-accounting-"))); roots.push(root);
  const cache = join(root, "cache"); mkdirSync(cache, { mode: 0o700 });
  const ledgerPath = join(cache, "ledger.jsonl"), budgetPath = join(root, "budget.json");
  const budget = save(budgetPath, { protocol, maxUsd: 5, maxCalls: 100, expiresAt: "2026-10-03T00:00:00Z", ledgerPath });
  const config = { budgetPath, reader: { id: "unused-reader", model: "gemini-3.8-flash" as const, keyEnv: "VERTEX_API_KEY" as const, maximumOutput: 8192 }, judge: { id: "invented-judge", model: "grok-4.7" as const, keyEnv: "XAI_API_KEY" as const, maximumOutput: 8192 } };
  let calls = 0; process.env.XAI_API_KEY = "invented-only";
  const fetcher = Object.assign(async () => { calls++; throw Error("invented timeout with no response"); }, { preconnect() { throw Error("fixture cannot connect"); } }) as typeof fetch;
  const transport = await ApiLabTransport.open({ config, maxCalls: 1, now, fetcher, ...(extended ? { requestTimeoutMs: 600000 as const } : {}) });
  try { await expect(transport.invoke(config.judge.id, messages)).rejects.toThrow("invented timeout"); } finally { transport.close(); }
  const prefix = readFileSync(ledgerPath), reserved = JSON.parse(prefix.toString().trim()), base = join(ledgerPath + ".attempts", reserved.id), request = prepareApiRequest(config.judge, messages);
  const stopped = save(join(root, "stopped.json"), { status: "incomplete", noResume: true, fixture: true });
  const exit = { protocol: "oh.memory-lab-api-writer-exit.v1", evidenceBasis: "reviewed-supervisor-attestation", supervisor: "codex.exec", sessionId: 1, completionId: "invented-exit", exitCode: 0, osPid: null, argv: ["invented-offline-runner"], observedExitedAt: "2026-10-01T06:01:00Z", attemptId: reserved.id, requestSha256: request.requestSha256, outcome: "exited", runResumable: false, stoppedEvidence: [stopped] };
  const writerExit = save(join(root, "writer-exit.json"), exit);
  const authority = { protocol: "oh.memory-lab-api-unknown-closure-authority.v1", approved: true, reviewId: "invented-root-review", budget, attemptId: reserved.id, requestSha256: request.requestSha256, reservationMicros: reserved.micros, ledgerPrefix: { bytes: prefix.length, sha256: sha256Hex(prefix) }, requestCapture: pin(base + ".request.json"), requestPolicy: extended ? pin(base + ".request-policy.json") : null, writerExit };
  const authorityPin = save(join(root, "authority.json"), authority), input = { config, authority: authorityPin };
  return { root, ledgerPath, config, input, authority, exit, prefix, reserved, base, calls: () => calls, fetcher };
}

test("explicit unknown closure retains full exposure for both budgets; ordinary open never resolves it", async () => {
  for (const protocol of ["oh.memory-lab-api-budget.v1", "oh.memory-lab-api-budget.v2"]) {
    const f = await fixture(protocol), names = readdirSync(f.ledgerPath + ".attempts");
    await expect(ApiLabTransport.open({ config: f.config, maxCalls: 1, now, fetcher: f.fetcher })).rejects.toThrow("unresolved");
    expect(readFileSync(f.ledgerPath)).toEqual(f.prefix); expect(readdirSync(f.ledgerPath + ".attempts")).toEqual(names);
    delete process.env.XAI_API_KEY;
    const receipt = closeUnknownApiAttempt(f.input);
    expect(receipt).toMatchObject({ providerOutcome: "unknown", providerTerminalVerified: false, usage: null, invoiceVerified: false, acceptedResult: false, retryAuthorized: false, retainedMicros: f.reserved.micros, writerExitEvidenceBasis: "reviewed-supervisor-attestation" });
    const events = readFileSync(f.ledgerPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(events).toEqual([f.reserved, { v: 1, id: f.reserved.id, kind: "settled", micros: f.reserved.micros }]);
    expect(verifyUnknownApiAttempt(f.input)).toEqual(receipt); expect(f.calls()).toBe(1); expect(existsSync(f.base + ".result.json")).toBeFalse();
    const next = await ApiLabTransport.open({ config: f.config, maxCalls: 1, now, fetcher: f.fetcher });
    try { expect(next.summary).toMatchObject({ campaignCalls: 1, accountedUsd: f.reserved.micros / 1e6, callsThisRun: 0 }); } finally { next.close(); }
    expect(f.calls()).toBe(1);
  }
});

test("verification is read-only before and after closure and after later ledger appends", async () => {
  const f = await fixture(), before = readdirSync(f.ledgerPath + ".attempts");
  expect(() => verifyUnknownApiAttempt(f.input)).toThrow("incomplete"); expect(readFileSync(f.ledgerPath)).toEqual(f.prefix); expect(readdirSync(f.ledgerPath + ".attempts")).toEqual(before); expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
  const receipt = closeUnknownApiAttempt(f.input), raw = readFileSync(f.ledgerPath), receiptRaw = readFileSync(f.base + ".unknown-accounting-closure.json");
  expect(verifyUnknownApiAttempt(f.input)).toEqual(receipt); expect(readFileSync(f.ledgerPath)).toEqual(raw); expect(readFileSync(f.base + ".unknown-accounting-closure.json")).toEqual(receiptRaw);
  const id = randomUUID(); appendFileSync(f.ledgerPath, ["reserved", "settled"].map(kind => JSON.stringify({ v: 1, id, kind, micros: 1 }) + "\n").join(""));
  const grown = readFileSync(f.ledgerPath); expect(verifyUnknownApiAttempt(f.input)).toEqual(receipt); expect(closeUnknownApiAttempt(f.input)).toEqual(receipt); expect(readFileSync(f.ledgerPath)).toEqual(grown);
});

test("receipt-before-settlement crash recovery is exactly once and never accepts a result", async () => {
  const f = await fixture(), receipt = closeUnknownApiAttempt(f.input), settled = readFileSync(f.ledgerPath);
  writeFileSync(f.ledgerPath, f.prefix); // Invented crash after durable sidecar, before append.
  expect(() => verifyUnknownApiAttempt(f.input)).toThrow("incomplete");
  expect(closeUnknownApiAttempt(f.input)).toEqual(receipt); expect(readFileSync(f.ledgerPath)).toEqual(settled);
  expect(closeUnknownApiAttempt(f.input)).toEqual(receipt); expect(readFileSync(f.ledgerPath)).toEqual(settled); expect(f.calls()).toBe(1);
  expect(existsSync(f.base + ".response.json")).toBeFalse(); expect(existsSync(f.base + ".result.json")).toBeFalse();
});

test("live, stale and recovery ownership conflicts are preserved without takeover", async () => {
  const f = await fixture();
  for (const suffix of [".lock", ".recovery.lock"]) {
    const raw = JSON.stringify({ pid: process.pid, fixture: true }); writeFileSync(f.ledgerPath + suffix, raw, { mode: 0o600 });
    expect(() => closeUnknownApiAttempt(f.input)).toThrow(); expect(() => verifyUnknownApiAttempt(f.input)).toThrow();
    expect(readFileSync(f.ledgerPath + suffix, "utf8")).toBe(raw); expect(readFileSync(f.ledgerPath)).toEqual(f.prefix); rmSync(f.ledgerPath + suffix);
  }
});

test("changed authority, request, stop and supervisor claims cannot close a reservation", async () => {
  const f = await fixture();
  for (const change of [{ approved: false }, { reservationMicros: f.reserved.micros - 1 }, { requestSha256: "f".repeat(64) }, { ledgerPrefix: { bytes: f.prefix.length, sha256: "f".repeat(64) } }, { extra: true }]) {
    const authority = save(join(f.root, "bad-authority.json"), { ...f.authority, ...change });
    expect(() => closeUnknownApiAttempt({ config: f.config, authority })).toThrow(); expect(readFileSync(f.ledgerPath)).toEqual(f.prefix);
  }
  for (const change of [{ osPid: process.pid }, { outcome: "running" }, { runResumable: true }, { evidenceBasis: "independent-os-observation" }, { stoppedEvidence: [] }, { attemptId: randomUUID() }, { exitCode: null }]) {
    const writerExit = save(join(f.root, "bad-exit.json"), { ...f.exit, ...change }), authority = save(join(f.root, "bad-authority.json"), { ...f.authority, writerExit });
    expect(() => closeUnknownApiAttempt({ config: f.config, authority })).toThrow("supervisor exit"); expect(readFileSync(f.ledgerPath)).toEqual(f.prefix);
  }
  writeFileSync(f.exit.stoppedEvidence[0]!.path, "changed"); expect(() => closeUnknownApiAttempt(f.input)).toThrow("pin changed");
  expect(existsSync(f.base + ".unknown-accounting-closure.json")).toBeFalse(); expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
});

test("no-response requirement fails on any late response, result, rejection or competing capture", async () => {
  const f = await fixture();
  for (const suffix of [".response.json", ".result.json", ".rejection.json", ".terminal-rejection.json", ".request-policy.json", ".unexpected.json"]) {
    save(f.base + suffix, { fixture: true }); expect(() => closeUnknownApiAttempt(f.input)).toThrow("conflicts"); expect(readFileSync(f.ledgerPath)).toEqual(f.prefix); rmSync(f.base + suffix);
  }
  closeUnknownApiAttempt(f.input); save(f.base + ".response.json", { fixture: true });
  expect(() => verifyUnknownApiAttempt(f.input)).toThrow("conflicts"); expect(() => closeUnknownApiAttempt(f.input)).toThrow("conflicts");
});

test("partial ledger, unaudited settlement and different settlement amounts fail closed", async () => {
  const f = await fixture();
  for (const suffix of ["{", JSON.stringify({ v: 1, id: f.reserved.id, kind: "settled", micros: f.reserved.micros }) + "\n", JSON.stringify({ v: 1, id: f.reserved.id, kind: "settled", micros: 0 }) + "\n"]) {
    writeFileSync(f.ledgerPath, Buffer.concat([f.prefix, Buffer.from(suffix)])); const raw = readFileSync(f.ledgerPath);
    expect(() => closeUnknownApiAttempt(f.input)).toThrow(); expect(readFileSync(f.ledgerPath)).toEqual(raw); expect(existsSync(f.base + ".unknown-accounting-closure.json")).toBeFalse();
  }
});

test("changed receipt or hard-linked/symlinked evidence never causes a ledger rewrite", async () => {
  const f = await fixture(), alias = join(f.root, "authority-alias.json"); symlinkSync(f.input.authority.path, alias);
  expect(() => closeUnknownApiAttempt({ config: f.config, authority: { ...f.input.authority, path: alias } })).toThrow("physical");
  const linked = join(f.root, "request-copy.json"); linkSync(f.base + ".request.json", linked);
  expect(() => closeUnknownApiAttempt(f.input)).toThrow("private owned"); rmSync(linked);
  closeUnknownApiAttempt(f.input); const settled = readFileSync(f.ledgerPath); writeFileSync(f.base + ".unknown-accounting-closure.json", "{}");
  expect(() => closeUnknownApiAttempt(f.input)).toThrow("receipt changed"); expect(readFileSync(f.ledgerPath)).toEqual(settled);
});

test("opt-in timeout policy is pinned without changing unknown-outcome accounting", async () => {
  const f = await fixture("oh.memory-lab-api-budget.v2", true), receipt = closeUnknownApiAttempt(f.input);
  expect(receipt.requestPolicySha256).toBe(f.authority.requestPolicy!.sha256); expect(verifyUnknownApiAttempt(f.input)).toEqual(receipt); expect(f.calls()).toBe(1);
  writeFileSync(f.base + ".request-policy.json", "{}"); expect(() => verifyUnknownApiAttempt(f.input)).toThrow("pin changed");
});
