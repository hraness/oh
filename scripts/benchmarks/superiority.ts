import { hasExactKeys, isPlainRecord } from "../../src/canonical";
import { finitePopulationLowerBound, finitePopulationPValue } from "./finite-population";

export type FamilyCase = Readonly<{ questionId: string; corpusId: string; groupId: string }>;
export const CONFIRMATION_SYSTEMS = ["oh-fact", "bm25-window", "bm25-record-window"] as const;
export const CONFIRMATION_ALPHA = 0.025;
export const MINIMUM_OBSERVED_GAIN = 0.05;

/** Decision rule for the frozen three-arm study; missing outcomes cannot establish superiority. */
export function assessSuperiority(poolSize: number, selected: readonly FamilyCase[], rows: readonly unknown[]) {
  if (!Number.isSafeInteger(poolSize) || poolSize < 1 || poolSize > 1000
    || selected.length < 1 || selected.length > poolSize
    || selected.some(x => !isPlainRecord(x) || !hasExactKeys(x, ["questionId", "corpusId", "groupId"])
      || [x.questionId, x.corpusId, x.groupId].some(id => typeof id !== "string" || id.length < 1 || id.length > 512))
    || new Set(selected.map(x => x.groupId)).size !== selected.length
    || new Set(selected.map(x => x.questionId)).size !== selected.length
    || new Set(selected.map(x => x.corpusId)).size !== selected.length
    || rows.length > selected.length * CONFIRMATION_SYSTEMS.length) throw new TypeError("Invalid confirmation matrix.");
  const cases = new Map(selected.map(x => [x.questionId, x]));
  const scores = new Map<string, Map<string, number>>();
  const seen = new Set<string>();
  let completed = 0;
  for (const row of rows) {
    if (!isPlainRecord(row) || typeof row.questionId !== "string" || typeof row.system !== "string"
      || !(CONFIRMATION_SYSTEMS as readonly string[]).includes(row.system)
      || typeof row.status !== "string"
      || !["completed", "judge-error", "reader-error", "reader-not-run", "not-run"].includes(row.status)) {
      throw new TypeError("Invalid confirmation row.");
    }
    const family = cases.get(row.questionId);
    const key = JSON.stringify([row.questionId, row.system]);
    if (family === undefined || row.corpusId !== family.corpusId || row.groupId !== family.groupId || seen.has(key)) {
      throw new TypeError("Duplicate or mismatched confirmation row.");
    }
    seen.add(key);
    if (row.status !== "completed") {
      if (row.correct !== null) throw new TypeError("Failed judgment must have no binary outcome.");
      continue;
    }
    if (row.correct !== 0 && row.correct !== 1) throw new TypeError("A completed judgment must be binary.");
    const systemScores = scores.get(row.system) ?? new Map<string, number>();
    systemScores.set(row.questionId, row.correct);
    scores.set(row.system, systemScores);
    completed++;
  }
  const expected = selected.length * CONFIRMATION_SYSTEMS.length;
  const coverage = { expected, received: rows.length, completed, missingOrFailed: expected - completed };
  if (completed !== expected) return { status: "incomplete" as const, established: false, coverage, comparisons: null };
  const candidate = scores.get("oh-fact")!;
  const comparisons = Object.fromEntries(CONFIRMATION_SYSTEMS.slice(1).map(baseline => {
    const control = scores.get(baseline)!;
    let wins = 0, losses = 0, bothCorrect = 0, bothWrong = 0;
    for (const item of selected) {
      const left = control.get(item.questionId)!, right = candidate.get(item.questionId)!;
      if (right > left) wins++; else if (right < left) losses++; else if (right === 1) bothCorrect++; else bothWrong++;
    }
    const delta = (wins - losses) / selected.length;
    const lower = finitePopulationLowerBound(poolSize, selected.length, wins, losses, CONFIRMATION_ALPHA);
    return [baseline, { candidate: "oh-fact", wins, losses, bothCorrect, bothWrong, observedDelta: delta,
      oneSidedPValue: finitePopulationPValue(poolSize, selected.length, wins, losses),
      simultaneousLowerBound: lower, alpha: CONFIRMATION_ALPHA,
      passed: lower > 0 && delta >= MINIMUM_OBSERVED_GAIN }];
  }));
  return { status: "completed" as const, established: Object.values(comparisons).every(x => x.passed),
    coverage, comparisons, scope: "fixed eligible representative pool; one reader/judge realization" };
}
