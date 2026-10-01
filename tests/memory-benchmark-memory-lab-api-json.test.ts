import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import { API_JSON_REQUEST_PROTOCOL, API_MODELS, API_PROTOCOL, ApiLabTransport, apiTransportCustody,
  parseApiConfig, parseApiReply, prepareApiRequest, requestProtocol, type ApiBinding } from "../scripts/benchmarks/memory-lab/api-transport";

// Literal pre-change bytes from invented prompts pin the legacy request contract.
const reader: ApiBinding = { id: "gemini-reader", model: "gemini-3.8-flash", keyEnv: "VERTEX_API_KEY", maximumOutput: 4096 };
const judge: ApiBinding = { id: "grok-judge", model: "grok-4.7", keyEnv: "XAI_API_KEY", maximumOutput: 2048 };
const messages = [{ role: "system" as const, content: "Use only memory." }, { role: "user" as const, content: "Which colour?" }];
const legacy = [
  {
    binding: reader,
    raw: '{"systemInstruction":{"parts":[{"text":"Use only memory."}]},"contents":[{"role":"user","parts":[{"text":"Which colour?"}]}],"generationConfig":{"temperature":0,"candidateCount":1,"maxOutputTokens":4096,"thinkingConfig":{"thinkingLevel":"low"}}}',
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    inputUpperBound: 2293, reservationMicros: 17080, requestSha256: "b11aa440267bdc8e93f06a7325df97eaa12cff4e56c9e851c30f0cc83e552550",
    capture: '{"protocol":"oh.memory-lab-api.v1","binding":{"id":"gemini-reader","model":"gemini-3.8-flash","keyEnv":"VERTEX_API_KEY","maximumOutput":4096},"requestSha256":"b11aa440267bdc8e93f06a7325df97eaa12cff4e56c9e851c30f0cc83e552550","endpoint":"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent","body":{"systemInstruction":{"parts":[{"text":"Use only memory."}]},"contents":[{"role":"user","parts":[{"text":"Which colour?"}]}],"generationConfig":{"temperature":0,"candidateCount":1,"maxOutputTokens":4096,"thinkingConfig":{"thinkingLevel":"low"}}},"reservationMicros":17080}',
  },
  {
    binding: judge,
    raw: '{"model":"grok-4.7","input":[{"role":"system","content":[{"type":"input_text","text":"Use only memory."}]},{"role":"user","content":[{"type":"input_text","text":"Which colour?"}]}],"temperature":0,"max_output_tokens":2048,"reasoning":{"effort":"low"},"store":false,"stream":false}',
    endpoint: "https://api.x.ai/v1/responses",
    inputUpperBound: 2328, reservationMicros: 16944, requestSha256: "2db2423e9e0c3fc30238abf19d15e5a1556432ef19e690ce434ea853299146d1",
    capture: '{"protocol":"oh.memory-lab-api.v1","binding":{"id":"grok-judge","model":"grok-4.7","keyEnv":"XAI_API_KEY","maximumOutput":2048},"requestSha256":"2db2423e9e0c3fc30238abf19d15e5a1556432ef19e690ce434ea853299146d1","endpoint":"https://api.x.ai/v1/responses","body":{"model":"grok-4.7","input":[{"role":"system","content":[{"type":"input_text","text":"Use only memory."}]},{"role":"user","content":[{"type":"input_text","text":"Which colour?"}]}],"temperature":0,"max_output_tokens":2048,"reasoning":{"effort":"low"},"store":false,"stream":false},"reservationMicros":16944}',
  },
] as const;
const roots: string[] = [], envNames = ["VERTEX_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"] as const;
const previousKeys = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const name of envNames) { if (previousKeys[name] === undefined) delete process.env[name]; else process.env[name] = previousKeys[name]; }
});
const now = () => Date.parse("2026-10-01T06:00:00Z");
function fixture(selected = reader, maxUsd = 5) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oh-api-json-invented-"))); roots.push(root);
  const cache = join(root, "cache"); mkdirSync(cache, { mode: 0o700 });
  const budgetPath = join(root, "budget.json"), ledgerPath = join(cache, "ledger.jsonl");
  writeFileSync(budgetPath, JSON.stringify({ protocol: "oh.memory-lab-api-budget.v1", maxUsd, maxCalls: 10,
    expiresAt: "2026-10-03T00:00:00Z", ledgerPath }), { mode: 0o600 });
  for (const name of envNames) process.env[name] = "invented-json-fixture-not-a-credential";
  return { config: { budgetPath, reader: selected, judge }, ledgerPath };
}
function gemini(answer = '{"colour":"teal"}') {
  return { modelVersion: "gemini-3.8-flash", candidates: [{ finishReason: "STOP", content: { parts: [{ text: answer }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 0, totalTokenCount: 13 } };
}
function fakeFetch(fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(fn, { preconnect() { throw Error("invented fixture cannot connect"); } }) as typeof fetch;
}
function requestCapture(request: ReturnType<typeof prepareApiRequest>) {
  return JSON.stringify({ protocol: requestProtocol(request.binding), binding: request.binding, requestSha256: request.requestSha256,
    endpoint: request.endpoint, body: JSON.parse(request.raw), reservationMicros: request.reservationMicros });
}

test("omitting outputFormat preserves literal Gemini and xAI body, digest, capture bytes and return order", async () => {
  const f = fixture();
  const transport = await ApiLabTransport.open({ config: f.config, maxCalls: 2, now, fetcher: fakeFetch(async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    return Response.json(body.model ? { model: "grok-4.7", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "teal" }] }],
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, output_tokens_details: { reasoning_tokens: 0 }, num_server_side_tools_used: 0, num_sources_used: 0 } } : gemini());
  }) });
  try {
    for (const expected of legacy) {
      const request = prepareApiRequest(expected.binding, messages);
      expect(Object.keys(request)).toEqual(["binding", "endpoint", "raw", "inputUpperBound", "reservationMicros", "requestSha256"]);
      expect(Object.keys(request.binding)).toEqual(["id", "model", "keyEnv", "maximumOutput"]);
      expect(JSON.stringify(request.binding)).toBe(JSON.stringify(expected.binding));
      expect(request).toEqual({ binding: expected.binding, endpoint: expected.endpoint, raw: expected.raw,
        inputUpperBound: expected.inputUpperBound, reservationMicros: expected.reservationMicros, requestSha256: expected.requestSha256 });
      expect(requestProtocol(request.binding)).toBe(API_PROTOCOL);
      expect(requestCapture(request)).toBe(expected.capture);
      const preimage = JSON.stringify({ protocol: "oh.memory-lab-api.v1", binding: expected.binding, endpoint: expected.endpoint, body: JSON.parse(expected.raw) });
      expect(sha256Hex(preimage)).toBe(expected.requestSha256);
      expect(apiTransportCustody.capturedRequest(expected.capture, parseApiConfig(f.config))).toEqual(request);
      await transport.invoke(expected.binding.id, messages);
    }
  } finally { transport.close(); }
  const captures = readdirSync(f.ledgerPath + ".attempts").filter(name => name.endsWith(".request.json"))
    .map(name => readFileSync(join(f.ledgerPath + ".attempts", name), "utf8"));
  expect(captures.sort()).toEqual(legacy.map(row => row.capture).sort());
});

test("JSON output accepts either Gemini credential selector and either role with a distinct request protocol", () => {
  for (const keyEnv of ["VERTEX_API_KEY", "GEMINI_API_KEY"] as const) for (const role of ["reader", "judge"] as const) {
    const selected: ApiBinding = { ...reader, keyEnv, id: "json-role", outputFormat: "json" };
    const config = parseApiConfig({ budgetPath: "/invented/budget.json", reader, judge, [role]: selected });
    const request = prepareApiRequest(config[role], messages), plain = prepareApiRequest({ ...reader, id: selected.id, keyEnv }, messages);
    expect(Object.keys(request.binding)).toEqual(["id", "model", "keyEnv", "maximumOutput", "outputFormat"]);
    expect(Object.keys(request)).toEqual(Object.keys(plain));
    expect(requestProtocol(request.binding)).toBe(API_JSON_REQUEST_PROTOCOL);
    expect(request.endpoint).toBe(plain.endpoint);
    expect(request.raw).toBe(plain.raw.slice(0, -2) + ',"responseMimeType":"application/json"}}');
    expect(Buffer.byteLength(request.raw) - Buffer.byteLength(plain.raw)).toBe(38);
    expect(request.inputUpperBound - plain.inputUpperBound).toBe(38);
    expect(request.reservationMicros).toBe(17109);
    expect(request.reservationMicros - plain.reservationMicros).toBe(29);
    expect(request.requestSha256).toBe(sha256Hex(JSON.stringify({ protocol: API_JSON_REQUEST_PROTOCOL, binding: request.binding,
      endpoint: request.endpoint, body: JSON.parse(request.raw) })));
    expect(request.requestSha256).not.toBe(plain.requestSha256);
    expect(apiTransportCustody.capturedRequest(requestCapture(request), config)).toEqual(request);
  }
});

test("explicit invalid output formats, xAI JSON and extra binding keys fail before preparation", () => {
  for (const selected of [
    ...[undefined, null, false, true, "", "text", "JSON", "application/json", {}, []].map(outputFormat => ({ ...reader, outputFormat })),
    { ...judge, outputFormat: "json" }, { ...reader, outputFormat: "json", responseSchema: {} }, { ...reader, unknown: true },
  ]) {
    expect(() => parseApiConfig({ budgetPath: "/invented/budget.json", reader: selected, judge })).toThrow();
    expect(() => prepareApiRequest(selected as ApiBinding, messages)).toThrow();
  }
});

test("inherited outputFormat cannot opt omitted Gemini or xAI bindings into JSON", () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "outputFormat");
  try {
    Object.defineProperty(Object.prototype, "outputFormat", { value: "json", configurable: true, writable: true });
    const config = parseApiConfig({ budgetPath: "/invented/budget.json", reader, judge });
    for (const expected of legacy) {
      const request = prepareApiRequest(expected.binding, messages);
      expect(Object.hasOwn(request.binding, "outputFormat")).toBeFalse();
      expect(requestProtocol(request.binding)).toBe(API_PROTOCOL);
      expect(request.raw).toBe(expected.raw); expect(request.requestSha256).toBe(expected.requestSha256);
      expect(requestCapture(request)).toBe(expected.capture);
      expect(apiTransportCustody.capturedRequest(expected.capture, config)).toEqual(request);
    }
    expect(Object.hasOwn(config.reader, "outputFormat")).toBeFalse();
    expect(Object.hasOwn(config.judge, "outputFormat")).toBeFalse();
    expect(() => parseApiConfig({ budgetPath: "/invented/budget.json", reader: { ...reader, outputFormat: undefined }, judge })).toThrow("output format");
    expect(requestProtocol(prepareApiRequest({ ...reader, outputFormat: "json" }, messages).binding)).toBe(API_JSON_REQUEST_PROTOCOL);
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "outputFormat", previous);
    else Reflect.deleteProperty(Object.prototype, "outputFormat");
  }
});

test("JSON captures reject protocol/config mismatches and wire changes with the original claimed digest", () => {
  const f = fixture({ ...reader, outputFormat: "json" }), config = parseApiConfig(f.config);
  const request = prepareApiRequest(config.reader, messages), capture = JSON.parse(requestCapture(request));
  for (const changed of [
    { ...capture, protocol: API_PROTOCOL }, { ...capture, protocol: "oh.memory-lab-api-json.v2" },
    { ...capture, binding: reader }, { ...capture, endpoint: "https://invalid.example/invented" },
    { ...capture, reservationMicros: capture.reservationMicros - 1 },
    { ...capture, body: JSON.parse(prepareApiRequest(reader, messages).raw) },
  ]) expect(() => apiTransportCustody.capturedRequest(JSON.stringify(changed), config)).toThrow();
  expect(() => apiTransportCustody.capturedRequest(requestCapture(request), parseApiConfig({ ...f.config, reader }))).toThrow("binding");
  expect(() => apiTransportCustody.capturedRequest(legacy[0].capture, config)).toThrow("binding");
  expect(() => apiTransportCustody.capturedRequest(JSON.stringify({ ...JSON.parse(legacy[0].capture), protocol: API_JSON_REQUEST_PROTOCOL }),
    parseApiConfig({ ...f.config, reader }))).toThrow("protocol");
});

test("serial JSON dispatch captures exact bytes and replays offline without interpreting candidate text", async () => {
  const f = fixture({ ...reader, outputFormat: "json" }), request = prepareApiRequest(f.config.reader, messages);
  let calls = 0;
  const answer = '```json\n{"colour":"teal"}\n```';
  const transport = await ApiLabTransport.open({ config: f.config, maxCalls: 1, now, fetcher: fakeFetch(async (url, init) => {
    calls++; expect(String(url)).toBe(request.endpoint); expect(init!.body).toBe(request.raw);
    return Response.json(gemini(answer));
  }) });
  try { expect((await transport.invoke(reader.id, messages)).result.answer).toBe(answer); } finally { transport.close(); }
  for (const name of envNames) delete process.env[name];
  const row = JSON.parse(readFileSync(f.ledgerPath, "utf8").split("\n")[0]!);
  const base = join(f.ledgerPath + ".attempts", row.id), raw = readFileSync(base + ".request.json", "utf8");
  expect(raw).toBe(requestCapture(request)); expect(JSON.parse(raw).protocol).toBe(API_JSON_REQUEST_PROTOCOL);
  const replayed = apiTransportCustody.capturedRequest(raw, parseApiConfig(f.config));
  const response = JSON.parse(readFileSync(base + ".response.json", "utf8"));
  expect(parseApiReply(JSON.parse(response.body), replayed)).toEqual(JSON.parse(readFileSync(base + ".result.json", "utf8")));
  expect(calls).toBe(1);
});

test("JSON byte overhead enforces context and cumulative budget before any capture, reservation or fetch", async () => {
  const selected: ApiBinding = { ...reader, maximumOutput: 64 }, json = { ...selected, outputFormat: "json" as const };
  const sample = [{ role: "user" as const, content: "x" }];
  const overhead = prepareApiRequest(selected, sample).inputUpperBound - 1;
  const maximum = API_MODELS[selected.model].context - selected.maximumOutput - overhead;
  const full = [{ role: "user" as const, content: "x".repeat(maximum) }];
  expect(prepareApiRequest(selected, full).inputUpperBound + selected.maximumOutput).toBe(API_MODELS[selected.model].context);
  expect(() => prepareApiRequest(json, full)).toThrow("context bound");
  expect(prepareApiRequest(json, [{ role: "user", content: "x".repeat(maximum - 38) }]).inputUpperBound + selected.maximumOutput)
    .toBe(API_MODELS[selected.model].context);
  const legacyReservation = prepareApiRequest(reader, messages).reservationMicros;
  for (const limit of ["budget", "context"]) {
    const f = fixture(limit === "budget" ? { ...reader, outputFormat: "json" } : json, limit === "budget" ? legacyReservation / 1e6 : 5);
    let calls = 0;
    const transport = await ApiLabTransport.open({ config: f.config, maxCalls: 1, now, fetcher: fakeFetch(async () => { calls++; return Response.json(gemini()); }) });
    try { await expect(transport.invoke(reader.id, limit === "context" ? full : messages)).rejects.toThrow(limit === "budget" ? "campaign limit" : "context bound"); }
    finally { transport.close(); }
    expect(calls).toBe(0); expect(existsSync(f.ledgerPath)).toBeFalse(); expect(existsSync(f.ledgerPath + ".attempts")).toBeFalse();
  }
});
