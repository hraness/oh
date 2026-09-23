import { describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256 } from "../src/canonical";
import { createFrameworkPilotSourceUnitsV1, FRAMEWORK_PILOT_SOURCE_LIMITS_V1 as limits,
  FRAMEWORK_PILOT_SOURCE_V1, FRAMEWORK_PILOT_SPLIT_PLAN_V1, parseFrameworkPilotSourceV1,
  validateFrameworkPilotSourceUnitsV1 } from "../scripts/benchmarks/framework-pilot-source-v1";

function source() {
  return { protocol: FRAMEWORK_PILOT_SOURCE_V1, sessions: [
    { sessionId: "s0001", sessionIndex: 0, date: "2025/03/01 12:00", turns: [
      { role: "user", text: " A🦀e\u0301é\n\0Z " }, { role: "assistant", text: "" },
    ] },
    { sessionId: "s0002", sessionIndex: 1, date: "", turns: [] },
    { sessionId: "s0001", sessionIndex: 2, date: "2025/01/01 08:00", turns: [
      { role: "user", text: 'Authored answer_example_abs and "quotes" stay verbatim.\r\n' },
    ] },
  ] };
}
function planFor(input = source()) {
  return { protocol: FRAMEWORK_PILOT_SPLIT_PLAN_V1, sourceSha256: canonicalSha256(input),
    turns: input.sessions.flatMap(session => session.turns.map((turn, turnIndex) => ({
      turnId: `${session.sessionId}#${session.sessionIndex}:${turnIndex}`,
      spans: [{ startByte: 0, endByte: Buffer.byteLength(turn.text) }],
    }))) };
}
function splitFixture() {
  const input = source(), plan = planFor(input);
  plan.turns[0]!.spans = [{ startByte: 0, endByte: 6 }, { startByte: 6, endByte: 9 }, { startByte: 9, endByte: 15 }];
  return { input, plan };
}
function mutableBundle() {
  const { input, plan } = splitFixture();
  return { input, plan, bundle: JSON.parse(JSON.stringify(createFrameworkPilotSourceUnitsV1(input, plan))) };
}
function rehash(bundle: ReturnType<typeof mutableBundle>["bundle"]) {
  bundle.units = bundle.units.map((unit: Record<string, unknown>) => {
    const { unitSha256: _digest, ...payload } = unit;
    return { ...payload, unitSha256: canonicalSha256(payload) };
  });
  const { bundleSha256: _digest, ...payload } = bundle;
  bundle.bundleSha256 = canonicalSha256(payload);
  return bundle;
}

describe("framework pilot answer-blind source units", () => {
  test("preserves exact authored fields, source order, empty structures and session equivalence", () => {
    const { input, plan } = splitFixture(), parsed = parseFrameworkPilotSourceV1(input);
    const bundle = createFrameworkPilotSourceUnitsV1(parsed, plan);
    expect(parsed).toEqual(input);
    expect(bundle).toMatchObject({ sessionCount: 3, sessionClassCount: 2, turnCount: 3, unitCount: 5,
      sourceTextBytes: 15 + Buffer.byteLength(input.sessions[2]!.turns[0]!.text),
      sourceSha256: canonicalSha256(input), splitPlanSha256: canonicalSha256(plan) });
    expect(bundle.units.map(unit => unit.text)).toEqual([" A🦀", "e\u0301", "é\n\0Z ", "", input.sessions[2]!.turns[0]!.text]);
    expect(bundle.units.map(unit => unit.unitId)).toEqual(["u000001", "u000002", "u000003", "u000004", "u000005"]);
    expect(bundle.units.map(unit => unit.turnId)).toEqual(["s0001#0:0", "s0001#0:0", "s0001#0:0", "s0001#0:1", "s0001#2:0"]);
    expect(bundle.occurrences).toEqual([
      { sessionId: "s0001", sessionIndex: 0, date: "2025/03/01 12:00", turnCount: 2 },
      { sessionId: "s0002", sessionIndex: 1, date: "", turnCount: 0 },
      { sessionId: "s0001", sessionIndex: 2, date: "2025/01/01 08:00", turnCount: 1 },
    ]);
    expect(bundle.units.map(unit => [unit.sessionId, unit.sessionIndex, unit.turnIndex, unit.partIndex])).toEqual([
      ["s0001", 0, 0, 0], ["s0001", 0, 0, 1], ["s0001", 0, 0, 2], ["s0001", 0, 1, 0], ["s0001", 2, 0, 0],
    ]);
    for (const session of input.sessions) for (const [turnIndex, turn] of session.turns.entries()) {
      const units = bundle.units.filter(unit => unit.sessionIndex === session.sessionIndex && unit.turnIndex === turnIndex);
      expect(units.map(unit => unit.text).join("")).toBe(turn.text);
      for (const unit of units) {
        expect([unit.role, unit.date]).toEqual([turn.role, session.date]);
        expect(Buffer.byteLength(unit.text)).toBe(unit.endByte - unit.startByte);
      }
    }
    expect(bundle.units[0]!.date > bundle.units[4]!.date).toBeTrue(); // No chronological resort.
    expect(bundle.units[1]!.text).not.toBe(bundle.units[1]!.text.normalize("NFC"));
    expect(bundle.units[3]).toMatchObject({ startByte: 0, endByte: 0, role: "assistant", text: "" });
    expect(validateFrameworkPilotSourceUnitsV1(bundle, input, plan)).toEqual(bundle);
    expect(canonicalJson(bundle)).not.toContain("token");
  });

  test("uses canonical identities, detached immutable output, and changes identity with content or splits", () => {
    const { input, plan } = splitFixture(), bundle = createFrameworkPilotSourceUnitsV1(input, plan);
    for (const unit of bundle.units) {
      const { unitSha256, ...payload } = unit;
      expect(unitSha256).toBe(canonicalSha256(payload));
      expect(Object.isFrozen(unit)).toBeTrue();
    }
    const { bundleSha256, ...payload } = bundle;
    expect(bundleSha256).toBe(canonicalSha256(payload));
    expect(Object.isFrozen(bundle)).toBeTrue();
    expect(Object.isFrozen(bundle.units)).toBeTrue();
    expect(Object.isFrozen(bundle.occurrences[1])).toBeTrue();
    const parsed = parseFrameworkPilotSourceV1(input);
    expect(Object.isFrozen(parsed.sessions[0]!.turns[0])).toBeTrue();
    input.sessions[0]!.turns[0]!.text = "changed";
    expect(parsed.sessions[0]!.turns[0]!.text).toBe(" A🦀e\u0301é\n\0Z ");
    expect(() => createFrameworkPilotSourceUnitsV1(input, plan)).toThrow("source binding");
    const changed = createFrameworkPilotSourceUnitsV1(input, planFor(input));
    expect(changed.sourceSha256).not.toBe(bundle.sourceSha256);
    expect(changed.bundleSha256).not.toBe(bundle.bundleSha256);
    const unsplit = createFrameworkPilotSourceUnitsV1(source(), planFor());
    expect(unsplit.sourceSha256).toBe(bundle.sourceSha256);
    expect(unsplit.splitPlanSha256).not.toBe(bundle.splitPlanSha256);
    expect(unsplit.bundleSha256).not.toBe(bundle.bundleSha256);
    const reorderedKeys = { sessions: source().sessions, protocol: FRAMEWORK_PILOT_SOURCE_V1 };
    expect(createFrameworkPilotSourceUnitsV1(reorderedKeys, planFor()).bundleSha256).toBe(unsplit.bundleSha256);
  });

  test("requires the explicit projection and rejects label-shaped or spoofed metadata at every input level", () => {
    for (const key of ["answer", "question", "question_id", "category", "corpusId", "groupId", "metadata", "tokenizer"]) {
      expect(() => parseFrameworkPilotSourceV1({ ...source(), [key]: "SYNTHETIC_GOLD" })).toThrow();
    }
    const withSessionGold = source(); Object.assign(withSessionGold.sessions[0]!, { answer_session_ids: ["s0001"] });
    expect(() => parseFrameworkPilotSourceV1(withSessionGold)).toThrow();
    for (const key of ["has_answer", "id", "turnId", "sourceContentSha256", "unitSha256", "tokenCount"]) {
      const input = source(); Object.assign(input.sessions[0]!.turns[0]!, { [key]: true });
      expect(() => parseFrameworkPilotSourceV1(input)).toThrow();
    }
    expect(() => parseFrameworkPilotSourceV1({ id: "raw_abs", groupId: "raw", turns: [] })).toThrow();
    for (const alias of ["answer_named_abs", "s0000", "s0002", "s1", "s0001_abs", "s00001"]) {
      const input = source(); input.sessions[0]!.sessionId = alias;
      expect(() => parseFrameworkPilotSourceV1(input)).toThrow();
    }
    const renamedRepeat = source(); renamedRepeat.sessions[2]!.sessionId = "s0004";
    expect(() => parseFrameworkPilotSourceV1(renamedRepeat)).toThrow("first occurrence");
  });

  test("rejects accessors, non-JSON properties, sparse arrays and non-plain objects without reading getters", () => {
    let reads = 0;
    for (const key of ["answer", "sessions"]) {
      const input = source(); Object.defineProperty(input, key, { enumerable: true, get() { reads++; throw new Error("getter read"); } });
      expect(() => parseFrameworkPilotSourceV1(input)).toThrow();
    }
    const turnGetter = source(); Object.defineProperty(turnGetter.sessions[0]!.turns[0], "text", { enumerable: true, get() { reads++; return "bad"; } });
    expect(() => parseFrameworkPilotSourceV1(turnGetter)).toThrow();
    const arrayGetter = source(); Object.defineProperty(arrayGetter.sessions, "0", { enumerable: true, get() { reads++; return null; } });
    expect(() => parseFrameworkPilotSourceV1(arrayGetter)).toThrow();
    expect(reads).toBe(0);
    const hidden = source(); Object.defineProperty(hidden, "answer", { value: "hidden" });
    expect(() => parseFrameworkPilotSourceV1(hidden)).toThrow();
    const symbol = source(); Object.assign(symbol, { [Symbol("answer")]: "hidden" });
    expect(() => parseFrameworkPilotSourceV1(symbol)).toThrow();
    const sparse = source(); delete sparse.sessions[1];
    expect(() => parseFrameworkPilotSourceV1(sparse)).toThrow();
    const arrayExtra = source(); Object.assign(arrayExtra.sessions, { answer: "hidden" });
    expect(() => parseFrameworkPilotSourceV1(arrayExtra)).toThrow();
    const inherited = Object.create(source());
    expect(() => parseFrameworkPilotSourceV1(inherited)).toThrow();
    expect(() => parseFrameworkPilotSourceV1(null)).toThrow();
  });

  test("rejects invalid scalar text, counts, empty sources and bounds without truncating", () => {
    for (const value of [NaN, Infinity, -Infinity, -0, -1, 0.5, Number.MAX_SAFE_INTEGER, "0"]) {
      const input = source(); Object.assign(input.sessions[0]!, { sessionIndex: value });
      expect(() => parseFrameworkPilotSourceV1(input)).toThrow();
    }
    for (const field of ["role", "text"] as const) for (const value of ["\ud800", "\udfff"]) {
      const input = source(); input.sessions[0]!.turns[0]![field] = value;
      expect(() => parseFrameworkPilotSourceV1(input)).toThrow("Unicode");
    }
    const badDate = source(); badDate.sessions[0]!.date = "\ud800";
    expect(() => parseFrameworkPilotSourceV1(badDate)).toThrow("Unicode");
    const empty = source(); empty.sessions = [];
    expect(() => parseFrameworkPilotSourceV1(empty)).toThrow("session");
    const noTurns = source(); noTurns.sessions.forEach(session => { session.turns = []; });
    expect(() => parseFrameworkPilotSourceV1(noTurns)).toThrow("turn");
    const role = source(); role.sessions[0]!.turns[0]!.role = "";
    expect(() => parseFrameworkPilotSourceV1(role)).toThrow();
    for (const [field, maximum] of [["role", limits.maximumRoleBytes], ["text", limits.maximumTurnBytes]] as const) {
      const input = source(); input.sessions[0]!.turns[0]![field] = "x".repeat(maximum + 1);
      expect(() => parseFrameworkPilotSourceV1(input)).toThrow();
    }
    const date = source(); date.sessions[0]!.date = "x".repeat(limits.maximumDateBytes + 1);
    expect(() => parseFrameworkPilotSourceV1(date)).toThrow();
    const tooManySessions = source(); tooManySessions.sessions = Array(limits.maximumSessions + 1).fill(source().sessions[0]);
    expect(() => parseFrameworkPilotSourceV1(tooManySessions)).toThrow("limit");
    const tooManyTurns = source(); tooManyTurns.sessions[0]!.turns = Array(limits.maximumTurns).fill({ role: "user", text: "" });
    expect(() => parseFrameworkPilotSourceV1(tooManyTurns)).toThrow("total turn limit");
    const encodedBound = source(); encodedBound.sessions[0]!.turns = Array(11).fill({ role: "user", text: "\0".repeat(limits.maximumTurnBytes) });
    expect(() => parseFrameworkPilotSourceV1(encodedBound)).toThrow("canonical byte limit");
  });

  test("requires complete ordered source-bound plans and rejects gaps, overlaps and partial UTF-8 characters", () => {
    const badSpans = [[], [{ startByte: 1, endByte: 15 }], [{ startByte: 0, endByte: 14 }],
      [{ startByte: 0, endByte: 6 }, { startByte: 7, endByte: 15 }],
      [{ startByte: 0, endByte: 6 }, { startByte: 5, endByte: 15 }],
      [{ startByte: 0, endByte: 3 }, { startByte: 3, endByte: 15 }], // Inside the crab.
      [{ startByte: 0, endByte: 8 }, { startByte: 8, endByte: 15 }], // Inside the combining mark.
      [{ startByte: 0, endByte: 0 }, { startByte: 0, endByte: 15 }],
      [{ startByte: 6, endByte: 15 }, { startByte: 0, endByte: 6 }],
      [{ startByte: 0, endByte: 16 }]];
    for (const spans of badSpans) {
      const { input, plan } = splitFixture(); plan.turns[0]!.spans = spans;
      expect(() => createFrameworkPilotSourceUnitsV1(input, plan)).toThrow();
    }
    for (const bad of [NaN, Infinity, -0, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
      const { input, plan } = splitFixture(); plan.turns[0]!.spans[0]!.endByte = bad;
      expect(() => createFrameworkPilotSourceUnitsV1(input, plan)).toThrow();
    }
    for (const change of ["omit", "duplicate", "reorder", "foreign", "stale"] as const) {
      const { input, plan } = splitFixture();
      if (change === "omit") plan.turns.pop();
      if (change === "duplicate") plan.turns[1] = structuredClone(plan.turns[0]!);
      if (change === "reorder") plan.turns.reverse();
      if (change === "foreign") plan.turns[0]!.turnId = "answer_fake_abs:0";
      if (change === "stale") plan.sourceSha256 = "0".repeat(64);
      expect(() => createFrameworkPilotSourceUnitsV1(input, plan)).toThrow();
    }
    const empty = splitFixture(); empty.plan.turns[1]!.spans.push({ startByte: 0, endByte: 0 });
    expect(() => createFrameworkPilotSourceUnitsV1(empty.input, empty.plan)).toThrow("empty turn");
  });

  test("bounds split counts and rejects hidden metadata in the plan", () => {
    const tooMany = splitFixture(); tooMany.plan.turns[0]!.spans = Array(limits.maximumSpansPerTurn + 1).fill({ startByte: 0, endByte: 1 });
    expect(() => createFrameworkPilotSourceUnitsV1(tooMany.input, tooMany.plan)).toThrow("limit");
    const input = source(); input.sessions = [{ sessionId: "s0001", sessionIndex: 0, date: "", turns: Array(33).fill({ role: "user", text: "x".repeat(1024) }) }];
    const plan = planFor(input);
    plan.turns.forEach(turn => { turn.spans = Array.from({ length: 1024 }, (_, index) => ({ startByte: index, endByte: index + 1 })); });
    expect(() => createFrameworkPilotSourceUnitsV1(input, plan)).toThrow("total span count");
    for (const level of ["plan", "turn", "span"] as const) {
      const { input, plan } = splitFixture();
      Object.assign(level === "plan" ? plan : level === "turn" ? plan.turns[0]! : plan.turns[0]!.spans[0]!, { answer: "hidden" });
      expect(() => createFrameworkPilotSourceUnitsV1(input, plan)).toThrow("unknown");
    }
  });

  test("rejects rehashed fabricated metadata, omission, duplication and reordering against the supplied source", () => {
    for (const field of ["role", "date", "text", "unitId", "turnId", "sessionId", "sessionIndex", "turnIndex", "partIndex", "startByte", "endByte"] as const) {
      const { input, plan, bundle } = mutableBundle();
      bundle.units[0][field] = typeof bundle.units[0][field] === "number" ? 1 : "changed";
      expect(() => validateFrameworkPilotSourceUnitsV1(rehash(bundle), input, plan)).toThrow();
    }
    for (const change of ["omit", "duplicate", "reorder"] as const) {
      const { input, plan, bundle } = mutableBundle();
      if (change === "omit") { bundle.units.pop(); bundle.unitCount--; }
      if (change === "duplicate") bundle.units[1] = structuredClone(bundle.units[0]);
      if (change === "reorder") bundle.units.reverse();
      expect(() => validateFrameworkPilotSourceUnitsV1(rehash(bundle), input, plan)).toThrow();
    }
    const extra = mutableBundle(); extra.bundle.units[0].has_answer = true;
    expect(() => validateFrameworkPilotSourceUnitsV1(rehash(extra.bundle), extra.input, extra.plan)).toThrow();
    const emptySession = mutableBundle(); emptySession.bundle.occurrences[1].date = "fabricated";
    expect(() => validateFrameworkPilotSourceUnitsV1(rehash(emptySession.bundle), emptySession.input, emptySession.plan)).toThrow();
    const wrongSource = mutableBundle(); wrongSource.input.sessions[2]!.turns[0]!.text = "another source";
    expect(() => validateFrameworkPilotSourceUnitsV1(wrongSource.bundle, wrongSource.input, planFor(wrongSource.input))).toThrow();
  });
});
