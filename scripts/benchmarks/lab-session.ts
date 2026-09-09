import { Database } from "bun:sqlite";
import type { Corpus, Turn } from "./datasets";
import { pack, queryTerms, renderTurn, type Retrieved, type RetrievalBudget } from "./retrieval";

/** Lab-only BM25 over complete session occurrences; topK counts sessions, not turns.
 * Indexing receives only the corpus. Hits retain original turn order and rendering;
 * whole turns that do not fit the shared UTF-8 byte budget are omitted, never cut. */
export function createLabSession(corpus: Corpus): {
  retrieve(question: string, budget: RetrievalBudget): Promise<Retrieved>;
  close(): void;
} {
  const sessions: Turn[][] = [];
  const byOccurrence = new Map<string, Turn[]>();
  for (const turn of corpus.turns) {
    const key = JSON.stringify([turn.sessionId, turn.sessionIndex ?? null]);
    let session = byOccurrence.get(key);
    if (session === undefined) {
      session = [];
      byOccurrence.set(key, session);
      sessions.push(session);
    }
    session.push(turn);
  }
  const database = new Database(":memory:");
  try {
    database.run("CREATE VIRTUAL TABLE sessions USING fts5(text, tokenize='unicode61 remove_diacritics 2')");
    const insert = database.prepare("INSERT INTO sessions (rowid, text) VALUES (?, ?)");
    database.transaction(() => sessions.forEach((turns, index) =>
      insert.run(index + 1, turns.map(renderTurn).join("\n\n"))))();
  } catch (error) { database.close(); throw error; }
  let closed = false;
  return {
    async retrieve(question, budget) {
      if (closed) throw new Error("Session retriever is closed.");
      if (!Number.isSafeInteger(budget.topK) || budget.topK < 1 || budget.topK > 100
        || !Number.isSafeInteger(budget.contextBytes) || budget.contextBytes < 1 || budget.contextBytes > 4_000_000) {
        throw new RangeError("Invalid retrieval budget.");
      }
      const terms = queryTerms(question, true);
      const match = terms.map(term => `"${term}"`).join(" OR ");
      const hits = match ? database.query<{ session_rowid: number }, [string, number]>(
        "SELECT rowid AS session_rowid FROM sessions WHERE sessions MATCH ? ORDER BY bm25(sessions), rowid LIMIT ?",
      ).all(match, budget.topK) : [];
      return pack(hits.flatMap(hit => sessions[hit.session_rowid - 1]!.map(turn => ({ turn }))), budget.contextBytes);
    },
    close() { if (!closed) { database.close(); closed = true; } },
  };
}
