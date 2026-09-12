import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { EVOLUTION_QUESTION_SHAPE_ROUTER_V1, EVOLUTION_QUESTION_SHAPE_RULES_V1, EVOLUTION_QUESTION_SHAPES, auditEvolutionQuestionShapeRouter,
  renderEvolutionQuestionShapeRouterCard, routeEvolutionQuestionShapeV1 } from "../scripts/benchmarks/evolution-question-shape";

test("router classes read only the question text with fixed precedence and reports every matched rule", () => {
  const cases: readonly [string, string, readonly string[]][] = [
    ["How many concerts did I go to this year?", "aggregate", ["how-many"]],
    ["What was the total I spent on groceries?", "aggregate", ["total"]],
    ["how much did the repair cost altogether?", "aggregate", ["total", "how-much"]],
    ["How long did my first marathon take?", "aggregate", ["how-long", "first"]],
    ["Which city did I visit first, Lisbon or Porto?", "order", ["first"]],
    ["What did I do right after the interview?", "order", ["after"]],
    ["When was the last time I went hiking before the move?", "order", ["last", "before"]],
    ["Can you recommend a book like the ones I enjoyed?", "recommendation", ["recommend"]],
    ["Any suggestions for a weekend trip?", "recommendation", ["suggest"]],
    ["Should I keep the standing desk?", "recommendation", ["should-i"]],
    ["What would you pick for my next camera lens?", "recommendation", ["what-would-you"]],
    ["What is the name of my dentist?", "other", []],
    ["Firstly, what did I say about the lasting effects of the afternoon nap?", "other", []],
  ];
  for (const [question, shape, rules] of cases) {
    const decision = routeEvolutionQuestionShapeV1(question);
    expect(decision).toMatchObject({ protocol: "oh.memory.question-shape-decision.v1", shape, routed: shape !== "other", matchedRules: rules,
      routerSha256: canonicalSha256(EVOLUTION_QUESTION_SHAPE_ROUTER_V1), questionSha256: sha256Hex(question) });
    expect(Object.isFrozen(decision)).toBeTrue(); expect(Object.isFrozen(decision.matchedRules)).toBeTrue();
  }
  expect(routeEvolutionQuestionShapeV1("HOW MANY?").shape).toBe("aggregate");
  expect(routeEvolutionQuestionShapeV1("what came first, the café or the recommendation?")).toMatchObject({ shape: "order", matchedRules: ["first", "recommend"] });
  expect(EVOLUTION_QUESTION_SHAPES).toEqual(["aggregate", "order", "recommendation", "other"]);
  expect(EVOLUTION_QUESTION_SHAPE_ROUTER_V1.precedence).toEqual(["aggregate", "order", "recommendation"]);
  expect(EVOLUTION_QUESTION_SHAPE_ROUTER_V1.rulesSha256).toBe(canonicalSha256(EVOLUTION_QUESTION_SHAPE_RULES_V1));
  expect(new Set(EVOLUTION_QUESTION_SHAPE_RULES_V1.map(r => r.id)).size).toBe(EVOLUTION_QUESTION_SHAPE_RULES_V1.length);
  expect(Object.isFrozen(EVOLUTION_QUESTION_SHAPE_RULES_V1)).toBeTrue();
  for (const rule of EVOLUTION_QUESTION_SHAPE_RULES_V1) expect(Object.isFrozen(rule)).toBeTrue();
});

test("router rejects unbounded, empty, non-string and lone-surrogate question text", () => {
  for (const bad of [undefined, null, 7, "", "   ", "x".repeat(16_385), "how many \ud800"]) {
    expect(() => routeEvolutionQuestionShapeV1(bad)).toThrow("Question-shape router: bounded question text required.");
  }
  expect(routeEvolutionQuestionShapeV1("h".repeat(16_384)).shape).toBe("other");
});

test("audit exposes category leakage as a shape by category cross-tabulation without question text", () => {
  const rows = [
    { id: "a", question: "How many times did I visit the gym?", category: "temporal-reasoning" },
    { id: "b", question: "What did I buy first?", category: "temporal-reasoning" },
    { id: "c", question: "Recommend a restaurant for my anniversary.", category: "single-session-preference" },
    { id: "d", question: "What is my sister's name?", category: "single-session-user" },
    { id: "e", question: "Should I renew the lease?", category: "single-session-user" },
  ];
  const audit = auditEvolutionQuestionShapeRouter(rows);
  expect(audit).toMatchObject({ protocol: "oh.memory.question-shape-audit.v1", denominator: 5, routed: 4, hitRate: 0.8,
    byShape: { aggregate: 1, order: 1, other: 1, recommendation: 2 }, byRule: { "how-many": 1, first: 1, recommend: 1, "should-i": 1 },
    routedByCategory: { "temporal-reasoning": { denominator: 2, routed: 2 }, "single-session-preference": { denominator: 1, routed: 1 }, "single-session-user": { denominator: 2, routed: 1 } } });
  expect(audit.categoryLeakage).toEqual({
    aggregate: { "single-session-preference": 0, "single-session-user": 0, "temporal-reasoning": 1 },
    order: { "single-session-preference": 0, "single-session-user": 0, "temporal-reasoning": 1 },
    recommendation: { "single-session-preference": 1, "single-session-user": 1, "temporal-reasoning": 0 },
    other: { "single-session-preference": 0, "single-session-user": 1, "temporal-reasoning": 0 },
  });
  expect(audit.decisions.map(d => d.id)).toEqual(["a", "b", "c", "d", "e"]);
  expect(JSON.stringify(audit)).not.toContain("gym"); expect(JSON.stringify(audit)).not.toContain("sister");
  const blind = auditEvolutionQuestionShapeRouter(rows.map(({ id, question }) => ({ id, question })));
  expect(blind.categoryLeakage).toBeNull(); expect(blind.routedByCategory).toBeNull(); expect(blind.routed).toBe(4);
  expect(() => auditEvolutionQuestionShapeRouter([])).toThrow("audit row bounds");
  expect(() => auditEvolutionQuestionShapeRouter([rows[0]!, rows[0]!])).toThrow("duplicate audit row id");
  expect(() => auditEvolutionQuestionShapeRouter([{ id: "", question: "x" }])).toThrow("audit row id");
  expect(() => auditEvolutionQuestionShapeRouter([{ id: "a", question: "x", category: "" }])).toThrow("audit row category");
});

test("protocol card prints every rule verbatim with the router identity", () => {
  const card = renderEvolutionQuestionShapeRouterCard();
  expect(card.split("\n")[0]).toBe(`oh.memory.question-shape-router.v1 (rulesSha256 ${EVOLUTION_QUESTION_SHAPE_ROUTER_V1.rulesSha256})`);
  expect(card).toContain("precedence: aggregate > order > recommendation");
  for (const rule of EVOLUTION_QUESTION_SHAPE_RULES_V1) expect(card).toContain(`${rule.shape}\t${rule.id}\t/${rule.pattern}/iu`);
  expect(card.split("\n")).toHaveLength(2 + EVOLUTION_QUESTION_SHAPE_RULES_V1.length);
});
