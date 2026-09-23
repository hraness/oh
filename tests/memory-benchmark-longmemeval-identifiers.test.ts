import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import { recordDocument } from "../src/semantic-model";
import { DATASETS, parseLongMemEval, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, validateEvolutionDatasetManifest } from "../scripts/benchmarks/evolution-dataset";
import { createEvolutionFullHistorySource } from "../scripts/benchmarks/evolution-full-history";
import { makeEvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { EVOLUTION_ANSWER_CONTRACT_IDS, evolutionAnswerMessages } from "../scripts/benchmarks/evolution-reader-contracts";
import { prepareEvolutionCorpus } from "../scripts/benchmarks/evolution-retrieval";
import { corpusIdentity, validateUnitBundle, type UnitBundle } from "../scripts/benchmarks/extract";
import { evidenceMetrics } from "../scripts/benchmarks/metrics";
import { createRetrievers } from "../scripts/benchmarks/retrieval";
import { runRetrieval } from "../scripts/benchmarks/runner";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, extractionMessages } from "../scripts/benchmarks/units";

const answerSession = "answer_azimuth_marker", otherSession = "unrelated_quasar_abs";
const corpusId = "question_canary_abs";
function fixture() {
  return {
    question_id: corpusId, question_type: "multi-session", question: "What is on the bicycle?",
    question_date: "2025/02/01 12:00", answer: "SYNTHETIC_GOLD_SENTINEL",
    haystack_session_ids: [answerSession, otherSession, answerSession],
    haystack_dates: ["2025/01/03 09:00", "2025/01/01 09:00", "2025/01/01 09:00"],
    haystack_sessions: [
      [{ role: "user", content: "Later source.\n🦀日本語 é café.", has_answer: true },
        { role: "assistant", content: "Keep the later date." }],
      [{ role: "user", content: "A cobalt bicycle." }],
      [{ role: "user", content: "A tangerine basket.", has_answer: true },
        { role: "assistant", content: "One basket.", has_answer: false }],
    ],
    answer_session_ids: [answerSession, otherSession, answerSession],
  };
}

function legacyDataset(current: Dataset): Dataset {
  // Synthetic prior-format artifact, not a parser option or a dataset lookup.
  const ids = [`${otherSession}:0`, `${answerSession}#2:0`, `${answerSession}#2:1`,
    `${answerSession}#0:0`, `${answerSession}#0:1`];
  return {
    corpora: current.corpora.map(corpus => ({ ...corpus, turns: corpus.turns.map((turn, index) => ({ ...turn,
      id: ids[index]!, sessionId: turn.sessionIndex === 1 ? otherSession : answerSession })) })),
    questions: current.questions.map(question => ({ ...question,
      evidenceTurnIds: [`${answerSession}#0:0`, `${answerSession}#2:0`], evidenceSessionIds: [answerSession, otherSession] })),
  };
}

describe("LongMemEval neutral source identifiers", () => {
  test("preserves authored fields and stable chronological order with aliases assigned in source order", () => {
    const data = parseLongMemEval([fixture()]);
    expect(data.corpora[0]).toEqual({ id: corpusId, groupId: "question_canary", turns: [
      { id: "s0002#1:0", sessionId: "s0002", sessionIndex: 1, date: "2025/01/01 09:00", speaker: "user", text: "A cobalt bicycle." },
      { id: "s0001#2:0", sessionId: "s0001", sessionIndex: 2, date: "2025/01/01 09:00", speaker: "user", text: "A tangerine basket." },
      { id: "s0001#2:1", sessionId: "s0001", sessionIndex: 2, date: "2025/01/01 09:00", speaker: "assistant", text: "One basket." },
      { id: "s0001#0:0", sessionId: "s0001", sessionIndex: 0, date: "2025/01/03 09:00", speaker: "user", text: "Later source.\n🦀日本語 é café." },
      { id: "s0001#0:1", sessionId: "s0001", sessionIndex: 0, date: "2025/01/03 09:00", speaker: "assistant", text: "Keep the later date." },
    ] });
    expect(data.questions[0]).toMatchObject({ id: corpusId, corpusId, question: "What is on the bicycle?",
      questionDate: "2025/02/01 12:00", answer: "SYNTHETIC_GOLD_SENTINEL", unanswerable: true,
      evidenceTurnIds: ["s0001#0:0", "s0001#2:0"], evidenceSessionIds: ["s0001", "s0002"] });
  });

  test("source IDs and gold labels cannot change the memory corpus, while literal authored text remains intact", () => {
    const original = fixture(), renamed = fixture();
    renamed.haystack_session_ids = ["plain-first", "plain-second", "plain-first"];
    renamed.answer_session_ids = ["plain-first", "plain-second", "plain-first"];
    const baseline = parseLongMemEval([original]);
    expect(parseLongMemEval([renamed])).toEqual(baseline);
    const relabeled = { ...renamed, answer: "DIFFERENT_GOLD", answer_session_ids: ["missing-evidence"],
      haystack_sessions: renamed.haystack_sessions.map(session => session.map(turn => ({ ...turn, has_answer: false }))) };
    expect(parseLongMemEval([relabeled]).corpora).toEqual(baseline.corpora);
    const authored = fixture();
    authored.haystack_sessions[0]![0]!.content = `Authored literals: ${answerSession} ${otherSession} ${corpusId}\n`;
    expect(parseLongMemEval([authored]).corpora[0]!.turns[3]!.text).toBe(authored.haystack_sessions[0]![0]!.content);
  });

  test("retains duplicate-session equivalence classes, occurrence boundaries, and evidence denominators", async () => {
    const data = parseLongMemEval([{ ...fixture(), question_id: "answerable" }]);
    const corpus = data.corpora[0]!, question = data.questions[0]!;
    expect(question.evidenceSessionIds).toEqual(["s0001", "s0002"]);
    expect(new Set(corpus.turns.map(turn => turn.id)).size).toBe(5);
    expect(evidenceMetrics(question, ["s0001#2:0"], ["s0001"])).toMatchObject({ turnRecall: 0.5, sessionRecall: 0.5 });
    const retrievers = createRetrievers(corpus);
    try {
      const result = await retrievers.retrieve("oh-window", "tangerine", { topK: 1, contextBytes: 2_000 });
      expect(result.turnIds).toEqual(["s0001#2:0", "s0001#2:1"]);
    } finally { retrievers.close(); }
    const report = await runRetrieval(data, ["full-context"], { topK: 10, contextBytes: 2_000 }, 17);
    expect(report.ingestion[0]!.duplicateSessionIds).toBe(1);
    expect(report.rows[0]!.metrics).toMatchObject({ turnRecall: 1, sessionRecall: 1 });
  });

  test("keeps unmappable evidence as distinct misses even when a raw reference resembles a neutral alias", () => {
    const data = parseLongMemEval([{ ...fixture(), question_id: "answerable",
      answer_session_ids: [answerSession, "s0001", "missing-session-0002", "s0001"] }]);
    const question = data.questions[0]!, present = data.corpora[0]!.turns.map(turn => turn.sessionId);
    expect(question.evidenceSessionIds).toHaveLength(3);
    expect(new Set(question.evidenceSessionIds).size).toBe(3);
    expect(question.evidenceSessionIds[0]).toBe("s0001");
    expect(question.evidenceSessionIds.slice(1).every(reference => !present.includes(reference))).toBeTrue();
    expect(evidenceMetrics(question, [], present).sessionRecall).toBeCloseTo(1 / 3);
  });

  test("keeps structural cues out of lexical indexes, semantic documents, extraction, and reader requests", async () => {
    const data = parseLongMemEval([fixture()]), corpus = data.corpora[0]!, question = data.questions[0]!;
    let indexed: readonly KnowledgeGraphRecordV1[] = [];
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { indexed = records; return { indexed: records.length, v: 1 }; },
      async search(_query, limit, authority) {
        return indexed.slice(0, limit).map((record, index) => {
          expect(authority.get(record.key)?.recordSha256).toBe(record.recordSha256);
          return { key: record.key, recordSha256: record.recordSha256, score: 1 - index / 10, v: 1 as const };
        });
      }, async close() {},
    };
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
    try {
      for (const system of ["bm25-window", "oh-keyword"] as const) {
        for (const query of [answerSession, otherSession, corpusId]) {
          const result = await prepared.retrieve(query, { id: `${system}:cue`, system, budget: { topK: 10, contextBytes: 2_000 } });
          expect(result.turnIds).toEqual([]);
        }
      }
      const semantic = await prepared.retrieve(question.question, { id: "semantic", system: "oh-semantic",
        budget: { topK: 10, contextBytes: 2_000 } });
      expect(indexed).toHaveLength(corpus.turns.length);
      const full = createEvolutionFullHistorySource(corpus);
      const bodies = [JSON.stringify(indexed), ...indexed.map(recordDocument), semantic.context, full.result.context,
        ...buildExtractionChunks(corpus).map(chunk => JSON.stringify(extractionMessages(chunk))),
        ...EVOLUTION_ANSWER_CONTRACT_IDS.map(contract => JSON.stringify(makeEvolutionRequest("gpt5-mini-reader",
          evolutionAnswerMessages(question, full.result.context, contract)).body))];
      for (const body of bodies) for (const cue of [answerSession, otherSession, corpusId, "question_canary", "SYNTHETIC_GOLD_SENTINEL", "has_answer", "evidenceSessionIds"]) {
        expect(body).not.toContain(cue);
      }
      expect(semantic.context).toContain("A cobalt bicycle.");
      expect(semantic.context).toContain("s0001#2:0");
    } finally { await prepared.close(); }
  });

  test("invalidates legacy manifests, extraction caches, prepared contexts, and reader identities", () => {
    const current = parseLongMemEval([fixture()]), legacy = legacyDataset(current);
    const corpus = current.corpora[0]!, oldCorpus = legacy.corpora[0]!;
    const input = { dataset: "synthetic", revision: "fixture-v1", sourceSha256: "a".repeat(64),
      groups: [{ groupId: corpus.groupId, partition: "development" as const, exposure: "development" as const, evidence: "Synthetic fixture." }] };
    const oldManifest = createEvolutionDatasetManifest(legacy, input);
    expect(() => validateEvolutionDatasetManifest(current, oldManifest)).toThrow("does not match");
    expect(corpusIdentity(corpus)).not.toBe(corpusIdentity(oldCorpus));
    expect(canonicalSha256(corpus)).not.toBe(canonicalSha256(oldCorpus));
    const oldChunks = buildExtractionChunks(oldCorpus);
    expect(buildExtractionChunks(corpus).map(chunk => chunk.id)).not.toEqual(oldChunks.map(chunk => chunk.id));
    const bundle: UnitBundle = { protocol: "oh.memory-unit-bundle.v1", dataset: "longmemeval-s",
      datasetSha256: DATASETS["longmemeval-s"].sha256, split: "all", seed: 17,
      extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION),
        reader: "gpt-4.1-mini-2025-04-14", provider: "openai", maximumOutput: 8_192 },
      corpora: [{ corpusId: oldCorpus.id, corpusSha256: corpusIdentity(oldCorpus),
        chunks: oldChunks.map(chunk => ({ id: chunk.id, units: [], rejected: 0 })), unitsSha256: canonicalSha256([]) }],
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 } };
    expect(validateUnitBundle(bundle, "longmemeval-s", "all", 17, [oldCorpus]).get(oldCorpus.id)).toEqual([]);
    expect(() => validateUnitBundle(bundle, "longmemeval-s", "all", 17, [corpus])).toThrow("stale");
    const full = createEvolutionFullHistorySource(corpus), oldFull = createEvolutionFullHistorySource(oldCorpus);
    expect(full.identity.preparedSha256).not.toBe(oldFull.identity.preparedSha256);
    expect(full.identity.sourceRecordsSha256).not.toBe(oldFull.identity.sourceRecordsSha256);
    expect(() => full.validate(oldFull.result)).toThrow("complete current source");
    const request = (context: string) => makeEvolutionRequest("gpt5-mini-reader", evolutionAnswerMessages(current.questions[0]!, context));
    expect(request(full.result.context).requestSha256).not.toBe(request(oldFull.result.context).requestSha256);
  });
});
