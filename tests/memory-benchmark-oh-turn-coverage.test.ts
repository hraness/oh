import { expect, test } from "bun:test";
import fc from "fast-check";
import { createKnowledgeGraphRecordV1 } from "../src/graph";
import { canonicalSha256 } from "../src/canonical";
import { prepareOhTurnCoverageV1, resolveOhTurnCoverageV1, prepareOhTurnGroupingV1,
  resolveOhTurnGroupingV1, renderOhTurnGroupingV1 } from "../scripts/benchmarks/oh-turn-coverage";

const source = (id: string, text: string, turnOrdinal: number, speaker = "user", sessionOrdinal = 0,
  observedAt: string | null = "2036-01-01T00:00:00.000Z") => ({ sessionOrdinal, turnOrdinal,
  record: createKnowledgeGraphRecordV1({ key: `edition:${id}`, kind: "edition", v: 1, dependencies: [],
    value: { text, speaker, ...(observedAt === null ? {} : { observedAt }) } }) });
const input = (sources: ReturnType<typeof source>[], asOf: string | null = null) => ({ sources, asOf });
const candidate = (facet: string, quote: string, context: { handle: string; quote: string }[] = []) =>
  ({ facet, quote, stance: "raised", context });
const row = (handle: string, mentions: ReturnType<typeof candidate>[], status = "candidate") =>
  ({ handle, status, reason: "Explicit topical content.", mentions });
const response = (plan: ReturnType<typeof prepareOhTurnCoverageV1>, rows: ReturnType<typeof row>[]) =>
  [{ requestSha256: plan.batches[0]!.requestSha256, users: rows }];

test("every user turn is accounted for; primary citations cannot use assistant text", () => {
  const plan = prepareOhTurnCoverageV1(input([source("a", "Use paper.", 2), source("b", "Also use ink.", 3, "assistant"),
    source("c", "I need a ruler.", 10)]));
  const valid = response(plan, [row("s0000", [candidate("paper", "paper")]), row("s0002", [candidate("ruler", "ruler")])]);
  expect(resolveOhTurnCoverageV1(plan, valid).mentions).toHaveLength(2);
  expect(() => resolveOhTurnCoverageV1(plan, response(plan, [valid[0]!.users[0]!]))).toThrow();
  expect(() => resolveOhTurnCoverageV1(plan, response(plan, [...valid[0]!.users, row("s0001", [candidate("ink", "ink")])]))).toThrow();
  expect(() => resolveOhTurnCoverageV1(plan, response(plan, [row("s0000", [candidate("ink", "ink")]), valid[0]!.users[1]!]))).toThrow();
});

test("storage permutations and excluded future records cannot change model-visible extraction", () => {
  const a = source("a", "Paper.", 2), b = source("b", "Ink.", 10), asOf = "2036-01-02T00:00:00.000Z";
  const expected = prepareOhTurnCoverageV1(input([a, b], asOf));
  fc.assert(fc.property(fc.shuffledSubarray([a, b], { minLength: 2, maxLength: 2 }), sources => {
    expect(prepareOhTurnCoverageV1(input(sources, asOf)).batches).toEqual(expected.batches);
  }));
  const future = source("future", "FUTURE_SECRET.", 12, "user", 0, "2036-02-01T00:00:00.000Z");
  const undated = source("undated", "UNDATED_SECRET.", 14, "user", 0, null);
  const extended = prepareOhTurnCoverageV1(input([future, b, undated, a], asOf));
  expect(extended.batches).toEqual(expected.batches);
  expect(JSON.stringify(extended.batches)).not.toContain("SECRET");
});

test("anaphoric context must be earlier in the same session and inside the declared window", () => {
  const plan = prepareOhTurnCoverageV1(input([source("a", "Try paper.", 0, "assistant"), source("b", "Yes, paper.", 1),
    source("c", "Try ink.", 2, "assistant"), source("d", "Yes, that.", 3)]));
  const valid = [row("s0001", [candidate("paper", "paper")]),
    row("s0003", [candidate("ink", "Yes, that.", [{ handle: "s0002", quote: "ink" }])])];
  const coverage = resolveOhTurnCoverageV1(plan, response(plan, valid));
  expect(coverage.mentions[1]!.source.turnOrdinal).toBe(3);
  for (const handle of ["s0003", "s0000"]) {
    expect(() => resolveOhTurnCoverageV1(plan, response(plan, [valid[0]!,
      row("s0003", [candidate("ink", "Yes, that.", [{ handle, quote: handle === "s0003" ? "Yes, that." : "paper" }])])]))).toThrow();
  }
});

test("grouping retains all candidate dispositions and computes earliest user mentions with ties", () => {
  const plan = prepareOhTurnCoverageV1(input([source("a", "Paper and ink.", 2), source("b", "More paper.", 10)]));
  const coverage = resolveOhTurnCoverageV1(plan, response(plan, [row("s0000", [candidate("paper", "Paper"), candidate("ink", "ink")]),
    row("s0001", [candidate("paper", "paper")])]));
  const groupPlan = prepareOhTurnGroupingV1(plan, coverage, "Writing supplies discussed by the user.");
  const proposal = { requestSha256: groupPlan.requestSha256, groups: [
    { label: "paper", memberIds: ["m0000", "m0002"], reason: "Repeated supply." },
    { label: "ink", memberIds: ["m0001"], reason: "Distinct supply." }], excluded: [], unresolved: [], ambiguities: [] };
  const result = resolveOhTurnGroupingV1(plan, coverage, groupPlan, proposal);
  expect(result.order).toEqual([["g0000", "g0001"]]);
  expect(result.groups[0]!.earliestAcceptedUserPosition).toEqual({ sessionOrdinal: 0, turnOrdinal: 2 });
  const rendered = JSON.parse(renderOhTurnGroupingV1(plan, coverage, groupPlan, result, { requestedCount: 1, maximumBytes: 32_768 }));
  expect(rendered.countStatus).toBe("mismatch");
  expect(rendered.groups).toHaveLength(2);
  expect(rendered.mentions).toHaveLength(3);
  expect(() => resolveOhTurnGroupingV1(plan, coverage, groupPlan, { ...proposal, groups: proposal.groups.slice(0, 1) })).toThrow();
  expect(() => resolveOhTurnGroupingV1(plan, coverage, groupPlan, { ...proposal, excluded: [{ mentionId: "m0000", reason: "duplicate disposition" }] })).toThrow();
  expect(() => renderOhTurnGroupingV1(plan, coverage, groupPlan, result, { requestedCount: 2, maximumBytes: 20 })).toThrow();
});

test("more than eight users partition deterministically and no batch or user may disappear", () => {
  const sources = Array.from({ length: 19 }, (_, index) => source(`u${index}`, `Topic ${index}.`, index));
  const plan = prepareOhTurnCoverageV1(input(sources));
  expect(plan.batches.map(batch => batch.targets.length)).toEqual([8, 8, 3]);
  const proposals = plan.batches.map(batch => ({ requestSha256: batch.requestSha256,
    users: batch.targets.map(target => row(target.handle, [candidate("topic", plan.sources.find(source => source.handle === target.handle)!.text)])) }));
  const coverage = resolveOhTurnCoverageV1(plan, proposals);
  expect(coverage.users).toHaveLength(19); expect(coverage.mentions).toHaveLength(19);
  expect(() => resolveOhTurnCoverageV1(plan, proposals.slice(0, 2))).toThrow();
  expect(() => resolveOhTurnCoverageV1(plan, [...proposals].reverse())).toThrow();
  expect(prepareOhTurnCoverageV1(input([...sources].reverse()))).toEqual(plan);
});

test("byte partition keeps every source; an indivisible context fails before dispatch", () => {
  const sources = Array.from({ length: 6 }, (_, index) => source(`u${index}`, `${index}:` + "x".repeat(14_000), index));
  const plan = prepareOhTurnCoverageV1(input(sources));
  expect(plan.batches.length).toBeGreaterThan(1);
  expect(plan.batches.flatMap(batch => batch.targets)).toHaveLength(6);
  expect(plan.batches.every(batch => Buffer.byteLength(batch.prompt) <= 65_536)).toBeTrue();
  expect(() => prepareOhTurnCoverageV1(input(sources.map((row, index) => source(`big${index}`, "x".repeat(30_000), index))))).toThrow("indivisible");
});

test("cutoff audit identity stays local in both model stages", () => {
  const a = source("a", "Paper.", 2), b = source("b", "SECRET FUTURE.", 10, "user", 0, "2036-02-01T00:00:00.000Z");
  const asOf = "2036-01-02T00:00:00.000Z";
  const left = prepareOhTurnCoverageV1(input([a], asOf)), right = prepareOhTurnCoverageV1(input([a, b], asOf));
  const proposals = response(left, [row("s0000", [candidate("paper", "Paper")])]);
  const lc = resolveOhTurnCoverageV1(left, proposals), rc = resolveOhTurnCoverageV1(right, proposals);
  expect(lc.coverageSha256).not.toBe(rc.coverageSha256);
  const lg = prepareOhTurnGroupingV1(left, lc, "Supplies."), rg = prepareOhTurnGroupingV1(right, rc, "Supplies.");
  expect(lg.prompt).toBe(rg.prompt); expect(lg.requestSha256).toBe(rg.requestSha256);
  expect(rg.prompt).not.toContain("SECRET");
});

test("unresolved and irrelevant turns stay explicit, and empty history is replayable", () => {
  const plan = prepareOhTurnCoverageV1(input([source("a", "Yes, that.", 0), source("b", "Goodbye.", 1)]));
  const coverage = resolveOhTurnCoverageV1(plan, response(plan, [row("s0000", [], "unresolved"), row("s0001", [], "irrelevant")]));
  const gp = prepareOhTurnGroupingV1(plan, coverage, "Supplies.");
  const result = resolveOhTurnGroupingV1(plan, coverage, gp, { requestSha256: gp.requestSha256, groups: [], excluded: [], unresolved: [], ambiguities: [] });
  const rendered = JSON.parse(renderOhTurnGroupingV1(plan, coverage, gp, result, { requestedCount: null, maximumBytes: 32768 }));
  expect(rendered.status).toBe("unresolved"); expect(rendered.users).toHaveLength(2);
  const empty = prepareOhTurnCoverageV1(input([]));
  expect(empty.batches).toEqual([]); expect(resolveOhTurnCoverageV1(empty, []).users).toEqual([]);
});

test("strict input boundaries reject coercion, unknown roles, hidden gold and ambiguous quotes", () => {
  const a = source("a", "paper paper", 2), plan = prepareOhTurnCoverageV1(input([a]));
  for (const bad of [{ ...input([a]), gold: "secret" }, input([{ ...a, turnOrdinal: "2" } as any]), input([a, a]),
    input([source("role", "Hi.", 0, "Nia")]), input([source("time", "Hi.", 0, "user", 0, "tomorrow")])]) {
    expect(() => prepareOhTurnCoverageV1(bad)).toThrow();
  }
  expect(() => resolveOhTurnCoverageV1(plan, response(plan, [row("s0000", [candidate("paper", "paper")])]))).toThrow("uniquely");
  expect(() => resolveOhTurnCoverageV1(plan, response(plan, [row("s0000", [], "candidate")]))).toThrow("requires mentions");
  expect(() => resolveOhTurnCoverageV1(plan, response(plan, [row("s0000", [candidate("paper", "paper paper")], "irrelevant")]))).toThrow();
  const rows: unknown[] = []; Object.defineProperty(rows, "0", { enumerable: true, get() { throw new Error("getter ran"); } });
  expect(() => resolveOhTurnCoverageV1(plan, rows)).toThrow("enumerable data fields");
  const raw = JSON.stringify(response(plan, [row("s0000", [candidate("paper", "paper paper")])])[0]);
  expect(() => resolveOhTurnCoverageV1(plan, [raw.replace('"users":', '"users":[],"users":')])).toThrow();
});

test("returned values are immutable and tampered replay evidence is rejected", () => {
  const plan = prepareOhTurnCoverageV1(input([source("a", "Paper.", 0)]));
  const proposals = response(plan, [row("s0000", [candidate("paper", "Paper")])]), coverage = resolveOhTurnCoverageV1(plan, proposals);
  proposals[0]!.users[0]!.mentions[0]!.facet = "mutated";
  expect(coverage.mentions[0]!.facet).toBe("paper"); expect(Object.isFrozen(coverage.mentions[0]!.source)).toBeTrue();
  expect(resolveOhTurnCoverageV1(structuredClone(plan), coverage.proposals)).toEqual(coverage);
  const changed = structuredClone(coverage) as any; changed.mentions[0].source.turnOrdinal = 99;
  const { coverageSha256: _, ...payload } = changed; changed.coverageSha256 = canonicalSha256(payload);
  expect(() => prepareOhTurnGroupingV1(plan, changed, "Supplies.")).toThrow("coverage changed");
  const badPlan = structuredClone(plan) as any; badPlan.batches[0].prompt += "tampered";
  expect(() => resolveOhTurnCoverageV1(badPlan, coverage.proposals)).toThrow("plan changed");
});

test("metadata accepted at an input depth boundary cannot produce an unreplayable plan", () => {
  for (let depth = 0; depth < 13; depth++) {
    let metadata: unknown = "leaf";
    for (let index = 0; index < depth; index++) metadata = { child: metadata };
    const raw = source("a", "Paper.", 0);
    const record = createKnowledgeGraphRecordV1({ key: raw.record.key, kind: "edition", v: 1, dependencies: [],
      value: { text: "Paper.", speaker: "user", metadata } });
    let plan;
    try { plan = prepareOhTurnCoverageV1(input([{ ...raw, record }])); }
    catch (error) { expect(String(error)).toMatch(/bound|structure/); continue; }
    const coverage = resolveOhTurnCoverageV1(plan, response(plan, [row("s0000", [candidate("paper", "Paper")])]));
    expect(prepareOhTurnGroupingV1(plan, coverage, "Supplies.").prompt).toContain("paper");
  }
});

test("earliest position uses numeric order regardless of proposed member ordering", () => {
  fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 999 }), { minLength: 3, maxLength: 3 }), turns => {
    const plan = prepareOhTurnCoverageV1(input(turns.map((turn, index) => source(`t${index}`, "Paper.", turn))));
    const coverage = resolveOhTurnCoverageV1(plan, response(plan, plan.sources.map(source => row(source.handle, [candidate("paper", "Paper")]))));
    const gp = prepareOhTurnGroupingV1(plan, coverage, "Supplies.");
    const result = resolveOhTurnGroupingV1(plan, coverage, gp, { requestSha256: gp.requestSha256,
      groups: [{ label: "paper", memberIds: coverage.mentions.map(mention => mention.id).reverse(), reason: "Same supply." }], excluded: [], unresolved: [], ambiguities: [] });
    expect(result.groups[0]!.earliestAcceptedUserPosition.turnOrdinal).toBe(Math.min(...turns));
  }), { numRuns: 32 });
});
