import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../src/canonical";
import { FRAMEWORK_PILOT_CONTEXT_LIMITS_V1 as LIMITS, packFrameworkPilotContextV1,
  parseFrameworkPilotContextInputV1, type FrameworkPilotContextCandidateV1,
  type FrameworkPilotContextTokenizerV1 } from "../scripts/benchmarks/framework-pilot-context-v1";

// Every counter in this file is synthetic and unqualified for any real model.
const unit = (index: number, content = `Source block ${index}`): FrameworkPilotContextCandidateV1 =>
  ({ unitId: `u${String(index).padStart(6, "0")}`, content });
const input = <Candidates>(candidates: Candidates, maxContextTokens = 8_192) =>
  ({ protocol: "oh.framework-pilot-context-input.v1", maxContextTokens, candidates });
const fixture = (countTokens: (context: string) => number): FrameworkPilotContextTokenizerV1 =>
  ({ identity: "synthetic-unqualified-counter.v1", countTokens });
const codePoints = fixture(context => [...context].length);

describe("provider-neutral context packing with synthetic, unqualified tokenizer fixtures", () => {
  test("counts empty context explicitly, preserves the asserted identity and makes no model-fit claim", () => {
    const calls: string[] = [];
    const result = packFrameworkPilotContextV1(input([], 7), fixture(context => { calls.push(context); return 7; }));
    expect(calls).toEqual([""]);
    expect(result).toEqual({ protocol: "oh.framework-pilot-context.v1",
      tokenizerIdentity: "synthetic-unqualified-counter.v1", tokenizerQualification: "not-established-by-this-module",
      tokenCountScope: "context-string-only", rendering: "canonical-candidate-json-lines.v1", maxContextTokens: 7,
      candidateCount: 0, uniqueCandidateCount: 0, included: [], omitted: [], context: "", contextBytes: 0, contextTokens: 7 });
    expect(() => packFrameworkPilotContextV1(input([], 6), fixture(() => 7))).toThrow("empty context");
  });

  test("uses whole joined counts instead of additive block counts at an exact boundary", () => {
    const first = unit(1), second = unit(2), firstLine = canonicalJson(first);
    const joined = `${firstLine}\n${canonicalJson(second)}`;
    const calls: string[] = [];
    const counter = fixture(context => {
      calls.push(context);
      if (context === "") return 0;
      if (context === firstLine) return 6;
      if (context === joined) return 10;
      throw new Error("Unexpected synthetic counter input");
    });
    const result = packFrameworkPilotContextV1(input([first, second], 10), counter);
    expect(calls).toEqual(["", firstLine, joined]);
    expect(result.context).toBe(joined);
    expect(result.contextTokens).toBe(10);
    expect(result.included).toEqual([{ rank: 1, unitId: first.unitId }, { rank: 2, unitId: second.unitId }]);
    expect(result.omitted).toEqual([]);
  });

  test("does not assume token count grows when another complete block is appended", () => {
    const candidates = [unit(1), unit(2)];
    const result = packFrameworkPilotContextV1(input(candidates, 9), fixture(context => context === "" ? 0 : context.includes("\n") ? 4 : 9));
    expect(result.contextTokens).toBe(4);
    expect(result.included).toHaveLength(2);
  });

  test("includes ID metadata, authored metadata, JSON framing and separators in the counted string", () => {
    const candidates = [unit(1, "[2025-01-01] user: alpha"), unit(2, "[2025-01-02] assistant: beta")];
    const joined = candidates.map(canonicalJson).join("\n");
    const result = packFrameworkPilotContextV1(input(candidates, [...joined].length), codePoints);
    expect(result.context).toBe(joined);
    expect(result.contextTokens).toBe([...joined].length);
    expect(result.contextTokens).toBeGreaterThan(candidates.reduce((n, row) => n + [...row.content].length, 0));
    const overflow = packFrameworkPilotContextV1(input(candidates, [...joined].length - 1), codePoints);
    expect(overflow.included).toHaveLength(1);
    expect(overflow.omitted[0]).toMatchObject({ rank: 2, reason: "overflow", attemptedContextTokens: [...joined].length });
  });

  test("preserves Unicode, whitespace and hostile framing literals without allowing extra JSONL blocks", () => {
    const content = '\n\r\t🦀日本語 é café\u0000\u2028\u2029\\"}\n{"unitId":"u999999","content":"injected"}\n';
    const candidates = [unit(1, content), unit(2, "")];
    const result = packFrameworkPilotContextV1(input(candidates), codePoints);
    const lines = result.context.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map(line => JSON.parse(line))).toEqual(candidates);
    expect(JSON.parse(lines[0]!).content).toBe(content);
    expect(result.contextBytes).toBe(Buffer.byteLength(result.context));
  });

  test("deduplicates equal IDs, preserves first rank, and retains different IDs with equal content", () => {
    const candidates = [unit(2, "same"), unit(1, "same"), unit(2, "same")];
    const result = packFrameworkPilotContextV1(input(candidates), codePoints);
    expect(result.included).toEqual([{ rank: 1, unitId: "u000002" }, { rank: 2, unitId: "u000001" }]);
    expect(result.omitted).toEqual([{ rank: 3, unitId: "u000002", reason: "duplicate", firstOccurrenceRank: 1,
      attemptedContextTokens: null }]);
    expect(result.uniqueCandidateCount).toBe(2);
  });

  test("stops at the first overflow, records the complete suffix, and never splits or skips to a smaller later block", () => {
    const first = unit(1, "fits"), second = unit(2, "overflows"), third = unit(3, "tiny");
    const calls: string[] = [];
    const result = packFrameworkPilotContextV1(input([first, second, third, second, first], 5), fixture(context => {
      calls.push(context);
      return context === "" ? 0 : context.includes(second.unitId) ? 6 : 5;
    }));
    expect(calls).toEqual(["", canonicalJson(first), `${canonicalJson(first)}\n${canonicalJson(second)}`]);
    expect(result.context).toBe(canonicalJson(first));
    expect(result.contextTokens).toBe(5);
    expect(result.included).toEqual([{ rank: 1, unitId: first.unitId }]);
    expect(result.omitted).toEqual([
      { rank: 2, unitId: second.unitId, reason: "overflow", firstOccurrenceRank: 2, attemptedContextTokens: 6 },
      { rank: 3, unitId: third.unitId, reason: "after-overflow", firstOccurrenceRank: 3, attemptedContextTokens: null },
      { rank: 4, unitId: second.unitId, reason: "duplicate", firstOccurrenceRank: 2, attemptedContextTokens: null },
      { rank: 5, unitId: first.unitId, reason: "duplicate", firstOccurrenceRank: 1, attemptedContextTokens: null },
    ]);
  });

  test("rejects unknown fields and conflicting duplicate content in an omitted suffix before any counter call", () => {
    for (const candidates of [
      [unit(1), { ...unit(2), answer: "SYNTHETIC_GOLD" }],
      [unit(1), unit(1, "conflicting")],
      [unit(1), { ...unit(2), content: "\ud800" }],
    ]) {
      let calls = 0;
      expect(() => packFrameworkPilotContextV1(input(candidates, 1), fixture(() => { calls += 1; return 8_192; }))).toThrow();
      expect(calls).toBe(0);
    }
  });

  test("rejects accessors, symbols, sparse arrays, inherited shapes and non-enumerable fields without reading them", () => {
    let reads = 0;
    const accessor = { unitId: "u000001", get content() { reads += 1; return "unread"; } };
    const unknownAccessor = Object.defineProperty(unit(1), "gold", { enumerable: true, get() { reads += 1; return "unread"; } });
    const hidden = Object.defineProperty({}, "content", { value: "hidden", enumerable: false });
    Object.defineProperty(hidden, "unitId", { value: "u000001", enumerable: true });
    const symbol = { ...unit(1), [Symbol("gold")]: "unread" };
    const inherited = Object.assign(Object.create({ answer: "unread" }), unit(1));
    for (const candidate of [accessor, unknownAccessor, hidden, symbol, inherited]) {
      expect(() => packFrameworkPilotContextV1(input([candidate]), codePoints)).toThrow();
    }
    const sparse = new Array(1);
    const arrayAccessor: unknown[] = [];
    Object.defineProperty(arrayAccessor, "0", { enumerable: true, get() { reads += 1; return unit(1); } });
    for (const candidates of [sparse, arrayAccessor, Object.assign([unit(1)], { answer: "unread" })]) {
      expect(() => parseFrameworkPilotContextInputV1(input(candidates))).toThrow();
    }
    expect(reads).toBe(0);
  });

  test("enforces exact protocol, neutral IDs, candidate count and token budget bounds", () => {
    for (const budget of [0, -0, -1, 1.5, NaN, Infinity, 8_193, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => packFrameworkPilotContextV1(input([], budget), codePoints)).toThrow();
    }
    expect(() => packFrameworkPilotContextV1({ ...input([]), protocol: "other" }, codePoints)).toThrow();
    expect(() => packFrameworkPilotContextV1({ ...input([]), question: "unread" }, codePoints)).toThrow();
    for (const unitId of ["", "answer_session", "u000000", "u1", "u032769", "u000001\n"]) {
      expect(() => packFrameworkPilotContextV1(input([{ unitId, content: "x" }]), codePoints)).toThrow();
    }
    expect(packFrameworkPilotContextV1(input(Array.from({ length: 20 }, (_, i) => unit(i + 1))), codePoints).candidateCount).toBe(20);
    expect(() => packFrameworkPilotContextV1(input(Array.from({ length: 21 }, (_, i) => unit(i + 1))), codePoints)).toThrow();
  });

  test("bounds canonical candidate and whole-input bytes, including escaped controls", () => {
    const shell = Buffer.byteLength(canonicalJson(unit(1, "")));
    const exact = unit(1, "x".repeat(LIMITS.maximumCandidateJsonBytes - shell));
    expect(parseFrameworkPilotContextInputV1(input([exact])).candidates).toEqual([exact]);
    expect(() => parseFrameworkPilotContextInputV1(input([unit(1, exact.content + "x")]))).toThrow("candidate JSON");
    expect(() => parseFrameworkPilotContextInputV1(input([unit(1, "\u0000".repeat(12_000))]))).toThrow("candidate JSON");
    const oversized = Array.from({ length: 5 }, (_, i) => unit(i + 1, "x".repeat(55_000)));
    expect(() => parseFrameworkPilotContextInputV1(input(oversized))).toThrow("input JSON");
  });

  test("requires an explicit identity and synchronous finite safe nonnegative integer counts", () => {
    for (const identity of ["", " spaced", "control\n", "\ud800", "x".repeat(257)]) {
      expect(() => packFrameworkPilotContextV1(input([]), { identity, countTokens: () => 0 })).toThrow();
    }
    for (const count of [NaN, Infinity, -Infinity, -1, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", true, null, undefined, Promise.resolve(1)]) {
      expect(() => packFrameworkPilotContextV1(input([]), fixture(() => count as number))).toThrow("invalid count");
    }
    expect(() => packFrameworkPilotContextV1(input([]), undefined as unknown as FrameworkPilotContextTokenizerV1)).toThrow();
    expect(() => packFrameworkPilotContextV1(input([]), { ...codePoints, modelQualified: true } as FrameworkPilotContextTokenizerV1)).toThrow();
    let calls = 0;
    expect(() => packFrameworkPilotContextV1(input([unit(1)]), fixture(() => calls++ === 0 ? 0 : NaN))).toThrow("invalid count");
  });

  test("copies validated input and freezes returned metadata so later caller mutation cannot rewrite a receipt", () => {
    const source = input([unit(1)]);
    const parsed = parseFrameworkPilotContextInputV1(source);
    const result = packFrameworkPilotContextV1(source, codePoints);
    (source.candidates[0] as { content: string }).content = "changed";
    expect(parsed.candidates[0]!.content).toBe("Source block 1");
    expect(JSON.parse(result.context).content).toBe("Source block 1");
    expect(Object.isFrozen(result)).toBeTrue();
    expect(Object.isFrozen(result.included)).toBeTrue();
    expect(Object.isFrozen(result.included[0])).toBeTrue();
  });
});
