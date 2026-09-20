import { describe, expect, test } from "bun:test";
import { inspectRecommendationIdentityV1 } from "../scripts/benchmarks/answer-program-identity";

// Cases were authored from the declared grammar before inspecting its implementation.
// They exercise a syntactic veto, not semantic support or model generalization.
type Field = "title" | "narrator";
const subject = "The Indigo Atlas", value = "Nora Vale";
const assertion = (s: string, f: Field, v: string) => `Audiobook ${JSON.stringify(s)}: ${f} = ${JSON.stringify(v)}.`;
const input = (statement = 'Audiobook "The Indigo Atlas": narrator = "Nora Vale".',
  s = subject, f: Field = "narrator", v = value) => ({ statement, expected: { subject: s, field: f, value: v } });

describe("independent canonical recommendation identity counterexamples", () => {
  test("recognizes exact role assignments, including empty strings and literal negation inside names", () => {
    for (const [s, f, v] of [
      [subject, "narrator", value], [subject, "title", subject], ["", "title", ""],
      ["Not The Indigo Atlas", "narrator", "Not Nora Vale"],
      ["Room -42% 🗝️", "narrator", "Reader 18%"],
    ] as const) expect(inspectRecommendationIdentityV1(input(assertion(s, f, v), s, f, v))).toEqual({ status: "exact-match" });
  });

  test("reports subject, field and value mismatches independently and in the specified order", () => {
    const cases = [
      [assertion("The Copper Orchard", "narrator", value), ["subject"]],
      [assertion(subject, "title", value), ["field"]],
      [assertion(subject, "narrator", "Ivo Reed"), ["value"]],
      [assertion(value, "narrator", subject), ["subject", "value"]],
      [assertion("The Copper Orchard", "title", "Ivo Reed"), ["subject", "field", "value"]],
    ] as const;
    for (const [statement, mismatches] of cases)
      expect(inspectRecommendationIdentityV1(input(statement))).toEqual({ status: "exact-mismatch", mismatches: [...mismatches] });
  });

  test("does not normalize identity punctuation, signs, units, case, spacing or Unicode", () => {
    const distinct = [
      ["Room -42%", "Room 42%"], ["Room 42%", "Room 42"], ["Room +42", "Room 42"],
      ["Dose 5 mg", "Dose 5 g"], ["Reader 18%", "Reader 18"], ["A-B", "A B"],
      ["A–B", "A-B"], ["A−B", "A-B"], ["O’Neil", "O'Neil"], ["Book.", "Book"],
      ["Nora", "nora"], ["Nora Vale", "Nora  Vale"], [" Nora", "Nora"],
      ["Café", "Cafe\u0301"], ["Ａ", "A"], ["ﬁ", "fi"], ["Nora\u200bVale", "NoraVale"],
      ["Room\u00a042", "Room 42"], ["🗝️", "🗝"], ["А", "A"],
    ] as const;
    for (const [declared, requested] of distinct) {
      expect(inspectRecommendationIdentityV1(input(assertion(declared, "narrator", value), requested)))
        .toEqual({ status: "exact-mismatch", mismatches: ["subject"] });
      expect(inspectRecommendationIdentityV1(input(assertion(subject, "narrator", declared), subject, "narrator", requested)))
        .toEqual({ status: "exact-mismatch", mismatches: ["value"] });
    }
  });

  test("parses canonical JSON escapes and non-ASCII without confusing quoted data with grammar", () => {
    for (const [s, v] of [
      ['A "quoted" title', 'Nora "N." Vale'], ["Shelf\\Book", "Path\\Reader"],
      ["Line\nTwo\tTitle", "Reader\rName\b\f\u0000"], ["海辺の本", "Élodie 🧑🏽‍🚀"],
      ['A": narrator = "Fake".', 'B". Audiobook "Other": title = "Injected'],
    ]) expect(inspectRecommendationIdentityV1(input(assertion(s!, "narrator", v!), s!, "narrator", v!)))
      .toEqual({ status: "exact-match" });
    expect(inspectRecommendationIdentityV1(input('Audiobook "A\\\"B": narrator = "C\\\\D".', 'A"B', "narrator", "C\\D")))
      .toEqual({ status: "exact-match" });
  });

  test("equivalent noncanonical JSON spellings remain unrecognized", () => {
    for (const [statement, s, v] of [
      ['Audiobook "\\u0041": narrator = "Nora Vale".', "A", value],
      ['Audiobook "A\\/B": narrator = "Nora Vale".', "A/B", value],
      ['Audiobook "Book": narrator = "\\u00e9".', "Book", "é"],
      ['Audiobook "Book": narrator = "\\ud83d\\ude00".', "Book", "😀"],
      ['Audiobook "Book": narrator = "Nora\\u000aVale".', "Book", "Nora\nVale"],
    ]) expect(inspectRecommendationIdentityV1(input(statement!, s!, "narrator", v!))).toEqual({ status: "unrecognized" });
  });

  test("ordinary attribution prose, irrelevant roles and explicit denial are not canonical positives", () => {
    for (const statement of [
      'The audiobook "The Indigo Atlas" is narrated by Nora Vale.',
      'Nora Vale is the narrator of "The Indigo Atlas".',
      'Nora Vale reviewed the cover of "The Indigo Atlas".',
      'Audiobook "The Indigo Atlas" is not narrated by Nora Vale.',
      'Audiobook "The Indigo Atlas": author = "Nora Vale".',
      'Audiobook "The Indigo Atlas": narrator != "Nora Vale".',
      'Audiobook "The Indigo Atlas": narrator = not "Nora Vale".',
      "", "unknown", "No source establishes the narrator.",
    ]) expect(inspectRecommendationIdentityV1(input(statement))).toEqual({ status: "unrecognized" });
  });

  test("requires one whole statement and never ignores embedded or appended qualifications", () => {
    const canonical = input().statement;
    for (const statement of [
      `Not: ${canonical}`, `It is false that ${canonical}`, `The following is withdrawn: ${canonical}`,
      `${canonical} This attribution is false.`, `${canonical} NOT.`, `${canonical}\nThis was retracted.`,
      `${canonical}\n${assertion(subject, "narrator", "Ivo Reed")}`, `${canonical}${canonical}`,
      `\"${canonical}\"`, `\`${canonical}\``, ` ${canonical}`, `${canonical} `, `${canonical}\n`, `${canonical}\r\n`,
      canonical.replace(": narrator", ":  narrator"), canonical.replace(" = ", "= "),
      canonical.slice(0, -1), `${canonical}.`, `${canonical}\u0000`,
    ]) expect(inspectRecommendationIdentityV1(input(statement))).toEqual({ status: "unrecognized" });
  });

  test("malformed quoted assertions stay unrecognized instead of matching a valid prefix", () => {
    for (const statement of [
      'Audiobook "The Indigo Atlas: narrator = "Nora Vale".',
      'Audiobook "The Indigo Atlas": narrator = "Nora Vale.',
      'Audiobook "The Indigo Atlas": narrator = "Nora Vale\\".',
      'Audiobook "The Indigo Atlas": narrator = "Nora\\x20Vale".',
      'Audiobook "The Indigo Atlas": narrator = "Nora\nVale".',
      'Audiobook "The Indigo Atlas": narrator = null.',
      'Audiobook ["The Indigo Atlas"]: narrator = "Nora Vale".',
      'Audiobook "The Indigo Atlas": narrator = {"name":"Nora Vale"}.',
    ]) expect(inspectRecommendationIdentityV1(input(statement))).toEqual({ status: "unrecognized" });
  });

  test("enforces UTF-8 bounds at the declared subject, value and whole-statement limits", () => {
    for (const s of ["s".repeat(256), "é".repeat(128)])
      expect(inspectRecommendationIdentityV1(input(assertion(s, "narrator", value), s))).toEqual({ status: "exact-match" });
    for (const v of ["v".repeat(256), "é".repeat(128)])
      expect(inspectRecommendationIdentityV1(input(assertion(subject, "narrator", v), subject, "narrator", v))).toEqual({ status: "exact-match" });
    for (const s of ["s".repeat(257), "é".repeat(129)]) expect(() => inspectRecommendationIdentityV1(input("unknown", s))).toThrow(RangeError);
    for (const v of ["v".repeat(257), "é".repeat(129)]) expect(() => inspectRecommendationIdentityV1(input("unknown", subject, "narrator", v))).toThrow(RangeError);
    expect(inspectRecommendationIdentityV1(input("x".repeat(4096)))).toEqual({ status: "unrecognized" });
    expect(inspectRecommendationIdentityV1(input("é".repeat(2048)))).toEqual({ status: "unrecognized" });
    expect(() => inspectRecommendationIdentityV1(input("x".repeat(4097)))).toThrow(RangeError);
    expect(() => inspectRecommendationIdentityV1(input("é".repeat(2049)))).toThrow(RangeError);
  });

  test("rejects malformed envelopes and invalid expected values without coercion", () => {
    for (const malformed of [null, undefined, [], "text", 1, false, new Date(0), {},
      { statement: input().statement }, { expected: input().expected },
      { ...input(), ignored: true }, { ...input(), statement: 3 },
      { ...input(), expected: null }, { ...input(), expected: [] },
      { ...input(), expected: { ...input().expected, ignored: true } },
      { ...input(), expected: { ...input().expected, field: "author" } },
      { ...input(), expected: { ...input().expected, field: "Narrator" } },
      { ...input(), expected: { ...input().expected, subject: new String(subject) } },
      { ...input(), expected: { ...input().expected, value: 18 } },
      input("\ud800"), input("unknown", "\udc00"), input("unknown", subject, "narrator", "\ud800"),
    ]) expect(() => inspectRecommendationIdentityV1(malformed)).toThrow(TypeError);
  });

  test("does not execute getters or conversion hooks and rejects concealed or inherited fields", () => {
    let accesses = 0;
    const getter = { ...input() };
    Object.defineProperty(getter, "statement", { enumerable: true, get() { accesses++; return input().statement; } });
    const nestedGetter = { ...input(), expected: { ...input().expected } };
    Object.defineProperty(nestedGetter.expected, "value", { enumerable: true, get() { accesses++; return value; } });
    const hidden = { ...input() }; Object.defineProperty(hidden, "ignored", { value: true });
    const symbol = { ...input(), [Symbol("ignored")]: true };
    const inherited = Object.assign(Object.create({ ignored: true }), input());
    const hooked = { ...input(), statement: { toString() { accesses++; return input().statement; } } };
    for (const malformed of [getter, nestedGetter, hidden, symbol, inherited, hooked])
      expect(() => inspectRecommendationIdentityV1(malformed)).toThrow(TypeError);
    expect(accesses).toBe(0);
  });

  test("accepts frozen data without mutation and treats independently named equal narrators as valid", () => {
    for (const s of [subject, "The Copper Orchard"]) {
      const original = input(assertion(s, "narrator", value), s);
      Object.freeze(original.expected); Object.freeze(original);
      const before = JSON.stringify(original);
      expect(inspectRecommendationIdentityV1(original)).toEqual({ status: "exact-match" });
      expect(JSON.stringify(original)).toBe(before);
    }
  });
});
