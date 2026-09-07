import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { claudeStudyImportInternals as u } from "../scripts/benchmarks/claude-study-import";
import { gatewayStudyImportV4Internals as importer, GATEWAY_STUDY_IMPORT_V4_QUALIFICATION, loadGatewayStudyImportV4, parseGatewayStudyImportV4Manifest } from "../scripts/benchmarks/gateway-study-import-v4";
import { makeClaudeExtractionJobs } from "../scripts/benchmarks/claude-study-plan";
import { makeGatewayExtractionJobs } from "../scripts/benchmarks/gateway-study-plan-v3";
import { gatewayJobPending, gatewayReservation } from "../scripts/benchmarks/gateway-study-store-v3";
import { gatewayStudyProcedure } from "../scripts/benchmarks/gateway-study-v3";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import type { Corpus } from "../scripts/benchmarks/datasets";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import { buildExtractionChunks } from "../scripts/benchmarks/units";
import { corpusIdentity } from "../scripts/benchmarks/extract";

const h = (s: string) => sha256Hex(`gateway-import-v4-synthetic:${s}`), iso = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v) + "\n");
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "gateway-import-v4-"))); await chmod(root, 0o700);
  const study = join(root, "study"), source = join(root, "source"), supervisor = join(root, "supervisor");
  for (const p of [study, source, supervisor, join(source, "src"), join(source, "scripts"), join(source, "scripts/benchmarks"), join(study, "jobs")]) await mkdir(p, { mode: 0o700 });
  const put = async (path: string, value: unknown) => { const raw = value instanceof Uint8Array ? value : bytes(value); await writeFile(path, raw, { mode: 0o600 }); return { path, sha256: sha256Hex(raw) }; };
  for (const name of ["package.json", "bun.lock", "tsconfig.json", "tsconfig.scripts.json", "scripts/benchmark-memory.ts", "src/synthetic.ts", "scripts/benchmarks/synthetic.ts"]) await put(join(source, name), Buffer.from("synthetic source\n"));
  const sourceIdentity = await u.sourceIdentity(source);
  const corpus: Corpus = { id: "synthetic-corpus", groupId: "synthetic-group", turns: Array.from({ length: 6 }, (_, i) => ({ id: `turn-${i}`, sessionId: `session-${i}`, speaker: "Casey", date: "2026-01-01", text: `Casey owns a bicycle numbered${i}.` })) };
  const chunks = buildExtractionChunks(corpus), legacy = { protocol: "oh.memory-claude-legacy.v1", provenance: { reportSha256: h("legacy") },
    parents: chunks.map((chunk, ordinal) => ({ ordinal, corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunkId: chunk.id, legacy: null })),
    requiredChunks: chunks.length, completedChunks: 0, missingChunks: chunks.length, totalUnits: 0, qualifications: [] } as unknown as ClaudeLegacyExtraction;
  const original = makeClaudeExtractionJobs([corpus], legacy), jobs = makeGatewayExtractionJobs(original, new Map());
  const imported = await put(join(root, "claude-import.json"), { synthetic: true });
  const oldLedger = await put(join(root, "old-ledger.jsonl"), Buffer.from("")), originalLedger = { ...oldLedger, bytes: 0, exposureMicros: 0 };
  const auth = { method: "project-oidc", project: "audit-fixture", scope: "fixture-owner", environment: "development" } as const;
  const authority = await put(join(root, "authority.json"), { schema: "oh.gateway-v3-authority.v1", ...auth });
  const profile = await loadJudgeProfile();
  const freeze = { protocol: "oh.memory-gateway-freeze.v3", createdAt: iso(0), sourceSha256: sourceIdentity.sha256, importedStudy: imported, authority, originalLedger,
    inputs: { selection: { path: join(root, "selection"), sha256: h("selection") }, legacy: { path: join(root, "legacy"), sha256: h("legacy") },
      exclusions: [{ path: join(root, "exclusion"), sha256: h("exclusion") }], originalSourceSha256: h("old-source") },
    procedure: gatewayStudyProcedure(profile.sha256, auth), study: { remainingFirstExtractionCalls: jobs.length, imported: { synthetic: true },
      newExtractionOrderSha256: canonicalSha256(jobs.map(j => ({ key: j.key, ordinal: j.ordinal, originalJobKey: j.original.key, requestSha256: j.request.requestSha256 }))) } };
  const freezePin = await put(join(study, "freeze.json"), freeze);
  await put(join(study, "preparation.json"), { source: { sourceSha256: sourceIdentity.sha256, files: sourceIdentity.entries, bun: "1.3.14", dirty: false },
    noModelCalls: true, imported: freeze.study.imported, originalLedger, maximumNewExposureMicros: 40_000_000 });
  await put(join(study, "store.json"), { protocol: "oh.memory-gateway-store.v3", freezeSha256: freezePin.sha256 });
  const events = [], contents = ['{"units":[]}', '{', '{"wrong":[]}', '{"units":[]}'];
  for (const [i, job] of jobs.slice(0, 4).entries()) {
    const dir = join(study, "jobs", job.key); await mkdir(dir, { mode: 0o700 }); await put(join(dir, "pending.json"), gatewayJobPending(job, freezePin.sha256));
    const reserved = { v: 1, id: job.key, kind: "reserved", micros: gatewayReservation(job).micros }; events.push(reserved); await put(join(dir, "reserved.json"), reserved);
    const rawBody = bytes({ model: job.request.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: contents[i], refusal: null } }],
      usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 }, providerMetadata: { gateway: { cost: "0.00002", routing: {
        originalModelId: job.request.model, canonicalSlug: job.request.model, resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1,
        modelAttempts: [{ canonicalSlug: job.request.model, success: true, providerAttemptCount: 1, providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } });
    await put(join(dir, "response.body"), rawBody); await put(join(dir, "response.json"), { requestSha256: job.request.requestSha256, httpStatus: 200, bodyComplete: true,
      receivedBytes: rawBody.length, transportError: null, body: { bytes: rawBody.length, sha256: sha256Hex(rawBody) } });
  }
  const ledgerRaw = Buffer.concat(events.map(bytes)), ledger = await put(join(study, "ledger.jsonl"), ledgerRaw), exposure = events.reduce((n, e) => n + e.micros, 0);
  const runId = "00000000-0000-4000-8000-000000000001", keys = jobs.slice(0, 4).map(j => j.key), maximum = 4;
  const qualified = { ...auth, issuer: `https://oidc.vercel.com/${auth.scope}`, subject: `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`,
    audience: `https://vercel.com/${auth.scope}`, expiresAt: Date.parse(iso(0)) / 1000 + 10000, signatureVerifiedLocally: false };
  const admissionValue = { protocol: "oh.memory-gateway-batch-admission.v3", runId, freezeSha256: freezePin.sha256, sourceSha256: sourceIdentity.sha256, importedStudySha256: imported.sha256,
    start: iso(10), maximumNewCalls: maximum, concurrency: 4, openingLedgerExposureMicros: 0, initialJobKeysSha256: canonicalSha256([]), qualified };
  const admission = await put(join(study, `batch-${runId}-started.json`), admissionValue);
  const batch = { protocol: "oh.memory-gateway-batch.v3", runId, freezeSha256: freezePin.sha256, sourceSha256: sourceIdentity.sha256, importedStudySha256: imported.sha256,
    start: iso(10), end: iso(20), admission, maximumNewCalls: maximum, concurrency: 4, newTransportInvocations: 4, admittedKeys: keys, initialJobKeys: [], finalJobKeys: [...keys].sort(),
    failed: true, storeClosed: true, sourceVerifiedAtClose: true, importVerifiedAtClose: true, originalLedgerVerifiedAtClose: true, interrupted: false, stopReason: null, qualified,
    ledger: { ...ledger, bytes: ledgerRaw.length, exposureMicros: exposure, budget: { capUsd: 40, maxCalls: maximum, reservedCalls: 4, historicalExposureUsd: 21.655385,
      priorAmendmentExposureUsd: 0, accountedUsd: exposure / 1e6, confirmedThisRunUsd: 0, unresolvedThisRunUsd: exposure / 1e6, billedUsd: null } }, comparisonArtifact: null,
    result: { status: "blocked", phase: "extract", reason: "Preserved first-response evidence requires review; no retry." } };
  const batchPin = await put(join(study, `batch-${runId}.json`), batch);
  const argv = ["/synthetic/bin/vercel", "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", "development", "--", "/synthetic/bin/bun",
    join(source, "scripts/benchmarks/gateway-study-v3.ts"), "run", "--directory", study, "--freeze-sha256", freezePin.sha256, "--max-new-calls", String(maximum)];
  const config = { argv, cwd: source, jobDir: supervisor, requireAbsent: [join(study, "active.lock")] }, configPin = await put(join(supervisor, "config.json"), Buffer.from(u.supervisorJson(config)));
  const status = { state: "exited", supervisorPid: 100, supervisorStart: "synthetic-parent", bootIdentity: "synthetic-boot", commandSha256: sha256Hex(u.supervisorJson(argv)), configSha256: configPin.sha256,
    startedAt: iso(9).replace(".000Z", "Z"), childPid: 101, childPgid: 101, childStart: "synthetic-child", exitCode: 1, groupGone: true, finishedAt: iso(21).replace(".000Z", "Z") };
  const statusPin = await put(join(supervisor, "status.json"), status), inventoryPath = join(root, "inventory.json"), closurePath = join(root, "closure.json"), manifestPath = join(root, "manifest.json");
  const closure = { schema: "oh.gateway-import-supervisor-closure.v4", freezeSha256: freezePin.sha256, inventorySha256: "", verification: "owner-verified-complete-producer-inventory", allProducersClosed: true,
    runs: [{ runId, admissionSha256: admission.sha256, closureSha256: batchPin.sha256, configuration: configPin, supervisorStatus: statusPin, groupGone: true, runnerExitCode: 1, newTransportInvocations: 4 }] };
  const manifest = { schema: "oh.gateway-study-import.v4", createdAt: iso(30), studyDirectory: study, sourceDirectory: source, freeze: freezePin,
    inventory: { path: inventoryPath, sha256: "" }, supervisorClosure: { path: closurePath, sha256: "" },
    jobs: jobs.slice(0, 4).map(j => ({ key: j.key, ordinal: j.ordinal, requestSha256: j.request.requestSha256 })), qualification: GATEWAY_STUDY_IMPORT_V4_QUALIFICATION };
  let manifestPin = { path: manifestPath, sha256: "" };
  async function seal() {
    closure.runs[0]!.closureSha256 = (await put(batchPin.path, batch)).sha256;
    closure.runs[0]!.admissionSha256 = (await put(admission.path, admissionValue)).sha256; batch.admission.sha256 = closure.runs[0]!.admissionSha256;
    closure.runs[0]!.closureSha256 = (await put(batchPin.path, batch)).sha256;
    const files = []; for (const path of await importer.closedFiles(study)) { const raw = await readFile(join(study, path)); files.push({ path, bytes: raw.length, sha256: sha256Hex(raw) }); }
    manifest.inventory = await put(inventoryPath, { schema: "oh.gateway-import-inventory.v4", freezeSha256: freezePin.sha256, files }); closure.inventorySha256 = manifest.inventory.sha256;
    manifest.supervisorClosure = await put(closurePath, closure); manifestPin = await put(manifestPath, manifest);
  }
  await seal(); const scope = { sourceSha256: sourceIdentity.sha256, jobCount: jobs.length, externalExposureMicros: exposure, verifyAuthority: async () => originalLedger };
  const input = () => ({ manifest: manifestPin, jobs, expectedClaudeImportSha256: imported.sha256, expectedOriginalLedger: originalLedger });
  return { root, study, source, jobs, manifest, batch, admissionValue, config, status, closure, events, put, seal, input, scope, ledgerRaw, exposure, cleanup: () => rm(root, { recursive: true, force: true }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function withFixture(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }

describe("closed Gateway v4 first-response import", () => {
  test("replays all four once, retains full reserves and original failure, without files or network changing", async () => withFixture(async f => {
    const paths = await importer.closedFiles(f.study), before = await Promise.all(paths.map(async p => { const file = join(f.study, p); return [p, sha256Hex(await readFile(file)), (await stat(file)).mtimeMs]; }));
    const oldFetch = globalThis.fetch; let network = 0; globalThis.fetch = Object.assign(async () => { network++; throw new Error("network forbidden"); }, oldFetch) as typeof fetch;
    try { const r = await importer.loadSynthetic(f.input(), f.scope);
      expect(r.rows).toHaveLength(4); expect(r.rows.map(row => row.ordinal)).toEqual(f.jobs.slice(0, 4).map(j => j.ordinal));
      expect(r.rows.map(row => row.status)).toEqual(["valid", "invalid-envelope", "invalid-envelope", "valid"]);
      expect(r.summary.externalExposureMicros).toBe(f.exposure); expect(r.summary.reportedUsage.micros).toBe(80); expect(r.summary.reportedUsage.micros).toBeLessThan(f.exposure);
      expect(r.summary.originalGatewayStatus).toBe("blocked"); expect(r.origins.every(o => o.originalNativeStatus === "blocked")).toBe(true);
      expect(r.rows.every(row => row.response.identity.resolvedProviderApiModelId === null && row.response.identity.resolvedSnapshot === null)).toBe(true);
      expect(Object.isFrozen(r.rows)).toBe(true); expect(Object.isFrozen(r.rows[0]!.payload)).toBe(true); expect(network).toBe(0);
      expect(await Promise.all(paths.map(async p => { const file = join(f.study, p); return [p, sha256Hex(await readFile(file)), (await stat(file)).mtimeMs]; }))).toEqual(before);
      expect(await readFile(join(f.study, "ledger.jsonl"))).toEqual(f.ledgerRaw);
    } finally { globalThis.fetch = oldFetch; }
  }));
  test("production loader cannot relax the frozen source or full plan through its public input", async () => withFixture(async f => {
    await expect(loadGatewayStudyImportV4(f.input())).rejects.toThrow("complete-plan-count");
    await expect(importer.loadSynthetic(f.input(), { ...f.scope, sourceSha256: h("wrong-source") })).rejects.toThrow("frozen-source-or-claude-import");
  }));
  test("rejects shifted/duplicated prefixes, sparse ordinal changes and incomplete complete-plan membership", async () => withFixture(async f => {
    const original = structuredClone(f.manifest.jobs);
    for (const jobs of [original.slice(1), [original[0]!, original[0]!, original[2]!, original[3]!], f.jobs.slice(1, 5).map(j => ({ key: j.key, ordinal: j.ordinal, requestSha256: j.request.requestSha256 }))]) {
      f.manifest.jobs = jobs; await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); }
    f.manifest.jobs = original; await f.seal();
    await expect(importer.loadSynthetic({ ...f.input(), jobs: f.jobs.slice(1) }, f.scope)).rejects.toThrow("complete-plan-count");
    const jobs = structuredClone(f.jobs); Object.assign(jobs[0]!, { ordinal: 999 }); await expect(importer.loadSynthetic({ ...f.input(), jobs }, f.scope)).rejects.toThrow();
  }));
  test("rejects open producer custody before authority or replay", async () => withFixture(async f => {
    f.status.groupGone = false; f.closure.runs[0]!.supervisorStatus = await f.put(f.closure.runs[0]!.supervisorStatus.path, f.status); await f.seal(); let checks = 0;
    await expect(importer.loadSynthetic(f.input(), { ...f.scope, verifyAuthority: async () => { checks++; return f.input().expectedOriginalLedger; } })).rejects.toThrow("supervisor-terminal-failure"); expect(checks).toBe(0);
  }));
  test("rejects successful relabeling, changed closure identity and missing native close checks", async () => {
    for (const field of ["failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "newTransportInvocations", "interrupted", "result"]) await withFixture(async f => {
      Object.assign(f.batch, { [field]: field === "failed" ? false : field === "newTransportInvocations" ? 3 : field === "interrupted" ? true : field === "result" ? { status: "completed" } : false });
      await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("rejects any settlement, smaller inherited exposure, incomplete ledger and changed raw bytes", async () => {
    for (const mutation of ["settlement", "reduced", "partial", "body"]) await withFixture(async f => {
      if (mutation === "body") await f.put(join(f.study, "jobs", f.jobs[0]!.key, "response.body"), Buffer.from("changed"));
      else { const raw = mutation === "settlement" ? Buffer.concat([f.ledgerRaw, bytes({ v: 1, id: f.jobs[0]!.key, kind: "settled", micros: 1 })])
        : mutation === "partial" ? f.ledgerRaw.subarray(0, -1) : Buffer.concat(f.events.map((e, i) => bytes({ ...e, micros: i === 0 ? e.micros - 1 : e.micros }))); await f.put(join(f.study, "ledger.jsonl"), raw); }
      await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("HTTP, truncation, cost and requested identity failures stay fatal", async () => {
    for (const mutation of ["http", "complete", "request", "cost", "length", "model"]) await withFixture(async f => {
      const dir = join(f.study, "jobs", f.jobs[0]!.key), meta = JSON.parse(await readFile(join(dir, "response.json"), "utf8"));
      if (["http", "complete", "request"].includes(mutation)) Object.assign(meta, mutation === "http" ? { httpStatus: 500 } : mutation === "complete" ? { bodyComplete: false } : { requestSha256: h("wrong") });
      else { const raw = JSON.parse(await readFile(join(dir, "response.body"), "utf8"));
        if (mutation === "cost") raw.providerMetadata.gateway.cost = "100"; else if (mutation === "length") raw.choices[0].finish_reason = "length"; else raw.model = "openai/gpt-4o";
        const body = bytes(raw); await f.put(join(dir, "response.body"), body); Object.assign(meta, { receivedBytes: body.length, body: { bytes: body.length, sha256: sha256Hex(body) } }); }
      await f.put(join(dir, "response.json"), meta); await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("rejects command scope, supervisor time, admission order and import-ledger substitutions", async () => {
    for (const mutation of ["command", "time", "order", "import", "ledger"]) await withFixture(async f => {
      if (mutation === "command") { f.config.argv[4] = "wrong-project"; f.closure.runs[0]!.configuration = await f.put(f.closure.runs[0]!.configuration.path, Buffer.from(u.supervisorJson(f.config))); }
      if (mutation === "time") { f.status.finishedAt = iso(1).replace(".000Z", "Z"); f.closure.runs[0]!.supervisorStatus = await f.put(f.closure.runs[0]!.supervisorStatus.path, f.status); }
      if (mutation === "order") f.batch.admittedKeys.reverse(); await f.seal();
      const input = f.input(); if (mutation === "import") input.expectedClaudeImportSha256 = h("other-import");
      if (mutation === "ledger") input.expectedOriginalLedger = { ...input.expectedOriginalLedger, sha256: h("other-ledger") };
      await expect(importer.loadSynthetic(input, f.scope)).rejects.toThrow();
    });
  });
  test("changed source, manifest or closure after sealing cannot be imported", async () => {
    for (const path of ["source/src/synthetic.ts", "manifest.json", "closure.json"]) await withFixture(async f => {
      await f.put(join(f.root, path), Buffer.from("changed")); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("source mutation during validation is rejected by final readback", async () => withFixture(async f => {
    let calls = 0; await expect(importer.loadSynthetic(f.input(), { ...f.scope, verifyAuthority: async () => { if (++calls === 1) await f.put(join(f.source, "src/synthetic.ts"), Buffer.from("changed during import")); return f.input().expectedOriginalLedger; } })).rejects.toThrow();
  }));
  test("forbids new result/settlement files, active locks, symlinks and missing captures", async () => {
    for (const mutation of ["result.json", "settled.json", "active.lock", "symlink", "missing"]) await withFixture(async f => {
      const dir = join(f.study, "jobs", f.jobs[0]!.key);
      if (mutation === "symlink") { await rm(join(dir, "response.body")); await symlink(join(f.root, "authority.json"), join(dir, "response.body")); }
      else if (mutation === "missing") await rm(join(dir, "response.json"));
      else await f.put(mutation === "active.lock" ? join(f.study, mutation) : join(dir, mutation), {});
      await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("manifest rejects unknown policy keys and false qualification", async () => withFixture(async f => {
    expect(() => parseGatewayStudyImportV4Manifest({ ...f.manifest, allowRetry: true })).toThrow();
    expect(() => parseGatewayStudyImportV4Manifest({ ...f.manifest, qualification: "Retry the failures" })).toThrow();
  }));
});
