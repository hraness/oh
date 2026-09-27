import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../src/graph";
import { extractOhEventInventoryV1, prepareOhEventInventoryV1, resolveOhEventInventoryV1,
  extractOhEventInventoryV2, prepareOhEventInventoryV2, resolveOhEventInventoryV2,
  extractOhEventInventoryV3, prepareOhEventInventoryV3, resolveOhEventInventoryV3,
  OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT, OH_EVENT_INVENTORY_V3_SCHEMA_SHA256,
  OH_EVENT_INVENTORY_PROTOCOL_V1, OH_EVENT_INVENTORY_PROTOCOL_V2, OH_EVENT_INVENTORY_PROTOCOL_V3 } from "../scripts/benchmarks/oh-event-inventory";

const record = (id: string, text: string, day = 10) => createKnowledgeGraphRecordV1({ key: `edition:${id}`, kind: "edition", v: 1,
  dependencies: [], value: { text, speaker: "Nia", observedAt: `2035-04-${String(day).padStart(2, "0")}T12:00:00.000Z` } });
const cite = (row: KnowledgeGraphRecordV1) => ({ key: row.key, recordSha256: row.recordSha256, quote: (row.value as { text: string }).text });
const mention = (id: string, row: KnowledgeGraphRecordV1, date: string | null = null, kind = "event") => ({ id, kind, source: cite(row), timeExpression: date, facet: id });
const input = (records: KnowledgeGraphRecordV1[], mode = "event-time", asOf: string | null = null) => ({
  question: "Which stages of Nia's invented sculpture project are established, and in what order?", mode,
  granularity: "Separate sketch, carving, polishing and exhibition; preserve repeats as mentions.", asOf,
  sources: records.map((record, turnOrder) => ({ record, sessionOrder: 0, turnOrder })) });
const proposal = (plan: { requestSha256: string }, mentions: unknown[], links: unknown[] = []) => ({ requestSha256: plan.requestSha256, mentions, links });

test("injected extraction connects source-only request to partial ordering and keeps semantic caveat", async () => {
  const carve = record("carve", "I carved it on 2035-03-20."), sketch = record("sketch", "I sketched it on 2035-03-10.", 11);
  let calls = 0;
  const result = await extractOhEventInventoryV1(input([carve, sketch]), async request => {
    calls++; expect(request.prompt).toContain("Separate sketch, carving"); expect(request.prompt).toContain(carve.recordSha256);
    expect(request.maximumResponseBytes).toBe(262_144);
    return { requestSha256: request.requestSha256, mentions: [mention("carve", carve, "2035-03-20"), mention("sketch", sketch, "2035-03-10")], links: [] };
  });
  expect(calls).toBe(1); expect(result.pairs[0]?.relation).toBe("after");
  expect(result.semanticValidation).toBe("unverified-model-assertions"); expect(result.coverage).toBe("partial");
  const { resultSha256, ...payload } = result; expect(resultSha256).toBe(canonicalSha256(payload));
  expect(Object.isFrozen(result.mentions[0]?.source)).toBeTrue();
});

test("event time and mention order intentionally differ; unknown event dates never borrow statement dates", () => {
  const a = record("a", "Carved on 2035-03-20."), b = record("b", "Sketched on 2035-03-10.", 11);
  for (const mode of ["event-time", "mention-order"]) {
    const plan = prepareOhEventInventoryV1(input([a, b], mode));
    const resolved = resolveOhEventInventoryV1(plan, proposal(plan, [mention("a", a, "2035-03-20"), mention("b", b, "2035-03-10")]));
    expect(resolved.pairs[0]?.relation).toBe(mode === "event-time" ? "after" : "before");
    expect(resolveOhEventInventoryV1(plan, proposal(plan, [mention("a", a), mention("b", b)])).pairs[0]?.relation)
      .toBe(mode === "event-time" ? "unknown" : "before");
  }
});

test("distinct stages in the same message stay unordered in mention mode", () => {
  const a = record("a", "The sketch and the carving were discussed together."), plan = prepareOhEventInventoryV1(input([a], "mention-order"));
  const result = resolveOhEventInventoryV1(plan, proposal(plan, [mention("sketch", a), mention("carve", a)]));
  expect(result.pairs[0]?.relation).toBe("unknown");
});

test("historical cutoff excludes future and undated source bytes before transport; cancellations preserve history", async () => {
  const a = record("a", "I plan to exhibit on 2035-06-01.", 1), b = record("b", "I cancelled that exhibition.", 3);
  const unknown = createKnowledgeGraphRecordV1({ key: "edition:undated", kind: "edition", v: 1, dependencies: [], value: { text: "Undated secret correction." } });
  const full = prepareOhEventInventoryV1(input([a, b]));
  const links = [{ id: "cancel", kind: "cancels", from: "b", to: "a", source: cite(b) }];
  const result = resolveOhEventInventoryV1(full, proposal(full, [mention("a", a, null, "plan"), mention("b", b, null, "plan")], links));
  expect(result.states[0]?.current[0]?.state).toBe("cancelled"); expect(result.states[0]?.history).toHaveLength(2);
  const past = await extractOhEventInventoryV1(input([a, b, unknown], "event-time", "2035-04-02T00:00:00.000Z"), async request => {
    expect(request.prompt).not.toContain("cancelled"); expect(request.prompt).not.toContain("secret correction");
    return { requestSha256: request.requestSha256, mentions: [mention("a", a, null, "plan"), mention("b", b, null, "plan")], links };
  });
  expect(past.omittedSources).toBe(2); expect(past.mentions[1]?.support).toBe("missing-source");
  expect(past.states[0]?.current[0]?.mention.id).toBe("a"); expect(past.states[0]?.status).toBe("unresolved");
});

test("explicit repeated-event identity deduplicates groups, while contradictions remain visible", () => {
  const a = record("a", "I sketched it on 2035-03-10."), b = record("b", "That same sketch was on 2035-03-10."), c = record("c", "Carved on 2035-03-20.");
  const plan = prepareOhEventInventoryV1(input([a, b, c]));
  const links = [{ id: "same", kind: "same-event", from: "a", to: "b", source: cite(b) }];
  const mentions = [mention("a", a, "2035-03-10"), mention("b", b, "2035-03-10"), mention("c", c, "2035-03-20")];
  const result = resolveOhEventInventoryV1(plan, proposal(plan, mentions, links));
  expect(result.identity.groups).toEqual([["a", "b"], ["c"]]); expect(result.pairs).toHaveLength(1);
  expect(result.pairs[0]?.relation).toBe("before");
  const contradiction = resolveOhEventInventoryV1(plan, proposal(plan, mentions, [...links, { ...links[0], id: "different", kind: "distinct-event" }]));
  expect(contradiction.identity.conflicts.length).toBeGreaterThan(0);
});

test("same-event contradictory dates and mixed temporal cycles do not silently produce a total order", () => {
  const a = record("a", "Stage A happened on 2035-03-10."), b = record("b", "Stage B happened on 2035-03-20."), c = record("c", "Stage C came after B and before A.");
  const plan = prepareOhEventInventoryV1(input([a, b, c]));
  const mentions = [mention("a", a, "2035-03-10"), mention("b", b, "2035-03-20"), mention("c", c)];
  const links = [{ id: "bc", kind: "before", from: "b", to: "c", source: cite(c) }, { id: "ca", kind: "before", from: "c", to: "a", source: cite(c) }];
  const result = resolveOhEventInventoryV1(plan, proposal(plan, mentions, links));
  expect(result.pairs.some(pair => pair.relation === "conflict") || result.cyclic).toBeTrue();
  const same = resolveOhEventInventoryV1(plan, proposal(plan, mentions, [{ id: "same", kind: "same-event", from: "a", to: "b", source: cite(b) }]));
  expect(same.identity.conflicts).toContain("a:b");
});

test("unsupported citations, stale digests and suggestions cannot establish event order", () => {
  const a = record("a", "A on 2035-03-10."), b = record("b", "Perhaps B on 2035-03-20."), plan = prepareOhEventInventoryV1(input([a, b]));
  const bad = { ...mention("a", a, "2035-03-10"), source: { ...cite(a), recordSha256: "0".repeat(64) } };
  const result = resolveOhEventInventoryV1(plan, proposal(plan, [bad, mention("b", b, "2035-03-20", "suggestion")]));
  expect(result.mentions[0]?.support).toBe("stale-source"); expect(result.pairs).toEqual([]);
  const missing = prepareOhEventInventoryV1(input([]));
  expect(resolveOhEventInventoryV1(missing, proposal(missing, [mention("a", a)])).identity.groups).toEqual([]);
});

test("request identity and source bounds reject changed inputs before dispatch; transport errors are not retried", async () => {
  const a = record("a", "Invented source"), data = input([a]), plan = prepareOhEventInventoryV1(data);
  const changed = prepareOhEventInventoryV1({ ...data, granularity: "Different granularity" });
  expect(() => resolveOhEventInventoryV1(changed, proposal(plan, []))).toThrow("request mismatch");
  expect(() => resolveOhEventInventoryV1({ ...plan, prompt: "tampered" }, proposal(plan, []))).toThrow("identity mismatch");
  expect(() => prepareOhEventInventoryV1({ ...data, answer: "Forbidden reference" })).toThrow("exact fields");
  expect(() => prepareOhEventInventoryV1({ ...data, sources: [...data.sources, ...data.sources] })).toThrow();
  expect(() => resolveOhEventInventoryV1(plan, `{"requestSha256":"${plan.requestSha256}","mentions":[],"mentions":[],"links":[]}`)).toThrow();
  expect(() => resolveOhEventInventoryV1(plan, proposal(plan, Array.from({ length: 49 }, (_, i) => mention(String(i), a))))).toThrow("array bound");
  let calls = 0;
  await expect(extractOhEventInventoryV1(data, async () => { calls++; throw new Error("uncertain dispatch"); })).rejects.toThrow("uncertain dispatch");
  expect(calls).toBe(1);
});

test("source storage permutation and unrelated insertion preserve pair relations", () => {
  const a = record("a", "A on 2035-03-10."), b = record("b", "B on 2035-03-20."), noise = record("noise", "An unrelated lamp."), data = input([a, b]);
  const baseline = prepareOhEventInventoryV1(data);
  const modified = prepareOhEventInventoryV1({ ...data, sources: [{ record: noise, sessionOrder: 5, turnOrder: 0 }, ...data.sources.toReversed()] });
  const mentions = [mention("a", a, "2035-03-10"), mention("b", b, "2035-03-20")];
  expect(resolveOhEventInventoryV1(modified, proposal(modified, mentions)).pairs).toEqual(resolveOhEventInventoryV1(baseline, proposal(baseline, mentions)).pairs);
});

test("self-loop is a conflict even for one event or inside an identity group", () => {
  const a = record("a", "A happened."), b = record("b", "The same A happened."), plan = prepareOhEventInventoryV1(input([a, b]));
  const self = { id: "self", kind: "before", from: "a", to: "a", source: cite(a) };
  const alone = resolveOhEventInventoryV1(plan, proposal(plan, [mention("a", a)], [self]));
  expect(alone.cyclic).toBeTrue(); expect(alone.identity.conflicts).toContain("a:a");
  const group = resolveOhEventInventoryV1(plan, proposal(plan, [mention("a", a), mention("b", b)],
    [self, { id: "same", kind: "same-event", from: "a", to: "b", source: cite(b) }]));
  expect(group.cyclic).toBeTrue(); expect(group.identity.conflicts).toContain("a:a");
  const loop = resolveOhEventInventoryV1(plan, proposal(plan, [mention("a", a), mention("b", b)],
    [{ ...self, to: "b" }, { ...self, id: "back", from: "b" }]));
  expect(loop.pairs[0]?.relation).toBe("conflict"); expect(loop.cyclic).toBeTrue();
});

test("V1 invented plan, prompt and result bytes remain replay-compatible including historical omission", () => {
  // Captured from V1 before adding the successor; these are invented sources, not benchmark data.
  const records = [record("archive-sketch", "I sketched it on 2035-03-10."), record("archive-carve", "I carved it on 2035-03-20.", 11)];
  const fixtures = [
    { asOf: null, requestSha256: "25d890a6838b95b44eebf1e17fd41bfcbdc29c9631e305c82d7259c4f8ede13d",
      planBytes: "fccddfbc971d23eac3dca69a2b5ed93c0764e9843f63f788d476177e3c316425",
      promptBytes: "1686507786530d3b13b8e73016595c6255e14d8a4dcb074d5a245193481038cf",
      resultBytes: "6ffaf144c0a71e74b8f87fd3ef195c399f92924b2a11be093c0779d64b74b4ea" },
    { asOf: "2035-04-10T23:59:59.999Z", requestSha256: "0438a8c0a87018ec3798f0e1c789753a14b3c13f36f44b5ef49752e8a64422df",
      planBytes: "0ed0349946235591b9806b593d61569ac70efc172fb19409efb8e2f76d5b6bc4",
      promptBytes: "df9545effd86dd406b3e508c29e7b6a40eff84992026c0d9794648194d242b56",
      resultBytes: "c489c6763e324baae66f9b803e1a71ed34b0496c536da46b0bec51030345d1bd" },
  ];
  for (const fixture of fixtures) {
    const plan = prepareOhEventInventoryV1(input(records, "event-time", fixture.asOf));
    expect(plan.protocol).toBe(OH_EVENT_INVENTORY_PROTOCOL_V1);
    expect(plan.requestSha256).toBe(fixture.requestSha256);
    expect(sha256Hex(JSON.stringify(plan))).toBe(fixture.planBytes);
    expect(sha256Hex(plan.prompt)).toBe(fixture.promptBytes);
    const replay = JSON.parse(JSON.stringify(plan)) as typeof plan;
    const mentions = replay.sources.map(({ record: source }) => mention(source.key, source,
      cite(source).quote.includes("sketched") ? "2035-03-10" : "2035-03-20"));
    const result = resolveOhEventInventoryV1(replay, proposal(replay, mentions));
    expect(sha256Hex(JSON.stringify(result))).toBe(fixture.resultBytes);
    expect(result.omittedSources).toBe(fixture.asOf === null ? 0 : 1);
  }
});

test("V2 requests one-source citations and computes date order without model before links", async () => {
  const later = record("later", "I varnished the model on 2035-03-21."), earlier = record("earlier", "I assembled the model on 2035-03-18.", 11);
  let calls = 0;
  const result = await extractOhEventInventoryV2(input([later, earlier]), async request => {
    calls++;
    expect(request.prompt).toContain("exactly ONE existing source key and recordSha256");
    expect(request.prompt).toContain("Never concatenate source keys, digests, or quotes");
    expect(request.prompt).toContain("only when explicit language in its cited source establishes the relation");
    expect(request.prompt).toContain("Order implied by dates is computed locally");
    expect(request.prompt).toContain("minimal exact date substring excluding surrounding punctuation");
    expect(request.maximumResponseBytes).toBe(262_144);
    return proposal(request, [mention("later", later, "2035-03-21"), mention("earlier", earlier, "2035-03-18")]);
  });
  expect(calls).toBe(1); expect(result.protocol).toBe(OH_EVENT_INVENTORY_PROTOCOL_V2);
  expect(result.links).toEqual([]);
  expect(result.pairs).toEqual([{ left: ["earlier"], right: ["later"], relation: "before" }]);
  expect(result.mentions.map(row => row.timeStatus)).toEqual(["resolved", "resolved"]);
  expect(result.semanticValidation).toBe("unverified-model-assertions"); expect(result.coverage).toBe("partial");
  const { resultSha256, ...payload } = result; expect(resultSha256).toBe(canonicalSha256(payload));
});

test("V2 does not repair composite citations or punctuation-bearing date expressions", () => {
  const a = record("a", "A happened on 2035-03-10."), b = record("b", "B happened on 2035-03-20.");
  const plan = prepareOhEventInventoryV2(input([a, b]));
  const mentions = [mention("a", a, "2035-03-10"), mention("b", b, "2035-03-20")];
  const composite = { key: `${a.key}+${b.key}`, recordSha256: `${a.recordSha256}+${b.recordSha256}`,
    quote: `${cite(a).quote}\n${cite(b).quote}` };
  expect(() => resolveOhEventInventoryV2(plan, proposal(plan, mentions,
    [{ id: "invalid", kind: "before", from: "a", to: "b", source: composite }]))).toThrow("citation digest");
  const punctuated = resolveOhEventInventoryV2(plan, proposal(plan, [mention("a", a, "2035-03-10.")]));
  expect(punctuated.mentions[0]?.timeExpression).toBe("2035-03-10.");
  expect(punctuated.mentions[0]?.timeStatus).toBe("unknown"); expect(punctuated.mentions[0]?.interval).toBeNull();
});

test("V1 and V2 plans and responses cannot cross versions", () => {
  const data = input([record("a", "A happened.")]), v1 = prepareOhEventInventoryV1(data), v2 = prepareOhEventInventoryV2(data);
  expect(v2.requestSha256).not.toBe(v1.requestSha256); expect(v2.promptSha256).not.toBe(v1.promptSha256);
  expect(() => resolveOhEventInventoryV1(v1, proposal(v2, []))).toThrow("request mismatch");
  expect(() => resolveOhEventInventoryV2(v2, proposal(v1, []))).toThrow("request mismatch");
  expect(() => resolveOhEventInventoryV1(v2 as unknown as typeof v1, proposal(v2, []))).toThrow("plan identity mismatch");
  expect(() => resolveOhEventInventoryV2(v1 as unknown as typeof v2, proposal(v1, []))).toThrow("plan identity mismatch");
  expect(() => resolveOhEventInventoryV2({ ...v2, prompt: v1.prompt }, proposal(v2, []))).toThrow("plan identity mismatch");
});

test("V2 historical cutoff filters before transport and transport failures have one attempt", async () => {
  const a = record("a", "I plan to exhibit on 2035-06-01.", 1), b = record("b", "I cancelled the exhibition.", 3);
  const result = await extractOhEventInventoryV2(input([a, b], "event-time", "2035-04-02T00:00:00.000Z"), async request => {
    expect(request.prompt).not.toContain("cancelled the exhibition"); expect(request.prompt).not.toContain(b.recordSha256);
    return proposal(request, [mention("a", a, "2035-06-01", "plan")]);
  });
  expect(result.omittedSources).toBe(1); expect(result.states[0]?.current[0]?.mention.id).toBe("a");
  let calls = 0;
  await expect(extractOhEventInventoryV2(input([a]), async () => { calls++; throw new Error("uncertain dispatch"); }))
    .rejects.toThrow("uncertain dispatch");
  expect(calls).toBe(1);
});

test("V2 invented plan, prompt and result bytes remain replay-compatible after V3 addition", () => {
  const records = [record("archive-sketch", "I sketched it on 2035-03-10."), record("archive-carve", "I carved it on 2035-03-20.", 11)];
  // Captured before V3 changes; no benchmark data or provider calls.
  const fixtures = [
    { asOf: null, requestSha256: "c35f13067542c75a01f7bc033572a293507f70d346fb05e42a92547df9f218cd",
      planBytes: "611618841ccb9817efe15b4cc9597ec1a8954a84542ee4f39e8601e41b6d2df8",
      promptBytes: "758ea7aee8500ae0140d8d47c4dd5d9740cafdc98586f679f4f12673bacfcfc7",
      resultBytes: "f6c7122c978779732b21141064833c5f7cae318fe70da6cd54f9956132904cb8" },
    { asOf: "2035-04-10T23:59:59.999Z", requestSha256: "82aa8085332244246bece3063edacc0562e51d04759e47cde6830da4eb5de471",
      planBytes: "6d92a40d64a9d873ab2c835b5465c40461db57774ec4f1fea5ba1263c985956c",
      promptBytes: "1aaae2ad5a2f02b2427cd08b2cb512a1ddb5b7105ede4c087fe8d2d56299baf6",
      resultBytes: "1f221ec7ac6c13f91ff49ec8b88bcabe5ac098d6cc1d8f4746efd9a0ae3de297" },
  ];
  for (const fixture of fixtures) {
    const plan = prepareOhEventInventoryV2(input(records, "event-time", fixture.asOf));
    expect(plan.requestSha256).toBe(fixture.requestSha256); expect(sha256Hex(JSON.stringify(plan))).toBe(fixture.planBytes);
    expect(sha256Hex(plan.prompt)).toBe(fixture.promptBytes);
    const replay = JSON.parse(JSON.stringify(plan)) as typeof plan;
    const mentions = replay.sources.map(({ record: source }) => mention(source.key, source,
      cite(source).quote.includes("sketched") ? "2035-03-10" : "2035-03-20"));
    expect(sha256Hex(JSON.stringify(resolveOhEventInventoryV2(replay, proposal(replay, mentions))))).toBe(fixture.resultBytes);
  }
});

const mentionV3 = (id: string, handle: string, source: KnowledgeGraphRecordV1, date: string | null = null, kind = "event") =>
  ({ id, kind, source: { handle, quote: cite(source).quote }, timeExpression: date, facet: id });

test("V3 sends handles and a frozen strict schema; only code reconstructs source identities", async () => {
  const later = record("private-later", "I varnished the model on 2035-03-21."), earlier = record("private-earlier", "I assembled it on 2035-03-18.", 11);
  let calls = 0;
  const result = await extractOhEventInventoryV3(input([later, earlier]), async request => {
    calls++; const wire = JSON.stringify(request);
    for (const source of [later, earlier]) { expect(wire).not.toContain(source.key); expect(wire).not.toContain(source.recordSha256); }
    expect(wire).not.toContain("recordSha256");
    expect(request.prompt).toContain('"handle":"s0"'); expect(request.prompt).toContain('"handle":"s1"');
    expect(request.prompt).toContain("when no relevant evidence supports an inventory");
    expect(request.responseFormat).toBe(OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT);
    expect(request.responseFormat.json_schema.strict).toBeTrue();
    expect(canonicalSha256(request.responseFormat)).toBe(OH_EVENT_INVENTORY_V3_SCHEMA_SHA256);
    expect(Object.isFrozen(request.responseFormat.json_schema.schema.properties.mentions.items.properties.kind.enum)).toBeTrue();
    return proposal(request, [mentionV3("m0", "s0", later, "2035-03-21"), mentionV3("m1", "s1", earlier, "2035-03-18")]);
  });
  expect(calls).toBe(1); expect(result.protocol).toBe(OH_EVENT_INVENTORY_PROTOCOL_V3);
  expect(result.pairs).toEqual([{ left: ["m0"], right: ["m1"], relation: "after" }]);
  expect(result.mentions[0]?.source).toEqual(cite(later)); expect(result.mentions[1]?.source).toEqual(cite(earlier));
  expect(result.semanticValidation).toBe("unverified-model-assertions"); expect(result.coverage).toBe("partial");
  const { resultSha256, ...payload } = result; expect(resultSha256).toBe(canonicalSha256(payload));
});

test("V3 fixed schema admits empty arrays, bounded handles, enumerated kinds and exact reference objects", () => {
  const schema = OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT.json_schema.schema;
  expect(schema.additionalProperties).toBeFalse();
  expect(schema.properties.mentions).toMatchObject({ type: "array", maxItems: 48 });
  expect(schema.properties.links).toMatchObject({ type: "array", maxItems: 96 });
  expect("minItems" in schema.properties.mentions).toBeFalse(); expect("minItems" in schema.properties.links).toBeFalse();
  expect(schema.properties.mentions.items.properties.kind.enum).toEqual(["event", "state", "plan", "suggestion", "unclear"]);
  expect(schema.properties.mentions.items.properties.source).toMatchObject({ additionalProperties: false, required: ["handle", "quote"] });
  const handle = new RegExp(schema.properties.mentions.items.properties.source.properties.handle.pattern);
  for (const value of ["s0", "s9", "s99", "s100", "s199", "s249", "s255"]) expect(handle.test(value)).toBeTrue();
  for (const value of ["s256", "s00", "s-1", "edition:any", "s1+s2"]) expect(handle.test(value)).toBeFalse();
  const plan = prepareOhEventInventoryV3(input([record("no-support", "A lamp is green.")]));
  const result = resolveOhEventInventoryV3(plan, proposal(plan, []));
  expect(result.mentions).toEqual([]); expect(result.links).toEqual([]); expect(result.pairs).toEqual([]);
});

test("V3 rejects ungrounded references, composite or absent handles, old citation shapes and invented dates", () => {
  const a = record("a", "Sketch on 2035-03-10."), b = record("b", "Carving on 2035-03-20.");
  const plan = prepareOhEventInventoryV3(input([a, b])), good = mentionV3("m0", "s0", a, "2035-03-10");
  for (const source of [
    { ...good.source, handle: "s2" }, { ...good.source, handle: "s256" }, { ...good.source, handle: "s0+s1" },
    { ...good.source, handle: "s00" }, { ...good.source, handle: "s0\n" },
    { ...good.source, quote: "Made up event." }, { ...good.source, quote: `${cite(a).quote} ${cite(b).quote}` },
    { ...good.source, key: a.key }, cite(a),
  ]) expect(() => resolveOhEventInventoryV3(plan, proposal(plan, [{ ...good, source }]))).toThrow();
  for (const patch of [{ id: "m48" }, { id: "m0\n" }, { id: "m00" }, { kind: "happening" }, { timeExpression: "2035-03-11" }, { unexpected: true }])
    expect(() => resolveOhEventInventoryV3(plan, proposal(plan, [{ ...good, ...patch }]))).toThrow();
  const repeated = record("repeat", "Repeat. Repeat."), repeatPlan = prepareOhEventInventoryV3(input([repeated]));
  expect(() => resolveOhEventInventoryV3(repeatPlan, proposal(repeatPlan, [{ ...mentionV3("m0", "s0", repeated), source: { handle: "s0", quote: "Repeat." } }]))).toThrow("unique source span");
  const repeatedDate = record("repeat-date", "2035-03-10 and 2035-03-10."), datePlan = prepareOhEventInventoryV3(input([repeatedDate]));
  expect(() => resolveOhEventInventoryV3(datePlan, proposal(datePlan, [mentionV3("m0", "s0", repeatedDate, "2035-03-10")]))).toThrow("unique quote span");
});

test("V3 validates link endpoints and identity, preserves duplicate-event conflicts and temporal cycles", () => {
  const a = record("a", "A on 2035-03-10; before B."), b = record("b", "B on 2035-03-20; before A.");
  const plan = prepareOhEventInventoryV3(input([a, b])), mentions = [mentionV3("m0", "s0", a, "2035-03-10"), mentionV3("m1", "s1", b, "2035-03-20")];
  const link = { id: "l0", kind: "before", from: "m0", to: "m1", source: { handle: "s0", quote: cite(a).quote } };
  for (const patch of [{ id: "l96" }, { id: "l0\n" }, { kind: "after" }, { from: "m2" }, { to: "m48" }, { to: "m1+m0" }, { extra: true }])
    expect(() => resolveOhEventInventoryV3(plan, proposal(plan, mentions, [{ ...link, ...patch }]))).toThrow();
  expect(() => resolveOhEventInventoryV3(plan, proposal(plan, [...mentions, mentions[0]]))).toThrow("duplicate mention");
  expect(() => resolveOhEventInventoryV3(plan, proposal(plan, mentions, [link, link]))).toThrow("duplicate link");
  const cycle = resolveOhEventInventoryV3(plan, proposal(plan, mentions, [link, { ...link, id: "l1", from: "m1", to: "m0", source: { handle: "s1", quote: cite(b).quote } }]));
  expect(cycle.cyclic).toBeTrue(); expect(cycle.pairs[0]?.relation).toBe("conflict");
  const identity = resolveOhEventInventoryV3(plan, proposal(plan, mentions, [{ ...link, kind: "same-event" }]));
  expect(identity.identity.conflicts).toContain("m0:m1");
});

test("V3 cutoff assigns handles after filtering and mutable maps, prompts or schemas fail replay", async () => {
  const old = record("old", "I will exhibit on 2035-06-01.", 1), future = record("future", "I cancelled the exhibition.", 3);
  const data = input([old, future], "event-time", "2035-04-02T00:00:00.000Z"), plan = prepareOhEventInventoryV3(data);
  expect(plan.sources.map(source => source.handle)).toEqual(["s0"]); expect(plan.omittedSources).toBe(1);
  expect(plan.prompt).not.toContain("cancelled"); expect(plan.prompt).not.toContain("s1");
  const good = proposal(plan, [mentionV3("m0", "s0", old, "2035-06-01", "plan")]);
  expect(resolveOhEventInventoryV3(JSON.parse(JSON.stringify(plan)), good).omittedSources).toBe(1);
  const mutations = [
    (copy: Record<string, any>) => { copy.sources[0].handle = "s1"; },
    (copy: Record<string, any>) => { copy.sources[0].record.recordSha256 = "0".repeat(64); },
    (copy: Record<string, any>) => { copy.prompt += "Changed"; },
    (copy: Record<string, any>) => { copy.responseFormat.json_schema.strict = false; },
    (copy: Record<string, any>) => { copy.responseFormatSha256 = "0".repeat(64); },
  ];
  for (const mutate of mutations) { const copy = structuredClone(plan); mutate(copy); expect(() => resolveOhEventInventoryV3(copy, good)).toThrow(); }
  for (const legacy of [prepareOhEventInventoryV1(data), prepareOhEventInventoryV2(data)]) {
    expect(plan.requestSha256).not.toBe(legacy.requestSha256);
    expect(() => resolveOhEventInventoryV3(plan, { ...good, requestSha256: legacy.requestSha256 })).toThrow("request mismatch");
    expect(() => resolveOhEventInventoryV3(legacy as unknown as typeof plan, good)).toThrow();
  }
  expect(() => resolveOhEventInventoryV1(plan as never, good)).toThrow(); expect(() => resolveOhEventInventoryV2(plan as never, good)).toThrow();
  expect(() => prepareOhEventInventoryV3({ ...data, referenceAnswer: "Forbidden" })).toThrow("exact fields");
  expect(() => resolveOhEventInventoryV3(plan, `{"requestSha256":"${plan.requestSha256}","mentions":[],"mentions":[],"links":[]}`)).toThrow();
  let calls = 0;
  await expect(extractOhEventInventoryV3(data, async () => { calls++; throw new Error("uncertain dispatch"); })).rejects.toThrow("uncertain dispatch");
  expect(calls).toBe(1);
});
