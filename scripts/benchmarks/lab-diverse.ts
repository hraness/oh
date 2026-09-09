import type { Corpus, Turn } from "./datasets";
import { pack, renderTurn, type createRetrievers, type Retrieved, type RetrievalBudget } from "./retrieval";

const SOURCE_BUDGET = Object.freeze({ topK: 100, contextBytes: 4_000_000 });

/**
 * Lab-only raw evidence allocation. topK counts ranked anchor candidates; returned raw
 * turns may exceed it. Dates stay attached to source text, without recency inference.
 * The caller owns the shared retriever and its lifetime. Exact-query ranking is cached
 * once per detached corpus snapshot, independently of requested output budgets.
 */
export function createLabDiverse(corpus: Corpus, retrievers: Pick<ReturnType<typeof createRetrievers>, "retrieve">): {
  retrieve(question: string, budget: RetrievalBudget): Promise<Retrieved>;
} {
  const turns: readonly Turn[] = corpus.turns.map(turn => Object.freeze({ id: turn.id, sessionId: turn.sessionId,
    ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
    date: turn.date, speaker: turn.speaker, text: turn.text }));
  const positions = new Map(turns.map((turn, index) => [turn.id, index]));
  if (positions.size !== turns.length) throw new TypeError("Diverse retrieval requires unique raw turn IDs.");
  const occurrences = turns.map(turn => JSON.stringify([turn.sessionId, turn.sessionIndex ?? null]));
  const renderedBytes = turns.map(turn => Buffer.byteLength(renderTurn(turn)));
  const neighbors = (index: number) => [index - 1, index + 1].filter(position => position >= 0
    && position < turns.length && occurrences[position] === occurrences[index]);
  const queries = new Map<string, Promise<readonly number[]>>();
  async function rank(question: string): Promise<readonly number[]> {
    const result = await retrievers.retrieve("bm25-focused", question, SOURCE_BUDGET);
    const ids = [...new Set(result.turnIds.slice(0, SOURCE_BUDGET.topK))];
    return Object.freeze(ids.map(id => {
      const position = positions.get(id);
      if (position === undefined) throw new Error("Diverse source returned a different corpus turn.");
      return position;
    }));
  }
  return {
    async retrieve(question, budget) {
      if (!Number.isSafeInteger(budget.topK) || budget.topK < 1 || budget.topK > 100
        || !Number.isSafeInteger(budget.contextBytes) || budget.contextBytes < 1 || budget.contextBytes > 4_000_000) {
        throw new RangeError("Invalid retrieval budget.");
      }
      if (typeof question !== "string" || Buffer.byteLength(question) > 65_536) throw new TypeError("Invalid lab question.");
      let ranking = queries.get(question);
      if (ranking === undefined) { ranking = rank(question); queries.set(question, ranking); }
      const anchors = (await ranking).slice(0, budget.topK);
      const groups = new Map<string, number[]>();
      for (const anchor of anchors) {
        const occurrence = occurrences[anchor]!;
        const group = groups.get(occurrence);
        if (group === undefined) groups.set(occurrence, [anchor]); else group.push(anchor);
      }
      const orderedGroups = [...groups.values()]; // Earliest source rank determines occurrence order.
      const selected = new Set<number>(), ordered: number[] = [];
      let bytes = 0;
      const add = (index: number, ceiling: number): boolean => {
        if (selected.has(index)) return false;
        const needed = renderedBytes[index]! + (ordered.length ? 2 : 0); // Same separators as pack().
        if (bytes + needed > ceiling) return false;
        selected.add(index); ordered.push(index); bytes += needed;
        return true;
      };
      const half = Math.floor(budget.contextBytes / 2);
      const seeds: number[] = [];
      // First rank-ordered anchor fitting the remaining reservation in each occurrence.
      for (const group of orderedGroups) {
        const seed = group.find(anchor => add(anchor, half));
        if (seed !== undefined) seeds.push(seed);
      }
      const roundRobin = (queues: readonly (readonly number[])[]) => {
        const maximum = Math.max(0, ...queues.map(queue => queue.length));
        for (let offset = 0; offset < maximum; offset += 1) for (const queue of queues) {
          const index = queue[offset];
          if (index !== undefined) add(index, budget.contextBytes);
        }
      };
      // Preceding then following, one neighbor per seeded occurrence per round.
      roundRobin(seeds.map(neighbors));
      // Remaining anchors and their neighbors stay eligible even if an anchor is too large.
      // Freeze these queues before packing; repeated IDs never receive extra space.
      roundRobin(orderedGroups.map(group => group.filter(anchor => !seeds.includes(anchor))
        .flatMap(anchor => [anchor, ...neighbors(anchor)])));
      const candidates = new Set(anchors.flatMap(anchor => [anchor, ...neighbors(anchor)]));
      const result = pack(ordered.map(index => ({ turn: turns[index]! })), budget.contextBytes);
      if (Buffer.byteLength(result.context) !== bytes || result.turnIds.length !== selected.size) {
        throw new Error("Diverse packing disagrees with shared raw-turn rendering.");
      }
      // Reservation failures alone are not omissions; count the final deduplicated candidate set.
      return { ...result, omittedForBudget: candidates.size - selected.size };
    },
  };
}
