/** Benchmark-scoped budgeted submodular selection: the principled replacement for
 * rank-ordered top-k when packing a byte-bounded instruction or memory channel.
 *
 * Objective: F(S) = Σ_{i∈S} weight(i) + diversityWeight · |∪_{i∈S} features(i)|.
 * F is monotone submodular only while every weight and the diversityWeight stay
 * non-negative; the input contract enforces exactly that. Selection runs
 * lazy-greedy on marginal gain per byte (standard submodular density-greedy:
 * each candidate's stale queue key is an upper bound on its true marginal, so a
 * recomputed candidate that still tops the queue is the true greedy choice) and
 * then keeps the better of the greedy solution and the best feasible singleton —
 * the classic (1−1/e)/2-style fallback for knapsack-constrained monotone
 * submodular maximization. Ties resolve deterministically: higher gainPerByte,
 * then higher marginalGain, then lexicographically smaller id; an objective tie
 * between the two candidates keeps the density-greedy run. No randomness and no
 * wall clock: identical inputs give identical selected sets and identical
 * selectionSha256. An empty item list is a valid input and yields an empty
 * density-greedy selection; a non-positive or non-integer budgetBytes throws.
 *
 * Scope: benchmark harness only — this is NOT a production selector yet. The
 * monotone-submodular assumption is a modeling choice (weight is calibrated
 * relevance, features are coverage attributes), and no channel contract beyond
 * the byte budget is enforced here. */
import { canonicalSha256, hasExactKeys, isPlainRecord, type Sha256Hex } from "../../src/canonical";

export const SUBMODULAR_SELECTION_PROTOCOL = "oh.benchmark.submodular-selection.v1" as const;
export const SUBMODULAR_SELECTION_MAX_ITEMS = 1024;
export const SUBMODULAR_SELECTION_MAX_FEATURES_PER_ITEM = 64;
export const SUBMODULAR_SELECTION_MAX_ID_CHARS = 128;
export const SUBMODULAR_SELECTION_MAX_FEATURE_CHARS = 128;

/** One selectable entry: `weight` is calibrated relevance; `features` are
 * coverage attributes (entities, topics) that feed the diversity term. */
export type Item = Readonly<{
  id: string;
  bytes: number;
  weight: number;
  features?: readonly string[];
}>;

/** One audited pick. `marginalGain` is F(S∪{i})−F(S) at pick time;
 * `gainPerByte` is marginalGain/bytes; `cumulativeGain` is F over the picks so
 * far, so the last entry's cumulativeGain always equals `objective`. */
export type TraceEntry = Readonly<{
  id: string;
  marginalGain: number;
  gainPerByte: number;
  cumulativeGain: number;
}>;

export type Selection = Readonly<{
  /** Final selection in pick order. */
  selected: readonly Item[];
  /** Marginal-gain audit trail for the returned selection: greedy picks in
   * order, or the single best-singleton entry when the fallback wins. */
  trace: readonly TraceEntry[];
  /** F(selected). */
  objective: number;
  totalBytes: number;
  budgetBytes: number;
  /** Which candidate solution won: the density-greedy run or the best feasible
   * singleton. Empty selections report "density-greedy". */
  fallbackUsed: "density-greedy" | "best-single";
  /** canonicalSha256 of {objective, protocol, selected ids, trace}. */
  selectionSha256: Sha256Hex;
}>;

type Candidate = Readonly<{
  item: Item;
  id: string;
  bytes: number;
  weight: number;
  /** Deduped coverage attributes. */
  features: readonly string[];
  /** F({i}) — also the initial queue bound. */
  singletonGain: number;
}>;

/** Mutable queue node: `gain` is an upper bound on the true marginal gain,
 * exact iff `computedAt === version` (the number of picks made so far). */
type Node = {
  candidate: Candidate;
  gain: number;
  computedAt: number;
};

function fail(message: string): never {
  throw new TypeError(`selectBudgeted: ${message}`);
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail(`${label} must be a string of 1..${maximum} characters`);
  }
  return value;
}

function nonNegativeFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    fail(`${label} must be a finite number ≥ 0`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive safe integer`);
  }
  return value;
}

function parseItem(value: unknown, index: number): Candidate {
  const label = `items[${index}]`;
  if (!isPlainRecord(value)
    || !(hasExactKeys(value, ["id", "bytes", "weight"]) || hasExactKeys(value, ["id", "bytes", "weight", "features"]))) {
    fail(`${label} must be a plain object with keys id, bytes, weight and optional features`);
  }
  const id = boundedString(value.id, `${label}.id`, SUBMODULAR_SELECTION_MAX_ID_CHARS);
  const bytes = positiveInteger(value.bytes, `${label}.bytes`);
  const weight = nonNegativeFinite(value.weight, `${label}.weight`);
  let features: readonly string[] = [];
  if (value.features !== undefined) {
    if (!Array.isArray(value.features) || value.features.length > SUBMODULAR_SELECTION_MAX_FEATURES_PER_ITEM) {
      fail(`${label}.features must be an array of at most ${SUBMODULAR_SELECTION_MAX_FEATURES_PER_ITEM} strings`);
    }
    features = [...new Set(value.features.map((feature, featureIndex) =>
      boundedString(feature, `${label}.features[${featureIndex}]`, SUBMODULAR_SELECTION_MAX_FEATURE_CHARS)))];
  }
  return { item: value as unknown as Item, id, bytes, weight, features, singletonGain: 0 };
}

/** Priority order: higher gainPerByte, then higher marginalGain, then
 * lexicographically smaller id. Total because ids are unique. */
function ranksBefore(left: Node, right: Node): boolean {
  const leftDensity = left.gain / left.candidate.bytes;
  const rightDensity = right.gain / right.candidate.bytes;
  if (leftDensity !== rightDensity) return leftDensity > rightDensity;
  if (left.gain !== right.gain) return left.gain > right.gain;
  return left.candidate.id < right.candidate.id;
}

function heapPush(heap: Node[], node: Node): void {
  heap.push(node);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (!ranksBefore(heap[index]!, heap[parent]!)) break;
    heap[index] = heap[parent]!;
    heap[parent] = node;
    index = parent;
  }
}

function heapPop(heap: Node[]): Node | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (top === undefined) return undefined;
  if (heap.length > 0 && last !== undefined) {
    heap[0] = last;
    let index = 0;
    for (;;) {
      const left = 2 * index + 1;
      const right = left + 1;
      let best = index;
      if (left < heap.length && ranksBefore(heap[left]!, heap[best]!)) best = left;
      if (right < heap.length && ranksBefore(heap[right]!, heap[best]!)) best = right;
      if (best === index) break;
      heap[index] = heap[best]!;
      heap[best] = last;
      index = best;
    }
  }
  return top;
}

/** Selects a byte-budgeted subset maximizing F by lazy density-greedy with the
 * best-single fallback. Items whose bytes exceed budgetBytes are infeasible:
 * they are skipped everywhere and never appear in the output. */
export function selectBudgeted(input: Readonly<{
  items: readonly Item[];
  budgetBytes: number;
  diversityWeight?: number;
}>): Selection {
  if (!isPlainRecord(input)
    || !(hasExactKeys(input, ["items", "budgetBytes"]) || hasExactKeys(input, ["items", "budgetBytes", "diversityWeight"]))) {
    fail("input must be a plain object with keys items, budgetBytes and optional diversityWeight");
  }
  if (!Array.isArray(input.items) || input.items.length > SUBMODULAR_SELECTION_MAX_ITEMS) {
    fail(`items must be an array of at most ${SUBMODULAR_SELECTION_MAX_ITEMS} entries`);
  }
  const budgetBytes = positiveInteger(input.budgetBytes, "budgetBytes");
  const diversityWeight = input.diversityWeight === undefined ? 0 : nonNegativeFinite(input.diversityWeight, "diversityWeight");

  const seen = new Set<string>();
  const feasible: Candidate[] = [];
  for (const [index, raw] of (input.items as readonly unknown[]).entries()) {
    const candidate = parseItem(raw, index);
    if (seen.has(candidate.id)) fail(`duplicate item id ${JSON.stringify(candidate.id)}`);
    seen.add(candidate.id);
    if (candidate.bytes > budgetBytes) continue; // infeasible: skipped, never silently included
    feasible.push({
      ...candidate,
      singletonGain: candidate.weight + diversityWeight * candidate.features.length,
    });
  }

  // Lazy density-greedy. Queue keys are upper bounds on true marginals
  // (submodularity: marginals only shrink as S grows), so a recomputed node
  // that still tops the queue is the true greedy pick.
  const covered = new Set<string>();
  const heap: Node[] = [];
  for (const candidate of feasible) heapPush(heap, { candidate, gain: candidate.singletonGain, computedAt: 0 });
  let version = 0;
  let remaining = budgetBytes;
  let cumulativeGain = 0;
  const greedySelected: Item[] = [];
  const greedyTrace: TraceEntry[] = [];

  for (let node = heapPop(heap); node !== undefined; node = heapPop(heap)) {
    const { candidate } = node;
    if (candidate.bytes > remaining) continue; // infeasible now and forever: remaining only shrinks
    if (node.computedAt !== version) {
      let uncovered = 0;
      for (const feature of candidate.features) if (!covered.has(feature)) uncovered += 1;
      node = { candidate, gain: candidate.weight + diversityWeight * uncovered, computedAt: version };
      if (node.gain <= 0) continue; // zero gain adds nothing and only burns bytes; marginals never recover
      const next = heap[0];
      if (next !== undefined && ranksBefore(next, node)) {
        heapPush(heap, node);
        continue;
      }
    } else if (node.gain <= 0) {
      continue;
    }
    // node.gain is exact at the current S and still tops the queue: pick it.
    version += 1;
    remaining -= candidate.bytes;
    cumulativeGain += node.gain;
    for (const feature of candidate.features) covered.add(feature);
    greedySelected.push(candidate.item);
    greedyTrace.push({
      id: candidate.id,
      marginalGain: node.gain,
      gainPerByte: node.gain / candidate.bytes,
      cumulativeGain,
    });
  }

  // Classic fallback: keep the better of the density-greedy run and the best
  // feasible singleton; an exact objective tie keeps density-greedy.
  let bestSingle: Candidate | undefined;
  for (const candidate of feasible) {
    if (bestSingle === undefined
      || candidate.singletonGain > bestSingle.singletonGain
      || (candidate.singletonGain === bestSingle.singletonGain && candidate.id < bestSingle.id)) {
      bestSingle = candidate;
    }
  }

  let selected: readonly Item[];
  let trace: readonly TraceEntry[];
  let objective: number;
  let totalBytes: number;
  let fallbackUsed: Selection["fallbackUsed"];
  if (bestSingle !== undefined && bestSingle.singletonGain > cumulativeGain) {
    selected = [bestSingle.item];
    trace = [{
      id: bestSingle.id,
      marginalGain: bestSingle.singletonGain,
      gainPerByte: bestSingle.singletonGain / bestSingle.bytes,
      cumulativeGain: bestSingle.singletonGain,
    }];
    objective = bestSingle.singletonGain;
    totalBytes = bestSingle.bytes;
    fallbackUsed = "best-single";
  } else {
    selected = greedySelected;
    trace = greedyTrace;
    objective = cumulativeGain;
    totalBytes = budgetBytes - remaining;
    fallbackUsed = "density-greedy";
  }
  if (!Number.isFinite(objective)) fail("objective overflowed to a non-finite value");

  const selectionSha256 = canonicalSha256({
    objective,
    protocol: SUBMODULAR_SELECTION_PROTOCOL,
    selected: selected.map((item) => item.id),
    trace,
  });
  return { selected, trace, objective, totalBytes, budgetBytes, fallbackUsed, selectionSha256 };
}
