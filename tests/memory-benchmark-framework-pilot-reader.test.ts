import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fc from "fast-check";
import { canonicalJson } from "../src/canonical";
import { packFrameworkPilotContextV1 } from "../scripts/benchmarks/framework-pilot-context-v1";
import { FRAMEWORK_PILOT_READER_INSTRUCTION_V1, renderFrameworkPilotReaderV1 } from "../scripts/benchmarks/framework-pilot-reader-v1";

const hash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const fixtureContext = '{"content":"[2026/04/01] user: I finished a hike.","unitId":"u000002"}\n'
  + '{"content":"[2026/04/02] assistant: You could try swimming.","unitId":"u000001"}';
const fixture = () => ({ protocol: "oh.framework-pilot-reader-input.v1",
  question: "Which activities had I completed by the question date?", questionDate: "2026/04/03 12:00",
  context: fixtureContext, contextSha256: hash(fixtureContext), contextTokens: 47 });
const withContext = (context: string, contextTokens = 0) => ({ ...fixture(), context, contextSha256: hash(context), contextTokens });
const evidenceDelimiter = "\n\nEvidence (JSON Lines):\n";
const questionDelimiter = "\n\nQuestion (JSON):\n";

describe("common framework reader rendering, without model or source qualification", () => {
  test("pins one user message, fixed instruction, canonical question and raw evidence bytes", () => {
    const result = renderFrameworkPilotReaderV1(fixture());
    const expectedQuestion = '{"question":"Which activities had I completed by the question date?","questionDate":"2026/04/03 12:00"}';
    const expected = `${FRAMEWORK_PILOT_READER_INSTRUCTION_V1}${questionDelimiter}${expectedQuestion}${evidenceDelimiter}${fixtureContext}`;
    expect(result.messages).toEqual([{ role: "user", content: expected }]);
    expect(result.promptBytes).toBe(Buffer.byteLength(expected));
    expect(result.promptSha256).toBe(hash(expected));
    expect(result.messagesSha256).toBe(hash(canonicalJson([{ role: "user", content: expected }])));
    expect(result.contextSha256).toBe(hash(fixtureContext));
    expect(result.contextBytes).toBe(Buffer.byteLength(fixtureContext));
    expect(result.instructionSha256).toBe("261990394c98c4fe645f9b452b5b8477e461ab4fcc38962a1ea12b5ebcdc8926");
    expect(result.promptSha256).toBe("69afa9c6bbacbd6992c4250942b0d4e282323cb8cbcf8f2cae87413377539e52");
    expect(result.messagesSha256).toBe("75ce6583c7c973e936a98e3082bba4476153d1bfc50bfaad520a55669b4afcf6");
    expect(result.messages[0].content.endsWith(fixtureContext)).toBeTrue();
    expect(result.messages[0].content.endsWith("\n")).toBeFalse();
  });

  test("carries transparent evidence-only accounting and no model or output settings", () => {
    const result = renderFrameworkPilotReaderV1(fixture());
    expect(result.accounting).toEqual({ maximumContextTokens: 8_192, tokenCountSource: "caller-supplied",
      tokenCountScope: "context-string-only", excludedFromContextTokenCount: [
        "instructions", "question-json", "delimiters", "chat-framing", "output-reserve",
      ], tokenizerQualification: "not-established-by-this-module",
      contextAdmission: "requires-campaign-receipt-and-pinned-tokenizer" });
    expect(result.contextTokens).toBe(47);
    expect(result.promptBytes).toBeGreaterThan(result.contextBytes);
    expect(Object.hasOwn(result, "model")).toBeFalse();
    expect(Object.hasOwn(result, "outputTokens")).toBeFalse();
    expect(Object.hasOwn(result, "answer")).toBeFalse();
    expect(FRAMEWORK_PILOT_READER_INSTRUCTION_V1).toContain("using only the supplied evidence");
    expect(FRAMEWORK_PILOT_READER_INSTRUCTION_V1).toContain("question date");
    expect(FRAMEWORK_PILOT_READER_INSTRUCTION_V1).toContain("assistant suggestions");
    expect(FRAMEWORK_PILOT_READER_INSTRUCTION_V1).toContain("intended events from completed events");
    expect(FRAMEWORK_PILOT_READER_INSTRUCTION_V1).toContain("items or counts");
    expect(FRAMEWORK_PILOT_READER_INSTRUCTION_V1).toContain("I don't have enough information to answer.");
  });

  test("accepts empty context and zero tokens without interpreting counts as independent proof", () => {
    const zero = renderFrameworkPilotReaderV1({ ...withContext(""), questionDate: "" });
    expect(zero.contextBytes).toBe(0);
    expect(zero.contextTokens).toBe(0);
    expect(zero.contextSha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(zero.messages[0].content.endsWith(evidenceDelimiter)).toBeTrue();
    expect(zero.messages[0].content).toContain('"questionDate":""');
    expect(renderFrameworkPilotReaderV1(withContext("", 8_192)).contextTokens).toBe(8_192);
    expect(renderFrameworkPilotReaderV1(withContext(fixtureContext, 0)).contextTokens).toBe(0);
    // Opaque rendering cannot admit this as valid packed evidence even with a matching digest.
    const opaque = renderFrameworkPilotReaderV1(withContext("not JSON Lines\n", 1));
    expect(opaque.messages[0].content.endsWith("not JSON Lines\n")).toBeTrue();
    expect(opaque.accounting.contextAdmission).toBe("requires-campaign-receipt-and-pinned-tokenizer");
  });

  test("uses identical message bytes for identical question and context regardless of object order or count assertion", () => {
    const source = fixture();
    const reordered = { contextTokens: 1, contextSha256: source.contextSha256, context: source.context,
      questionDate: source.questionDate, question: source.question, protocol: source.protocol };
    const first = renderFrameworkPilotReaderV1(source), second = renderFrameworkPilotReaderV1(reordered);
    expect(second.messages).toEqual(first.messages);
    expect(second.instructionSha256).toBe(first.instructionSha256);
    expect(second.promptSha256).toBe(first.promptSha256);
    expect(second.messagesSha256).toBe(first.messagesSha256);
    expect(second.contextTokens).toBe(1);
    const nullPrototype: unknown = Object.assign(Object.create(null), source);
    expect(renderFrameworkPilotReaderV1(nullPrototype)).toEqual(first);
  });

  test("retains packed whole JSONL, Unicode, source order, escapes and trailing bytes exactly", () => {
    const payload = '\r\n\t🧪日本語 Cafe\u0301 café\0\u2028\u2029\\"}\n{"unitId":"u999999","gold":"text-only"}';
    const candidates = [{ unitId: "u000002", content: payload }, { unitId: "u000001", content: "" }];
    const packed = packFrameworkPilotContextV1({ protocol: "oh.framework-pilot-context-input.v1",
      maxContextTokens: 8_192, candidates }, {
      identity: "synthetic-unqualified-scalar-counter.v1", countTokens: context => [...context].length,
    });
    const question = `  Which facts?\n${payload}  `, questionDate = " 2030/02/03 (Sun)\t";
    const result = renderFrameworkPilotReaderV1({ ...withContext(packed.context, packed.contextTokens), question, questionDate });
    const content = result.messages[0].content;
    const prefix = `${FRAMEWORK_PILOT_READER_INSTRUCTION_V1}${questionDelimiter}${canonicalJson({ question, questionDate })}${evidenceDelimiter}`;
    expect(content.slice(prefix.length)).toBe(packed.context);
    expect(Buffer.from(content).subarray(Buffer.byteLength(prefix))).toEqual(Buffer.from(packed.context));
    expect(content.slice(prefix.length).split("\n").map(line => JSON.parse(line))).toEqual(candidates);
    expect(result.contextTokens).toBe(packed.contextTokens);
    expect(result.contextBytes).toBe(packed.contextBytes);
    expect(result.contextSha256).toBe(hash(packed.context));
    const trailing = `${packed.context}\n \t`;
    expect(renderFrameworkPilotReaderV1(withContext(trailing)).messages[0].content.endsWith(trailing)).toBeTrue();
    expect(renderFrameworkPilotReaderV1({ ...fixture(), question: " \t\n" }).messages[0].content).toContain('"question":" \\t\\n"');
  });

  test("rejects every extra evaluator, identity, arm, instruction and model field", () => {
    for (const field of ["answer", "referenceAnswer", "gold", "has_answer", "answer_session_ids", "category",
      "questionType", "questionId", "caseId", "originalId", "arm", "judgeInput", "instructions", "messages", "model", "outputTokens"]) {
      expect(() => renderFrameworkPilotReaderV1({ ...fixture(), [field]: "SYNTHETIC_FORBIDDEN_VALUE" })).toThrow("unexpected input fields");
    }
    for (const field of Object.keys(fixture())) {
      const missing: Record<string, unknown> = fixture();
      delete missing[field];
      expect(() => renderFrameworkPilotReaderV1(missing)).toThrow("unexpected input fields");
      missing.gold = "SYNTHETIC_FORBIDDEN_VALUE";
      expect(() => renderFrameworkPilotReaderV1(missing)).toThrow("unexpected input fields");
    }
    for (const value of [null, undefined, true, 1, "", [], new Date(0), () => fixture()]) {
      expect(() => renderFrameworkPilotReaderV1(value)).toThrow("invalid input");
    }
    expect(() => renderFrameworkPilotReaderV1({ ...fixture(), protocol: "other" })).toThrow("invalid protocol");
  });

  test("rejects accessors, non-enumerable fields, symbols and inherited shapes without evaluating getters", () => {
    let reads = 0;
    for (const field of Object.keys(fixture())) {
      const accessor = Object.defineProperty(fixture(), field, { enumerable: true, get() { reads += 1; return "unread"; } });
      expect(() => renderFrameworkPilotReaderV1(accessor)).toThrow("invalid input property");
      const hidden = Object.defineProperty(fixture(), field, { enumerable: false });
      expect(() => renderFrameworkPilotReaderV1(hidden)).toThrow("invalid input property");
    }
    const extraAccessor = Object.defineProperty(fixture(), "gold", { get() { reads += 1; return "unread"; } });
    const inherited = Object.assign(Object.create({ gold: "unread" }), fixture());
    const symbol = { ...fixture(), [Symbol("gold")]: "unread" };
    for (const value of [extraAccessor, inherited, symbol]) expect(() => renderFrameworkPilotReaderV1(value)).toThrow();
    expect(reads).toBe(0);
  });

  test("rejects non-scalar strings and coercion without invoking value methods", () => {
    let calls = 0;
    const object = { toString() { calls += 1; return "coerced"; }, valueOf() { calls += 1; return 1; } };
    for (const field of ["question", "questionDate", "context", "contextSha256"]) {
      for (const value of [object, new String("boxed"), null, undefined, 1, true, [], "\ud800", "\udfff", "x\ud800x", "\udfff\ud800"]) {
        expect(() => renderFrameworkPilotReaderV1({ ...fixture(), [field]: value })).toThrow();
      }
    }
    expect(() => renderFrameworkPilotReaderV1({ ...fixture(), question: "" })).toThrow("empty question");
    expect(calls).toBe(0);
  });

  test("enforces UTF-8 byte limits at exact ASCII and multibyte boundaries", () => {
    for (const [field, maximum] of [["question", 16_384], ["questionDate", 256], ["context", 262_144]] as const) {
      for (const character of ["x", "é", "🧪"]) {
        const exact = character.repeat(maximum / Buffer.byteLength(character));
        const input = { ...fixture(), [field]: exact };
        if (field === "context") input.contextSha256 = hash(exact);
        expect(() => renderFrameworkPilotReaderV1(input)).not.toThrow();
        const overflow = { ...input, [field]: exact + "x" };
        if (field === "context") overflow.contextSha256 = hash(exact + "x");
        expect(() => renderFrameworkPilotReaderV1(overflow)).toThrow(`invalid ${field === "questionDate" ? "question date" : field}`);
      }
    }
    const question = "\0".repeat(16_384);
    const result = renderFrameworkPilotReaderV1({ ...fixture(), question });
    expect(result.messages[0].content).toContain(`"question":"${"\\u0000".repeat(16_384)}"`);
  });

  test("requires a matching raw UTF-8 context digest and a bounded canonical integer count", () => {
    for (const contextTokens of [-0, -1, 0.5, 8_193, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
      "1", 1n, true, null, undefined, {}]) {
      expect(() => renderFrameworkPilotReaderV1({ ...fixture(), contextTokens })).toThrow("invalid context-token count");
    }
    for (const contextSha256 of ["", "0".repeat(64), hash(fixtureContext).toUpperCase(), hash(fixtureContext) + "\n",
      "g".repeat(64), hash(JSON.stringify(fixtureContext)), hash(fixtureContext + "\n")]) {
      expect(() => renderFrameworkPilotReaderV1({ ...fixture(), contextSha256 })).toThrow("context digest mismatch");
    }
    const composed = "café", decomposed = "cafe\u0301";
    expect(() => renderFrameworkPilotReaderV1({ ...withContext(decomposed), contextSha256: hash(composed) })).toThrow("digest mismatch");
  });

  test("freezes all output structures and detaches caller changes", () => {
    const input = fixture(), result = renderFrameworkPilotReaderV1(input), message = result.messages[0].content;
    input.question = "changed";
    input.context = "changed";
    input.contextTokens = 1;
    expect(result.messages[0].content).toBe(message);
    expect(result.contextTokens).toBe(47);
    for (const value of [result, result.messages, result.messages[0], result.accounting, result.accounting.excludedFromContextTokenCount]) {
      expect(Object.isFrozen(value)).toBeTrue();
    }
  });

  test("preserves generated scalar strings and their exact digest identity", () => {
    const scalar = fc.oneof(fc.integer({ min: 0, max: 0xd7ff }), fc.integer({ min: 0xe000, max: 0x10ffff }));
    const string = fc.array(scalar, { maxLength: 80 }).map(points => String.fromCodePoint(...points));
    fc.assert(fc.property(string, string, (questionSuffix, context) => {
      const question = `Q${questionSuffix}`, result = renderFrameworkPilotReaderV1({ ...withContext(context), question, questionDate: "" });
      const prefix = `${FRAMEWORK_PILOT_READER_INSTRUCTION_V1}${questionDelimiter}${canonicalJson({ question, questionDate: "" })}${evidenceDelimiter}`;
      expect(result.messages[0].content).toBe(prefix + context);
      expect(result.contextSha256).toBe(hash(context));
      expect(result.contextBytes).toBe(Buffer.byteLength(context));
      expect(result.promptSha256).toBe(hash(prefix + context));
    }), { seed: 20260923, numRuns: 128 });
  });
});
