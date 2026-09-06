import { describe, expect, test } from "bun:test";

import { answerMessages, callOpenAI, ledgerExposure, PilotBudget, PILOT_MAX_USD, validatePaidAccess } from "../scripts/benchmarks/model";
import { EXTRACTION_SCHEMA } from "../scripts/benchmarks/units";

const model = "gpt-4.1-mini-2025-04-14" as const;
const messages = [{ role: "user", content: "What color?" }] as const;

function response(overrides: Record<string, unknown> = {}) {
  return Response.json({ model, choices: [{ finish_reason: "stop", message: { content: "purple" } }],
    usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22, prompt_tokens_details: { cached_tokens: 5 } }, ...overrides });
}

describe("paid pilot boundaries", () => {
  test("rejects missing, unlimited, non-finite, or oversized budgets", () => {
    for (const maxUsd of [NaN, Infinity, 0, -1, PILOT_MAX_USD + 0.01]) {
      expect(() => new PilotBudget({ maxUsd, maxCalls: 2 })).toThrow();
    }
    expect(() => new PilotBudget({ maxUsd: 10, maxCalls: NaN })).toThrow();
    expect(() => new PilotBudget({ maxUsd: 10, maxCalls: 0 })).toThrow();
  });

  test("retains prior spending when an explicitly bounded follow-up ceiling is used", () => {
    const budget = new PilotBudget({ maxUsd: 13, maxCalls: 1, priorExposureMicros: 12_999_990 });
    expect(() => budget.reserve(20, model, 20)).toThrow("budget exhausted");
    expect(budget.summary.reservedCalls).toBe(0);
    expect(budget.summary.priorExposureUsd).toBe(12.99999);
  });

  test("enforces the amended ceiling without resetting prior exposure", () => {
    const budget = new PilotBudget({ maxUsd: PILOT_MAX_USD, maxCalls: 1, priorExposureMicros: 62_248_760 });
    expect(() => budget.reserve(20, model, 20)).toThrow("budget exhausted");
    expect(budget.summary.capUsd).toBe(62.248769);
    expect(budget.summary.priorExposureUsd).toBe(62.24876);
    expect(budget.summary.reservedCalls).toBe(0);
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

  test("routes the pinned snapshot through Gateway with OIDC and an OpenAI-only filter", async () => {
    const budget = new PilotBudget({ maxUsd: 1, maxCalls: 1 });
    const events: unknown[] = [];
    const result = await callOpenAI({ apiKey: "benchmark-oidc-value", provider: "vercel-gateway",
      model, messages, budget, seed: 17, record: async (event) => { events.push(event); },
      fetcher: (async (url, options) => {
        expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
        expect(options?.redirect).toBe("error");
        const body = JSON.parse(String(options?.body));
        expect(body).toMatchObject({ model: `openai/${model}`, max_tokens: 256,
          providerOptions: { gateway: { only: ["openai"], order: ["openai"] } } });
        expect(body).not.toHaveProperty("models");
        expect(String(options?.body)).not.toContain("benchmark-oidc-value");
        return response({ model: `openai/${model}`, providerMetadata: { gateway: { cost: "0.00002",
          routing: { finalProvider: "openai", resolvedProviderApiModelId: model } } } });
      }) as typeof fetch });
    expect(result.reportedModel).toBe(`openai/${model}`);
    expect(result.usage).toMatchObject({ micros: 20, gatewayReportedMicros: 20 });
    expect(ledgerExposure(events)).toBe(20);
    expect(JSON.stringify(events)).not.toContain("benchmark-oidc-value");
  });

  test("opts into JSON-object transport on either provider without changing prompts or defaults", async () => {
    for (const provider of ["openai", "vercel-gateway"] as const) {
      const budget = new PilotBudget({ maxUsd: 1, maxCalls: 2 });
      const calls: Record<string, unknown>[] = [];
      const fetcher = (async (_url, options) => {
        calls.push(JSON.parse(String(options?.body)));
        return response({ choices: [{ finish_reason: "stop", message: { content: '{"units":[]}' } }] });
      }) as typeof fetch;
      const plain = await callOpenAI({ apiKey: "benchmark-test-value", provider, model, messages, budget, seed: 17, fetcher });
      const json = await callOpenAI({ apiKey: "benchmark-test-value", provider, model, messages, budget, seed: 17, fetcher,
        responseFormat: "json_object" });
      expect(calls).toHaveLength(2);
      expect(calls[0]).not.toHaveProperty("response_format");
      expect(calls[1]).toEqual({ ...calls[0], response_format: { type: "json_object" } });
      expect(calls[1]!.messages).toEqual(messages);
      expect(json.prediction).toBe('{"units":[]}');
      expect(json.requestSha256).not.toBe(plain.requestSha256);
      expect(budget.summary.unresolvedThisRunUsd).toBe(0);
    }
  });

  test("does not swap OpenAI keys and project OIDC tokens between providers", () => {
    const input = { paid: true, maxUsd: 1, maxCalls: 1, reader: model };
    const environment = { OPENAI_API_KEY: "direct-test-value", VERCEL_OIDC_TOKEN: "oidc-test-value" };
    expect(validatePaidAccess(input, environment).apiKey).toBe("direct-test-value");
    expect(validatePaidAccess({ ...input, provider: "vercel-gateway" }, environment).apiKey).toBe("oidc-test-value");
    expect(() => validatePaidAccess({ ...input, provider: "vercel-gateway" }, { OPENAI_API_KEY: "direct-test-value" }))
      .toThrow("VERCEL_OIDC_TOKEN");
    expect(() => validatePaidAccess(input, { VERCEL_OIDC_TOKEN: "oidc-test-value" })).toThrow("OPENAI_API_KEY");
    expect(() => validatePaidAccess({ ...input, provider: "arbitrary-endpoint" }, environment)).toThrow("provider");
  });

  test("sends the fixed strict extraction schema and reserves its input overhead on either provider", async () => {
    for (const provider of ["openai", "vercel-gateway"] as const) {
      const budget = new PilotBudget({ maxUsd: 1, maxCalls: 1 });
      const events: { kind: string; micros: number }[] = [];
      await callOpenAI({ apiKey: "benchmark-test-value", provider, model, messages, budget, seed: 17,
        responseFormat: "memory_units_v1", record: async (event) => { events.push(event); },
        fetcher: (async (_url, options) => {
          const body = JSON.parse(String(options?.body));
          const format = { type: "json_schema", json_schema: { name: "oh_memory_units_v1", strict: true, schema: EXTRACTION_SCHEMA } };
          expect(body.response_format).toEqual(format);
          expect(body.messages).toEqual(messages);
          const expected = new PilotBudget({ maxUsd: 1, maxCalls: 1 }).reserve(
            Buffer.byteLength(JSON.stringify(messages)) + Buffer.byteLength(JSON.stringify(format)), model, 256);
          expect(events[0]).toMatchObject({ kind: "reserved", micros: expected.micros });
          expect(EXTRACTION_SCHEMA.properties.units.maxItems).toBe(48);
          expect(EXTRACTION_SCHEMA.properties.units.items.properties.supports.maxItems).toBe(3);
          return response();
        }) as typeof fetch });
      expect(budget.summary.unresolvedThisRunUsd).toBe(0);
    }
  });

  test("supports an explicitly selected Gateway alias without claiming a snapshot pin", async () => {
    const gatewayModel = "openai/gpt-4.1-mini" as const;
    const result = await callOpenAI({ apiKey: "benchmark-oidc-value", provider: "vercel-gateway", model: gatewayModel,
      messages, budget: new PilotBudget({ maxUsd: 1, maxCalls: 1 }), seed: 17,
      fetcher: (async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        expect(body.model).toBe(gatewayModel);
        expect(body).not.toHaveProperty("seed");
        return response({ model: gatewayModel });
      }) as typeof fetch });
    expect(result.reportedModel).toBe(gatewayModel);
    expect(result.snapshotPinned).toBe(false);
    expect(() => validatePaidAccess({ paid: true, reader: gatewayModel, maxUsd: 1, maxCalls: 1 },
      { OPENAI_API_KEY: "direct-test-value" })).toThrow("Gateway");
  });

  test("accepts a Gateway family label only when routing proves the exact upstream snapshot", async () => {
    const result = await callOpenAI({ apiKey: "benchmark-oidc-value", provider: "vercel-gateway", model, messages,
      budget: new PilotBudget({ maxUsd: 1, maxCalls: 1 }), seed: 17,
      fetcher: (async () => response({ model: "openai/gpt-4.1-mini", providerMetadata: { gateway: {
        routing: { finalProvider: "openai", resolvedProviderApiModelId: model },
      } } })) as typeof fetch });
    expect(result.modelEvidence).toBe("gateway-routing");
    expect(result.reportedModel).toBe("openai/gpt-4.1-mini");
  });

  test("refuses a Gateway response with an unpinned model or a different provider", async () => {
    for (const overrides of [{ model: "openai/gpt-4.1-mini" }, { model: `openai/${model}`,
      providerMetadata: { gateway: { routing: { finalProvider: "azure" } } } }]) {
      const budget = new PilotBudget({ maxUsd: 1, maxCalls: 1 });
      await expect(callOpenAI({ apiKey: "benchmark-oidc-value", provider: "vercel-gateway", model, messages,
        budget, seed: 17, fetcher: (async () => response(overrides)) as typeof fetch })).rejects.toThrow();
      expect(budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
    }
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

  test("reports safe provider parameter diagnostics without echoing error payloads", async () => {
    let failure: unknown;
    try {
      await callOpenAI({ apiKey: "benchmark-test-value", model, messages,
        budget: new PilotBudget({ maxUsd: 1, maxCalls: 1 }), seed: 17,
        fetcher: (async () => Response.json({ error: { code: "integer_below_minimum", param: "max_output_tokens",
          message: "Invalid max_output_tokens. Expected a value >= 16. benchmark-test-value" } }, { status: 400 })) as typeof fetch });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("max_output_tokens");
    expect((failure as Error).message).toContain("minimum=16");
    expect((failure as Error).message).not.toContain("benchmark-test-value");
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

  test("retains verified usage on a clipped completion instead of losing its cost", async () => {
    const budget = new PilotBudget({ maxUsd: 1, maxCalls: 1 });
    await expect(callOpenAI({ apiKey: "benchmark-test-value", model, messages, budget, seed: 17,
      fetcher: (async () => response({ choices: [{ finish_reason: "length", message: { content: "partial answer" } }] })) as typeof fetch }))
      .rejects.toMatchObject({ usage: { inputTokens: 20, outputTokens: 2, micros: 10 } });
    expect(budget.summary.confirmedThisRunUsd).toBe(0.00001);
    expect(budget.summary.unresolvedThisRunUsd).toBe(0);
  });

  test("reserves and enforces an explicit completion-token bound", async () => {
    let calls = 0;
    const fetcher = (async (_url, options) => {
      calls += 1;
      expect(JSON.parse(String(options?.body)).max_completion_tokens).toBe(512);
      return response();
    }) as typeof fetch;
    await callOpenAI({ apiKey: "benchmark-test-value", model, messages, maximumOutput: 512,
      budget: new PilotBudget({ maxUsd: 1, maxCalls: 1 }), seed: 17, fetcher });
    await expect(callOpenAI({ apiKey: "benchmark-test-value", model, messages, maximumOutput: 8_193,
      budget: new PilotBudget({ maxUsd: 1, maxCalls: 1 }), seed: 17, fetcher })).rejects.toThrow();
    await expect(callOpenAI({ apiKey: "benchmark-oidc-value", provider: "vercel-gateway", model, messages,
      maximumOutput: 10, budget: new PilotBudget({ maxUsd: 1, maxCalls: 1 }), seed: 17, fetcher })).rejects.toThrow("at least 16");
    expect(calls).toBe(1);
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
