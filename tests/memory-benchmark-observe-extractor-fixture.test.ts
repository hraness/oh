import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canonicalSha256 } from "../src/canonical";
import { parseOhObservationResponseV1, parseOhObservationSessionV1 } from "../src/observe";
import { observeLaneSessions, observeLaneTurnRecords } from "../scripts/benchmarks/evolution-observe-lane";
import { makeObserveExtractorFixture, OBSERVE_EXTRACTOR_FIXTURE_SHA256,
  OBSERVE_EXTRACTOR_ORIGINAL_FIXTURE_SHA256, scoreObserveExtractorFixture } from "../scripts/benchmarks/observe-extractor-fixture";
import { makeObserveExtractorPromptV2, parseObserveExtractorResponseV2 } from "../scripts/benchmarks/observe-extractor-v2";
import { parseObserveFixtureCorpus, type ObserveRubricObservation, type ObserveRubricSession } from "../scripts/benchmarks/observe-rubric";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));
const original = read("observe-fixture-corpus-v1.json"), stress = read("observe-extractor-stress-v2.json");
const fixture = makeObserveExtractorFixture(original, stress);
type Observation = { -readonly [K in keyof ObserveRubricObservation]: ObserveRubricObservation[K] };
type Row = { corpusId: string; sessionId: string; status: ObserveRubricSession["status"]; observations: Observation[] };
const compliant = (): Row[] => read("observe-extractor-fixture-v2-compliant.json") as Row[];
function row(rows: Row[], id: string): Row { return rows.find(item => item.sessionId === id)!; }
const partialExpressions = ["2019", "2021", "2030", "03/04/2027", "May 2027", "next month"];

function context(item: ObserveRubricSession) {
  const corpus = fixture.corpora.find(c => c.id === item.corpusId)!, records = observeLaneTurnRecords(corpus);
  const group = observeLaneSessions(corpus).find(s => s.sessionId === item.sessionId)!;
  return parseOhObservationSessionV1(group.indices.map(index => records[index]!));
}
/** Exercise the real parser and source projection without a provider or store. */
function admitted(rows: Row[], version: 1 | 2 = 2): ObserveRubricSession[] {
  return rows.map(item => {
    const session = context(item), byId = new Map(session.turns.map(turn => [turn.turnId, turn]));
    const drafts = item.observations.map(observation => {
      const sources = observation.sourceTurnIds.map(id => byId.get(id)!.alias);
      if (version === 1) return { text: observation.text, kind: observation.kind, speaker: observation.speaker, facet: null,
        sources, eventAt: observation.eventAt, resolvedFrom: observation.resolvedFrom };
      const partial = item.sessionId === "stress-dates" ? partialExpressions.find(expression => observation.text.includes(expression)) : undefined;
      return { text: observation.text, kind: observation.kind, attributionTurn: sources[0], facet: null, sources,
        when: observation.resolvedFrom !== null ? { expression: observation.resolvedFrom, date: observation.eventAt }
          : partial === undefined ? null : { expression: partial, date: null } };
    });
    const raw = JSON.stringify({ observations: drafts });
    const parsed = version === 1 ? parseOhObservationResponseV1(raw, session) : parseObserveExtractorResponseV2(raw, session);
    expect(parsed.ok, `${version === 1 ? "V1" : "V2"} parser admitted ${item.sessionId}`).toBe(true);
    if (!parsed.ok) throw Error(`${item.sessionId}: ${parsed.rejection}`);
    const byKey = new Map(session.turns.map(turn => [turn.key, turn.turnId]));
    return { ...item, observations: parsed.observations.map(observation => ({ text: observation.text, kind: observation.kind,
      speaker: observation.speaker, eventAt: observation.eventAt, resolvedFrom: observation.resolvedFrom,
      sourceTurnIds: observation.sources.map(source => byKey.get(source.key)!) })) };
  });
}

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("Synthetic fixture tests have no provider access"); },
  { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });

describe("frozen extractor qualification fixture", () => {
  test("preserves the original eight sessions and separates stress oracles from model input", () => {
    const parsedOriginal = parseObserveFixtureCorpus(original);
    expect(canonicalSha256(parsedOriginal)).toBe(OBSERVE_EXTRACTOR_ORIGINAL_FIXTURE_SHA256);
    expect(canonicalSha256(fixture)).toBe(OBSERVE_EXTRACTOR_FIXTURE_SHA256);
    expect(fixture.corpora.slice(0, 3)).toEqual(parsedOriginal.corpora);
    expect(fixture.expectations).toEqual(parsedOriginal.expectations);
    expect(fixture.corpora.flatMap(observeLaneSessions)).toHaveLength(12);
    const dense = row(compliant(), "stress-dense"), session = context(dense);
    expect(session.turns).toHaveLength(24);
    const prompt = makeObserveExtractorPromptV2(session), input = JSON.parse(prompt.messages[1].content);
    expect(Object.keys(input).sort()).toEqual(["sessionDate", "turns"]);
    expect(input.turns).toHaveLength(24);
    expect(prompt.messages[1].content).not.toMatch(/expectations|coverage|rubric|gold|question|answer/iu);
    const changedOriginal = structuredClone(original) as any; changedOriginal.corpora[0].turns[0].text += " Changed.";
    const changedStress = structuredClone(stress) as any; changedStress.corpora[0].turns[0].text += " Changed.";
    expect(() => makeObserveExtractorFixture(changedOriginal, stress)).toThrow("pin mismatch");
    expect(() => makeObserveExtractorFixture(original, changedStress)).toThrow("pin mismatch");
    expect(() => scoreObserveExtractorFixture({ ...fixture, absent: [] }, compliant())).toThrow("pin mismatch");
  });

  test("handwritten correct responses pass V1 and V2 with 73 facts, 12 dates and 2 corrections", () => {
    for (const version of [1, 2] as const) {
      const report = scoreObserveExtractorFixture(fixture, admitted(compliant(), version));
      expect(report.pass).toBe(true);
      expect(report.originalRubric).toMatchObject({ sessions: 8, pass: true, fixtureSha256: OBSERVE_EXTRACTOR_ORIGINAL_FIXTURE_SHA256 });
      expect(report.coverage.map(item => [item.expected, item.matched])).toEqual([[48, 48], [10, 10], [9, 9], [6, 6]]);
      expect(report.checks).toEqual({ dateChecks: 12, datePassed: 12, attributionChecks: 73, attributionPassed: 73, correctionChecks: 2, correctionPassed: 2 });
      expect(report.violations).toEqual([]);
      const { reportSha256, ...payload } = report; expect(canonicalSha256(payload)).toBe(reportSha256);
    }
  });

  test("a concise sentence may retain multiple independently grounded facts", () => {
    const rows = compliant(), dense = row(rows, "stress-dense");
    dense.observations = Array.from({ length: 24 }, (_, index) => ({ ...dense.observations[index * 2]!,
      text: dense.observations[index * 2]!.text.replace(/\.$/u, "") + "; " + dense.observations[index * 2 + 1]!.text }));
    const advice = row(rows, "stress-attribution");
    const contact = advice.observations[6]!;
    advice.observations.splice(6, 3, { ...contact, text: "The booking contact is Chloë Dvořák, the booking code is AB-0073, and the deposit is €1,204.50." });
    const report = scoreObserveExtractorFixture(fixture, admitted(rows));
    expect(report.pass).toBe(true);
    expect(report.coverage.map(item => item.matched)).toEqual([48, 10, 9, 6]);
    const inverse = compliant(); row(inverse, "stress-dense").observations[0]!.text = "18 brass clips are stored in bin R01 at Indigo Annex.";
    expect(scoreObserveExtractorFixture(fixture, admitted(inverse)).pass).toBe(true);
  });

  test("same-source quantity swaps pass the real V2 parser but fail factual coverage", () => {
    const rows = compliant(), dense = row(rows, "stress-dense");
    dense.observations = Array.from({ length: 24 }, (_, index) => {
      const first = index * 2 + 1, second = first + 1;
      return { ...dense.observations[index * 2]!, text: `At Indigo Annex, bin R${String(first).padStart(2, "0")} contains ${second + 17} brass clips, and bin R${String(second).padStart(2, "0")} contains ${first + 17} brass clips.` };
    });
    const report = scoreObserveExtractorFixture(fixture, admitted(rows));
    expect(report.pass).toBe(false);
    expect(report.coverage[0]!.matched).toBe(0);
    expect(report.violations.filter(item => item.check === "unmatched-observation")).toHaveLength(24);
  });

  test("dense omissions have a declared bound and never excuse sparse-topic omissions", () => {
    for (const [omissions, expected] of [[2, true], [3, false]] as const) {
      const rows = compliant(); row(rows, "stress-dense").observations.splice(0, omissions);
      expect(scoreObserveExtractorFixture(fixture, admitted(rows)).pass).toBe(expected);
    }
    const rows = compliant(); row(rows, "stress-modality").observations.splice(0, 1);
    const report = scoreObserveExtractorFixture(fixture, admitted(rows));
    expect(report.pass).toBe(false);
    expect(report.coverage[3]!.missing).toContain("boat-negation");
  });

  test("partial precision and resolved date identity are checked independently of JSON validity", () => {
    for (const mutate of [
      (rows: Row[]) => { Object.assign(row(rows, "stress-dates").observations[0]!, { eventAt: "2019-01-01", resolvedFrom: "2019" }); },
      (rows: Row[]) => { row(rows, "stress-dates").observations[3]!.eventAt = "2027-03-04"; row(rows, "stress-dates").observations[3]!.resolvedFrom = "03/04/2027"; },
      (rows: Row[]) => { row(rows, "stress-dates").observations[6]!.eventAt = "2028-02-28"; },
      (rows: Row[]) => { row(rows, "stress-dates").observations[0]!.text += " The exact date was 2019-01-01."; },
    ]) {
      const rows = compliant(); mutate(rows);
      const report = scoreObserveExtractorFixture(fixture, admitted(rows, 1));
      expect(report.pass).toBe(false);
      expect(report.violations.some(item => item.check === "date")).toBe(true);
    }
    const rows = compliant(); row(rows, "stress-dates").observations[4]!.text = "The Bracken Lecture happened.";
    expect(scoreObserveExtractorFixture(fixture, admitted(rows, 1)).coverage[1]!.missing).toContain("month-only");
  });

  test("source-backed temporal prefixes preserve the same precise date", () => {
    const rows = compliant();
    row(rows, "stress-dates").observations[9]!.resolvedFrom = "on 2028-02-03";
    row(rows, "stress-modality").observations[2]!.resolvedFrom = "on 2031-06-14";
    row(rows, "stress-modality").observations[3]!.resolvedFrom = "on 2031-06-15";
    const report = scoreObserveExtractorFixture(fixture, admitted(rows));
    expect(report.pass).toBe(true); expect(report.checks.datePassed).toBe(12);
  });

  test("assistant advice, source completeness and correction direction need semantic evidence", () => {
    for (const mutate of [
      (rows: Row[]) => { row(rows, "stress-attribution").observations[1]!.text = "user suggested buying an Aster X7 recorder."; },
      (rows: Row[]) => { row(rows, "stress-attribution").observations[1]!.sourceTurnIds = ["stress-attribution:0", "stress-attribution:1"]; },
      (rows: Row[]) => { row(rows, "stress-attribution").observations[4]!.sourceTurnIds = ["stress-attribution:4"]; },
      (rows: Row[]) => { row(rows, "stress-attribution").observations[4]!.text = "user's recorder purchase budget changed from 750 EUR to 800 EUR."; },
      (rows: Row[]) => { row(rows, "stress-attribution").observations[6]!.text = "The booking contact is Chloe Dvorak."; },
      (rows: Row[]) => { row(rows, "stress-attribution").observations[7]!.text = "The booking code is AB-73."; },
      (rows: Row[]) => { row(rows, "stress-attribution").observations[8]!.text = "user's deposit is €1,205."; },
    ]) {
      const rows = compliant(); mutate(rows);
      expect(scoreObserveExtractorFixture(fixture, admitted(rows, 1)).pass).toBe(false);
    }
  });

  test("fiction, negation loss, unconfirmed-plan promotion and exact-number changes fail", () => {
    for (const mutate of [
      (rows: Row[]) => { row(rows, "stress-modality").observations.push({ text: "user won €77,777 in 1999.", kind: "fact", speaker: "user", eventAt: null, resolvedFrom: null, sourceTurnIds: ["stress-modality:2"] }); },
      (rows: Row[]) => { row(rows, "stress-modality").observations[0]!.text = "user owns a boat."; },
      (rows: Row[]) => { Object.assign(row(rows, "stress-modality").observations[2]!, { text: "user rented Little Tern on 2031-06-14.", kind: "event" }); },
      (rows: Row[]) => { row(rows, "stress-modality").observations[5]!.text = "The proposed route is 17.5 km."; },
      (rows: Row[]) => { row(rows, "stress-dense").observations[0]!.text = "At Indigo Annex, bin R01 contains 118 brass clips."; },
    ]) {
      const rows = compliant(); mutate(rows);
      expect(scoreObserveExtractorFixture(fixture, admitted(rows, 1)).pass).toBe(false);
    }
  });

  test("a token blob cannot claim sources it does not cite, and session failures always stop qualification", () => {
    const rows = compliant(), dense = row(rows, "stress-dense");
    const first = dense.observations[0]!;
    dense.observations.splice(0, 10, { ...first, text: dense.observations.slice(0, 10).map(item => item.text).join(" ") });
    const report = scoreObserveExtractorFixture(fixture, admitted(rows));
    expect(report.pass).toBe(false);
    expect(report.coverage[0]!.matched).toBe(40); // Two cited facts plus the untouched 38.
    expect(report.violations.some(item => item.check === "source-attribution")).toBe(true);
    for (const status of ["failed", "rejected", "not-run"] as const) {
      const bad = compliant(), target = row(bad, "stress-dense"); target.status = status; target.observations = [];
      const result = scoreObserveExtractorFixture(fixture, bad);
      expect(result.pass).toBe(false); expect(result.completedSessions).toBe(11);
    }
    expect(() => scoreObserveExtractorFixture(fixture, compliant().slice(1))).toThrow("each fixture session once");
    expect(() => scoreObserveExtractorFixture(fixture, [...compliant(), compliant()[0]!])).toThrow("each fixture session once");
  });
});
