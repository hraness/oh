import type { Corpus, Turn } from "./datasets";
import { pack, type Retrieved, type RetrievalBudget } from "./retrieval";

export type WindowCandidate = Readonly<{ turn: Turn; digest?: string }>;
export type WindowCandidateResolver = (turnId: string) => WindowCandidate | undefined;
export type OrderedWindowOptions = Readonly<{
  sessionCap?: number;
  windowRadius?: number;
  diverseFill?: boolean;
}>;

/** Shared selection policy for deductive and vector rankings. Ranked seeds
 * expand first, each seed before its neighbors in source order, within the
 * same session occurrence. Eligible remaining ranks fill round-robin across
 * sessions. Duplicate candidates remain until pack() applies the byte budget.
 * The caller defines fill eligibility: union's lexical fallback can seed a
 * window but must not become positive derived evidence during tail fill. */
export function orderedWindowPlan<Row extends Readonly<{ turnId: string }>>(input: Readonly<{
  corpus: Corpus;
  positionOf: ReadonlyMap<string, number>;
  ordered: readonly Row[];
  topK: number;
  candidateOf: WindowCandidateResolver;
  canFill: (row: Row) => boolean;
  options?: OrderedWindowOptions;
}>): Readonly<{ seeds: readonly Row[]; candidates: readonly WindowCandidate[] }> {
  const { corpus, positionOf, ordered, topK, candidateOf, canFill } = input;
  const options = input.options ?? {};
  const sessionOf = (turnId: string): string => {
    const index = positionOf.get(turnId);
    return index === undefined ? "" : corpus.turns[index]!.sessionId;
  };
  let seeds = ordered.slice(0, topK);
  const sessionCap = options.sessionCap;
  if (sessionCap !== undefined && sessionCap > 0) {
    const counts = new Map<string, number>();
    const capped: Row[] = [], overflow: Row[] = [];
    for (const row of ordered) {
      const session = sessionOf(row.turnId);
      const n = counts.get(session) ?? 0;
      if (n < sessionCap) { counts.set(session, n + 1); capped.push(row); }
      else overflow.push(row);
    }
    seeds = [...capped, ...overflow].slice(0, topK);
  }
  const seedIds = new Set(seeds.map((row) => row.turnId));
  const radius = options.windowRadius ?? 2;
  // Preserve the existing deductive API's rejection, including its message.
  if (!Number.isSafeInteger(radius) || radius < 0 || radius > 8) {
    throw new TypeError("deductive retrieval: invalid windowRadius");
  }
  const candidates = seeds.flatMap(({ turnId }) => {
    const candidate = candidateOf(turnId);
    if (candidate === undefined) return [];
    const position = positionOf.get(turnId)!;
    const neighbors = Array.from({ length: radius * 2 + 1 }, (_, i) => position - radius + i)
      .filter((index) => index !== position
        && corpus.turns[index]?.sessionId === candidate.turn.sessionId
        && corpus.turns[index]?.sessionIndex === candidate.turn.sessionIndex)
      .flatMap((index) => {
        const neighbor = candidateOf(corpus.turns[index]!.id);
        return neighbor === undefined ? [] : [neighbor];
      });
    return [candidate, ...neighbors];
  });
  const inWindow = new Set(candidates.map((candidate) => candidate.turn.id));
  const fillRows = ordered.filter((row) => !seedIds.has(row.turnId)
    && !inWindow.has(row.turnId) && canFill(row));
  const fillOrdered = options.diverseFill !== false
    ? (() => {
        const bySession = new Map<string, Row[]>();
        for (const row of fillRows) {
          const session = sessionOf(row.turnId);
          const list = bySession.get(session) ?? [];
          list.push(row);
          bySession.set(session, list);
        }
        const queues = [...bySession.values()];
        const out: Row[] = [];
        for (let depth = 0; queues.some((queue) => depth < queue.length); depth++) {
          for (const queue of queues) if (depth < queue.length) out.push(queue[depth]!);
        }
        return out;
      })()
    : fillRows;
  const sessionFill = fillOrdered.flatMap((row) => {
    const candidate = candidateOf(row.turnId);
    return candidate === undefined ? [] : [candidate];
  }).slice(0, topK);
  return { seeds, candidates: [...candidates, ...sessionFill] };
}

/** Apply the identical window/fill/byte policy to an already ordered vector
 * ranking. Only supplied ranks can seed or fill; a frozen top-20 capture
 * cannot invent ranks 21 onward. Scores affect fill eligibility, not order. */
export function vectorWindowRetrieve(corpus: Corpus, positionOf: ReadonlyMap<string, number>,
  ranked: readonly Readonly<{ turnId: string; score: number }>[], budget: RetrievalBudget,
  candidateOf: WindowCandidateResolver, options: OrderedWindowOptions = {}): Retrieved {
  const plan = orderedWindowPlan({ corpus, positionOf, ordered: ranked, topK: budget.topK,
    candidateOf, canFill: (row) => row.score > 0, options });
  return pack(plan.candidates, budget.contextBytes);
}
