import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256Hex } from "../src/canonical";
import { type EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
import { makeEvolutionRequest, parseEvolutionResponse, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore, type EvolutionRaw } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest } from "../scripts/benchmarks/evolution-transport";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await realpath(await mkdtemp(join(tmpdir(), "oh-evolution-store-"))); roots.push(path); return path; }
const request = (suffix = "one") => makeEvolutionRequest("gpt4o-official-snapshot-judge", [
  { role: "user", content: `Judge correctness. Which color? ${suffix}` },
]);
function campaign(storeDirectory: string, overrides: Partial<EvolutionCampaign> = {}): EvolutionCampaign {
  return { protocol: "oh.memory.evolution-campaign.v1", campaignId: "test-campaign", storeDirectory, approval: "Fixture: no network or paid calls",
    additionalBudgetMicros: 1_000_000, maximumCalls: 100, historicalExposureMicros: 42,
    historicalLedgers: [{ path: "/private/tmp/unused-historical-ledger", sha256: "a".repeat(64), bytes: 0 }],
    authAuthority: { path: "/private/tmp/unused-auth-authority", sha256: "b".repeat(64) }, ...overrides };
}
function capture(r: EvolutionRequest): EvolutionRaw {
  const body = new TextEncoder().encode(JSON.stringify({ model: r.model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "yes" } }],
    usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 } }));
  return { httpStatus: 200, body, complete: true, receivedBytes: body.length, error: null };
}
function change(path: string, sql: string, parameters: readonly (string | number | Uint8Array)[] = []) {
  const db = new Database(join(path, "campaign.sqlite"));
  try { db.query(sql).run(...parameters); } finally { db.close(); }
}

describe("memory evolution exclusive replay ledger", () => {
  test("reserves before capture, settles once, and reopens with identical totals and raw bytes", async () => {
    const path = await directory(), c = campaign(path), r = request(), raw = capture(r);
    const store = await openEvolutionStore({ directory: path, campaign: c });
    expect(store.lookup(r).kind).toBe("miss");
    store.admit(r);
    expect(store.summary()).toMatchObject({ calls: 1, exposureMicros: r.reservationMicros, confirmedMicros: 0, unresolvedMicros: r.reservationMicros });
    expect(() => store.admit(r)).toThrow("occupied"); expect(() => store.readRaw(r)).toThrow("no captured");
    store.capture(r, raw);
    const firstCopy = store.readRaw(r); firstCopy[0] = 0;
    expect(sha256Hex(store.readRaw(r))).toBe(sha256Hex(raw.body));
    const result = store.finalize(r), expected = parseEvolutionResponse(raw.body, r);
    expect(result).toEqual(expected); expect(store.finalize(r)).toEqual(expected);
    expect(store.summary()).toMatchObject({ calls: 1, exposureMicros: expected.usage.micros,
      confirmedMicros: expected.usage.micros, unresolvedMicros: 0, combinedExposureMicros: 42 + expected.usage.micros });
    const prior = store.summary(); await store.close();
    const reopened = await openEvolutionStore({ directory: path, campaign: c });
    try { expect(reopened.summary()).toEqual(prior); expect(reopened.lookup(r)).toEqual({ kind: "hit", result: expected }); }
    finally { await reopened.close(); }
  });

  test("recovers a complete captured first response without another physical call", async () => {
    const path = await directory(), c = campaign(path), r = request(), raw = capture(r);
    const store = await openEvolutionStore({ directory: path, campaign: c });
    store.admit(r); store.capture(r, raw); await store.close();
    const reopened = await openEvolutionStore({ directory: path, campaign: c });
    let calls = 0;
    try {
      expect(reopened.summary().unresolvedMicros).toBe(r.reservationMicros);
      const result = await invokeEvolutionRequest({ request: r, store: reopened,
        credential: { kind: "benchmark-openai-key", token: "fixture" }, fetcher: async () => { calls++; throw new Error("not called"); } });
      expect(result).toMatchObject({ cached: true, recovered: true }); expect(calls).toBe(0);
      expect(reopened.summary().calls).toBe(1); expect(reopened.summary().unresolvedMicros).toBe(0);
    } finally { await reopened.close(); }
  });

  test("unknown dispatch and captured network/parser failures retain full reservations across reopen", async () => {
    const failures: EvolutionRaw[] = [
      { httpStatus: null, body: new Uint8Array(0), complete: false, receivedBytes: 0, error: "network" },
      { httpStatus: 200, body: new TextEncoder().encode("bad"), complete: true, receivedBytes: 3, error: null },
    ];
    for (const raw of [null, ...failures]) {
      const path = await directory(), r = request(), c = campaign(path), store = await openEvolutionStore({ directory: path, campaign: c });
      store.admit(r); if (raw !== null) store.capture(r, raw); await store.close();
      const reopened = await openEvolutionStore({ directory: path, campaign: c });
      try {
        expect(reopened.lookup(r).kind).toBe("occupied");
        expect(reopened.summary()).toMatchObject({ calls: 1, exposureMicros: r.reservationMicros, unresolvedMicros: r.reservationMicros });
        expect(() => reopened.finalize(r)).toThrow(); expect(() => reopened.admit(r)).toThrow("occupied");
        reopened.admit(request("another")); expect(reopened.summary().calls).toBe(2);
      } finally { await reopened.close(); }
    }
  });

  test("two concurrent exact requests dispatch at most once and different repeats remain explicit", async () => {
    const path = await directory(), r = request(), store = await openEvolutionStore({ directory: path, campaign: campaign(path) });
    let calls = 0, release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const args = { request: r, store, credential: { kind: "benchmark-openai-key" as const, token: "fixture" },
      fetcher: async () => { calls++; await ready; return new Response(capture(r).body, { status: 200 }); } };
    const first = invokeEvolutionRequest(args);
    await expect(invokeEvolutionRequest(args)).rejects.toThrow("unresolved"); release(); await first;
    expect(calls).toBe(1); expect(store.summary().calls).toBe(1);
    store.admit(r, 1); expect(store.key(r, 1)).not.toBe(store.key(r)); expect(store.summary().calls).toBe(2);
    await store.close();
  });

  test("rejects spend/call limits and a second owner before any admission", async () => {
    const path = await directory(), r = request(), c = campaign(path, { maximumCalls: 1, additionalBudgetMicros: r.reservationMicros });
    const store = await openEvolutionStore({ directory: path, campaign: c });
    try {
      await expect(openEvolutionStore({ directory: path, campaign: c })).rejects.toThrow();
      store.admit(r); expect(() => store.admit(request("two"))).toThrow("cap");
    } finally { await store.close(); }
    await expect(openEvolutionStore({ directory: path, campaign: campaign(path) })).rejects.toThrow("identity");
  });

  test("one campaign cannot initialize a second directory or use a symlink alias", async () => {
    const path = await directory(), alternate = join(await directory(), "not-created"), c = campaign(path), r = request();
    const store = await openEvolutionStore({ directory: path, campaign: c });
    try {
      store.admit(r);
      await expect(openEvolutionStore({ directory: alternate, campaign: c })).rejects.toThrow("campaign's canonical store directory");
      await expect(lstat(alternate)).rejects.toMatchObject({ code: "ENOENT" });
      expect(store.summary()).toMatchObject({ calls: 1, exposureMicros: r.reservationMicros });
    } finally { await store.close(); }
    // Changing the lexical authority to a symlink still cannot alias or duplicate an existing ledger.
    const alias = join(await directory(), "alias"); await symlink(path, alias);
    await expect(openEvolutionStore({ directory: alias, campaign: campaign(alias) })).rejects.toThrow("private store directory");
  });

  test("directory replacement stops admission and close preserves another owner's lock", async () => {
    const path = await directory(), moved = path + "-moved", store = await openEvolutionStore({ directory: path, campaign: campaign(path) });
    roots.push(moved);
    await rename(path, moved); await mkdir(path, { mode: 0o700 });
    await writeFile(join(path, "active.lock"), "another-owner", { mode: 0o600 });
    expect(() => store.admit(request())).toThrow("directory or lock identity changed");
    await store.close();
    expect(await readFile(join(path, "active.lock"), "utf8")).toBe("another-owner");
  });

  test("service latency survives capture and reopen while legacy timing stays unmeasured", async () => {
    const path = await directory(), c = campaign(path), r = request(), legacy = request("legacy"), store = await openEvolutionStore({ directory: path, campaign: c });
    expect(() => store.readServiceMs(r)).toThrow("no captured request timing");
    store.admit(r);
    for (const serviceMs of [-1, -0, NaN, Infinity, 86_400_001, "1" as unknown as number]) {
      expect(() => store.capture(r, { ...capture(r), serviceMs })).toThrow("metadata");
    }
    store.capture(r, { ...capture(r), serviceMs: 123.456 }); store.finalize(r);
    store.admit(legacy); store.capture(legacy, capture(legacy)); store.finalize(legacy);
    expect(store.readServiceMs(r)).toBe(123.456); expect(store.readServiceMs(legacy)).toBeNull(); await store.close();
    const reopened = await openEvolutionStore({ directory: path, campaign: c });
    try { expect(reopened.readServiceMs(r)).toBe(123.456); expect(reopened.readServiceMs(legacy)).toBeNull(); }
    finally { await reopened.close(); }
    change(path, "UPDATE jobs SET raw_meta=json_set(raw_meta,'$.serviceMs',-1)");
    await expect(openEvolutionStore({ directory: path, campaign: c })).rejects.toThrow("metadata");
  });

  test("replays noncurrent rows and refuses malformed charge, status, key and reservation", async () => {
    for (const sql of ["UPDATE jobs SET charge=-100", "UPDATE jobs SET charge=0", "UPDATE jobs SET charge=1.5",
      "UPDATE jobs SET reservation=reservation+1", "UPDATE jobs SET status='unknown'", "UPDATE jobs SET repeat=1",
      "UPDATE jobs SET key='wrong'", "UPDATE jobs SET raw=x'00'", "UPDATE jobs SET request='null'"]) {
      const path = await directory(), c = campaign(path), store = await openEvolutionStore({ directory: path, campaign: c });
      store.admit(request("old")); await store.close(); change(path, sql);
      // The corrupted row need not be looked up: a new owner cannot reach new-request admission.
      await expect(openEvolutionStore({ directory: path, campaign: c })).rejects.toThrow();
    }
  });

  test("refuses missing identity and noncurrent settled raw/result corruption on reopen", async () => {
    for (const sql of ["DELETE FROM metadata", "UPDATE jobs SET raw=x'00'", "UPDATE jobs SET raw_sha='wrong'",
      "UPDATE jobs SET result='{}'", "UPDATE jobs SET charge=charge-1", "UPDATE jobs SET raw_meta='{}'",
      "UPDATE jobs SET raw_meta=json_set(raw_meta,'$.complete','true')", "UPDATE jobs SET raw_meta=json_set(raw_meta,'$.extra',1)"]) {
      const path = await directory(), c = campaign(path), r = request("old"), store = await openEvolutionStore({ directory: path, campaign: c });
      store.admit(r); store.capture(r, capture(r)); store.finalize(r); await store.close(); change(path, sql);
      await expect(openEvolutionStore({ directory: path, campaign: c })).rejects.toThrow();
    }
  });

  test("detects external commits while open before summaries, raw reads or new paid reservations", async () => {
    const path = await directory(), r = request(), store = await openEvolutionStore({ directory: path, campaign: campaign(path) });
    try {
      store.admit(r); store.capture(r, capture(r)); store.finalize(r);
      change(path, "UPDATE jobs SET charge=0");
      expect(() => store.summary()).toThrow("external database mutation");
      expect(() => store.readRaw(r)).toThrow("external database mutation");
      expect(() => store.admit(request("new"))).toThrow("external database mutation");
      const inspect = new Database(join(path, "campaign.sqlite"));
      try { expect(inspect.query<{ count: number }, []>("SELECT count(*) AS count FROM jobs").get()!.count).toBe(1); }
      finally { inspect.close(); }
    } finally { await store.close(); }
  });

  test("validates capture metadata and rejects a lowered captured reservation on reopen", async () => {
    const path = await directory(), r = request(), c = campaign(path), store = await openEvolutionStore({ directory: path, campaign: c });
    store.admit(r);
    expect(() => store.capture(r, { ...capture(r), complete: "true" as unknown as boolean })).toThrow("metadata");
    expect(() => store.capture(r, { ...capture(r), receivedBytes: 0 })).toThrow("metadata");
    store.capture(r, capture(r)); await store.close();
    change(path, "UPDATE jobs SET charge=1");
    await expect(openEvolutionStore({ directory: path, campaign: c })).rejects.toThrow("complete reservation");
  });
});
