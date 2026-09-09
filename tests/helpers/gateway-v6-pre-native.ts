import { join } from "node:path";
import { sha256Hex } from "../../src/canonical";
import { gatewaySupervisorJson, type GatewayAuditPin } from "../../scripts/benchmark-audit/gateway-v6-audit-supervisor";
export function preNativePacket(runtimeRoot = "/synthetic/runtime", work = "/synthetic", freezeOverride?: Record<string, any>, options?: { studyDirectory?: string; auth?: { method: "project-oidc"; project: string; scope: string; environment: "development" } }) {
  const studyDirectory = options?.studyDirectory ?? join(work, "study"), folder = join(work, "gateway-study-v6-batch-001"), external = new Map<string, Uint8Array>(), study = new Map<string, Uint8Array>();
  const iso = (second: number) => new Date(Date.parse("2026-01-01T00:00:00Z") + second * 1000).toISOString();
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v));
  const put = (path: string, value: unknown, raw = false) => { const bytes = raw ? Buffer.from(value as string) : encode(value); external.set(path, bytes); return { path, sha256: sha256Hex(bytes) }; };
  const auth = options?.auth ?? { method: "project-oidc", project: "synthetic-project", scope: "synthetic-scope", environment: "development" } as const;
  const policy = "22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1";
  const freezeAuthority = { path: join(work, "gateway-v3-authority.json"), sha256: sha256Hex("synthetic-authority") };
  const freeze = freezeOverride ?? { createdAt: iso(0), sourceSha256: sha256Hex("source"), sourceGitHead: "a".repeat(40), policySha256: policy,
    importedStudy: { path: join(work, "manifest.json"), sha256: sha256Hex("manifest") }, authority: freezeAuthority, priorAmendmentExposureMicros: 18_268_639 };
  study.set("freeze.json", encode(freeze)); study.set("preparation.json", encode({ noModelCalls: true }));
  const freezePin = { path: join(studyDirectory, "freeze.json"), sha256: sha256Hex(study.get("freeze.json")!) };
  const argv = ["/synthetic/bin/vercel", "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", "development", "--",
    "/synthetic/bin/bun", join(runtimeRoot, "scripts/benchmarks/gateway-study-v6.ts"), "run", "--directory", studyDirectory,
    "--freeze-sha256", freezePin.sha256, "--max-new-calls", "32"];
  const configuration = { argv, cwd: runtimeRoot, jobDir: folder, requireAbsent: [join(studyDirectory, "active.lock")] };
  const configurationPin = put(join(folder, "config.json"), gatewaySupervisorJson(configuration), true);
  const retainedLaunchConfiguration = put(join(work, "gateway-study-v6-batch-001-launch-config.json"), gatewaySupervisorJson(configuration), true);
  const producer = { supervisorPid: 101, supervisorStart: "synthetic-start", bootIdentity: "synthetic-boot", childPid: 102, childPgid: 102, childStart: "synthetic-child" };
  const status = { state: "exited", ...producer, commandSha256: sha256Hex(gatewaySupervisorJson(argv)), configSha256: configurationPin.sha256,
    startedAt: iso(10).replace(".000Z", "Z"), finishedAt: iso(20).replace(".000Z", "Z"), exitCode: 1, groupGone: true };
  const supervisorStatus = put(join(folder, "status.json"), status);
  const log = put(join(folder, "log"), "Vercel CLI 58.4.0 (Node.js 24.20.0)\nError: You do not have access to the specified account\nLearn More: https://err.sh/vercel/scope-not-accessible\n", true);
  const extended = (p: GatewayAuditPin) => ({ ...p, bytes: external.get(p.path)!.length });
  const diagnosisValue = { schema: "oh.gateway-v6-pre-native-launch-failure.v1", recordedAt: "2026-01-01T00:00:25.000000+00:00",
    status: "vercel-scope-inaccessible-before-native-runner", supervisorStatus: extended(supervisorStatus), log: extended(log), configuration: extended(configurationPin),
    diagnostic: "Vercel CLI 58.4.0: You do not have access to the specified account; scope-not-accessible", nativeStudyFiles: ["freeze.json", "preparation.json"], nativeAdmissions: 0, v6JobRequests: 0, v6LedgerExists: false,
    modelCalls: 0, totalAmendmentExposureMicros: 18_268_639, automaticRetryPermitted: false,
    qualification: "Supervisor metadata and absence of all native run artifacts; fresh OS closure proof remains required before any recovery dispatch." };
  const diagnosis = put(join(work, "gateway-v6-pre-native-launch-failure.json"), diagnosisValue);
  const authorityBytes = "synthetic-authority", descriptorAuthority = put(join(work, "lab-paid-authority-v1.json"), authorityBytes, true);
  external.set(freeze.authority?.path ?? freezeAuthority.path, Buffer.from(authorityBytes));
  const oldLedgerMicros = [1_000_000, 2_000_000, 3_000_000, 19_744_095];
  const oldLedgers = oldLedgerMicros.map((micros, i) => extended(put(join(work, `old-ledger-${i}.jsonl`),
    `${JSON.stringify({ v: 1, id: `old_${i}`, kind: "reserved", micros })}\n`, true)));
  const imported = { schema: "oh.gateway-v6-import-preparation.v1", policySha256: policy, totalCarriedExposureMicros: 18_268_639, producerCount: 21,
    newJobs: 5064, attemptedReaderJobs: 332, manifest: freeze.importedStudy, oldLedgers: oldLedgers.slice(0, 3).map(({ bytes: _, ...pin }) => pin), ledger: oldLedgers[3] };
  const importPreparation = put(join(work, "gateway-v6-import-preparation.json"), imported);
  const budgetInput = put(join(work, "lab-gpt5-mini-reserved100-budget-input-v1.json"), { authority: descriptorAuthority,
    ledgers: oldLedgers.map(({ bytes, ...value }) => ({ ...value, bytes })), expectedExposureMicros: 25_744_095,
    absentLedgerPaths: [join(studyDirectory, "ledger.jsonl")] });
  const bound = { remainingReaders: 28, readerMicros: 170570, knownCompletedReaders: 331, knownTerminalReaders: 1, knownPhysicalJudgeRequests: 205,
    knownJudgeMicros: 2566092, unknownJudgeMaximumRequests: 28, unknownJudgeMaximumEachMicros: 323840, unknownJudgeMicros: 9067520,
    totalMicros: 11804182, totalSha256: "bb3bec2510cb6eb532e1812a66fde32e90afe9b342b09fe07f368fa631a71968" };
  const globalBudgetReservation = put(join(work, "gateway-v6-global-budget-reservation.json"), {
    protocol: "oh.gateway-v6-global-budget-reservation.v1", recordedAt: iso(5), freeze: freezePin, sourceSha256: freeze.sourceSha256,
    sourceGitHead: freeze.sourceGitHead, budgetInput, priorExposureMicros: 25744095, maximumNewExposureMicros: 11804182, capMicros: 40000000, bound });
  const inventory = { schema: "oh.gateway-final-inventory.v6", freezeSha256: freezePin.sha256,
    files: [...study].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256Hex(bytes) })) };
  const zeroNativeInventory = put(join(work, "gateway-v6-launch-001-zero-native-inventory.json"), inventory);
  const acceptance: Record<string, any> = { schema: "oh.gateway-v6-pre-native-failure-acceptance.v1", recordedAt: iso(30), launchNumber: 1,
    disposition: "scope-inaccessible-before-native-runner", freeze: freezePin, sourceSha256: freeze.sourceSha256, sourceGitHead: freeze.sourceGitHead,
    policySha256: policy, importPreparation, globalBudgetReservation, diagnosis, configuration: configurationPin, retainedLaunchConfiguration, supervisorStatus, log, zeroNativeInventory, producer,
    groupGone: true, freshOsProcessMatches: 0, processInventory: { argv: ["/bin/ps", "-axo", "pid=,ppid=,pgid=,command="], checkedAt: iso(29), sha256: sha256Hex("process snapshot"), rows: 2, matchedProducers: 0 },
    nativeAdmissions: 0, newTransportInvocations: 0, nativeLedgerExposureMicros: 0, priorAmendmentExposureMicros: 18_268_639, totalAmendmentExposureMicros: 18_268_639,
    oldLedgers, allOriginalLedgersUnchanged: true, correctnessInspected: false, responseTextInspected: false, modelCallsByVerifier: 0, auditorCallsByVerifier: 0, studyWrites: 0 };
  const acceptancePath = join(work, "gateway-v6-launch-001-pre-native-acceptance.json");
  const input = { acceptance: put(acceptancePath, acceptance), freezePin, freeze: freeze as any, runtimeRoot, studyDirectory, manifestAt: Date.parse(iso(100)), auth,
    readStudy: async (p: string, max: number) => { const raw = study.get(p); if (!raw || raw.length > max) throw Error("Missing synthetic study file"); return raw; } };
  const read = async (p: GatewayAuditPin, max: number) => { const raw = external.get(p.path); if (!raw || raw.length > max) throw Error("Missing synthetic failure pin"); return raw; };
  const reseal = () => { input.acceptance = put(acceptancePath, acceptance); };
  return { input, read, put, external, study, acceptance, status, inventory, diagnosisValue, configuration, reseal, iso,
    freezeAuthority: { path: freeze.authority?.path ?? freezeAuthority.path, sha256: freeze.authority?.sha256 ?? freezeAuthority.sha256 }, descriptorAuthority, oldLedgers, budgetInput, globalBudgetReservation };
}
