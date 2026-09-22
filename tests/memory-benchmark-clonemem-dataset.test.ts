import { describe, expect, test } from "bun:test";
import { cloneMemChoiceCorrect, cloneMemRecallAtK, cloneMemTimestamp, eligibleCloneMemMemory, makeCloneMemChoiceMessages, projectCloneMem,
  renderCloneMemEvidence, selectCloneMemReaderQuestions } from "../scripts/benchmarks/clonemem-dataset";

function fixture() {
  return { person_id: "person-one", person_name: "Test Person", context: [
    { id: "a", medium: "diary", event_date: "2026-01-01T00:00:00", content: "  First source.  " },
    { id: "b", medium: "email", event_date: "2026-01-02T00:00:00", content: "Second source." },
    { id: "c", medium: "social", event_date: "2026-01-03T00:00:00", content: "Third source." },
  ], qa_items: [{ id: "q1", question: "Which source?", question_type: "inference", question_time: "2026-01-04T00:00:00",
    answer: "private reference", dimension: "memory", digital_trace_ids: ["c"],
    evidence: [{ statement: "private evidence", digital_trace_ids: ["a", "b"] }],
    choices: [{ id: "A", text: "First" }, { id: "B", text: "Second" }], correct_choice_id: "A" }] };
}
const pin = "1".repeat(64);

describe("CloneMem source and scorer separation", () => {
  test("gold mutations cannot change retrieval or reader projections", () => {
    const raw = fixture(), first = projectCloneMem(raw, pin);
    raw.qa_items[0]!.answer = "different reference";
    raw.qa_items[0]!.correct_choice_id = "B";
    raw.qa_items[0]!.evidence[0]!.statement = "different private evidence";
    raw.qa_items[0]!.evidence[0]!.digital_trace_ids = ["c"];
    const second = projectCloneMem(raw, pin);
    expect(first.retrievalSha256).toBe(second.retrievalSha256);
    expect(first.readerSha256).toBe(second.readerSha256);
    expect(first.scorerSha256).not.toBe(second.scorerSha256);
    expect(Object.keys(first.queries[0]!)).toEqual(["id", "localId", "personId", "question", "questionDate"]);
    expect(JSON.stringify(first.readerQuestions)).not.toContain("private reference");
  });

  test("scores evidence groups rather than the different top-level trace list", () => {
    const row = projectCloneMem(fixture(), pin).scorer[0]!;
    expect(cloneMemRecallAtK(row, ["c", "a", "b"], 2)).toBe(0.5);
    expect(cloneMemRecallAtK(row, ["a", "a", "b"], 2)).toBe(0.5);
    expect(cloneMemRecallAtK({ ...row, evidenceGroups: [] }, ["a"])).toBeNull();
    expect(cloneMemChoiceCorrect(row, " a\n")).toBe(1);
    expect(cloneMemChoiceCorrect(row, "A because of the source")).toBe(0);
    expect(cloneMemChoiceCorrect(row, null)).toBe(0);
  });

  test("preserves native prompt and whole-trace context, excluding question date", () => {
    const value = projectCloneMem(fixture(), pin);
    const context = renderCloneMemEvidence(value.memory, ["b", "a", "c"], 2);
    expect(context).toBe("---- idx 1 ----\nSecond source.\n\n---- idx 2 ----\nFirst source.");
    const messages = makeCloneMemChoiceMessages(value.readerQuestions[0]!, context);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toContain("Options:\nA. First\nB. Second\n\nCorrect Option ID:");
    expect(messages[0]!.content).not.toContain("2026-01-04");
    expect(messages[0]!.content).not.toContain("private reference");
    expect(() => renderCloneMemEvidence(value.memory, ["absent"])).toThrow("unknown ranked trace");
    expect(() => renderCloneMemEvidence(value.memory, ["a", "a"])).toThrow("duplicate identity");
  });

  test("rejects altered source shape, identities, references and size bounds", () => {
    const extra = fixture();
    expect(() => projectCloneMem({ ...extra, questions: [] }, pin)).toThrow("unexpected record fields");
    extra.context[1]!.id = "a";
    expect(() => projectCloneMem(extra, pin)).toThrow("duplicate identity");
    const reference = fixture(); reference.qa_items[0]!.evidence[0]!.digital_trace_ids = ["absent"];
    expect(() => projectCloneMem(reference, pin)).toThrow("unknown evidence reference");
    const content = fixture(); content.context[0]!.content = "x".repeat(65_537);
    expect(() => projectCloneMem(content, pin)).toThrow("bounded scalar text");
  });

  test("fixed balanced selection depends on identities, not input order or answers", () => {
    const question = projectCloneMem(fixture(), pin).readerQuestions[0]!;
    const population = Array.from({ length: 4 }, (_, group) => Array.from({ length: 6 }, (_, index) => ({
      ...question, id: `${group}:${index}`, personId: String(group), localId: String(index),
    }))).flat();
    const first = selectCloneMemReaderQuestions(population, 12);
    expect(selectCloneMemReaderQuestions([...population].reverse(), 12).map(row => row.id)).toEqual(first.map(row => row.id));
    for (let group = 0; group < 4; group++) expect(first.filter(row => row.personId === String(group))).toHaveLength(3);
    expect(() => selectCloneMemReaderQuestions(population, 25)).toThrow("selection count");
  });

  test("the smaller budget draw is an exact prefix when one persona is exhausted", () => {
    const question = projectCloneMem(fixture(), pin).readerQuestions[0]!;
    const population = Array.from({ length: 9 }, (_, group) => Array.from({ length: group === 0 ? 32 : 50 }, (_, index) => ({
      ...question, id: `${group}:${index}`, personId: String(group), localId: String(index),
    }))).flat();
    const large = selectCloneMemReaderQuestions(population, 300);
    expect(large).toHaveLength(300);
    expect(selectCloneMemReaderQuestions(population, 100)).toEqual(large.slice(0, 100));
    expect(large.filter(row => row.personId === "0")).toHaveLength(32);
    for (let group = 1; group < 9; group++) {
      const count = large.filter(row => row.personId === String(group)).length;
      expect(count === 33 || count === 34).toBe(true);
    }
  });

  test("timestamp normalization is strict and independent of the host timezone", () => {
    expect(cloneMemTimestamp("2024-02-29T12:34:56")).toBe(Date.UTC(2024, 1, 29, 12, 34, 56));
    expect(cloneMemTimestamp("2024-02-29T12:34:56Z")).toBe(cloneMemTimestamp("2024-02-29T12:34:56"));
    expect(new Date(cloneMemTimestamp("0001-01-01T00:00:00")).toISOString()).toBe("0001-01-01T00:00:00.000Z");
    for (const value of ["", "2026-01-01", "2026-01-01 00:00:00", "2026-01-01T00:00:00+00:00",
      "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00z", "2026-01-01T00:00:00Z\n"]) {
      expect(() => cloneMemTimestamp(value)).toThrow("timestamp grammar");
    }
    for (const value of ["0000-01-01T00:00:00", "2023-02-29T00:00:00", "2026-02-30T00:00:00",
      "2026-00-01T00:00:00", "2026-01-00T00:00:00", "2026-04-31T00:00:00", "2026-01-01T24:00:00",
      "2026-01-01T00:60:00", "2026-01-01T00:00:60"]) expect(() => cloneMemTimestamp(value)).toThrow("timestamp calendar");
  });

  test("temporal admission excludes future traces before ranking without altering gold", () => {
    const raw = fixture(); raw.qa_items[0]!.question_time = "2026-01-01T00:00:00Z";
    const value = projectCloneMem(raw, pin);
    const eligible = eligibleCloneMemMemory(value.memory, value.queries[0]!.questionDate);
    expect(eligible.traces.map(trace => trace.id)).toEqual(["a"]);
    expect(eligible.personId).toBe(value.memory.personId);
    expect(value.memory.traces).toHaveLength(3);
    expect(value.scorer[0]!.evidenceGroups).toEqual([["a", "b"]]);
    expect(cloneMemRecallAtK(value.scorer[0]!, ["a"])).toBe(0.5);
    expect(() => renderCloneMemEvidence(eligible, ["b"])).toThrow("unknown ranked trace");
    expect(eligibleCloneMemMemory(value.memory, "2025-12-31T23:59:59").traces).toHaveLength(0);
    raw.context[0]!.event_date = "2026-02-30T00:00:00";
    expect(() => projectCloneMem(raw, pin)).toThrow("timestamp calendar");
    const badQuestion = fixture(); badQuestion.qa_items[0]!.question_time = "";
    expect(() => projectCloneMem(badQuestion, pin)).toThrow("bounded scalar text");
  });
});
