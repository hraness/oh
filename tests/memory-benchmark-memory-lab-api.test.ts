import { afterEach, expect, test } from "bun:test";
import fc from "fast-check";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiLabTransport, parseApiConfig, parseApiReply, prepareApiRequest, type ApiBinding } from "../scripts/benchmarks/memory-lab/api-transport";

const reader: ApiBinding = { id: "gemini-reader", model: "gemini-3.8-flash", keyEnv: "VERTEX_API_KEY", maximumOutput: 4096 };
const judge: ApiBinding = { id: "grok-judge", model: "grok-4.7", keyEnv: "XAI_API_KEY", maximumOutput: 2048 };
const messages = [{ role: "system" as const, content: "Use only memory." }, { role: "user" as const, content: "Which colour?" }];
const now = () => Date.parse("2026-09-30T06:00:00Z");
const dirs: string[] = [];
const oldGemini = process.env.VERTEX_API_KEY, oldXai = process.env.XAI_API_KEY;
afterEach(() => {
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
  if (oldGemini === undefined) delete process.env.VERTEX_API_KEY; else process.env.VERTEX_API_KEY = oldGemini;
  if (oldXai === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = oldXai;
});
function setup(maxUsd = 5, maxCalls = 10) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oh-api-test-"))); dirs.push(dir);
  const cache = join(dir, "cache"); mkdirSync(cache, { mode: 0o700 });
  const budgetPath = join(dir, "budget.json"), ledgerPath = join(cache, "ledger.jsonl");
  const budget = { protocol: "oh.memory-lab-api-budget.v1", maxUsd, maxCalls, expiresAt: "2026-09-30T07:00:00Z", ledgerPath };
  writeFileSync(budgetPath, JSON.stringify(budget), { mode: 0o600 });
  process.env.VERTEX_API_KEY = "test-gemini-secret"; process.env.XAI_API_KEY = "test-xai-secret";
  return { config: { budgetPath, reader, judge }, dir, ledgerPath, budget };
}
function gemini(finish = "STOP", thoughts = 2) {
  return { modelVersion: "gemini-3.8-flash", candidates: [{ finishReason: finish, content: { parts: [{ text: "private thought", thought: true }, { text: "teal" }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: thoughts, totalTokenCount: 13 + thoughts } };
}
function grok() {
  return { model: "grok-4.7", status: "completed", output: [{ type: "reasoning" },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "{\"score\":1}" }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 17, output_tokens_details: { reasoning_tokens: 2 },
      num_server_side_tools_used: 0, num_sources_used: 0 } };
}
const goodFetch: typeof fetch = Object.assign(async (url: Parameters<typeof fetch>[0]) =>
  Response.json(String(url).includes("googleapis") ? gemini() : grok()), { preconnect: fetch.preconnect });

test("direct requests preserve role separation and have finite output, thinking and tool-free settings", () => {
  const a = prepareApiRequest(reader, messages), b = prepareApiRequest(judge, messages);
  expect(JSON.parse(a.raw)).toMatchObject({ systemInstruction: { parts: [{ text: messages[0]!.content }] },
    contents: [{ role: "user", parts: [{ text: messages[1]!.content }] }],
    generationConfig: { maxOutputTokens: 4096, candidateCount: 1, thinkingConfig: { thinkingLevel: "low" } } });
  expect(JSON.parse(b.raw)).toMatchObject({ model: "grok-4.7", max_output_tokens: 2048, reasoning: { effort: "low" }, store: false, stream: false });
  expect(b.endpoint).toBe("https://api.x.ai/v1/responses");
  for (const r of [a, b]) { expect(r.raw).not.toContain("Authorization"); expect(r.raw).not.toContain("keyEnv"); expect(r.raw).not.toContain('"tools"'); }
  expect(() => prepareApiRequest(reader, [{ role: "user", content: "x".repeat(1_048_576) }])).toThrow();
  expect(() => parseApiConfig({ budgetPath: "/tmp/budget", reader: { ...reader, keyEnv: "XAI_API_KEY" }, judge })).toThrow("mismatch");
});

test("Gemini thinking tokens are charged, hidden thought parts are excluded, and truncation stays failed", () => {
  const request = prepareApiRequest(reader, messages), reply = parseApiReply(gemini(), request);
  expect(reply.result.answer).toBe("teal"); expect(reply.usage.outputTokens).toBe(5);
  expect(reply.usage.micros).toBe(27);
  expect(parseApiReply(gemini("MAX_TOKENS"), request).result).toMatchObject({ status: "failed", answer: null, failureReason: "output-token-limit" });
  expect(() => parseApiReply(gemini("STOP", 5000), request)).toThrow("usage");
  expect(() => parseApiReply({ ...gemini(), modelVersion: "another-model" }, request)).toThrow("identity");
});

test("xAI bills separately reported reasoning and long-context reservations use the higher rate", () => {
  const a = prepareApiRequest(judge, messages), b = prepareApiRequest(judge, [{ role: "user", content: "x".repeat(201_000) }]);
  expect(parseApiReply(grok(), a).usage).toMatchObject({ inputTokens: 10, outputTokens: 7, micros: 62 });
  expect(b.reservationMicros).toBe(Math.ceil((b.inputUpperBound * 2 + 2048 * 6) * 2));
  expect(() => parseApiReply({ ...grok(), usage: { ...grok().usage, total_tokens: 99 } }, a)).toThrow("accounting");
  expect(() => parseApiReply({ ...grok(), usage: { ...grok().usage, num_server_side_tools_used: 1 } }, a)).toThrow("unsafe");
  expect(() => parseApiReply({ ...grok(), usage: { ...grok().usage, output_tokens_details: { reasoning_tokens: 2048 }, total_tokens: 2063 } }, a)).toThrow("usage");
  expect(parseApiReply({ ...grok(), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, a).result)
    .toMatchObject({ status: "failed", failureReason: "output-token-limit" });
  expect(parseApiReply({ ...grok(), usage: { ...grok().usage, cost_in_usd_ticks: 1_000_000 } }, a).usage.micros).toBe(100);
  expect(() => parseApiReply({ ...grok(), usage: { ...grok().usage, cost_in_usd_ticks: 5_000_000_000 } }, a)).toThrow("reservation");
});

test("random consistent reasoning receipts never discount generation or higher provider-reported charges", () => {
  const request = prepareApiRequest(judge, messages);
  fc.assert(fc.property(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 1, max: 32 }), fc.integer({ min: 0, max: 64 }),
    fc.integer({ min: 0, max: 10_000 }), (input, visible, reasoning, billedMicros) => {
      const value = { ...grok(), usage: { ...grok().usage, input_tokens: input, output_tokens: visible,
        output_tokens_details: { reasoning_tokens: reasoning }, total_tokens: input + visible + reasoning, cost_in_usd_ticks: billedMicros * 10_000 } };
      const reply = parseApiReply(value, request);
      expect(reply.usage.outputTokens).toBe(visible + reasoning);
      expect(reply.usage.micros).toBe(Math.max(billedMicros, input * 2 + (visible + reasoning) * 6));
    }), { numRuns: 50, seed: 913 });
});

test("reader and judge share settled exposure across invocations and credentials are absent from captures", async () => {
  const s = setup(), a = await ApiLabTransport.open({ config: s.config, maxCalls: 1, fetcher: goodFetch, now });
  try { await a.invoke(reader.id, messages); expect(a.summary.accountedUsd).toBe(0.000027); } finally { a.close(); }
  const b = await ApiLabTransport.open({ config: s.config, maxCalls: 1, fetcher: goodFetch, now });
  try { await b.invoke(judge.id, messages); expect(b.summary).toMatchObject({ campaignCalls: 2, accountedUsd: 0.000089 }); } finally { b.close(); }
  expect(readFileSync(s.ledgerPath, "utf8").split("\n").filter(Boolean)).toHaveLength(4);
  const captures = await Array.fromAsync(new Bun.Glob("*.json").scan(s.ledgerPath + ".attempts"));
  for (const name of captures) {
    const text = readFileSync(join(s.ledgerPath + ".attempts", name), "utf8");
    expect(text).not.toContain("test-gemini-secret"); expect(text).not.toContain("test-xai-secret");
  }
});

test("dollar and campaign call ceilings stop requests before dispatch; another owner retains its lock", async () => {
  let fetched = 0;
  const mock: typeof fetch = Object.assign(async () => { fetched++; return Response.json(gemini()); }, { preconnect: fetch.preconnect });
  const s = setup(0.000001), a = await ApiLabTransport.open({ config: s.config, maxCalls: 1, fetcher: mock, now });
  try {
    await expect(ApiLabTransport.open({ config: s.config, maxCalls: 1, now })).rejects.toThrow();
    await expect(a.invoke(reader.id, messages)).rejects.toThrow("limit"); expect(fetched).toBe(0);
  } finally { a.close(); }
  const t = setup(5, 1), b = await ApiLabTransport.open({ config: t.config, maxCalls: 1, fetcher: goodFetch, now });
  try { await b.invoke(reader.id, messages); } finally { b.close(); }
  const c = await ApiLabTransport.open({ config: t.config, maxCalls: 1, fetcher: mock, now });
  try { await expect(c.invoke(judge.id, messages)).rejects.toThrow("limit"); expect(fetched).toBe(0); } finally { c.close(); }
});

test("an unacknowledged network call retains its reservation, halts, and cannot be replayed on reopen", async () => {
  const s = setup(), mock: typeof fetch = Object.assign(async () => { throw new Error("network disconnected"); }, { preconnect: fetch.preconnect });
  const a = await ApiLabTransport.open({ config: s.config, maxCalls: 3, fetcher: mock, now });
  try {
    await expect(a.invoke(reader.id, messages)).rejects.toThrow("disconnected");
    expect(a.summary.accountedUsd).toBeGreaterThan(0); expect(a.halted).toBeTrue();
    await expect(a.invoke(reader.id, messages)).rejects.toThrow("halted");
  } finally { a.close(); }
  await expect(ApiLabTransport.open({ config: s.config, maxCalls: 3, now })).rejects.toThrow("unresolved");
  expect(readFileSync(s.ledgerPath, "utf8").split("\n").filter(Boolean)).toHaveLength(1);
});

test("an acknowledged request rejection stops the run and retains the full charge without claiming a zero bill", async () => {
  const s = setup(), mock: typeof fetch = Object.assign(async () => Response.json({ error: { code: 400 } }, { status: 400 }), { preconnect: fetch.preconnect });
  const a = await ApiLabTransport.open({ config: s.config, maxCalls: 3, fetcher: mock, now });
  try { await expect(a.invoke(reader.id, messages)).rejects.toThrow("HTTP 400"); expect(a.halted).toBeTrue(); } finally { a.close(); }
  const lines = readFileSync(s.ledgerPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(lines).toHaveLength(2); expect(lines[1].micros).toBe(lines[0].micros);
  const b = await ApiLabTransport.open({ config: s.config, maxCalls: 1, fetcher: goodFetch, now });
  try { expect(b.summary.accountedUsd).toBe(lines[0].micros / 1_000_000); } finally { b.close(); }
});

test("changed/expired authority and malformed or oversized responses never settle an unknown charge", async () => {
  const s = setup(), a = await ApiLabTransport.open({ config: s.config, maxCalls: 1, fetcher: goodFetch, now });
  writeFileSync(s.config.budgetPath, JSON.stringify({ ...s.budget, maxUsd: 6 }));
  try { await expect(a.invoke(reader.id, messages)).rejects.toThrow("changed"); expect(a.calls).toBe(0); } finally { a.close(); }
  await expect(ApiLabTransport.open({ config: s.config, maxCalls: 1, now: () => now() + 3600_000 })).rejects.toThrow("expired");
  for (const response of [Response.json({ invalid: true }), new Response("x".repeat(1_048_577))]) {
    const t = setup(), mock: typeof fetch = Object.assign(async () => response, { preconnect: fetch.preconnect });
    const b = await ApiLabTransport.open({ config: t.config, maxCalls: 1, fetcher: mock, now });
    try { await expect(b.invoke(reader.id, messages)).rejects.toThrow(); expect(b.halted).toBeTrue(); } finally { b.close(); }
    await expect(ApiLabTransport.open({ config: t.config, maxCalls: 1, now })).rejects.toThrow("unresolved");
  }
});

function experiment() {
  const s = setup(), instructions = join(s.dir, "instructions"), dir = join(s.dir, "experiments", "test");
  mkdirSync(instructions); mkdirSync(dir, { recursive: true });
  const champion = { name: "baseline", instructionFile: "baseline.txt", context: "context" };
  const challenger = { name: "challenger", instructionFile: "challenger.txt", context: "context" };
  writeFileSync(join(instructions, "baseline.txt"), "Invented baseline instruction.");
  writeFileSync(join(instructions, "challenger.txt"), "Invented challenger instruction.");
  writeFileSync(join(s.dir, "champion.json"), JSON.stringify({ arm: champion, history: [] }));
  const devData = join(s.dir, "data.json"), contexts = join(s.dir, "contexts.jsonl"), scorerTemplates = join(s.dir, "templates.json");
  const questions = ["temporal_reasoning", "abstention"].map(category => ({ id: `beam-1M-0:${category}:0`,
    corpusId: "invented-family", category: "beam:" + category, question: "Invented test question", questionDate: "2034-05-04", answer: "{}" }));
  writeFileSync(devData, JSON.stringify({ questions })); writeFileSync(contexts, "invented context bytes"); writeFileSync(scorerTemplates, "invented template bytes");
  const profile = { transport: "direct-api", api: s.config, readerProfile: reader.id, judgeProfile: judge.id,
    judgeProtocol: "invented-test-protocol", devData, devContexts: { context: contexts }, scorerTemplates };
  writeFileSync(join(s.dir, "profile.json"), JSON.stringify(profile));
  const plan = { id: "test", hypothesis: "Invented test only", challenger, pool: "screen", targets: { categories: ["temporal_reasoning"], families: 1 },
    guard: { categories: ["abstention"], families: 1 }, maxCalls: 10 };
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan)); writeFileSync(join(dir, "PREREG.md"), "Invented test preregistration.");
  const common = join(import.meta.dir, "../scripts/benchmarks/memory-lab/common.ts");
  const evaluate = (source: string) => {
    const p = Bun.spawnSync([process.execPath, "-e", `const m=await import(${JSON.stringify(common)});${source}`],
      { env: { ...process.env, OH_MEMORY_LAB: s.dir } });
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    return JSON.parse(p.stdout.toString());
  };
  const digest = () => evaluate(`console.log(JSON.stringify({digest:m.frozenExperiment(JSON.parse(await Bun.file(${JSON.stringify(join(dir, "plan.json"))}).text()),"Invented test preregistration."),
    champion:m.armKey(m.champion().arm),challenger:m.armKey(JSON.parse(await Bun.file(${JSON.stringify(join(dir, "plan.json"))}).text()).challenger)}))`);
  writeFileSync(join(dir, "frozen.sha256"), digest().digest + "\n");
  return { ...s, profile, experimentDir: dir, contexts, scorerTemplates, champion, challenger, questions, digest };
}

test("paid frozen plans and cache identities bind model settings, contexts, scorer and both instructions", () => {
  const s = experiment(), initial = s.digest();
  writeFileSync(s.contexts, "changed invented context bytes"); expect(s.digest().digest).not.toBe(initial.digest); expect(s.digest().champion).not.toBe(initial.champion);
  const contextDigest = s.digest().digest;
  writeFileSync(s.scorerTemplates, "changed invented template bytes"); expect(s.digest().digest).not.toBe(contextDigest);
  const scorerDigest = s.digest().digest;
  writeFileSync(join(s.dir, "instructions", "baseline.txt"), "Changed baseline instruction."); expect(s.digest().digest).not.toBe(scorerDigest);
  const instructionDigest = s.digest().digest;
  writeFileSync(join(s.dir, "profile.json"), JSON.stringify({ ...s.profile, api: { ...s.config, judge: { ...judge, maximumOutput: 1024 } } }));
  expect(s.digest().digest).not.toBe(instructionDigest);
});

test("paid assessment cannot pass a positive screen after dropping a failed planned pair", () => {
  const s = experiment(), keys = s.digest();
  const cells = s.questions.flatMap((q, i) => [
    { armKey: keys.champion, arm: "baseline", rep: 0, questionId: q.id, category: q.category, status: "scored", score: 0, experiment: "test", at: "2034-05-04" },
    { armKey: keys.challenger, arm: "challenger", rep: 0, questionId: q.id, category: q.category,
      status: i === 0 ? "scored" : "failed", score: i === 0 ? 1 : null, reason: "provider-terminal", experiment: "test", at: "2034-05-04" },
  ]);
  writeFileSync(join(s.dir, "cache", "cells.jsonl"), cells.map(c => JSON.stringify(c)).join("\n") + "\n");
  const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "../scripts/benchmarks/memory-lab/assess.ts"), "test"],
    { env: { ...process.env, OH_MEMORY_LAB: s.dir } });
  expect(p.exitCode).toBe(0);
  const assessment = JSON.parse(readFileSync(join(s.experimentDir, "assessment.json"), "utf8"));
  expect(assessment.decision).toBe("INCOMPLETE"); expect(assessment.ran).toBe(2); expect(assessment.missing).toHaveLength(1);
});

test("assessment rejects post-freeze target selection before it can produce a paid decision", () => {
  const s = experiment(), p = join(s.experimentDir, "plan.json"), plan = JSON.parse(readFileSync(p, "utf8"));
  plan.targets.categories = ["abstention"];
  writeFileSync(p, JSON.stringify(plan));
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../scripts/benchmarks/memory-lab/assess.ts"), "test"],
    { env: { ...process.env, OH_MEMORY_LAB: s.dir } });
  expect(result.exitCode).not.toBe(0); expect(result.stderr.toString()).toContain("changed before assessment");
  expect(existsSync(join(s.experimentDir, "assessment.json"))).toBeFalse();
});
