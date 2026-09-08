import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { claudeStudyImportInternals as u } from "../scripts/benchmarks/claude-study-import";
import { makeClaudeExtractionJobs } from "../scripts/benchmarks/claude-study-plan";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import type { Corpus, Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { buildExtractionChunks } from "../scripts/benchmarks/units";
import { makeGatewayExtractionJobs, makeGatewayReaderJobs, type GatewayJob } from "../scripts/benchmarks/gateway-study-plan-v3";
import { completeGatewayV5Extraction, type GatewayExtractionRowV5 } from "../scripts/benchmarks/gateway-study-plan-v5";
import { gatewayStudyStoreInternals, gatewayReservation } from "../scripts/benchmarks/gateway-study-store-v3";
import { parseGatewayStudyV5 } from "../scripts/benchmarks/gateway-study-transport-v5";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256 } from "../scripts/benchmarks/gateway-study-transport-v6";
import type { GatewayStudyLedgerEvent } from "../scripts/benchmarks/gateway-study-transport-v3";
import { gatewayStudyV5Procedure, gatewayV5LedgerExposure } from "../scripts/benchmarks/gateway-study-v5";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { gatewayStudyImportV6Internals as importer, loadGatewayStudyImportV6, GATEWAY_STUDY_IMPORT_V6_QUALIFICATION } from "../scripts/benchmarks/gateway-study-import-v6";
const h = (s: string) => sha256Hex(`v6-import-synthetic:${s}`), bytes = (v: unknown) => Buffer.from(JSON.stringify(v) + "\n"), carry = 809209;
const iso = (s: number) => new Date(Date.parse("2026-01-01T00:00:00.000Z") + s * 1000).toISOString();
const ownerIso = (s: number) => iso(s).replace(".000Z", ".000000+00:00");
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "oh-gateway-v6-import-"))), study = join(root, "study"), source = join(root, "source");
  for (const p of [study, source, join(source, "src"), join(source, "scripts"), join(source, "scripts/benchmarks"), join(study, "jobs"), ...[0, 1, 2].map(i => join(root, `supervisor${i}`))]) await mkdir(p, { mode: 0o700 });
  const put = async (path: string, value: unknown) => { const raw = value instanceof Uint8Array ? value : bytes(value); await writeFile(path, raw, { mode: 0o600 }); return { path, sha256: sha256Hex(raw) }; };
  for (const name of ["package.json", "bun.lock", "tsconfig.json", "tsconfig.scripts.json", "scripts/benchmark-memory.ts", "src/synthetic.ts", "scripts/benchmarks/synthetic.ts"]) await put(join(source, name), Buffer.from("synthetic source\n"));
  const sourceIdentity = await u.sourceIdentity(source);
  const corpora: Corpus[] = [0, 1].map(c => ({ id: `corpus-${c}`, groupId: `group-${c}`, turns: Array.from({ length: 5 }, (_, i) => ({ id: `turn-${c}-${i}`, sessionId: `session-${c}-${i}`, speaker: "Casey", date: "2026-01-01", text: `Casey owns bicycle${i}.` })) }));
  const parents = corpora.flatMap(corpus => buildExtractionChunks(corpus).map(chunk => ({ corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunkId: chunk.id, legacy: null }))).map((p, ordinal) => ({ ...p, ordinal }));
  const legacy = { protocol: "oh.memory-claude-legacy.v1", provenance: { reportSha256: h("legacy") }, parents, requiredChunks: parents.length, completedChunks: 0, missingChunks: parents.length, totalUnits: 0, qualifications: [] } as unknown as ClaudeLegacyExtraction;
  const extractionJobs = makeGatewayExtractionJobs(makeClaudeExtractionJobs(corpora, legacy), new Map()).slice(2);
  const questions: Question[] = corpora.map((corpus, i) => ({ id: `question-${i}`, corpusId: corpus.id, category: "single-session-user", question: `What does Casey own ${i}?`, questionDate: "2026-01-03",
    answer: "GOLD_SENTINEL", unanswerable: false, evidenceTurnIds: [`turn-${i}-2`], evidenceSessionIds: [`session-${i}-2`] }));
  for (const q of questions) Object.defineProperty(q, "answer", { get() { throw new Error("gold must never be read by import"); } });
  const makeReaders = (rows: readonly GatewayExtractionRowV5[]) => makeGatewayReaderJobs({ corpora, questions,
    memory: corpora.map(corpus => ({ corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunks: buildExtractionChunks(corpus).map(chunk => rows.find(r => r.corpusId === corpus.id && r.chunkId === chunk.id)?.payload ?? { id: chunk.id, units: [], rejected: 0 }) })) });
  function rawFor(job: GatewayJob, terminal = false, truncateExtraction = false) {
    const outputTokens = terminal ? 512 : truncateExtraction ? 16384 : 2;
    const body = bytes({ model: job.request.model, choices: [{ index: 0, finish_reason: terminal || truncateExtraction ? "length" : "stop",
      message: { role: "assistant", content: terminal ? "PARTIAL_READER_SENTINEL" : truncateExtraction ? "PARTIAL_EXTRACTION_SENTINEL" : job.phase === "extract" ? '{"units":[]}' : "synthetic reader result", refusal: null } }],
      usage: { prompt_tokens: 20, completion_tokens: outputTokens, total_tokens: 20 + outputTokens }, providerMetadata: { gateway: { cost: terminal ? "0.0009" : truncateExtraction ? "0.02" : "0.00002",
        routing: { originalModelId: job.request.model, canonicalSlug: job.request.model, resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1,
          modelAttempts: [{ canonicalSlug: job.request.model, success: true, providerAttemptCount: 1, providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } });
    return { requestSha256: job.request.requestSha256, httpStatus: 200, bodyComplete: true, receivedBytes: body.length, transportError: null, body } as const;
  }
  const extractionRows = extractionJobs.map((j, i) => completeGatewayV5Extraction(j, parseGatewayStudyV5(j.request, gatewayReservation(j), rawFor(j, false, i === 1))));
  const readerJobs = await makeReaders(extractionRows), attempted = [...extractionJobs, ...readerJobs.slice(0, 4)], terminal = readerJobs[0]!;
  const imported = await put(join(root, "claude-import.json"), { synthetic: true }), prior = await put(join(root, "prior-import.json"), { synthetic: true }), continuation = await put(join(root, "continuation-import.json"), { synthetic: true });
  const oldLedger = await put(join(root, "old-ledger.jsonl"), Buffer.from("")), originalLedger = { ...oldLedger, bytes: 0, exposureMicros: 0 };
  const auth = { method: "project-oidc", project: "fixture-project", scope: "fixture-owner", environment: "development" } as const;
  const authority = await put(join(root, "authority.json"), { schema: "oh.gateway-v3-authority.v1", ...auth }), profile = await loadJudgeProfile();
  const freeze = { protocol: "oh.memory-gateway-freeze.v5", createdAt: iso(0), sourceSha256: sourceIdentity.sha256, importedStudy: imported, priorGatewayStudy: prior, priorContinuationStudy: continuation, authority, originalLedger,
    inputs: { selection: { path: join(root, "selection"), sha256: h("selection") }, legacy: { path: join(root, "legacy"), sha256: h("legacy") }, exclusions: [{ path: join(root, "exclusion"), sha256: h("exclusion") }], originalSourceSha256: h("old-source") },
    procedure: gatewayStudyV5Procedure(profile.sha256, auth), study: { remainingFirstExtractionCalls: extractionJobs.length, imported: { importedTransportInvocations: 1 }, priorGateway: { manifestSha256: prior.sha256 }, priorContinuation: { manifestSha256: continuation.sha256 },
      newExtractionOrderSha256: canonicalSha256(extractionJobs.map(j => ({ key: j.key, ordinal: j.ordinal, originalJobKey: j.original.key, requestSha256: j.request.requestSha256 }))) } };
  const freezePin = await put(join(study, "freeze.json"), freeze);
  await put(join(study, "preparation.json"), { source: { sourceSha256: sourceIdentity.sha256, files: sourceIdentity.entries, bun: "1.3.14", dirty: false }, noModelCalls: true,
    imported: freeze.study.imported, priorGateway: freeze.study.priorGateway, priorContinuation: freeze.study.priorContinuation, originalLedger, maximumTotalAmendmentExposureMicros: 40000000 });
  await put(join(study, "store.json"), { protocol: "oh.memory-gateway-store.v5", freezeSha256: freezePin.sha256 });
  const nativeResults = new Map(), reservations: GatewayStudyLedgerEvent[] = [], settlements: GatewayStudyLedgerEvent[] = [];
  for (const [i, job] of attempted.entries()) {
    const dir = join(study, "jobs", job.key); await mkdir(dir, { mode: 0o700 }); await put(join(dir, "pending.json"), gatewayStudyStoreInternals.jobPending(job, freezePin.sha256, "oh.memory-gateway-store.v5"));
    const reservation = gatewayReservation(job), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros } as const;
    reservations.push(reserved); await put(join(dir, "reserved.json"), reserved); const raw = rawFor(job, job.key === terminal.key, i === 1);
    await put(join(dir, "response.body"), raw.body); await put(join(dir, "response.json"), { ...raw, body: { bytes: raw.body.length, sha256: sha256Hex(raw.body) } });
    if (job.key !== terminal.key) {
      const response = parseGatewayStudyV5(job.request, reservation, raw), settled = { v: 1, id: job.key, kind: "settled", micros: response.usage.micros } as const;
      nativeResults.set(job.key, response); settlements.push(settled); await put(join(dir, "settled.json"), settled);
      await put(join(dir, "result.json"), { protocol: "oh.memory-gateway-store.v5", freezeSha256: freezePin.sha256, jobKey: job.key, result: response });
    }
  }
  const events = [0, 1, 2].flatMap(i => [...reservations.slice(i * 4, i * 4 + 4), ...settlements.filter(e => reservations.slice(i * 4, i * 4 + 4).some(r => r.id === e.id)).reverse()]);
  const ledgerRaw = Buffer.concat(events.map(bytes)), ledgerPin = await put(join(study, "ledger.jsonl"), ledgerRaw), exposure = gatewayV5LedgerExposure(events, carry);
  const batches: Record<string, any>[] = [], admissions: Record<string, any>[] = [], configs: Record<string, any>[] = [], statuses: Record<string, any>[] = [], runs: Record<string, any>[] = [], acceptances: Record<string, any>[] = [];
  let previousExposure = 0;
  for (const i of [0, 1, 2]) {
    const runId = `00000000-0000-4000-8000-00000000000${i + 1}`, maximum = i === 2 ? 8 : 4, start = iso(10 + i * 20), end = iso(20 + i * 20), keyPrefix = attempted.slice(0, (i + 1) * 4).map(j => j.key);
    const qualified = { ...auth, issuer: `https://oidc.vercel.com/${auth.scope}`, subject: `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`, audience: `https://vercel.com/${auth.scope}`, expiresAt: Date.parse(iso(0)) / 1000 + 10000, signatureVerifiedLocally: false };
    const a = { protocol: "oh.memory-gateway-batch-admission.v5", runId, freezeSha256: freezePin.sha256, sourceSha256: sourceIdentity.sha256, importedStudySha256: imported.sha256,
      priorGatewayStudySha256: prior.sha256, priorContinuationStudySha256: continuation.sha256, priorGatewayExposureMicros: carry, start, maximumNewCalls: maximum, concurrency: 4,
      openingLedgerExposureMicros: previousExposure, initialJobKeysSha256: canonicalSha256(keyPrefix.slice(0, i * 4).sort()), qualified };
    admissions.push(a); const admission = await put(join(study, `batch-${runId}-started.json`), a), prefixEvents = events.slice(0, i === 2 ? 23 : (i + 1) * 8), prefix = Buffer.concat(prefixEvents.map(bytes)), current = gatewayV5LedgerExposure(prefixEvents, carry);
    const batch = { protocol: "oh.memory-gateway-batch.v5", runId, freezeSha256: freezePin.sha256, sourceSha256: sourceIdentity.sha256, importedStudySha256: imported.sha256, priorGatewayStudySha256: prior.sha256, priorContinuationStudySha256: continuation.sha256,
      start, end, admission, maximumNewCalls: maximum, concurrency: 4, newTransportInvocations: 4, admittedKeys: attempted.slice(i * 4, i * 4 + 4).map(j => j.key), initialJobKeys: keyPrefix.slice(0, i * 4).sort(), finalJobKeys: [...keyPrefix].sort(),
      failed: i === 2, storeClosed: true, sourceVerifiedAtClose: true, importVerifiedAtClose: true, originalLedgerVerifiedAtClose: true, priorGatewayVerifiedAtClose: true, priorContinuationVerifiedAtClose: true,
      interrupted: false, stopReason: i === 2 ? null : "call-limit", qualified, ledger: { path: ledgerPin.path, bytes: prefix.length, sha256: sha256Hex(prefix), exposureMicros: current, priorGatewayExposureMicros: carry, totalAmendmentExposureMicros: carry + current,
        budget: { capUsd: 40, maxCalls: maximum, reservedCalls: 4, historicalExposureUsd: 21.655385, priorAmendmentExposureUsd: (carry + previousExposure) / 1e6, accountedUsd: (carry + current) / 1e6,
          confirmedThisRunUsd: settlements.filter(e => reservations.slice(i * 4, i * 4 + 4).some(r => r.id === e.id)).reduce((n, e) => n + e.micros, 0) / 1e6,
          unresolvedThisRunUsd: i === 2 ? gatewayReservation(terminal).micros / 1e6 : 0, billedUsd: null } }, comparisonArtifact: null,
      result: i === 0 ? { status: "paused", phase: "extract", resolved: 4, required: 8, importedClaude: 1, importedGateway: 188 }
        : i === 1 ? { status: "paused", phase: "reader", resolved: 0, required: readerJobs.length } : { status: "blocked", phase: "reader", reason: "Preserved first-response evidence requires review; no retry." } };
    batches.push(batch); const batchPin = await put(join(study, `batch-${runId}.json`), batch), jobDir = join(root, `supervisor${i}`);
    const argv = ["/synthetic/bin/vercel", "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", "development", "--", "/synthetic/bin/bun", join(source, "scripts/benchmarks/gateway-study-v5.ts"), "run", "--directory", study, "--freeze-sha256", freezePin.sha256, "--max-new-calls", String(maximum)];
    const config = { argv, cwd: source, jobDir, requireAbsent: [join(study, "active.lock")] }, configPin = await put(join(jobDir, "config.json"), Buffer.from(u.supervisorJson(config))); configs.push(config);
    const status = { state: "exited", supervisorPid: 100 + i * 10, supervisorStart: "synthetic-parent", bootIdentity: "synthetic-boot", commandSha256: sha256Hex(u.supervisorJson(argv)), configSha256: configPin.sha256,
      startedAt: iso(9 + i * 20).replace(".000Z", "Z"), childPid: 101 + i * 10, childPgid: 101 + i * 10, childStart: "synthetic-child", exitCode: i === 2 ? 1 : 0, groupGone: true, finishedAt: iso(21 + i * 20).replace(".000Z", "Z") };
    statuses.push(status); const statusPin = await put(join(jobDir, "status.json"), status);
    runs.push({ runId, admissionSha256: admission.sha256, closureSha256: batchPin.sha256, configuration: configPin, supervisorStatus: statusPin, groupGone: true, runnerExitCode: i === 2 ? 1 : 0, newTransportInvocations: 4 });
    if (i < 2) acceptances.push({ schema: "oh.gateway-v5-batch-acceptance.v1", recordedAt: ownerIso(22 + i * 20), number: i + 1, runId, admission, closure: batchPin, configuration: configPin, supervisorStatus: statusPin,
      groupGone: true, freshOsProcessMatches: 0, newTransportInvocations: 4, totalNewJobCount: (i + 1) * 4, result: batch.result, ledgerExposureMicros: current, priorGatewayExposureMicros: carry,
      totalAmendmentExposureMicros: carry + current, inventory: { path: join(root, `gateway-v5-batch-${String(i + 1).padStart(3, "0")}-closed-inventory.json`), sha256: "" },
      allOriginalLedgersUnchanged: true, priorInventoryUnchanged: true, correctnessInspected: false, modelCallsByVerifier: 0 });
    previousExposure = current;
  }
  const manifest = { schema: "oh.gateway-study-import.v6", createdAt: iso(80), studyDirectory: study, sourceDirectory: source, freeze: freezePin,
    inventory: { path: join(root, "inventory.json"), sha256: "" }, supervisorClosure: { path: join(root, "closure.json"), sha256: "" }, jobs: attempted.map(j => ({ key: j.key, phase: j.phase, ordinal: j.ordinal, requestSha256: j.request.requestSha256 })),
    terminalReaderJobKey: terminal.key, policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, qualification: GATEWAY_STUDY_IMPORT_V6_QUALIFICATION };
  const closure = { schema: "oh.gateway-import-supervisor-closure.v6", freezeSha256: freezePin.sha256, inventorySha256: "", verification: "owner-verified-complete-producer-inventory", allProducersClosed: true, runs, acceptances: [] as Array<{ path: string; sha256: string }> };
  let manifestPin = { path: join(root, "manifest.json"), sha256: "" };
  async function seal() {
    for (const i of [0, 1, 2]) { const run = runs[i]!, id = String(run.runId), a = await put(join(study, `batch-${id}-started.json`), admissions[i]); run.admissionSha256 = a.sha256; batches[i]!.admission = a;
      const b = await put(join(study, `batch-${id}.json`), batches[i]); run.closureSha256 = b.sha256;
      if (i < 2) { acceptances[i]!.admission = a; acceptances[i]!.closure = b; } }
    const files = []; for (const p of await importer.closedFiles(study)) { const raw = await readFile(join(study, p)); files.push({ path: p, bytes: raw.length, sha256: sha256Hex(raw) }); }
    for (const i of [0, 1]) {
      const keys = new Set(attempted.slice(0, (i + 1) * 4).map(j => j.key)), names = new Set(runs.slice(0, i + 1).flatMap(r => [`batch-${r.runId}.json`, `batch-${r.runId}-started.json`]));
      const old = files.filter(f => f.path.startsWith("jobs/") ? keys.has(f.path.split("/")[1]!) : f.path.startsWith("batch-") ? names.has(f.path) : true)
        .map(f => f.path === "ledger.jsonl" ? { path: f.path, bytes: batches[i]!.ledger.bytes, sha256: batches[i]!.ledger.sha256 } : f);
      acceptances[i]!.inventory = await put(acceptances[i]!.inventory.path, { schema: "oh.gateway-final-inventory.v5", freezeSha256: freezePin.sha256, files: old });
      closure.acceptances[i] = await put(join(root, `gateway-v5-batch-${String(i + 1).padStart(3, "0")}-acceptance.json`), acceptances[i]);
    }
    manifest.inventory = await put(manifest.inventory.path, { schema: "oh.gateway-import-inventory.v6", freezeSha256: freezePin.sha256, files }); closure.inventorySha256 = manifest.inventory.sha256;
    manifest.supervisorClosure = await put(manifest.supervisorClosure.path, closure); manifestPin = await put(manifestPin.path, manifest);
  }
  await seal(); let ancestryCalls = 0;
  const scope = { sourceSha256: sourceIdentity.sha256, freezeSha256: freezePin.sha256, ledgerSha256: ledgerPin.sha256, ledgerBytes: ledgerRaw.length,
    priorGatewayImportSha256: prior.sha256, priorContinuationImportSha256: continuation.sha256, claudeImportSha256: imported.sha256,
    extractionCount: extractionJobs.length, readerCount: readerJobs.length, importedReaderCount: 4, batchCounts: [4, 4, 4], maximumCalls: [4, 4, 8], terminalReaderJobKey: terminal.key, terminalReaderOrdinal: terminal.ordinal,
    nativeLedgerExposureMicros: exposure, verifyAuthority: async () => originalLedger, loadAncestry: async () => { ancestryCalls++; return { extractionJobs, studyIdentity: freeze.study, inputs: freeze.inputs, readerJobs: makeReaders }; } };
  const input = () => ({ manifest: manifestPin, expectedPriorGatewayImportSha256: prior.sha256, expectedPriorContinuationImportSha256: continuation.sha256, expectedClaudeImportSha256: imported.sha256, expectedOriginalLedger: originalLedger });
  return { root, study, source, attempted, terminal, extractionJobs, extractionRows, readerJobs, nativeResults, manifest, batches, admissions, configs, statuses, runs, acceptances, closure, events, put, seal, input, scope, ledgerRaw, exposure,
    ancestryCalls: () => ancestryCalls, cleanup: () => rm(root, { recursive: true, force: true }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function withFixture(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function changeBody(f: Fixture, index: number, mutate: (raw: any) => void) {
  const dir = join(f.study, "jobs", f.attempted[index]!.key), value = JSON.parse(await readFile(join(dir, "response.body"), "utf8")); mutate(value);
  const body = bytes(value), meta = JSON.parse(await readFile(join(dir, "response.json"), "utf8")); await f.put(join(dir, "response.body"), body);
  await f.put(join(dir, "response.json"), { ...meta, receivedBytes: body.length, body: { bytes: body.length, sha256: sha256Hex(body) } }); await f.seal();
}
describe("Gateway v6 immutable import of the complete closed v5 extraction and reader prefix", () => {
  test("replays ordinary successes and v5 truncations exactly, retains3 final siblings, carries old ledger once and never reads gold", async () => withFixture(async f => {
    const paths = await importer.closedFiles(f.study), before = await Promise.all(paths.map(async p => [p, sha256Hex(await readFile(join(f.study, p))), (await stat(join(f.study, p))).mtimeMs]));
    const old = globalThis.fetch; let network = 0; globalThis.fetch = Object.assign(async () => { network++; throw new Error("network forbidden"); }, old) as typeof fetch;
    try {
      const r = await importer.loadSynthetic(f.input(), f.scope);
      expect(r.extractionRows).toEqual(f.extractionRows); expect(r.extractionRows[1]!.status).toBe("invalid-truncation");
      expect(r.readerJobs).toEqual(f.readerJobs); expect(r.readerResults).toHaveLength(4); expect(r.readerResults[0]!.response.kind).toBe("terminal-reader-failure");
      expect(JSON.stringify(r.readerResults[0])).not.toContain("PARTIAL_READER_SENTINEL"); expect(r.readerResults.slice(1).map(r => r.response)).toEqual(f.readerJobs.slice(1, 4).map(j => f.nativeResults.get(j.key)));
      expect(r.summary.externalExposureMicros).toBe(carry + f.exposure); expect(r.summary.nativeLedgerExposureMicros).toBe(f.exposure); expect(r.summary.ancestryExposureMicros).toBe(carry);
      expect(r.summary.importedTransportInvocations).toBe(12); expect(r.summary.importedExtractionCount).toBe(8); expect(r.summary.importedReaderCount).toBe(4); expect(r.summary.terminalReaderFailureCount).toBe(1);
      expect(r.origins.filter(o => o.originalSettledMicros === null).map(o => o.key)).toEqual([f.terminal.key]); expect(Object.isFrozen(r.readerResults[0]!.response)).toBe(true);
      expect(f.ancestryCalls()).toBe(2); expect(network).toBe(0); expect(await readFile(join(f.study, "ledger.jsonl"))).toEqual(f.ledgerRaw);
      expect(await Promise.all(paths.map(async p => [p, sha256Hex(await readFile(join(f.study, p))), (await stat(join(f.study, p))).mtimeMs]))).toEqual(before);
    } finally { globalThis.fetch = old; }
  }));
  test("public loader cannot accept synthetic identity or relaxed production counts", async () => withFixture(async f => {
    await expect(loadGatewayStudyImportV6(f.input())).rejects.toThrow();
    for (const patch of [{ sourceSha256: h("other") }, { freezeSha256: h("other") }, { ledgerSha256: h("other") }, { ledgerBytes: 0 }, { terminalReaderOrdinal: 3 }, { nativeLedgerExposureMicros: 0 }])
      await expect(importer.loadSynthetic(f.input(), { ...f.scope, ...patch })).rejects.toThrow();
  }));
  test("rejects policy substitution, shifted reader prefix, phase relabeling and duplicate key", async () => withFixture(async f => {
    const original = structuredClone(f.manifest);
    for (const kind of ["policy", "shift", "phase", "duplicate"]) {
      Object.assign(f.manifest, structuredClone(original));
      if (kind === "policy") f.manifest.policySha256 = h("different-policy");
      if (kind === "shift") f.manifest.jobs[11] = { ...f.manifest.jobs[11]!, key: f.readerJobs[4]!.key };
      if (kind === "phase") f.manifest.jobs[8]!.phase = "extract";
      if (kind === "duplicate") f.manifest.jobs[11] = f.manifest.jobs[10]!;
      await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    }
  }));
  test("requires closed owner evidence before ancestry or captured response replay", async () => withFixture(async f => {
    f.closure.allProducersClosed = false; await f.seal();
    await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); expect(f.ancestryCalls()).toBe(0);
  }));
  test("requires all ordinary owner acceptances and never a final success acceptance", async () => withFixture(async f => {
    f.closure.acceptances.push(f.closure.acceptances[1]!); await f.seal();
    await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); expect(f.ancestryCalls()).toBe(0);
  }));
  test("rejects accepted historical inventories that differ from the immutable current prefix", async () => withFixture(async f => {
    const a = f.acceptances[0]!, inv = JSON.parse(await readFile(a.inventory.path, "utf8")); inv.files.find((x: any) => x.path.endsWith("response.body")).sha256 = h("rewritten-history");
    a.inventory = await f.put(a.inventory.path, inv); f.closure.acceptances[0] = await f.put(f.closure.acceptances[0]!.path, a);
    f.manifest.supervisorClosure = await f.put(f.manifest.supervisorClosure.path, f.closure); const manifest = await f.put(f.input().manifest.path, f.manifest);
    await expect(importer.loadSynthetic({ ...f.input(), manifest }, f.scope)).rejects.toThrow(); expect(f.ancestryCalls()).toBe(0);
  }));
  test("rejects broken native close flags, ordering, phase frontier and inherited carry before replay", async () => withFixture(async f => {
    const b = structuredClone(f.batches[2]!);
    for (const patch of [{ storeClosed: false }, { priorContinuationVerifiedAtClose: false }, { failed: false }, { initialJobKeys: [] }, { admittedKeys: [...b.admittedKeys].reverse() }, { result: { ...b.result, phase: "extract" } }]) {
      f.batches[2] = { ...structuredClone(b), ...patch }; await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    }
    f.batches[2] = b; f.admissions[2]!.priorGatewayExposureMicros = 0; await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); expect(f.ancestryCalls()).toBe(0);
  }));
  test("rejects altered supervisor command, live group and overlapping producer lifetime", async () => withFixture(async f => {
    const original = structuredClone(f.statuses[2]!);
    for (const change of [{ groupGone: false }, { exitCode: 0 }, { startedAt: iso(20).replace(".000Z", "Z") }]) {
      const status = { ...original, ...change }; f.runs[2]!.supervisorStatus = await f.put(f.runs[2]!.supervisorStatus.path, status);
      await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    }
    f.runs[2]!.supervisorStatus = await f.put(f.runs[2]!.supervisorStatus.path, original);
    f.configs[2]!.argv[4] = "other-project"; f.runs[2]!.configuration = await f.put(f.runs[2]!.configuration.path, Buffer.from(u.supervisorJson(f.configs[2])));
    await f.seal(); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); expect(f.ancestryCalls()).toBe(0);
  }));
  test("rejects source, raw, pending, settlement and saved-result drift", async () => withFixture(async f => {
    for (const path of [join(f.source, "src/synthetic.ts"), ...["pending.json", "response.body", "settled.json", "result.json"].map(n => join(f.study, "jobs", f.attempted[2]!.key, n))]) {
      const raw = await readFile(path); await f.put(path, Buffer.from("changed\n"));
      await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); await f.put(path, raw);
    }
  }));
  test("rejects pinned but forged ordinary result and recomputed successful capture", async () => withFixture(async f => {
    await changeBody(f, 9, raw => raw.choices[0].message.content = "substituted ordinary result");
    await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
  }));
  test("only the exact fully authenticated512-reader length becomes terminal", async () => {
    for (const kind of ["stop", "511", "identity", "refusal", "tools"]) await withFixture(async f => {
      await changeBody(f, 8, raw => {
        if (kind === "stop") raw.choices[0].finish_reason = "stop";
        if (kind === "511") { raw.usage.completion_tokens = 511; raw.usage.total_tokens = 531; }
        if (kind === "identity") raw.model = "openai/gpt-4o";
        if (kind === "refusal") raw.choices[0].message.refusal = "refusal";
        if (kind === "tools") raw.choices[0].message.tool_calls = [{ id: "tool" }];
      }); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
    });
  });
  test("an additional unclassified length remains fatal and cannot silently zero another reader", async () => withFixture(async f => {
    await changeBody(f, 9, raw => { raw.choices[0].finish_reason = "length"; raw.usage.completion_tokens = 512; raw.usage.total_tokens = 532; });
    await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
  }));
  test("rejects invented failure settlement, missing successful sibling and unexpected files", async () => withFixture(async f => {
    const path = join(f.study, "jobs", f.terminal.key, "settled.json"); await f.put(path, { synthetic: true }); await f.seal();
    await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); await rm(path); await f.seal();
    const sibling = join(f.study, "jobs", f.readerJobs[3]!.key, "result.json"), raw = await readFile(sibling); await rm(sibling); await f.seal();
    await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); await f.put(sibling, raw); await f.put(join(f.study, "unexpected"), bytes({})); await f.seal();
    await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow();
  }));
  test("rejects symlinks and active locks without replay", async () => withFixture(async f => {
    const path = join(f.study, "active.lock"); await f.put(path, {}); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); await rm(path);
    await symlink(join(f.study, "freeze.json"), join(f.study, "alias")); await expect(importer.loadSynthetic(f.input(), f.scope)).rejects.toThrow(); expect(f.ancestryCalls()).toBe(0);
  }));
  test("rejects incompatible source/ancestry during final readback", async () => withFixture(async f => {
    let calls = 0;
    const loadAncestry = async () => { const a = await f.scope.loadAncestry(); calls++; return { ...a, studyIdentity: calls === 2 ? {} : a.studyIdentity }; };
    await expect(importer.loadSynthetic(f.input(), { ...f.scope, loadAncestry })).rejects.toThrow(); expect(calls).toBe(2);
  }));
  test("wave guard keeps every admitted sibling and cap checks every transient ledger prefix", () => {
    const ids = [0, 1, 2, 3].map(i => h(`wave${i}`)), reserved = ids.map(id => ({ v: 1, id, kind: "reserved", micros: 10 } as const)), settled = ids.slice(1).map(id => ({ v: 1, id, kind: "settled", micros: 1 } as const));
    importer.waves([...reserved, ...settled], ids[0]!);
    for (const events of [[...reserved, ...settled.slice(1)], [reserved[0]!, settled[0]!, ...reserved.slice(1)], reserved.slice(0, 3)]) expect(() => importer.waves(events, ids[0]!)).toThrow();
    const over = [{ ...reserved[0]!, micros: 40000000 - carry }, { ...reserved[1]!, micros: 1 }, { ...reserved[0]!, kind: "settled", micros: 0 }];
    expect(() => importer.ledger(Buffer.concat(over.map(bytes)))).toThrow();
  });
});
