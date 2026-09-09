import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { gatewaySupervisorJson, verifyGatewayV6Supervisor, type GatewayAuditPin } from "../scripts/benchmark-audit/gateway-v6-audit-supervisor";

const runtime = "/synthetic/runtime", study = "/synthetic/study", jobDir = "/synthetic/batch-001";
const start = Date.parse("2026-01-01T00:00:00.000Z"), freezeSha256 = sha256Hex("synthetic-v6-freeze");
type Json = Record<string, any>;
function fixture() {
  const auth = { method: "project-oidc", project: "synthetic-project", scope: "synthetic-scope", environment: "development" } as const;
  const argv = ["/synthetic/bin/vercel", "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", "development", "--",
    "/synthetic/bin/bun", runtime + "/scripts/benchmarks/gateway-study-v6.ts", "run", "--directory", study,
    "--freeze-sha256", freezeSha256, "--max-new-calls", "32"];
  const configuration: Json = { argv, cwd: runtime, jobDir, requireAbsent: [study + "/active.lock"] };
  const status: Json = { state: "exited", supervisorPid: 101, supervisorStart: "synthetic-start", bootIdentity: "synthetic-boot",
    commandSha256: sha256Hex(gatewaySupervisorJson(argv)), configSha256: sha256Hex(gatewaySupervisorJson(configuration)),
    startedAt: "2026-01-01T00:00:00Z", childPid: 102, childPgid: 102, childStart: "synthetic-child-start",
    exitCode: 0, groupGone: true, finishedAt: "2026-01-01T00:00:10Z" };
  const input = { maximumNewCalls: 32, startAt: start + 1000, endAt: start + 9500, studyDirectory: study,
    runtimeRoot: runtime, freezeSha256, manifestAt: start + 11000, auth };
  return { configuration, status, input };
}
function packet(f = fixture()) {
  const configRaw = Buffer.from(gatewaySupervisorJson(f.configuration));
  const statusRaw = Buffer.from(JSON.stringify(f.status));
  const configuration = { path: jobDir + "/config.json", sha256: sha256Hex(configRaw) };
  const supervisorStatus = { path: jobDir + "/status.json", sha256: sha256Hex(statusRaw) };
  const read = async (pin: GatewayAuditPin, max: number) => {
    const raw = pin.path === configuration.path ? configRaw : pin.path === supervisorStatus.path ? statusRaw : undefined;
    if (!raw || raw.length > max) throw new Error("synthetic missing evidence");
    return raw;
  };
  return { input: { ...f.input, configuration, supervisorStatus }, read };
}
function rebind(f: ReturnType<typeof fixture>) {
  f.status.commandSha256 = sha256Hex(gatewaySupervisorJson(f.configuration.argv));
  f.status.configSha256 = sha256Hex(gatewaySupervisorJson(f.configuration));
  return packet(f);
}

describe("Gateway v6 pinned supervisor custody validation", () => {
  test("binds the exact v6 request and returns producer lifetime without claiming fresh process absence", async () => {
    const f = fixture(), p = packet(f), result = await verifyGatewayV6Supervisor(p.input, p.read);
    expect(result.configurationSha256).toBe(p.input.configuration.sha256);
    expect(result.startedAt).toBe(start); expect(result.finishedAt).toBe(start + 10000);
    expect(result.producerIdentitySha256).toBe(canonicalSha256({ supervisorPid: 101, supervisorStart: "synthetic-start",
      bootIdentity: "synthetic-boot", childPid: 102, childPgid: 102, childStart: "synthetic-child-start" }));
    expect(result).not.toHaveProperty("allProducersClosed"); expect(result).not.toHaveProperty("freshProcessMatches");
  });
  test("rehashed old protocol, changed model command, wrong project and missing lock stay ineligible", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.configuration.argv[11] = runtime + "/scripts/benchmarks/gateway-study-v5.ts"; },
      (f: ReturnType<typeof fixture>) => { f.configuration.argv.push("--model", "unapproved"); },
      (f: ReturnType<typeof fixture>) => { f.configuration.argv[4] = "wrong-project"; },
      (f: ReturnType<typeof fixture>) => { f.configuration.requireAbsent = []; },
      (f: ReturnType<typeof fixture>) => { f.configuration.cwd = "/synthetic/other"; },
      (f: ReturnType<typeof fixture>) => { f.configuration.jobDir = study + "/nested"; },
    ]) {
      const f = fixture(); mutate(f); const p = rebind(f);
      await expect(verifyGatewayV6Supervisor(p.input, p.read)).rejects.toThrow();
    }
  });
  test("a failed, live, mismatched or temporally overlapping producer cannot certify completion", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.status.exitCode = 1; },
      (f: ReturnType<typeof fixture>) => { f.status.groupGone = false; },
      (f: ReturnType<typeof fixture>) => { f.status.state = "cleanup-incomplete"; },
      (f: ReturnType<typeof fixture>) => { f.status.childPgid = 103; },
      (f: ReturnType<typeof fixture>) => { f.status.commandSha256 = sha256Hex("wrong-command"); },
      (f: ReturnType<typeof fixture>) => { f.status.configSha256 = sha256Hex("wrong-config"); },
      (f: ReturnType<typeof fixture>) => { f.status.startedAt = "2026-01-01T00:00:02Z"; },
      (f: ReturnType<typeof fixture>) => { f.status.finishedAt = "2026-01-01T00:00:08Z"; },
      (f: ReturnType<typeof fixture>) => { f.input.manifestAt = start + 9000; },
    ]) {
      const f = fixture(); mutate(f); const p = packet(f);
      await expect(verifyGatewayV6Supervisor(p.input, p.read)).rejects.toThrow();
    }
  });
  test("modified evidence bytes cannot be accepted with the original pins", async () => {
    const p = packet();
    await expect(verifyGatewayV6Supervisor(p.input, async (pin, max) => {
      const raw = await p.read(pin, max); return Buffer.concat([raw, Buffer.from("\n")]);
    })).rejects.toThrow("pin bytes");
  });
});

import { preNativePacket } from "./helpers/gateway-v6-pre-native";
import { verifyGatewayV6PreNativeFailure } from "../scripts/benchmark-audit/gateway-v6-audit-supervisor";

describe("Gateway v6 initial pre-native failure evidence", () => {
  test("authenticates the separate zero-native acceptance and preserved foundations", async () => {
    const p = preNativePacket(), result = await verifyGatewayV6PreNativeFailure(p.input, p.read);
    expect(result.acceptedAt).toBe(Date.parse(p.iso(30)));
    expect(result.finishedAt).toBe(Date.parse(p.iso(20)));
    expect(result.pins.length).toBeGreaterThan(10);
    expect(result).not.toHaveProperty("allProducersClosed");
  });
  test("rehashing does not authorize native artifacts, stale proof, a second failure or source drift", async () => {
    for (const mutate of [
      (p: ReturnType<typeof preNativePacket>) => { p.acceptance.launchNumber = 2; },
      (p: ReturnType<typeof preNativePacket>) => { p.acceptance.newTransportInvocations = 1; },
      (p: ReturnType<typeof preNativePacket>) => { p.acceptance.nativeLedgerExposureMicros = 1; },
      (p: ReturnType<typeof preNativePacket>) => { p.acceptance.processInventory.matchedProducers = 1; },
      (p: ReturnType<typeof preNativePacket>) => { p.acceptance.processInventory.checkedAt = p.iso(0); },
      (p: ReturnType<typeof preNativePacket>) => { p.acceptance.recordedAt = p.iso(95); },
      (p: ReturnType<typeof preNativePacket>) => { p.acceptance.sourceGitHead = "b".repeat(40); },
      (p: ReturnType<typeof preNativePacket>) => { p.acceptance.inventory = p.acceptance.zeroNativeInventory; },
      (p: ReturnType<typeof preNativePacket>) => { p.inventory.files.push({ path: "ledger.jsonl", bytes: 0, sha256: sha256Hex("") }); p.acceptance.zeroNativeInventory = p.put(p.acceptance.zeroNativeInventory.path, p.inventory); },
    ]) {
      const p = preNativePacket(); mutate(p); p.reseal();
      await expect(verifyGatewayV6PreNativeFailure(p.input, p.read)).rejects.toThrow();
    }
  });
  test("diagnostic grammar and microsecond chronology agree with the Python admission tool", async () => {
    for (const mutate of [
      (p: ReturnType<typeof preNativePacket>) => { p.diagnosisValue.diagnostic = "unrecognized failure"; },
      (p: ReturnType<typeof preNativePacket>) => { p.diagnosisValue.qualification = "automatic retry"; },
      (p: ReturnType<typeof preNativePacket>) => { p.diagnosisValue.recordedAt = "2026-02-30T00:00:25.000000+00:00"; },
      (p: ReturnType<typeof preNativePacket>) => { p.diagnosisValue.recordedAt = "2026-01-01T00:00:30.000001+00:00"; },
    ]) {
      const p = preNativePacket(); mutate(p); p.acceptance.diagnosis = p.put(p.acceptance.diagnosis.path, p.diagnosisValue); p.reseal();
      await expect(verifyGatewayV6PreNativeFailure(p.input, p.read)).rejects.toThrow();
    }
    const p = preNativePacket();
    p.acceptance.log = p.put(p.acceptance.log.path, "Vercel CLI 58.5.0 (Node.js 24.20.0)\nError: You do not have access to the specified account\nLearn More: https://err.sh/vercel/scope-not-accessible\n", true); p.reseal();
    await expect(verifyGatewayV6PreNativeFailure(p.input, p.read)).rejects.toThrow("diagnostic log");
  });
  test("changed foundations, producer exit disposition or imported ledger bytes fail", async () => {
    const foundation = preNativePacket(); foundation.study.set("preparation.json", Buffer.from("changed"));
    await expect(verifyGatewayV6PreNativeFailure(foundation.input, foundation.read)).rejects.toThrow("foundation");
    const producer = preNativePacket(); producer.status.exitCode = 0; producer.acceptance.supervisorStatus = producer.put(producer.acceptance.supervisorStatus.path, producer.status); producer.reseal();
    await expect(verifyGatewayV6PreNativeFailure(producer.input, producer.read)).rejects.toThrow("closed status");
    const ledger = preNativePacket(); ledger.external.set(ledger.acceptance.oldLedgers[0].path, Buffer.from("changed"));
    await expect(verifyGatewayV6PreNativeFailure(ledger.input, ledger.read)).rejects.toThrow("pin bytes");
  });
});
