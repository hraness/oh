import type { Corpus, Turn } from "./datasets";
import { createLabUser } from "./lab-user";
import { pack, type createRetrievers, type Retrieved, type RetrievalBudget } from "./retrieval";

const SOURCE_BUDGET = Object.freeze({ topK: 100, contextBytes: 4_000_000 });

export type LabUserHybrid = Readonly<{
  retrieve(query: string, budget: RetrievalBudget): Promise<Retrieved>;
  close(): void;
}>;

function validBudget(budget: RetrievalBudget): void {
  if (!Number.isSafeInteger(budget.topK) || budget.topK < 1 || budget.topK > 100
    || !Number.isSafeInteger(budget.contextBytes) || budget.contextBytes < 1 || budget.contextBytes > 4_000_000) {
    throw new RangeError("Invalid retrieval budget.");
  }
}

/**
 * Lab-only label-free raw-turn union. It alternates the filtered human-turn BM25 ranking with
 * original-corpus BM25, starting with the filtered ranking. This is intentionally unlike block
 * fusion: it has no derived units, reciprocal scores, or consensus weighting. Original source
 * turns are rendered after ID validation, so assistant-only facts can remain available.
 */
export function createLabUserHybrid(corpus: Corpus, original: Pick<ReturnType<typeof createRetrievers>, "retrieve">): LabUserHybrid {
  const turns: readonly Turn[] = corpus.turns.map(turn => Object.freeze({ id: turn.id, sessionId: turn.sessionId,
    ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
    date: turn.date, speaker: turn.speaker, text: turn.text }));
  const byId = new Map(turns.map(turn => [turn.id, turn]));
  if (byId.size !== turns.length) throw new TypeError("User hybrid requires unique raw turn IDs.");
  const user = createLabUser(corpus);
  const queries = new Map<string, Promise<readonly Turn[]>>();
  let closed = false;
  const ensureOpen = () => { if (closed) throw new Error("Lab user hybrid is closed."); };

  async function ranking(query: string): Promise<readonly Turn[]> {
    const [human, inclusive] = await Promise.all([
      user.retrieve(query, SOURCE_BUDGET, "focused"),
      original.retrieve("bm25-focused", query, SOURCE_BUDGET),
    ]);
    const resolve = (ids: readonly string[]) => ids.slice(0, SOURCE_BUDGET.topK).map(id => {
      const turn = byId.get(id);
      if (turn === undefined) throw new Error("User hybrid source returned a different corpus turn.");
      return turn;
    });
    const ranks = [resolve(human.turnIds), resolve(inclusive.turnIds)];
    const cursors = [0, 0], selected = new Set<string>(), ordered: Turn[] = [];
    while (true) {
      let progressed = false;
      for (const [source, rank] of ranks.entries()) {
        while (cursors[source]! < rank.length) {
          const turn = rank[cursors[source]!]!;
          cursors[source]! += 1;
          if (selected.has(turn.id)) continue;
          selected.add(turn.id); ordered.push(turn); progressed = true;
          break;
        }
      }
      if (!progressed) return Object.freeze(ordered);
    }
  }

  return Object.freeze({
    async retrieve(query, budget) {
      ensureOpen(); validBudget(budget);
      if (typeof query !== "string" || Buffer.byteLength(query) > 65_536) throw new TypeError("Invalid lab question.");
      let ranked = queries.get(query);
      if (ranked === undefined) { ranked = ranking(query); queries.set(query, ranked); }
      return pack((await ranked).slice(0, budget.topK).map(turn => ({ turn })), budget.contextBytes);
    },
    close() { if (!closed) { closed = true; user.close(); } },
  });
}
