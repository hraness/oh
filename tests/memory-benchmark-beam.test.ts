import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { BEAM_CANONICAL_PROTOCOL, BEAM_QUESTION_TYPES, DATASETS, beamCorpusId, parseBeam, parseBeamProvenance,
  parseLongMemEval, type Dataset } from "../scripts/benchmarks/datasets";
import { applyBeamReview, beamManifestInput, parseBeamExposureReview, reviewBeamExposure, turnSignatures,
  type BeamExposureReview } from "../scripts/benchmarks/beam-review";
import { beamScopeQuestionIds, buildBeamFamilyPool, createBeamSelection, parseBeamSelectionDocument, verifyBeamSelection } from "../scripts/benchmarks/beam-selection";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { makeEvolutionEvaluationScope } from "../scripts/benchmarks/evolution-evaluation-scope";
import type { RandomIndex } from "../scripts/benchmarks/selection";

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No provider or network in BEAM fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });

const SENTINELS = ["PRIVATE_QUESTION_SENTINEL", "PRIVATE_RUBRIC_SENTINEL", "PRIVATE_ANSWER_SENTINEL", "PRIVATE_PLAN_SENTINEL",
  "PRIVATE_PROFILE_SENTINEL", "PRIVATE_SEED_SENTINEL", "PRIVATE_NARRATIVE_SENTINEL", "PRIVATE_USER_QUESTION_SENTINEL"];
const PART_ROWS = { "100K": 2, "500K": 1, "1M": 1 } as const;
const parts = () => DATASETS.beam.parts.map((part) => ({ ...part, rows: PART_ROWS[part.split] }));

function turn(id: number, role: "user" | "assistant", content: string, anchor: string | null = null, planted = false) {
  return { content, id, index: planted ? "0" : null, question_type: planted ? "main_question" : null, role, time_anchor: anchor };
}
function probing(sourceIds: unknown, extra: Record<string, unknown> = {}) {
  return { question: "PRIVATE_QUESTION_SENTINEL about the synthetic café trip?", rubric: ["PRIVATE_RUBRIC_SENTINEL one", "PRIVATE_RUBRIC_SENTINEL two"],
    difficulty: "easy", source_chat_ids: sourceIds, ...extra };
}
/** Two sessions; turn id 7 repeats across sessions the way the release repeats ids inside a history. */
function row(split: "100K" | "500K" | "1M", rowIndex: number, options: Partial<{ seed: string; profile: string; firstTurn: string }> = {}) {
  const tag = `${split}-${rowIndex}`;
  const chat = [
    [turn(7, "user", options.firstTurn ?? `Synthetic memory ${tag} first session about the café trip and a bicycle`, "2025-03-01 09:00", true),
      turn(8, "assistant", `Synthetic reply ${tag} one`)],
    [turn(7, "user", `Synthetic memory ${tag} second session café`, "2025-03-09 18:30"), turn(9, "assistant", `Synthetic reply ${tag} two`),
      turn(10, "user", `Synthetic memory ${tag} closing`)],
  ];
  const probing_questions = Object.fromEntries(BEAM_QUESTION_TYPES.map((category) => [category, category === "abstention"
    ? [probing(null, { abstention_type: "x", ideal_response: "PRIVATE_ANSWER_SENTINEL" })]
    : category === "event_ordering" ? [probing({ first: [7], second: [9] }, { answer: "PRIVATE_ANSWER_SENTINEL" })]
      : category === "temporal_reasoning" ? [probing([[8], 10]), probing([])]
        : [probing([7, 8], { answer: "PRIVATE_ANSWER_SENTINEL" })]]));
  return { chat, conversation_id: `conversation-${tag}`, conversation_plan: options.seed === undefined ? "PRIVATE_PLAN_SENTINEL" : `PRIVATE_PLAN_SENTINEL ${options.seed}`,
    conversation_seed: { seed: options.seed ?? `PRIVATE_SEED_SENTINEL ${tag}` }, narratives: "PRIVATE_NARRATIVE_SENTINEL", probing_questions, rowIndex, split,
    user_profile: { profile: options.profile ?? `PRIVATE_PROFILE_SENTINEL ${tag}` }, user_questions: ["PRIVATE_USER_QUESTION_SENTINEL"] };
}
function document(rows = [row("100K", 0), row("100K", 1), row("500K", 0), row("1M", 0, { seed: "shared-seed" })]) {
  return { parts: parts(), protocol: BEAM_CANONICAL_PROTOCOL, revision: DATASETS.beam.revision, rows };
}
function fixedSequence(values: readonly number[]): RandomIndex {
  let index = 0;
  return (exclusiveMax: number) => {
    const value = values[index++];
    if (value === undefined || value < 0 || value >= exclusiveMax) throw new RangeError("Sequence exhausted or out of bounds.");
    return value;
  };
}
function longmem(id: string, content: string) {
  return { question_id: id, question_type: "knowledge-update", question: `Reference question ${id}?`, answer: "reference answer", question_date: "2023/05/10 (Wed) 12:00",
    haystack_session_ids: [`${id}-session`], haystack_dates: ["2023/05/09 (Tue) 10:00"], haystack_sessions: [[{ role: "user", content, has_answer: true }]],
    answer_session_ids: [`${id}-session`] };
}
const reference = (data: Dataset, dataset = "longmemeval-s") => ({ dataset, sha256: DATASETS["longmemeval-s"].sha256, data });
const noSentinel = (value: unknown) => { const text = JSON.stringify(value); for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel); };

describe("parseBeam", () => {
  test("keeps only chat turns with session anchors in the corpus and the scorer object in the answer field", () => {
    const dataset = parseBeam(document());
    expect(dataset.corpora.map((corpus) => corpus.id)).toEqual(["beam-100K-0", "beam-100K-1", "beam-500K-0", "beam-1M-0"]);
    const corpus = dataset.corpora[0]!;
    expect(corpus.groupId).toBe(corpus.id);
    expect(corpus.turns.map((t) => [t.id, t.sessionId, t.sessionIndex, t.date, t.speaker])).toEqual([
      ["s0:0", "s0", 0, "2025-03-01 09:00", "user"], ["s0:1", "s0", 0, "2025-03-01 09:00", "assistant"],
      ["s1:0", "s1", 1, "2025-03-09 18:30", "user"], ["s1:1", "s1", 1, "2025-03-09 18:30", "assistant"], ["s1:2", "s1", 1, "2025-03-09 18:30", "user"]]);
    noSentinel(dataset.corpora);
    noSentinel(projectEvolutionRunnerInput(dataset).corpora);
    expect(JSON.stringify(dataset.corpora)).not.toContain("main_question");
    expect(dataset.questions).toHaveLength(4 * 11);
    const question = dataset.questions.find((q) => q.id === "beam-100K-0:knowledge_update:0")!;
    expect(question).toMatchObject({ corpusId: "beam-100K-0", category: "beam:knowledge_update", questionDate: "2025-03-09 18:30", unanswerable: false,
      evidenceTurnIds: ["s0:0", "s1:0", "s0:1"], rawEvidenceTurnIds: ["7", "8"], evidenceSessionIds: ["s0", "s1"] });
    expect(question.question).toContain("PRIVATE_QUESTION_SENTINEL");
    expect(JSON.parse(question.answer)).toEqual({ answer: "PRIVATE_ANSWER_SENTINEL", difficulty: "easy", rubric: ["PRIVATE_RUBRIC_SENTINEL one", "PRIVATE_RUBRIC_SENTINEL two"], source_chat_ids: [7, 8] });
    expect(question.answer).toBe(canonicalJson(JSON.parse(question.answer)));
    expect(dataset.questions.find((q) => q.id === "beam-100K-0:abstention:0")).toMatchObject({ unanswerable: true, evidenceTurnIds: [], rawEvidenceTurnIds: [] });
    expect(dataset.questions.find((q) => q.id === "beam-100K-0:event_ordering:0")).toMatchObject({ evidenceTurnIds: ["s0:0", "s1:0", "s1:1"], rawEvidenceTurnIds: ["7", "9"] });
    expect(dataset.questions.find((q) => q.id === "beam-100K-0:temporal_reasoning:0")).toMatchObject({ evidenceTurnIds: ["s0:1", "s1:2"] });
    expect(dataset.questions.find((q) => q.id === "beam-100K-0:temporal_reasoning:1")).toMatchObject({ evidenceTurnIds: [] });
  });

  test("rejects envelopes that drift from the pinned release", () => {
    expect(() => parseBeam({ ...document(), protocol: "oh.beam-source-canonical.v0" })).toThrow("protocol");
    expect(() => parseBeam({ ...document(), revision: "0".repeat(40) })).toThrow("revision");
    expect(() => parseBeam({ ...document(), extra: true })).toThrow("shape");
    expect(() => parseBeam({ ...document(), parts: parts().map((part) => ({ ...part, bytes: part.bytes + 1 })) })).toThrow("pinned parquet");
    expect(() => parseBeam({ ...document(), parts: parts().slice(0, 2) })).toThrow("every pinned split");
    expect(() => parseBeam(document([row("100K", 0), row("100K", 1), row("500K", 0)]))).toThrow("row count");
    expect(() => parseBeam(document([row("100K", 0), row("100K", 5), row("500K", 0), row("1M", 0)]))).toThrow("outside its split");
    expect(() => parseBeam(document([row("100K", 0), row("100K", 0), row("500K", 0), row("1M", 0)]))).toThrow("repeats");
    expect(() => parseBeam(document([{ ...row("100K", 0), split: "10M" }, row("100K", 1), row("500K", 0), row("1M", 0)]))).toThrow("split");
    expect(() => parseBeam(document([{ ...row("100K", 0), gold: "x" }, row("100K", 1), row("500K", 0), row("1M", 0)]))).toThrow("shape");
  });

  test("rejects rows whose turns, anchors or evidence references break the contract", () => {
    const broken = (patch: (r: ReturnType<typeof row>) => unknown) => () => parseBeam(document([patch(row("100K", 0)) as never, row("100K", 1), row("500K", 0), row("1M", 0)]));
    expect(broken((r) => ({ ...r, chat: [] }))).toThrow("no sessions");
    expect(broken((r) => ({ ...r, chat: [[]] }))).toThrow("no turns");
    expect(broken((r) => ({ ...r, chat: [[turn(1, "user", "no anchor here")]] }))).toThrow("time anchor");
    expect(broken((r) => ({ ...r, chat: [[{ ...turn(1, "user", "x", "2025-01-01"), extra: 1 }]] }))).toThrow("shape");
    expect(broken((r) => ({ ...r, chat: [[turn(-1, "user", "x", "2025-01-01")]] }))).toThrow("non-negative");
    expect(broken((r) => ({ ...r, probing_questions: { ...r.probing_questions, knowledge_update: [probing([99])] } }))).toThrow("unknown turn");
    expect(broken((r) => ({ ...r, probing_questions: { ...r.probing_questions, knowledge_update: [probing(["7"])] } }))).toThrow("integers");
    expect(broken((r) => ({ ...r, probing_questions: { ...r.probing_questions, knowledge_update: [probing([[[[[[7]]]]]])] } }))).toThrow("nesting");
    expect(broken((r) => ({ ...r, probing_questions: { ...r.probing_questions, knowledge_update: [{ question: "q?" }] } }))).toThrow("rubric");
    expect(broken((r) => { const { abstention: _drop, ...rest } = r.probing_questions; return { ...r, probing_questions: rest }; })).toThrow("ten abilities");
  });

  test("provenance digests author-side inputs without returning them", () => {
    const provenance = parseBeamProvenance(document());
    expect(provenance.map((history) => history.corpusId)).toEqual(["beam-100K-0", "beam-100K-1", "beam-500K-0", "beam-1M-0"]);
    expect(provenance[0]).toMatchObject({ split: "100K", rowIndex: 0, conversationIdSha256: sha256Hex("conversation-100K-0"),
      seedSha256: canonicalSha256({ seed: "PRIVATE_SEED_SENTINEL 100K-0" }), userQuestionsSha256: canonicalSha256(["PRIVATE_USER_QUESTION_SENTINEL"]) });
    noSentinel(provenance);
    expect(() => beamCorpusId("1M", 1000)).toThrow();
  });
});

describe("BEAM exposure review", () => {
  const overlapText = "This exact synthetic sentence appears in both the reference haystack and the beam history word for word";
  const beamDocument = () => document([row("100K", 0, { firstTurn: overlapText }), row("100K", 1), row("500K", 0, { seed: "shared-seed" }), row("1M", 0, { seed: "shared-seed" })]);
  const referenceDataset = () => parseLongMemEval([longmem("ref-a", overlapText), longmem("ref-b", "An unrelated reference sentence with enough words to shingle at all")]);
  function review(declarations: Parameters<typeof reviewBeamExposure>[0]["declarations"] = []) {
    const raw = beamDocument();
    const beam = parseBeam(raw);
    return { beam, review: reviewBeamExposure({ beam, provenance: parseBeamProvenance(raw), references: [reference(referenceDataset())], declarations, createdAt: "2026-09-10T00:00:00.000Z" }) };
  }

  test("signatures normalize text and skip short turns", () => {
    expect(turnSignatures("Hi there").turnDigest).toBeNull();
    const left = turnSignatures("The Café trip, on Monday; was GREAT and long enough to shingle"), right = turnSignatures("the café trip on monday was great and long enough to shingle");
    expect(left.turnDigest).toBe(right.turnDigest);
    expect(left.shingles).toEqual(right.shingles);
  });

  test("flags exact-turn overlap, joins related histories on shared seeds and writes no text", () => {
    const { review: result } = review();
    expect(result.summary).toEqual({ histories: 4, questions: 44, eligibleHistories: 3, eligibleQuestions: 33, eligibleGroups: 2, declaredExposures: 0, overlappingHistories: 1, relatedGroups: 1 });
    const flagged = result.histories[0]!;
    expect(flagged).toMatchObject({ corpusId: "beam-100K-0", eligible: false, sessions: 2, turns: 5, questions: 11 });
    expect(flagged.overlap[0]).toMatchObject({ dataset: "longmemeval-s", exactTurnMatches: 1, matchedCorpora: [{ corpusId: "ref-a", exactTurnMatches: 1 }] });
    expect(flagged.overlap[0]!.maximumCorpusSampledShingleMatches).toBe(flagged.overlap[0]!.matchedCorpora[0]!.sampledShingleMatches);
    expect(result.thresholds).toEqual({ maximumExactTurnMatches: 0, maximumSampledShingleMatchesPerCorpus: null });
    expect(result.histories.map((history) => history.suggestedGroupId)).toEqual(["beam-100K-0", "beam-100K-1", "beam-1M-0", "beam-1M-0"]);
    expect(result.histories[2]!.relatedHistories).toEqual(["beam-1M-0"]);
    expect(result.groups).toEqual([
      { groupId: "beam-100K-0", partition: "closed", exposure: "unknown", evidence: "1 of 1 related histories exceed the overlap thresholds against longmemeval-s." },
      { groupId: "beam-100K-1", partition: "sealed", exposure: "unseen", evidence: "No declared exposure; 1 related histories within the overlap thresholds against longmemeval-s." },
      { groupId: "beam-1M-0", partition: "sealed", exposure: "unseen", evidence: "No declared exposure; 2 related histories within the overlap thresholds against longmemeval-s." }]);
    noSentinel(result);
    expect(JSON.stringify(result)).not.toContain("Synthetic memory");
    expect(JSON.stringify(result)).not.toContain("exact synthetic sentence");
    expect(parseBeamExposureReview(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  test("declared exposure closes the whole related family and the parser rejects tampered dispositions", () => {
    const { review: result } = review([{ corpusId: "beam-500K-0", exposure: "development", evidence: "Search preview showed part of this profile scaffold." }]);
    expect(result.groups.find((group) => group.groupId === "beam-1M-0")).toMatchObject({ partition: "closed", exposure: "development" });
    expect(result.summary).toMatchObject({ eligibleHistories: 1, eligibleGroups: 1, declaredExposures: 1 });
    const tampered = JSON.parse(JSON.stringify(result));
    tampered.groups[2].partition = "sealed"; tampered.groups[2].exposure = "unseen";
    expect(() => parseBeamExposureReview(tampered)).toThrow("ineligible history");
    const lifted = JSON.parse(JSON.stringify(result));
    lifted.histories[0].eligible = true;
    expect(() => parseBeamExposureReview(lifted)).toThrow("eligibility disagrees");
    expect(() => reviewBeamExposure({ beam: review().beam, provenance: parseBeamProvenance(beamDocument()), references: [],
      declarations: [{ corpusId: "beam-100K-9", exposure: "unknown", evidence: "x" }] })).toThrow("unknown history");
    expect(() => reviewBeamExposure({ beam: review().beam, provenance: parseBeamProvenance(beamDocument()).slice(1), references: [] })).toThrow("align");
  });

  test("thresholds are declared in the document and change eligibility", () => {
    const raw = beamDocument(), beam = parseBeam(raw);
    const lenient = reviewBeamExposure({ beam, provenance: parseBeamProvenance(raw), references: [reference(referenceDataset())],
      thresholds: { maximumExactTurnMatches: 1, maximumSampledShingleMatchesPerCorpus: 1_000 } });
    expect(lenient.summary.eligibleHistories).toBe(4);
    expect(lenient.thresholds).toEqual({ maximumExactTurnMatches: 1, maximumSampledShingleMatchesPerCorpus: 1_000 });
    const shingleGated = reviewBeamExposure({ beam, provenance: parseBeamProvenance(raw), references: [reference(referenceDataset())],
      thresholds: { maximumExactTurnMatches: 1, maximumSampledShingleMatchesPerCorpus: 0 } });
    const flagged = shingleGated.histories[0]!;
    expect(flagged.eligible).toBe(flagged.overlap[0]!.maximumCorpusSampledShingleMatches === 0);
    expect(() => reviewBeamExposure({ beam, provenance: parseBeamProvenance(raw), references: [],
      thresholds: { maximumExactTurnMatches: -1, maximumSampledShingleMatchesPerCorpus: null } })).toThrow("threshold");
  });
});

describe("BEAM family draw", () => {
  function sealed() {
    const raw = document([row("100K", 0), row("100K", 1), row("500K", 0, { profile: "shared-profile" }), row("1M", 0, { profile: "shared-profile" })]);
    const beam = parseBeam(raw);
    const result = reviewBeamExposure({ beam, provenance: parseBeamProvenance(raw), references: [], createdAt: "2026-09-10T00:00:00.000Z" });
    return { beam, review: result, reviewSha256: sha256Hex(JSON.stringify(result)) };
  }

  test("draws whole families with an injected sequence and replays exactly", () => {
    const { beam, review: result, reviewSha256 } = sealed();
    const pool = buildBeamFamilyPool(beam, result);
    expect(pool).toEqual([{ groupId: "beam-100K-0", corpusIds: ["beam-100K-0"], questions: 11 }, { groupId: "beam-100K-1", corpusIds: ["beam-100K-1"], questions: 11 },
      { groupId: "beam-1M-0", corpusIds: ["beam-1M-0", "beam-500K-0"], questions: 22 }]);
    const selection = createBeamSelection({ dataset: beam, review: result, reviewSha256, sampleFamilies: 2, randomIndex: fixedSequence([2, 0]), createdAt: "2026-09-10T00:00:00.000Z" });
    expect(selection.selected.map((family) => family.groupId)).toEqual(["beam-1M-0", "beam-100K-1"]);
    expect(selection).toMatchObject({ poolSize: 3, sampleFamilies: 2, sampleQuestions: 33, poolSha256: canonicalSha256(pool), reviewSha256 });
    expect(selection.selectedQuestionIds).toHaveLength(33);
    expect(selection.selectedQuestionIds.every((id) => /^beam-(100K-1|500K-0|1M-0):/.test(id))).toBe(true);
    noSentinel(selection);
    expect(parseBeamSelectionDocument(JSON.parse(JSON.stringify(selection)))).toEqual(selection);
    const replay = verifyBeamSelection({ document: JSON.parse(JSON.stringify(selection)), dataset: beam, review: result, reviewSha256 });
    expect(replay.corpora.map((corpus) => corpus.id)).toEqual(["beam-1M-0", "beam-500K-0", "beam-100K-1"]);
    expect(replay.questions).toHaveLength(33);
    expect(beamScopeQuestionIds(selection)).toHaveLength(33);
    expect(() => createBeamSelection({ dataset: beam, review: result, reviewSha256, sampleFamilies: 4 })).toThrow("1..eligible");
    expect(() => createBeamSelection({ dataset: beam, review: result, reviewSha256: "nope", sampleFamilies: 1 })).toThrow("digest");
  });

  test("a changed review, pool or selected family fails replay instead of drawing replacements", () => {
    const { beam, review: result, reviewSha256 } = sealed();
    const selection = JSON.parse(JSON.stringify(createBeamSelection({ dataset: beam, review: result, reviewSha256, sampleFamilies: 1, randomIndex: fixedSequence([0]) })));
    expect(() => verifyBeamSelection({ document: selection, dataset: beam, review: result, reviewSha256: sha256Hex("other review") })).toThrow("different exposure review");
    const narrowed: BeamExposureReview = { ...result, groups: result.groups.map((group, index) => index === 1 ? { ...group, partition: "closed", exposure: "unknown" } : group) };
    expect(() => verifyBeamSelection({ document: selection, dataset: beam, review: narrowed, reviewSha256 })).toThrow("no longer matches");
    const swapped = { ...selection, selected: [selection.eligibleFamilies[1]] };
    expect(() => parseBeamSelectionDocument(swapped)).toThrow("belong");
    expect(() => parseBeamSelectionDocument({ ...selection, selectedQuestionIds: selection.selectedQuestionIds.slice(1) })).toThrow("sampleQuestions");
    expect(() => parseBeamSelectionDocument({ ...selection, poolSize: 2 })).toThrow("eligible families");
    expect(() => parseBeamSelectionDocument({ ...selection, method: "math-random" })).toThrow("protocol");
  });

  test("a sealed-confirmation scope accepts the drawn families and rejects a closed one", () => {
    const { beam, review: result, reviewSha256 } = sealed();
    const grouped = applyBeamReview(beam, result);
    const manifest = createEvolutionDatasetManifest(grouped, beamManifestInput(result));
    expect(manifest.groups).toEqual(result.groups);
    expect(manifest.corpora.find((corpus) => corpus.id === "beam-500K-0")).toMatchObject({ groupId: "beam-1M-0", historyId: "beam-1M-0" });
    const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
    const selection = createBeamSelection({ dataset: beam, review: result, reviewSha256, sampleFamilies: 2, randomIndex: fixedSequence([2, 0]) });
    const design = { experimentSpecSha256: sha256Hex("spec"), candidate: { id: "oh-semantic", specSha256: sha256Hex("c") }, controls: [{ id: "bm25-window", specSha256: sha256Hex("b") }],
      readers: [{ id: "gpt-5-mini-reader", specSha256: sha256Hex("r") }], judge: { id: "beam-nugget-judge", specSha256: sha256Hex("j") }, rubricSha256: sha256Hex("rubric") };
    const scope = makeEvolutionEvaluationScope({ manifestBytes, manifestSha256: sha256Hex(manifestBytes), source: { dataset: "beam", revision: DATASETS.beam.revision, sourceSha256: DATASETS.beam.sha256 },
      request: { mode: "sealed-confirmation", maximumQuestionsPerShard: 100, design, selectedQuestionIds: beamScopeQuestionIds(selection), eligibilityAuditSha256: reviewSha256 } });
    expect(scope.coverage).toMatchObject({ releaseQuestions: 44, selectedQuestions: 33, declaredGroups: 2, declaredHistories: 2, connectedDeclaredClusters: 2 });
    expect(scope.strata).toEqual([{ partition: "sealed", exposure: "unseen", questions: 33, groups: 2 }]);
    noSentinel(scope);
    const closedReview: BeamExposureReview = { ...result, groups: result.groups.map((group) => group.groupId === "beam-1M-0" ? { ...group, partition: "closed", exposure: "unknown" } : group) };
    const closedManifest = createEvolutionDatasetManifest(grouped, beamManifestInput(closedReview)), closedBytes = new TextEncoder().encode(canonicalJson(closedManifest));
    expect(() => makeEvolutionEvaluationScope({ manifestBytes: closedBytes, manifestSha256: sha256Hex(closedBytes), source: { dataset: "beam", revision: DATASETS.beam.revision, sourceSha256: DATASETS.beam.sha256 },
      request: { mode: "sealed-confirmation", maximumQuestionsPerShard: 100, design, selectedQuestionIds: beamScopeQuestionIds(selection), eligibilityAuditSha256: reviewSha256 } })).toThrow("sealed/unseen");
  });
});
