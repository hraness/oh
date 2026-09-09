import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256Hex } from "../src/canonical";
import { GatewayStudyBudget, makeGatewayStudyRequest, type GatewayStudyRequest } from "../scripts/benchmarks/gateway-study-transport-v3";
import { invokeGatewayStudyV6 } from "../scripts/benchmarks/gateway-study-transport-v6";
import { openLabPaidCache } from "../scripts/benchmarks/lab-paid-cache";
import { labPaidCacheJob } from "../scripts/benchmarks/lab-paid-cache";
import { LEGACY_LAB_PAID_NAMESPACE, replayLegacyLabPaidJudge } from "../scripts/benchmarks/lab-reader-profile-legacy-judge";
const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await realpath(await mkdtemp(join(tmpdir(), "legacy-judge-"))); await chmod(path, 0o700); roots.push(path); return path; }
function request() { return makeGatewayStudyRequest({ phase: "judge", messages: [{ role: "system", content: "Judge." }, { role: "user", content: "Answer." }] }); }
function envelope(input: GatewayStudyRequest) { return { model: input.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "yes" } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }, providerMetadata: { gateway: { routing: { originalModelId: input.model, canonicalSlug: input.model, resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1, modelAttempts: [{ canonicalSlug: input.model, success: true, providerAttemptCount: 1, providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } }; }
async function pin(path: string) { const raw = await readFile(path); return { path, sha256: sha256Hex(raw), bytes: raw.byteLength }; }
async function complete(path: string, input: GatewayStudyRequest) { const cache = await openLabPaidCache({ directory: path, namespaceSha256: LEGACY_LAB_PAID_NAMESPACE }), job = cache.job(input), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }); await cache.begin(input); const result = await invokeGatewayStudyV6({ request: input, reservationId: job.key, oidcToken: "synthetic", budget, record: event => cache.record(input, event), capture: raw => cache.capture(input, raw), fetcher: async () => Response.json(envelope(input)) }); await cache.complete(input, result); await cache.close(); return result; }
test("legacy judge replay is exact, misses only absent keys, and fails closed on occupied/corrupt evidence", async () => {
  const path = await directory(), input = request(), ledger = join(path, "ledger.jsonl");
  const cache = await openLabPaidCache({ directory: path, namespaceSha256: LEGACY_LAB_PAID_NAMESPACE }); await cache.close();
  expect(await replayLegacyLabPaidJudge({ directory: path, ledger: await pin(ledger), request: input })).toEqual({ kind: "miss" });
  const result = await complete(path, input), hit = await replayLegacyLabPaidJudge({ directory: path, ledger: await pin(ledger), request: input }); expect(hit).toEqual({ kind: "hit", result });
  await writeFile(ledger, "", { mode: 0o600 }); await expect(replayLegacyLabPaidJudge({ directory: path, ledger: await pin(ledger), request: input })).rejects.toThrow();
});
test("never treats a ledger-recorded missing job directory as a reusable miss", async () => {
  const path = await directory(), input = request(), ledger = join(path, "ledger.jsonl"); await complete(path, input); const pinned = await pin(ledger);
  await rm(join(path, "jobs", labPaidCacheJob(LEGACY_LAB_PAID_NAMESPACE, input).key), { recursive: true, force: true });
  await expect(replayLegacyLabPaidJudge({ directory: path, ledger: pinned, request: input })).rejects.toThrow("missing occupied");
});
test("legacy replay rejects occupied, header/namespace changes, and readers", async () => {
  const path = await directory(), ledger = join(path, "ledger.jsonl"), judge = request(), cache = await openLabPaidCache({ directory: path, namespaceSha256: LEGACY_LAB_PAID_NAMESPACE }); await cache.begin(judge); await cache.close();
  await expect(replayLegacyLabPaidJudge({ directory: path, ledger: await pin(ledger), request: judge })).rejects.toThrow();
  const reader = makeGatewayStudyRequest({ phase: "reader", messages: judge.body.messages }); await expect(replayLegacyLabPaidJudge({ directory: path, ledger: await pin(ledger), request: reader })).rejects.toThrow("noncanonical judge");
  await writeFile(join(path, "store.json"), "{}\n", { mode: 0o600 }); await expect(replayLegacyLabPaidJudge({ directory: path, ledger: await pin(ledger), request: judge })).rejects.toThrow("header");
});
