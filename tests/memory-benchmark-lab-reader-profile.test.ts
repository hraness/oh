import { describe, expect, test } from "bun:test";
import { LAB_GPT5_MINI_MEDIUM_READER_PROFILE, makeLabGpt5MiniReaderRequest, parseLabGpt5MiniReaderResponse, reserveLabGpt5MiniReader, type LabReaderRaw } from "../scripts/benchmarks/lab-reader-profile";

const request = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "What happened?" }]);
const reservation = reserveLabGpt5MiniReader(request, "canary_1");
function raw(value: unknown, changes: Partial<LabReaderRaw> = {}): LabReaderRaw {
  const body = new TextEncoder().encode(JSON.stringify(value));
  return { requestSha256: request.requestSha256, httpStatus: 200, body, bodyComplete: true, receivedBytes: body.byteLength, transportError: null, ...changes };
}
function response(overrides: Record<string, unknown> = {}) {
  return { model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "The fact." } }],
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, prompt_tokens_details: { cached_tokens: 2 } },
    providerMetadata: { gateway: { cost: "0.00001", routing: { finalProvider: "openai", originalModelId: "openai/gpt-5-mini", canonicalSlug: "openai/gpt-5-mini", resolvedProviderApiModelId: "gpt-5-mini" } } }, ...overrides };
}

describe("lab GPT-5 mini reader profile", () => {
  test("builds the documented bounded non-streaming request without temperature", () => {
    expect(request.body).toEqual({ model: "openai/gpt-5-mini", messages: [{ role: "system", content: "Use memory." }, { role: "user", content: "What happened?" }], stream: false, store: false, max_tokens: 2048, reasoning: { effort: "minimal" }, providerOptions: { gateway: { only: ["openai"], order: ["openai"] } } });
    expect("temperature" in request.body).toBeFalse();
    expect(reservation.micros).toBeGreaterThanOrEqual(4096);
  });
  test("keeps the minimal request as the default and makes medium an explicit 8192-token profile", () => {
    const defaultRequest = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "What happened?" }]);
    const medium = makeLabGpt5MiniReaderRequest(defaultRequest.body.messages, { profile: "medium" });
    const mediumReservation = reserveLabGpt5MiniReader(medium, "medium_1");
    expect(defaultRequest).toEqual(request);
    expect(medium).toMatchObject({ protocol: LAB_GPT5_MINI_MEDIUM_READER_PROFILE, maximumOutput: 8192,
      body: { model: "openai/gpt-5-mini", max_tokens: 8192, reasoning: { effort: "medium" }, stream: false, store: false,
        providerOptions: { gateway: { only: ["openai"], order: ["openai"] } } } });
    expect(medium.profileSha256).not.toBe(request.profileSha256);
    expect(medium.requestSha256).not.toBe(request.requestSha256);
    expect(mediumReservation.maximumOutput).toBe(8192);
    expect(mediumReservation.micros).toBeGreaterThanOrEqual(16_384);
  });
  test("binds profile identity, effort, and cap through canonical request, reservation, and parsing", () => {
    const medium = makeLabGpt5MiniReaderRequest(request.body.messages, { profile: "medium" });
    const mediumReservation = reserveLabGpt5MiniReader(medium, "medium_2");
    const mediumBody = new TextEncoder().encode(JSON.stringify(response({ usage: { prompt_tokens: 12, completion_tokens: 8000, total_tokens: 8012 } })));
    const mediumRaw: LabReaderRaw = { requestSha256: medium.requestSha256, httpStatus: 200, body: mediumBody, bodyComplete: true, receivedBytes: mediumBody.byteLength, transportError: null };
    expect(parseLabGpt5MiniReaderResponse(medium, mediumReservation, mediumRaw)).toMatchObject({ kind: "completed", usage: { outputTokens: 8000 } });
    const changedEffort = structuredClone(medium) as { body: { reasoning: { effort: string } } };
    changedEffort.body.reasoning.effort = "minimal";
    expect(() => reserveLabGpt5MiniReader(changedEffort as typeof medium, "medium_3")).toThrow("request changed");
    const changedCap = structuredClone(medium) as { maximumOutput: number; body: { max_tokens: number } };
    changedCap.maximumOutput = 2048; changedCap.body.max_tokens = 2048;
    expect(() => reserveLabGpt5MiniReader(changedCap as typeof medium, "medium_4")).toThrow("request changed");
    expect(() => makeLabGpt5MiniReaderRequest(request.body.messages, { profile: "high" as "medium" })).toThrow("unknown profile");
  });
  test("parses a compatible completed response and retains raw metadata", () => {
    const result = parseLabGpt5MiniReaderResponse(request, reservation, raw(response()));
    expect(result).toMatchObject({ kind: "completed", prediction: "The fact.", raw: { httpStatus: 200 }, identity: { finalProvider: "openai" }, usage: { outputTokens: 7 } });
  });
  test("returns an unscorable terminal result for length while retaining usage and raw evidence", () => {
    const payload = response(); (payload.choices[0] as Record<string, unknown>).finish_reason = "length";
    const result = parseLabGpt5MiniReaderResponse(request, reservation, raw(payload));
    expect(result).toMatchObject({ kind: "terminal", reason: "length", prediction: null, raw: { httpStatus: 200 }, usage: { outputTokens: 7 } });
  });
  test("rejects malformed, untrusted, over-cap, and failed outcomes", () => {
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, { ...raw(response()), body: new Uint8Array([0xff]), receivedBytes: 1 })).toThrow("malformed");
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, raw(response({ model: "gpt-4o" })))).toThrow("model or provider");
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, raw(response({ providerMetadata: { gateway: { routing: { finalProvider: "anthropic", originalModelId: "openai/gpt-5-mini", canonicalSlug: "openai/gpt-5-mini" } } } })))).toThrow("model or provider");
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, raw(response({ usage: { prompt_tokens: 1, completion_tokens: 2049, total_tokens: 2050 } })))).toThrow("usage or cap");
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, raw(response({ providerMetadata: { gateway: { cost: "not-a-cost", routing: { finalProvider: "openai", originalModelId: "openai/gpt-5-mini", canonicalSlug: "openai/gpt-5-mini" } } } })))).toThrow("Gateway cost");
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, raw(response({ choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: "" } }] })))).toThrow("failed or empty");
  });
  test("rejects a syntactically shaped but impossible reported snapshot", () => {
    const payload = response({ model: "gpt-5-mini-2025-99-99" });
    const metadata = (payload.providerMetadata as Record<string, unknown>);
    (((metadata.gateway as Record<string, unknown>).routing as Record<string, unknown>).resolvedProviderApiModelId = "gpt-5-mini-2025-99-99");
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, raw(payload))).toThrow("model or provider");
  });
  test("rejects reasoning-token detail that exceeds the declared completion total", () => {
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, raw(response({ usage: {
      prompt_tokens: 12, completion_tokens: 7, total_tokens: 19,
      completion_tokens_details: { reasoning_tokens: 8 },
    } })))).toThrow("usage or cap");
  });
  test("validates Gateway cost from the metadata copy used for routing", () => {
    const payload = response();
    const metadata = payload.providerMetadata;
    delete (payload as { providerMetadata?: unknown }).providerMetadata;
    const message = ((payload.choices as Array<Record<string, unknown>>)[0]!.message as Record<string, unknown>);
    message.providerMetadata = { ...(metadata as Record<string, unknown>), gateway: {
      ...((metadata as Record<string, unknown>).gateway as Record<string, unknown>), cost: "not-a-cost",
    } };
    expect(() => parseLabGpt5MiniReaderResponse(request, reservation, raw(payload))).toThrow("Gateway cost");
  });
  test("uses the Gateway catalog's $0.03 per million cached-input rate", () => {
    const result = parseLabGpt5MiniReaderResponse(request, reservation, raw(response({ usage: {
      prompt_tokens: 200, completion_tokens: 0, total_tokens: 200, prompt_tokens_details: { cached_tokens: 200 },
    } })));
    expect(result.usage.tokenRateMicros).toBe(6);
  });
});
