import { describe, expect, test } from "bun:test";

import { sha256Hex } from "../src/canonical";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { buildExtractionChunks, extractionMessages } from "../scripts/benchmarks/units";

/** Original JSON-based boundary rule, independent of the optimized width classification. */
function referenceSegments(text: string, budget: number): string[] {
  const segments: string[] = [];
  let current = "", cost = 0;
  for (const character of text) {
    const width = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (width > budget) throw new RangeError("Extraction chunk cannot hold a single code point of turn text.");
    if (cost + width > budget) { segments.push(current); current = ""; cost = 0; }
    current += character; cost += width;
  }
  segments.push(current);
  return segments;
}

function assertBoundaryParity(text: string, budget: number) {
  const turn = { id: "t", sessionId: "s", date: "d", speaker: "u", text };
  const corpus: Corpus = { id: "c", groupId: "c", turns: [turn] };
  const maxBytes = Buffer.byteLength(JSON.stringify({ date: turn.date, turns: [] })) + 1
    + Buffer.byteLength(JSON.stringify({ turnId: turn.id, speaker: turn.speaker, text: "" })) + budget;
  const build = () => buildExtractionChunks(corpus, { maxBytes, maxTurns: 1 });
  let expected: string[];
  try { expected = referenceSegments(text, budget); }
  catch (error) {
    expect(error).toBeInstanceOf(RangeError);
    expect(build).toThrow(error as RangeError);
    return;
  }
  const chunks = build();
  expect(chunks.map(chunk => chunk.turns[0]!.text)).toEqual(expected);
  expect(chunks.flatMap(chunk => chunk.turns).map(part => part.text).join("")).toBe(text);
  for (const chunk of chunks) {
    expect(chunk.turns).toHaveLength(1);
    expect(chunk.turns[0]!.id).toBe(turn.id);
    expect(Buffer.byteLength(extractionMessages(chunk)[1]!.content)).toBeLessThanOrEqual(maxBytes);
  }
}

describe("extraction segmentation compatibility", () => {
  test("preserves JSON escape widths, Unicode boundaries and errors for an indivisible character", () => {
    const characters = [
      ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)),
      '"', "\\", "/", "\x7f", "\u0080", "\u07ff", "\u0800", "\u2028", "\u2029", "\uffff",
      "\ud800", "\udbff", "\udc00", "\udfff", "\ud800\udc00", "\udbff\udfff", "e\u0301",
    ];
    for (const character of characters) for (let budget = 1; budget <= 8; budget++) {
      assertBoundaryParity(`a${character}${character}b`, budget);
    }
    for (const text of ["", "\ud800\ud800\udc00\udfff", "😀é中", "\ud800x\udfff"]) {
      for (const budget of [1, 2, 3, 4, 5, 6, 7, 12]) assertBoundaryParity(text, budget);
    }
  });

  test("matches the original boundary rule on bounded deterministic mixed strings", () => {
    let state = 0x9e3779b9;
    const random = (maximum: number) => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) % maximum;
    };
    const atoms = ["a", " ", '"', "\\", "\n", "\t", "\0", "\x1f", "é", "中", "😀", "\ud800", "\udfff", "\u2028", "e\u0301"];
    for (let example = 0; example < 160; example++) {
      const text = Array.from({ length: random(129) }, () => atoms[random(atoms.length)]!).join("");
      assertBoundaryParity(text, 1 + random(64));
    }
  });

  test("preserves frozen chunk identifiers and extraction prompt bytes", () => {
    const corpus: Corpus = { id: "fixed-corpus", groupId: "fixed-family", turns: [
      { id: "turn-1", sessionId: "session-a", sessionIndex: 0, date: "2026-09-09", speaker: "User", text: 'A\n"\\é中😀\ud800x\udfff\u2028\0'.repeat(8) },
      { id: "turn-2", sessionId: "session-a", sessionIndex: 0, date: "2026-09-09", speaker: "Assistant", text: "second turn" },
      { id: "turn-3", sessionId: "session-a", sessionIndex: 1, date: "2026-09-10", speaker: "User", text: "" },
    ] };
    const chunks = buildExtractionChunks(corpus, { maxTurns: 2, maxBytes: 160 });
    // Recorded from the original JSON-per-code-point splitter, before the optimization.
    expect(chunks).toHaveLength(6);
    expect<string>(sha256Hex(JSON.stringify(chunks))).toBe("7fe298fa606d382a6f4fb20bd304ccc45f8ea334271f1d8c14844a908520b0da");
    expect<string>(sha256Hex(JSON.stringify(chunks.map(extractionMessages)))).toBe("332192dc6c83bcce82c6fdd1baeb86776aee33e914f1e6ca3d2c19747d3c9f63");
  });
});
