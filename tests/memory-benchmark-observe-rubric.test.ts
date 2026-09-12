import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalSha256 } from "../src/canonical";
import { observeOhV1, OH_OBSERVATION_INSTRUCTION_V1, type OhObserverV1 } from "../src/observe";
import { OhSqliteStore } from "../src/sqlite/store";
import { observeLaneSessions, observeLaneTurnRecords } from "../scripts/benchmarks/evolution-observe-lane";
import { OBSERVE_RUBRIC_GATE_V1, observeRubricSessionFromRecords, parseObserveFixtureCorpus, scoreObserveRubric,
  type ObserveFixtureCorpus, type ObserveRubricSession } from "../scripts/benchmarks/observe-rubric";

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No provider or network in rubric fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });

const fixturePath = join(import.meta.dir, "fixtures", "observe-fixture-corpus-v1.json");
async function fixture(): Promise<ObserveFixtureCorpus> { return parseObserveFixtureCorpus(JSON.parse(await readFile(fixturePath, "utf8"))); }

type Draft = { text: string; speaker?: string; kind: string; eventAt?: string | null; resolvedFrom?: string | null; facet?: string | null; sources: string[] };
const obs = (d: Draft) => ({ text: d.text, speaker: d.speaker ?? "user", kind: d.kind, eventAt: d.eventAt ?? null, resolvedFrom: d.resolvedFrom ?? null,
  facet: d.facet ?? null, sources: d.sources });
/** Hand-written responses that obey the frozen instruction; keyed by the first turn of each session. */
const compliant: Record<string, Draft[]> = {
  "h1:0": [
    { text: "user started a pottery class at Kiln House on 2026-02-21 and goes twice a week.", kind: "fact", eventAt: "2026-02-21", resolvedFrom: "three weeks ago", facet: "pottery-class", sources: ["t0"] },
    { text: "assistant suggested a stoneware clay for hand-building.", speaker: "assistant", kind: "fact", sources: ["t1"] },
    { text: "user prefers oolong tea over coffee in the afternoon.", kind: "preference", facet: "afternoon-drink", sources: ["t2"] }],
  "h2:0": [
    { text: "user's pottery attendance changed from twice a week to three times a week.", kind: "update", facet: "pottery-frequency", sources: ["t0"] },
    { text: "user's pottery instructor is Marisol Vega.", kind: "fact", facet: "pottery-instructor", sources: ["t0"] }],
  "h3:0": [
    { text: "user's rent changed from $1,450 to $1,600 a month.", kind: "update", eventAt: "2026-03-31", resolvedFrom: "Two days ago", facet: "rent", sources: ["t0"] },
    { text: "user's new rent of $1,600 a month starts on 2026-04-10.", kind: "event", eventAt: "2026-04-10", resolvedFrom: "April 10", facet: "rent-start", sources: ["t0"] },
    { text: "user wants to move somewhere cheaper eventually.", kind: "plan", facet: "housing-plan", sources: ["t2"] }],
  "w1:0": [
    { text: "user joined Northwind Robotics as a firmware engineer on 2026-04-28.", kind: "event", eventAt: "2026-04-28", resolvedFrom: "A week ago", facet: "employer", sources: ["t0"] },
    { text: "user's salary at Northwind Robotics is 98,500 euros.", kind: "fact", facet: "salary", sources: ["t0"] },
    { text: "user dislikes long stand-up meetings.", kind: "preference", facet: "meeting-preference", sources: ["t2"] }],
  "w2:0": [
    { text: "user flies to Lisbon for the Northwind offsite on 2026-06-21; the flight is 2 hours 35 minutes.", kind: "plan", eventAt: "2026-06-21", resolvedFrom: "Tomorrow", facet: "lisbon-trip", sources: ["t0"] }],
  "w3:0": [
    { text: "user's title changed from firmware engineer to firmware lead on 2026-07-03.", kind: "update", eventAt: "2026-07-03", resolvedFrom: "On 3 July", facet: "job-title", sources: ["t0"] },
    { text: "user presents the Q3 roadmap on 2026-07-18.", kind: "plan", eventAt: "2026-07-18", resolvedFrom: "In ten days", facet: "q3-roadmap", sources: ["t0"] },
    { text: "assistant suggested a 12-slide deck for the Q3 roadmap.", speaker: "assistant", kind: "fact", sources: ["t1"] }],
  "f1:0": [
    { text: "user's daughter Ines turned 7 on 2026-03-13.", kind: "event", eventAt: "2026-03-13", resolvedFrom: "Yesterday", facet: "daughter-birthday", sources: ["t0"] },
    { text: "user booked a trip to Kyoto for 5 nights.", kind: "plan", facet: "kyoto-trip-length", sources: ["t0"] }],
  "f2:0": [
    { text: "user's Kyoto trip changed from 5 nights to 8 nights because of a cheaper ryokan, the Hanami Inn.", kind: "update", facet: "kyoto-trip-length", sources: ["t0"] },
    { text: "user would rather not fly with a layover longer than 2 hours.", kind: "preference", facet: "layover-preference", sources: ["t1"] }],
};
const flawed: Record<string, Draft[] | string> = {
  ...compliant,
  "h1:0": [
    { text: "user started a pottery class at Kiln House on 2026-02-28 and goes twice a week.", kind: "fact", eventAt: "2026-02-28", resolvedFrom: "three weeks ago", facet: "pottery-class", sources: ["t0"] },
    { text: "user suggested a stoneware clay for hand-building.", speaker: "user", kind: "fact", sources: ["t0", "t1"] },
    { text: "user prefers oolong tea over coffee in the afternoon.", kind: "preference", facet: "afternoon-drink", sources: ["t2"] }],
  "h3:0": [
    { text: "user's rent went up to about $1,600 a month.", kind: "update", eventAt: "2026-03-31", resolvedFrom: "Two days ago", facet: "rent", sources: ["t0"] },
    { text: "user's new rent starts on 2026-04-10.", kind: "event", eventAt: "2026-04-10", resolvedFrom: "April 10", facet: "rent-start", sources: ["t0"] },
    { text: "assistant imagined a rent of $9,999 as an example.", speaker: "assistant", kind: "fact", sources: ["t1"] },
    { text: "user wants to move somewhere cheaper eventually.", kind: "plan", facet: "housing-plan", sources: ["t2"] }],
  "w2:0": "{\"observations\": [",
};

function stub(responses: Record<string, Draft[] | string>, turnIds: ReadonlyMap<string, string>): OhObserverV1 & { prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, modelId: "stub/fixture-observer", observe(prompt) {
    prompts.push(prompt.messages[1].content);
    expect(prompt.messages[0].content).toBe(OH_OBSERVATION_INSTRUCTION_V1);
    const user = JSON.parse(prompt.messages[1].content) as { sessionDate: string; turns: { id: string; speaker: string; text: string }[] };
    expect(Object.keys(user).sort()).toEqual(["sessionDate", "turns"]);
    const firstText = user.turns[0]!.text, firstId = [...turnIds].find(([, text]) => text === firstText)?.[0];
    const response = responses[firstId ?? ""]; if (response === undefined) throw new Error(`No stub response for ${firstId}`);
    return typeof response === "string" ? response : JSON.stringify({ observations: response.map(obs) });
  } };
}

/** Runs every fixture session through the library and projects the committed records to rubric rows. */
async function extract(corpus: ObserveFixtureCorpus, responses: Record<string, Draft[] | string>) {
  const rows: ObserveRubricSession[] = [];
  const turnIds = new Map(corpus.corpora.flatMap(c => c.turns.map(t => [t.id, t.text] as const)));
  const observer = stub(responses, turnIds);
  for (const c of corpus.corpora) {
    const store = new OhSqliteStore({ path: ":memory:", spaceId: "rubric" }), records = observeLaneTurnRecords(c);
    try {
      store.commit({ actorId: "agent.test", changes: records.map(record => ({ kind: "put" as const, record, v: 1 as const })), expectedHead: store.head(),
        instant: "2026-08-01T00:00:00.000Z", operationId: "op_turns" });
      for (const group of observeLaneSessions(c)) {
        const keys = group.indices.map(index => records[index]!.key);
        const result = await observeOhV1({ actorId: "agent.observe", instant: "2026-08-01T00:00:01.000Z", observer, sessionRecordKeys: keys, store });
        rows.push(observeRubricSessionFromRecords({ corpusId: c.id, sessionId: group.sessionId, status: result.status === "committed" ? "completed" : "rejected",
          observations: result.status === "committed" ? result.observationKeys.map(key => store.get(key)!) : [], turns: keys.map(key => store.get(key)!) }));
      }
    } finally { store.close(); }
  }
  return { rows, prompts: observer.prompts };
}

describe("observation fixture rubric", () => {
  test("the fixture is a parsed synthetic corpus with independent expectations and no benchmark vocabulary", async () => {
    const corpus = await fixture();
    expect(corpus.corpora.map(c => c.id)).toEqual(["fixture-household", "fixture-work", "fixture-family"]);
    expect(corpus.corpora.flatMap(observeLaneSessions)).toHaveLength(8);
    expect(corpus.expectations.length).toBeGreaterThanOrEqual(14);
    expect(corpus.expectations.flatMap(e => e.dates)).toHaveLength(8);
    expect(JSON.stringify(corpus)).not.toMatch(/longmemeval|locomo|gold|category|question/iu);
    const raw = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    for (const mutate of [(v: any) => { v.extra = 1; }, (v: any) => { v.expectations[0].turnId = "nope"; },
      (v: any) => { v.expectations[0].speaker = "assistant"; }, (v: any) => { v.expectations[0].verbatim.push("not in the turn"); },
      (v: any) => { v.expectations[0].dates[0].eventAt = "2026-02-30"; }, (v: any) => { v.absent[0].sessionId = "zz"; },
      (v: any) => { v.corpora[0].turns.push({ ...v.corpora[0].turns[0] }); }]) {
      const bad = structuredClone(raw); mutate(bad); expect(() => parseObserveFixtureCorpus(bad)).toThrow(TypeError);
    }
  });

  test("a compliant extraction passes every gate through the library end to end", async () => {
    const corpus = await fixture(), { rows, prompts } = await extract(corpus, compliant);
    expect(prompts).toHaveLength(8);
    for (const prompt of prompts) expect(prompt).not.toMatch(/question|answer|gold|category|expectation/iu);
    const report = scoreObserveRubric(corpus, rows);
    expect(report.gate).toEqual(OBSERVE_RUBRIC_GATE_V1);
    expect(report.scores).toEqual({ dateResolution: 1, attribution: 1, verbatim: 1, coverage: 1, kind: 1, leakage: 0, parserRejection: 0 });
    expect(report).toMatchObject({ sessions: 8, completedSessions: 8, rejectedSessions: 0, observations: 19, failures: [], pass: true, fixtureSha256: canonicalSha256(corpus) });
    expect(report.items).toBe(corpus.expectations.length * 2 + corpus.expectations.flatMap(e => e.dates).length + corpus.expectations.flatMap(e => e.verbatim).length
      + corpus.expectations.filter(e => e.kinds.length > 0).length + corpus.absent.length);
  });

  test("a flawed extraction is named by rubric item and fails the gate", async () => {
    const corpus = await fixture(), { rows } = await extract(corpus, flawed);
    const report = scoreObserveRubric(corpus, rows);
    expect(report.pass).toBe(false);
    expect(report).toMatchObject({ completedSessions: 7, rejectedSessions: 1 });
    expect(report.scores.parserRejection).toBeCloseTo(1 / 8, 10);
    expect(report.scores.leakage).toBe(1);
    expect(report.failures.map(f => `${f.check} ${f.turnId ?? "-"} ${f.target}`).sort()).toEqual([
      "attribution h1:1 assistant",
      "coverage w2:0 w2:0",
      "attribution w2:0 user",
      "date h1:0 three weeks ago -> 2026-02-21",
      "date w2:0 tomorrow -> 2026-06-21",
      "leakage - 9,999",
      "verbatim h3:0 $1,450",
      "verbatim w2:0 2 hours 35 minutes",
      "verbatim w2:0 Lisbon",
    ].sort());
    expect(report.scores.attribution).toBeCloseTo(12 / 14, 10);
    expect(report.scores.dateResolution).toBeCloseTo(6 / 8, 10);
  });

  test("rubric rows must cover each fixture session exactly once and carry observations only when completed", async () => {
    const corpus = await fixture(), { rows } = await extract(corpus, compliant);
    expect(() => scoreObserveRubric(corpus, rows.slice(1))).toThrow("cover each fixture session once");
    expect(() => scoreObserveRubric(corpus, [...rows, rows[0]!])).toThrow("cover each fixture session once");
    expect(() => scoreObserveRubric(corpus, rows.map((row, i) => i === 0 ? { ...row, status: "failed" } : row))).toThrow("only a completed session");
  });
});
