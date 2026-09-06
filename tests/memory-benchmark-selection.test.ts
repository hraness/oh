import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256 } from "../src/canonical";
import { main } from "../scripts/benchmark-memory";

import {
  buildRepresentativePool, createSelection, cryptoRandomIndex, parseSelectionDocument, REPRESENTATIVE_POLICY,
  sampleWithoutReplacement, SELECTION_METHOD, SELECTION_PROTOCOL, verifySelection, type RandomIndex, type SelectionDocument,
} from "../scripts/benchmarks/selection";
import { parseLongMemEval, selectSplit, type Dataset } from "../scripts/benchmarks/datasets";

function longmem(id: string, overrides: Partial<{ answer: unknown; questionType: string }> = {}) {
  return {
    question_id: id, question_type: overrides.questionType ?? "knowledge-update", question: `Question for ${id}?`,
    answer: overrides.answer ?? "an answer", question_date: "2023/05/10 (Wed) 12:00",
    haystack_session_ids: [`${id}-session`], haystack_dates: ["2023/05/09 (Tue) 10:00"],
    haystack_sessions: [[{ role: "user", content: `content for ${id}`, has_answer: true }]],
    answer_session_ids: [`${id}-session`],
  };
}

function family(id: string) {
  return [longmem(id), longmem(`${id}_abs`)];
}

function fixedSequence(values: readonly number[]): RandomIndex {
  let index = 0;
  return (exclusiveMax: number) => {
    const value = values[index];
    if (value === undefined) throw new Error("Sequence exhausted.");
    index += 1;
    if (value < 0 || value >= exclusiveMax) throw new RangeError("Sequence value out of bounds.");
    return value;
  };
}

describe("sampleWithoutReplacement", () => {
  test("produces the exact sample for an injected shuffle with no duplicates", () => {
    const pool = ["a", "b", "c", "d", "e"];
    const result = sampleWithoutReplacement(pool, 3, fixedSequence([4, 0, 0]));
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
    expect(result).toEqual(["e", "b", "c"]);
  });

  test("is deterministic for the same injected sequence", () => {
    const pool = [1, 2, 3, 4];
    const sequence = () => fixedSequence([2, 1, 0]);
    expect(sampleWithoutReplacement(pool, 3, sequence())).toEqual(sampleWithoutReplacement(pool, 3, sequence()));
  });

  test("reaches every permutation of a tiny pool across all index sequences", () => {
    const pool = ["x", "y", "z"];
    const permutations = new Set<string>();
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 2; b += 1) {
        permutations.add(sampleWithoutReplacement(pool, 3, fixedSequence([a, b, 0])).join(","));
      }
    }
    expect(permutations.size).toBe(6);
    expect([...permutations].sort()).toEqual(["x,y,z", "x,z,y", "y,x,z", "y,z,x", "z,x,y", "z,y,x"].sort());
  });

  test("validates randomIndex bounds and sample size", () => {
    expect(() => sampleWithoutReplacement([1, 2, 3], 2, () => 5)).toThrow();
    expect(() => sampleWithoutReplacement([1, 2, 3], 2, () => -1)).toThrow();
    expect(() => sampleWithoutReplacement([1, 2, 3], 0, () => 0)).toThrow();
    expect(() => sampleWithoutReplacement([1, 2, 3], 4, () => 0)).toThrow();
    expect(() => cryptoRandomIndex(0)).toThrow();
  });
});

describe("buildRepresentativePool", () => {
  const corpora = [
    { id: "f1", groupId: "f1" }, { id: "f1_abs", groupId: "f1" },
    { id: "f2", groupId: "f2" }, { id: "f2_abs", groupId: "f2" },
  ];
  const questions = [
    { id: "f1", corpusId: "f1" }, { id: "f1_abs", corpusId: "f1_abs" },
    { id: "f2", corpusId: "f2" }, { id: "f2_abs", corpusId: "f2_abs" },
  ];

  test("picks one fixed representative per family by minimum question ID, sorted by groupId", () => {
    const pool = buildRepresentativePool({ corpora, questions });
    expect(pool).toEqual([
      { groupId: "f1", questionId: "f1", corpusId: "f1" },
      { groupId: "f2", questionId: "f2", corpusId: "f2" },
    ]);
  });

  test("is unaffected by input array order", () => {
    const shuffledCorpora = [corpora[2]!, corpora[3]!, corpora[0]!, corpora[1]!];
    const shuffledQuestions = [questions[3]!, questions[1]!, questions[2]!, questions[0]!];
    expect(buildRepresentativePool({ corpora: shuffledCorpora, questions: shuffledQuestions }))
      .toEqual(buildRepresentativePool({ corpora, questions }));
  });

  test("ignores fields beyond id/corpusId/groupId such as category or answer", () => {
    const enriched = questions.map((question) => ({ ...question, category: "whatever", answer: "changed", evidence: ["x"] }));
    expect(buildRepresentativePool({ corpora, questions: enriched })).toEqual(buildRepresentativePool({ corpora, questions }));
  });

  test("rejects duplicate question IDs", () => {
    expect(() => buildRepresentativePool({ corpora, questions: [...questions, { id: "f1", corpusId: "f1" }] })).toThrow("Duplicate");
  });

  test("rejects a question with no corpus mapping", () => {
    expect(() => buildRepresentativePool({ corpora, questions: [...questions, { id: "orphan", corpusId: "missing" }] })).toThrow("no corpus mapping");
  });

  test("rejects a pool exceeding the 1000-family cap", () => {
    const big = Array.from({ length: 1001 }, (_, index) => ({ id: `g-${index}`, groupId: `g-${index}` }));
    const bigQuestions = big.map((corpus) => ({ id: corpus.id, corpusId: corpus.id }));
    expect(() => buildRepresentativePool({ corpora: big, questions: bigQuestions })).toThrow("1000-family cap");
  });
});

function syntheticDataset(familyCount: number): Dataset {
  return parseLongMemEval(Array.from({ length: familyCount }, (_, index) => family(`fam-${index}`)).flat());
}

describe("createSelection / verifySelection round trip", () => {
  test("replays the exact frozen selection against the recomputed pool", async () => {
    const dataset = syntheticDataset(6);
    const dir = await mkdtemp(join(tmpdir(), "oh-selection-"));
    try {
      const output = join(dir, "selection.json");
      const document = await createSelection({ name: "longmemeval-s", split: "all", seed: 1,
        exclusions: { reports: [] }, dataset, sampleSize: 3, randomIndex: fixedSequence([5, 4, 3]), output });
      expect(document.selected).toHaveLength(3);
      expect(document.poolSize).toBe(6);
      const replayed = verifySelection({ document, dataset, split: "all", seed: 1, datasetSha256: document.source.sha256,
        exclusions: { groups: new Set(), reports: [] } });
      expect(replayed.questions.map((question) => question.id)).toEqual(document.selected.map((representative) => representative.questionId));
      expect(replayed.corpora.map((corpus) => corpus.id)).toEqual(document.selected.map((representative) => representative.corpusId));
      const roundTripped = parseSelectionDocument(JSON.parse(await Bun.file(output).text()));
      expect(roundTripped).toEqual(document);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("respects split filtering before sampling", async () => {
    const dataset = syntheticDataset(10);
    const dev = selectSplit(dataset, "dev", 17);
    const pool = buildRepresentativePool(dev);
    expect(pool.length).toBeLessThan(10);
    const dir = await mkdtemp(join(tmpdir(), "oh-selection-"));
    try {
      const output = join(dir, "selection.json");
      const document = await createSelection({ name: "longmemeval-s", split: "dev", seed: 17,
        exclusions: { reports: [] }, dataset: dev, sampleSize: pool.length, randomIndex: cryptoRandomIndex, output });
      expect(document.poolSize).toBe(pool.length);
      expect(document.eligibleRepresentatives).toEqual(pool);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects a sample size exceeding the eligible pool", async () => {
    const dataset = syntheticDataset(2);
    const dir = await mkdtemp(join(tmpdir(), "oh-selection-"));
    try {
      await expect(createSelection({ name: "longmemeval-s", split: "all", seed: 1, exclusions: { reports: [] },
        dataset, sampleSize: 3, output: join(dir, "x.json") })).rejects.toThrow("exceeds");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("verifySelection tampering rejection", () => {
  const dataset = syntheticDataset(4);
  const pool = buildRepresentativePool(dataset);

  function baseDocument(): SelectionDocument {
    return {
      protocol: SELECTION_PROTOCOL, createdAt: "2026-09-06T00:00:00.000Z", dataset: "longmemeval-s",
      source: { sha256: "a".repeat(64) }, split: "all", splitSeed: 1,
      excludedReports: [], poolSha256: canonicalSha256(pool), poolSize: pool.length, eligibleRepresentatives: pool,
      sampleSize: 2, method: SELECTION_METHOD, representativePolicy: REPRESENTATIVE_POLICY, selected: pool.slice(0, 2),
    };
  }

  test("rejects a wrong source checksum", () => {
    expect(() => verifySelection({ document: baseDocument(), dataset, split: "all", seed: 1,
      datasetSha256: "b".repeat(64), exclusions: { groups: new Set(), reports: [] } })).toThrow("checksum");
  });

  test("rejects a wrong split", () => {
    expect(() => verifySelection({ document: { ...baseDocument(), split: "dev" }, dataset, split: "all", seed: 1,
      datasetSha256: "a".repeat(64), exclusions: { groups: new Set(), reports: [] } })).toThrow("split");
  });

  test("rejects a wrong exclusion set", () => {
    const document = { ...baseDocument(), excludedReports: [{ sha256: "c".repeat(64), groups: 1 }] };
    expect(() => verifySelection({ document, dataset, split: "all", seed: 1, datasetSha256: "a".repeat(64),
      exclusions: { groups: new Set(), reports: [] } })).toThrow("exclusions");
  });

  test("rejects a tampered pool hash", () => {
    const document = { ...baseDocument(), poolSha256: "f".repeat(64) };
    expect(() => verifySelection({ document, dataset, split: "all", seed: 1, datasetSha256: "a".repeat(64),
      exclusions: { groups: new Set(), reports: [] } })).toThrow("poolSha256");
  });

  test("rejects an unknown key via parseSelectionDocument", () => {
    const raw: Record<string, unknown> = { ...baseDocument(), poolSha256: "a".repeat(64), extra: true };
    expect(() => parseSelectionDocument(raw)).toThrow("unexpected shape");
  });

  test("rejects duplicate selected representatives via parseSelectionDocument", () => {
    const document = baseDocument();
    const raw = { ...document, poolSha256: canonicalSha256(document.eligibleRepresentatives),
      selected: [document.selected[0]!, document.selected[0]!] };
    expect(() => parseSelectionDocument(raw)).toThrow("unique");
  });

  test("rejects a representative whose corpusId was swapped for its abs sibling", () => {
    const [representative] = pool;
    if (representative === undefined) throw new Error("expected at least one family");
    const tampered = { ...representative, corpusId: `${representative.corpusId}_abs` };
    const document = { ...baseDocument(), poolSha256: canonicalSha256(pool), sampleSize: 1, selected: [tampered] };
    expect(() => verifySelection({ document, dataset, split: "all", seed: 1, datasetSha256: "a".repeat(64),
      exclusions: { groups: new Set(), reports: [] } })).toThrow("recomputed pool");
  });
});

describe("frozen-selection command boundaries", () => {
  test("rejects incompatible flags before paid access or dataset reads", async () => {
    for (const command of ["judge", "state", "projection", "fetch", "summarize", "select"]) {
      await expect(main([command, "--selection", "/missing/selection.json"])).rejects.toThrow("only supported");
    }
    await expect(main(["answer", "--selection", "/missing/selection.json", "--limit", "3"]))
      .rejects.toThrow("cannot be combined");
    await expect(main(["select", "--limit", "3"])).rejects.toThrow("requires");
    await expect(main(["retrieval", "--dataset", "locomo", "--selection", "/missing/selection.json"]))
      .rejects.toThrow("limited to longmemeval-s");
  });
  test("rejects ambiguous corpus mapping", () => {
    expect(() => buildRepresentativePool({ corpora: [{id:"a",groupId:"a"},{id:"a",groupId:"b"}],
      questions: [{id:"q",corpusId:"a"}] })).toThrow("Duplicate corpus");
  });
});
