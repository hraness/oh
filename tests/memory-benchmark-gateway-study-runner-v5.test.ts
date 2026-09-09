import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { GatewayStudyBudget, makeGatewayStudyRequest, type GatewayStudyLedgerEvent } from "../scripts/benchmarks/gateway-study-transport-v3";
import { writeGatewayStudyJson } from "../scripts/benchmarks/gateway-study-store-v3";
import type { GatewayExtractionJob } from "../scripts/benchmarks/gateway-study-plan-v3";
import type { GatewayExtractionRowV5 } from "../scripts/benchmarks/gateway-study-plan-v5";
import { gatewayStudyProcedure, qualifyGatewayOIDC } from "../scripts/benchmarks/gateway-study-v3";
import { checkGatewayV5PriorBatches, gatewayStudyV5Identity, gatewayStudyV5Procedure, gatewayV5LedgerExposure, gatewayV5RemainingExtractionJobs,
  parseGatewayStudyV5Freeze } from "../scripts/benchmarks/gateway-study-v5";

const carried = 809_209, cap = 40_000_000, h = (text: string) => sha256Hex(`gateway-v5-synthetic:${text}`);
const auth = { method: "project-oidc", project: "example-project", scope: "example-team", environment: "development" } as const;
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await realpath(await mkdtemp(join(tmpdir(), "oh-gateway-v5-synthetic-"))); temporary.push(path); return path; }
const reserved = (id: string, micros: number): GatewayStudyLedgerEvent => ({ v: 1, id, kind: "reserved", micros });
const settled = (id: string, micros: number): GatewayStudyLedgerEvent => ({ v: 1, id, kind: "settled", micros });

describe("Gateway v5 exact first-response partition", () => {
  function plan() {
    // This boundary receives already-authenticated native jobs; only identity fields affect partitioning.
    const jobs = Array.from({ length: 4916 }, (_, n) => ({ key: h(`job-${n}`), ordinal: n * 2,
      original: { key: h(`parent-${n}`) }, request: { requestSha256: h(`request-${n}`) } })) as unknown as GatewayExtractionJob[];
    const rows = jobs.slice(0, 184).map(job => ({ jobKey: job.key, originalJobKey: job.original.key,
      ordinal: job.ordinal, requestSha256: job.request.requestSha256 })) as GatewayExtractionRowV5[];
    return { jobs, rows };
  }
  test("removes exactly the 184 imported sparse-ordinal parents and preserves every remaining job in order", () => {
    const { jobs, rows } = plan(), before = canonicalSha256(jobs), remaining = gatewayV5RemainingExtractionJobs(jobs, rows);
    expect(remaining).toHaveLength(4732); expect(remaining[0]).toBe(jobs[184]!); expect(remaining.at(-1)).toBe(jobs.at(-1)!);
    expect(remaining.map(job => job.key)).toEqual(jobs.slice(184).map(job => job.key));
    expect(remaining.some(job => rows.some(row => row.originalJobKey === job.original.key))).toBe(false);
    expect(canonicalSha256(jobs)).toBe(before);
  });
  test("wrong count, duplicate identities or a substituted imported prefix never admit a repeated parent", () => {
    const { jobs, rows } = plan();
    for (const [all, prior] of [[jobs.slice(1), rows], [jobs, rows.slice(1)], [jobs, [...rows, rows[0]!]],
      [[jobs[0]!, jobs[0]!, ...jobs.slice(2)], rows],
      [jobs.map((job, n) => n === 8 ? { ...job, original: jobs[7]!.original } : job), rows],
      [jobs.map((job, n) => n === 8 ? { ...job, ordinal: jobs[7]!.ordinal } : job), rows]] as const) {
      expect(() => gatewayV5RemainingExtractionJobs(all, prior)).toThrow("fixed Gateway partition counts");
    }
    for (const change of [{ jobKey: h("other-job") }, { originalJobKey: h("other-parent") },
      { ordinal: 1 }, { requestSha256: h("other-request") }]) {
      expect(() => gatewayV5RemainingExtractionJobs(jobs, [{ ...rows[0]!, ...change }, ...rows.slice(1)])).toThrow("imported Gateway prefix binding");
    }
    expect(() => gatewayV5RemainingExtractionJobs(jobs, [...rows].reverse())).toThrow("imported Gateway prefix binding");
    expect(() => gatewayV5RemainingExtractionJobs([jobs[1]!, jobs[0]!, ...jobs.slice(2)], rows)).toThrow("imported Gateway prefix binding");
  });
  test("continuation identity binds the remaining order and imported summary separately from original counts", () => {
    const { jobs, rows } = plan(), remaining = gatewayV5RemainingExtractionJobs(jobs, rows);
    const context = { originalV4Identity: { selectedFamilies: 120, remainingFirstExtractionCalls: 4916,
      newExtractionOrderSha256: h("old-order") }, extractionJobs: remaining,
      priorContinuation: { summary: { externalExposureMicros: carried, originalGatewayStatus: "blocked", importedResponses: 4 } } } as unknown as Parameters<typeof gatewayStudyV5Identity>[0];
    const identity = gatewayStudyV5Identity(context);
    expect(identity.remainingFirstExtractionCalls).toBe(4732); expect(identity.priorContinuation).toEqual(context.priorContinuation.summary);
    expect(identity.newExtractionOrderSha256).not.toBe(h("old-order"));
    expect(gatewayStudyV5Identity({ ...context, extractionJobs: [...remaining].reverse() }).newExtractionOrderSha256).not.toBe(identity.newExtractionOrderSha256);
  });
});

describe("Gateway v5 cumulative inherited exposure", () => {
  test("returns new-ledger exposure separately while requiring the exact inherited reserve", () => {
    expect(gatewayV5LedgerExposure([], carried)).toBe(0);
    expect(gatewayV5LedgerExposure([reserved("a", 100), settled("a", 20), reserved("b", 70)], carried)).toBe(90);
    for (const prior of [0, 11_825, carried - 1, carried + 1, NaN, Infinity, -1]) {
      expect(() => gatewayV5LedgerExposure([], prior)).toThrow("carried Gateway exposure");
    }
  });
  test("the carried reserve counts at every historical prefix, even if later settlements reduce final spend", () => {
    const available = cap - carried;
    expect(gatewayV5LedgerExposure([reserved("a", available)], carried)).toBe(available);
    expect(() => gatewayV5LedgerExposure([reserved("a", available + 1), settled("a", 0)], carried)).toThrow("combined amendment ledger prefix");
    const sequential = [reserved("a", available), settled("a", 0), reserved("b", available), settled("b", 0)];
    expect(gatewayV5LedgerExposure(sequential, carried)).toBe(0);
    expect(() => gatewayV5LedgerExposure([sequential[0]!, sequential[2]!, sequential[1]!, sequential[3]!], carried)).toThrow();
    for (const invalid of [[settled("missing", 0)], [reserved("a", 100), settled("a", 101)],
      [reserved("a", 100), reserved("a", 100)], [{ ...reserved("a", 100), extra: "untrusted" }]]) {
      expect(() => gatewayV5LedgerExposure(invalid, carried)).toThrow();
    }
  });
  test("shared reservation admission includes prior captures and current unsettled jobs exactly once", () => {
    const request = makeGatewayStudyRequest({ phase: "reader", messages: [{ role: "system", content: "Synthetic system." }, { role: "user", content: "Synthetic question." }] });
    const reserveMicros = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }).reserve(request, "size").micros;
    const newLedger = [reserved("previous-new-job", cap - carried - reserveMicros)];
    const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 2,
      priorExposureMicros: carried + gatewayV5LedgerExposure(newLedger, carried) });
    expect(budget.reserve(request, "last-allowed").micros).toBe(reserveMicros);
    expect(budget.summary.accountedUsd).toBe(40);
    expect(() => budget.reserve(request, "not-allowed")).toThrow("budget exhausted");
    expect(budget.summary.reservedCalls).toBe(1);
    expect(gatewayV5LedgerExposure(newLedger, carried)).toBe(cap - carried - reserveMicros);
  });
});

describe("Gateway v5 freeze and approved procedure", () => {
  function freeze() {
    const pin = (label: string) => ({ path: `/tmp/synthetic-${label}.json`, sha256: h(label) });
    return { protocol: "oh.memory-gateway-freeze.v5" as const, createdAt: "2026-01-01T00:00:00.000Z", sourceSha256: h("source"),
      importedStudy: pin("claude-import"), priorGatewayStudy: pin("gateway-import"), priorContinuationStudy: pin("continuation-import"), authority: pin("authority"),
      originalLedger: { ...pin("old-ledger"), bytes: 925682, exposureMicros: 21655385 },
      inputs: { selection: pin("selection"), legacy: pin("legacy"), exclusions: [pin("exclusion")], originalSourceSha256: h("original-source") },
      procedure: gatewayStudyV5Procedure(h("judge"), auth), study: { remainingFirstExtractionCalls: 4732 } };
  }
  test("freezes the prior Gateway continuation import separately from Claude ancestry and rejects malformed pins", () => {
    const value = freeze(); expect(parseGatewayStudyV5Freeze(value)).toEqual(value);
    expect(value.priorGatewayStudy.sha256).not.toBe(value.importedStudy.sha256);
    for (const invalid of [{ ...value, protocol: "oh.memory-gateway-freeze.v4" }, { ...value, priorGatewayStudy: undefined },
      { ...value, priorGatewayStudy: { ...value.priorGatewayStudy, sha256: h("prior").toUpperCase() } },
      { ...value, priorGatewayStudy: { ...value.priorGatewayStudy, path: "relative.json" } },
      { ...value, priorGatewayStudy: { ...value.priorGatewayStudy, extra: true } }, { ...value, sourceSha256: "invalid" },
      { ...value, createdAt: "2026-01-01" }, { ...value, originalLedger: { ...value.originalLedger, exposureMicros: -0 } },
      { ...value, inputs: { ...value.inputs, exclusions: [] } }, { ...value, extra: true }]) {
      expect(() => parseGatewayStudyV5Freeze(invalid)).toThrow();
    }
  });
  test("amends parser provenance while retaining the approved models, auth and total budget", () => {
    const original = gatewayStudyProcedure(h("judge"), auth), mutable = { ...auth, project: String(auth.project) };
    const procedure = gatewayStudyV5Procedure(h("judge"), mutable);
    expect(procedure.profile).toBe("oh.memory-gateway-study.v5");
    expect(procedure.generation).toEqual(original.generation); expect(procedure.budget).toEqual(original.budget);
    expect(procedure.judging).toEqual(original.judging); expect(procedure.auth).toEqual(auth);
    expect(procedure.truncation.originalStudiesStatus).toBe("incomplete");
    mutable.project = "different-project"; expect(procedure.auth.project).toBe(auth.project);
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const token = [encode({ alg: "RS256" }), encode({ sub: "owner:example-team:project:example-project:environment:development",
      aud: "https://vercel.com/example-team", iss: "https://oidc.vercel.com/example-team", iat: 1000, exp: 5000 }), "synthetic"].join(".");
    expect(qualifyGatewayOIDC(token, procedure.auth, 1000).signatureVerifiedLocally).toBe(false);
    expect(() => qualifyGatewayOIDC(token, mutable, 1000)).toThrow();
  });
});

describe("Gateway v5 continuation admission provenance", () => {
  async function batch() {
    const path = await directory(), runId = randomUUID(), freeze = h("freeze"), source = h("source"), imported = h("imported"), prior = h("prior"), continuation = h("continuation");
    const start = "2026-01-01T00:00:00.000Z", admissionPath = join(path, `batch-${runId}-started.json`);
    const admission = { protocol: "oh.memory-gateway-batch-admission.v5", runId, freezeSha256: freeze, sourceSha256: source,
      importedStudySha256: imported, priorGatewayStudySha256: prior, priorContinuationStudySha256: continuation, priorGatewayExposureMicros: carried, start, maximumNewCalls: 4 };
    const pin = await writeGatewayStudyJson(admissionPath, admission);
    const closure = { protocol: "oh.memory-gateway-batch.v5", runId, freezeSha256: freeze, sourceSha256: source,
      importedStudySha256: imported, priorGatewayStudySha256: prior, priorContinuationStudySha256: continuation, start, maximumNewCalls: 4,
      failed: false, storeClosed: true, sourceVerifiedAtClose: true, importVerifiedAtClose: true,
      originalLedgerVerifiedAtClose: true, priorGatewayVerifiedAtClose: true, priorContinuationVerifiedAtClose: true, admission: pin };
    const closurePath = join(path, `batch-${runId}.json`);
    const check = () => checkGatewayV5PriorBatches(path, freeze, source, imported, prior, continuation);
    return { path, admissionPath, admission, closurePath, closure, check };
  }
  test("an unclosed continuation blocks resume and successful readback leaves its evidence unchanged", async () => {
    const b = await batch(); await expect(b.check()).rejects.toThrow("unclosed batch admission");
    await writeGatewayStudyJson(b.closurePath, b.closure);
    const before = await Promise.all([readFile(b.admissionPath), readFile(b.closurePath)]);
    await b.check(); expect(await Promise.all([readFile(b.admissionPath), readFile(b.closurePath)])).toEqual(before);
    await writeFile(b.admissionPath, JSON.stringify({ ...b.admission, priorGatewayExposureMicros: 11_825 }));
    await expect(b.check()).rejects.toThrow("pinned file changed");
  });
  test("resealed admissions cannot discard carried exposure or substitute the prior import", async () => {
    const b = await batch();
    for (const change of [{ priorContinuationStudySha256: h("wrong-continuation") }, { priorGatewayExposureMicros: 11_825 }, { priorGatewayExposureMicros: 0 },
      { priorGatewayExposureMicros: carried - 1 }, { priorGatewayStudySha256: h("other-prior") },
      { maximumNewCalls: 8 }, { runId: randomUUID() }, { protocol: "oh.memory-gateway-batch-admission.v3" }]) {
      const raw = JSON.stringify({ ...b.admission, ...change }); await writeFile(b.admissionPath, raw);
      await writeFile(b.closurePath, JSON.stringify({ ...b.closure, admission: { path: b.admissionPath, sha256: sha256Hex(raw) } }), { mode: 0o600 });
      await expect(b.check()).rejects.toThrow("prior admission binding");
    }
  });
  test("failed close checks, stale ancestry and a changed native version reject continuation", async () => {
    const b = await batch();
    for (const change of [{ priorContinuationVerifiedAtClose: false }, { failed: true }, { storeClosed: false }, { sourceVerifiedAtClose: false },
      { importVerifiedAtClose: false }, { originalLedgerVerifiedAtClose: false }, { priorGatewayVerifiedAtClose: false },
      { priorGatewayStudySha256: h("other-prior") }, { importedStudySha256: h("other-claude") }, { sourceSha256: h("other-source") },
      { protocol: "oh.memory-gateway-batch.v3" }]) {
      await writeFile(b.closurePath, JSON.stringify({ ...b.closure, ...change }), { mode: 0o600 });
      await expect(b.check()).rejects.toThrow("prior batch did not close successfully");
    }
  });
});
