import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256 } from "../src/canonical";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
import { EVOLUTION_MODEL_V2_PROTOCOL, EVOLUTION_PROFILE_WINDOW_INPUT_TOKENS, makeEvolutionProfileWindowRequest,
  makeEvolutionRequest, parseEvolutionResponse, validateEvolutionRequest, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest } from "../scripts/benchmarks/evolution-transport";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await realpath(await mkdtemp(join(tmpdir(), "oh-full-history-v2-"))); roots.push(path); return path; }
function campaign(storeDirectory: string): EvolutionCampaign {
  return { protocol: "oh.memory.evolution-campaign.v1", campaignId: "full-history-v2-test", storeDirectory, approval: "Synthetic fixture only",
    additionalBudgetMicros: 1_000_000, maximumCalls: 10, historicalExposureMicros: 0,
    historicalLedgers: [{ path: "/fixture/ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/auth", sha256: "b".repeat(64) } };
}
const messages = (body = "Which color?") => [{ role: "system" as const, content: "Use supplied memory only." }, { role: "user" as const, content: body }];
function response(request: EvolutionRequest, input = 400_000, output = 8_192) {
  return new TextEncoder().encode(JSON.stringify({ model: request.model,
    providerMetadata: { gateway: { routing: { finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model,
      resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1) } } },
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "blue" } }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } }));
}

describe("full-history profile-window V2 accounting", () => {
  test("keeps matched reader body settings but reserves the full profile window without a byte-to-token claim", () => {
    const history = messages("source ".repeat(90_000));
    expect(() => makeEvolutionRequest("gpt5-nano-reader", history)).toThrow("context bound");
    const nano = makeEvolutionProfileWindowRequest("gpt5-nano-reader", history);
    const matched = makeEvolutionRequest("gpt5-nano-reader", messages());
    expect(nano.protocol).toBe(EVOLUTION_MODEL_V2_PROTOCOL);
    expect(nano.body).toEqual({ ...matched.body, messages: history });
    expect(nano).toMatchObject({ inputUpperBound: EVOLUTION_PROFILE_WINDOW_INPUT_TOKENS, maxOutputTokens: 8192,
      reservationMicros: 23_277, inputAccounting: { protocol: "profile-window-v1", tokenizerFit: "unknown", providerWindowAcceptance: "required" } });
    expect(nano.inputAccounting.bodyBytes).toBeGreaterThan(400_000);
    expect(nano.inputAccounting.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(validateEvolutionRequest(structuredClone(nano))).toEqual(nano);
    const altered: any = structuredClone(nano); altered.inputAccounting.tokenizerFit = "fit";
    expect(() => validateEvolutionRequest(altered)).toThrow("request changed");
    expect(() => makeEvolutionProfileWindowRequest("gpt4o-gateway-judge", messages())).toThrow("profile-window");
  });

  test("store replays V1 and V2 independently, while a V2 network failure retains the full cap", async () => {
    const path = await directory(), store = await openEvolutionStore({ directory: path, campaign: campaign(path) });
    const v1 = makeEvolutionRequest("gpt5-nano-reader", messages("v1"));
    const v2 = makeEvolutionProfileWindowRequest("gpt5-nano-reader", messages("source ".repeat(90_000)));
    try {
      store.admit(v1); store.capture(v1, { httpStatus: 200, body: response(v1, 100, 1), complete: true, receivedBytes: response(v1, 100, 1).length, error: null });
      const settledV1 = store.finalize(v1); expect(settledV1.usage.inputTokens).toBe(100);
      store.admit(v2); store.capture(v2, { httpStatus: 200, body: response(v2), complete: true, receivedBytes: response(v2).length, error: null });
      expect(store.finalize(v2)).toEqual(parseEvolutionResponse(response(v2), v2));
      const failed = makeEvolutionProfileWindowRequest("gpt5-mini-reader", messages("source ".repeat(90_000)));
      store.admit(failed); store.capture(failed, { httpStatus: null, body: new Uint8Array(), complete: false, receivedBytes: 0, error: "network" });
      expect(store.summary().unresolvedMicros).toBe(failed.reservationMicros);
      expect(store.readAttemptFailure(failed)).toMatchObject({ reservationMicros: 116_384, reason: "unverifiable-first-response" });
    } finally { await store.close(); }
    const reopened = await openEvolutionStore({ directory: path, campaign: campaign(path) });
    try { expect(reopened.lookup(v1).kind).toBe("hit"); expect(reopened.lookup(v2).kind).toBe("hit"); }
    finally { await reopened.close(); }
  });

  test("transport sends the V2 body unchanged and settles only authenticated usage below the full reservation", async () => {
    const path = await directory(), store = await openEvolutionStore({ directory: path, campaign: campaign(path) });
    const request = makeEvolutionProfileWindowRequest("gpt5-nano-reader", messages("source ".repeat(90_000)));
    let sent: unknown = null;
    try {
      const now = Math.floor(Date.now() / 1000), auth = { method: "project-oidc" as const, project: "fixture-project", scope: "fixture-scope", environment: "development" as const };
      const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const token = `${encoded({ alg: "RS256" })}.${encoded({ sub: "owner:fixture-scope:project:fixture-project:environment:development", aud: "https://vercel.com/fixture-scope", iss: "https://oidc.vercel.com/fixture-scope", exp: now + 600, iat: now })}.fixture`;
      const invoked = await invokeEvolutionRequest({ request, store, credential: { kind: "gateway-oidc", token, auth },
        fetcher: async (_url, init) => { sent = JSON.parse(String(init.body)); return new Response(response(request)); } });
      expect(sent).toEqual(request.body); expect(invoked.result.usage.micros).toBe(request.reservationMicros);
      expect(store.summary()).toMatchObject({ confirmedMicros: request.reservationMicros, unresolvedMicros: 0 });
    } finally { await store.close(); }
  });
});
