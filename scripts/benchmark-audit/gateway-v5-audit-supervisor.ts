/** Pure validation of externally pinned producer evidence. No process discovery or ownership claims. */
import { basename, join, isAbsolute, resolve } from "node:path";
import { canonicalJson, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
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
export async function verifyGatewayV5Supervisor(input: Input, read: (p: GatewayAuditPin, max: number) => Promise<Uint8Array>) {
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
    "--environment", auth.environment, "--", bun, join(root, "scripts/benchmarks/gateway-study-v5.ts"), "run", "--directory", study,
    "--freeze-sha256", input.freezeSha256, "--max-new-calls", String(input.maximumNewCalls)]), "scoped command");
  need(Array.isArray(c.requireAbsent) && c.requireAbsent.length <= 64 && new Set(c.requireAbsent).size === c.requireAbsent.length, "absence shape");
  c.requireAbsent.forEach(path); need(c.requireAbsent.includes(join(study, "active.lock")), "study lock gate");
  need(sha256Hex(gatewaySupervisorJson(c)) === input.configuration.sha256, "canonical config");
  const s = await load(input.supervisorStatus); exact(s, ["state", "supervisorPid", "supervisorStart", "bootIdentity", "commandSha256", "configSha256", "startedAt", "childPid", "childPgid", "childStart", "exitCode", "groupGone", "finishedAt"]);
  const supervisor = pid(s.supervisorPid), child = pid(s.childPid); need(child === pid(s.childPgid) && child !== supervisor, "process binding");
  for (const value of [s.supervisorStart, s.bootIdentity]) need(typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0"), "process identity");
  need(s.childStart === null || (typeof s.childStart === "string" && s.childStart.length > 0 && s.childStart.length <= 512 && !s.childStart.includes("\0")), "child identity");
  need(s.state === "exited" && s.exitCode === 0 && s.groupGone === true && s.configSha256 === input.configuration.sha256
    && s.commandSha256 === sha256Hex(gatewaySupervisorJson(argv)), "closed status");
  const start = time(s.startedAt), end = time(s.finishedAt);
  need(start <= input.startAt && end >= start && input.endAt < end + 1000 && end <= input.manifestAt, "producer lifetime");
  return { configurationSha256: input.configuration.sha256, supervisorStatusSha256: input.supervisorStatus.sha256, commandSha256: s.commandSha256,
    producerIdentitySha256: sha256Hex(gatewaySupervisorJson({ supervisorPid: supervisor, supervisorStart: s.supervisorStart, bootIdentity: s.bootIdentity,
      childPid: child, childPgid: s.childPgid, childStart: s.childStart })) };
}
