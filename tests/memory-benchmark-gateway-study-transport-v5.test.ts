import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { GatewayStudyBudget, invokeGatewayStudy, makeGatewayStudyRequest, parseGatewayStudyResponse,
  type GatewayStudyFetcher, type GatewayStudyLedgerEvent, type GatewayStudyPhase, type GatewayStudyRaw }
  from "../scripts/benchmarks/gateway-study-transport-v3";
import { invokeGatewayStudyV5, parseGatewayStudyV5 } from "../scripts/benchmarks/gateway-study-transport-v5";

const partial = "SYNTHETIC_PARTIAL_TEXT_NOT_MEMORY";
function request(phase: GatewayStudyPhase = "extract") {
  return makeGatewayStudyRequest({ phase, messages: [{ role: "system", content: "Extract supported synthetic facts." },
    { role: "user", content: "Casey owns a bicycle." }] });
}
function provider(phase: GatewayStudyPhase = "extract", finish = "length", output = phase === "extract" ? 16_384 : 512) {
  const req = request(phase);
  return { model: req.model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: partial, refusal: null } }],
    usage: { prompt_tokens: 503, completion_tokens: output, total_tokens: 503 + output },
    providerMetadata: { gateway: { routing: { originalModelId: req.model, canonicalSlug: req.model, finalProvider: "openai", resolvedProvider: "openai",
      modelAttemptCount: 1, totalProviderAttemptCount: 1, modelAttempts: [{ canonicalSlug: req.model, success: true, providerAttemptCount: 1,
        providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } };
}
function setup(phase: GatewayStudyPhase = "extract", value: unknown = provider(phase)) {
  const req = request(phase), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }), reservation = budget.reserve(req, "synthetic");
  const body = new TextEncoder().encode(JSON.stringify(value));
  const raw: GatewayStudyRaw = { requestSha256: req.requestSha256, httpStatus: 200, body, bodyComplete: true,
    receivedBytes: body.length, transportError: null };
  return { req, budget, reservation, raw };
}
function parse(value: unknown = provider(), phase: GatewayStudyPhase = "extract") {
  const { req, reservation, raw } = setup(phase, value); return parseGatewayStudyV5(req, reservation, raw);
}
function invoke(options: { phase?: GatewayStudyPhase; fetcher?: GatewayStudyFetcher;
  record?: (event: GatewayStudyLedgerEvent) => Promise<void>; capture?: (raw: GatewayStudyRaw) => Promise<void>; prior?: number } = {}) {
  const req = request(options.phase), events: GatewayStudyLedgerEvent[] = [], captures: GatewayStudyRaw[] = [];
  const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1, priorExposureMicros: options.prior ?? 0 });
  const promise = invokeGatewayStudyV5({ request: req, oidcToken: "synthetic-project-oidc", reservationId: "synthetic", budget,
    record: options.record ?? (async event => { events.push(event); }), capture: options.capture ?? (async raw => { captures.push(raw); }),
    fetcher: options.fetcher ?? (async () => Response.json(provider(options.phase))) });
  return { req, budget, events, captures, promise };
}

describe("Gateway v5 narrow truncation disposition", () => {
  test("authenticates exact-cap extraction but returns no partial text or fabricated snapshot", () => {
    const { req, reservation, raw } = setup(), result = parseGatewayStudyV5(req, reservation, raw);
    expect(result).toMatchObject({ kind: "truncated-extraction", reason: "output-token-limit", finishReason: "length",
      rawSha256: sha256Hex(raw.body), rawBytes: raw.body.length, requestSha256: req.requestSha256,
      usage: { inputTokens: 503, outputTokens: 16_384, tokenRateMicros: 26_416, billedUsd: null },
      identity: { resolvedProviderApiModelId: null, resolvedSnapshot: null, physicalAttemptCount: null } });
    expect(Object.keys(result).sort()).toEqual(["finishReason", "identity", "kind", "rawBytes", "rawSha256", "reason", "requestSha256", "usage"]);
    expect(JSON.stringify(result)).not.toContain(partial); expect(result).not.toHaveProperty("prediction");
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.usage)).toBe(true); expect(Object.isFrozen(result.identity)).toBe(true);
    expect(() => parseGatewayStudyResponse(req, reservation, raw)).toThrow("incomplete or truncated");
  });
  test("preserves every existing completion, refusal and content-filter result exactly", () => {
    for (const phase of ["extract", "reader", "judge"] as const) {
      const values: unknown[] = [provider(phase, "stop", 2)];
      if (phase === "extract") values.push(
        { ...provider(phase, "stop", 2), choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{", refusal: null } }] },
        { ...provider(phase, "stop", 2), choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: null, refusal: "Synthetic refusal" } }] },
        { ...provider(phase, "content_filter", 2), choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: "partial" } }] });
      for (const value of values) {
        const { req, reservation, raw } = setup(phase, value);
        const old = parseGatewayStudyResponse(req, reservation, raw), next = parseGatewayStudyV5(req, reservation, raw);
        expect(next).toEqual(old); expect(JSON.stringify(next)).toBe(JSON.stringify(old));
      }
    }
  });
  test("reader/judge length and nonexact extraction output counts remain fatal", () => {
    for (const phase of ["reader", "judge"] as const) expect(() => parse(provider(phase), phase)).toThrow("outside the exact-cap extraction policy");
    for (const output of [0, 16_383, 16_385]) expect(() => parse(provider("extract", "length", output))).toThrow();
    for (const finish of ["unknown", "error", "tool_calls", ""]) expect(() => parse(provider("extract", finish))).toThrow("incomplete or truncated");
    const base = provider();
    for (const message of [{ role: "assistant", content: partial, refusal: "conflicting refusal" },
      { role: "assistant", content: {}, refusal: null }, { role: "assistant", content: partial, tool_calls: [{ id: "unexpected" }] }]) {
      expect(() => parse({ ...base, choices: [{ index: 0, finish_reason: "length", message }] })).toThrow();
    }
  });
  test("unknown identity, usage, costs and incomplete transport never become truncation outcomes", () => {
    const base = provider(), gateway = base.providerMetadata.gateway;
    for (const value of [{ ...base, model: "openai/gpt-4o" }, { ...base, providerMetadata: undefined },
      { ...base, providerMetadata: { gateway: { routing: { ...gateway.routing, finalProvider: "azure" } } } },
      { ...base, usage: undefined }, { ...base, usage: { ...base.usage, total_tokens: 1 } },
      ...["1000", "NaN", -1].map(cost => ({ ...base, providerMetadata: { gateway: { ...gateway, cost } } }))]) {
      expect(() => parse(value)).toThrow();
    }
    const { req, reservation, raw, budget } = setup();
    for (const changed of [{ ...raw, httpStatus: 500 }, { ...raw, bodyComplete: false }, { ...raw, transportError: "body-read" as const },
      { ...raw, receivedBytes: raw.receivedBytes + 1 }, { ...raw, requestSha256: "0".repeat(64) }]) {
      expect(() => parseGatewayStudyV5(req, reservation, changed)).toThrow();
    }
    expect(budget.summary.unresolvedThisRunUsd).toBe(reservation.micros / 1e6);
    expect(() => parseGatewayStudyV5({ ...req, maximumOutput: 32768 }, reservation, raw)).toThrow("request changed");
    expect(() => parseGatewayStudyV5(req, { ...reservation, micros: reservation.micros - 1 }, raw)).toThrow("reservation/request binding");
  });
});

describe("Gateway v5 reuses one durable transport and new-ledger settlement", () => {
  test("awaits reservation and capture before one fetch settlement and replays the same text-free result", async () => {
    const order: string[] = [], captures: GatewayStudyRaw[] = [];
    const run = invoke({ record: async event => { await Promise.resolve(); order.push(event.kind); },
      capture: async raw => { await Promise.resolve(); captures.push({ ...raw, body: raw.body.slice() }); order.push("capture"); raw.body.fill(0); },
      fetcher: async (url, options) => {
        expect(order).toEqual(["reserved"]); order.push("fetch");
        expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions"); expect(options?.redirect).toBe("error");
        expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer synthetic-project-oidc");
        expect(String(options?.body)).not.toContain("synthetic-project-oidc");
        return Response.json(provider());
      } });
    const result = await run.promise;
    expect(order).toEqual(["reserved", "fetch", "capture", "settled"]); expect(captures).toHaveLength(1);
    const replay = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 });
    expect(parseGatewayStudyV5(run.req, replay.reserve(run.req, "synthetic"), captures[0]!)).toEqual(result);
    expect(run.budget.summary.unresolvedThisRunUsd).toBe(0); expect(JSON.stringify(result)).not.toContain(partial);
  });
  test("settles conservative truncated usage only in the new ledger while retaining inherited reserves", async () => {
    const oldExposure = 809_209, run = invoke({ prior: oldExposure });
    const result = await run.promise;
    expect(run.events.map(event => event.kind)).toEqual(["reserved", "settled"]);
    expect(run.events[1]!.micros).toBe(26_416);
    expect(run.budget.summary).toMatchObject({ priorAmendmentExposureUsd: oldExposure / 1e6,
      confirmedThisRunUsd: 0.026416, accountedUsd: (oldExposure + result.usage.micros) / 1e6 });
    const base = provider();
    const more = invoke({ fetcher: async () => Response.json({ ...base, providerMetadata: {
      gateway: { ...base.providerMetadata.gateway, cost: "0.027" } } }) });
    expect((await more.promise).usage.micros).toBe(27_000); expect(more.events[1]!.micros).toBe(27_000);
  });
  test("failed durable callbacks never cause retries or release the full reservation", async () => {
    for (const failure of ["reserve", "capture", "settle"] as const) {
      let calls = 0;
      const run = invoke({ record: async event => { if (event.kind === (failure === "reserve" ? "reserved" : "settled") && failure !== "capture") throw new Error("synthetic disk failure"); },
        capture: async () => { if (failure === "capture") throw new Error("synthetic disk failure"); },
        fetcher: async () => { calls++; return Response.json(provider()); } });
      await expect(run.promise).rejects.toThrow("synthetic disk failure");
      expect(calls).toBe(failure === "reserve" ? 0 : 1); expect(run.budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
    }
  });
  test("network/HTTP and out-of-policy length failures retain captured evidence without settlement", async () => {
    for (const failure of ["network", "http", "reader-length"] as const) {
      let calls = 0; const run = invoke({ phase: failure === "reader-length" ? "reader" : "extract", fetcher: async () => {
        calls++; if (failure === "network") throw new Error("synthetic network failure");
        return Response.json(provider(failure === "reader-length" ? "reader" : "extract"), { status: failure === "http" ? 503 : 200 });
      } });
      await expect(run.promise).rejects.toThrow(); expect(calls).toBe(1); expect(run.captures).toHaveLength(1);
      expect(run.events.map(event => event.kind)).toEqual(["reserved"]); expect(run.budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
    }
  });
  test("the original invoker still rejects exact-cap length and never adopts the new policy", async () => {
    const req = request(), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }), events: GatewayStudyLedgerEvent[] = [];
    const before = canonicalSha256(req);
    await expect(invokeGatewayStudy({ request: req, oidcToken: "synthetic-project-oidc", reservationId: "synthetic", budget,
      record: async event => { events.push(event); }, capture: async () => {}, fetcher: async () => Response.json(provider()) })).rejects.toThrow("incomplete or truncated");
    expect(events.map(event => event.kind)).toEqual(["reserved"]); expect(canonicalSha256(req)).toBe(before);
  });
});
