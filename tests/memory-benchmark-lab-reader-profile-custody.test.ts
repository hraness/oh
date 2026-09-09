import { tmpdir } from "node:os";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as files from "node:fs/promises";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { makeLabGpt5MiniReaderRequest, parseLabGpt5MiniReaderResponse, reserveLabGpt5MiniReader } from "../scripts/benchmarks/lab-reader-profile";
import { labReaderProfileLedgerExposure, openLabReaderProfileCustody } from "../scripts/benchmarks/lab-reader-profile-custody";
const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const request = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "Question?" }]);
function payload(reason: "stop" | "length" = "stop") { return { model: "gpt-5-mini", choices: [{ index: 0, finish_reason: reason, message: { role: "assistant", content: "Answer." } }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }, providerMetadata: { gateway: { routing: { finalProvider: "openai", originalModelId: "openai/gpt-5-mini", canonicalSlug: "openai/gpt-5-mini" } } } }; }
async function custody(prior = 0, maxCalls = 2, recheck: () => Promise<void> = async () => {}) { const root = await realpath(await mkdtemp(join(tmpdir(), "lab-reader-custody-"))); roots.push(root); const directory = join(root, "cache"); await mkdir(directory, { mode: 0o700 }); return openLabReaderProfileCustody({ directory, namespaceSha256: "a".repeat(64), ancestry: { priorExposureMicros: prior, fingerprint: "f".repeat(64), recheck }, maxUsd: 40, maxCalls, reserve: reserveLabGpt5MiniReader, parse: parseLabGpt5MiniReaderResponse }); }
function raw(reason: "stop" | "length" = "stop") { const body = new TextEncoder().encode(JSON.stringify(payload(reason))); return { requestSha256: request.requestSha256, httpStatus: 200, body, bodyComplete: true, receivedBytes: body.byteLength, transportError: null }; }
describe("lab reader profile custody", () => {
  test("initialization failure closes the ledger descriptor and preserves the failed lock and reserved evidence", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "lab-reader-init-failure-"))); roots.push(directory);
    const options = { directory, namespaceSha256: "a".repeat(64), ancestry: { priorExposureMicros: 0,
      fingerprint: "f".repeat(64), recheck: async () => {} }, maxUsd: 40, maxCalls: 1,
      reserve: reserveLabGpt5MiniReader, parse: parseLabGpt5MiniReaderResponse };
    const cache = await openLabReaderProfileCustody(options), reservation = await cache.admit(request);
    await cache.close();
    const ledgerPath = join(directory, "ledger.jsonl"), pendingPath = join(directory, "jobs", reservation.id, "pending.json");
    const ledgerBefore = await readFile(ledgerPath), pendingBefore = await readFile(pendingPath);
    let retainedLedger: FileHandle | undefined;
    const originalOpen = files.open;
    const trackedOpen = spyOn(files, "open").mockImplementation(async (...args: Parameters<typeof files.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === ledgerPath) retainedLedger = handle;
      return handle;
    });
    try {
      await expect(openLabReaderProfileCustody({ ...options, maxUsd: 0.000001 })).rejects.toThrow("ancestry cap exceeded");
      expect(retainedLedger).toBeDefined();
      expect(retainedLedger!.fd).toBe(-1);
      expect(await readFile(ledgerPath)).toEqual(ledgerBefore);
      expect(await readFile(pendingPath)).toEqual(pendingBefore);
      expect((await stat(join(directory, "active.lock"))).isFile()).toBe(true);
      await expect(openLabReaderProfileCustody(options)).rejects.toThrow("EEXIST");
    } finally {
      trackedOpen.mockRestore();
      // Keep the regression hygienic even when run against the unfixed implementation.
      await retainedLedger?.close().catch(() => {});
    }
  });
  test("keeps a raw-first terminal first response, settles v1 ledger, and replays it", async () => { const cache = await custody(100); const reservation = await cache.admit(request); await cache.capture(request, raw("length")); const result = await cache.finalize(request); expect(result).toMatchObject({ kind: "terminal", reason: "length" }); expect(cache.events).toEqual([{ v: 1, id: reservation.id, kind: "reserved", micros: reservation.micros }, { v: 1, id: reservation.id, kind: "settled", micros: result.usage.micros }]); expect(labReaderProfileLedgerExposure(cache.events)).toBe(result.usage.micros); expect(await cache.lookup(request)).toEqual({ kind: "hit", result }); await cache.close(); });
  test("atomically applies cap and immutable occupied rules", async () => { const other = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "Other?" }]); const cache = await custody(0, 1); const settled = await Promise.allSettled([cache.admit(request), cache.admit(other)]); expect(settled.filter(value => value.status === "fulfilled")).toHaveLength(1); expect(cache.newCalls).toBe(1); expect(cache.events).toHaveLength(1); await expect(cache.admit(request)).rejects.toThrow(); await cache.close(); });
  test("rejects re-reservation and rechecks ancestry before writing admission", async () => { const id = "a".repeat(64); expect(() => labReaderProfileLedgerExposure([{ v: 1, id, kind: "reserved", micros: 1 }, { v: 1, id, kind: "settled", micros: 1 }, { v: 1, id, kind: "reserved", micros: 1 }])).toThrow("duplicate"); let calls = 0; const cache = await custody(0, 1, async () => { calls += 1; if (calls > 1) throw new Error("ancestry changed"); }); await expect(cache.admit(request)).rejects.toThrow("ancestry changed"); expect(cache.events).toEqual([]); expect(await cache.lookup(request)).toEqual({ kind: "miss" }); await cache.close().catch(() => {}); });
  test("rejects ledger replacement after open before another admission", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "lab-reader-custody-"))); roots.push(root);
    const directory = join(root, "cache"); await mkdir(directory, { mode: 0o700 });
    const cache = await openLabReaderProfileCustody({ directory, namespaceSha256: "a".repeat(64), ancestry: { priorExposureMicros: 0, fingerprint: "f".repeat(64), recheck: async () => {} }, maxUsd: 40, maxCalls: 2, reserve: reserveLabGpt5MiniReader, parse: parseLabGpt5MiniReaderResponse });
    const other = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "Other?" }]);
    await cache.admit(request);
    await writeFile(join(directory, "ledger.jsonl"), "", { mode: 0o600 });
    await expect(cache.admit(other)).rejects.toThrow("ledger");
    await cache.close().catch(() => {});
  });
  test("does not execute an admission queued behind a fatal admission failure", async () => {
    const other = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "Other?" }]);
    let checks = 0;
    const cache = await custody(0, 2, async () => {
      checks += 1;
      if (checks === 2) throw new Error("simulated durable admission failure");
    });
    const results = await Promise.allSettled([cache.admit(request), cache.admit(other)]);
    expect(results.map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(cache.events).toEqual([]);
    await cache.close().catch(() => {});
  });
});
