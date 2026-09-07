import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { GATEWAY_STUDY_RESPONSE_BYTES, GatewayStudyBudget, gatewayStudyLedgerExposure, invokeGatewayStudy,
  makeGatewayStudyRequest, parseGatewayStudyResponse, type GatewayStudyLedgerEvent, type GatewayStudyPhase,
  type GatewayStudyRaw, type GatewayStudyRequest, type GatewayStudyFetcher } from "../scripts/benchmarks/gateway-study-transport-v3";

const messages = [{ role: "system", content: "Return only the requested facts." }, { role: "user", content: "Synthetic public fixture." }] as const;
function request(phase: GatewayStudyPhase = "extract") { return makeGatewayStudyRequest({ phase, messages }); }
function provider(req = request(), overrides: Record<string, unknown> = {}) {
  const family = req.model.slice(7), snapshot = `${family}-${family === "gpt-4o" ? "2024-08-06" : "2025-04-14"}`;
  return { model: family, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"units":[]}', refusal: null } }],
    usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22, prompt_tokens_details: { cached_tokens: 5 } },
    providerMetadata: { gateway: { cost: "0.00002", routing: { finalProvider: "openai", resolvedProviderApiModelId: snapshot } } },
    ...overrides };
}
function raw(req = request(), value: unknown = provider(req), status = 200): GatewayStudyRaw {
  const body = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  return { requestSha256: req.requestSha256, httpStatus: status, body, bodyComplete: true, receivedBytes: body.length, transportError: null };
}
function parse(value: unknown, phase: GatewayStudyPhase = "extract") {
  const req = request(phase), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 });
  return parseGatewayStudyResponse(req, budget.reserve(req, "job"), raw(req, value));
}
function invocation(options: { phase?: GatewayStudyPhase; fetcher?: GatewayStudyFetcher; record?: (event: GatewayStudyLedgerEvent) => Promise<void>;
  capture?: (raw: GatewayStudyRaw) => Promise<void>; oidcToken?: string } = {}) {
  const req = request(options.phase), events: GatewayStudyLedgerEvent[] = [], captures: GatewayStudyRaw[] = [];
  const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 });
  const promise = invokeGatewayStudy({ request: req, oidcToken: options.oidcToken ?? "synthetic-project-oidc", reservationId: "job", budget,
    record: options.record ?? (async event => { events.push(event); }), capture: options.capture ?? (async capture => { captures.push(capture); }),
    fetcher: options.fetcher ?? (async () => Response.json(provider(req))) as GatewayStudyFetcher });
  return { req, events, captures, budget, promise };
}

describe("Gateway v3 frozen requests and bounded exposure", () => {
  test("freezes phase-specific models, 16K extraction, schemas and one provider", () => {
    for (const phase of ["extract", "reader", "judge"] as const) {
      const req = request(phase);
      expect(req.model).toBe(phase === "judge" ? "openai/gpt-4o" : "openai/gpt-4.1-mini");
      expect(req.maximumOutput).toBe(phase === "extract" ? 16_384 : 512);
      expect(req.timeoutMs).toBe(phase === "extract" ? 300_000 : 120_000);
      expect(req.body.providerOptions.gateway).toEqual({ only: ["openai"], order: ["openai"] });
      expect(req.body.response_format !== undefined).toBe(phase === "extract");
      expect(req.body).not.toHaveProperty("models"); expect(req.body).not.toHaveProperty("tools");
      expect(req.requestSha256).toBe(canonicalSha256({ protocol: req.protocol, phase, endpoint: req.endpoint, body: req.body }));
      expect(Object.isFrozen(req.body.messages)).toBe(true);
    }
  });
  test("snapshots caller messages and rejects malformed or unbounded requests", () => {
    const copied = messages.map(x => ({ ...x, content: String(x.content) })), req = makeGatewayStudyRequest({ phase: "extract", messages: copied });
    copied[1]!.content = "Changed"; expect(req.body.messages[1]!.content).toBe(messages[1].content);
    for (const bad of [[], [{ role: "user", content: "only" }], [{ role: "system", content: "" }, messages[1]],
      [{ ...messages[0], secret: "unexpected" }, messages[1]]]) {
      expect(() => makeGatewayStudyRequest({ phase: "extract", messages: bad as unknown as typeof messages })).toThrow();
    }
    expect(() => makeGatewayStudyRequest({ phase: "judge", messages: [messages[0], { role: "user", content: "x".repeat(128_000) }] })).toThrow("context bound");
  });
  test("enforces independent $40 ceiling and accounts for previous amendment batches", () => {
    for (const maxUsd of [0, -1, NaN, Infinity, 40.000001]) expect(() => new GatewayStudyBudget({ maxUsd, maxCalls: 1 })).toThrow();
    const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1, priorExposureMicros: 39_999_999 });
    expect(() => budget.reserve(request(), "job")).toThrow("budget exhausted");
    expect(budget.summary).toMatchObject({ historicalExposureUsd: 21.655385, priorAmendmentExposureUsd: 39.999999, reservedCalls: 0 });
    expect(() => new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1, priorExposureMicros: 40_000_001 })).toThrow();
  });
  test("does not release exposure for unknown responses or reuse reservation identifiers", () => {
    const req = request(), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 2 }), reservation = budget.reserve(req, "job");
    expect(reservation.inputUpperBound).toBe(req.inputBytes + 2048);
    expect(reservation.micros).toBe(Math.ceil((req.inputBytes + 2048) * .4 + 16_384 * 1.6));
    expect(() => budget.reserve(req, "job")).toThrow("already used");
    expect(() => parseGatewayStudyResponse(req, reservation, raw(req, "broken"))).toThrow();
    expect(budget.summary.unresolvedThisRunUsd).toBe(reservation.micros / 1e6);
  });
  test("native ledger excludes extra fields, negative zero, duplicate and unpaired settlement", () => {
    const events: GatewayStudyLedgerEvent[] = [{ v: 1, id: "a", kind: "reserved", micros: 100 }, { v: 1, id: "a", kind: "settled", micros: 12 }];
    expect(gatewayStudyLedgerExposure(events)).toBe(12);
    for (const invalid of [[{ ...events[0], extra: "context" }], [{ ...events[0], micros: -0 }], [events[1]], [events[0], events[0]],
      [{ ...events[0], micros: 40_000_001 }]]) expect(() => gatewayStudyLedgerExposure(invalid)).toThrow();
  });
  test("ledger replay rejects a transient historical overspend even after full settlement", () => {
    const events: GatewayStudyLedgerEvent[] = [
      { v: 1, id: "a", kind: "reserved", micros: 40_000_000 },
      { v: 1, id: "b", kind: "reserved", micros: 40_000_000 },
      { v: 1, id: "a", kind: "settled", micros: 0 },
      { v: 1, id: "b", kind: "settled", micros: 0 },
    ];
    expect(() => gatewayStudyLedgerExposure(events)).toThrow("historical amendment ledger prefix");
    expect(gatewayStudyLedgerExposure([events[0]!, events[2]!, events[1]!, events[3]!])).toBe(0);
  });
});

describe("Gateway v3 authenticated raw response parsing", () => {
  test("keeps requested aliases separate from returned snapshots and uses conservative cost", () => {
    const result = parse(provider());
    expect(result.kind).toBe("completed");
    expect(result.identity).toMatchObject({ requestedModel: "openai/gpt-4.1-mini", reportedModel: "gpt-4.1-mini",
      resolvedSnapshot: "gpt-4.1-mini-2025-04-14", snapshotPinned: false, physicalAttemptCount: null });
    expect(result.usage).toMatchObject({ tokenRateMicros: 10, gatewayReportedMicros: 20, micros: 20, billedUsd: null });
    const value = provider(); delete (value.providerMetadata.gateway as { cost?: string }).cost;
    expect(parse(value).usage).toMatchObject({ micros: 10, gatewayReportedMicros: null, costBasis: "token-rate-estimate" });
  });
  test("accepts nullable absent tools and cache details without granting a cache discount", () => {
    const base = provider();
    const value = { ...base, choices: [{ ...base.choices[0], message: { ...base.choices[0]!.message, tool_calls: null } }],
      usage: { ...base.usage, prompt_tokens_details: null } };
    expect(parse(value).usage).toMatchObject({ cachedInputTokens: 0, tokenRateMicros: 12, micros: 20 });
    for (const tool_calls of ["", {}, [{ id: "unexpected", type: "function" }]]) {
      expect(() => parse({ ...value, choices: [{ ...value.choices[0], message: { ...value.choices[0]!.message, tool_calls } }] })).toThrow("invalid completion message");
    }
    for (const prompt_tokens_details of ["", [], 0]) {
      expect(() => parse({ ...value, usage: { ...value.usage, prompt_tokens_details } })).toThrow("invalid cached usage details");
    }
  });
  test("authenticates metadata inside the single completion message and rejects conflicting copies", () => {
    const base = provider(), metadata = base.providerMetadata;
    const nested = { ...base, providerMetadata: undefined,
      choices: [{ ...base.choices[0], message: { ...base.choices[0]!.message, provider_metadata: metadata } }] };
    expect(parse(nested).identity).toEqual(parse(base).identity);
    expect(parse(nested).usage).toEqual(parse(base).usage);
    expect(parse({ ...nested, providerMetadata: metadata, provider_metadata: structuredClone(metadata) }).usage.micros).toBe(20);
    const changed = { gateway: { ...metadata.gateway, cost: "0.00003" } };
    expect(() => parse({ ...nested, providerMetadata: changed })).toThrow("conflicting Gateway metadata");
    expect(() => parse({ ...nested, choices: [{ ...nested.choices[0], message: {
      ...nested.choices[0]!.message, providerMetadata: changed } }] })).toThrow("conflicting Gateway metadata");
    for (const invalid of [null, [], { gateway: {} }]) {
      expect(() => parse({ ...nested, choices: [{ ...nested.choices[0], message: {
        ...nested.choices[0]!.message, provider_metadata: invalid } }] })).toThrow("missing authenticated Gateway routing metadata");
    }
  });
  test("reconciles aggregate provider attempt counts with every reported nested count", () => {
    const base = provider(), routing = base.providerMetadata.gateway.routing;
    const value = (totalProviderAttemptCount: unknown, extra: Record<string, unknown> = {}) => ({ ...base,
      providerMetadata: { gateway: { ...base.providerMetadata.gateway, routing: { ...routing, totalProviderAttemptCount, ...extra } } } });
    expect(parse(value(1)).identity).toMatchObject({ reportedProviderAttemptCount: 1, physicalAttemptCount: null });
    for (const total of [0, 2, "1", null, -1]) expect(() => parse(value(total))).toThrow("reported provider attempts");
    const attempt = { modelId: "openai:gpt-4.1-mini", canonicalSlug: "openai/gpt-4.1-mini", success: true,
      providerAttemptCount: 1, providerAttempts: [{ provider: "openai", providerApiModelId: "gpt-4.1-mini-2025-04-14", success: true }] };
    expect(parse(value(1, { modelAttempts: [attempt] })).identity.reportedProviderAttemptCount).toBe(1);
    expect(() => parse(value(1, { modelAttempts: [{ ...attempt, providerAttemptCount: 2 }] }))).toThrow("reported provider attempts");
    expect(() => parse(value(1, { modelAttempts: [{ ...attempt, providerAttempts: [] }] }))).toThrow("provider attempt inventory");
    expect(() => parse(value(2, { modelAttempts: [attempt] }))).toThrow("reported provider attempts");
  });
  test("validates legacy routing.attempts and reconciles its identity with newer inventories", () => {
    const base = provider(), routing = base.providerMetadata.gateway.routing;
    const legacy = { provider: "openai", internalModelId: "openai:gpt-4.1-mini-2025-04-14",
      providerApiModelId: "gpt-4.1-mini-2025-04-14", credentialType: "system", success: true, startTime: 1, endTime: 2 };
    const value = (attempts: unknown, extra: Record<string, unknown> = {}) => ({ ...base,
      providerMetadata: { gateway: { ...base.providerMetadata.gateway, routing: { ...routing, attempts, ...extra } } } });
    expect(parse(value([legacy])).identity).toMatchObject({ reportedProviderAttemptCount: 1, physicalAttemptCount: null });
    const current = { modelId: "openai:gpt-4.1-mini", canonicalSlug: "openai/gpt-4.1-mini", success: true,
      providerAttemptCount: 1, providerAttempts: [{ provider: "openai", providerApiModelId: "gpt-4.1-mini-2025-04-14", success: true }] };
    expect(parse(value([legacy], { totalProviderAttemptCount: 1, modelAttempts: [current] })).identity.reportedProviderAttemptCount).toBe(1);
    for (const attempts of [null, {}, [], [legacy, legacy], [{ ...legacy, success: false }], [{ ...legacy, provider: "azure" }],
      [{ ...legacy, internalModelId: "openai:gpt-4.1-mini-2025-04-15" }], [{ provider: "openai", success: true }]]) {
      expect(() => parse(value(attempts))).toThrow();
    }
    expect(() => parse(value([legacy], { totalProviderAttemptCount: 2 }))).toThrow("reported provider attempts");
    expect(() => parse(value([legacy], { modelAttempts: [{ ...current, providerAttempts: [{ ...legacy, provider: "azure" }] }] }))).toThrow("unexpected reported provider attempt");
  });
  test("completed malformed extraction text remains a first response for the native outcome decoder", () => {
    const value = provider({ ...request() }); value.choices[0]!.message.content = '{"units":[';
    expect(parse(value)).toMatchObject({ kind: "completed", prediction: '{"units":[' });
  });
  test("refusal/content-filter have explicit extraction dispositions and remain fatal for reader/judge", () => {
    for (const phase of ["extract", "reader", "judge"] as const) {
      const req = request(phase);
      for (const [finish, message, reason] of [["stop", { role: "assistant", content: null, refusal: "Unable to comply" }, "refusal"],
        ["content_filter", { role: "assistant", content: "partial" }, "content-filter"]] as const) {
        const value = provider(req, { choices: [{ finish_reason: finish, message }] });
        if (phase === "extract") expect(parse(value, phase)).toMatchObject({ kind: "extraction-terminal", reason });
        else expect(() => parse(value, phase)).toThrow();
      }
    }
  });
  test("fails closed on absent routing, other provider/model, conflicting aliases and invalid costs", () => {
    const base = provider();
    const malformed = [
      { ...base, providerMetadata: undefined },
      { ...base, model: "gpt-4o" },
      { ...base, model: "gpt-4.1-mini-2025-04-15" },
      { ...base, provider_metadata: { gateway: {} } },
      ...["azure", undefined].map(finalProvider => ({ ...base, providerMetadata: { gateway: { routing: { ...base.providerMetadata.gateway.routing, finalProvider } } } })),
      ...["-1", "NaN", "1e-5", "1000", -1, NaN].map(cost => ({ ...base, providerMetadata: { gateway: { ...base.providerMetadata.gateway, cost } } })),
    ];
    for (const value of malformed) expect(() => parse(value)).toThrow();
  });
  test("accepts one explicitly reported attempt and rejects fallback attempts", () => {
    const value = provider(), routing = value.providerMetadata.gateway.routing as Record<string, unknown>;
    routing.modelAttemptCount = 1;
    routing.modelAttempts = [{ modelId: "openai:gpt-4.1-mini", canonicalSlug: "openai/gpt-4.1-mini", success: true,
      providerAttemptCount: 1, providerAttempts: [{ provider: "openai", providerApiModelId: "gpt-4.1-mini-2025-04-14", success: true }] }];
    expect(parse(value).identity).toMatchObject({ reportedModelAttemptCount: 1, reportedProviderAttemptCount: 1, physicalAttemptCount: null });
    routing.modelAttemptCount = 2; expect(() => parse(value)).toThrow(); routing.modelAttemptCount = 1;
    (routing.modelAttempts as Record<string, unknown>[])[0]!.providerAttemptCount = 2; expect(() => parse(value)).toThrow();
  });
  test("rejects a different dated snapshot inside otherwise matching attempt metadata", () => {
    const value = provider(), routing = value.providerMetadata.gateway.routing as Record<string, unknown>;
    routing.modelAttempts = [{ modelId: "openai:gpt-4.1-mini", canonicalSlug: "openai/gpt-4.1-mini", success: true,
      providerAttemptCount: 1, providerAttempts: [{ provider: "openai", providerApiModelId: "gpt-4.1-mini-2025-04-15", success: true }] }];
    expect(() => parse(value)).toThrow("provider attempt model mismatch");
    routing.modelAttempts = [{ modelId: "openai:gpt-4.1-mini-2025-04-15", canonicalSlug: "openai/gpt-4.1-mini", success: true }];
    expect(() => parse(value)).toThrow("unexpected reported model attempt");
  });
  test("unknown, length, ambiguous choices and malformed usage never become zero-memory outcomes", () => {
    const base = provider();
    const choices = base.choices;
    for (const value of [{ ...base, choices: [choices[0], choices[0]] }, { ...base, choices: [{ ...choices[0], finish_reason: "length" }] },
      { ...base, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "both", refusal: "refused" } }] },
      { ...base, usage: undefined }, { ...base, usage: { prompt_tokens: 20, completion_tokens: 20_000, total_tokens: 20_020 } },
      { ...base, usage: { ...base.usage, total_tokens: 23 } }, { ...base, usage: { ...base.usage, prompt_tokens_details: { cached_tokens: 21 } } }]) {
      expect(() => parse(value)).toThrow();
    }
  });
  test("raw request/reservation identity and completed-byte bounds are mandatory for replay", () => {
    const req = request(), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }), reservation = budget.reserve(req, "job"), capture = raw(req);
    for (const bad of [{ ...capture, requestSha256: "0".repeat(64) }, { ...capture, bodyComplete: false },
      { ...capture, receivedBytes: capture.receivedBytes + 1 }, { ...capture, httpStatus: 429 },
      { ...capture, transportError: "body-read" as const }]) expect(() => parseGatewayStudyResponse(req, reservation, bad)).toThrow();
    expect(() => parseGatewayStudyResponse(req, { ...reservation, micros: reservation.micros - 1 }, capture)).toThrow();
    expect(() => parseGatewayStudyResponse({ ...req, timeoutMs: 1 } as GatewayStudyRequest, reservation, capture)).toThrow();
  });
});

describe("Gateway v3 single dispatch and durable evidence ordering", () => {
  test("captures, settles and replays the nested OpenAI-compatible wire envelope unchanged", async () => {
    const value = provider(), metadata = value.providerMetadata;
    const native = { ...value, providerMetadata: undefined, usage: { ...value.usage, prompt_tokens_details: null },
      choices: [{ ...value.choices[0], message: { ...value.choices[0]!.message, tool_calls: null, provider_metadata: metadata } }] };
    let calls = 0;
    const run = invocation({ fetcher: async () => { calls++; return Response.json(native); } });
    const result = await run.promise;
    expect(calls).toBe(1); expect(run.events.map(event => event.kind)).toEqual(["reserved", "settled"]);
    expect(new TextDecoder().decode(run.captures[0]!.body)).toBe(JSON.stringify(native));
    const replay = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 });
    expect(parseGatewayStudyResponse(run.req, replay.reserve(run.req, "job"), run.captures[0]!)).toEqual(result);
    expect(result.usage).toMatchObject({ cachedInputTokens: 0, gatewayReportedMicros: 20, micros: 20 });
  });
  test("awaits reservation before fetch and raw capture before settlement; authenticates by OIDC only", async () => {
    const order: string[] = [], captures: GatewayStudyRaw[] = [];
    const run = invocation({ record: async event => { await Promise.resolve(); order.push(event.kind); },
      capture: async capture => { await Promise.resolve(); captures.push(capture); order.push("capture"); capture.body.fill(0); },
      fetcher: (async (url, options) => {
        expect(order).toEqual(["reserved"]); order.push("fetch");
        expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions"); expect(options?.redirect).toBe("error");
        expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer synthetic-project-oidc");
        expect(String(options?.body)).not.toContain("synthetic-project-oidc");
        return Response.json(provider());
      }) as GatewayStudyFetcher });
    const result = await run.promise;
    expect(result.kind).toBe("completed"); expect(order).toEqual(["reserved", "fetch", "capture", "settled"]);
    expect(run.budget.summary.unresolvedThisRunUsd).toBe(0); expect(captures).toHaveLength(1);
  });
  test("reservation write failure and missing OIDC make no fetch", async () => {
    let fetches = 0; const fetcher = (async () => { fetches++; return Response.json(provider()); }) as GatewayStudyFetcher;
    await expect(invocation({ record: async () => { throw new Error("disk full"); }, fetcher }).promise).rejects.toThrow("disk full");
    await expect(invocation({ oidcToken: "", fetcher }).promise).rejects.toThrow("OIDC");
    expect(fetches).toBe(0);
  });
  test("capture or settlement write failures retain the full reservation", async () => {
    const captureFailure = invocation({ capture: async () => { throw new Error("capture failed"); } });
    await expect(captureFailure.promise).rejects.toThrow("capture failed");
    expect(captureFailure.events.map(x => x.kind)).toEqual(["reserved"]); expect(captureFailure.budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
    const settlementFailure = invocation({ record: async event => { if (event.kind === "settled") throw new Error("settlement failed"); } });
    await expect(settlementFailure.promise).rejects.toThrow("settlement failed"); expect(settlementFailure.captures).toHaveLength(1);
    expect(settlementFailure.budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
  });
  test("captures HTTP and network failures once without retry or semantic settlement", async () => {
    for (const kind of ["http", "network"] as const) {
      let calls = 0;
      const run = invocation({ fetcher: (async () => { calls++; if (kind === "network") throw new Error("network detail with possible secrets");
        return new Response('{"error":"rate limit"}', { status: 429 }); }) as GatewayStudyFetcher });
      await expect(run.promise).rejects.toThrow("transport or HTTP failure"); expect(calls).toBe(1);
      expect(run.captures).toHaveLength(1); expect(run.events.map(x => x.kind)).toEqual(["reserved"]);
      expect(run.captures[0]!.transportError).toBe(kind === "network" ? "network" : null);
      expect(JSON.stringify(run.captures)).not.toContain("possible secrets");
    }
  });
  test("stores bounded prefix and read-failure evidence before stopping", async () => {
    const oversized = invocation({ fetcher: (async () => new Response("x".repeat(GATEWAY_STUDY_RESPONSE_BYTES + 1))) as GatewayStudyFetcher });
    await expect(oversized.promise).rejects.toThrow();
    expect(oversized.captures[0]).toMatchObject({ bodyComplete: false, receivedBytes: GATEWAY_STUDY_RESPONSE_BYTES + 1, transportError: "response-bound" });
    expect(oversized.captures[0]!.body.length).toBe(GATEWAY_STUDY_RESPONSE_BYTES);
    let reads = 0;
    const failed = invocation({ fetcher: (async () => new Response(new ReadableStream({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode("partial")); else controller.error(new Error("read failed"));
    } }))) as GatewayStudyFetcher });
    await expect(failed.promise).rejects.toThrow(); expect(new TextDecoder().decode(failed.captures[0]!.body)).toBe("partial");
    expect(failed.captures[0]!.transportError).toBe("body-read");
  });
  test("stored raw capture replays exactly and forged settlements cannot reduce the budget", async () => {
    const run = invocation(), result = await run.promise;
    const replayBudget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }), reservation = replayBudget.reserve(run.req, "job");
    expect(parseGatewayStudyResponse(run.req, reservation, run.captures[0]!)).toEqual(result);
    expect(() => replayBudget.settle(reservation, { ...result.usage, micros: 0 })).toThrow();
    replayBudget.settle(reservation, result.usage);
    expect(() => replayBudget.settle(reservation, result.usage)).toThrow();
    expect(gatewayStudyLedgerExposure(run.events)).toBe(result.usage.micros);
  });
});
