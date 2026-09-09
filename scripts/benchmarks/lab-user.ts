import type { Corpus, Turn } from "./datasets";
import { createRetrievers, pack, type Retrieved, type RetrievalBudget } from "./retrieval";

export type LabUserMode = "focused" | "context";

export type LabUser = Readonly<{
  retrieve(query: string, budget: RetrievalBudget, mode?: LabUserMode): Promise<Retrieved>;
  close(): void;
}>;

function validBudget(budget: RetrievalBudget): void {
  if (!Number.isSafeInteger(budget.topK) || budget.topK < 1 || budget.topK > 100
    || !Number.isSafeInteger(budget.contextBytes) || budget.contextBytes < 1 || budget.contextBytes > 4_000_000) {
    throw new RangeError("Invalid retrieval budget.");
  }
}

function snapshot(turn: Turn): Turn {
  return Object.freeze({ id: turn.id, sessionId: turn.sessionId,
    ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
    date: turn.date, speaker: turn.speaker, text: turn.text });
}

/**
 * Lab-only candidate: removes only explicit assistant-role turns before indexing. All other
 * original speakers, including named LoCoMo participants, remain raw source evidence. This can
 * lose facts stated solely in assistant answers; it is not a production or default retriever.
 */
export function createLabUser(corpus: Corpus): LabUser {
  const turns = Object.freeze(corpus.turns.filter(turn => turn.speaker.toLocaleLowerCase("en-US") !== "assistant").map(snapshot));
  const filtered = Object.freeze({ id: corpus.id, groupId: corpus.groupId, turns });
  const retrievers = turns.length ? createRetrievers(filtered) : undefined;
  let closed = false;
  const ensureOpen = () => { if (closed) throw new Error("Lab user retriever is closed."); };

  return Object.freeze({
    async retrieve(query, budget, mode = "focused") {
      ensureOpen();
      validBudget(budget);
      if (typeof query !== "string" || Buffer.byteLength(query) > 65_536) throw new TypeError("Invalid lab question.");
      if (mode !== "focused" && mode !== "context") throw new TypeError("Unknown lab user mode.");
      if (turns.length === 0) return pack([], budget.contextBytes);
      if (mode === "context") return pack(turns.map(turn => ({ turn })), budget.contextBytes);
      return retrievers!.retrieve("bm25-focused", query, budget);
    },
    close() { if (!closed) { closed = true; retrievers?.close(); } },
  });
}
