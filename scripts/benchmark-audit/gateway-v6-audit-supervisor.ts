/** Pure validation of externally pinned producer evidence. No process discovery or ownership claims. */
import { basename, dirname, join, isAbsolute, resolve } from "node:path";
import { canonicalJson, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { parseGatewayV6GlobalBudgetReservation } from "./gateway-v6-global-budget";
export type GatewayAuditPin = Readonly<{ path: string; sha256: string }>;
type Input = Readonly<{ configuration: GatewayAuditPin; supervisorStatus: GatewayAuditPin; maximumNewCalls: number;
  startAt: number; endAt: number; studyDirectory: string; runtimeRoot: string; freezeSha256: string; manifestAt: number;
  auth: Readonly<{ method: "project-oidc"; project: string; scope: string; environment: "development" }> }>;
function need(v: unknown, why: string): asserts v { if (!v) throw new Error(`Gateway supervisor audit: ${why}.`); }
function record(v: unknown): Record<string, unknown> { need(isPlainRecord(v), "record"); return v; }
function exact(v: Record<string, unknown>, keys: readonly string[]) { need(hasExactKeys(v, keys), "keys"); }
function path(v: unknown): string { need(typeof v === "string" && v.length <= 4096 && isAbsolute(v) && resolve(v) === v && !v.includes("\0"), "absolute path"); return v; }
function pid(v: unknown): number { need(typeof v === "number" && Number.isSafeInteger(v) && v > 0, "pid"); return v; }
function time(v: unknown): number { need(typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v), "timestamp"); const n = Date.parse(v); need(Number.isFinite(n) && new Date(n).toISOString() === v.replace("Z", ".000Z"), "timestamp"); return n; }
export function gatewaySupervisorJson(v: unknown): string { return canonicalJson(v).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`); }
async function verifySupervisorEvidence(input: Input, read: (p: GatewayAuditPin, max: number) => Promise<Uint8Array>, expectedExit: 0 | 1) {
  const root = path(input.runtimeRoot), study = path(input.studyDirectory);
  const auth = input.auth; need(auth.method === "project-oidc" && auth.environment === "development"
    && /^[a-z0-9][a-z0-9-]{0,99}$/.test(auth.project) && /^[a-z0-9][a-z0-9-]{0,99}$/.test(auth.scope), "authority scope");
  need(Number.isInteger(input.maximumNewCalls) && input.maximumNewCalls > 0 && input.maximumNewCalls <= 256
    && /^[a-f0-9]{64}$/.test(input.freezeSha256) && Number.isFinite(input.startAt) && input.endAt >= input.startAt, "batch bounds");
  async function load(p: GatewayAuditPin) { path(p.path); need(/^[a-f0-9]{64}$/.test(p.sha256), "pin"); const raw = await read(p, 128 * 1024);
    need(raw.length <= 128 * 1024 && sha256Hex(raw) === p.sha256, "pin bytes"); return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))); }
  const c = await load(input.configuration); exact(c, ["argv", "cwd", "jobDir", "requireAbsent"]);
  need(Array.isArray(c.argv) && c.argv.length <= 32 && c.argv.every(v => typeof v === "string"), "argv");
  const argv = c.argv as string[], executable = path(argv[0]), bun = path(argv[10]), jobDir = path(c.jobDir);
  need(basename(executable) === "vercel" && basename(bun) === "bun" && c.cwd === root && jobDir !== study && !jobDir.startsWith(study + "/")
    && input.configuration.path === join(jobDir, "config.json") && input.supervisorStatus.path === join(jobDir, "status.json"), "configuration path");
  need(gatewaySupervisorJson(argv) === gatewaySupervisorJson([executable, "env", "run", "--project", auth.project, "--scope", auth.scope,
    "--environment", auth.environment, "--", bun, join(root, "scripts/benchmarks/gateway-study-v6.ts"), "run", "--directory", study,
    "--freeze-sha256", input.freezeSha256, "--max-new-calls", String(input.maximumNewCalls)]), "scoped command");
  need(Array.isArray(c.requireAbsent) && c.requireAbsent.length <= 64 && new Set(c.requireAbsent).size === c.requireAbsent.length, "absence shape");
  c.requireAbsent.forEach(path); need(c.requireAbsent.includes(join(study, "active.lock")), "study lock gate");
  need(sha256Hex(gatewaySupervisorJson(c)) === input.configuration.sha256, "canonical config");
  const s = await load(input.supervisorStatus); exact(s, ["state", "supervisorPid", "supervisorStart", "bootIdentity", "commandSha256", "configSha256", "startedAt", "childPid", "childPgid", "childStart", "exitCode", "groupGone", "finishedAt"]);
  const supervisor = pid(s.supervisorPid), child = pid(s.childPid); need(child === pid(s.childPgid) && child !== supervisor, "process binding");
  for (const value of [s.supervisorStart, s.bootIdentity]) need(typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0"), "process identity");
  need(s.childStart === null || (typeof s.childStart === "string" && s.childStart.length > 0 && s.childStart.length <= 512 && !s.childStart.includes("\0")), "child identity");
  need(s.state === "exited" && s.exitCode === expectedExit && s.groupGone === true && s.configSha256 === input.configuration.sha256
    && s.commandSha256 === sha256Hex(gatewaySupervisorJson(argv)), "closed status");
  const start = time(s.startedAt), end = time(s.finishedAt);
  need(start <= input.startAt && end >= start && input.endAt < end + 1000 && end <= input.manifestAt, "producer lifetime");
  return { configurationSha256: input.configuration.sha256, supervisorStatusSha256: input.supervisorStatus.sha256, commandSha256: s.commandSha256,
    startedAt: start, finishedAt: end,
    producerIdentitySha256: sha256Hex(gatewaySupervisorJson({ supervisorPid: supervisor, supervisorStart: s.supervisorStart, bootIdentity: s.bootIdentity,
      childPid: child, childPgid: s.childPgid, childStart: s.childStart })) };
}


/** Ordinary native runs still require exit zero; callers cannot select a weaker disposition. */
export async function verifyGatewayV6Supervisor(input: Input, read: (p: GatewayAuditPin, max: number) => Promise<Uint8Array>) {
  return verifySupervisorEvidence(input, read, 0);
}

type PreNativeInput = Readonly<{
  acceptance: GatewayAuditPin; freezePin: GatewayAuditPin; freeze: Readonly<{ createdAt: string; sourceSha256: string; sourceGitHead: string;
    policySha256: string; importedStudy: GatewayAuditPin; priorAmendmentExposureMicros: number }>;
  runtimeRoot: string; studyDirectory: string; manifestAt: number; auth: Input["auth"];
  readStudy: (path: string, maximum: number) => Promise<Uint8Array>;
}>;
/** Authenticates one historical zero-native failure; it never performs fresh process discovery. */
export async function verifyGatewayV6PreNativeFailure(input: PreNativeInput, read: (p: GatewayAuditPin, max: number) => Promise<Uint8Array>) {
  const M = 1024 * 1024, carry = 18_268_639, policy = "22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1";
  const study = path(input.studyDirectory), work = dirname(study), folder = join(work, "gateway-study-v6-batch-001"), pins: GatewayAuditPin[] = [];
  function hash(v: unknown): string { need(typeof v === "string" && /^[a-f0-9]{64}$/.test(v), "failure hash"); return v; }
  function pin(v: unknown): GatewayAuditPin { const p = record(v); exact(p, ["path", "sha256"]); return { path: path(p.path), sha256: hash(p.sha256) }; }
  function same(a: unknown, b: unknown, why: string) { need(canonicalJson(a) === canonicalJson(b), why); }
  function instant(v: unknown): number { need(typeof v === "string", "failure timestamp"); const n = Date.parse(v); need(Number.isFinite(n) && new Date(n).toISOString() === v, "failure timestamp"); return n; }
  async function load(p: GatewayAuditPin, max = 8 * M) { const raw = await read(p, max); need(raw.length <= max && sha256Hex(raw) === p.sha256, "failure pin bytes"); pins.push(p); return raw; }
  async function object(p: GatewayAuditPin) { return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await load(p)))); }
  need(input.acceptance.path === join(work, "gateway-v6-launch-001-pre-native-acceptance.json")
    && input.freezePin.path === join(study, "freeze.json"), "failure fixed paths");
  const a = await object(pin(input.acceptance));
  exact(a, ["schema", "recordedAt", "launchNumber", "disposition", "freeze", "sourceSha256", "sourceGitHead", "policySha256", "importPreparation",
    "globalBudgetReservation", "diagnosis", "configuration", "retainedLaunchConfiguration", "supervisorStatus", "log", "zeroNativeInventory", "producer", "groupGone",
    "freshOsProcessMatches", "processInventory", "nativeAdmissions", "newTransportInvocations", "nativeLedgerExposureMicros", "priorAmendmentExposureMicros",
    "totalAmendmentExposureMicros", "oldLedgers", "allOriginalLedgersUnchanged", "correctnessInspected", "responseTextInspected", "modelCallsByVerifier", "auditorCallsByVerifier", "studyWrites"]);
  need(a.schema === "oh.gateway-v6-pre-native-failure-acceptance.v1" && a.launchNumber === 1 && a.disposition === "scope-inaccessible-before-native-runner"
    && a.sourceSha256 === input.freeze.sourceSha256 && a.sourceGitHead === input.freeze.sourceGitHead && a.policySha256 === policy
    && input.freeze.policySha256 === policy && input.freeze.priorAmendmentExposureMicros === carry
    && a.priorAmendmentExposureMicros === carry && a.totalAmendmentExposureMicros === carry
    && a.groupGone === true && a.allOriginalLedgersUnchanged === true && a.correctnessInspected === false && a.responseTextInspected === false
    && ["freshOsProcessMatches", "nativeAdmissions", "newTransportInvocations", "nativeLedgerExposureMicros", "modelCallsByVerifier", "auditorCallsByVerifier", "studyWrites"].every(k => a[k] === 0), "failure acceptance scope");
  same(a.freeze, input.freezePin, "failure freeze binding");
  const acceptedAt = instant(a.recordedAt); need(acceptedAt >= instant(input.freeze.createdAt) && acceptedAt <= input.manifestAt, "failure acceptance lifetime");
  const globalBudgetReservation = pin(a.globalBudgetReservation);
  need(globalBudgetReservation.path === join(work, "gateway-v6-global-budget-reservation.json"), "failure global reservation path");
  const globalBudget = parseGatewayV6GlobalBudgetReservation(await object(globalBudgetReservation));
  same(globalBudget.freeze, input.freezePin, "failure global freeze");
  need(globalBudget.sourceSha256 === input.freeze.sourceSha256 && globalBudget.sourceGitHead === input.freeze.sourceGitHead
    && instant(globalBudget.recordedAt) >= instant(input.freeze.createdAt) && instant(globalBudget.recordedAt) <= acceptedAt, "failure global reservation lifetime");
  const configuration = pin(a.configuration), statusPin = pin(a.supervisorStatus), retained = pin(a.retainedLaunchConfiguration), logPin = pin(a.log);
  need(configuration.path === join(folder, "config.json") && statusPin.path === join(folder, "status.json") && logPin.path === join(folder, "log")
    && retained.path === join(work, "gateway-study-v6-batch-001-launch-config.json") && retained.sha256 === configuration.sha256, "failure producer paths");
  await load(retained, 128 * 1024);
  const status = await object(statusPin), start = time(status.startedAt), end = time(status.finishedAt);
  const producer = await verifySupervisorEvidence({ configuration, supervisorStatus: statusPin, maximumNewCalls: 32, startAt: start, endAt: end,
    studyDirectory: study, runtimeRoot: input.runtimeRoot, freezeSha256: input.freezePin.sha256, manifestAt: acceptedAt, auth: input.auth }, read, 1);
  pins.push(configuration);
  need(producer.startedAt >= instant(input.freeze.createdAt), "failure precedes freeze");
  same(a.producer, Object.fromEntries(["supervisorPid", "supervisorStart", "bootIdentity", "childPid", "childPgid", "childStart"].map(k => [k, status[k]])), "failure producer identity");
  const proof = record(a.processInventory); exact(proof, ["argv", "checkedAt", "sha256", "rows", "matchedProducers"]);
  same(proof.argv, ["/bin/ps", "-axo", "pid=,ppid=,pgid=,command="], "failure process query"); hash(proof.sha256);
  need(typeof proof.rows === "number" && Number.isSafeInteger(proof.rows) && proof.rows > 0 && proof.matchedProducers === 0, "failure process proof");
  const checkedAt = instant(proof.checkedAt); need(end <= checkedAt && checkedAt <= acceptedAt && acceptedAt - checkedAt <= 60_000, "failure stale process proof");
  const log = new TextDecoder("utf-8", { fatal: true }).decode(await load(logPin, 128 * 1024));
  need(/^Vercel CLI 58\.4\.0 \(Node\.js \d+\.\d+\.\d+\)\nError: You do not have access to the specified account\nLearn More: https:\/\/err\.sh\/vercel\/scope-not-accessible\n$/.test(log), "failure diagnostic log");
  const diagnosisPin = pin(a.diagnosis); need(diagnosisPin.path === join(work, "gateway-v6-pre-native-launch-failure.json"), "failure diagnosis path");
  const d = await object(diagnosisPin);
  exact(d, ["schema", "recordedAt", "status", "supervisorStatus", "log", "configuration", "diagnostic", "nativeStudyFiles", "nativeAdmissions", "v6JobRequests", "v6LedgerExists", "modelCalls", "totalAmendmentExposureMicros", "automaticRetryPermitted", "qualification"]);
  need(d.schema === "oh.gateway-v6-pre-native-launch-failure.v1" && d.status === "vercel-scope-inaccessible-before-native-runner"
    && d.nativeAdmissions === 0 && d.v6JobRequests === 0 && d.v6LedgerExists === false && d.modelCalls === 0
    && d.totalAmendmentExposureMicros === carry && d.automaticRetryPermitted === false
    && d.diagnostic === "Vercel CLI 58.4.0: You do not have access to the specified account; scope-not-accessible"
    && d.qualification === "Supervisor metadata and absence of all native run artifacts; fresh OS closure proof remains required before any recovery dispatch.", "failure diagnosis scope");
  need(typeof d.recordedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}\+00:00$/.test(d.recordedAt), "failure diagnosis time");
  const diagnosisSecond = time(d.recordedAt.slice(0, 19) + "Z"), diagnosisMicros = diagnosisSecond * 1000 + Number(d.recordedAt.slice(20, 26));
  need(Number.isSafeInteger(diagnosisMicros) && diagnosisMicros >= end * 1000 && diagnosisMicros <= acceptedAt * 1000, "failure diagnosis time");
  for (const [key, expected] of [["configuration", configuration], ["supervisorStatus", statusPin], ["log", logPin]] as const) {
    const extended = record(d[key]); exact(extended, ["path", "bytes", "sha256"]);
    same({ path: extended.path, sha256: extended.sha256 }, expected, "failure diagnosis evidence");
    need(extended.bytes === (await load(expected, 128 * 1024)).length, "failure diagnosis length");
  }
  same(d.nativeStudyFiles, ["freeze.json", "preparation.json"], "failure zero native diagnosis");
  const inventoryPin = pin(a.zeroNativeInventory); need(inventoryPin.path === join(work, "gateway-v6-launch-001-zero-native-inventory.json"), "failure inventory path");
  const inventory = await object(inventoryPin); exact(inventory, ["schema", "freezeSha256", "files"]);
  need(inventory.schema === "oh.gateway-final-inventory.v6" && inventory.freezeSha256 === input.freezePin.sha256 && Array.isArray(inventory.files) && inventory.files.length === 2, "failure zero native inventory");
  for (const [i, name] of ["freeze.json", "preparation.json"].entries()) {
    const f = record(inventory.files[i]); exact(f, ["path", "bytes", "sha256"]);
    const raw = await input.readStudy(name, 8 * M); need(f.path === name && f.bytes === raw.length && f.sha256 === sha256Hex(raw) && (name !== "freeze.json" || f.sha256 === input.freezePin.sha256), "failure unchanged foundation");
  }
  const importPin = pin(a.importPreparation); need(importPin.path === join(work, "gateway-v6-import-preparation.json"), "failure import path");
  const imported = await object(importPin);
  need(imported.schema === "oh.gateway-v6-import-preparation.v1" && imported.policySha256 === policy && imported.totalCarriedExposureMicros === carry
    && imported.producerCount === 21 && imported.newJobs === 5064 && imported.attemptedReaderJobs === 332, "failure import preparation");
  same(imported.manifest, input.freeze.importedStudy, "failure imported manifest");
  need(Array.isArray(a.oldLedgers) && a.oldLedgers.length === 4 && Array.isArray(imported.oldLedgers) && imported.oldLedgers.length === 3, "failure old ledger set");
  const prior = [...imported.oldLedgers, { path: record(imported.ledger).path, sha256: record(imported.ledger).sha256 }];
  for (const [i, value] of a.oldLedgers.entries()) {
    const old = record(value); exact(old, ["path", "sha256", "bytes"]); const oldPin = pin({ path: old.path, sha256: old.sha256 });
    same(oldPin, prior[i], "failure old ledger identity"); need((await load(oldPin, 8 * M)).length === old.bytes, "failure old ledger length");
  }
  const oldLedgers = a.oldLedgers;
  const ancestry = (i: number) => { const ledger = record(oldLedgers[i]); return pin({ path: ledger.path, sha256: ledger.sha256 }); };
  const requiredAncestryLedgers = [ancestry(0), ancestry(1), ancestry(3)] as const;
  return { ...producer, acceptedAt, pins, acceptance: input.acceptance, globalBudgetReservation, requiredAncestryLedgers };
}
