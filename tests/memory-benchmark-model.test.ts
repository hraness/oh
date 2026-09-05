import { describe, expect, test } from "bun:test";

import { answerMessages, callOpenAI, ledgerExposure, PilotBudget } from "../scripts/benchmarks/model";

const model = "gpt-4.1-mini-2025-04-14" as const;
const messages = [{ role: "user", content: "What color?" }] as const;

function response(overrides: Record<string, unknown> = {}) {
  return Response.json({ model, choices: [{ finish_reason: "stop", message: { content: "purple" } }],
    usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22, prompt_tokens_details: { cached_tokens: 5 } }, ...overrides });
}

describe("paid pilot boundaries", () => {
  test("rejects missing, unlimited, non-finite, or oversized budgets", () => {
    for (const maxUsd of [NaN, Infinity, 0, -1, 10.01]) {
      expect(() => new PilotBudget({ maxUsd, maxCalls: 2 })).toThrow();
    }
    expect(() => new PilotBudget({ maxUsd: 10, maxCalls: NaN })).toThrow();
    expect(() => new PilotBudget({ maxUsd: 10, maxCalls: 0 })).toThrow();
  });

  test("reserves worst-case cost before dispatch and accounts for prior run exposure", () => {
    const budget = new PilotBudget({ maxUsd: 0.01, maxCalls: 2, priorExposureMicros: 9_500 });
    expect(() => budget.reserve(2_000, model, 256)).toThrow("budget exhausted");
    expect(budget.summary.reservedCalls).toBe(0);
    const calls = new PilotBudget({ maxUsd: 1, maxCalls: 1 });
    calls.reserve(20, model, 20);
    expect(() => calls.reserve(20, model, 20)).toThrow("budget exhausted");
  });

  test("accepts a bounded completion, counts cached tokens, and never sends labels", async () => {
    const budget = new PilotBudget({ maxUsd: 1, maxCalls: 1 });
    const events: unknown[] = [];
    const question = { question: "What color?", questionDate: "2026-01-01", answer: "GOLD_SENTINEL",
      evidenceTurnIds: ["EVIDENCE_SENTINEL"], unanswerable: true };
    const generated = answerMessages(question, "Ada owns a purple bicycle.");
    expect(JSON.stringify(generated)).not.toContain("SENTINEL");
    expect(JSON.stringify(generated)).not.toContain("unanswerable");
    let calls = 0;
    const result = await callOpenAI({ apiKey: "benchmark-test-value", model, messages: generated, budget, seed: 17,
      record: async (event) => { events.push(event); },
      fetcher: (async (url, options) => {
        calls += 1;
        expect(url).toBe("https://api.openai.com/v1/chat/completions");
        expect(options?.redirect).toBe("error");
        expect(JSON.parse(String(options?.body))).toMatchObject({ model, temperature: 0, max_completion_tokens: 256, store: false });
        return response();
      }) as typeof fetch });
    expect(calls).toBe(1);
    expect(result.prediction).toBe("purple");
    expect(result.usage).toMatchObject({ inputTokens: 20, cachedInputTokens: 5, outputTokens: 2, micros: 10 });
    expect(budget.summary.unresolvedThisRunUsd).toBe(0);
    expect(ledgerExposure(events)).toBe(10);
    expect(JSON.stringify(events)).not.toContain("benchmark-test-value");
  });

  test("retains unknown charges, sanitizes provider failures, and never retries", async () => {
    const budget = new PilotBudget({ maxUsd: 1, maxCalls: 2 });
    let calls = 0;
    await expect(callOpenAI({ apiKey: "benchmark-test-value", model, messages, budget, seed: 17,
      fetcher: (async () => {
        calls += 1;
        return new Response("provider echoed benchmark-test-value", { status: 401 });
      }) as typeof fetch })).rejects.toThrow("Provider HTTP 401");
    expect(calls).toBe(1);
    expect(budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
    expect(budget.summary.confirmedThisRunUsd).toBe(0);
  });

  test("rejects missing usage and truncated or mismatched model results", async () => {
    for (const overrides of [{ usage: null }, { model: "other-model" }, {
      choices: [{ finish_reason: "length", message: { content: "partial answer" } }],
    }]) {
      const budget = new PilotBudget({ maxUsd: 1, maxCalls: 1 });
      await expect(callOpenAI({ apiKey: "benchmark-test-value", model, messages, budget, seed: 17,
        fetcher: (async () => response(overrides)) as typeof fetch })).rejects.toThrow();
      if (Object.hasOwn(overrides, "model") || Object.hasOwn(overrides, "usage")) {
        expect(budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
      }
    }
  });

  test("does not call a provider without a key or if durable reservation fails", async () => {
    let calls = 0;
    const fetcher = (async () => { calls += 1; return response(); }) as typeof fetch;
    await expect(callOpenAI({ apiKey: "", model, messages, seed: 17, fetcher,
      budget: new PilotBudget({ maxUsd: 1, maxCalls: 1 }) })).rejects.toThrow("OPENAI_API_KEY");
    await expect(callOpenAI({ apiKey: "benchmark-test-value", model, messages, seed: 17, fetcher,
      budget: new PilotBudget({ maxUsd: 1, maxCalls: 1 }), record: async () => { throw new Error("ledger failure"); } }))
      .rejects.toThrow("ledger failure");
    expect(calls).toBe(0);
  });

  test("counts unresolved ledger requests across runs and rejects forged settlements", () => {
    const reserved = { v: 1, id: "request-a", kind: "reserved", micros: 1_000 };
    expect(ledgerExposure([reserved])).toBe(1_000);
    expect(ledgerExposure([reserved, { ...reserved, kind: "settled", micros: 200 }])).toBe(200);
    expect(() => ledgerExposure([reserved, reserved])).toThrow();
    expect(() => ledgerExposure([{ ...reserved, kind: "settled" }])).toThrow();
    expect(() => ledgerExposure([reserved, { ...reserved, kind: "settled", micros: 2_000 }])).toThrow();
  });
});
