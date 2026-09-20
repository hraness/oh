import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { inspectRecommendationIdentityV1 as inspect } from "../scripts/benchmarks/answer-program-identity";
import { runRecommendationProgram, type RecommendationProgramInput, type RecommendationProgramResult } from "../scripts/benchmarks/answer-program";

const expected = { subject: "Room -42% 🗝️", field: "narrator" as const, value: "Reader 18%" };
const statement = (subject: string, field: string, value: string) => `Audiobook ${JSON.stringify(subject)}: ${field} = ${JSON.stringify(value)}.`;

describe("bounded benchmark identity veto", () => {
  test("compares canonical subject, role and value without normalizing", () => {
    expect(inspect({ statement: statement(expected.subject, expected.field, expected.value), expected })).toEqual({ status: "exact-match" });
    expect(inspect({ statement: statement("Room 42% 🗝️", "title", "Reader 18"), expected })).toEqual({ status: "exact-mismatch", mismatches: ["subject", "field", "value"] });
    const escaped = { subject: 'A "quoted" \\ name', field: "title", value: "é\t🌕" };
    expect(inspect({ statement: statement(escaped.subject, escaped.field, escaped.value), expected: escaped })).toEqual({ status: "exact-match" });
  });
  test("unrecognized prose and malformed quotes never assert a match", () => {
    for (const text of ["Nora narrates Room.", statement(expected.subject, expected.field, expected.value) + " Not really.",
      'Audiobook "Room": narrator = "bad\\q".', 'Audiobook "\\u0041": title = "A".', 'Audiobook "Room": author = "Nora".']) {
      expect(inspect({ statement: text, expected }).status).toBe("unrecognized");
    }
  });
  test("rejects invalid envelopes and bounds before examining statement grammar", () => {
    let touched = false;
    expect(() => inspect({ get statement() { touched = true; return "x"; }, expected })).toThrow(TypeError);
    expect(touched).toBe(false);
    expect(() => inspect({ statement: "x", expected, extra: true })).toThrow(TypeError);
    expect(() => inspect({ statement: "x".repeat(4097), expected })).toThrow(RangeError);
    expect(() => inspect({ statement: "x", expected: { ...expected, value: "x".repeat(257) } })).toThrow(RangeError);
    expect(() => inspect({ statement: "x", expected: { ...expected, subject: "\ud800" } })).toThrow(TypeError);
  });
});

// Locked request identities copied from the source-only V5 fixture definition,
// not inferred from gold or from the narrator assertions being inspected.
const A = "The Indigo Atlas", B = "The Copper Orchard";
const LOCKED_IDENTITIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  f01: { "book-a": A }, f02: { "book-a": A, "book-b": B }, f03: { "book-a": A, "book-b": B },
  f04: { "book-a": A, "book-b": B }, f05: { "book-a": A }, f06: { "book-a": A, "book-b": B },
  f07: { "book-a": "Room -42% 🗝️", "book-b": "Room 42% 🗝️" }, f08: { "book-a": A },
  f09: { "book-a": A }, f10: { "book-a": A }, f11: { "book-a": A }, f12: { "book-a": A }, f13: { "book-a": A },
  f14: { "book-a": A, "book-b": B }, f15: { "book-a": A, "book-b": B }, f16: { "book-a": A },
  f17: { "book-a": A }, f18: { "book-a": A }, f19: { "book-a": "Room 42%" }, f20: { "book-a": A, "book-b": B },
};

test("cached V5 development repair only: veto two false admissions without changing frozen results", () => {
  const path = new URL("../benchmarks/results/memory-answer-program-v5-replay.json", import.meta.url);
  expect(statSync(path).size).toBeLessThan(1_048_576);
  const bytes = readFileSync(path);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("ff0b808c6853cdee3bffbeba8ba17a74821e1de8c2d7a89d9e151cfac9e7ccaa");
  const fixture = JSON.parse(bytes.toString("utf8")) as { rows: { caseId: string; semanticInput: RecommendationProgramInput;
    semantic: { status: RecommendationProgramResult["status"]; items: RecommendationProgramResult["items"]; text: string } }[];
    gold: { caseId: string; items: { itemId: string; status: string; title?: string; narrator?: string }[] }[] };
  expect(fixture.rows.map(row => row.caseId)).toEqual(Object.keys(LOCKED_IDENTITIES));
  const removed: string[] = []; let retained = 0, originalAdmissions = 0;
  const repaired = fixture.rows.map(row => {
    const input = row.semanticInput;
    const original = runRecommendationProgram(input);
    expect({ status: original.status, items: original.items, text: original.text }).toEqual(row.semantic);
    expect(input.requests.map(r => r.itemId)).toEqual(Object.keys(LOCKED_IDENTITIES[row.caseId]!));
    originalAdmissions += input.bindings.length;
    // Only previously admitted semantic bindings are considered. No new
    // binding or decision digest is created, even for an exact match.
    const bindings = input.bindings.filter(binding => {
      expect(binding.admission.kind).toBe("semantic");
      const record = input.snapshot.records.find(record => record.key === binding.source.recordKey)!;
      expect(binding.source.textPointer).toBe("/value/text");
      const text = (record.value as { text: string }).text;
      const verdict = inspect({ statement: text, expected: { subject: LOCKED_IDENTITIES[row.caseId]![binding.itemId],
        field: binding.field, value: text.slice(binding.source.start, binding.source.end) } });
      if (verdict.status === "exact-mismatch") { removed.push(`${row.caseId}:${binding.itemId}:${binding.source.recordKey}`); return false; }
      retained++; return true;
    });
    expect(bindings.every(binding => input.bindings.includes(binding))).toBe(true);
    return { caseId: row.caseId, result: runRecommendationProgram({ ...input, bindings }) };
  });
  expect(originalAdmissions).toBe(46); expect(retained).toBe(44);
  expect(removed).toEqual(["f07:book-a:view:f07-n-b", "f19:book-a:view:f19-n-unit"]);
  // Gold enters only after source-only veto and execution. This is a post-run
  // development regression, never a new held-out/model-quality observation.
  let correctCases = 0, recommendations = 0;
  for (const row of repaired) {
    const gold = fixture.gold.find(g => g.caseId === row.caseId)!;
    expect(row.result.status).toBe("complete");
    expect(row.result.items).toHaveLength(gold.items.length);
    if (row.result.items.every((item, i) => {
      const target = gold.items[i]!;
      return item.itemId === target.itemId && item.status === target.status && (item.status !== "recommended"
        || item.fields.title!.value === target.title && item.fields.narrator!.value === target.narrator);
    })) correctCases++;
    recommendations += row.result.items.filter(item => item.status === "recommended").length;
  }
  expect(correctCases).toBe(20); expect(recommendations).toBe(18);
  expect(readFileSync(path)).toEqual(bytes);
});
