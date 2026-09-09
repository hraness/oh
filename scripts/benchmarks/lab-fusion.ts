import type { Corpus, Turn } from "./datasets";
import { pack, type createRetrievers, type Retrieved, type RetrievalBudget } from "./retrieval";

const SOURCE_BUDGET = Object.freeze({ topK: 100, contextBytes: 4_000_000 });
const SOURCES = ["bm25-focused", "bm25-block"] as const;
const RANK_CONSTANT = 60;

/** Lab-only host rank fusion, with no model or semantic ranking. Each source contributes its
 * first 100 returned raw turns with score 1 / (60 + rank), once per distinct turn. Source
 * rankings are cached per exact question only within this corpus snapshot; output budgets
 * never affect them. The caller owns the shared retrievers and their lifetime. */
export function createLabFusion(corpus: Corpus, retrievers: Pick<ReturnType<typeof createRetrievers>, "retrieve">): {
  retrieve(question: string, budget: RetrievalBudget): Promise<Retrieved>;
} {
  const turns: readonly Turn[] = corpus.turns.map(turn => Object.freeze({ id: turn.id, sessionId: turn.sessionId,
    ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
    date: turn.date, speaker: turn.speaker, text: turn.text }));
  const positions = new Map(turns.map((turn, index) => [turn.id, index]));
  if (positions.size !== turns.length) throw new TypeError("Fusion requires unique raw turn IDs.");
  const queries = new Map<string, Promise<readonly Turn[]>>();
  async function rank(question: string): Promise<readonly Turn[]> {
    const results = await Promise.allSettled(SOURCES.map(source => retrievers.retrieve(source, question, SOURCE_BUDGET)));
    const scores = new Map<number, number>();
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      const ids = [...new Set(result.value.turnIds.slice(0, SOURCE_BUDGET.topK))];
      for (const [index, id] of ids.entries()) {
        const position = positions.get(id);
        if (position === undefined) throw new Error("Fusion source returned a different corpus turn.");
        scores.set(position, (scores.get(position) ?? 0) + 1 / (RANK_CONSTANT + index + 1));
      }
    }
    return Object.freeze([...scores].sort(([leftPosition, leftScore], [rightPosition, rightScore]) =>
      rightScore - leftScore || leftPosition - rightPosition).map(([position]) => turns[position]!));
  }
  return {
    async retrieve(question, budget) {
      if (!Number.isSafeInteger(budget.topK) || budget.topK < 1 || budget.topK > 100
        || !Number.isSafeInteger(budget.contextBytes) || budget.contextBytes < 1 || budget.contextBytes > 4_000_000) {
        throw new RangeError("Invalid retrieval budget.");
      }
      if (typeof question !== "string" || Buffer.byteLength(question) > 65_536) throw new TypeError("Invalid lab question.");
      let ranked = queries.get(question);
      if (ranked === undefined) { ranked = rank(question); queries.set(question, ranked); }
      return pack((await ranked).slice(0, budget.topK).map(turn => ({ turn })), budget.contextBytes);
    },
  };
}
