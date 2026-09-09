import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { EVOLUTION_GATEWAY_ENDPOINT, EVOLUTION_OPENAI_ENDPOINT, EVOLUTION_PROFILES, EVOLUTION_RESPONSE_MAX_BYTES,
  makeEvolutionRequest, parseEvolutionResponse, validateEvolutionRequest, type EvolutionProfileId,
  type EvolutionRequest } from "../scripts/benchmarks/evolution-model";

const messages = [{ role: "system" as const, content: "Use supplied memory only." }, { role: "user" as const, content: "Which color?" }];
const directJudgeMessages = [{ role: "user" as const, content: "Evaluate this LongMemEval answer exactly as instructed." }];
const raw = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function response(request: EvolutionRequest) {
  return { model: request.model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "  Blue.  " } }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 2 } },
    ...(request.endpoint === EVOLUTION_GATEWAY_ENDPOINT ? { providerMetadata: { gateway: { routing: {
      finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model,
      resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1),
    } } } } : {}) };
}
function mutate(value: unknown, change: (copy: Record<string, any>) => void): Uint8Array {
  const copy = structuredClone(value) as Record<string, any>;
  change(copy);
  return raw(copy);
}
const mini = makeEvolutionRequest("gpt5-mini-reader", messages);

describe("memory evolution model contracts", () => {
  test("all profiles construct frozen distinct canonical requests and parse matching identity", () => {
    const ids = Object.keys(EVOLUTION_PROFILES) as EvolutionProfileId[];
    const hashes = new Set<string>();
    for (const id of ids) {
      const prompt = id === "gpt4o-official-snapshot-judge" ? directJudgeMessages : messages;
      const request = makeEvolutionRequest(id, prompt), bytes = raw(response(request));
      const result = parseEvolutionResponse(bytes, request);
      expect(validateEvolutionRequest(structuredClone(request))).toEqual(request);
      expect(result).toMatchObject({ answer: "Blue.", partialAnswer: "Blue.", status: "completed", failureReason: null,
        rawSha256: sha256Hex(bytes), requestSha256: request.requestSha256, profileSha256: request.profileSha256,
        usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 20, reasoningTokens: 2 } });
      expect(request.profileSha256).toBe(canonicalSha256(EVOLUTION_PROFILES[id]));
      expect(Object.isFrozen(request.body.messages[0])).toBeTrue();
      expect(result.usage.micros).toBeLessThanOrEqual(request.reservationMicros);
      hashes.add(request.requestSha256);
    }
    expect(hashes.size).toBe(ids.length);
    expect(mini.body).toMatchObject({ reasoning: { effort: "medium" }, max_tokens: 8192,
      providerOptions: { gateway: { only: ["openai"], order: ["openai"] } } });
    expect("temperature" in mini.body).toBeFalse();
    for (const id of ["qwen37-flash-reader", "gemini25-flash-lite-reader"] as const) {
      expect(makeEvolutionRequest(id, messages).body.reasoning).toEqual({ effort: "none" });
    }
    expect(makeEvolutionRequest("gpt4o-gateway-judge", messages).body.max_tokens).toBe(16);
    const direct = makeEvolutionRequest("gpt4o-official-snapshot-judge", directJudgeMessages);
    expect(direct.body).toMatchObject({ max_tokens: 10, messages: directJudgeMessages });
    expect(direct.body.providerOptions).toBeUndefined();
  });

  test("request digest rejects treatment, price, provider, and reservation transplant", () => {
    for (const change of [
      (r: Record<string, any>) => { r.body.reasoning.effort = "low"; },
      (r: Record<string, any>) => { r.reservationMicros++; },
      (r: Record<string, any>) => { r.body.providerOptions.gateway.only = ["azure"]; },
      (r: Record<string, any>) => { r.profileId = "gpt5-nano-reader"; },
      (r: Record<string, any>) => { r.profileSha256 = "a".repeat(64); },
      (r: Record<string, any>) => { r.extra = true; },
    ]) {
      const altered = structuredClone(mini); change(altered);
      expect(() => parseEvolutionResponse(raw(response(mini)), altered)).toThrow("request changed");
    }
  });

  test("does not truncate contexts or accept malformed prompt data", () => {
    expect(() => makeEvolutionRequest("missing" as EvolutionProfileId, messages)).toThrow("unknown profile");
    expect(() => makeEvolutionRequest("gpt5-mini-reader", [messages[1]!, messages[0]!])).toThrow("prompt shape");
    expect(() => makeEvolutionRequest("gpt5-mini-reader", [messages[0]!, { role: "user", content: "\ud800" }])).toThrow("prompt shape");
    expect(() => makeEvolutionRequest("gpt5-mini-reader", directJudgeMessages)).toThrow("prompt shape");
    expect(() => makeEvolutionRequest("gpt4o-official-snapshot-judge", messages)).toThrow("prompt shape");
    expect(() => makeEvolutionRequest("gpt4o-official-snapshot-judge", [{ role: "system", content: "judge" }])).toThrow("prompt shape");
    expect(() => makeEvolutionRequest("gpt5-mini-reader", [messages[0]!, { role: "user", content: "x".repeat(390_000) }])).toThrow("context bound");
    const supplied = structuredClone(messages), request = makeEvolutionRequest("gpt5-mini-reader", supplied);
    supplied[1]!.content = "changed";
    expect(request.body.messages[1]!.content).toBe("Which color?");
  });

  test("Qwen reserves against the highest reachable input tier including cache write rates", () => {
    const short = makeEvolutionRequest("qwen37-flash-reader", messages);
    expect(short.reservationMicros).toBe(Math.ceil((short.inputUpperBound * 40 + 2048 * 130) / 1000));
    const request = makeEvolutionRequest("qwen37-flash-reader", [messages[0]!, { role: "user", content: "x".repeat(33_000) }]);
    expect(request.inputUpperBound).toBeGreaterThan(32_000);
    expect(request.reservationMicros).toBe(Math.ceil((request.inputUpperBound * 125 + 2048 * 400) / 1000));
    for (const [input, rate] of [[31_999, 30], [32_000, 100]] as const) {
      const parsed = parseEvolutionResponse(mutate(response(request), value => { value.usage = {
        prompt_tokens: input, completion_tokens: 10, total_tokens: input + 10,
      }; }), request);
      expect(parsed.usage.tokenRateMicros).toBe(Math.ceil((input * rate + 10 * (rate === 30 ? 130 : 400)) / 1000));
      expect(parsed.usage.micros).toBeLessThanOrEqual(request.reservationMicros);
    }
    const wide = makeEvolutionRequest("qwen37-flash-reader", [messages[0]!, { role: "user", content: "x".repeat(257_000) }]);
    expect(wide.reservationMicros).toBe(Math.ceil((wide.inputUpperBound * 250 + 2048 * 800) / 1000));
  });

  test("charges reasoning once as part of completion and rounds decimal Gateway cost conservatively", () => {
    const value = response(mini);
    const result = parseEvolutionResponse(raw(value), mini);
    expect(result.usage.tokenRateMicros).toBe(41); // 80*.25 + 20*.025 + 10*2 = 40.5 microdollars.
    expect(parseEvolutionResponse(mutate(value, v => { v.providerMetadata.gateway.cost = "0.000050000001"; }), mini).usage)
      .toMatchObject({ tokenRateMicros: 41, gatewayReportedMicros: 51, micros: 51 });
    expect(parseEvolutionResponse(mutate(value, v => { v.providerMetadata.gateway.cost = "0.000050000000"; }), mini).usage.micros).toBe(50);
    expect(parseEvolutionResponse(mutate(value, v => { v.providerMetadata.gateway.cost = "0.000001"; }), mini).usage.micros).toBe(41);
  });

  test("preserves paid truncation, refusal, empty, and unexpected tool failures without scoring partial output", () => {
    const cases: ReadonlyArray<readonly [string, string, (v: Record<string, any>) => void]> = [
      ["truncated", "output-token-limit", v => { v.choices[0].finish_reason = "length"; }],
      ["refused", "provider-refusal", v => { v.choices[0].finish_reason = "content_filter"; }],
      ["refused", "provider-refusal", v => { v.choices[0].message.refusal = "Unable."; }],
      ["failed", "empty-or-unsuccessful-completion", v => { v.choices[0].message.content = ""; }],
      ["failed", "unexpected-tool-call", v => { v.choices[0].message.tool_calls = [{ type: "function" }]; }],
    ];
    for (const [status, failureReason, change] of cases) {
      const bytes = mutate(response(mini), change), result = parseEvolutionResponse(bytes, mini);
      expect(result).toMatchObject({ status, failureReason, answer: null, rawSha256: sha256Hex(bytes), usage: { micros: 41 } });
    }
    expect(parseEvolutionResponse(mutate(response(mini), v => { v.choices[0].finish_reason = "length"; }), mini).partialAnswer).toBe("Blue.");
  });

  test("requires consistent complete Gateway routing and compatible valid model dates", () => {
    for (const change of [
      (v: Record<string, any>) => { delete v.providerMetadata; },
      (v: Record<string, any>) => { v.providerMetadata.gateway.routing.finalProvider = "azure"; },
      (v: Record<string, any>) => { v.providerMetadata.gateway.routing.originalModelId = "openai/gpt-5-nano"; },
      (v: Record<string, any>) => { v.providerMetadata.gateway.routing.canonicalSlug = "openai/gpt-5"; },
      (v: Record<string, any>) => { v.model = "anthropic/gpt-5-mini"; },
      (v: Record<string, any>) => { v.model = "gpt-5-mini-2026-02-30"; },
      (v: Record<string, any>) => { v.providerMetadata.gateway.routing.resolvedProviderApiModelId = "gpt-5"; },
      (v: Record<string, any>) => { v.model = "gpt-5-mini-2025-08-07"; v.providerMetadata.gateway.routing.resolvedProviderApiModelId = "gpt-5-mini-2025-08-08"; },
      (v: Record<string, any>) => { v.provider_metadata = structuredClone(v.providerMetadata); v.provider_metadata.gateway.cost = "0.001"; },
    ]) expect(() => parseEvolutionResponse(mutate(response(mini), change), mini)).toThrow();
    const bytes = mutate(response(mini), v => {
      v.choices[0].message.provider_metadata = v.providerMetadata;
      delete v.providerMetadata;
    });
    expect(parseEvolutionResponse(bytes, mini).status).toBe("completed");
  });

  test("separates official direct snapshot from a Gateway alias that happens to resolve to it", () => {
    const alias = makeEvolutionRequest("gpt4o-gateway-judge", messages);
    const observed = parseEvolutionResponse(mutate(response(alias), v => {
      v.model = "gpt-4o-2024-08-06";
      v.providerMetadata.gateway.routing.resolvedProviderApiModelId = "gpt-4o-2024-08-06";
    }), alias);
    expect(observed.identity).toMatchObject({ snapshotPinned: false, qualification: "gateway-alias", resolvedSnapshot: "gpt-4o-2024-08-06" });
    const direct = makeEvolutionRequest("gpt4o-official-snapshot-judge", directJudgeMessages);
    expect(direct.endpoint).toBe(EVOLUTION_OPENAI_ENDPOINT);
    expect(direct.body.providerOptions).toBeUndefined();
    expect(parseEvolutionResponse(raw(response(direct)), direct).identity).toMatchObject({ snapshotPinned: true, qualification: "official-snapshot-request" });
    expect(() => parseEvolutionResponse(mutate(response(direct), v => { v.model = "gpt-4o"; }), direct)).toThrow("snapshot mismatch");
  });

  test("rejects invalid usage, cost, ambiguous choices and malformed/bounded response bytes", () => {
    for (const change of [
      (v: Record<string, any>) => { v.usage.total_tokens++; },
      (v: Record<string, any>) => { v.usage.prompt_tokens_details.cached_tokens = 101; },
      (v: Record<string, any>) => { v.usage.completion_tokens_details.reasoning_tokens = 11; },
      (v: Record<string, any>) => { v.usage.prompt_tokens = mini.inputUpperBound + 1; v.usage.total_tokens = v.usage.prompt_tokens + 10; },
      (v: Record<string, any>) => { v.usage.completion_tokens = mini.maxOutputTokens + 1; v.usage.total_tokens = 100 + v.usage.completion_tokens; },
      (v: Record<string, any>) => { v.providerMetadata.gateway.cost = "01.5"; },
      (v: Record<string, any>) => { v.providerMetadata.gateway.cost = "1000"; },
      (v: Record<string, any>) => { v.choices.push(v.choices[0]); },
      (v: Record<string, any>) => { v.choices[0].message.content = "\ud800"; },
      (v: Record<string, any>) => { v.usage.prompt_tokens_details = false; },
    ]) expect(() => parseEvolutionResponse(mutate(response(mini), change), mini)).toThrow();
    expect(() => parseEvolutionResponse(new Uint8Array([0xff]), mini)).toThrow("malformed");
    expect(() => parseEvolutionResponse(raw({ choices: [] }), mini)).toThrow("choices");
    expect(() => parseEvolutionResponse(new Uint8Array(EVOLUTION_RESPONSE_MAX_BYTES + 1), mini)).toThrow("byte bound");
    let nested: unknown = {};
    for (let i = 0; i < 40; i++) nested = { nested };
    expect(() => parseEvolutionResponse(raw({ ...response(mini), extra: nested }), mini)).toThrow("structure bound");
  });
});
