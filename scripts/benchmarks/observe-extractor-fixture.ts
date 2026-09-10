/** Frozen synthetic qualification; no model calls, file reads, or benchmark inputs.
 * The lexical oracles are deliberately conservative. Passing them is bounded
 * fixture evidence, not a general semantic-equivalence or factuality proof. */
import { canonicalSha256 } from "../../src/canonical";
import { OH_OBSERVATION_LIMITS_V1, type OhObservationKindV1 } from "../../src/observe";
import { parseObserveFixtureCorpus, scoreObserveRubric, type ObserveFixtureCorpus,
  type ObserveRubricObservation, type ObserveRubricSession } from "./observe-rubric";

export const OBSERVE_EXTRACTOR_ORIGINAL_FIXTURE_SHA256 = "a34034ad86f5c258baef978c97010d5bbea26f34dc4a8d387797c415e362cb02";
export const OBSERVE_EXTRACTOR_STRESS_FIXTURE_SHA256 = "6deff26b7fb7a9b6d02ee94dfe1248f36256ffab3ac7fef3f1f71ff0dde259c4";
export const OBSERVE_EXTRACTOR_FIXTURE_SHA256 = "f7f1956519af4fa5bae24eb03863a5e6fa7e0aa0873d3784e567ee75011b4bbc";
export const OBSERVE_EXTRACTOR_FIXTURE_GATE_V2 = Object.freeze({
  protocol: "oh.observe-extractor-fixture-gate.v2",
  requiredSessions: 12,
  minimumDenseCoverage: 0.95,
  minimumOtherCoverage: 1,
  maximumSemanticViolations: 0,
  requiredCompletedSessions: 12,
  requiresOriginalRubricPass: true,
} as const);

/** Keep the original eight sessions and their original rubric unchanged. */
export function makeObserveExtractorFixture(originalInput: unknown, stressInput: unknown): ObserveFixtureCorpus {
  const original = parseObserveFixtureCorpus(originalInput), stress = parseObserveFixtureCorpus(stressInput);
  if (canonicalSha256(original) !== OBSERVE_EXTRACTOR_ORIGINAL_FIXTURE_SHA256
    || canonicalSha256(stress) !== OBSERVE_EXTRACTOR_STRESS_FIXTURE_SHA256) throw new TypeError("Extractor fixture pin mismatch");
  return { ...original, corpora: [...original.corpora, ...stress.corpora], absent: [...original.absent, ...stress.absent] };
}

type Claim = Readonly<{ id: string; sessionId: string; required: boolean; speaker: string;
  sourceSets: readonly (readonly string[])[]; kinds: readonly OhObservationKindV1[];
  allText: readonly string[]; anyText: readonly string[]; forbiddenText: readonly string[];
  date: Readonly<{ expression: string; eventAt: string | null }> | null }>;
type ClaimInput = Omit<Claim, "required" | "speaker" | "forbiddenText" | "date"> & Partial<Pick<Claim, "required" | "speaker" | "forbiddenText" | "date">>;
const claim = (input: ClaimInput): Claim => ({ required: true, speaker: "user", forbiddenText: [], date: null, ...input });
const from = (session: string, ...indices: number[]) => [indices.map(index => `${session}:${index}`)];
const dense = "stress-dense", dates = "stress-dates", attribution = "stress-attribution", modality = "stress-modality";
const claims: readonly Claim[] = [
  ...Array.from({ length: 48 }, (_, i) => claim({ id: `bin-${String(i + 1).padStart(2, "0")}`, sessionId: dense,
    sourceSets: from(dense, Math.floor(i / 2)), kinds: ["fact"],
    allText: ["Indigo Annex", `R${String(i + 1).padStart(2, "0")}`, `${i + 18} brass clips`],
    anyText: ["contains", "holds", "stores", "has"], forbiddenText: ["not", "never", "no longer", "doesn't", "might", "could", "fictional", "hypothetical"] })),
  claim({ id: "year-joined", sessionId: dates, sourceSets: from(dates, 0), kinds: ["event", "fact"],
    allText: ["Mara", "Rill Guild", "2019"], anyText: ["joined", "became a member"], date: { expression: "2019", eventAt: null } }),
  claim({ id: "year-certificate", sessionId: dates, sourceSets: from(dates, 0), kinds: ["event", "fact"],
    allText: ["Mara", "Sedge Certificate", "2021"], anyText: ["completed", "earned", "received"], date: { expression: "2021", eventAt: null } }),
  claim({ id: "year-return-plan", sessionId: dates, sourceSets: from(dates, 0), kinds: ["plan"],
    allText: ["Mara", "Rill Guild", "2030"], anyText: ["plans", "intends", "planned"], date: { expression: "2030", eventAt: null } }),
  claim({ id: "ambiguous-date-order", sessionId: dates, sourceSets: from(dates, 1), kinds: ["event", "fact"],
    allText: ["Cedar Ferry", "inspection", "03/04/2027"], anyText: ["happened", "took place", "occurred", "was"], date: { expression: "03/04/2027", eventAt: null } }),
  claim({ id: "month-only", sessionId: dates, sourceSets: from(dates, 1), kinds: ["event", "fact"],
    allText: ["Bracken Lecture", "May 2027"], anyText: ["happened", "took place", "occurred", "was"], date: { expression: "May 2027", eventAt: null } }),
  claim({ id: "relative-month-unknown-day", sessionId: dates, sourceSets: from(dates, 1), kinds: ["plan"],
    allText: ["Gull Workshop", "next month"], anyText: ["planned", "plans", "scheduled"], date: { expression: "next month", eventAt: null } }),
  ...([{ id: "leap-day", name: "Amber Crate", expression: "yesterday", eventAt: "2028-02-29", kinds: ["event", "fact"] },
    { id: "relative-weeks", name: "Copper Crate", expression: "three weeks ago", eventAt: "2028-02-09", kinds: ["event", "fact"] },
    { id: "future-relative", name: "Silver Crate", expression: "tomorrow", eventAt: "2028-03-02", kinds: ["plan"] }] as const)
    .map(item => claim({ id: item.id, sessionId: dates, sourceSets: from(dates, 2), kinds: item.kinds,
      allText: [item.name, item.expression], anyText: ["arrived", "arrive", "arrival"], date: { expression: item.expression, eventAt: item.eventAt } })),
  claim({ id: "full-date", sessionId: dates, sourceSets: from(dates, 3), kinds: ["event", "fact"],
    allText: ["Jade Crate", "2028-02-03"], anyText: ["arrived", "arrival"], date: { expression: "2028-02-03", eventAt: "2028-02-03" } }),
  claim({ id: "owned-recorder", sessionId: attribution, sourceSets: from(attribution, 0), kinds: ["fact"],
    allText: ["Juniper M2"], anyText: ["owns", "own", "has"], forbiddenText: ["not", "never", "doesn't"] }),
  claim({ id: "assistant-buy-advice", sessionId: attribution, speaker: "assistant", sourceSets: from(attribution, 1), kinds: ["fact", "plan"],
    allText: ["Aster X7"], anyText: ["suggested", "suggests", "recommended", "recommends", "advised", "advises"] }),
  claim({ id: "assistant-move-advice", sessionId: attribution, speaker: "assistant", sourceSets: from(attribution, 1), kinds: ["fact", "plan"],
    allText: ["Harborview"], anyText: ["suggested", "suggests", "recommended", "recommends", "advised", "advises"] }),
  claim({ id: "keep-recorder", sessionId: attribution, sourceSets: from(attribution, 2), kinds: ["plan", "preference"],
    allText: ["Juniper M2"], anyText: ["keep", "retain"] }),
  claim({ id: "budget-correction", sessionId: attribution, sourceSets: from(attribution, 0, 4), kinds: ["update"],
    allText: ["budget", "changed from 800 EUR to 750 EUR"], anyText: [] }),
  claim({ id: "venue-correction", sessionId: attribution, sourceSets: from(attribution, 0, 4), kinds: ["update"],
    allText: ["workshop", "changed from Birch Room to Willow Room"], anyText: [] }),
  claim({ id: "contact-name", sessionId: attribution, sourceSets: from(attribution, 5), kinds: ["fact"],
    allText: ["contact", "Chloë Dvořák"], anyText: [] }),
  claim({ id: "booking-code", sessionId: attribution, sourceSets: from(attribution, 5), kinds: ["fact"],
    allText: ["code", "AB-0073"], anyText: [] }),
  claim({ id: "deposit", sessionId: attribution, sourceSets: from(attribution, 5), kinds: ["fact"],
    allText: ["deposit", "€1,204.50"], anyText: [] }),
  claim({ id: "old-budget", sessionId: attribution, required: false, sourceSets: from(attribution, 0), kinds: ["fact"],
    allText: ["budget", "800 EUR"], anyText: [] }),
  claim({ id: "old-venue", sessionId: attribution, required: false, sourceSets: from(attribution, 0), kinds: ["fact"],
    allText: ["workshop", "Birch Room"], anyText: [] }),
  claim({ id: "buy-nonacceptance", sessionId: attribution, required: false, sourceSets: from(attribution, 2), kinds: ["fact", "preference", "plan"],
    allText: ["Aster X7"], anyText: ["not agreed", "hasn't agreed", "declined", "rejected"] }),
  claim({ id: "move-nonacceptance", sessionId: attribution, required: false, sourceSets: from(attribution, 2), kinds: ["fact", "preference", "plan"],
    allText: ["Harborview"], anyText: ["not agreed", "hasn't agreed", "declined", "rejected"] }),
  claim({ id: "boat-negation", sessionId: modality, sourceSets: from(modality, 0), kinds: ["fact"],
    allText: ["boat"], anyText: ["never owned"] }),
  claim({ id: "quiet-preference", sessionId: modality, sourceSets: from(modality, 0), kinds: ["preference"],
    allText: ["quiet cabins"], anyText: ["prefers", "prefer", "likes"] }),
  claim({ id: "unconfirmed-rental", sessionId: modality, sourceSets: from(modality, 3), kinds: ["plan"],
    allText: ["Little Tern", "2031-06-14"], anyText: ["unconfirmed", "not confirmed", "not yet confirmed"],
    forbiddenText: ["rented", "completed"], date: { expression: "2031-06-14", eventAt: "2031-06-14" } }),
  claim({ id: "rehearsal-unavailability", sessionId: modality, sourceSets: from(modality, 3), kinds: ["fact", "plan"],
    allText: ["rehearsal", "2031-06-15"], anyText: ["cannot attend", "can't attend", "unable to attend"], date: { expression: "2031-06-15", eventAt: "2031-06-15" } }),
  claim({ id: "proposed-duration", sessionId: modality, sourceSets: from(modality, 4), kinds: ["plan", "fact"],
    allText: ["sailing", "1 hour 45 minutes"], anyText: ["proposed", "planned"] }),
  claim({ id: "proposed-distance", sessionId: modality, sourceSets: from(modality, 4), kinds: ["plan", "fact"],
    allText: ["route", "1.75 km"], anyText: ["proposed", "planned"] }),
];
export const OBSERVE_EXTRACTOR_SEMANTIC_RUBRIC_SHA256 = canonicalSha256({ claims, gate: OBSERVE_EXTRACTOR_FIXTURE_GATE_V2 });

function contains(text: string, needle: string): boolean {
  let fromIndex = 0;
  while (fromIndex <= text.length) {
    const index = text.indexOf(needle, fromIndex); if (index < 0) return false;
    const before = text[index - 1] ?? "", after = text[index + needle.length] ?? "";
    if ((!/[\p{L}\p{N}]/u.test(needle[0] ?? "") || !/[\p{L}\p{N}]/u.test(before))
      && (!/[\p{L}\p{N}]/u.test(needle.at(-1) ?? "") || !/[\p{L}\p{N}]/u.test(after))) return true;
    fromIndex = index + 1;
  }
  return false;
}
function matches(c: Claim, observation: ObserveRubricObservation): boolean {
  const folded = observation.text.toLocaleLowerCase("en-US");
  if (c.sessionId === dense) {
    const bin = c.allText[1]!, count = c.allText[2]!;
    // Bind the quantity to this bin; two correct token sets with swapped
    // quantities must not pass merely because they cite the same input turn.
    const direct = new RegExp(`\\b${bin}(?:\\s+bin)?(?:\\s+at\\s+Indigo Annex)?\\s+(?:contains|holds|stores|has)\\s+${count}\\b`, "u");
    const inverse = new RegExp(`\\b${count}\\s+(?:are\\s+)?(?:stored\\s+)?in\\s+(?:bin\\s+)?${bin}\\b`, "u");
    if (!direct.test(observation.text) && !inverse.test(observation.text)) return false;
  }
  return c.allText.every(needle => contains(observation.text, needle))
    && (c.speaker !== "assistant" || contains(folded, "assistant"))
    && (c.sessionId === dense || c.anyText.length === 0 || c.anyText.some(needle => contains(folded, needle)))
    && !c.forbiddenText.some(needle => contains(folded, needle));
}
function sourcesMatch(c: Claim, observation: ObserveRubricObservation): boolean {
  return c.sourceSets.some(set => set.length === observation.sourceTurnIds.length && set.every(id => observation.sourceTurnIds.includes(id)));
}
function datesMatch(c: Claim, observation: ObserveRubricObservation, sourceTexts: readonly string[]): boolean {
  const expected = c.date?.eventAt ?? null;
  if (observation.eventAt !== expected) return false;
  if (expected === null) { if (observation.resolvedFrom !== null) return false; }
  else {
    const expression = observation.resolvedFrom;
    if (expression === null || !sourceTexts.some(text => text.includes(expression)) || !observation.text.includes(expression)
      || expression.replace(/^(?:on|in|at) /iu, "") !== c.date!.expression) return false;
  }
  if (c.date !== null && !observation.text.includes(c.date.expression)) return false;
  return [...observation.text.matchAll(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/gu)].every(match => match[0] === expected);
}

type Violation = Readonly<{ check: "completion" | "bounds" | "source-attribution" | "kind" | "date" | "unmatched-observation" | "leakage";
  sessionId: string; claimId: string | null; observationIndex: number | null }>;

/** Input rows must be projected from parser-admitted observations, never raw model JSON.
 * Matching failures are not proof of falsehood: the fixed oracle may reject an
 * otherwise valid paraphrase. Freeze and inspect all results before any new run. */
export function scoreObserveExtractorFixture(fixture: ObserveFixtureCorpus, sessions: readonly ObserveRubricSession[]) {
  if (canonicalSha256(fixture) !== OBSERVE_EXTRACTOR_FIXTURE_SHA256) throw new TypeError("Extractor fixture pin mismatch");
  // Reuse existing exact session-set/status validation, without changing the legacy rubric.
  scoreObserveRubric(fixture, sessions);
  const originalIds = new Set(fixture.corpora.slice(0, 3).map(corpus => corpus.id));
  const originalFixture = { ...fixture, corpora: fixture.corpora.filter(corpus => originalIds.has(corpus.id)),
    absent: fixture.absent.filter(item => originalIds.has(item.corpusId)) };
  const originalRubric = scoreObserveRubric(originalFixture, sessions.filter(session => originalIds.has(session.corpusId)));
  const violations: Violation[] = [];
  const coverage: Array<{ sessionId: string; expected: number; matched: number; ratio: number; missing: string[] }> = [];
  const dateChecks = claims.filter(c => c.required && c.date !== null).length;
  const correctionChecks = claims.filter(c => c.required && c.kinds.length === 1 && c.kinds[0] === "update").length;
  let datePassed = 0, attributionChecks = 0, attributionPassed = 0, correctionPassed = 0;
  for (const session of sessions) {
    const add = (check: Violation["check"], observationIndex: number | null = null, claimId: string | null = null) => violations.push({ check, sessionId: session.sessionId, claimId, observationIndex });
    if (session.status !== "completed") add("completion");
    if (session.observations.length > OH_OBSERVATION_LIMITS_V1.observationsPerSession) add("bounds");
    const turns = new Map(fixture.corpora.find(corpus => corpus.id === session.corpusId)!.turns.filter(turn => turn.sessionId === session.sessionId).map(turn => [turn.id, turn]));
    for (const [index, observation] of session.observations.entries()) {
      if (Buffer.byteLength(observation.text) > OH_OBSERVATION_LIMITS_V1.textBytes || observation.text.length === 0
        || observation.sourceTurnIds.length === 0 || observation.sourceTurnIds.length > 16
        || new Set(observation.sourceTurnIds).size !== observation.sourceTurnIds.length) add("bounds", index);
      if (observation.sourceTurnIds.some(id => turns.get(id)?.speaker !== observation.speaker)) add("source-attribution", index);
    }
    const required = claims.filter(c => c.sessionId === session.sessionId && c.required);
    if (required.length === 0) continue;
    const recognized = new Set<number>(), matched = new Set<string>();
    // One observation may retain several facts when every fact has compatible
    // speaker, sources, kind and date. Token presence alone never earns coverage.
    for (const c of claims.filter(item => item.sessionId === session.sessionId)) {
      const candidates = session.observations.map((observation, index) => ({ observation, index }))
        .filter(({ observation }) => matches(c, observation))
        .map(({ observation, index }) => ({ index, attributed: observation.speaker === c.speaker && sourcesMatch(c, observation),
          dateCorrect: datesMatch(c, observation, observation.sourceTurnIds.flatMap(id => turns.get(id)?.text ?? [])), kindCorrect: c.kinds.includes(observation.kind) }));
      const passing = candidates.filter(item => item.attributed && item.dateCorrect && item.kindCorrect);
      for (const item of passing) recognized.add(item.index);
      if (passing.length > 0 && c.required) matched.add(c.id);
      if (!c.required && passing.length === 0) continue;
      const candidate = passing[0] ?? candidates[0];
      if (candidate === undefined) continue;
      attributionChecks++; if (candidate.attributed) attributionPassed++; else add("source-attribution", candidate.index, c.id);
      if (!candidate.kindCorrect) add("kind", candidate.index, c.id);
      if (!candidate.dateCorrect) add("date", candidate.index, c.id);
      if (c.required && c.date !== null && candidate.dateCorrect) datePassed++;
      if (c.required && c.kinds.length === 1 && c.kinds[0] === "update" && passing.length > 0) correctionPassed++;
    }
    coverage.push({ sessionId: session.sessionId, expected: required.length, matched: matched.size, ratio: matched.size / required.length,
      missing: required.filter(c => !matched.has(c.id)).map(c => c.id) });
    for (const [index] of session.observations.entries()) if (!recognized.has(index)) add("unmatched-observation", index);
    for (const absent of fixture.absent.filter(item => item.corpusId === session.corpusId && item.sessionId === session.sessionId)) {
      for (const [index, observation] of session.observations.entries()) if (observation.text.includes(absent.text)) add("leakage", index);
    }
  }
  const completedSessions = sessions.filter(session => session.status === "completed").length;
  const pass = originalRubric.pass && sessions.length === OBSERVE_EXTRACTOR_FIXTURE_GATE_V2.requiredSessions
    && completedSessions === OBSERVE_EXTRACTOR_FIXTURE_GATE_V2.requiredCompletedSessions && violations.length === 0
    && coverage.length === 4 && coverage.every(row => row.ratio >= (row.sessionId === dense
      ? OBSERVE_EXTRACTOR_FIXTURE_GATE_V2.minimumDenseCoverage : OBSERVE_EXTRACTOR_FIXTURE_GATE_V2.minimumOtherCoverage));
  const payload = { protocol: "oh.observe-extractor-fixture-report.v2", fixtureSha256: OBSERVE_EXTRACTOR_FIXTURE_SHA256,
    semanticRubricSha256: OBSERVE_EXTRACTOR_SEMANTIC_RUBRIC_SHA256, gate: OBSERVE_EXTRACTOR_FIXTURE_GATE_V2,
    sessions: sessions.length, completedSessions, originalRubric, coverage, violations,
    checks: { dateChecks, datePassed, attributionChecks, attributionPassed, correctionChecks, correctionPassed }, pass };
  return { ...payload, reportSha256: canonicalSha256(payload) };
}
