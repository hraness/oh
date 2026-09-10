import { describe, expect, test } from "bun:test";

import { canonicalJson, utf8ByteLength } from "./canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "./graph";
import { defaultOhRecallViewV1, OH_RECALL_DATE_GRAMMAR_V1, OH_RECALL_LIMITS_V1, recallOhV1, renderOhRecallV1,
  resolveRelativeDateWindowV1 } from "./recall";
import { OhSqliteStore } from "./sqlite/store";

const record = (key: string, value: unknown): KnowledgeGraphRecordV1 =>
  createKnowledgeGraphRecordV1({ dependencies: [], key, kind: "edition", v: 1, value: value as never });
const turn = (key: string, observedAt: string, sessionId: string, text: string) => record(key, { observedAt, sessionId, text });

function openStore(records: readonly KnowledgeGraphRecordV1[]): OhSqliteStore {
  const store = new OhSqliteStore({ path: ":memory:", spaceId: "recall" });
  store.commit({ actorId: "test", changes: records.map((item) => ({ kind: "put" as const, record: item, v: 1 as const })),
    expectedHead: store.head(), instant: "2026-01-01T00:00:00.000Z", operationId: "op_recall" });
  return store;
}

const KAYAK = turn("edition:kayak", "2023-05-04T10:00:00.000Z", "s1", "My kayak is crimson and I paddle it on Sundays.");
const BICYCLE = turn("edition:bicycle", "2023-05-20T09:00:00.000Z", "s2", "My bicycle is turquoise with a basket.");
const BOTH = turn("edition:both", "2023-05-20T09:05:00.000Z", "s2", "I keep the kayak beside the bicycle in the shed.");
const QUIET = turn("edition:quiet", "2023-05-24T08:00:00.000Z", "s3", "Nothing to report from the garden.");
const RECORDS = [KAYAK, BICYCLE, BOTH, QUIET];

describe("recallOhV1", () => {
  test("fuses bounded V1 searches by reciprocal rank across distinct queries", async () => {
    const store = openStore(RECORDS);
    try {
      const response = await recallOhV1({ asOf: null, limit: 10, queries: ["kayak", "bicycle"], store });
      expect(response).toMatchObject({ asOf: null, diagnostics: [], mode: "keyword", queries: ["kayak", "bicycle"], window: null, v: 1 });
      expect(response.results[0]?.record.key).toBe("edition:both");
      expect(response.results[0]?.evidence.map((item) => [item.lane, item.query])).toEqual([["query", 0], ["query", 1]]);
      expect(new Set(response.results.map((item) => item.record.key))).toEqual(new Set(["edition:both", "edition:kayak", "edition:bicycle"]));
      for (const result of response.results) {
        expect(result.score).toBeCloseTo(result.evidence.reduce((sum, item) => sum + 1 / (OH_RECALL_LIMITS_V1.rrfConstant + item.rank), 0), 12);
        expect(result.evidence.every((item) => item.v === 1 && item.rank >= 1 && Number.isFinite(item.score))).toBe(true);
      }
      const single = await recallOhV1({ asOf: null, queries: ["kayak"], store });
      expect(single.results.map((item) => item.record.key)).toEqual(["edition:both", "edition:kayak"].sort((left, right) =>
        single.results.findIndex((item) => item.record.key === left) - single.results.findIndex((item) => item.record.key === right)));
      expect(single.results.length).toBe(2);
    } finally { store.close(); }
  });

  test("keeps every lane inside the V1 search bound and rejects malformed input before searching", async () => {
    const store = openStore(RECORDS);
    try {
      await expect(recallOhV1({ asOf: null, queries: [], store })).rejects.toThrow("1 through 6 queries");
      await expect(recallOhV1({ asOf: null, queries: ["a", "b", "c", "d", "e", "f", "g"], store })).rejects.toThrow("1 through 6 queries");
      await expect(recallOhV1({ asOf: null, queries: ["kayak", "kayak"], store })).rejects.toThrow("distinct");
      await expect(recallOhV1({ asOf: null, queries: [""], store })).rejects.toThrow("nonempty");
      await expect(recallOhV1({ asOf: null, queries: ["x".repeat(16_385)], store })).rejects.toThrow("16384 bytes");
      for (const limit of [0, 101, 1.5]) await expect(recallOhV1({ asOf: null, limit, queries: ["kayak"], store })).rejects.toThrow("1 through 100");
      await expect(recallOhV1({ asOf: "2023-05-25", queries: ["kayak"], store })).rejects.toThrow("canonical UTC instant");
      await expect(recallOhV1({ asOf: null, mode: "remote" as never, queries: ["kayak"], store })).rejects.toThrow("mode");
      for (const window of [{ since: "2023-05-01T00:00:00.000Z", until: "2023-05-02T00:00:00.000Z" }, { since: "x", until: "y", v: 1 },
        { since: "2023-05-02T00:00:00.000Z", until: "2023-05-01T00:00:00.000Z", v: 1 }, []]) {
        await expect(recallOhV1({ asOf: null, queries: ["kayak"], store, window: window as never })).rejects.toThrow("window");
      }
      const semantic = await recallOhV1({ asOf: null, mode: "semantic", queries: ["kayak"], store });
      expect(semantic.results).toEqual([]);
      expect(semantic.diagnostics.map((item) => item.code)).toEqual(["semantic-unavailable"]);
    } finally { store.close(); }
  });

  test("adds the date-window lane from the current records in instant order without widening any lane", async () => {
    const store = openStore(RECORDS);
    try {
      const window = { since: "2023-05-20T00:00:00.000Z", until: "2023-05-24T23:59:59.999Z", v: 1 as const };
      const response = await recallOhV1({ asOf: "2023-05-25T09:00:00.000Z", limit: 2, queries: ["kayak"], store, window });
      expect(response.asOf).toBe("2023-05-25T09:00:00.000Z");
      expect(response.window).toEqual(window);
      const byKey = new Map(response.results.map((item) => [item.record.key, item]));
      expect(byKey.get("edition:both")?.evidence.map((item) => item.lane)).toEqual(["query", "window"]);
      expect(byKey.get("edition:bicycle")?.evidence).toEqual([{ lane: "window", query: null, rank: 1, score: 1 / 61, v: 1 }]);
      expect(byKey.get("edition:both")?.evidence[1]).toEqual({ lane: "window", query: null, rank: 2, score: 1 / 62, v: 1 });
      expect(byKey.has("edition:quiet")).toBe(false);
      expect(byKey.has("edition:kayak")).toBe(true);
      expect(response.results[0]?.record.key).toBe("edition:both");
      const wider = await recallOhV1({ asOf: null, limit: 3, queries: ["kayak"], store, window });
      expect(wider.results.some((item) => item.record.key === "edition:quiet")).toBe(true);
      const snapshot = OhSqliteStore.prototype.snapshotRecords;
      OhSqliteStore.prototype.snapshotRecords = () => { throw new RangeError("too many records"); };
      try {
        const degraded = await recallOhV1({ asOf: null, queries: ["kayak"], store, window });
        expect(degraded.diagnostics).toEqual([{ code: "window-unavailable", message: "too many records", v: 1 }]);
        expect(degraded.results.every((item) => item.evidence.every((entry) => entry.lane === "query"))).toBe(true);
      } finally { OhSqliteStore.prototype.snapshotRecords = snapshot; }
    } finally { store.close(); }
  });

  test("default view reads observedAt, sessionId and text and otherwise renders canonical JSON", () => {
    expect(defaultOhRecallViewV1(KAYAK)).toEqual({ instant: "2023-05-04T10:00:00.000Z", order: null, session: "s1", text: KAYAK.value ? (KAYAK.value as { text: string }).text : "" });
    const plain = record("entity:ada", { name: "Ada", observedAt: "not-an-instant" });
    expect(defaultOhRecallViewV1(plain)).toEqual({ instant: null, order: null, session: "entity:ada", text: canonicalJson(plain.value) });
    const list = record("entity:list", [1, 2]);
    expect(defaultOhRecallViewV1(list)).toEqual({ instant: null, order: null, session: "entity:list", text: "[1,2]" });
  });
});

describe("resolveRelativeDateWindowV1", () => {
  const asOf = "2023-05-25T09:00:00.000Z"; // Thursday
  const day = (date: string) => ({ since: `${date}T00:00:00.000Z`, until: `${date}T23:59:59.999Z` });
  const span = (since: string, until: string) => ({ since: `${since}T00:00:00.000Z`, until: `${until}T23:59:59.999Z` });

  test("resolves every grammar rule to a UTC day window anchored on the question instant", () => {
    const cases: readonly (readonly [string, string, ReturnType<typeof span>])[] = [
      ["What did I do last Saturday?", "last-weekday", day("2023-05-20")],
      ["Which class is on this Thursday?", "this-weekday", day("2023-05-25")],
      ["What is planned for next thursday?", "next-weekday", day("2023-06-01")],
      ["What happened last Thursday?", "last-weekday", day("2023-05-18")],
      ["Where did I go this Monday?", "this-weekday", day("2023-05-22")],
      ["Did I run today?", "today", day("2023-05-25")],
      ["What did I eat yesterday?", "yesterday", day("2023-05-24")],
      ["What is due tomorrow?", "tomorrow", day("2023-05-26")],
      ["What did I buy 5 days ago?", "days-ago", day("2023-05-20")],
      ["What did I buy 3 weeks ago?", "weeks-ago", span("2023-05-01", "2023-05-07")],
      ["Where did I travel a month ago?", "months-ago", span("2023-04-10", "2023-05-10")],
      ["Where did I travel two months ago?", "months-ago", span("2023-03-10", "2023-04-09")],
      ["What was my job a year ago?", "years-ago", span("2022-04-10", "2022-07-09")],
      ["What is planned in 2 weeks?", "in-weeks", span("2023-06-05", "2023-06-11")],
      ["What is planned in one day?", "in-days", day("2023-05-26")],
      ["What is due in 3 months?", "in-months", span("2023-08-10", "2023-09-09")],
      ["What is due in a year?", "in-years", span("2024-04-10", "2024-07-09")],
      ["What did I finish last week?", "last-week", span("2023-05-15", "2023-05-21")],
      ["What is on this week?", "this-week", span("2023-05-22", "2023-05-28")],
      ["What is on next week?", "next-week", span("2023-05-29", "2023-06-04")],
      ["What did I pay last month?", "last-month", span("2023-04-01", "2023-04-30")],
      ["What did I pay this month?", "this-month", span("2023-05-01", "2023-05-31")],
      ["What is due next month?", "next-month", span("2023-06-01", "2023-06-30")],
      ["Where did I live last year?", "last-year", span("2022-01-01", "2022-12-31")],
      ["Where do I live this year?", "this-year", span("2023-01-01", "2023-12-31")],
      ["Where will I live next year?", "next-year", span("2024-01-01", "2024-12-31")],
      ["What did we do last weekend?", "last-weekend", span("2023-05-20", "2023-05-21")],
      ["What is on this weekend?", "this-weekend", span("2023-05-27", "2023-05-28")],
      ["What is on next weekend?", "next-weekend", span("2023-06-03", "2023-06-04")],
    ];
    for (const [query, rule, window] of cases) {
      const resolved = resolveRelativeDateWindowV1(query, asOf);
      expect({ query, resolved: resolved === null ? null : { rule: resolved.rule, since: resolved.since, until: resolved.until } })
        .toEqual({ query, resolved: { rule, ...window } });
      expect(resolved?.v).toBe(1);
      expect(query.toLowerCase()).toContain(resolved?.expression ?? "missing");
    }
  });

  test("clamps calendar arithmetic and treats numbers and words alike", () => {
    expect(resolveRelativeDateWindowV1("a month ago", "2023-03-31T12:00:00.000Z")).toMatchObject({ rule: "months-ago", ...span("2023-02-13", "2023-03-15") });
    const words = resolveRelativeDateWindowV1("two weeks ago", asOf), digits = resolveRelativeDateWindowV1("2 weeks ago", asOf);
    expect([words?.rule, words?.since, words?.until]).toEqual([digits?.rule, digits?.since, digits?.until]);
    expect(resolveRelativeDateWindowV1("What did I do in the last month?", asOf)).toMatchObject({ rule: "past-span", expression: "in the last month", ...span("2023-04-25", "2023-05-25") });
    expect(resolveRelativeDateWindowV1("Which shows did I watch over the past two weeks?", asOf)).toMatchObject({ rule: "past-span", ...span("2023-05-11", "2023-05-25") });
    expect(resolveRelativeDateWindowV1("within the past 3 days", asOf)).toMatchObject({ rule: "past-span", ...span("2023-05-22", "2023-05-25") });
    expect(resolveRelativeDateWindowV1("Last WEEKEND", asOf)?.rule).toBe("last-weekend");
    expect(resolveRelativeDateWindowV1("last week and last week again", asOf)?.rule).toBe("last-week");
    expect(resolveRelativeDateWindowV1("last saturday", "2023-05-27T09:00:00.000Z")).toMatchObject(day("2023-05-20"));
    expect(resolveRelativeDateWindowV1("next saturday", "2023-05-27T09:00:00.000Z")).toMatchObject(day("2023-06-03"));
  });

  test("returns null for unknown, ambiguous, or empty expressions and rejects a malformed question instant", () => {
    for (const query of ["How many times did I visit?", "a few days ago", "the other day", "over the weekend", "0 days ago",
      "3 weeks ago or a month ago", "last week and this week", "weekend", "in the last few months", "1000 days ago"]) {
      expect({ query, resolved: resolveRelativeDateWindowV1(query, asOf) }).toEqual({ query, resolved: null });
    }
    expect(() => resolveRelativeDateWindowV1("last week", "2023-05-25")).toThrow("canonical UTC instant");
    expect(() => resolveRelativeDateWindowV1("", asOf)).toThrow("nonempty");
    expect(OH_RECALL_DATE_GRAMMAR_V1.id).toBe("oh.recall-date-grammar.v1");
    expect(Object.isFrozen(OH_RECALL_DATE_GRAMMAR_V1) && Object.isFrozen(OH_RECALL_DATE_GRAMMAR_V1.rules)).toBe(true);
    expect(new Set(OH_RECALL_DATE_GRAMMAR_V1.rules.map((rule) => rule.id)).size).toBe(OH_RECALL_DATE_GRAMMAR_V1.rules.length);
  });
});

describe("renderOhRecallV1", () => {
  const view = (item: KnowledgeGraphRecordV1) => item;
  const text = (item: KnowledgeGraphRecordV1) => (item.value as { text: string }).text;

  test("renders sessions chronologically under question-relative dated headers with gap markers", () => {
    const rendering = renderOhRecallV1({ results: [QUIET, BOTH, KAYAK, BICYCLE].map((item) => ({ record: view(item) })) },
      { asOf: "2023-05-25T09:00:00.000Z", budgetBytes: 96_000 });
    expect(rendering.text).toBe([
      "Question date: 2023/05/25 (Thu)",
      `Date: 2023/05/04 (Thu), 21 days before the question\n${text(KAYAK)}`,
      "[2 weeks later]",
      `Date: 2023/05/20 (Sat), 5 days before the question\n${text(BICYCLE)}\n\n${text(BOTH)}`,
      "[4 days later]",
      `Date: 2023/05/24 (Wed), 1 day before the question\n${text(QUIET)}`,
    ].join("\n\n"));
    expect(rendering).toMatchObject({ bytes: utf8ByteLength(rendering.text), keys: ["edition:kayak", "edition:bicycle", "edition:both", "edition:quiet"],
      omitted: 0, renderer: "oh.recall-render.v1", v: 1 });
    const sameDay = renderOhRecallV1({ results: [{ record: QUIET }] }, { asOf: "2023-05-24T23:00:00.000Z", budgetBytes: 96_000 });
    expect(sameDay.text).toBe(`Question date: 2023/05/24 (Wed)\n\nDate: 2023/05/24 (Wed), the day of the question\n${text(QUIET)}`);
    const future = renderOhRecallV1({ results: [{ record: QUIET }] }, { asOf: "2023-05-22T00:00:00.000Z", budgetBytes: 96_000 });
    expect(future.text).toContain("2 days after the question");
  });

  test("labels gaps in days, weeks, months and years and lists undated records last", () => {
    const at = (key: string, date: string) => turn(key, `${date}T12:00:00.000Z`, key, `text ${key}`);
    const gaps = renderOhRecallV1({ results: [at("a", "2020-01-01"), at("b", "2020-01-14"), at("c", "2020-03-14"), at("d", "2020-05-14"), at("e", "2021-05-14")]
      .map((item) => ({ record: item })) }, { asOf: "2021-06-01T00:00:00.000Z", budgetBytes: 96_000 });
    expect(gaps.text.match(/\[[^\]]+ later\]/gu)).toEqual(["[13 days later]", "[8 weeks later]", "[2 months later]", "[1 year later]"]);
    const undated = record("edition:undated", { sessionId: "s9", text: "no instant" });
    const mixed = renderOhRecallV1({ results: [{ record: undated }, { record: KAYAK }] }, { asOf: "2023-05-25T09:00:00.000Z", budgetBytes: 96_000 });
    expect(mixed.text.endsWith("Date: unknown\nno instant")).toBe(true);
    expect(mixed.keys).toEqual(["edition:kayak", "edition:undated"]);
  });

  test("renders the plain rank order when there is no question instant", () => {
    const rendering = renderOhRecallV1({ results: [QUIET, KAYAK].map((item) => ({ record: item })) }, { asOf: null, budgetBytes: 96_000 });
    expect(rendering.text).toBe(`${text(QUIET)}\n\n${text(KAYAK)}`);
    expect(rendering.keys).toEqual(["edition:quiet", "edition:kayak"]);
  });

  test("admits results in rank order under a byte budget, skips duplicates and keeps raw text unchanged", () => {
    const large = turn("edition:large", "2023-05-10T00:00:00.000Z", "s5", "x".repeat(400));
    const small = turn("edition:small", "2023-05-11T00:00:00.000Z", "s6", "small");
    const rendering = renderOhRecallV1({ results: [{ record: large }, { record: small }, { record: small }] }, { asOf: "2023-05-25T09:00:00.000Z", budgetBytes: 160 });
    expect(rendering.omitted).toBe(1);
    expect(rendering.keys).toEqual(["edition:small"]);
    expect(rendering.text).toBe("Question date: 2023/05/25 (Thu)\n\nDate: 2023/05/11 (Thu), 14 days before the question\nsmall");
    expect(rendering.bytes).toBeLessThanOrEqual(160);
    const empty = renderOhRecallV1({ results: [] }, { asOf: "2023-05-25T09:00:00.000Z", budgetBytes: 1 });
    expect(empty).toEqual({ bytes: 0, keys: [], omitted: 0, renderer: "oh.recall-render.v1", text: "", v: 1 });
    const tooTight = renderOhRecallV1({ results: [{ record: small }] }, { asOf: null, budgetBytes: 4 });
    expect(tooTight).toMatchObject({ keys: [], omitted: 1, text: "" });
  });

  test("rejects malformed rendering input", () => {
    expect(() => renderOhRecallV1({ results: [] }, { asOf: "yesterday", budgetBytes: 10 })).toThrow("canonical UTC instant");
    for (const budgetBytes of [0, 4_000_001, 1.5]) expect(() => renderOhRecallV1({ results: [] }, { asOf: null, budgetBytes })).toThrow("budget");
    expect(() => renderOhRecallV1({ results: Array.from({ length: 8_193 }, () => ({ record: KAYAK })) }, { asOf: null, budgetBytes: 10 })).toThrow("8192");
    expect(() => renderOhRecallV1({ results: [{ record: null as never }] }, { asOf: null, budgetBytes: 10 })).toThrow("records");
    expect(() => renderOhRecallV1({ results: [{ record: KAYAK }] }, { asOf: null, budgetBytes: 10, view: (() => ({ instant: null })) as never })).toThrow("exactly instant");
    expect(() => renderOhRecallV1({ results: [{ record: KAYAK }] }, { asOf: null, budgetBytes: 10, view: "view" as never })).toThrow("function");
  });
});
