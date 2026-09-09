import { expect, test } from "bun:test";
import { LAB_GPT5_MINI_RESPONSE_BYTES, makeLabGpt5MiniReaderRequest, parseLabGpt5MiniReaderResponse,
  reserveLabGpt5MiniReader, type LabReaderRaw, type LabReaderResult } from "../scripts/benchmarks/lab-reader-profile";
import { invokeLabGpt5MiniReader } from "../scripts/benchmarks/lab-reader-profile-transport";

const request = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "What color is the bicycle? Memory: The bicycle is green." }]);
const reservation = reserveLabGpt5MiniReader(request, "a".repeat(64));
const response = () => Response.json({ model: "gpt-5-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Green." } }],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  providerMetadata: { gateway: { routing: { finalProvider: "openai", originalModelId: "openai/gpt-5-mini", canonicalSlug: "openai/gpt-5-mini" } } } });

function fixture(rejectAdmission = false, occupied = false) {
  const events: string[] = []; let captured: LabReaderRaw | undefined, saved: LabReaderResult | null = null;
  const cache = {
    async lookup() { events.push("lookup"); return saved !== null ? { kind: "hit" as const, result: saved }
      : occupied ? { kind: "occupied" as const } : { kind: "miss" as const }; },
    async admit() { events.push("admit"); if (rejectAdmission) throw new Error("cap"); return reservation; },
    async capture(_request: unknown, raw: LabReaderRaw) { events.push("capture"); captured = raw; },
    async finalize() { events.push("parse-settle"); saved = parseLabGpt5MiniReaderResponse(request, reservation, captured!); return saved; },
  };
  return { cache, events, get captured() { return captured; }, async qualify() { events.push("qualify"); } };
}

test("durable admission precedes one dispatch, raw precedes parse, and replay makes no call", async () => {
  const f = fixture(); let calls = 0;
  const options = { request, cache: f.cache, oidcToken: "test-token", qualify: f.qualify,
    fetcher: async (_url: string, init: RequestInit) => { calls++; f.events.push("fetch");
      expect(init.redirect).toBe("error"); expect(JSON.parse(init.body as string)).toEqual(request.body); return response(); } };
  expect((await invokeLabGpt5MiniReader(options)).result).toMatchObject({ kind: "completed", prediction: "Green." });
  expect(f.events).toEqual(["qualify", "lookup", "admit", "qualify", "fetch", "capture", "parse-settle"]);
  expect((await invokeLabGpt5MiniReader(options)).cached).toBe(true); expect(calls).toBe(1);
});

test("admission rejection cannot dispatch", async () => {
  const f = fixture(true); let calls = 0;
  await expect(invokeLabGpt5MiniReader({ request, cache: f.cache, oidcToken: "test-token", qualify: f.qualify,
    fetcher: async () => { calls++; return response(); } })).rejects.toThrow("cap");
  expect(calls).toBe(0); expect(f.captured).toBeUndefined();
});

test("a qualification failure after durable admission cannot dispatch", async () => {
  const f = fixture(); let calls = 0, qualifications = 0;
  await expect(invokeLabGpt5MiniReader({ request, cache: f.cache, oidcToken: "test-token", qualify: async () => {
    f.events.push("qualify"); qualifications += 1; if (qualifications === 2) throw new Error("stopped");
  }, fetcher: async () => { calls++; return response(); } })).rejects.toThrow("stopped");
  expect(calls).toBe(0); expect(f.events).toEqual(["qualify", "lookup", "admit", "qualify"]); expect(f.captured).toBeUndefined();
});

test("occupied incomplete first response cannot dispatch or count as a cache hit", async () => {
  const f = fixture(false, true); let calls = 0;
  await expect(invokeLabGpt5MiniReader({ request, cache: f.cache, oidcToken: "test-token", qualify: f.qualify,
    fetcher: async () => { calls++; return response(); } })).rejects.toThrow("cannot be retried");
  expect(calls).toBe(0); expect(f.events).toEqual(["qualify", "lookup"]);
});

test("network failure retains raw metadata before rejecting and does not retry", async () => {
  const f = fixture(); let calls = 0;
  await expect(invokeLabGpt5MiniReader({ request, cache: f.cache, oidcToken: "test-token", qualify: f.qualify,
    fetcher: async () => { calls++; throw new Error("network secret must not escape"); } })).rejects.toThrow("incomplete transport");
  expect(calls).toBe(1); expect(f.captured).toMatchObject({ httpStatus: null, transportError: "network", receivedBytes: 0, bodyComplete: false });
  expect(f.events.slice(-2)).toEqual(["capture", "parse-settle"]);
});

test("oversized response retains a bounded prefix and cannot become an answer", async () => {
  const f = fixture();
  await expect(invokeLabGpt5MiniReader({ request, cache: f.cache, oidcToken: "test-token", qualify: f.qualify,
    fetcher: async () => new Response(new Uint8Array(LAB_GPT5_MINI_RESPONSE_BYTES + 1)) })).rejects.toThrow("incomplete transport");
  expect(f.captured?.body.byteLength).toBe(LAB_GPT5_MINI_RESPONSE_BYTES);
  expect(f.captured).toMatchObject({ transportError: "response-bound", receivedBytes: LAB_GPT5_MINI_RESPONSE_BYTES + 1, bodyComplete: false });
});
