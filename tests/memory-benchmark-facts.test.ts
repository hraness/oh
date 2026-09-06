import { describe, expect, spyOn, test } from "bun:test";

import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../src/graph";
import { OhSqliteStore } from "../src/sqlite/store";
import { DATASETS, type Corpus, type Dataset } from "../scripts/benchmarks/datasets";
import { corpusIdentity, validateUnitBundle, type UnitBundle } from "../scripts/benchmarks/extract";
import { benchmarkBaseline, blockUnits, createRetrievers, createUnitIndex } from "../scripts/benchmarks/retrieval";
import { runRetrieval } from "../scripts/benchmarks/runner";
import { excludeGroups, priorReportGroups } from "../scripts/benchmarks/io";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, parseMemoryUnits } from "../scripts/benchmarks/units";

const corpus: Corpus = { id: "test", groupId: "test", turns: [
  { id: "a", sessionId: "s", date: "2026-01-01", speaker: "Ada", text: "I moved to Paris." },
  { id: "b", sessionId: "s", date: "2026-01-01", speaker: "Bea", text: "Congratulations!" },
] };
const chunk = buildExtractionChunks(corpus)[0]!;
const units = parseMemoryUnits({ units: [{ text: "Ada is a Paris resident.", supports: [{ turnId: "a", quote: "I moved to Paris." }] }] }, chunk).units;
const bundle: UnitBundle = { protocol: "oh.memory-unit-bundle.v1", dataset: "locomo", datasetSha256: DATASETS.locomo.sha256,
  split: "dev", seed: 17, extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION),
    reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 4_096 },
  corpora: [{ corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunks: [{ id: chunk.id, units, rejected: 0 }],
    unitsSha256: canonicalSha256(units) }], usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, micros: 72 } };

describe("question-blind memory strategy", () => {
  test("rejects stale, wrong-split, or forged extraction caches", () => {
    expect(validateUnitBundle(bundle, "locomo", "dev", 17, [corpus]).get(corpus.id)).toEqual(units);
    expect(() => validateUnitBundle(bundle, "locomo", "test", 17, [corpus])).toThrow();
    expect(() => validateUnitBundle(bundle, "locomo", "dev", 19, [corpus])).toThrow();
    expect(() => validateUnitBundle(bundle, "longmemeval-s", "dev", 17, [corpus])).toThrow();
    const changed = { ...corpus, turns: [{ ...corpus.turns[0]!, text: "I moved to Rome." }, corpus.turns[1]!] };
    expect(() => validateUnitBundle(bundle, "locomo", "dev", 17, [changed])).toThrow("stale");
    const forged = structuredClone(bundle);
    (forged.corpora[0]!.chunks[0]!.units[0]! as { text: string }).text = "Ada lives in Atlantis.";
    expect(() => validateUnitBundle(forged, "locomo", "dev", 17, [corpus])).toThrow();
  });

  test("permits verified partial chunks only for explicit extraction resume", () => {
    const more: Corpus = { ...corpus, turns: [...corpus.turns,
      { id: "c", sessionId: "later", date: "2026-01-02", speaker: "Ada", text: "I bought a bicycle." }] };
    const partial = { ...bundle, corpora: [{ ...bundle.corpora[0]!, corpusSha256: corpusIdentity(more) }] };
    expect(() => validateUnitBundle(partial, "locomo", "dev", 17, [more])).toThrow("missing or stale");
    expect(validateUnitBundle(partial, "locomo", "dev", 17, [more], true).get(corpus.id)).toEqual(units);
    expect(validateUnitBundle({ ...partial, extractor: { ...partial.extractor, maximumOutput: 8_192 } },
      "locomo", "dev", 17, [more], true).get(corpus.id)).toEqual(units);
  });

  test("separates extracted text from source-turn hydration and includes matched BM25 controls", async () => {
    const retrievers = createRetrievers(corpus, units);
    try {
      for (const system of ["oh-fact-turns", "bm25-fact-turns"] as const) {
        const result = await retrievers.retrieve(system, "resident", { topK: 2, contextBytes: 1_000 });
        expect(result.turnIds).toEqual(["a"]);
        expect(result.context).toContain("I moved to Paris.");
        expect(result.context).not.toContain("resident");
      }
      for (const system of ["oh-fact", "bm25-fact"] as const) {
        const result = await retrievers.retrieve(system, "resident", { topK: 2, contextBytes: 1_000 });
        expect(result.evidenceKind).toBe("derived-unit");
        expect(result.turnIds).toEqual([]);
        expect(result.supportTurnIds).toEqual(["a"]);
        expect(result.context).toContain("Ada is a Paris resident.");
        expect(Buffer.byteLength(result.context)).toBeLessThanOrEqual(1_000);
      }
    } finally { retrievers.close(); }
  });

  test("prepares shared unit indexes before queries and keeps their build cost separate", async () => {
    const retrievers = createRetrievers(corpus, units);
    const systems = ["bm25-block", "oh-block", "bm25-fact", "oh-fact-turns", "oh-fact"] as const;
    try {
      const ingestion = retrievers.prepare(systems);
      expect(ingestion.blocks?.units).toBe(1);
      expect(ingestion.facts?.units).toBe(units.length);
      expect(ingestion.blocks?.buildMs).toBeGreaterThanOrEqual(0);
      expect(ingestion.facts?.buildMs).toBeGreaterThanOrEqual(0);
      const commits = spyOn(OhSqliteStore.prototype, "commit");
      try {
        for (const system of systems) {
          const retrieved = await retrievers.retrieve(system, "Paris", { topK: 2, contextBytes: 1_000 });
          expect(retrieved.context).toContain("Paris");
        }
        expect(commits).not.toHaveBeenCalled();
        expect(retrievers.prepare([...systems].reverse())).toEqual(ingestion);
      } finally { commits.mockRestore(); }
    } finally { retrievers.close(); }
  });

  test("does not advertise citation coverage as raw-turn retrieval recall", async () => {
    const dataset: Dataset = { corpora: [corpus], questions: [{ id: "q", corpusId: corpus.id, category: "locomo:4",
      question: "resident", questionDate: "", answer: "Paris", unanswerable: false, evidenceTurnIds: ["a"], evidenceSessionIds: ["s"] }] };
    const report = await runRetrieval(dataset, ["oh-fact"], { topK: 2, contextBytes: 1_000 }, 17, { units: new Map([[corpus.id, units]]),
      provenance: { reportSha256: "a".repeat(64), profile: EXTRACTION_PROFILE, model: "openai/gpt-4.1-mini",
        promptSha256: sha256Hex(EXTRACTION_INSTRUCTION), totalUnits: units.length, inputTokens: 100, cachedInputTokens: 0,
        outputTokens: 20, ingestionCostUsd: 0.000072 } });
    expect(report.rows[0]!.metrics.turnRecall).toBeNull();
    expect(report.rows[0]!.supportCitationRecall).toBe(1);
    expect(report.summaries["oh-fact"]!.emptyContexts).toBe(0);
    expect(report.ingestion[0]!.unitIndexes.facts?.units).toBe(units.length);
    expect(report.ingestion[0]!.unitIndexes.facts?.buildMs).toBeGreaterThanOrEqual(0);
    expect(report.ingestion[0]!.unitIndexes.blocks).toBeUndefined();
  });

  test("refuses memory units whose source digest is no longer current", async () => {
    const authority = new OhSqliteStore({ path: ":memory:", spaceId: "source-test" });
    const records = corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({ v: 1, kind: "edition",
      key: `edition:source-${index}`, value: { ...turn }, dependencies: [] }));
    authority.commit({ actorId: "test", expectedHead: authority.head(), operationId: "op_source_init", instant: "2026-01-01T00:00:00.000Z",
      changes: records.map((record) => ({ v: 1, kind: "put", record })) });
    const index = createUnitIndex(corpus, units.map((unit) => ({ ...unit, sourceTurnIds: ["a"] })), records, authority);
    try {
      expect((await index.retrieve("oh-fact", "resident", { topK: 2, contextBytes: 1_000 })).context).not.toBe("");
      const update = createKnowledgeGraphRecordV1({ v: 1, kind: "edition", key: records[0]!.key, dependencies: [],
        value: { ...corpus.turns[0]!, text: "I moved to Rome." } });
      authority.commit({ actorId: "test", expectedHead: authority.head(), operationId: "op_source_update", instant: "2026-01-02T00:00:00.000Z",
        changes: [{ v: 1, kind: "put", record: update }] });
      expect((await index.retrieve("oh-fact", "resident", { topK: 2, contextBytes: 1_000 })).context).toBe("");
    } finally { index.close(); authority.close(); }
  });

  test("excludes complete previously examined families without falling back to used questions", () => {
    const old = { protocol: "oh.memory-benchmark.v1", manifest: { dataset: "longmemeval-s",
      source: { sha256: DATASETS["longmemeval-s"].sha256 }, selectedCorpora: ["used_abs"] } };
    const groups = new Set(priorReportGroups(old, "longmemeval-s"));
    expect([...groups]).toEqual(["used"]);
    const corpora = ["used", "used_abs", "fresh"].map((id) => ({ ...corpus, id, groupId: id.replace(/_abs$/, "") }));
    const questions = corpora.map((item) => ({ id: item.id, corpusId: item.id, category: "test", question: "q", questionDate: "",
      answer: "a", unanswerable: false, evidenceTurnIds: [], evidenceSessionIds: [] }));
    const selected = excludeGroups({ corpora, questions }, groups);
    expect(selected.corpora.map((item) => item.id)).toEqual(["fresh"]);
    expect(selected.questions.map((item) => item.id)).toEqual(["fresh"]);
    expect(() => excludeGroups(selected, new Set(["fresh"]))).toThrow("No untouched");
    expect(() => priorReportGroups(old, "locomo")).toThrow("same pinned dataset");
  });

  test("keeps blocks inside a session occurrence and retains the strong baseline", () => {
    const split = { ...corpus, turns: [corpus.turns[0]!, { ...corpus.turns[1]!, sessionIndex: 1 }] };
    expect(blockUnits(split)).toHaveLength(2);
    expect(benchmarkBaseline(["bm25-anchor-window", "bm25-window", "oh-fact"])).toBe("bm25-window");
  });
});
