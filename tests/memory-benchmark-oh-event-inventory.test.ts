import { expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../src/graph";
import { extractOhEventInventoryV1, prepareOhEventInventoryV1, resolveOhEventInventoryV1 } from "../scripts/benchmarks/oh-event-inventory";

const record = (id: string, text: string, day = 10) => createKnowledgeGraphRecordV1({ key: `edition:${id}`, kind: "edition", v: 1,
  dependencies: [], value: { text, speaker: "Nia", observedAt: `2035-04-${String(day).padStart(2, "0")}T12:00:00.000Z` } });
const cite = (row: KnowledgeGraphRecordV1) => ({ key: row.key, recordSha256: row.recordSha256, quote: (row.value as { text: string }).text });
const mention = (id: string, row: KnowledgeGraphRecordV1, date: string | null = null, kind = "event") => ({ id, kind, source: cite(row), timeExpression: date, facet: id });
const input = (records: KnowledgeGraphRecordV1[], mode = "event-time", asOf: string | null = null) => ({
  question: "Which stages of Nia's invented sculpture project are established, and in what order?", mode,
  granularity: "Separate sketch, carving, polishing and exhibition; preserve repeats as mentions.", asOf,
  sources: records.map((record, turnOrder) => ({ record, sessionOrder: 0, turnOrder })) });
const proposal = (plan: ReturnType<typeof prepareOhEventInventoryV1>, mentions: unknown[], links: unknown[] = []) => ({ requestSha256: plan.requestSha256, mentions, links });

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
