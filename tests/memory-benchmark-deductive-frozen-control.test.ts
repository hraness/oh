import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import type { Corpus, Dataset, Question } from "../scripts/benchmarks/datasets";
import { frozenWindow, replayFrozenRows, summarizeControl, writeFrozenControl,
  type FrozenRow } from "../scripts/benchmarks/deductive-frozen-control";
import { evidenceMetrics } from "../scripts/benchmarks/metrics";
import { pack } from "../scripts/benchmarks/retrieval";

function corpus(id: string): Corpus {
  return { id, groupId: id, turns: Array.from({ length: 4 }, (_, index) => ({
    id: `${id}-${index}`, sessionId: id, sessionIndex: 0, date: "2023-05-01",
    speaker: "Alex", text: `Source ${id}-${index}.`,
  })) };
}

const corpora = [corpus("a"), corpus("b")];
const questions: readonly Question[] = [
  ...corpora.map((item): Question => ({ id: `q-${item.id}`, corpusId: item.id, category: "1",
    question: "Which source?", questionDate: "", answer: "Two", unanswerable: false,
    evidenceTurnIds: [`${item.id}-2`], evidenceSessionIds: [item.id] })),
  { id: "q-unanswerable", corpusId: "a", category: "5", question: "Unknown?", questionDate: "",
    answer: "Unknown", unanswerable: true, evidenceTurnIds: [], evidenceSessionIds: [] },
];
const dataset: Dataset = { corpora, questions };
const historicalArms = ["bm25-block", "deductive", "deductive-semantic", "vector"];

function row(question: Question, arm: string, selected = 0): FrozenRow {
  const source = corpora.find((item) => item.id === question.corpusId)!;
  const result = pack([{ turn: source.turns[selected]! }], 12_000);
  return { questionId: question.id, corpusId: source.id, groupId: source.groupId,
    category: question.category, arm, unanswerable: question.unanswerable,
    contextBytes: Buffer.byteLength(result.context), contextSha256: sha256Hex(result.context),
    turnIds: result.turnIds, metrics: evidenceMetrics(question, result.turnIds, result.sessionIds) };
}

function historicalRows(): FrozenRow[] {
  return questions.flatMap((question) => historicalArms.map((arm) => row(question, arm)));
}

describe("frozen vector-window control", () => {
  test("requires the complete unique top-K capture and known source turns", () => {
    const source = corpus("capture");
    const budget = { topK: 2, contextBytes: 12_000 };
    expect(() => frozenWindow(source, ["capture-0"], budget)).toThrow("complete unique top-K");
    expect(() => frozenWindow(source, ["capture-0", "capture-1", "capture-2"], budget))
      .toThrow("complete unique top-K");
    expect(() => frozenWindow(source, ["capture-0", "capture-0"], budget)).toThrow("complete unique top-K");
    expect(() => frozenWindow(source, ["capture-0", "unknown"], budget)).toThrow("unknown turn");
    const result = frozenWindow(source, ["capture-1", "capture-3"], budget);
    expect(result.turnIds).toEqual(["capture-1", "capture-0", "capture-2", "capture-3"]);
    // frozenWindow does not mutate the source order while expanding ranks.
    expect(source.turns.map((turn) => turn.id)).toEqual(["capture-0", "capture-1", "capture-2", "capture-3"]);
  });

  test("replays complete comparisons from source records and reference labels", () => {
    const rows = historicalRows();
    expect(replayFrozenRows(dataset, rows)).toEqual(rows);
    expect(rows.filter((item) => item.unanswerable).every((item) => item.metrics.turnRecall === null)).toBe(true);
    expect(() => replayFrozenRows(dataset, rows.slice(1))).toThrow("every question and comparison arm");
    expect(() => replayFrozenRows(dataset, [...rows, rows[0]!])).toThrow("Duplicate frozen question/arm");
  });

  test("rejects forged identities, missing turns, changed context, and changed stored metrics", () => {
    const rows = historicalRows();
    const first = rows[0]!;
    for (const mutation of [
      { questionId: "unknown" }, { corpusId: "unknown" }, { corpusId: "b" },
      { groupId: "different" }, { category: "different" }, { unanswerable: true },
    ]) {
      expect(() => replayFrozenRows(dataset, [{ ...first, ...mutation }, ...rows.slice(1)]))
        .toThrow("Frozen row identity mismatch");
    }
    expect(() => replayFrozenRows(dataset, [{ ...first, turnIds: ["missing"] }, ...rows.slice(1)]))
      .toThrow("Unknown frozen turn");
    for (const mutation of [
      { turnIds: [first.turnIds[0]!, first.turnIds[0]!] },
      { contextSha256: "0".repeat(64) }, { contextBytes: first.contextBytes + 1 },
      { metrics: { ...first.metrics, turnRecall: 1 } },
    ]) {
      expect(() => replayFrozenRows(dataset, [{ ...first, ...mutation }, ...rows.slice(1)]))
        .toThrow("Frozen context/metric replay mismatch");
    }
  });

  test("does not trust a historical context or metric when source text or reference labels change", () => {
    const changedText: Dataset = { ...dataset, corpora: dataset.corpora.map((item) => ({ ...item,
      turns: item.turns.map((turn) => ({ ...turn, text: `${turn.text} changed` })) })) };
    expect(() => replayFrozenRows(changedText, historicalRows())).toThrow("context/metric replay mismatch");
    const changedReference: Dataset = { ...dataset, questions: dataset.questions.map((question) => ({ ...question,
      evidenceTurnIds: [`${question.corpusId}-0`] })) };
    expect(() => replayFrozenRows(changedReference, historicalRows())).toThrow("context/metric replay mismatch");
  });

  test("comparison direction is window minus historical, excluding null metrics only from scored means", () => {
    const rows = questions.flatMap((question) => [row(question, "bm25-block"), row(question, "vector-window", 2)]);
    const result = summarizeControl(rows);
    expect(result.summaries["bm25-block"]?.turnRecall).toBe(0);
    expect(result.summaries["vector-window"]).toMatchObject({ questions: 3, annotatedQuestions: 2,
      turnRecall: 1, allEvidenceRecall: 1 });
    expect(result.vectorWindowMinus["bm25-block"]).toEqual({ clusters: 2, delta: 1,
      lower: 1, upper: 1, samples: 2000 });
  });

  test("publication reuses identical bytes and preserves a conflicting or incomplete artifact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oh-frozen-control-"));
    const path = join(directory, "result.json");
    const bytes = '{"complete":true}';
    try {
      await writeFrozenControl(path, bytes);
      await writeFrozenControl(path, bytes);
      expect(readFileSync(path, "utf8")).toBe(bytes);
      await expect(writeFrozenControl(path, '{"complete":false}')).rejects.toMatchObject({ code: "EEXIST" });
      expect(readFileSync(path, "utf8")).toBe(bytes);
      writeFileSync(path, '{"complete":');
      await expect(writeFrozenControl(path, bytes)).rejects.toMatchObject({ code: "EEXIST" });
      expect(readFileSync(path, "utf8")).toBe('{"complete":');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
