import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeEvolutionAnswerAuditMessages } from "../scripts/benchmarks/evolution-answer-audit";
import { EVOLUTION_EVENT_INVENTORY_V3_EXTRACTOR_PROFILE_ID, EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_READER_PROFILE_ID, EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_JUDGE_PROFILE_ID,
  EVOLUTION_FRAMEWORK_PILOT_GATEWAY_JUDGE_PROFILE_ID, EVOLUTION_FRAMEWORK_PILOT_GATEWAY_READER_PROFILE_ID,
  EVOLUTION_FRAMEWORK_PILOT_READER_PROFILE_ID, EVOLUTION_GATEWAY_ENDPOINT, EVOLUTION_OPENAI_ENDPOINT, EVOLUTION_PROFILES, EVOLUTION_RESPONSE_MAX_BYTES,
  EVOLUTION_TURN_COVERAGE_PROFILE_ID, EVOLUTION_TURN_GROUPING_PROFILE_ID,
  EVOLUTION_TURN_COVERAGE_HIGH_PROFILE_ID, EVOLUTION_TURN_GROUPING_HIGH_PROFILE_ID, EVOLUTION_SESSION_DIGEST_PROFILE_ID, EVOLUTION_SESSION_NOTES_PROFILE_ID, EVOLUTION_HINDSIGHT_PARITY_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V2_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V3_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V4_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V5_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V6_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V7_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V8_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V8_GPT5_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V9_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V11_READER_PROFILE_ID,
  makeEvolutionRequest, parseEvolutionResponse, validateEvolutionRequest, type EvolutionProfileId,
  type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT } from "../scripts/benchmarks/oh-event-inventory-v3-schema";
import { OH_TURN_COVERAGE_RESPONSE_FORMAT_V1, OH_TURN_GROUPING_RESPONSE_FORMAT_V1 } from "../scripts/benchmarks/oh-turn-coverage-schema";

const messages = [{ role: "system" as const, content: "Use supplied memory only." }, { role: "user" as const, content: "Which color?" }];
const directJudgeMessages = [{ role: "user" as const, content: "Evaluate this LongMemEval answer exactly as instructed." }];
function profileMessages(id: EvolutionProfileId) {
  return id === "gpt5-mini-answer-audit-v1"
    ? makeEvolutionAnswerAuditMessages({ question: "Which color?", questionDate: "", originalMemory: "Blue.", draftAnswer: "Blue." })
    : EVOLUTION_PROFILES[id].requiredResolvedSnapshot !== undefined || id === EVOLUTION_FRAMEWORK_PILOT_READER_PROFILE_ID
      || id === EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_READER_PROFILE_ID || id === EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_JUDGE_PROFILE_ID
      || id === EVOLUTION_HINDSIGHT_PARITY_READER_PROFILE_ID || id === "gpt4o-mini-clonemem-choice-v1-reader" || id === "gpt4o-official-snapshot-judge" || id === "gpt4o-gateway-native-rubric-judge-v1" || id === "gpt4o-gateway-native-rubric-16-judge-v1"
      || id === "gpt4o-beam-event-extraction-v1" || id === "gpt4o-beam-nugget-v1" ? directJudgeMessages : messages;
}
const raw = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function response(request: EvolutionRequest) {
  return { model: request.model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "  Blue.  " } }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 2 } },
    ...(request.endpoint === EVOLUTION_GATEWAY_ENDPOINT ? { providerMetadata: { gateway: { routing: {
      finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model,
      resolvedProviderApiModelId: EVOLUTION_PROFILES[request.profileId].requiredResolvedSnapshot ?? request.model.slice(request.model.indexOf("/") + 1),
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
      const request = makeEvolutionRequest(id, profileMessages(id)), bytes = raw(response(request));
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

  test("framework pilot answerer pins its snapshot, output reservation and first-response identity", () => {
    const prompt = [{ role: "user" as const, content: "Answer the question using the supplied evidence.\nQuestion: Which color?\nEvidence: Blue." }];
    const request = makeEvolutionRequest(EVOLUTION_FRAMEWORK_PILOT_READER_PROFILE_ID, prompt);
    const judge = makeEvolutionRequest("gpt4o-official-snapshot-judge", prompt);
    expect(request.endpoint).toBe(EVOLUTION_OPENAI_ENDPOINT);
    expect(request.body).toEqual({ model: "gpt-4o-2024-08-06", messages: prompt, stream: false, store: false,
      max_tokens: 512, temperature: 0 });
    expect(request.reservationMicros).toBe(Math.ceil((request.inputUpperBound * 2500 + 512 * 10000) / 1000));
    expect(request.profileSha256).not.toBe(judge.profileSha256);
    expect(request.requestSha256).not.toBe(judge.requestSha256);
    expect(judge.body.max_tokens).toBe(10);
    expect(parseEvolutionResponse(raw(response(request)), request).identity).toMatchObject({
      snapshotPinned: true, reportedModel: "gpt-4o-2024-08-06", finalProvider: "openai" });
    for (const model of ["gpt-4o", "openai/gpt-4o", "gpt-4o-2024-05-13"])
      expect(() => parseEvolutionResponse(mutate(response(request), value => { value.model = model; }), request)).toThrow("snapshot mismatch");
    expect(() => makeEvolutionRequest(EVOLUTION_FRAMEWORK_PILOT_READER_PROFILE_ID, messages)).toThrow("prompt shape");
    expect(() => validateEvolutionRequest({ ...request, profileId: judge.profileId })).toThrow("request changed");
    expect(() => parseEvolutionResponse(mutate(response(request), value => {
      value.usage.completion_tokens = 513; value.usage.total_tokens = 613;
    }), request)).toThrow("token cap");
    const truncated = parseEvolutionResponse(mutate(response(request), value => { value.choices[0].finish_reason = "length"; }), request);
    expect(truncated.status).toBe("truncated");
    expect(truncated.answer).toBeNull();
  });

  test("framework Gateway profiles require exact reported resolution while remaining alias requests", () => {
    for (const [id, cap] of [[EVOLUTION_FRAMEWORK_PILOT_GATEWAY_READER_PROFILE_ID, 512],
      [EVOLUTION_FRAMEWORK_PILOT_GATEWAY_JUDGE_PROFILE_ID, 16]] as const) {
      const request = makeEvolutionRequest(id, directJudgeMessages), matching = response(request);
      expect(request.endpoint).toBe(EVOLUTION_GATEWAY_ENDPOINT);
      expect(request.body.model).toBe("openai/gpt-4o");
      expect(request.body.max_tokens).toBe(cap);
      expect(request.body.providerOptions).toEqual({ gateway: { only: ["openai"], order: ["openai"] } });
      expect(parseEvolutionResponse(raw(matching), request).identity).toMatchObject({
        qualification: "gateway-alias", snapshotPinned: false, resolvedSnapshot: "gpt-4o-2024-08-06" });
      for (const resolved of [undefined, null, "gpt-4o", "gpt-4o-2024-05-13"])
        expect(() => parseEvolutionResponse(mutate(matching, value => {
          value.providerMetadata.gateway.routing.resolvedProviderApiModelId = resolved;
        }), request)).toThrow("required Gateway snapshot");
      expect(() => parseEvolutionResponse(mutate(matching, value => { value.model = "gpt-4o-2024-05-13"; }), request)).toThrow();
      expect(() => makeEvolutionRequest(id, messages)).toThrow("prompt shape");
      expect(() => validateEvolutionRequest({ ...request, profileId: "gpt4o-gateway-native-rubric-judge-v1" })).toThrow("request changed");
    }
  });

  test("explicit framework alias treatments preserve all 108 pre-existing profile identities", () => {
    const previous = Object.fromEntries(Object.entries(EVOLUTION_PROFILES).filter(([id]) =>
      id !== EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_READER_PROFILE_ID && id !== EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_JUDGE_PROFILE_ID
      && id !== EVOLUTION_EVENT_INVENTORY_V3_EXTRACTOR_PROFILE_ID
      && id !== EVOLUTION_TURN_COVERAGE_PROFILE_ID && id !== EVOLUTION_TURN_GROUPING_PROFILE_ID
      && id !== EVOLUTION_TURN_COVERAGE_HIGH_PROFILE_ID && id !== EVOLUTION_TURN_GROUPING_HIGH_PROFILE_ID
      && id !== EVOLUTION_TASK_COMPLETE_V2_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V3_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V4_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V5_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V6_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V7_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V8_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V8_GPT5_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V9_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V11_READER_PROFILE_ID && id !== EVOLUTION_SESSION_DIGEST_PROFILE_ID && id !== EVOLUTION_SESSION_NOTES_PROFILE_ID && id !== EVOLUTION_HINDSIGHT_PARITY_READER_PROFILE_ID));
    expect(Object.keys(previous)).toHaveLength(108);
    expect(canonicalSha256(previous)).toBe("361cfed008518d23dfda4cd463127075daf79630addb0183b23cb3138dcaa1bb");
  });

  test("event inventory V3 fixes strict output, accounts for schema bytes and preserves all 110 older profiles", () => {
    const previous = Object.fromEntries(Object.entries(EVOLUTION_PROFILES).filter(([id]) => id !== EVOLUTION_EVENT_INVENTORY_V3_EXTRACTOR_PROFILE_ID
      && id !== EVOLUTION_TURN_COVERAGE_PROFILE_ID && id !== EVOLUTION_TURN_GROUPING_PROFILE_ID
      && id !== EVOLUTION_TURN_COVERAGE_HIGH_PROFILE_ID && id !== EVOLUTION_TURN_GROUPING_HIGH_PROFILE_ID
      && id !== EVOLUTION_TASK_COMPLETE_V2_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V3_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V4_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V5_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V6_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V7_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V8_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V8_GPT5_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V9_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V11_READER_PROFILE_ID && id !== EVOLUTION_SESSION_DIGEST_PROFILE_ID && id !== EVOLUTION_SESSION_NOTES_PROFILE_ID && id !== EVOLUTION_HINDSIGHT_PARITY_READER_PROFILE_ID));
    expect(Object.keys(previous)).toHaveLength(110);
    expect(canonicalSha256(previous)).toBe("214a9417fc3d8a05a52525f3d272b01f0f7a467a7c51b06335a9b7c00f5e8126");
    const structured = makeEvolutionRequest(EVOLUTION_EVENT_INVENTORY_V3_EXTRACTOR_PROFILE_ID, messages);
    const unstructured = makeEvolutionRequest("gpt5-mini-low-extractor-v1", messages);
    expect(structured.body.response_format).toEqual(OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT);
    expect(structured.body).toMatchObject({ reasoning: { effort: "low" }, max_tokens: 8192, stream: false, store: false });
    expect(structured.inputUpperBound - unstructured.inputUpperBound)
      .toBe(Buffer.byteLength(JSON.stringify({ response_format: OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT })));
    expect(structured.reservationMicros).toBeGreaterThan(unstructured.reservationMicros);
    expect(structured.requestSha256).not.toBe(unstructured.requestSha256);
    expect(validateEvolutionRequest(structuredClone(structured))).toEqual(structured);
    expect(Object.isFrozen(structured.body.response_format?.json_schema.schema)).toBeTrue();
    const changed = structuredClone(structured) as Record<string, any>;
    changed.body.response_format.json_schema.schema.additionalProperties = true;
    expect(() => validateEvolutionRequest(changed as EvolutionRequest)).toThrow("request changed");
  });

  test("event inventory V3 schema, profile and request identities cannot drift within this version", () => {
    // Captured before the first V3 diagnostic freeze; successors need distinct identities.
    const request = makeEvolutionRequest(EVOLUTION_EVENT_INVENTORY_V3_EXTRACTOR_PROFILE_ID, messages);
    expect(canonicalSha256(OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT)).toBe("56ed7992a938668b9119eb6316b3c351f0c90d4b3bc10940250c28eca73af852");
    expect(request.profileSha256).toBe("610deea2c2b95fd20bcbcf393b91cfcbc64ec858c981bd8ec0beca7606682ec1");
    expect(request.requestSha256).toBe("fd60fce91d0281d390343649b32d5356d5b20d023358155d136ffc780e9a97d5");
  });

  test("turn coverage and grouping preserve all 111 prior profiles and use fixed bounded extractor routes", () => {
    const previous = Object.fromEntries(Object.entries(EVOLUTION_PROFILES).filter(([id]) =>
      id !== EVOLUTION_TURN_COVERAGE_PROFILE_ID && id !== EVOLUTION_TURN_GROUPING_PROFILE_ID
      && id !== EVOLUTION_TURN_COVERAGE_HIGH_PROFILE_ID && id !== EVOLUTION_TURN_GROUPING_HIGH_PROFILE_ID
      && id !== EVOLUTION_TASK_COMPLETE_V2_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V3_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V4_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V5_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V6_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V7_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V8_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V8_GPT5_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V9_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V11_READER_PROFILE_ID && id !== EVOLUTION_SESSION_DIGEST_PROFILE_ID && id !== EVOLUTION_SESSION_NOTES_PROFILE_ID && id !== EVOLUTION_HINDSIGHT_PARITY_READER_PROFILE_ID));
    expect(Object.keys(previous)).toHaveLength(111);
    expect(canonicalSha256(previous)).toBe("11806387471b525d9db04baeb9f00da9ab91e75f4d1770029b70067c9e5197bc");
    const prompts = [{ role: "system" as const, content: "Account for each supplied user turn." },
      { role: "user" as const, content: "Quoted Unicode evidence: \"café 🌱\"\nNext line." }];
    const unstructured = makeEvolutionRequest("gpt5-mini-low-extractor-v1", prompts);
    for (const [id, format] of [[EVOLUTION_TURN_COVERAGE_PROFILE_ID, OH_TURN_COVERAGE_RESPONSE_FORMAT_V1],
      [EVOLUTION_TURN_GROUPING_PROFILE_ID, OH_TURN_GROUPING_RESPONSE_FORMAT_V1]] as const) {
      const request = makeEvolutionRequest(id, prompts);
      expect(EVOLUTION_PROFILES[id]).toMatchObject({ qualification: "gateway-alias", expectedSnapshot: null,
        maxOutputTokens: 8192, timeoutMs: 600000, settings: { reasoning: { effort: "low" } }, responseFormat: format });
      expect(request.body).toMatchObject({ model: "openai/gpt-5-mini", reasoning: { effort: "low" }, max_tokens: 8192,
        stream: false, store: false, providerOptions: { gateway: { only: ["openai"], order: ["openai"] } }, response_format: format });
      expect(request.body.response_format?.json_schema.strict).toBeTrue();
      expect(request.body.temperature).toBeUndefined();
      expect(request.timeoutMs).toBe(600000);
      expect(request.inputUpperBound).toBe(Buffer.byteLength(JSON.stringify(prompts)) + 2048
        + Buffer.byteLength(JSON.stringify({ response_format: format })));
      expect(request.inputUpperBound - unstructured.inputUpperBound).toBe(Buffer.byteLength(JSON.stringify({ response_format: format })));
      expect(request.reservationMicros).toBeGreaterThan(unstructured.reservationMicros);
      expect(validateEvolutionRequest(structuredClone(request))).toEqual(request);
      expect(Object.isFrozen(EVOLUTION_PROFILES[id])).toBeTrue();
      expect(Object.isFrozen(request.body.response_format?.json_schema.schema)).toBeTrue();
      expect(Object.isFrozen(request.body.response_format?.json_schema.schema.properties)).toBeTrue();
      const changed = structuredClone(request) as Record<string, any>;
      changed.body.response_format.json_schema.schema.additionalProperties = true;
      expect(() => validateEvolutionRequest(changed as EvolutionRequest)).toThrow("request changed");
      expect(() => validateEvolutionRequest({ ...request, timeoutMs: 120000 })).toThrow("request changed");
    }
  });

  test("turn coverage and grouping schema, profile and request identities remain replayable within V1", () => {
    for (const [id, format, schemaSha256, profileSha256, requestSha256] of [
      [EVOLUTION_TURN_COVERAGE_PROFILE_ID, OH_TURN_COVERAGE_RESPONSE_FORMAT_V1,
        "7b593dfcd3f4c6ebedd348b28d1bbd22357d72930efbede0ce18b26d20155c9e",
        "21f4586605a56348530c48361005afea5daa6bd5ca6e854fab17c4e8932fcf73",
        "5538901c5ce4c2df8038c5d6ed6c318b9278f0216590872bc4b3395a6b35a648"],
      [EVOLUTION_TURN_GROUPING_PROFILE_ID, OH_TURN_GROUPING_RESPONSE_FORMAT_V1,
        "441db0eba18498f694d6dadfd42f9f8d391f85092509b53b39dedbfb7cb85314",
        "03bfcbda8ee41ebda0ce5a19b5f5b2c56af16812aeeda676bcb9a025d4824736",
        "a878c61408e56078132e50f92bd34faf57001467a43677c7bd6eb5444fa6dc61"],
    ] as const) {
      const request = makeEvolutionRequest(id, messages);
      expect(canonicalSha256(format)).toBe(schemaSha256);
      expect(request.profileSha256).toBe(profileSha256);
      expect(request.requestSha256).toBe(requestSha256);
      expect(makeEvolutionRequest(id, structuredClone(messages))).toEqual(request);
    }
  });

  test("high-effort additions preserve all 113 prior profiles and native requests", () => {
    const previous = Object.fromEntries(Object.entries(EVOLUTION_PROFILES).filter(([id]) =>
      id !== EVOLUTION_TURN_COVERAGE_HIGH_PROFILE_ID && id !== EVOLUTION_TURN_GROUPING_HIGH_PROFILE_ID
      && id !== EVOLUTION_TASK_COMPLETE_V2_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V3_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V4_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V5_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V6_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V7_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V8_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V8_GPT5_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V9_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_V11_READER_PROFILE_ID && id !== EVOLUTION_SESSION_DIGEST_PROFILE_ID && id !== EVOLUTION_SESSION_NOTES_PROFILE_ID && id !== EVOLUTION_HINDSIGHT_PARITY_READER_PROFILE_ID));
    const requests = Object.fromEntries(Object.keys(previous).map(key => {
      const id = key as EvolutionProfileId;
      return [id, makeEvolutionRequest(id, profileMessages(id))];
    }));
    // Captured from clean f3f9f6e3094ca58e5a29f1b1aa2d47b7ce3876bf before adding high-effort profiles.
    expect(Object.keys(previous)).toHaveLength(113);
    expect(canonicalSha256(previous)).toBe("5fad375fc294006ac8e0cb514980f0444c3c82334c25ec9ddbbd4a062e95328a");
    expect(canonicalSha256(requests)).toBe("f29b30c36000d43aa963f06237b10ee9c2d4d2fc857879a1da84d4306efd6340");
  });

  test("opt-in high coverage and grouping change only identity and reasoning effort", () => {
    for (const [lowId, highId, profileSha256, requestSha256] of [
      [EVOLUTION_TURN_COVERAGE_PROFILE_ID, EVOLUTION_TURN_COVERAGE_HIGH_PROFILE_ID,
        "c76f23287d67c422a0cb92751111cfb4a426475c10e102c69e27b885d0c0de11",
        "e86a18a4de40a74a1cd571b10c7a1091f85ee76a8075597acd5380b4e78c45c9"],
      [EVOLUTION_TURN_GROUPING_PROFILE_ID, EVOLUTION_TURN_GROUPING_HIGH_PROFILE_ID,
        "9673aa673ea2bedc61ac5ba2485a3863021d0334ce2d1fbf77ab1380ea9a6825",
        "e162ec9f59e00f33b081d3584728fa0bdd12a51d54cfbe745a4da9e68d93119a"],
    ] as const) {
      const low = makeEvolutionRequest(lowId, messages), high = makeEvolutionRequest(highId, messages);
      expect(EVOLUTION_PROFILES[highId]).toEqual({ ...EVOLUTION_PROFILES[lowId], id: highId,
        settings: { reasoning: { effort: "high" } } });
      expect(high).toEqual({ ...low, profileId: highId, profileSha256, requestSha256,
        body: { ...low.body, reasoning: { effort: "high" } } });
      expect(high.profileSha256).not.toBe(low.profileSha256);
      expect(high.requestSha256).not.toBe(low.requestSha256);
      expect(validateEvolutionRequest(structuredClone(high))).toEqual(high);
      expect(Object.isFrozen(EVOLUTION_PROFILES[highId].settings.reasoning)).toBeTrue();
      expect(Object.isFrozen(high.body.response_format?.json_schema.schema)).toBeTrue();
      for (const transplant of [
        { ...high, profileId: lowId },
        { ...high, profileSha256: low.profileSha256 },
        { ...high, requestSha256: low.requestSha256 },
        { ...high, body: low.body },
        { ...high, timeoutMs: 120000 },
        { ...high, maxOutputTokens: 32768, body: { ...high.body, max_tokens: 32768 } },
      ]) expect(() => validateEvolutionRequest(transplant)).toThrow("request changed");
    }
  });

  test("high-effort extractors keep the same context bound and charge capped reasoning truncation as a failed answer", () => {
    for (const id of [EVOLUTION_TURN_COVERAGE_HIGH_PROFILE_ID, EVOLUTION_TURN_GROUPING_HIGH_PROFILE_ID]) {
      const request = makeEvolutionRequest(id, messages), bounded = structuredClone(messages);
      bounded[1]!.content += "x".repeat(400000 - 8192 - request.inputUpperBound);
      const admitted = makeEvolutionRequest(id, bounded);
      expect(admitted.inputUpperBound + admitted.maxOutputTokens).toBe(400000);
      bounded[1]!.content += "x";
      expect(() => makeEvolutionRequest(id, bounded)).toThrow("conservative context bound exceeded");
      const truncated = parseEvolutionResponse(mutate(response(request), value => {
        value.choices[0].finish_reason = "length";
        value.choices[0].message.content = null;
        value.usage = { prompt_tokens: 100, completion_tokens: 8192, total_tokens: 8292,
          completion_tokens_details: { reasoning_tokens: 8192 } };
      }), request);
      expect(truncated).toMatchObject({ status: "truncated", answer: null, partialAnswer: null,
        usage: { inputTokens: 100, outputTokens: 8192, reasoningTokens: 8192, micros: 16409 } });
      expect(truncated.usage.micros).toBeLessThanOrEqual(request.reservationMicros);
    }
  });

  test("only explicit framework alias treatments accept an undisclosed snapshot and remain unpinned", () => {
    for (const [aliasId, strictId, cap] of [
      [EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_READER_PROFILE_ID, EVOLUTION_FRAMEWORK_PILOT_GATEWAY_READER_PROFILE_ID, 512],
      [EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_JUDGE_PROFILE_ID, EVOLUTION_FRAMEWORK_PILOT_GATEWAY_JUDGE_PROFILE_ID, 16],
    ] as const) {
      const alias = makeEvolutionRequest(aliasId, directJudgeMessages), strict = makeEvolutionRequest(strictId, directJudgeMessages);
      expect(alias.body).toEqual(strict.body);
      expect(alias.maxOutputTokens).toBe(cap);
      expect(alias.reservationMicros).toBe(strict.reservationMicros);
      expect(alias.requestSha256).not.toBe(strict.requestSha256);
      expect(alias.profileSha256).not.toBe(strict.profileSha256);
      expect(EVOLUTION_PROFILES[aliasId].requiredResolvedSnapshot).toBeUndefined();
      for (const resolved of [undefined, null, "gpt-4o"]) {
        const generic = response(alias);
        generic.providerMetadata!.gateway.routing.resolvedProviderApiModelId = resolved as string;
        // Match the Gateway's observed placement without copying any live completion.
        const nested = structuredClone(generic) as Record<string, any>;
        nested.choices[0].message.provider_metadata = nested.providerMetadata;
        delete nested.providerMetadata;
        expect(parseEvolutionResponse(raw(nested), alias).identity).toMatchObject({
          qualification: "gateway-alias", snapshotPinned: false, resolvedSnapshot: null,
          requestedModel: "openai/gpt-4o", finalProvider: "openai" });
        expect(() => parseEvolutionResponse(raw(nested), strict)).toThrow("required Gateway snapshot");
      }
      const dated = response(alias);
      dated.providerMetadata!.gateway.routing.resolvedProviderApiModelId = "gpt-4o-2024-05-13";
      expect(parseEvolutionResponse(raw(dated), alias).identity).toMatchObject({
        qualification: "gateway-alias", snapshotPinned: false, resolvedSnapshot: "gpt-4o-2024-05-13" });
      expect(() => parseEvolutionResponse(mutate(dated, value => { value.providerMetadata.gateway.routing.finalProvider = "azure"; }), alias)).toThrow("provider mismatch");
      expect(() => parseEvolutionResponse(mutate(dated, value => { delete value.providerMetadata; }), alias)).toThrow("Gateway metadata");
      expect(() => makeEvolutionRequest(aliasId, messages)).toThrow("prompt shape");
      expect(() => validateEvolutionRequest({ ...strict, profileId: aliasId })).toThrow("request changed");
    }
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

  test("nano reasoning treatments keep matched inputs and costs while rejecting cache transplants", () => {
    const low = makeEvolutionRequest("gpt5-nano-reader", messages);
    const profiles = [["gpt5-nano-medium-reader", "medium"], ["gpt5-nano-high-reader", "high"]] as const;
    const hashes = new Set([low.requestSha256]);
    for (const [id, effort] of profiles) {
      const request = makeEvolutionRequest(id, messages);
      expect(request.body).toEqual({ ...low.body, reasoning: { effort } });
      expect(request.reservationMicros).toBe(low.reservationMicros);
      expect(request.inputUpperBound).toBe(low.inputUpperBound);
      expect(request.profileSha256).not.toBe(low.profileSha256);
      const capture = raw(response(request));
      expect(parseEvolutionResponse(capture, request).usage).toEqual(parseEvolutionResponse(capture, low).usage);
      const transplant = { ...request, profileId: low.profileId };
      expect(() => validateEvolutionRequest(transplant)).toThrow("request changed");
      hashes.add(request.requestSha256);
    }
    expect(hashes.size).toBe(3);
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
