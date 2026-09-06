import { describe, expect, test } from "bun:test";

import type { Corpus, Turn } from "../scripts/benchmarks/datasets";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, extractionMessages, parseMemoryUnits,
  type ExtractionChunk } from "../scripts/benchmarks/units";

const DATE = "2023/05/10 (Wed) 12:00";

function turn(id: string, text: string, overrides: Partial<Turn> = {}): Turn {
  return { id, sessionId: "s1", sessionIndex: 0, date: DATE, speaker: "user", text, ...overrides };
}

function corpus(turns: readonly Turn[]): Corpus {
  return { id: "corpus-1", groupId: "corpus-1", turns };
}

const conversation = corpus([
  turn("s1:0", "I moved to Paris in April, and I no longer drink coffee."),
  turn("s1:1", "Congratulations on the move.", { speaker: "assistant" }),
]);

function onlyChunk(source: Corpus = conversation): ExtractionChunk {
  const chunks = buildExtractionChunks(source);
  expect(chunks).toHaveLength(1);
  return chunks[0]!;
}

function response(units: readonly unknown[]) {
  return { units };
}

function unit(text: string, supports: readonly unknown[]) {
  return { text, supports };
}

describe("memory unit extraction", () => {
  test("sends only approved turn fields, so labels and questions cannot leak into the prompt", () => {
    const leaky = corpus([{ ...conversation.turns[0]!, question: "Where do I live?", answer: "Paris",
      has_answer: true, evidence: ["s1:0"], category: "knowledge-update" } as Turn]);
    const [system, user] = extractionMessages(onlyChunk(leaky));
    expect(EXTRACTION_PROFILE).toBe("oh.benchmark.extraction.v1");
    expect(system!.content).toBe(EXTRACTION_INSTRUCTION);
    expect(system!.content).toContain("untrusted data");
    expect(JSON.parse(user!.content)).toEqual({ date: DATE,
      turns: [{ turnId: "s1:0", speaker: "user", text: conversation.turns[0]!.text }] });
    for (const leak of ["Where do I live?", "has_answer", "answer", "evidence", "knowledge-update"]) {
      expect(user!.content).not.toContain(leak);
    }
  });

  test("never crosses a session occurrence or date, and keeps chunks within the turn bound", () => {
    const chunks = buildExtractionChunks(corpus([
      turn("a:0", "first", { sessionId: "a", sessionIndex: 0, date: "day-1" }),
      turn("a:1", "second", { sessionId: "a", sessionIndex: 1, date: "day-1" }),
      turn("a:2", "third", { sessionId: "a", sessionIndex: 1, date: "day-2" }),
      turn("b:0", "fourth", { sessionId: "b", sessionIndex: 2, date: "day-2" }),
    ]));
    expect(chunks.map((chunk) => chunk.turns.map((item) => item.id))).toEqual([["a:0"], ["a:1"], ["a:2"], ["b:0"]]);
    expect(chunks.map((chunk) => [chunk.sessionId, chunk.sessionIndex, chunk.date]))
      .toEqual([["a", 0, "day-1"], ["a", 1, "day-1"], ["a", 1, "day-2"], ["b", 2, "day-2"]]);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(4);
    const many = buildExtractionChunks(corpus(Array.from({ length: 30 }, (_, index) => turn(`s1:${index}`, "short"))));
    expect(many.map((chunk) => chunk.turns.length)).toEqual([24, 6]);
  });

  test("splits an oversized turn losslessly and keeps every chunk inside its rendered byte bound", () => {
    const text = Array.from({ length: 40 }, (_, index) => `Sentence ${index} about "Paris" \\ and plans.`).join(" ");
    const chunks = buildExtractionChunks(corpus([turn("s1:0", text)]), { maxBytes: 220 });
    expect(chunks.length).toBeGreaterThan(1);
    const segments = chunks.flatMap((chunk) => chunk.turns);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.every((segment) => segment.id === "s1:0")).toBe(true);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(extractionMessages(chunk)[1]!.content)).toBeLessThanOrEqual(220);
      expect(chunk.turns.length).toBeLessThanOrEqual(24);
    }
  });

  test("keeps split segments code-point safe and fails closed on pathological metadata", () => {
    const text = "\u{1D11E}é漢".repeat(40);
    const chunks = buildExtractionChunks(corpus([turn("s1:0", text)]), { maxBytes: 140 });
    const segments = chunks.flatMap((chunk) => chunk.turns);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    for (const segment of segments) {
      expect(segment.text).not.toMatch(/\p{Surrogate}/u);
      expect(segment.text).not.toContain("�");
    }
    expect(() => buildExtractionChunks(corpus([turn("s1:0", "hello")]), { maxBytes: 40 })).toThrow(RangeError);
    expect(() => buildExtractionChunks(corpus([turn("s1:0", "hello", { date: "x".repeat(500) })]),
      { maxBytes: 200 })).toThrow(RangeError);
    expect(() => buildExtractionChunks(conversation, { maxBytes: 0 })).toThrow(RangeError);
  });

  test("accepts only exactly keyed envelopes, facts, and supports", () => {
    const chunk = onlyChunk();
    const valid = unit("On 2023-05-10 the user said they moved to Paris in April.", [{ turnId: "s1:0", quote: "I moved to Paris" }]);
    expect(parseMemoryUnits(response([valid]), chunk).units).toHaveLength(1);
    expect(() => parseMemoryUnits({ units: [valid], note: "extra" }, chunk)).toThrow(TypeError);
    expect(() => parseMemoryUnits({ facts: [valid] }, chunk)).toThrow(TypeError);
    expect(() => parseMemoryUnits(response([valid]).units, chunk)).toThrow(TypeError);
    expect(() => parseMemoryUnits(response(Array.from({ length: 49 }, () => valid)), chunk)).toThrow(TypeError);
    const rejects = [
      { ...valid, id: "unit-1" },
      { ...valid, date: "2023-05-10" },
      { text: valid.text },
      unit("", [{ turnId: "s1:0", quote: "I moved to Paris" }]),
      unit("   ", [{ turnId: "s1:0", quote: "I moved to Paris" }]),
      unit(valid.text, [{ turnId: "s1:0", quote: "I moved to Paris", sessionId: "s1" }]),
      unit(valid.text, [{ turnId: "s1:0" }]),
      unit(valid.text, [{ turnId: "s1:0", quote: "" }]),
      unit(valid.text, [{ turnId: 0, quote: "I moved to Paris" }]),
      unit("x".repeat(1_025), [{ turnId: "s1:0", quote: "I moved to Paris" }]),
      "not an object",
    ];
    const parsed = parseMemoryUnits(response(rejects), chunk);
    expect(parsed.units).toHaveLength(0);
    expect(parsed.rejected).toBe(rejects.length);
  });

  test("rejects forged, mismatched, and out-of-chunk citations without ingesting them", () => {
    const chunks = buildExtractionChunks(corpus([turn("s1:0", "I moved to Paris in April."),
      turn("s2:0", "I adopted a cat.", { sessionId: "s2", sessionIndex: 1, date: "day-2" })]));
    const [first, second] = chunks as [ExtractionChunk, ExtractionChunk];
    const quotes = [
      { turnId: "s1:0", quote: "I moved to Berlin" },
      { turnId: "s1:0", quote: "i moved to paris" },
      { turnId: "s1:9", quote: "I moved to Paris" },
      { turnId: second.turns[0]!.id, quote: "I adopted a cat." },
      { turnId: "s1:0", quote: "a".repeat(769) },
    ];
    const parsed = parseMemoryUnits(response(quotes.map((support) => unit("The user moved.", [support]))), first);
    expect(parsed.units).toHaveLength(0);
    expect(parsed.rejected).toBe(quotes.length);
    const long = parseMemoryUnits(response([unit("The user repeated a long line.",
      [{ turnId: "s1:0", quote: "a".repeat(768) }])]), onlyChunk(corpus([turn("s1:0", "a".repeat(800))])));
    expect(long.units).toHaveLength(1);
    expect(long.rejected).toBe(0);
  });

  test("bounds provenance fanout to one through three distinct supports", () => {
    const chunk = onlyChunk();
    const cite = (quote: string, turnId = "s1:0") => ({ turnId, quote });
    const parsed = parseMemoryUnits(response([
      unit("The user moved to Paris.", []),
      unit("The user moved to Paris.", [cite("I moved"), cite("to Paris"), cite("no longer drink"), cite("in April")]),
      unit("The user moved to Paris.", [cite("I moved"), cite("I moved")]),
      unit("The user moved to Paris and stopped drinking coffee.",
        [cite("I moved to Paris"), cite("no longer drink coffee"), cite("Congratulations", "s1:1")]),
    ]), chunk);
    expect(parsed.rejected).toBe(3);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0]!.supports).toEqual([{ turnId: "s1:0", quote: "I moved to Paris" },
      { turnId: "s1:0", quote: "no longer drink coffee" }, { turnId: "s1:1", quote: "Congratulations" }]);
  });

  test("derives deterministic identifiers, host metadata, and deduplicated units", () => {
    const chunk = onlyChunk();
    expect(buildExtractionChunks(conversation)[0]!.id).toBe(chunk.id);
    const value = response([unit("The user moved to Paris in April.", [{ turnId: "s1:0", quote: "I moved to Paris" }]),
      unit("  The user moved to Paris in April.  ", [{ turnId: "s1:0", quote: "I moved to Paris" }])]);
    const parsed = parseMemoryUnits(value, chunk);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.rejected).toBe(0);
    expect(parsed.units[0]!.id).toMatch(/^unit_[a-f0-9]{64}$/);
    expect(parsed.units[0]!.text).toBe("The user moved to Paris in April.");
    expect(parsed.units[0]!.date).toBe(DATE);
    expect(parsed.units[0]!.sessionId).toBe("s1");
    expect(parsed.units[0]!.sessionIndex).toBe(0);
    expect(parseMemoryUnits(value, chunk).units[0]!.id).toBe(parsed.units[0]!.id);
    const elsewhere = onlyChunk(corpus([turn("s1:0", "I moved to Paris in April.", { sessionId: "s9", date: "day-9" })]));
    expect(parseMemoryUnits(value, elsewhere).units[0]!.id).not.toBe(parsed.units[0]!.id);
    expect(parseMemoryUnits(value, elsewhere).units[0]!.date).toBe("day-9");
  });
});
