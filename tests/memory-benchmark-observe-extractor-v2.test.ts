import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../src/graph";
import { makeOhObservationPromptV1, OH_OBSERVATION_INSTRUCTION_SHA256_V1, OH_OBSERVATION_INSTRUCTION_V1,
  OH_OBSERVATION_LIMITS_V1, parseOhObservationResponseV1, parseOhObservationSessionV1 } from "../src/observe";
import { makeObserveExtractorPromptV2, OBSERVE_EXTRACTOR_V2_INSTRUCTION, OBSERVE_EXTRACTOR_V2_INSTRUCTION_SHA256,
  OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT, OBSERVE_EXTRACTOR_V2_SCHEMA_SHA256, parseObserveExtractorResponseV2 } from "../scripts/benchmarks/observe-extractor-v2";

type Turn = Readonly<{ speaker: string; text: string }>;
const sourceTurns: readonly Turn[] = [
  { speaker: "Mara", text: "Yesterday I visited Kiln House for 2 hours. In 2020 I moved to Porto. I prefer oolong tea." },
  { speaker: "Guide", text: "I suggest a 12-slide deck. On 2024-02-29 I recommended stoneware clay." },
  { speaker: "Mara", text: "My pottery budget changed from $40 to $55. Next winter I plan another visit." },
];
function session(turns = sourceTurns) {
  return parseOhObservationSessionV1(turns.map((turn, i) => createKnowledgeGraphRecordV1({ dependencies: [],
    key: `edition:source-${String(i).padStart(3, "0")}`, kind: "edition", v: 1,
    value: { id: `source:${i}`, sessionId: "synthetic-session", sessionIndex: 0, date: "2026-03-14", ...turn } })));
}
const input = session();
function draft(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { text: "Mara prefers oolong tea.", attributionTurn: "t0", kind: "preference", when: null, facet: "tea-preference", sources: ["t0"], ...patch };
}
const response = (...observations: unknown[]) => JSON.stringify({ observations });
const parse = (...observations: unknown[]) => parseObserveExtractorResponseV2(response(...observations), input);
function accepted(...observations: unknown[]) {
  const result = parse(...observations); expect(result.ok).toBe(true);
  if (!result.ok) throw Error(`Expected acceptance: ${result.rejection}`); return result;
}
function rejected(raw: unknown, expected?: string, index?: number | null) {
  const result = parseObserveExtractorResponseV2(raw, input); expect(result.ok).toBe(false);
  if (result.ok) throw Error("Expected rejection");
  if (expected !== undefined) expect(result.rejection).toBe(expected);
  if (index !== undefined) expect(result.index).toBe(index);
}

describe("V2 source-only prompt and immutable V1 contracts", () => {
  test("projects only dated source turns while using an independently identified instruction and strict schema", () => {
    const decorated = { ...input, question: "QUESTION_SENTINEL", category: "CATEGORY_SENTINEL", answer: "GOLD_SENTINEL" };
    const prompt = makeObserveExtractorPromptV2(decorated), old = makeOhObservationPromptV1(input);
    expect(prompt.messages).toHaveLength(2);
    expect(prompt.messages[0]).toEqual({ role: "system", content: OBSERVE_EXTRACTOR_V2_INSTRUCTION });
    expect(prompt.messages[1]).toEqual(old.messages[1]);
    const payload = JSON.parse(prompt.messages[1]!.content);
    expect(Object.keys(payload).sort()).toEqual(["sessionDate", "turns"]);
    expect(payload.turns.map((t: Record<string, unknown>) => Object.keys(t).sort())).toEqual(sourceTurns.map(() => ["id", "speaker", "text"]));
    expect(JSON.stringify(prompt)).not.toMatch(/QUESTION_SENTINEL|CATEGORY_SENTINEL|GOLD_SENTINEL/);
    expect(prompt.sessionSha256).toBe(input.sessionSha256);
    expect(prompt.promptSha256).toBe(canonicalSha256(prompt.messages));
    expect(prompt.instructionSha256).toBe(sha256Hex(OBSERVE_EXTRACTOR_V2_INSTRUCTION));
    expect(prompt.schemaSha256).toBe(canonicalSha256(OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT));
    expect(OBSERVE_EXTRACTOR_V2_INSTRUCTION_SHA256).not.toBe(OH_OBSERVATION_INSTRUCTION_SHA256_V1);
    expect(OBSERVE_EXTRACTOR_V2_SCHEMA_SHA256).toBe(prompt.schemaSha256);
    const format = OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT;
    expect(format.type).toBe("json_schema"); expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    expect(Object.isFrozen(format)).toBe(true);
    expect(Object.isFrozen(format.json_schema.schema.properties.observations.items.properties.sources.items)).toBe(true);
  });

  test("V1 still accepts its original wire, rejects V2 fields, and retains its frozen instruction", () => {
    expect(OH_OBSERVATION_INSTRUCTION_SHA256_V1).toBe("771ec3c8ec60ebbb4c048d6d2bec703f94543b2ba6e027c0165b44fc8db4d838");
    expect(sha256Hex(OH_OBSERVATION_INSTRUCTION_V1)).toBe(OH_OBSERVATION_INSTRUCTION_SHA256_V1);
    expect(makeOhObservationPromptV1(input).messages[0].content).toBe(OH_OBSERVATION_INSTRUCTION_V1);
    const old = response({ text: "Mara visited Kiln House.", speaker: "Mara", kind: "event", eventAt: "2026-03-13",
      resolvedFrom: "Yesterday", facet: null, sources: ["t0"] });
    expect(parseOhObservationResponseV1(old, input).ok).toBe(true);
    expect(parseObserveExtractorResponseV2(old, input).ok).toBe(false);
    expect(parseOhObservationResponseV1(response(draft()), input).ok).toBe(false);
  });
});

describe("verified attribution and provenance", () => {
  test("speaker is derived from attributionTurn and citations retain source record keys and digests", () => {
    const result = accepted(draft({ text: "Guide suggests a 12-slide deck.", attributionTurn: "t1", kind: "fact", facet: null, sources: ["t1"] }),
      draft({ text: "Mara changed the pottery budget and prefers oolong tea.", kind: "update", sources: ["t2", "t0"] }));
    expect(result.observations.map(o => o.speaker)).toEqual(["Guide", "Mara"]);
    expect(result.observations[0]!.sources).toEqual([{ key: input.turns[1]!.key, recordSha256: input.turns[1]!.recordSha256, v: 1 }]);
    expect(result.observations[1]!.sources).toEqual([input.turns[0]!, input.turns[2]!].map(t => ({ key: t.key, recordSha256: t.recordSha256, v: 1 })));
    expect(parseOhObservationResponseV1(result.normalizedV1Response, input)).toEqual({ ok: true, observations: result.observations });
  });

  test.each([
    ["unknown attribution", { attributionTurn: "t77", sources: ["t77"] }],
    ["uncited attribution", { attributionTurn: "t0", sources: ["t2"] }],
    ["non-string attribution", { attributionTurn: 0 }],
    ["noncanonical attribution", { attributionTurn: "t00", sources: ["t00"] }],
    ["unknown source", { sources: ["t0", "t77"] }],
    ["non-string source", { sources: ["t0", 2] }],
    ["mixed speakers", { sources: ["t0", "t1"] }],
    ["empty sources", { sources: [] }],
    ["duplicate sources", { sources: ["t0", "t0"] }],
    ["non-array sources", { sources: "t0" }],
    ["invented speaker field", { speaker: "Guide" }],
  ] as const)("rejects %s", (_name, patch) => rejected(response(draft({ ...patch }))));

  test("supports sixteen citations but rejects seventeen even in a larger valid session", () => {
    const many = session(Array.from({ length: 20 }, (_, i) => ({ speaker: "Mara", text: `Mara records fact ${i}.` })));
    const withCount = (count: number) => response(draft({ sources: Array.from({ length: count }, (_, i) => `t${i}`) }));
    expect(parseObserveExtractorResponseV2(withCount(16), many).ok).toBe(true);
    expect(parseObserveExtractorResponseV2(withCount(17), many).ok).toBe(false);
  });
});

describe("bounded original JSON validation before normalization", () => {
  test.each([
    ["non-string", { observations: [] }], ["malformed", '{"observations":['], ["trailing object", '{"observations":[]}{}'],
    ["trailing comma", '{"observations":[],}'], ["markdown fence", '```json\n{"observations":[]}\n```'],
    ["deep JSON", '{"observations":' + '['.repeat(9) + '0' + ']'.repeat(9) + '}'],
    ["oversized ASCII", " ".repeat(OH_OBSERVATION_LIMITS_V1.responseBytes + 1)],
    ["oversized UTF-8", "é".repeat(OH_OBSERVATION_LIMITS_V1.responseBytes / 2 + 1)],
    ["lone surrogate", '{"observations":[],"x":"\ud800"}'],
    ["duplicate envelope", '{"observations":[],"observations":[]}'],
    ["escaped duplicate envelope", '{"observations":[],"\\u006fbservations":[]}'],
  ] as const)("rejects %s", (_name, raw) => rejected(raw));

  test("rejects duplicates inside observation and date objects, before later values can hide them", () => {
    const row = JSON.stringify(draft());
    rejected('{"observations":[' + row.replace('"attributionTurn":"t0"', '"attributionTurn":"t77","attributionTurn":"t0"') + ']}');
    const dated = response(draft({ text: "Mara visited Yesterday.", when: { expression: "Yesterday", date: "2026-03-13" } }));
    rejected(dated.replace('"date":"2026-03-13"', '"date":"invalid","date":"2026-03-13"'));
  });

  test.each([
    ["extra envelope field", { observations: [], extra: true }], ["wrong envelope", []], ["null envelope", null],
    ["non-array observations", { observations: {} }], ["null observation", { observations: [null] }],
    ["extra observation field", { observations: [draft({ confidence: 1 })] }],
    ["missing observation field", { observations: [{ text: "Mara prefers tea." }] }],
    ["extra date field", { observations: [draft({ when: { expression: "Yesterday", date: null, confidence: 1 } })] }],
  ] as const)("rejects %s", (_name, value) => rejected(JSON.stringify(value)));

  test("quoted punctuation is data, and count boundaries retain an all-or-nothing result", () => {
    const text = 'Mara wrote "text": "value" with {braces}, [arrays], \\ and a 🫖.';
    expect(accepted(draft({ text })).observations[0]!.text).toBe(text);
    expect(parse().ok).toBe(true);
    expect(accepted(...Array.from({ length: 48 }, (_, i) => draft({ text: `Mara's distinct fact ${i}.` }))).observations).toHaveLength(48);
    rejected(response(...Array.from({ length: 49 }, (_, i) => draft({ text: `Mara's distinct fact ${i}.` }))), "observation-count");
    rejected(response(draft(), draft({ kind: "unsupported" })), "kind", 1);
  });
});

describe("evidenced dates and unresolved literal preservation", () => {
  test("retains unresolved year/season text while normalizing both V1 date fields to null", () => {
    const result = accepted(draft({ text: "Mara moved to Porto In 2020.", when: { expression: "In 2020", date: null } }),
      draft({ text: "Mara plans another pottery visit Next winter.", attributionTurn: "t2", sources: ["t2"], kind: "plan", when: { expression: "Next winter", date: null } }));
    expect(result.unresolvedDateExpressions).toBe(2);
    for (const row of result.observations) { expect(row.eventAt).toBeNull(); expect(row.resolvedFrom).toBeNull(); }
    expect(result.observations[0]!.text).toContain("In 2020"); expect(result.observations[1]!.text).toContain("Next winter");
    expect(parseOhObservationResponseV1(result.normalizedV1Response, input).ok).toBe(true);
  });

  test("a bare year cannot be upgraded to fabricated day precision", () => {
    rejected(response(draft({ text: "Mara moved to Porto in 2020.", when: { expression: "2020", date: "2020-01-01" } })), "date-precision", 0);
    expect(accepted(draft({ text: "Mara moved to Porto in 2020.", when: { expression: "2020", date: null } })).observations[0]!.eventAt).toBeNull();
  });

  test.each([
    ["prefixed year", { text: "Mara moved to Porto In 2020.", when: { expression: "In 2020", date: "2020-01-01" } }, "date-precision"],
    ["relative season", { text: "Mara plans another visit Next winter.", attributionTurn: "t2", sources: ["t2"], kind: "plan",
      when: { expression: "Next winter", date: "2026-12-01" } }, "date-precision"],
    ["contradictory ISO date", { text: "Guide recommended stoneware on 2024-02-29.", attributionTurn: "t1", sources: ["t1"], kind: "event",
      when: { expression: "2024-02-29", date: "2025-02-28" } }, "date-evidence"],
  ] as const)("rejects fabricated precision or contradictory evidence: %s", (_name, patch, reason) => {
    rejected(response(draft({ ...patch })), reason, 0);
  });

  test("accepts a prefixed ISO date when its exact date and source expression agree", () => {
    const result = accepted(draft({ text: "Guide recommended stoneware On 2024-02-29.", attributionTurn: "t1", sources: ["t1"], kind: "event",
      when: { expression: "On 2024-02-29", date: "2024-02-29" } }));
    expect(result.unresolvedDateExpressions).toBe(0);
    expect(result.observations[0]!.eventAt).toBe("2024-02-29");
    expect(result.observations[0]!.resolvedFrom).toBe("On 2024-02-29");
    expect(result.observations[0]!.text).toContain("On 2024-02-29");
    expect(parseOhObservationResponseV1(result.normalizedV1Response, input).ok).toBe(true);
  });

  test.each(["2024-02-29 and 2024-02-29", "2024-02-29 and 2024-03-01"])(
    "rejects multiple ISO dates in one expression even when source text supports it: %s", expression => {
      const text = `Mara visited Kiln House on ${expression}.`, local = session([{ speaker: "Mara", text }]);
      const result = parseObserveExtractorResponseV2(response(draft({ text, kind: "event", when: { expression, date: "2024-02-29" } })), local);
      expect(result).toEqual({ ok: false, rejection: "date-evidence", index: 0 });
    });

  test("normalization returns separate derived bytes while original V2 model bytes remain unchanged", () => {
    const raw = JSON.stringify({ observations: [draft({ text: "Mara moved to Porto in 2020.", when: { expression: "2020", date: null } })] }, null, 2);
    const digest = sha256Hex(raw), original = raw;
    const parsed = parseObserveExtractorResponseV2(raw, input);
    expect(parsed.ok).toBe(true); if (!parsed.ok) throw Error("Expected acceptance");
    expect(raw).toBe(original); expect(sha256Hex(raw)).toBe(digest);
    expect(parsed.normalizedV1Response).not.toBe(raw);
    expect(JSON.parse(raw).observations[0].when).toEqual({ expression: "2020", date: null });
    const normalized = JSON.parse(parsed.normalizedV1Response).observations[0];
    expect(normalized.speaker).toBe("Mara"); expect(normalized.eventAt).toBeNull(); expect(normalized.resolvedFrom).toBeNull();
    expect(normalized).not.toHaveProperty("when"); expect(normalized).not.toHaveProperty("attributionTurn");
  });

  test("accepts a resolved relative date and a real leap day, with exact evidence retained", () => {
    const result = accepted(draft({ text: "Mara visited Kiln House Yesterday for 2 hours.", kind: "event", when: { expression: "Yesterday", date: "2026-03-13" } }),
      draft({ text: "Guide recommended stoneware on 2024-02-29.", attributionTurn: "t1", sources: ["t1"], kind: "event", when: { expression: "2024-02-29", date: "2024-02-29" } }));
    expect(result.unresolvedDateExpressions).toBe(0);
    expect(result.observations.map(o => [o.eventAt, o.resolvedFrom])).toEqual([["2026-03-13", "Yesterday"], ["2024-02-29", "2024-02-29"]]);
  });

  test.each(["2020", "2020-01", "2025-02-29", "2024-02-30", "2026-13-01", "2026-00-01", "2026-03-00", "2026-3-13", "2026-03-13T00:00:00Z", "", 2026])(
    "rejects invalid or partial date value %s", date => rejected(response(draft({ text: "Mara visited Yesterday.", when: { expression: "Yesterday", date } })), "date"));

  test.each([
    ["fabricated expression", { text: "Mara visited last Tuesday.", when: { expression: "last Tuesday", date: "2026-03-10" } }],
    ["expression only in non-cited turn", { text: "Mara visited Next winter.", when: { expression: "Next winter", date: null } }],
    ["expression missing from observation", { text: "Mara visited Kiln House.", when: { expression: "Yesterday", date: "2026-03-13" } }],
    ["changed expression case", { text: "Mara visited yesterday.", when: { expression: "yesterday", date: "2026-03-13" } }],
    ["missing expression", { when: { date: null } }], ["missing date", { when: { expression: "Yesterday" } }],
    ["empty expression", { when: { expression: "", date: null } }], ["padded expression", { when: { expression: " Yesterday", date: null } }],
    ["multiline expression", { when: { expression: "Yesterday\n", date: null } }],
    ["oversized expression", { when: { expression: "x".repeat(257), date: null } }],
    ["non-object when", { when: "Yesterday" }],
  ] as const)("rejects %s", (_name, patch) => rejected(response(draft({ ...patch }))));
});

describe("V1 validation remains authoritative for normalized observations", () => {
  test.each([
    ["blank text", { text: "" }, "text"],
    ["multiline text", { text: "Mara\nlikes tea." }, "text"], ["text UTF8 bound", { text: "é".repeat(513) }, "text"],
    ["invalid kind", { kind: "suggestion" }, "kind"], ["uppercase facet", { facet: "Tea-Preference" }, "facet"],
    ["facet whitespace", { facet: "tea preference" }, "facet"], ["facet length", { facet: "x".repeat(49) }, "facet"],
  ] as const)("rejects %s through the shared V1 validator", (_name, patch, reason) => rejected(response(draft({ ...patch })), reason, 0));

  test("preserves original text bytes with the existing V1 validator", () => {
    const text = "  Mara likes tea.  ", parsed = accepted(draft({ text }));
    expect(parsed.observations[0]!.text).toBe(text);
    expect(parseOhObservationResponseV1(parsed.normalizedV1Response, input)).toEqual({ ok: true, observations: parsed.observations });
  });

  test("accepts exact UTF-8/text and facet bounds, and rejects repeated observation text", () => {
    const result = accepted(draft({ text: "é".repeat(512), facet: "x".repeat(48) }));
    expect(Buffer.byteLength(result.observations[0]!.text)).toBe(1024);
    rejected(response(draft(), draft({ kind: "fact", facet: null })), "duplicate-text", 1);
  });

  test("all allowed kinds and same-speaker citation permutations round-trip through the V1 wire", () => {
    for (const kind of ["fact", "event", "plan", "preference", "update"]) {
      for (const sources of [["t0", "t2"], ["t2", "t0"]]) {
        const result = accepted(draft({ kind, sources }));
        expect(parseOhObservationResponseV1(result.normalizedV1Response, input)).toEqual({ ok: true, observations: result.observations });
        expect(result.observations[0]!.sources.map(s => s.key)).toEqual([input.turns[0]!.key, input.turns[2]!.key]);
      }
    }
  });
});
