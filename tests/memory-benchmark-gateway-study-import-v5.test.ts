import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { claudeStudyImportInternals as u } from "../scripts/benchmarks/claude-study-import";
import { makeClaudeExtractionJobs } from "../scripts/benchmarks/claude-study-plan";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { buildExtractionChunks } from "../scripts/benchmarks/units";
import { makeGatewayExtractionJobs, completeGatewayExtraction } from "../scripts/benchmarks/gateway-study-plan-v3";
import { gatewayJobPending, gatewayReservation } from "../scripts/benchmarks/gateway-study-store-v3";
import { parseGatewayStudyResponse, type GatewayStudyLedgerEvent } from "../scripts/benchmarks/gateway-study-transport-v3";
import { gatewayStudyV4Procedure, gatewayV4LedgerExposure } from "../scripts/benchmarks/gateway-study-v4";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { gatewayStudyImportV5Internals as importer, loadGatewayStudyImportV5, GATEWAY_STUDY_IMPORT_V5_QUALIFICATION } from "../scripts/benchmarks/gateway-study-import-v5";
const h = (s: string) => sha256Hex(`v5-import-synthetic:${s}`), bytes = (v: unknown) => Buffer.from(JSON.stringify(v) + "\n"), carry = 121802;
const iso = (s: number) => new Date(Date.parse("2026-01-01T00:00:00.000Z") + s * 1000).toISOString();
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "oh-gateway-v5-import-"))), study = join(root, "study"), source = join(root, "source");
  for (const p of [study, source, join(source, "src"), join(source, "scripts"), join(source, "scripts/benchmarks"), join(study, "jobs"), join(root, "supervisor0"), join(root, "supervisor1")]) await mkdir(p, { mode: 0o700 });
  const put = async (path: string, value: unknown) => { const raw = value instanceof Uint8Array ? value : bytes(value); await writeFile(path, raw, { mode: 0o600 }); return { path, sha256: sha256Hex(raw) }; };
  for (const name of ["package.json", "bun.lock", "tsconfig.json", "tsconfig.scripts.json", "scripts/benchmark-memory.ts", "src/synthetic.ts", "scripts/benchmarks/synthetic.ts"]) await put(join(source, name), Buffer.from("synthetic source\n"));
  const sourceIdentity = await u.sourceIdentity(source);
  const corpus: Corpus = { id: "corpus", groupId: "group", turns: Array.from({ length: 12 }, (_, i) => ({ id: `turn-${i}`, sessionId: `session-${i}`, speaker: "Casey", date: "2026-01-01", text: `Casey owns bicycle${i}.` })) };
  const chunks = buildExtractionChunks(corpus), legacy = { protocol: "oh.memory-claude-legacy.v1", provenance: { reportSha256: h("legacy") }, parents: chunks.map((chunk, ordinal) => ({ ordinal,
    corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunkId: chunk.id, legacy: null })), requiredChunks: chunks.length, completedChunks: 0, missingChunks: chunks.length, totalUnits: 0, qualifications: [] } as unknown as ClaudeLegacyExtraction;
  const jobs = makeGatewayExtractionJobs(makeClaudeExtractionJobs([corpus], legacy), new Map()).slice(2), attempted = jobs.slice(0, 8), truncated = attempted[4]!;
  const imported = await put(join(root, "claude-import.json"), { synthetic: true }), prior = await put(join(root, "prior-import.json"), { synthetic: true });
  const oldLedger = await put(join(root, "old-ledger.jsonl"), Buffer.from("")), originalLedger = { ...oldLedger, bytes: 0, exposureMicros: 0 };
  const auth = { method: "project-oidc", project: "fixture-project", scope: "fixture-owner", environment: "development" } as const;
  const authority = await put(join(root, "authority.json"), { schema: "oh.gateway-v3-authority.v1", ...auth }), profile = await loadJudgeProfile();
  const freeze = { protocol: "oh.memory-gateway-freeze.v4", createdAt: iso(0), sourceSha256: sourceIdentity.sha256, importedStudy: imported, priorGatewayStudy: prior, authority, originalLedger,
    inputs: { selection: { path: join(root, "selection"), sha256: h("selection") }, legacy: { path: join(root, "legacy"), sha256: h("legacy") }, exclusions: [{ path: join(root, "exclusion"), sha256: h("exclusion") }], originalSourceSha256: h("old-source") },
    procedure: gatewayStudyV4Procedure(profile.sha256, auth), study: { remainingFirstExtractionCalls: jobs.length, imported: { importedTransportInvocations: 1 }, priorGateway: { manifestSha256: prior.sha256, externalExposureMicros: carry },
      newExtractionOrderSha256: canonicalSha256(jobs.map(j => ({ key: j.key, ordinal: j.ordinal, originalJobKey: j.original.key, requestSha256: j.request.requestSha256 }))) } };
  const freezePin = await put(join(study, "freeze.json"), freeze);
  await put(join(study, "preparation.json"), { source: { sourceSha256: sourceIdentity.sha256, files: sourceIdentity.entries, bun: "1.3.14", dirty: false }, noModelCalls: true,
    imported: freeze.study.imported, priorGateway: freeze.study.priorGateway, originalLedger, maximumTotalAmendmentExposureMicros: 40000000 });
  await put(join(study, "store.json"), { protocol: "oh.memory-gateway-store.v3", freezeSha256: freezePin.sha256 });
  const nativeRows = [], reservations: GatewayStudyLedgerEvent[] = [], settlements: GatewayStudyLedgerEvent[] = [];
  for (const [i, job] of attempted.entries()) {
    const dir = join(study, "jobs", job.key); await mkdir(dir, { mode: 0o700 }); await put(join(dir, "pending.json"), gatewayJobPending(job, freezePin.sha256));
    const reservation = gatewayReservation(job), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros } as const;
    reservations.push(reserved); await put(join(dir, "reserved.json"), reserved);
    const outputTokens = i === 4 ? 16384 : 2, cost = i === 4 ? "0.02" : "0.00002";
    const body = bytes({ model: job.request.model, choices: [{ index: 0, finish_reason: i === 4 ? "length" : "stop", message: { role: "assistant", content: i === 4 ? "TRUNCATED_TEXT_MUST_NEVER_ENTER_MEMORY" : i === 1 ? "{" : '{"units":[]}', refusal: null } }],
      usage: { prompt_tokens: 20, completion_tokens: outputTokens, total_tokens: 20 + outputTokens }, providerMetadata: { gateway: { cost, routing: { originalModelId: job.request.model, canonicalSlug: job.request.model,
        resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1, modelAttempts: [{ canonicalSlug: job.request.model, success: true, providerAttemptCount: 1,
          providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } });
    const raw = { requestSha256: job.request.requestSha256, httpStatus: 200, bodyComplete: true, receivedBytes: body.length, transportError: null, body } as const;
    await put(join(dir, "response.body"), body); await put(join(dir, "response.json"), { ...raw, body: { bytes: body.length, sha256: sha256Hex(body) } });
    if (i !== 4) { const response = parseGatewayStudyResponse(job.request, reservation, raw), settled = { v: 1, id: job.key, kind: "settled", micros: response.usage.micros } as const;
      nativeRows.push(completeGatewayExtraction(job, response)); settlements.push(settled); await put(join(dir, "settled.json"), settled);
      await put(join(dir, "result.json"), { protocol: "oh.memory-gateway-store.v3", freezeSha256: freezePin.sha256, jobKey: job.key, result: response }); }
  }
  const events = [...reservations.slice(0, 4), ...settlements.slice(0, 4).reverse(), ...reservations.slice(4), ...settlements.slice(4).reverse()];
  const ledgerRaw = Buffer.concat(events.map(bytes)), ledgerPin = await put(join(study, "ledger.jsonl"), ledgerRaw), exposure = gatewayV4LedgerExposure(events, carry);
  const batches: Record<string, unknown>[] = [], admissions: Record<string, unknown>[] = [], configs: Record<string, unknown>[] = [], statuses: Record<string, unknown>[] = [], runs: Record<string, unknown>[] = [];
  let previousExposure = 0;
  for (const i of [0, 1]) {
    const runId = `00000000-0000-4000-8000-00000000000${i + 1}`, maximum = i === 0 ? 4 : 8, start = iso(10 + i * 20), end = iso(20 + i * 20), keyPrefix = attempted.slice(0, (i + 1) * 4).map(j => j.key);
    const qualified = { ...auth, issuer: `https://oidc.vercel.com/${auth.scope}`, subject: `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`, audience: `https://vercel.com/${auth.scope}`, expiresAt: Date.parse(iso(0)) / 1000 + 10000, signatureVerifiedLocally: false };
    const admissionValue = { protocol: "oh.memory-gateway-batch-admission.v4", runId, freezeSha256: freezePin.sha256, sourceSha256: sourceIdentity.sha256, importedStudySha256: imported.sha256,
      priorGatewayStudySha256: prior.sha256, priorGatewayExposureMicros: carry, start, maximumNewCalls: maximum, concurrency: 4, openingLedgerExposureMicros: previousExposure, initialJobKeysSha256: canonicalSha256(keyPrefix.slice(0, i * 4).sort()), qualified };
    admissions.push(admissionValue); const admission = await put(join(study, `batch-${runId}-started.json`), admissionValue), prefix = Buffer.concat(events.slice(0, i === 0 ? 8 : 15).map(bytes)), current = gatewayV4LedgerExposure(events.slice(0, i === 0 ? 8 : 15), carry);
    const batch = { protocol: "oh.memory-gateway-batch.v4", runId, freezeSha256: freezePin.sha256, sourceSha256: sourceIdentity.sha256, importedStudySha256: imported.sha256, priorGatewayStudySha256: prior.sha256,
      start, end, admission, maximumNewCalls: maximum, concurrency: 4, newTransportInvocations: 4, admittedKeys: attempted.slice(i * 4, i * 4 + 4).map(j => j.key), initialJobKeys: keyPrefix.slice(0, i * 4).sort(), finalJobKeys: [...keyPrefix].sort(),
      failed: i === 1, storeClosed: true, sourceVerifiedAtClose: true, importVerifiedAtClose: true, originalLedgerVerifiedAtClose: true, priorGatewayVerifiedAtClose: true, interrupted: false, stopReason: i === 0 ? "call-limit" : null, qualified,
      ledger: { path: ledgerPin.path, bytes: prefix.length, sha256: sha256Hex(prefix), exposureMicros: current, priorGatewayExposureMicros: carry, totalAmendmentExposureMicros: carry + current,
        budget: { capUsd: 40, maxCalls: maximum, reservedCalls: 4, historicalExposureUsd: 21.655385, priorAmendmentExposureUsd: (carry + previousExposure) / 1e6, accountedUsd: (carry + current) / 1e6,
          confirmedThisRunUsd: (i === 0 ? 80 : 60) / 1e6, unresolvedThisRunUsd: i === 0 ? 0 : gatewayReservation(truncated).micros / 1e6, billedUsd: null } }, comparisonArtifact: null,
      result: i === 0 ? { status: "paused", phase: "extract", resolved: 4, required: jobs.length, importedClaude: 1, importedGateway: 4 } : { status: "blocked", phase: "extract", reason: "Preserved first-response evidence requires review; no retry." } };
    batches.push(batch); const batchPin = await put(join(study, `batch-${runId}.json`), batch), jobDir = join(root, `supervisor${i}`);
    const argv = ["/synthetic/bin/vercel", "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", "development", "--", "/synthetic/bin/bun", join(source, "scripts/benchmarks/gateway-study-v4.ts"), "run", "--directory", study, "--freeze-sha256", freezePin.sha256, "--max-new-calls", String(maximum)];
    const config = { argv, cwd: source, jobDir, requireAbsent: [join(study, "active.lock")] }, configPin = await put(join(jobDir, "config.json"), Buffer.from(u.supervisorJson(config))); configs.push(config);
    const status = { state: "exited", supervisorPid: 100 + i * 10, supervisorStart: "synthetic-parent", bootIdentity: "synthetic-boot", commandSha256: sha256Hex(u.supervisorJson(argv)), configSha256: configPin.sha256,
      startedAt: iso(9 + i * 20).replace(".000Z", "Z"), childPid: 101 + i * 10, childPgid: 101 + i * 10, childStart: "synthetic-child", exitCode: i, groupGone: true, finishedAt: iso(21 + i * 20).replace(".000Z", "Z") };
    statuses.push(status); const statusPin = await put(join(jobDir, "status.json"), status);
    runs.push({ runId, admissionSha256: admission.sha256, closureSha256: batchPin.sha256, configuration: configPin, supervisorStatus: statusPin, groupGone: true, runnerExitCode: i, newTransportInvocations: 4 }); previousExposure = current;
  }
  const manifest = { schema: "oh.gateway-study-import.v5", createdAt: iso(60), studyDirectory: study, sourceDirectory: source, freeze: freezePin,
    inventory: { path: join(root, "inventory.json"), sha256: "" }, supervisorClosure: { path: join(root, "closure.json"), sha256: "" },
    jobs: attempted.map(j => ({ key: j.key, ordinal: j.ordinal, requestSha256: j.request.requestSha256 })), truncatedJobKey: truncated.key, qualification: GATEWAY_STUDY_IMPORT_V5_QUALIFICATION };
  const closure = { schema: "oh.gateway-import-supervisor-closure.v5", freezeSha256: freezePin.sha256, inventorySha256: "", verification: "owner-verified-complete-producer-inventory", allProducersClosed: true, runs };
  let manifestPin = { path: join(root, "manifest.json"), sha256: "" };
  async function seal() {
    for (const i of [0, 1]) { const run = runs[i]!, id = String(run.runId), a = await put(join(study, `batch-${id}-started.json`), admissions[i]); run.admissionSha256 = a.sha256; batches[i]!.admission = a;
      run.closureSha256 = (await put(join(study, `batch-${id}.json`), batches[i])).sha256; }
    const files = []; for (const p of await importer.closedFiles(study)) { const raw = await readFile(join(study, p)); files.push({ path: p, bytes: raw.length, sha256: sha256Hex(raw) }); }
    manifest.inventory = await put(manifest.inventory.path, { schema: "oh.gateway-import-inventory.v5", freezeSha256: freezePin.sha256, files }); closure.inventorySha256 = manifest.inventory.sha256;
    manifest.supervisorClosure = await put(manifest.supervisorClosure.path, closure); manifestPin = await put(manifestPin.path, manifest);
  }
  await seal(); let ancestryCalls = 0;
  const scope = { sourceSha256: sourceIdentity.sha256, freezeSha256: freezePin.sha256, ledgerSha256: ledgerPin.sha256, ledgerBytes: ledgerRaw.length, priorGatewayImportSha256: prior.sha256,
    jobCount: jobs.length, importCount: 8, batchCounts: [4, 4] as const, maximumCalls: [4, 8] as const, truncatedJobKey: truncated.key, truncatedOrdinal: truncated.ordinal, externalExposureMicros: exposure,
    verifyAuthority: async () => originalLedger, verifyAncestry: async (f: unknown, j: unknown) => { ancestryCalls++; u.same(f, freeze, "synthetic-ancestry-freeze"); u.same(j, jobs, "synthetic-ancestry-plan"); } };
  const input = () => ({ manifest: manifestPin, jobs, expectedPriorGatewayImportSha256: prior.sha256, expectedClaudeImportSha256: imported.sha256, expectedOriginalLedger: originalLedger });
  return { root, study, source, jobs, attempted, truncated, nativeRows, manifest, batches, admissions, configs, statuses, runs, closure, events, put, seal, input, scope, ledgerRaw, exposure,
    ancestryCalls: () => ancestryCalls, cleanup: () => rm(root, { recursive: true, force: true }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function withFixture(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function changeBody(f: Fixture, index: number, mutate: (raw: any) => void) {
  const dir = join(f.study, "jobs", f.attempted[index]!.key), value = JSON.parse(await readFile(join(dir, "response.body"), "utf8")); mutate(value);
  const body = bytes(value), meta = JSON.parse(await readFile(join(dir, "response.json"), "utf8")); await f.put(join(dir, "response.body"), body);
  await f.put(join(dir, "response.json"), { ...meta, receivedBytes: body.length, body: { bytes: body.length, sha256: sha256Hex(body) } }); await f.seal();
}
describe("closed Gateway v5 exact immutable prefix import", () => {
  test("retains all final-wave siblings, native rows and sparse ordinals; truncation is zero-memory with no network or writes", async () => withFixture(async f => {
    const paths = await importer.closedFiles(f.study), before = await Promise.all(paths.map(async p => [p, sha256Hex(await readFile(join(f.study, p))), (await stat(join(f.study, p))).mtimeMs]));
    const old = globalThis.fetch; let network = 0; globalThis.fetch = Object.assign(async () => { network++; throw new Error("network forbidden"); }, old) as typeof fetch;
    try { const result = await importer.loadSynthetic(f.input(), f.scope);
      expect(result.rows).toHaveLength(8); expect(result.rows.map(r => r.ordinal)).toEqual(f.attempted.map(j => j.ordinal));
      expect(result.rows.filter(r => r.status !== "invalid-truncation")).toEqual(f.nativeRows); expect(result.rows.slice(5)).toHaveLength(3);
      expect(result.rows[4]!.status).toBe("invalid-truncation"); expect(result.rows[4]!.payload.units).toEqual([]); expect(JSON.stringify(result.rows[4])).not.toContain("TRUNCATED_TEXT");
      expect(result.summary.invalidTruncationCount).toBe(1); expect(result.summary.invalidEnvelopeCount).toBe(1); expect(result.summary.externalExposureMicros).toBe(f.exposure);
      expect(result.summary.reportedUsage.micros).toBe(Math.ceil(20 * 0.4 + 16384 * 1.6) + 7 * 20); expect(result.summary.originalGatewayStatus).toBe("blocked");
      expect(result.origins.filter(o => o.originalSettledMicros === null).map(o => o.key)).toEqual([f.truncated.key]);
      expect(result.origins.slice(0, 4).every(o => o.runId === f.runs[0]!.runId)).toBe(true); expect(result.origins.slice(4).every(o => o.runId === f.runs[1]!.runId)).toBe(true);
      expect(Object.isFrozen(result.rows[4]!.payload)).toBe(true); expect(f.ancestryCalls()).toBe(2); expect(network).toBe(0);
      expect(await readFile(join(f.study, "ledger.jsonl"))).toEqual(f.ledgerRaw);
      expect(await Promise.all(paths.map(async p => [p, sha256Hex(await readFile(join(f.study, p))), (await stat(join(f.study, p))).mtimeMs]))).toEqual(before);
    } finally { globalThis.fetch = old; }
  }));
  test("public loader cannot relax closed production identities", async () => withFixture(async f => {
    await expect(loadGatewayStudyImportV5(f.input())).rejects.toThrow();
    for (const patch of [{ sourceSha256: h("other") }, { freezeSha256: h("other") }, { ledgerSha256: h("other") }, { ledgerBytes: 0 }, { priorGatewayImportSha256: h("other") }, { truncatedOrdinal: 100 }])
      await expect(importer.loadSynthetic(f.input(), { ...f.scope, ...patch })).rejects.toThrow();
  }));
  test("rejects shifted, duplicate, missing or reordered parents and altered requests", async () => withFixture(async f => {
    for (const jobs of [f.jobs.slice(1), [...f.jobs].reverse(), [f.jobs[0]!, ...f.jobs.slice(0, -1)]]) await expect(importer.loadSynthetic({ ...f.input(), jobs }, f.scope)).rejects.toThrow();
    const jobs = structuredClone(f.jobs); Object.assign(jobs[0]!.request.body.messages[1]!, { content: jobs[0]!.request.body.messages[1]!.content + "tampered" }); await expect(importer.loadSynthetic({ ...f.input(), jobs }, f.scope)).rejects.toThrow();
    f.manifest.jobs = f.jobs.slice(1, 9).map(j => ({ key: j.key, ordinal: j.ordinal, requestSha256: j.request.requestSha256 })); await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
  }));
  test("custody rejection happens before ancestry or authority replay", async () => withFixture(async f => {
    f.statuses[1]!.groupGone = false; const p = f.runs[1]!.supervisorStatus as { path: string; sha256: string }; f.runs[1]!.supervisorStatus = await f.put(p.path, f.statuses[1]); await f.seal(); let authority = 0;
    await expect(importer.loadSynthetic(f.input(), { ...f.scope, verifyAuthority: async () => { authority++; return f.input().expectedOriginalLedger; } })).rejects.toThrow("supervisor-terminal-failure"); expect(authority).toBe(0); expect(f.ancestryCalls()).toBe(0);
  }));
  test("requires both producers, exact statuses, source/import close flags and final-wave counts", async () => {
    for (const field of ["failed", "sourceVerifiedAtClose", "priorGatewayVerifiedAtClose", "storeClosed", "newTransportInvocations", "result", "priorGatewayStudySha256"]) await withFixture(async f => {
      f.batches[1]![field] = field === "newTransportInvocations" ? 3 : field === "result" ? { status: "completed" } : false; await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
    await withFixture(async f => { f.closure.runs.reverse(); await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); });
  });
  test("rejects reused producer proof, changed scope, overlap and mismatched opening exposure", async () => {
    for (const kind of ["proof", "scope", "overlap", "opening"]) await withFixture(async f => {
      if (kind === "proof") f.runs[1]!.configuration = f.runs[0]!.configuration;
      if (kind === "scope") { (f.configs[1]!.argv as string[])[4] = "different"; const p = f.runs[1]!.configuration as { path: string }; f.runs[1]!.configuration = await f.put(p.path, Buffer.from(u.supervisorJson(f.configs[1]))); }
      if (kind === "overlap") f.batches[1]!.start = iso(1);
      if (kind === "opening") f.admissions[1]!.openingLedgerExposureMicros = 0;
      await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("all previously completed raw, result and settled files must reproduce exactly", async () => {
    for (const file of ["response.body", "response.json", "result.json", "settled.json", "reserved.json", "pending.json"]) await withFixture(async f => {
      await f.put(join(f.study, "jobs", f.attempted[7]!.key, file), { changed: true }); await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("only the fixed truncated extraction is new zero-memory; other transport/model/usage failures remain fatal", async () => {
    for (const kind of ["stop", "below-cap", "model", "refusal", "cost", "second-length"]) await withFixture(async f => {
      await changeBody(f, kind === "second-length" ? 7 : 4, raw => {
        if (kind === "stop") raw.choices[0].finish_reason = "stop";
        if (kind === "below-cap") { raw.usage.completion_tokens = 16383; raw.usage.total_tokens--; }
        if (kind === "model") raw.model = "openai/gpt-4o";
        if (kind === "refusal") raw.choices[0].message.refusal = "refused";
        if (kind === "cost") raw.providerMetadata.gateway.cost = "100";
        if (kind === "second-length") { raw.choices[0].finish_reason = "length"; raw.usage.completion_tokens = 16384; raw.usage.total_tokens = 16404; }
      }); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
    for (const change of [{ httpStatus: 500 }, { bodyComplete: false }, { transportError: "failed" }, { requestSha256: h("other") }]) await withFixture(async f => {
      const p = join(f.study, "jobs", f.truncated.key, "response.json"), raw = JSON.parse(await readFile(p, "utf8")); await f.put(p, { ...raw, ...change }); await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("old ledger cannot be settled, shortened, discounted, reordered or given an unclosed suffix", async () => {
    for (const kind of ["settled", "partial", "discount", "reorder", "extra"]) await withFixture(async f => {
      const events = [...f.events]; if (kind === "settled") events.push({ v: 1, kind: "settled", id: f.truncated.key, micros: 20000 });
      if (kind === "discount") events[0] = { ...events[0]!, micros: 1 };
      if (kind === "reorder") [events[0], events[1]] = [events[1]!, events[0]!];
      if (kind === "extra") events.push({ v: 1, kind: "reserved", id: h("extra"), micros: 1 });
      const raw = kind === "partial" ? f.ledgerRaw.subarray(0, -1) : Buffer.concat(events.map(bytes)); await f.put(join(f.study, "ledger.jsonl"), raw); await f.seal();
      await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow("fixed-ledger-pin");
    });
  });
  test("authenticated ledger prefixes and full inherited budget carry are mandatory", async () => {
    for (const field of ["sha256", "bytes", "exposureMicros", "priorGatewayExposureMicros", "totalAmendmentExposureMicros", "budget"]) await withFixture(async f => {
      (f.batches[0]!.ledger as Record<string, unknown>)[field] = field === "sha256" ? h("other") : field === "budget" ? {} : 0; await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("complete ancestry and original ledger identities are mandatory before and after", async () => withFixture(async f => {
    await expect(importer.loadSynthetic({ ...f.input(), expectedPriorGatewayImportSha256: h("other") }, f.scope)).rejects.toThrow();
    await expect(importer.loadSynthetic({ ...f.input(), expectedOriginalLedger: { ...f.input().expectedOriginalLedger, exposureMicros: 1 } }, f.scope)).rejects.toThrow();
    let checks = 0; await expect(importer.loadSynthetic(f.input(), { ...f.scope, verifyAncestry: async () => { if (++checks === 2) throw new Error("changed ancestry"); } })).rejects.toThrow(); expect(checks).toBe(2);
  }));
  test("exact inventory rejects new truncation settlement, missing sibling files, active lock and symlinks", async () => {
    for (const kind of ["settlement", "missing", "lock", "symlink"]) await withFixture(async f => {
      if (kind === "settlement") await f.put(join(f.study, "jobs", f.truncated.key, "settled.json"), {});
      if (kind === "missing") await rm(join(f.study, "jobs", f.attempted[7]!.key, "result.json"));
      if (kind === "lock") await f.put(join(f.study, "active.lock"), {});
      if (kind === "symlink") { const p = join(f.study, "jobs", f.truncated.key, "response.body"); await rm(p); await symlink(join(f.root, "authority.json"), p); }
      await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("fixed wave shape prevents reservation after a settlement or a fifth open call", () => {
    const reserved = (i: number): GatewayStudyLedgerEvent => ({ v: 1, kind: "reserved", id: h(String(i)), micros: 1 });
    const settled = (i: number): GatewayStudyLedgerEvent => ({ v: 1, kind: "settled", id: h(String(i)), micros: 0 });
    expect(() => importer.waves([reserved(0), reserved(1), settled(0), reserved(2)], h("1"))).toThrow();
    expect(() => importer.waves([0, 1, 2, 3, 4].map(reserved), h("0"))).toThrow();
    expect(() => importer.waves([0, 1, 2, 3].map(reserved).concat([3, 2, 1].map(settled)), h("0"))).not.toThrow();
    const huge = [{ v: 1, kind: "reserved", id: "large", micros: 40_000_000 - carry + 1 }, { v: 1, kind: "settled", id: "large", micros: 0 }];
    expect(() => importer.ledger(Buffer.concat(huge.map(bytes)))).toThrow();
  });
  test("source mutation during validation and resealed false policy are rejected", async () => withFixture(async f => {
    await expect(importer.loadSynthetic(f.input(), { ...f.scope, verifyAuthority: async () => { await f.put(join(f.source, "src/synthetic.ts"), Buffer.from("changed")); return f.input().expectedOriginalLedger; } })).rejects.toThrow();
    f.manifest.qualification = "Retry the parent" as typeof f.manifest.qualification; await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow("manifest-policy");
  }));
});
