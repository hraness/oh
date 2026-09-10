import type { Question } from "./datasets";

function tokens(value: string): string[] {
  return value.normalize("NFKC").toLowerCase().replace(/\b(a|an|the)\b/g, " ").match(/[\p{L}\p{N}_]+/gu) ?? [];
}

export function tokenF1(prediction: string, reference: string): number {
  const predicted = tokens(prediction);
  const expected = tokens(reference);
  if (reference.trim().length === 0) {
    return /^(?:none|unknown|not mentioned|not enough information|cannot be determined|not specified)[.!]?$/i
      .test(prediction.trim()) ? 1 : 0;
  }
  if (expected.length === 0) return Number(predicted.length === 0);
  if (predicted.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const token of expected) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of predicted) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) { shared += 1; remaining.set(token, count - 1); }
  }
  return 2 * shared / (predicted.length + expected.length);
}

export function evidenceMetrics(question: Question, turnIds: readonly string[], sessionIds: readonly string[]) {
  const expectedTurns = new Set(question.evidenceTurnIds);
  const expectedSessions = new Set(question.evidenceSessionIds);
  const turns = [...new Set(turnIds)];
  const sessions = new Set(sessionIds);
  const matches = turns.filter((id) => expectedTurns.has(id)).length;
  // An ambiguous reference (BEAM repeats turn ids inside some histories) leaves the gold set partial, so the question is not scorable.
  const scorable = !question.unanswerable && question.ambiguousEvidence !== true;
  const eligible = scorable && expectedTurns.size > 0;
  const first = turns.findIndex((id) => expectedTurns.has(id));
  return {
    turnRecall: eligible ? matches / expectedTurns.size : null,
    turnPrecision: eligible ? matches / Math.max(1, turns.length) : null,
    allTurns: eligible ? Number(matches === expectedTurns.size) : null,
    reciprocalRank: eligible ? (first < 0 ? 0 : 1 / (first + 1)) : null,
    sessionRecall: scorable && expectedSessions.size > 0
      ? [...expectedSessions].filter((id) => sessions.has(id)).length / expectedSessions.size : null,
  };
}

export function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0) / present.length;
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
}

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

export function pairedBootstrap(observations: readonly Readonly<{ cluster: string; left: number; right: number }>[],
  seed: number, samples = 2_000) {
  if (observations.length === 0) return null;
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100_000) throw new RangeError("Invalid bootstrap sample count.");
  const groups = new Map<string, number[]>();
  for (const observation of observations) {
    if (!Number.isFinite(observation.left) || !Number.isFinite(observation.right)) throw new TypeError("Non-finite score.");
    const group = groups.get(observation.cluster) ?? [];
    group.push(observation.right - observation.left);
    groups.set(observation.cluster, group);
  }
  const clusters = [...groups.keys()].sort().map((key) => groups.get(key)!);
  if (clusters.length < 2) return null;
  const next = random(seed);
  const differences: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    let sum = 0;
    let count = 0;
    for (let cluster = 0; cluster < clusters.length; cluster += 1) {
      const chosen = clusters[Math.floor(next() * clusters.length)]!;
      sum += chosen.reduce((total, value) => total + value, 0);
      count += chosen.length;
    }
    differences.push(sum / count);
  }
  return { clusters: clusters.length, delta: mean(observations.map((row) => row.right - row.left))!,
    lower: percentile(differences, 0.025)!, upper: percentile(differences, 0.975)!, samples };
}
