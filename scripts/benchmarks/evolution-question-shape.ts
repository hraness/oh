/** Pure question-shape router for the two-stage evidence-selection lane.
 * It reads only the question text, is applied identically to every retrieval system and control,
 * and is audited (never hidden) against gold categories after scoring. No label, category or
 * dataset artifact is an input. The rule table below is printed verbatim on the protocol card. */
import { canonicalSha256, sha256Hex } from "../../src/canonical";

export const EVOLUTION_QUESTION_SHAPES = ["aggregate", "order", "recommendation", "other"] as const;
export type EvolutionQuestionShape = typeof EVOLUTION_QUESTION_SHAPES[number];
export type EvolutionQuestionShapeRule = Readonly<{ id: string; shape: Exclude<EvolutionQuestionShape, "other">; pattern: string }>;
/** Rules are matched case-insensitively against the NFC-normalized question. Shape precedence: aggregate > order > recommendation. */
export const EVOLUTION_QUESTION_SHAPE_RULES_V1: readonly EvolutionQuestionShapeRule[] = Object.freeze(([
  { id: "how-many", shape: "aggregate", pattern: "\\bhow many\\b" },
  { id: "total", shape: "aggregate", pattern: "\\b(?:total|in total|altogether|combined)\\b" },
  { id: "how-much", shape: "aggregate", pattern: "\\bhow much\\b" },
  { id: "how-long", shape: "aggregate", pattern: "\\bhow long\\b" },
  { id: "first", shape: "order", pattern: "\\bfirst\\b" },
  { id: "last", shape: "order", pattern: "\\blast\\b" },
  { id: "before", shape: "order", pattern: "\\bbefore\\b" },
  { id: "after", shape: "order", pattern: "\\bafter\\b" },
  { id: "recommend", shape: "recommendation", pattern: "\\brecommend" },
  { id: "suggest", shape: "recommendation", pattern: "\\bsuggest" },
  { id: "should-i", shape: "recommendation", pattern: "\\bshould i\\b" },
  { id: "what-would-you", shape: "recommendation", pattern: "\\bwhat would you\\b" },
] as const satisfies readonly EvolutionQuestionShapeRule[]).map(rule => Object.freeze(rule)));
export const EVOLUTION_QUESTION_SHAPE_ROUTER_V1 = Object.freeze({
  protocol: "oh.memory.question-shape-router.v1" as const,
  input: "question text only; NFC-normalized, case-insensitive" as const,
  precedence: ["aggregate", "order", "recommendation"] as const,
  routed: "any rule matches" as const,
  rules: EVOLUTION_QUESTION_SHAPE_RULES_V1,
  rulesSha256: canonicalSha256(EVOLUTION_QUESTION_SHAPE_RULES_V1),
});
export type EvolutionQuestionShapeDecision = Readonly<{ protocol: "oh.memory.question-shape-decision.v1"; routerSha256: string;
  questionSha256: string; shape: EvolutionQuestionShape; routed: boolean; matchedRules: readonly string[] }>;
const ROUTER_SHA = canonicalSha256(EVOLUTION_QUESTION_SHAPE_ROUTER_V1);
const COMPILED = EVOLUTION_QUESTION_SHAPE_RULES_V1.map(rule => ({ rule, regex: new RegExp(rule.pattern, "iu") }));
function fail(reason: string): never { throw new TypeError(`Question-shape router: ${reason}.`); }
export function routeEvolutionQuestionShapeV1(question: unknown): EvolutionQuestionShapeDecision {
  if (typeof question !== "string" || !question.trim().length || Buffer.byteLength(question) > 16_384 || /\p{Surrogate}/u.test(question)) fail("bounded question text required");
  const text = question.normalize("NFC");
  const matchedRules = COMPILED.filter(({ regex }) => regex.test(text)).map(({ rule }) => rule.id);
  const shapes = new Set(COMPILED.filter(({ rule }) => matchedRules.includes(rule.id)).map(({ rule }) => rule.shape));
  const shape = EVOLUTION_QUESTION_SHAPE_ROUTER_V1.precedence.find(s => shapes.has(s)) ?? "other";
  return Object.freeze({ protocol: "oh.memory.question-shape-decision.v1", routerSha256: ROUTER_SHA, questionSha256: sha256Hex(question),
    shape, routed: shape !== "other", matchedRules: Object.freeze(matchedRules) });
}
export type EvolutionQuestionShapeAuditRow = Readonly<{ id: string; question: string; category?: string }>;
/** Outcome-blind audit: shape counts, hit rate, and (when categories are supplied) the shape x category
 * cross-tabulation that reports category leakage. It returns identifiers and counts, never question text. */
export function auditEvolutionQuestionShapeRouter(rows: readonly EvolutionQuestionShapeAuditRow[]) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100_000) fail("audit row bounds");
  const decisions = rows.map(row => {
    if (typeof row.id !== "string" || !row.id.length || Buffer.byteLength(row.id) > 512) fail("audit row id");
    if (row.category !== undefined && (typeof row.category !== "string" || !row.category.length || Buffer.byteLength(row.category) > 512)) fail("audit row category");
    return { id: row.id, category: row.category ?? null, decision: routeEvolutionQuestionShapeV1(row.question) };
  });
  if (new Set(decisions.map(d => d.id)).size !== decisions.length) fail("duplicate audit row id");
  const count = <T,>(items: readonly T[], key: (item: T) => string) => {
    const table: Record<string, number> = {};
    for (const item of items) { const k = key(item); table[k] = (table[k] ?? 0) + 1; }
    return Object.fromEntries(Object.entries(table).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  };
  const categories = [...new Set(decisions.flatMap(d => d.category === null ? [] : [d.category]))].sort();
  const crosstab = categories.length === 0 ? null : Object.fromEntries(EVOLUTION_QUESTION_SHAPES.map(shape => [shape,
    Object.fromEntries(categories.map(category => [category, decisions.filter(d => d.decision.shape === shape && d.category === category).length]))]));
  const routedByCategory = categories.length === 0 ? null : Object.fromEntries(categories.map(category => {
    const subset = decisions.filter(d => d.category === category);
    return [category, { denominator: subset.length, routed: subset.filter(d => d.decision.routed).length }];
  }));
  return Object.freeze({ protocol: "oh.memory.question-shape-audit.v1" as const, routerSha256: ROUTER_SHA, denominator: decisions.length,
    routed: decisions.filter(d => d.decision.routed).length, hitRate: decisions.filter(d => d.decision.routed).length / decisions.length,
    byShape: count(decisions, d => d.decision.shape), byRule: count(decisions.flatMap(d => d.decision.matchedRules), r => r),
    categoryLeakage: crosstab, routedByCategory,
    decisions: decisions.map(d => ({ id: d.id, shape: d.decision.shape, routed: d.decision.routed, matchedRules: d.decision.matchedRules })),
    meaning: "Router class versus gold category is reported to expose category leakage; the router itself never reads categories. Hit rates on other datasets' question texts show transfer only, not accuracy." });
}
/** Verbatim rule table for the protocol card. */
export function renderEvolutionQuestionShapeRouterCard(): string {
  return [`${EVOLUTION_QUESTION_SHAPE_ROUTER_V1.protocol} (rulesSha256 ${EVOLUTION_QUESTION_SHAPE_ROUTER_V1.rulesSha256})`,
    `input: ${EVOLUTION_QUESTION_SHAPE_ROUTER_V1.input}; precedence: ${EVOLUTION_QUESTION_SHAPE_ROUTER_V1.precedence.join(" > ")}; routed when ${EVOLUTION_QUESTION_SHAPE_ROUTER_V1.routed}`,
    ...EVOLUTION_QUESTION_SHAPE_RULES_V1.map(rule => `${rule.shape}\t${rule.id}\t/${rule.pattern}/iu`)].join("\n");
}
