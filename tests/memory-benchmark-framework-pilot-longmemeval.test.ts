import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { FrameworkPilotJsonBytesV1 } from "../scripts/benchmarks/framework-pilot-json-bytes-v1";
import { FRAMEWORK_PILOT_LONGMEMEVAL_PIN_V1, projectFrameworkPilotLongMemEvalV1,
  writePinnedFrameworkPilotLongMemEvalV1 } from "../scripts/benchmarks/framework-pilot-longmemeval-v1";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const selection = (...questionIds: string[]) => ({ protocol: "oh.framework-pilot-longmemeval-selection.v1", questionIds });
function row(questionId = "original-question_abs") {
  return { question_id: questionId, question_type: "knowledge-update", question: "  Which object was stored?\n",
    question_date: "2026/04/01 (Wed) 01:02", answer: "FORBIDDEN_GOLD_VALUE", answer_session_ids: ["FORBIDDEN_ANSWER_SESSION"],
    excluded: { FORBIDDEN_NESTED_KEY: [false, 12, "FORBIDDEN_NESTED_VALUE"] },
    haystack_session_ids: ["source-answer-cue", "empty-occurrence", "source-answer-cue"],
    haystack_dates: ["2030-03-03", "2020-02-02", "2010-01-01"],
    haystack_sessions: [
      [{ role: "user", content: " Cafe\u0301\n{}[] quote \" slash \\ emoji 🧪\0", has_answer: true }],
      [], [{ role: "assistant", content: "", has_answer: false }, { role: "system", content: " Exact TEXT  ", has_answer: false }],
    ] };
}
function expectedFingerprint(raw: ReturnType<typeof row>): string {
  const hash = createHash("sha256").update(Buffer.from("oh.capacity.answer-blind-history.v1\0"));
  for (let index = 0; index < raw.haystack_sessions.length; index++) {
    // Independent literal key ordering matches the historical Python sort_keys preimage.
    const bytes = Buffer.from(JSON.stringify({ date: raw.haystack_dates[index], sessionId: raw.haystack_session_ids[index],
      turns: raw.haystack_sessions[index]!.map(turn => ({ content: turn.content, role: turn.role })) }));
    const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(bytes.length)); hash.update(length); hash.update(bytes);
  }
  return hash.digest("hex");
}

describe("framework pilot raw LongMemEval bridge", () => {
  test("preserves exact selected histories, questions and dates with separate original-ID joins", () => {
    const first = row("first-unselected"), second = row("second-original_abs"), third = row("third-original");
    third.question_type = "multi-session"; third.question = "Question stored third but selected first.";
    const bytes = encode([first, second, third]), result = projectFrameworkPilotLongMemEvalV1(bytes, selection(third.question_id, second.question_id));
    expect(result.source.datasetSha256).toBe(sha256Hex(bytes)); expect(result.source.datasetBytes).toBe(bytes.length);
    expect(result.source.datasetRows).toBe(3); expect(result.source.datasetProvenance).toBe("not-established-by-projection");
    expect(result.source.cases.map(value => value.caseId)).toEqual(["c0001", "c0002"]);
    expect(result.source.cases.map(value => value.query)).toEqual([
      { queryId: "q0001", text: third.question, questionDate: third.question_date },
      { queryId: "q0001", text: second.question, questionDate: second.question_date },
    ]);
    expect(result.privateMap.rows.map(value => [value.originalQuestionId, value.sourceRowIndex, value.questionType]))
      .toEqual([[third.question_id, 2, "multi-session"], [second.question_id, 1, "knowledge-update"]]);
    for (const [index, sourceCase] of result.source.cases.entries()) {
      expect(sourceCase.source.sessions.map(value => [value.sessionId, value.sessionIndex, value.date]))
        .toEqual([["s0001", 0, "2030-03-03"], ["s0002", 1, "2020-02-02"], ["s0001", 2, "2010-01-01"]]);
      expect(sourceCase.source.sessions.map(value => value.turns))
        .toEqual(second.haystack_sessions.map(turns => turns.map(turn => ({ role: turn.role, text: turn.content }))));
      expect(sourceCase.sourceSha256).toBe(canonicalSha256(sourceCase.source));
      expect(sourceCase.querySha256).toBe(canonicalSha256(sourceCase.query));
      expect(result.privateMap.rows[index]!.sessionAliases).toEqual([
        { originalSessionId: "source-answer-cue", sessionId: "s0001" },
        { originalSessionId: "empty-occurrence", sessionId: "s0002" },
      ]);
      expect(result.privateMap.rows[index]!.history).toEqual({ sessions: 3, turns: 3,
        rawContentUtf8Bytes: second.haystack_sessions.flat().reduce((sum, turn) => sum + Buffer.byteLength(turn.content), 0),
        answerBlindHistoryDigest: expectedFingerprint(index === 0 ? third : second) });
    }
    const safeJson = canonicalJson(result.source), privateJson = canonicalJson(result.privateMap);
    for (const value of ["original-question", "original_abs", "source-answer-cue", "empty-occurrence", "questionType", "originalQuestionId", "has_answer", "FORBIDDEN_"])
      expect(safeJson).not.toContain(value);
    expect(privateJson).not.toContain("FORBIDDEN_"); expect(privateJson).not.toContain(second.question);
    expect(result.source.decodedValueCounts).toEqual({ question_id: 3, question_type: 3, haystack_dates: 6,
      haystack_session_ids: 6, "haystack_sessions.role": 6, "haystack_sessions.content": 6, question: 2, question_date: 2 });
    expect(Object.isFrozen(result.source.cases[0]!.source.sessions[0]!.turns[0])).toBe(true);
    expect(Object.isFrozen(result.privateMap.rows[0]!.sessionAliases)).toBe(true);
  });

  test("never decodes excluded values, excluded nested keys or an unselected question", () => {
    const unselected = row("unselected"), selected = row("selected"); unselected.question = "FORBIDDEN_UNSELECTED_QUERY";
    const decoded: string[] = [], original = JSON.parse;
    const parse = spyOn(JSON, "parse").mockImplementation((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
      decoded.push(text); return original(text, reviver);
    });
    try {
      const result = projectFrameworkPilotLongMemEvalV1(encode([unselected, selected]), selection("selected"));
      expect(result.source.cases.length).toBe(1);
      expect(decoded.length).toBeGreaterThan(0);
      expect(decoded.every(value => value.startsWith('"') && value.endsWith('"'))).toBe(true);
      expect(decoded.some(value => value.includes("FORBIDDEN_"))).toBe(false);
      expect(decoded.some(value => value === "true" || value === "false")).toBe(false);
      expect(decoded).toContain('"question_id"'); expect(decoded).toContain(JSON.stringify(selected.question));
    } finally { parse.mockRestore(); }
  });

  test("whole-input validation rejects malformed excluded values before any scalar decoding", () => {
    const fixture = JSON.stringify([row("unselected"), row("selected")]);
    const invalid = ["NaN", "undefined", "+1", "01", "1.", "1e+", "-", ".5", "truefalse", "[1,]", '{"x":1,}',
      '{"x" 1}', '{"x":1 "y":2}', '{"x":1,"\\u0078":2}', '"\\q"', '"\\uD800"', '"\\uDC00"', '"\\uD800\\u1234"',
      '"\\u12xx"', '"raw\nnewline"', "[".repeat(34) + "0" + "]".repeat(34)];
    const parse = spyOn(JSON, "parse");
    try {
      for (const value of invalid) {
        const bytes = Buffer.from(fixture.replace('"FORBIDDEN_GOLD_VALUE"', value));
        expect(() => projectFrameworkPilotLongMemEvalV1(bytes, selection("selected"))).toThrow();
      }
      expect(parse).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
  });

  test("detects malformed UTF-8 in an excluded value without decoding it", () => {
    const fixture = encode([row()]), marker = Buffer.from("FORBIDDEN_GOLD_VALUE"), offset = fixture.indexOf(marker);
    const invalid = [[0x80], [0xff], [0xc0, 0xaf], [0xe0, 0x80, 0xaf], [0xed, 0xa0, 0x80],
      [0xf0, 0x80, 0x80, 0xaf], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82], [0x00]];
    for (const value of invalid) {
      const bytes = Buffer.concat([fixture.subarray(0, offset), Buffer.from(value), fixture.subarray(offset + marker.length)]);
      expect(() => projectFrameworkPilotLongMemEvalV1(bytes, selection(row().question_id))).toThrow();
    }
  });

  test("bounds and authenticates selection shape before scanning source bytes", () => {
    let reads = 0;
    const accessor = { protocol: "oh.framework-pilot-longmemeval-selection.v1", get questionIds() { reads++; return ["a"]; } };
    const invalid: unknown[] = [accessor, { ...selection("a"), gold: true }, selection("a", "a"), selection(),
      selection(...Array.from({ length: 61 }, (_, index) => `id${index}`)), selection("x".repeat(513)), selection("\ud800"),
      { protocol: "oh.framework-pilot-longmemeval-selection.v1", questionIds: Array(1) }];
    for (const value of invalid) expect(() => projectFrameworkPilotLongMemEvalV1(Buffer.from("not json"), value)).toThrow("LongMemEval");
    expect(reads).toBe(0);
  });

  test("requires complete unambiguous membership and aligned source occurrences", () => {
    expect(() => projectFrameworkPilotLongMemEvalV1(encode([row("a")]), selection("b"))).toThrow("membership");
    expect(() => projectFrameworkPilotLongMemEvalV1(encode([row("a"), row("a")]), selection("a"))).toThrow("duplicate row");
    const invalid = [row(), row(), row(), row(), row()];
    invalid[0]!.haystack_dates.pop(); invalid[1]!.haystack_session_ids.pop();
    invalid[2]!.haystack_sessions = []; invalid[3]!.question_type = "unknown";
    invalid[4]!.haystack_sessions = [[], [], []];
    for (const value of invalid) expect(() => projectFrameworkPilotLongMemEvalV1(encode([value]), selection(value.question_id))).toThrow();
    const missing = { ...row(), question_date: undefined };
    expect(() => projectFrameworkPilotLongMemEvalV1(encode([missing]), selection(missing.question_id))).toThrow("required raw field");
  });

  test("bounds rows, source turns/scalars and question bytes without truncation", () => {
    const manyRows = Array.from({ length: 501 }, (_, index) => row(`q${index}`));
    expect(() => projectFrameworkPilotLongMemEvalV1(encode(manyRows), selection("q0"))).toThrow("array item bound");
    const largeText = row(); largeText.haystack_sessions[0]![0]!.content = "x".repeat(524_289);
    const largeQuery = row(); largeQuery.question = "x".repeat(16_385);
    const manyTurns = row(); manyTurns.haystack_sessions[0] = Array.from({ length: 8_192 }, () => ({ role: "user", content: "", has_answer: false }));
    for (const value of [largeText, largeQuery, manyTurns]) expect(() => projectFrameworkPilotLongMemEvalV1(encode([value]), selection(value.question_id))).toThrow("bound");
    const manySessions = row(); manySessions.haystack_dates = Array.from({ length: 1_001 }, () => "");
    expect(() => projectFrameworkPilotLongMemEvalV1(encode([manySessions]), selection(manySessions.question_id))).toThrow("array item bound");
  });

  test("file activation has immutable pins, rejects unpinned inputs and creates no partial output", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-raw-source-test-"))); directories.push(directory);
    const manifest = join(directory, "selection.json"), output = join(directory, "output");
    await writeFile(manifest, "{}", { mode: 0o600 });
    expect(FRAMEWORK_PILOT_LONGMEMEVAL_PIN_V1).toMatchObject({ bytes: 277_383_467, selectedRows: 60, rows: 500 });
    expect(Object.isFrozen(FRAMEWORK_PILOT_LONGMEMEVAL_PIN_V1)).toBe(true);
    await expect(writePinnedFrameworkPilotLongMemEvalV1({ datasetPath: join(directory, "does-not-exist"),
      selectionManifestPath: manifest, outputDirectory: output })).rejects.toThrow("pinned file type or size");
    expect(await readdir(directory)).toEqual(["selection.json"]);
    await writeFile(manifest, Buffer.alloc(FRAMEWORK_PILOT_LONGMEMEVAL_PIN_V1.selectionBytes, 32));
    await expect(writePinnedFrameworkPilotLongMemEvalV1({ datasetPath: join(directory, "does-not-exist"),
      selectionManifestPath: manifest, outputDirectory: output })).rejects.toThrow("digest or byte count");
    await symlink(manifest, join(directory, "linked.json"));
    await expect(writePinnedFrameworkPilotLongMemEvalV1({ datasetPath: join(directory, "does-not-exist"),
      selectionManifestPath: join(directory, "linked.json"), outputDirectory: output })).rejects.toThrow("symlink or path mismatch");
    await mkdir(output);
    await expect(writePinnedFrameworkPilotLongMemEvalV1({ datasetPath: join(directory, "does-not-exist"),
      selectionManifestPath: manifest, outputDirectory: output })).rejects.toThrow("already exists");
    expect(await readdir(output)).toEqual([]);
    await expect(writePinnedFrameworkPilotLongMemEvalV1({ datasetPath: "relative", selectionManifestPath: manifest, outputDirectory: output }))
      .rejects.toThrow("canonical absolute");
  });
});

describe("framework pilot non-materializing JSON byte validation", () => {
  test("recognizes equivalent escaped keys and rejects duplicates even in skipped subtrees", () => {
    for (const value of ['{"a":1,"\\u0061":2}', '{"🧪":1,"\\uD83E\\uDDEA":2}', '{"\\n":1,"\\u000a":2}',
      '{"outer":{"x":false,"x":true}}']) expect(() => new FrameworkPilotJsonBytesV1(Buffer.from(value))).toThrow("duplicate");
    const scanner = new FrameworkPilotJsonBytesV1(Buffer.from('{"\\u0078":"escaped \\uD83E\\uDDEA","x2":[]}'));
    const fields = scanner.objectFields(scanner.root);
    expect(scanner.text(fields.get("x")!, 64)).toBe("escaped 🧪");
    expect(scanner.arrayItems(fields.get("x2")!, 1)).toEqual([]);
  });

  test("has private immutable byte custody and rejects invented or cross-scanner spans", () => {
    const raw = Buffer.from('["unchanged"]'), scanner = new FrameworkPilotJsonBytesV1(raw), before = scanner.sha256;
    raw.fill(32); const span = scanner.arrayItems(scanner.root, 1)[0]!;
    expect(scanner.text(span, 64)).toBe("unchanged"); expect(scanner.sha256).toBe(before);
    expect(() => scanner.text({ ...span }, 64)).toThrow("issued span");
    const foreign = new FrameworkPilotJsonBytesV1(Buffer.from('"foreign"'));
    expect(() => scanner.text(foreign.root, 64)).toThrow("issued span");
    expect(() => new FrameworkPilotJsonBytesV1(new Uint8Array(new SharedArrayBuffer(8)))).toThrow("private byte input");
  });

  test("validates complete grammar and key/depth bounds without materializing primitive values", () => {
    for (const raw of ["true", "false", "null", "-0", "1e400", "-1.25e-02", "{}", "[]", '"\\b\\f\\n\\r\\t\\/\\\\\\\""'])
      expect(new FrameworkPilotJsonBytesV1(Buffer.from(` \t${raw}\r\n`)).bytes).toBe(Buffer.byteLength(raw) + 4);
    for (const raw of ["", " ", "[] []", "[}", "{]", '"unterminated', "[0 1]", '{"x":}', "[1,]", "{}x", "00", "1e", "[+1]"])
      expect(() => new FrameworkPilotJsonBytesV1(Buffer.from(raw))).toThrow();
    const key = "k".repeat(1_024);
    const boundedKeyScanner = new FrameworkPilotJsonBytesV1(encode({ [key]: 0 }));
    expect([...boundedKeyScanner.objectFields(boundedKeyScanner.root).keys()]).toEqual([key]);
    expect(() => new FrameworkPilotJsonBytesV1(encode({ [key + "k"]: 0 }))).toThrow("key byte bound");
    const object = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, 0]));
    expect(() => new FrameworkPilotJsonBytesV1(encode(object))).toThrow("key count");
    expect(() => new FrameworkPilotJsonBytesV1(Buffer.from("[".repeat(34) + "0" + "]".repeat(34)))).toThrow("structure bound");
    expect(() => new FrameworkPilotJsonBytesV1(Buffer.from("1".repeat(129)))).toThrow("number byte bound");
  });

  test("literal and escaped scalar keys have the same duplicate identity across Unicode", () => {
    const scalar = fc.integer({ min: 0, max: 0x10ffff }).filter(value => value < 0xd800 || value > 0xdfff);
    fc.assert(fc.property(fc.array(scalar, { maxLength: 20 }), values => {
      const key = String.fromCodePoint(...values), literal = JSON.stringify(key);
      let escaped = '"';
      for (let index = 0; index < key.length; index++) escaped += `\\u${key.charCodeAt(index).toString(16).padStart(4, "0")}`;
      escaped += '"';
      expect(() => new FrameworkPilotJsonBytesV1(Buffer.from(`{${literal}:0,${escaped}:1}`))).toThrow("duplicate");
      const scanner = new FrameworkPilotJsonBytesV1(Buffer.from(`{"selected":${escaped}}`));
      expect(scanner.text(scanner.objectFields(scanner.root).get("selected")!, 256)).toBe(key);
    }), { numRuns: 128, seed: 20260923 });
  });
});
