import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../src/graph";
import { extractOhEventInventoryV1, prepareOhEventInventoryV1, resolveOhEventInventoryV1,
  extractOhEventInventoryV2, prepareOhEventInventoryV2, resolveOhEventInventoryV2,
  OH_EVENT_INVENTORY_PROTOCOL_V1, OH_EVENT_INVENTORY_PROTOCOL_V2 } from "../scripts/benchmarks/oh-event-inventory";

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
