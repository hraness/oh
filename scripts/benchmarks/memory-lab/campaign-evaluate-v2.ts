/** Pure analysis: complete planned denominators, cluster-level sign test, no rounding in decisions. */
import { CAMPAIGN_V2, need, sha, type Assessment, type Observation, type Plan } from "./campaign-contract-v2";
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Exact one-sided binomial tail under independent symmetric cluster signs. Ties contribute no sign. */
export function signPValue(deltas: readonly number[]): { pValue: number; informative: number } {
  const nonzero = deltas.filter(x => x !== 0), n = nonzero.length, wins = nonzero.filter(x => x > 0).length;
  if (n === 0) return { pValue: 1, informative: 0 };
  // Stable recurrence, at most 4096 clusters. Evaluate the smaller tail when needed.
  let probability = 1, term = 1;
  const k = Math.min(wins - 1, n - wins);
  if (k < 0) return { pValue: 1, informative: n };
  for (let i = 1; i <= k; i++) { term *= (n - i + 1) / i; probability += term; }
  const tail = probability * 2 ** -n;
  // For huge n use log binomial sums, avoiding overflow/underflow cancellation.
  let stable = tail;
  if (!Number.isFinite(tail) || n > 1000) {
    let logTerm = -n * Math.log(2), logSum = logTerm;
    for (let i = 1; i <= k; i++) { logTerm += Math.log(n - i + 1) - Math.log(i); const hi = Math.max(logSum, logTerm); logSum = hi + Math.log(Math.exp(logSum - hi) + Math.exp(logTerm - hi)); }
    stable = Math.exp(logSum);
  }
  return { pValue: Math.min(1, Math.max(0, wins > n / 2 ? stable : 1 - stable)), informative: n };
}
export const confirmationAlpha = (attempt: number) => 0.05 / 2 ** attempt;
/** Distribution-free one-sided lower confidence bound for the cluster median.
 * The order statistic is selected with the exact Binomial(n, .5) tail. */
export function medianLowerBound(values: readonly number[], alpha: number): number | null {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length; let index = -1;
  for (let i = 0; i < n; i++) {
    // P(Binomial(n,.5) <= i) = P(Binomial(n,.5) >= n-i).
    const tail = signPValue(Array.from({ length: n }, (_, j) => j < n - i ? 1 : -1)).pValue;
    if (tail <= alpha) index = i; else break;
  }
  return index < 0 ? null : sorted[index]!;
}
export const attainableClusters = (alpha: number) => Math.ceil(-Math.log2(alpha));

export function evaluate(plan: Plan, observations: readonly Observation[], aaMaximumMeanAbsoluteDelta: number): Assessment {
  const controls = plan.kind === "controls", expected = plan.tasks.flatMap(t => controls ? [`${t.id}|candidate`] : [`${t.id}|baseline`, `${t.id}|candidate`]);
  const expectedSet = new Set(expected), seen = new Set<string>(), lookup = new Map<string, Observation>(); const reasons: string[] = [];
  for (const row of observations) {
    const key = `${row.taskId}|${row.arm}`;
    need(expectedSet.has(key) && !seen.has(key), "unexpected or duplicate observation"); seen.add(key); lookup.set(key, row);
    if (row.status !== "scored" || typeof row.score !== "number" || !Number.isFinite(row.score) || row.score < 0 || row.score > 1) reasons.push(`failed:${key}`);
  }
  const complete = expected.filter(k => { const x = lookup.get(k); return x?.status === "scored" && typeof x.score === "number" && Number.isFinite(x.score) && x.score >= 0 && x.score <= 1; }).length;
  const base: Assessment = { protocol: CAMPAIGN_V2, planSha256: sha(plan), status: "INCOMPLETE", planned: expected.length, complete,
    targetDelta: null, guardDelta: null, guardLowerBound: null, guardEstimand: "cluster-median", pValue: null, targetClusters: 0, informativeClusters: 0, wouldPass: false, meanAbsoluteDelta: null, reasons };
  if (complete !== expected.length) { base.reasons.push("every planned observation is required"); return base; }
  if (controls) {
    const passed = plan.tasks.every(t => lookup.get(`${t.id}|candidate`)!.score === t.expected);
    return { ...base, status: passed ? "PASS" : "REJECT", reasons: passed ? [] : ["positive/negative grader control failed"] };
  }
  const delta = (id: string) => lookup.get(`${id}|candidate`)!.score! - lookup.get(`${id}|baseline`)!.score!;
  const clusters = (ids: readonly string[]) => {
    const map = new Map<string, number[]>();
    for (const id of ids) { const cluster = plan.tasks.find(t => t.id === id)!.cluster; map.set(cluster, [...(map.get(cluster) ?? []), delta(id)]); }
    return [...map.values()].map(mean);
  };
  const targets = clusters(plan.targetIds), guards = clusters(plan.guardIds), targetDelta = mean(targets), guardDelta = mean(guards);
  const { pValue, informative } = signPValue(targets), meanAbsoluteDelta = mean([...targets, ...guards].map(Math.abs));
  const enough = targets.length >= plan.analysis.minimumClusters && informative >= attainableClusters(plan.analysis.alpha);
  const guardLowerBound = plan.kind === "confirmation" ? medianLowerBound(guards, plan.analysis.alpha) : null;
  const guardPass = guardDelta >= -plan.analysis.guardMargin && (plan.kind !== "confirmation" || (guardLowerBound !== null && guardLowerBound >= -plan.analysis.guardMargin));
  const wouldPass = enough && targetDelta >= plan.analysis.minimumEffect && pValue <= plan.analysis.alpha && guardPass;
  const passing = plan.kind === "aa" ? !wouldPass && meanAbsoluteDelta <= aaMaximumMeanAbsoluteDelta : wouldPass;
  if (!enough && plan.kind !== "aa") reasons.push("insufficient independent informative clusters for the frozen threshold");
  if (plan.kind === "aa") {
    need(plan.baseline.semanticKey === plan.candidate.semanticKey && plan.baseline.instruction === plan.candidate.instruction, "A/A must execute identical treatment with distinct calls");
    if (wouldPass) reasons.push("A/A would falsely pass the screen");
    if (meanAbsoluteDelta > aaMaximumMeanAbsoluteDelta) reasons.push("A/A variation exceeds frozen ceiling");
  } else {
    if (targetDelta < plan.analysis.minimumEffect) reasons.push("effect below threshold");
    if (pValue > plan.analysis.alpha) reasons.push("cluster sign test does not pass");
    if (!guardPass) reasons.push("quality guard lacks the preregistered mean floor or cluster-median noninferiority evidence");
  }
  return { ...base, status: passing ? "PASS" : "REJECT", targetDelta, guardDelta, guardLowerBound, pValue, targetClusters: targets.length,
    informativeClusters: informative, wouldPass, meanAbsoluteDelta, reasons };
}
