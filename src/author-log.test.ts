import { describe, expect, test } from "bun:test";

import { utf8ByteLength } from "./canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "./graph";
import { defaultOhAuthorLogViewV1, isOhDeclineAnswerV1, OH_AUTHOR_LOG_READER_NOTE_V1, OH_AUTHOR_LOG_RENDERER_V1,
  renderOhAuthorLogV1, renderOhSessionZoomV1 } from "./author-log";
import { resolveRelativeDatesV1 } from "./recall";

const record = (key: string, value: unknown): KnowledgeGraphRecordV1 =>
  createKnowledgeGraphRecordV1({ dependencies: [], key, kind: "edition", v: 1, value: value as never });
const turn = (key: string, observedAt: string, sessionId: string, sessionIndex: number, speaker: string, text: string) =>
  record(key, { observedAt, sessionId, sessionIndex, speaker, text });
const ranked = (...records: KnowledgeGraphRecordV1[]) => records.map((item) => ({ record: item }));

const U1 = turn("t:u1", "2023-05-04T10:00:00.000Z", "s1", 0, "user", "I bought a crimson kayak yesterday.");
const A1 = turn("t:a1", "2023-05-04T10:01:00.000Z", "s1", 1, "assistant", "Crimson kayaks are easy to spot on the water.");
const U2 = turn("t:u2", "2023-05-20T09:00:00.000Z", "s2", 0, "user", "My bicycle is turquoise.");
const A2 = turn("t:a2", "2023-05-20T09:01:00.000Z", "s2", 1, "assistant", "Turquoise frames suit a city bike.");
const RECORDS = [A2, U2, A1, U1];
const AS_OF = "2023-05-30T12:00:00.000Z";

describe("renderOhAuthorLogV1", () => {
  test("renders the complete author log chronologically with resolved dates and the retrieved replies", () => {
    const rendering = renderOhAuthorLogV1({ ranked: ranked(A2, U2, A1), records: RECORDS }, { asOf: AS_OF });
    expect(rendering.renderer).toBe(OH_AUTHOR_LOG_RENDERER_V1);
    expect(rendering.log).toEqual({ bytes: expect.any(Number), included: 2, mode: "complete", total: 2 });
    expect(rendering.retrieved.included).toBe(2);
    expect(rendering.keys).toEqual(["t:u1", "t:u2", "t:a2", "t:a1"]);
    const text = rendering.text;
    expect(text.indexOf("[t:u1] user:")).toBeLessThan(text.indexOf("[t:u2] user:"));
    expect(text).toContain("## Session s1: 2023/05/04 (Thu), 26 days before the question");
    expect(text).toContain("\"yesterday\" = 2023/05/03 (Wed)");
    expect(text).toContain("[t:a2] [2023/05/20 (Sat)] assistant (follows [t:u2]): Turquoise frames");
    expect(text).not.toContain("[t:u2] [2023");
    expect(rendering.bytes).toBe(utf8ByteLength(text));
    expect(rendering.sharedTimestamp).toBe(false);
  });

  test("is deterministic under record order", () => {
    const a = renderOhAuthorLogV1({ ranked: ranked(A1), records: RECORDS }, { asOf: AS_OF });
    const b = renderOhAuthorLogV1({ ranked: ranked(A1), records: [...RECORDS].reverse() }, { asOf: AS_OF });
    expect(a).toEqual(b);
  });

  test("falls back to a ranked partial log under a small budget and never exceeds the budget", () => {
    const many = Array.from({ length: 40 }, (_, index) => turn(`t:m${String(index).padStart(2, "0")}`,
      `2023-05-${String(1 + (index % 28)).padStart(2, "0")}T10:00:00.000Z`, `s${index}`, 0, "user", `Note ${index} ${"x".repeat(200)}`));
    const rendering = renderOhAuthorLogV1({ ranked: ranked(many[3] as KnowledgeGraphRecordV1), records: many },
      { asOf: AS_OF, budgetBytes: 3_000, logReserveBytes: 500, retrievedBytes: 500 });
    expect(rendering.log.mode).toBe("ranked");
    expect(rendering.log.included).toBeLessThan(40);
    expect(rendering.keys).toContain("t:m03");
    expect(rendering.text).toContain(`# Partial log of user messages: ${rendering.log.included} of 40 messages`);
    expect(rendering.bytes).toBeLessThanOrEqual(3_000);
  });

  test("notes a shared timestamp and respects a configured author", () => {
    const shared = [turn("k:1", "2023-01-01T00:00:00.000Z", "a", 0, "me", "Hello."),
      turn("k:2", "2023-01-01T00:00:00.000Z", "b", 0, "bot", "Hi.")];
    const rendering = renderOhAuthorLogV1({ ranked: ranked(...shared), records: shared }, { asOf: null, author: "me" });
    expect(rendering.sharedTimestamp).toBe(true);
    expect(rendering.text).toContain("same timestamp");
    expect(rendering.text).toContain("[k:1] me: Hello.");
    expect(rendering.keys).toEqual(["k:1", "k:2"]);
  });

  test("rejects invalid options and views", () => {
    expect(() => renderOhAuthorLogV1({ ranked: [], records: RECORDS }, { asOf: AS_OF, author: "" })).toThrow(TypeError);
    expect(() => renderOhAuthorLogV1({ ranked: [], records: RECORDS }, { asOf: AS_OF, budgetBytes: 0 })).toThrow(RangeError);
    expect(() => renderOhAuthorLogV1({ ranked: [], records: RECORDS }, { asOf: "yesterday" })).toThrow();
    expect(() => renderOhAuthorLogV1({ ranked: [], records: RECORDS },
      { asOf: AS_OF, view: () => ({ text: "x" }) as never })).toThrow(TypeError);
  });

  test("the default view reads turn and recall records", () => {
    expect(defaultOhAuthorLogViewV1(U1)).toEqual({ instant: "2023-05-04T10:00:00.000Z", order: 0, session: "s1", speaker: "user",
      text: "I bought a crimson kayak yesterday." });
    expect(defaultOhAuthorLogViewV1(record("r:1", { date: "2023-02-03", role: "user", text: "x" })).instant).toBe("2023-02-03T00:00:00.000Z");
    expect(defaultOhAuthorLogViewV1(record("r:2", 7)).session).toBe("r:2");
  });

  test("the reader note is a layout description without examples", () => {
    expect(OH_AUTHOR_LOG_READER_NOTE_V1).not.toMatch(/\$\d|e\.g\.|for example/iu);
  });
});

describe("resolveRelativeDatesV1", () => {
  test("returns every admitted expression in text order, anchored on the message instant", () => {
    const windows = resolveRelativeDatesV1("Yesterday I ran, and two weeks ago I swam.", "2023-05-10T12:00:00.000Z");
    expect(windows.map((window) => window.expression.toLowerCase())).toEqual(["yesterday", "two weeks ago"]);
    expect(windows[0]?.since.slice(0, 10)).toBe("2023-05-09");
    expect(resolveRelativeDatesV1("No dates here.", "2023-05-10T12:00:00.000Z")).toEqual([]);
    expect(() => resolveRelativeDatesV1("yesterday", "2023-05-10")).toThrow();
  });
});

describe("decline re-read", () => {
  test("detects decline phrasing only", () => {
    expect(isOhDeclineAnswerV1("The history does not contain enough information to answer.")).toBe(true);
    expect(isOhDeclineAnswerV1("It was not mentioned in the conversation.")).toBe(true);
    expect(isOhDeclineAnswerV1("Your kayak is crimson.")).toBe(false);
  });

  test("zooms whole sessions by question date, lexical overlap and rank within the budget", () => {
    const zoom = renderOhSessionZoomV1({ question: "What colour is my bicycle?", ranked: ranked(A1), records: RECORDS },
      { asOf: AS_OF });
    expect(zoom.sessions).toEqual(["s1", "s2"]);
    expect(zoom.keys).toEqual(["t:u1", "t:a1", "t:u2", "t:a2"]);
    const dated = renderOhSessionZoomV1({ question: "What did I do ten days ago?", ranked: [], records: RECORDS },
      { asOf: AS_OF, budgetBytes: 400 });
    expect(dated.window).not.toBeNull();
    expect(dated.sessions).toEqual(["s2"]);
    expect(dated.bytes).toBeLessThanOrEqual(400);
    const lexical = renderOhSessionZoomV1({ question: "Which bicycle colour?", ranked: ranked(A1), records: RECORDS },
      { asOf: null, budgetBytes: 300 });
    expect(lexical.sessions).toEqual(["s2"]);
  });
});
