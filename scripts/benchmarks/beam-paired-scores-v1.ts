import { canonicalSha256, isPlainRecord } from "../../src/canonical";
import { parseBeamEvaluationDataV1 } from "./beam-evaluation";
import { BEAM_RELEASED_CATEGORIES_V1, reduceBeamReleasedResultsV1, type BeamReleasedCategoryV1 } from "./beam-released-results-v1";
import { seededRandom } from "./evolution-paired-stats";

/** Paired superiority analysis over released BEAM scores, frozen before any score exists. The panel is rebuilt from
 * the plan and observations; declared category weights combine each history's category means, histories average
 * within a family, and families carry equal weight. Families resample as whole units. "Superior" requires the one-sided
 * bootstrap lower bound to exceed the declared margin; a sign-flip randomization test is reported as a sensitivity
 * check. Incomplete panels, non-finite means and absent categories block the decision instead of being dropped. */
export const BEAM_PAIRED_SCORES_PROTOCOL_V1 = "oh.beam-paired-scores.v1" as const;
export const BEAM_PAIRED_ANALYSIS_PLAN_PROTOCOL_V1 = "oh.beam-paired-analysis-plan.v1" as const;
export const BEAM_PAIRED_SCORES_LIMITS_V1 = Object.freeze({ families: 1_024, historiesPerFamily: 64, minimumResamples: 1_000,
  maximumResamples: 100_000, exactSignFlipFamilies: 20, maximumWeight: 1_000_000 });
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PLAN_FIELDS = ["releasedPlanSha256", "candidate", "comparator", "categories", "families", "resamples", "seed", "alpha", "superiorityMargin"] as const;

export type BeamPairedAnalysisPlanV1 = Readonly<{ protocol: typeof BEAM_PAIRED_ANALYSIS_PLAN_PROTOCOL_V1; releasedPlanSha256: string;
  candidate: string; comparator: string; categories: readonly Readonly<{ category: BeamReleasedCategoryV1; weight: number }>[];
  families: readonly Readonly<{ family: string; histories: readonly string[] }>[]; resamples: number; seed: number; alpha: number;
  superiorityMargin: number; planSha256: string }>;

function need(value: unknown, reason: string): asserts value { if (!value) throw new TypeError(`BEAM paired scores: ${reason}.`); }
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const item of Object.values(value)) immutable(item); Object.freeze(value); }
  return value;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  need(isPlainRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), "unexpected or missing fields");
  return value;
}
const id = (value: unknown): string => { need(typeof value === "string" && IDENTIFIER.test(value), "identifier required"); return value; };
const list = (value: unknown, minimum: number, maximum: number): unknown[] => {
  need(Array.isArray(value) && value.length >= minimum && value.length <= maximum, "list bound"); return value;
};
const finite = (value: unknown, minimum: number, maximum: number, label: string): number => {
  need(typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum, label); return value;
};

function planPayload(row: Record<string, unknown>) {
  const L = BEAM_PAIRED_SCORES_LIMITS_V1;
  need(typeof row.releasedPlanSha256 === "string" && /^[0-9a-f]{64}$/u.test(row.releasedPlanSha256), "released plan digest required");
  const candidate = id(row.candidate), comparator = id(row.comparator);
  need(candidate !== comparator, "candidate and comparator must differ");
  const categories = list(row.categories, 1, BEAM_RELEASED_CATEGORIES_V1.length).map(value => {
    const item = exact(value, ["category", "weight"]);
    need(typeof item.category === "string" && (BEAM_RELEASED_CATEGORIES_V1 as readonly string[]).includes(item.category), "released category required");
    return { category: item.category as BeamReleasedCategoryV1, weight: finite(item.weight, Number.MIN_VALUE, L.maximumWeight, "positive finite weight required") };
  });
  need(new Set(categories.map(item => item.category)).size === categories.length, "duplicate category");
  const seen = new Set<string>();
  const families = list(row.families, 2, L.families).map(value => {
    const item = exact(value, ["family", "histories"]), histories = list(item.histories, 1, L.historiesPerFamily).map(id);
    for (const history of histories) { need(!seen.has(history), "a history may belong to one family only"); seen.add(history); }
    return { family: id(item.family), histories };
  });
  need(new Set(families.map(item => item.family)).size === families.length, "duplicate family");
  need(Number.isSafeInteger(row.resamples) && (row.resamples as number) >= L.minimumResamples && (row.resamples as number) <= L.maximumResamples, "resample bound");
  need(Number.isSafeInteger(row.seed) && (row.seed as number) >= 0 && (row.seed as number) <= 0xffff_ffff, "unsigned 32-bit seed required");
  need(typeof row.alpha === "number" && row.alpha > 0 && row.alpha < 0.5, "alpha must lie in (0, 0.5)");
  return { protocol: BEAM_PAIRED_ANALYSIS_PLAN_PROTOCOL_V1, releasedPlanSha256: row.releasedPlanSha256, candidate, comparator, categories, families,
    resamples: row.resamples as number, seed: row.seed as number, alpha: row.alpha, superiorityMargin: finite(row.superiorityMargin, 0, 1, "margin must lie in [0, 1]") };
}
/** Freeze the complete decision rule before any official value is produced. */
export function createBeamPairedAnalysisPlanV1(input: unknown): BeamPairedAnalysisPlanV1 {
  const payload = planPayload(exact(parseBeamEvaluationDataV1(input, 1_048_576), PLAN_FIELDS));
  return immutable({ ...payload, planSha256: canonicalSha256(payload) });
}
function validatePlan(input: unknown): BeamPairedAnalysisPlanV1 {
  const row = exact(parseBeamEvaluationDataV1(input, 1_048_576), ["protocol", ...PLAN_FIELDS, "planSha256"]);
  need(row.protocol === BEAM_PAIRED_ANALYSIS_PLAN_PROTOCOL_V1, "analysis plan protocol");
  const payload = planPayload(row);
  need(canonicalSha256(payload) === row.planSha256, "analysis plan digest mismatch");
  return immutable({ ...payload, planSha256: row.planSha256 as string });
}
const mean = (values: readonly number[]) => values.reduce((total, value) => total + value, 0) / values.length;
/** Nearest-rank quantile over sorted samples, as the binary paired analysis uses. */
const quantile = (sorted: Float64Array, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;

/** One-sided sign-flip test of mean(D - margin) > 0: exact enumeration up to 20 families, seeded Monte Carlo above. */
export function signFlipBeamPairedV1(differences: readonly number[], margin: number, samples: number, seed: number) {
  need(Array.isArray(differences) && differences.length >= 1 && differences.every(Number.isFinite), "finite differences required");
  const centered = differences.map(value => value - margin), observed = centered.reduce((total, value) => total + value, 0);
  const tolerance = 1e-12 * Math.max(1, centered.reduce((total, value) => total + Math.abs(value), 0)), families = centered.length;
  const statistic = (sign: (index: number) => number) => centered.reduce((total, value, index) => total + sign(index) * value, 0);
  if (families <= BEAM_PAIRED_SCORES_LIMITS_V1.exactSignFlipFamilies) {
    let atLeast = 0;
    for (let mask = 0; mask < 2 ** families; mask += 1) if (statistic(index => (mask >>> index) & 1 ? -1 : 1) >= observed - tolerance) atLeast += 1;
    return { method: "exact" as const, assignments: 2 ** families, pValue: atLeast / 2 ** families };
  }
  const random = seededRandom(seed);
  let atLeast = 0;
  for (let draw = 0; draw < samples; draw += 1) if (statistic(() => random() < 0.5 ? -1 : 1) >= observed - tolerance) atLeast += 1;
  return { method: "monte-carlo" as const, assignments: samples, pValue: (1 + atLeast) / (1 + samples) };
}

export function analyzeBeamPairedScoresV1(releasedPlan: unknown, observations: unknown, analysisPlanInput: unknown) {
  const plan = validatePlan(analysisPlanInput), panel = reduceBeamReleasedResultsV1(releasedPlan, observations);
  need(panel.planSha256 === plan.releasedPlanSha256, "analysis plan binds a different released plan");
  const arms = [plan.candidate, plan.comparator].map(name => panel.arms.find(arm => arm.arm === name));
  need(arms.every(arm => arm !== undefined), "candidate and comparator must be planned arms");
  const planned = new Set(panel.arms[0]!.categories.flatMap(category => category.historyMeans.map(item => item.history)));
  const assigned = plan.families.flatMap(family => family.histories);
  need(assigned.length === planned.size && assigned.every(history => planned.has(history)), "families must partition the planned histories");
  const reasons: string[] = [];
  if (!panel.complete) reasons.push(`released panel incomplete: ${panel.counts.missing} missing, ${panel.counts.unresolved} unresolved, ${panel.counts.failed} failed`);
  const means = new Map<string, number>(), key = (arm: string, category: string, history: string) => JSON.stringify([arm, category, history]);
  for (const arm of arms) for (const { category } of plan.categories) {
    const row = arm!.categories.find(item => item.category === category)!;
    for (const history of assigned) {
      const entry = row.historyMeans.find(item => item.history === history);
      if (entry === undefined) reasons.push(`${category} is absent from history ${history}`);
      else if (typeof entry.mean === "number") means.set(key(arm!.arm, category, history), entry.mean);
      else if (entry.mean !== null) reasons.push(`${arm!.arm} ${category} mean for history ${history} is not finite`);
    }
  }
  const base = { protocol: BEAM_PAIRED_SCORES_PROTOCOL_V1, analysisPlanSha256: plan.planSha256, releasedPlanSha256: panel.planSha256,
    releasedResultSha256: panel.resultSha256, candidate: plan.candidate, comparator: plan.comparator,
    releasedPanels: arms.map(arm => ({ arm: arm!.arm, releasedPanel: arm!.releasedPanel })) };
  const unique = [...new Set(reasons)];
  if (unique.length > 0) {
    const payload = { ...base, status: "blocked" as const, reasons: unique.slice(0, 64), reasonCount: unique.length };
    return immutable({ ...payload, analysisSha256: canonicalSha256(payload) });
  }
  const total = plan.categories.reduce((sum, item) => sum + item.weight, 0);
  const score = (arm: string, history: string) => plan.categories.reduce((sum, item) => sum + item.weight * means.get(key(arm, item.category, history))!, 0) / total;
  const families = plan.families.map(family => {
    const candidate = mean(family.histories.map(history => score(plan.candidate, history)));
    const comparator = mean(family.histories.map(history => score(plan.comparator, history)));
    return { family: family.family, histories: family.histories.length, candidate, comparator, difference: candidate - comparator };
  });
  const differences = families.map(family => family.difference), estimate = mean(differences);
  const random = seededRandom(plan.seed), samples = new Float64Array(plan.resamples);
  for (let draw = 0; draw < plan.resamples; draw += 1) {
    let sum = 0;
    for (let index = 0; index < differences.length; index += 1) sum += differences[Math.floor(random() * differences.length)]!;
    samples[draw] = sum / differences.length;
  }
  samples.sort();
  const lowerBound = quantile(samples, plan.alpha), upperBound = quantile(samples, 1 - plan.alpha);
  const signFlip = signFlipBeamPairedV1(differences, plan.superiorityMargin, plan.resamples, (plan.seed + 1) >>> 0);
  const payload = { ...base, status: "decided" as const, estimate,
    bootstrap: { unit: "family" as const, resamples: plan.resamples, seed: plan.seed, alpha: plan.alpha, lowerBound, interval: [lowerBound, upperBound] as const },
    signFlip: { ...signFlip, agreesWithDecision: (signFlip.pValue <= plan.alpha) === (lowerBound > plan.superiorityMargin) },
    superiorityMargin: plan.superiorityMargin, decision: lowerBound > plan.superiorityMargin ? "superior" as const : "not-superior" as const, families,
    descriptiveCategoryDifferences: plan.categories.map(({ category, weight }) => ({ category, weight,
      difference: mean(plan.families.map(family => mean(family.histories.map(history =>
        means.get(key(plan.candidate, category, history))! - means.get(key(plan.comparator, category, history))!)))) })) };
  return immutable({ ...payload, analysisSha256: canonicalSha256(payload) });
}
