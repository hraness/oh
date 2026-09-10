/** Paired statistics over evolution reader/judge artifacts with repeat support.
 *
 * Pure: no I/O, no provider, no store. Every artifact is parsed from `unknown`
 * with exact keys and bounds. The module joins reader plans, reader outputs,
 * judge plans and judge outputs by (questionId, variantId, reader, repeat) with
 * requestSha256 as the integrity key, keeps only a digest of each answer, and
 * never emits question text, gold, answers or closed-partition question IDs.
 * Development-partition IDs may appear in flip and canary lists; closed flips
 * are counts only. This file is not a context-affecting module: it is absent
 * from EVOLUTION_CONTEXT_SOURCE_FILES, so retrieval identity is unchanged. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import type { Dataset } from "./datasets";
import { finitePopulationLowerBound, finitePopulationPValue } from "./finite-population";

export const EVOLUTION_PAIRED_STATS_PROTOCOL = "oh.memory.evolution-paired-stats.v1" as const;
export const EVOLUTION_PREDICTED_FLIPS_PROTOCOL = "oh.memory.evolution-predicted-flips.v1" as const;
export const EVOLUTION_POWER_PROTOCOL = "oh.memory.evolution-power.v1" as const;
export const EVOLUTION_MANIFEST_PROTOCOL = "oh.memory-evolution.dataset.v1" as const;
export const EVOLUTION_STRATA = ["development", "inspected-closed", "aggregate-only-closed"] as const;
export type EvolutionStratum = typeof EVOLUTION_STRATA[number];
/** Strata are declared inside the manifest group evidence text so the V1 disposition keys stay exact. */
export const EVOLUTION_STRATUM_EVIDENCE_PREFIX = /^stratum=([a-z-]+); /u;
export const EVOLUTION_PAIRED_ALPHA = 0.025;
export const EVOLUTION_CLEAR_GAIN_POINTS = 5;
export const EVOLUTION_VERDICT_RULE = "judge answer contains yes; reader or judge failure scores zero" as const;
const MANIFEST_KEYS = ["protocol", "dataset", "revision", "sourceSha256", "datasetSha256", "groups", "corpora", "questions", "qualification"] as const;
const GROUP_KEYS = ["groupId", "partition", "exposure", "evidence"] as const;
const QUESTION_KEYS = ["id", "runnerId", "corpusId", "groupId", "historyId", "category", "partition", "contentSha256"] as const;
const READER_CASE_KEYS = ["questionId", "variantId", "reader", "contextSha256", "requestSha256"] as const;
const JUDGE_CASE_KEYS = ["questionId", "variantId", "reader", "requestSha256", "readerFailed"] as const;
const MAX_ROWS = 512_000, MAX_QUESTIONS = 100_000, MAX_REPEATS = 100, MAX_RESAMPLES = 100_000, MAX_SIMULATIONS = 1_000_000, MAX_COMPARISONS = 64;

export type EvolutionPairedRow = Readonly<{
  questionId: string; variantId: string; reader: string; repeat: number; requestSha256: string; contextSha256: string;
  answerSha256: string | null; judgeRequestSha256: string | null; verdict: 0 | 1 | null; readerFailed: boolean; judgeFailed: boolean;
}>;
export type EvolutionQuestionMeta = Readonly<{
  runnerId: string; id: string; groupId: string; historyId: string; category: string; partition: string; stratum: string;
}>;
export type EvolutionArmKey = Readonly<{ variantId: string; reader: string }>;
export type EvolutionPairedComparisonRequest = Readonly<{ candidate: EvolutionArmKey; control: EvolutionArmKey }>;
export type EvolutionPredictedFlips = Readonly<{
  protocol: typeof EVOLUTION_PREDICTED_FLIPS_PROTOCOL; basisSha256: string;
  predictions: readonly Readonly<{ questionId: string; mechanism: string }>[];
}>;
export type EvolutionRunArtifacts = Readonly<{ readers: unknown; readersComplete: unknown; judges: unknown; judgesComplete: unknown }>;

function fail(message: string): never { throw new TypeError(`Evolution paired stats: ${message}.`); }
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) fail(`${label} requires exact keys ${keys.join(", ")}`);
  return value;
}
function loose(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(`${label} must be an object`);
  return value;
}
function text(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum) fail(`${label} must be nonempty text of at most ${maximum} bytes`);
  return value;
}
function digest(value: unknown, label: string): string {
  const parsed = parseSha256Hex(value);
  if (parsed === null) fail(`${label} must be a SHA-256 digest`);
  return parsed;
}
function list(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be an array of at most ${maximum} items`);
  return value;
}
function integer(value: unknown, label: string, maximum: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} must be an integer from ${minimum} through ${maximum}`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}
const armKey = (arm: EvolutionArmKey) => JSON.stringify([arm.variantId, arm.reader]);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const mean = (values: readonly number[]) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
function sampleSd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}
const round = (value: number, places = 6) => Number(value.toFixed(places));
const points = (fraction: number) => round(fraction * 100, 4);

/** Deterministic 32-bit generator (mulberry32) so a bootstrap or simulation reproduces from its seed. */
export function seededRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) fail("seed must be an unsigned 32-bit integer");
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exact one-sided binomial tail P(X >= wins | n = wins + losses, p = 1/2) in integer arithmetic. */
export function exactSignTestPValue(wins: number, losses: number): number {
  integer(wins, "wins", MAX_QUESTIONS); integer(losses, "losses", MAX_QUESTIONS);
  const n = wins + losses;
  if (n === 0) return 1;
  let coefficient = 1n, tail = 0n;
  for (let x = 0; x <= n; x++) {
    if (x >= wins) tail += coefficient;
    coefficient = (coefficient * BigInt(n - x)) / BigInt(x + 1);
  }
  const scale = 10n ** 18n;
  return Number((tail * scale) / (1n << BigInt(n))) / 1e18;
}

/** Acklam's rational approximation of the standard normal quantile (relative error about 1e-9). */
export function normalQuantile(p: number): number {
  if (typeof p !== "number" || !(p > 0 && p < 1)) fail("quantile probability must lie strictly inside (0, 1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239] as const;
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1] as const;
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783] as const;
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416] as const;
  const low = 0.02425, high = 1 - low;
  if (p < low || p > high) {
    const q = Math.sqrt(-2 * Math.log(p < low ? p : 1 - p));
    const value = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return p < low ? value : -value;
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Holm step-down over one-sided p-values: adjusted p-values and the per-test level each test must meet. */
export function holmAdjust(pValues: readonly number[], alpha: number): readonly Readonly<{ adjustedP: number; level: number; rejected: boolean }>[] {
  if (!(alpha > 0 && alpha < 1)) fail("alpha must lie strictly inside (0, 1)");
  if (pValues.some(p => !(p >= 0 && p <= 1))) fail("p-values must lie inside [0, 1]");
  const m = pValues.length, order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p || x.i - y.i);
  const output = pValues.map(() => ({ adjustedP: 1, level: alpha, rejected: false }));
  let running = 0, stillRejecting = true;
  for (const [rank, { p, i }] of order.entries()) {
    const level = alpha / (m - rank);
    running = Math.max(running, Math.min(1, (m - rank) * p));
    stillRejecting = stillRejecting && p <= level;
    output[i] = { adjustedP: round(running, 8), level: round(level, 8), rejected: stillRejecting };
  }
  return output;
}

type Response = Readonly<{ status: string; answerSha256: string | null; answerText: string | null }>;
function responseTable(value: unknown, label: string): ReadonlyMap<string, Response> {
  const output = new Map<string, Response>();
  for (const item of list(value, label, MAX_ROWS)) {
    const entry = record(item, ["requestSha256", "response"], `${label} entry`), response = loose(entry.response, `${label} response`);
    const key = digest(entry.requestSha256, `${label} request digest`);
    if (response.requestSha256 !== key || output.has(key)) fail(`${label} response identity mismatch or duplicate`);
    const status = text(response.status, `${label} status`, 64), answer = response.answer;
    if (answer !== null && typeof answer !== "string") fail(`${label} answer must be text or null`);
    output.set(key, { status, answerSha256: answer === null ? null : sha256Hex(answer), answerText: answer });
  }
  return output;
}

/** Join one run directory's four artifacts into rows for one repeat index. Verdict rule: judge answer contains "yes". */
export function loadEvolutionRunRows(artifacts: EvolutionRunArtifacts, repeat: number): readonly EvolutionPairedRow[] {
  integer(repeat, "repeat", MAX_REPEATS);
  const readers = loose(artifacts.readers, "reader plan"), readersComplete = loose(artifacts.readersComplete, "reader output");
  const judges = loose(artifacts.judges, "judge plan"), judgesComplete = loose(artifacts.judgesComplete, "judge output");
  if (!text(readers.protocol, "reader plan protocol").startsWith("oh.memory.evolution-reader-plan.")) fail("unknown reader plan protocol");
  if (!text(judges.protocol, "judge plan protocol").startsWith("oh.memory.evolution-judge-plan.")) fail("unknown judge plan protocol");
  if (judges.scoringRule !== "native-contains-yes") fail("only the native contains-yes scoring rule is supported");
  const readerPlanSha256 = digest(readers.planSha256, "reader plan digest"), judgePlanSha256 = digest(judges.planSha256, "judge plan digest");
  if (readersComplete.phase !== "reader" || readersComplete.planSha256 !== readerPlanSha256) fail("reader output does not pin the reader plan");
  if (judges.readerPlanSha256 !== readerPlanSha256) fail("judge plan does not pin the reader plan");
  if (judgesComplete.phase !== "judge" || judgesComplete.planSha256 !== judgePlanSha256) fail("judge output does not pin the judge plan");
  if (readersComplete.complete !== true || judgesComplete.complete !== true) fail("both phases must be complete");
  const readerResponses = responseTable(readersComplete.responses, "reader output"), judgeResponses = responseTable(judgesComplete.responses, "judge output");
  const judgeCases = new Map<string, Readonly<{ requestSha256: string | null; readerFailed: boolean }>>();
  for (const item of list(judges.cases, "judge cases", MAX_ROWS)) {
    const c = record(item, JUDGE_CASE_KEYS, "judge case");
    const key = JSON.stringify([text(c.questionId, "question ID"), text(c.variantId, "variant ID"), text(c.reader, "reader")]);
    const readerFailed = boolean(c.readerFailed, "readerFailed");
    if (judgeCases.has(key)) fail("duplicate judge case");
    const requestSha256 = c.requestSha256 === null ? null : digest(c.requestSha256, "judge request digest");
    if (readerFailed !== (requestSha256 === null)) fail("judge case failure flag disagrees with its request");
    judgeCases.set(key, { requestSha256, readerFailed });
  }
  const seen = new Set<string>(), rows: EvolutionPairedRow[] = [];
  for (const item of list(readers.cases, "reader cases", MAX_ROWS)) {
    const c = record(item, READER_CASE_KEYS, "reader case");
    const questionId = text(c.questionId, "question ID"), variantId = text(c.variantId, "variant ID"), reader = text(c.reader, "reader");
    const key = JSON.stringify([questionId, variantId, reader]);
    if (seen.has(key)) fail("duplicate reader case");
    seen.add(key);
    const requestSha256 = digest(c.requestSha256, "reader request digest"), response = readerResponses.get(requestSha256), judgeCase = judgeCases.get(key);
    if (response === undefined || judgeCase === undefined) fail("reader case lacks a response or a judge case");
    const judged = judgeCase.requestSha256 === null ? null : judgeResponses.get(judgeCase.requestSha256);
    if (judged === undefined) fail("judge case lacks a response");
    const verdict = judged !== null && judged.status === "completed" && judged.answerText !== null ? Number(judged.answerText.toLowerCase().includes("yes")) as 0 | 1 : null;
    rows.push({ questionId, variantId, reader, repeat, requestSha256, contextSha256: digest(c.contextSha256, "context digest"),
      answerSha256: response.status === "completed" ? response.answerSha256 : null, judgeRequestSha256: judgeCase.requestSha256, verdict,
      readerFailed: judgeCase.readerFailed, judgeFailed: !judgeCase.readerFailed && verdict === null });
  }
  if (judgeCases.size !== rows.length) fail("judge cases do not cover the reader cases exactly");
  return rows.sort((a, b) => compare(a.questionId, b.questionId) || compare(a.variantId, b.variantId) || compare(a.reader, b.reader));
}

function manifestRecord(manifest: unknown): Record<string, unknown> {
  const m = record(manifest, MANIFEST_KEYS, "manifest");
  if (m.protocol !== EVOLUTION_MANIFEST_PROTOCOL) fail("unknown manifest protocol");
  return m;
}

/** Question metadata and strata from an exposure manifest: a V1 pin (stratum = partition) or the V2 strata declaration. */
export function loadEvolutionQuestionMeta(manifest: unknown): readonly EvolutionQuestionMeta[] {
  const m = manifestRecord(manifest);
  const strata = new Map<string, string>();
  for (const item of list(m.groups, "groups", MAX_QUESTIONS)) {
    const g = record(item, GROUP_KEYS, "group"), groupId = text(g.groupId, "group ID"), partition = text(g.partition, "partition");
    const tag = EVOLUTION_STRATUM_EVIDENCE_PREFIX.exec(text(g.evidence, "evidence", 4_096));
    let stratum = partition;
    if (tag !== null) {
      stratum = tag[1] ?? "";
      if (!(EVOLUTION_STRATA as readonly string[]).includes(stratum)) fail("unknown stratum tag");
      if ((stratum === "development") !== (partition === "development")) fail("stratum tag disagrees with the partition");
      if (stratum !== "development" && (partition !== "closed" || g.exposure !== "evaluated")) fail("closed strata require the closed partition with evaluated exposure");
    }
    if (strata.has(groupId)) fail("duplicate group");
    strata.set(groupId, stratum);
  }
  const output = list(m.questions, "questions", MAX_QUESTIONS).map(item => {
    const q = record(item, QUESTION_KEYS, "question"), groupId = text(q.groupId, "question group"), stratum = strata.get(groupId);
    if (stratum === undefined) fail("question references an undeclared group");
    return { runnerId: text(q.runnerId, "runner ID"), id: text(q.id, "question ID"), groupId, historyId: text(q.historyId, "history ID"),
      category: text(q.category, "category"), partition: text(q.partition, "partition"), stratum };
  });
  if (new Set(output.map(q => q.runnerId)).size !== output.length || new Set(output.map(q => q.id)).size !== output.length) fail("duplicate question");
  return output;
}

export type EvolutionStrataEvidence = Readonly<{ evaluated: string; inspected: string; aggregateOnly: string }>;

/** Produce the V2 strata declaration beside a V1 pin: partitions unchanged, closed exposure evaluated, strata tagged in evidence. */
export function declareEvolutionStrata(manifest: unknown, inspectedQuestionIds: readonly string[], evidence: EvolutionStrataEvidence): Record<string, unknown> {
  const m = manifestRecord(manifest), meta = loadEvolutionQuestionMeta(manifest);
  const inspected = new Set(list(inspectedQuestionIds, "inspected IDs", MAX_QUESTIONS).map(id => text(id, "inspected ID")));
  if (inspected.size !== inspectedQuestionIds.length) fail("duplicate inspected ID");
  const known = new Map(meta.map(q => [q.id, q])), inspectedGroups = new Set<string>();
  for (const id of inspected) {
    const q = known.get(id);
    if (q === undefined) fail("inspected ID is not in the manifest");
    if (q.partition !== "closed") fail("inspected declarations cover closed questions only; development questions are already development");
    inspectedGroups.add(q.groupId);
  }
  for (const value of [evidence.evaluated, evidence.inspected, evidence.aggregateOnly]) text(value, "evidence", 3_500);
  const groups = list(m.groups, "groups", MAX_QUESTIONS).map(item => {
    const g = record(item, GROUP_KEYS, "group"), previous = text(g.evidence, "evidence", 4_096);
    if (EVOLUTION_STRATUM_EVIDENCE_PREFIX.test(previous)) fail("manifest already declares strata");
    if (g.partition === "development") return { groupId: g.groupId, partition: g.partition, exposure: g.exposure, evidence: `stratum=development; ${previous}` };
    if (g.partition !== "closed") fail("only development and closed partitions can be declared as evaluated strata");
    const stratum: EvolutionStratum = inspectedGroups.has(g.groupId as string) ? "inspected-closed" : "aggregate-only-closed";
    return { groupId: g.groupId, partition: g.partition, exposure: "evaluated",
      evidence: `stratum=${stratum}; ${evidence.evaluated} ${stratum === "inspected-closed" ? evidence.inspected : evidence.aggregateOnly}` };
  });
  return { protocol: m.protocol, dataset: m.dataset, revision: m.revision, sourceSha256: m.sourceSha256, datasetSha256: m.datasetSha256,
    groups, corpora: m.corpora, questions: m.questions, qualification: m.qualification };
}

/** Counts per stratum for a table header; never lists identifiers. */
export function summarizeEvolutionStrata(questions: readonly EvolutionQuestionMeta[]) {
  const counts = new Map<string, { questions: number; groups: Set<string> }>();
  for (const q of questions) {
    const bucket = counts.get(q.stratum) ?? { questions: 0, groups: new Set<string>() };
    bucket.questions++; bucket.groups.add(q.groupId); counts.set(q.stratum, bucket);
  }
  return [...counts.entries()].sort((a, b) => compare(a[0], b[0])).map(([stratum, v]) => ({ stratum, questions: v.questions, groups: v.groups.size }));
}

/** Content-based reclustering: questions whose labeled evidence sessions share a normalized session text belong to one
 * cluster. Linking on any shared haystack session is not used: LongMemEval haystacks reuse filler sessions so widely that
 * that rule joins every question into one component and leaves nothing to resample. */
export function contentClusters(dataset: Pick<Dataset, "corpora" | "questions">): ReadonlyMap<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? fail("unknown corpus in cluster forest");
    let cursor = x;
    while (cursor !== root) { const next = parent.get(cursor) ?? root; parent.set(cursor, root); cursor = next; }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (compare(ra, rb) < 0) parent.set(rb, ra); else parent.set(ra, rb);
  };
  const sessionDigests = new Map<string, ReadonlyMap<string, string>>();
  for (const corpus of dataset.corpora) {
    if (parent.has(corpus.id)) fail("duplicate corpus");
    parent.set(corpus.id, corpus.id);
    const sessions = new Map<string, string[]>();
    for (const turn of corpus.turns) {
      const bucket = sessions.get(turn.sessionId) ?? [];
      bucket.push(`${turn.speaker.toLowerCase()} ${turn.text.toLowerCase().replace(/\s+/gu, " ").trim()}`);
      sessions.set(turn.sessionId, bucket);
    }
    sessionDigests.set(corpus.id, new Map([...sessions].map(([sessionId, lines]) => [sessionId, sha256Hex(lines.join("\n"))])));
  }
  const owners = new Map<string, string>();
  for (const question of dataset.questions) {
    const digests = sessionDigests.get(question.corpusId);
    if (digests === undefined) fail("question references an unknown corpus");
    for (const sessionId of question.evidenceSessionIds) {
      const key = digests.get(sessionId);
      if (key === undefined) fail("question references an evidence session outside its corpus");
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, question.corpusId); else union(owner, question.corpusId);
    }
  }
  const output = new Map<string, string>();
  for (const question of dataset.questions) output.set(question.id, find(question.corpusId));
  return output;
}

export function parseEvolutionPredictedFlips(value: unknown): EvolutionPredictedFlips {
  const v = record(value, ["protocol", "basisSha256", "predictions"], "predicted flips");
  if (v.protocol !== EVOLUTION_PREDICTED_FLIPS_PROTOCOL) fail("unknown predicted-flips protocol");
  const predictions = list(v.predictions, "predictions", MAX_QUESTIONS).map(item => {
    const p = record(item, ["questionId", "mechanism"], "prediction");
    return { questionId: text(p.questionId, "predicted question ID"), mechanism: text(p.mechanism, "mechanism", 128) };
  });
  if (new Set(predictions.map(p => p.questionId)).size !== predictions.length) fail("duplicate prediction");
  return { protocol: EVOLUTION_PREDICTED_FLIPS_PROTOCOL, basisSha256: digest(v.basisSha256, "prediction basis"), predictions };
}

type ArmTable = Readonly<{ key: string; arm: EvolutionArmKey; repeats: readonly number[]; questions: readonly string[];
  verdicts: ReadonlyMap<string, readonly (0 | 1)[]>; meanScore: ReadonlyMap<string, number>; majority: ReadonlyMap<string, 0 | 1>;
  answers: ReadonlyMap<string, readonly (string | null)[]>; failures: ReadonlyMap<number, Readonly<{ reader: number; judge: number }>> }>;

function buildArms(rows: readonly EvolutionPairedRow[], meta: ReadonlyMap<string, EvolutionQuestionMeta>): readonly ArmTable[] {
  const contexts = new Map<string, string>(), keys = new Set<string>(), grouped = new Map<string, EvolutionPairedRow[]>();
  for (const row of rows) {
    if (!meta.has(row.questionId)) fail("row references a question outside the manifest");
    integer(row.repeat, "repeat", MAX_REPEATS); digest(row.requestSha256, "request digest"); digest(row.contextSha256, "context digest");
    const contextKey = JSON.stringify([row.questionId, row.variantId]), context = contexts.get(contextKey);
    if (context !== undefined && context !== row.contextSha256) fail("context digest differs across readers or repeats of one variant");
    contexts.set(contextKey, row.contextSha256);
    const rowKey = JSON.stringify([row.questionId, row.variantId, row.reader, row.repeat]);
    if (keys.has(rowKey)) fail("duplicate row for one question, arm and repeat");
    keys.add(rowKey);
    const key = armKey(row), bucket = grouped.get(key) ?? [];
    bucket.push(row); grouped.set(key, bucket);
  }
  return [...grouped.entries()].sort((a, b) => compare(a[0], b[0])).map(([key, armRows]) => {
    const repeats = [...new Set(armRows.map(r => r.repeat))].sort((a, b) => a - b);
    const questions = [...new Set(armRows.map(r => r.questionId))].sort(compare);
    const byQuestion = new Map<string, Map<number, EvolutionPairedRow>>();
    for (const row of armRows) {
      const m = byQuestion.get(row.questionId) ?? new Map<number, EvolutionPairedRow>();
      m.set(row.repeat, row); byQuestion.set(row.questionId, m);
    }
    const verdicts = new Map<string, (0 | 1)[]>(), meanScore = new Map<string, number>(), majority = new Map<string, 0 | 1>(), answers = new Map<string, (string | null)[]>();
    const failures = new Map<number, { reader: number; judge: number }>(repeats.map(r => [r, { reader: 0, judge: 0 }]));
    for (const q of questions) {
      const perRepeat = byQuestion.get(q) ?? new Map<number, EvolutionPairedRow>();
      const v: (0 | 1)[] = [], a: (string | null)[] = [];
      for (const r of repeats) {
        const row = perRepeat.get(r);
        if (row === undefined) fail("incomplete repeat matrix: every question needs every repeat of its arm");
        v.push(row.verdict ?? 0); a.push(row.answerSha256);
        const f = failures.get(r) ?? { reader: 0, judge: 0 };
        f.reader += Number(row.readerFailed); f.judge += Number(row.judgeFailed); failures.set(r, f);
      }
      verdicts.set(q, v); answers.set(q, a);
      const m = mean(v); meanScore.set(q, m); majority.set(q, m > 0.5 ? 1 : 0);
    }
    const first = armRows[0] ?? fail("empty arm");
    return { key, arm: { variantId: first.variantId, reader: first.reader }, repeats, questions, verdicts, meanScore, majority, answers, failures };
  });
}

const metaOf = (meta: ReadonlyMap<string, EvolutionQuestionMeta>, q: string) => meta.get(q) ?? fail("question metadata missing");
const verdictsOf = (arm: ArmTable, q: string) => arm.verdicts.get(q) ?? fail("verdicts missing");
const meanOf = (arm: ArmTable, q: string) => arm.meanScore.get(q) ?? fail("mean missing");
const majorityOf = (arm: ArmTable, q: string) => arm.majority.get(q) ?? fail("majority missing");
const answersOf = (arm: ArmTable, q: string) => arm.answers.get(q) ?? fail("answers missing");

function slice(questions: readonly string[], meta: ReadonlyMap<string, EvolutionQuestionMeta>, by: (m: EvolutionQuestionMeta) => string) {
  const buckets = new Map<string, string[]>();
  for (const q of questions) { const k = by(metaOf(meta, q)); const b = buckets.get(k) ?? []; b.push(q); buckets.set(k, b); }
  return [...buckets.entries()].sort((a, b) => compare(a[0], b[0]));
}

function armSummary(arm: ArmTable, meta: ReadonlyMap<string, EvolutionQuestionMeta>) {
  const totals = arm.repeats.map((_, i) => arm.questions.reduce((s, q) => s + (verdictsOf(arm, q)[i] ?? 0), 0));
  const majorityCorrect = arm.questions.reduce((s, q) => s + majorityOf(arm, q), 0);
  const disagreeing = arm.questions.filter(q => new Set(verdictsOf(arm, q)).size > 1).length;
  const identicalAnswers = arm.questions.filter(q => { const a = answersOf(arm, q); return a.every(x => x !== null && x === a[0]); }).length;
  let comparablePairs = 0, judgeFlips = 0;
  for (const q of arm.questions) {
    const a = answersOf(arm, q), v = verdictsOf(arm, q);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      if (a[i] !== null && a[i] === a[j]) { comparablePairs++; if (v[i] !== v[j]) judgeFlips++; }
    }
  }
  const sliced = (by: (m: EvolutionQuestionMeta) => string) => slice(arm.questions, meta, by).map(([label, qs]) => ({
    label, questions: qs.length, meanCorrect: round(mean(arm.repeats.map((_, i) => qs.reduce((s, q) => s + (verdictsOf(arm, q)[i] ?? 0), 0)))),
    majorityCorrect: qs.reduce((s, q) => s + majorityOf(arm, q), 0) }));
  const sd = sampleSd(totals);
  return { variantId: arm.arm.variantId, reader: arm.arm.reader, questions: arm.questions.length, repeats: arm.repeats,
    perRepeat: arm.repeats.map((repeat, i) => ({ repeat, correct: totals[i] ?? 0, readerFailures: arm.failures.get(repeat)?.reader ?? 0, judgeFailures: arm.failures.get(repeat)?.judge ?? 0 })),
    meanCorrect: round(mean(totals)), meanAccuracyPoints: points(mean(totals) / arm.questions.length), sdCorrect: sd === null ? null : round(sd),
    range: [Math.min(...totals), Math.max(...totals)], majorityCorrect,
    // Judge-only repeats (same reader output judged again) show up as identical answers in every repeat.
    judgeRepeatOnly: arm.repeats.length > 1 && identicalAnswers === arm.questions.length,
    readerFlip: arm.repeats.length < 2 ? null : { questionsWithDisagreement: disagreeing, rate: round(disagreeing / arm.questions.length), identicalAnswerAllRepeats: identicalAnswers },
    judgeFlip: arm.repeats.length < 2 ? null : { identicalAnswerPairs: comparablePairs, flippedPairs: judgeFlips, rate: comparablePairs ? round(judgeFlips / comparablePairs) : null },
    byStratum: sliced(m => m.stratum), byCategory: sliced(m => m.category) };
}

function bootstrap(clusters: readonly Readonly<{ sum: number; count: number }>[], resamples: number, random: () => number): Float64Array {
  const output = new Float64Array(resamples), g = clusters.length;
  for (let b = 0; b < resamples; b++) {
    let sum = 0, count = 0;
    for (let i = 0; i < g; i++) { const c = clusters[Math.floor(random() * g)] ?? fail("empty cluster list"); sum += c.sum; count += c.count; }
    output[b] = count === 0 ? 0 : (sum / count) * 100;
  }
  return output.sort();
}
const quantile = (sorted: Float64Array, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
const interval = (samples: Float64Array, alpha: number, resamples: number) => ({
  lowerBoundPoints: round(quantile(samples, alpha), 4), intervalPoints: [round(quantile(samples, alpha), 4), round(quantile(samples, 1 - alpha), 4)] as const,
  pDeltaAtMostZero: round(samples.filter(x => x <= 0).length / resamples) });

export type EvolutionPairedAnalysisInput = Readonly<{
  rows: readonly EvolutionPairedRow[]; questions: readonly EvolutionQuestionMeta[];
  comparisons: readonly EvolutionPairedComparisonRequest[]; resamples?: number; seed?: number; alpha?: number;
  reclusters?: ReadonlyMap<string, string>; predictions?: EvolutionPredictedFlips; poolSize?: number; canaries?: readonly string[];
}>;

/** Paired analysis: per-question mean over repeats, majority-of-k, W/L/T, exact sign test, cluster bootstrap with Holm,
 * content-recluster sensitivity, finite-population bound, slices, flip rates, recoverable pool and predicted-flip precision/recall. */
export function analyzeEvolutionPairs(input: EvolutionPairedAnalysisInput) {
  const resamples = integer(input.resamples ?? 10_000, "resamples", MAX_RESAMPLES, 100), seed = input.seed ?? 17, alpha = input.alpha ?? EVOLUTION_PAIRED_ALPHA;
  if (!(alpha > 0 && alpha < 0.5)) fail("alpha must lie strictly inside (0, 0.5)");
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > MAX_ROWS) fail("rows must be a bounded nonempty array");
  const meta = new Map(list(input.questions, "questions", MAX_QUESTIONS).map(q => {
    const m = record(q, ["runnerId", "id", "groupId", "historyId", "category", "partition", "stratum"], "question metadata") as unknown as EvolutionQuestionMeta;
    return [m.runnerId, m] as const;
  }));
  if (meta.size !== input.questions.length) fail("duplicate question metadata");
  const arms = buildArms(input.rows, meta), byKey = new Map(arms.map(a => [a.key, a]));
  const random = seededRandom(seed);
  const requests = list(input.comparisons, "comparisons", MAX_COMPARISONS).map(c => {
    const r = record(c, ["candidate", "control"], "comparison");
    const candidate = record(r.candidate, ["variantId", "reader"], "candidate"), control = record(r.control, ["variantId", "reader"], "control");
    const left = byKey.get(armKey({ variantId: text(candidate.variantId, "variant"), reader: text(candidate.reader, "reader") }));
    const right = byKey.get(armKey({ variantId: text(control.variantId, "variant"), reader: text(control.reader, "reader") }));
    if (left === undefined || right === undefined || left === right) fail("comparison names an unknown arm or the same arm twice");
    if (JSON.stringify(left.questions) !== JSON.stringify(right.questions)) fail("compared arms cover different question sets");
    return { candidate: left, control: right };
  });
  const byId = new Map<string, string>();
  for (const [runnerId, m] of meta) byId.set(m.id, runnerId);
  const canaries = list(input.canaries ?? [], "canaries", 1_000).map(id => {
    const runnerId = byId.get(text(id, "canary ID"));
    if (runnerId === undefined || metaOf(meta, runnerId).partition !== "development") fail("canary IDs must name development-partition questions");
    return { id: id as string, runnerId };
  });
  const comparisons = requests.map(({ candidate, control }) => {
    const questions = candidate.questions;
    const delta = new Map(questions.map(q => [q, meanOf(candidate, q) - meanOf(control, q)] as const));
    const deltaOf = (q: string) => delta.get(q) ?? 0;
    const wins = questions.filter(q => deltaOf(q) > 0).length, losses = questions.filter(q => deltaOf(q) < 0).length;
    const majorityWins = questions.filter(q => majorityOf(candidate, q) > majorityOf(control, q)).length;
    const majorityLosses = questions.filter(q => majorityOf(candidate, q) < majorityOf(control, q)).length;
    const meanDelta = mean(questions.map(deltaOf));
    const clustersBy = (by: (q: string) => string) => {
      const buckets = new Map<string, { sum: number; count: number }>();
      for (const q of questions) { const k = by(q), b = buckets.get(k) ?? { sum: 0, count: 0 }; b.sum += deltaOf(q); b.count++; buckets.set(k, b); }
      return [...buckets.entries()].sort((a, b) => compare(a[0], b[0])).map(([, v]) => v);
    };
    const declared = clustersBy(q => metaOf(meta, q).groupId), samples = bootstrap(declared, resamples, random);
    const reclusterMap = input.reclusters;
    const reclustered = reclusterMap === undefined ? null : (() => {
      // The sensitivity clustering is at least as coarse as the declared grouping: a content link and a declared group both join.
      const forest = new Map<string, string>();
      const find = (x: string): string => { let root = x; while (forest.get(root) !== root) root = forest.get(root) ?? fail("cluster forest"); forest.set(x, root); return root; };
      const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) forest.set(compare(ra, rb) < 0 ? rb : ra, compare(ra, rb) < 0 ? ra : rb); };
      for (const q of questions) {
        const m = metaOf(meta, q), content = reclusterMap.get(m.id);
        if (content === undefined) fail("recluster map lacks a compared question");
        for (const key of [q, `group:${m.groupId}`, `content:${content}`]) if (!forest.has(key)) forest.set(key, key);
        join(q, `group:${m.groupId}`); join(q, `content:${content}`);
      }
      const clusters = clustersBy(find);
      return { clusters: clusters.length, ...interval(bootstrap(clusters, resamples, random), alpha, resamples) };
    })();
    const pool = input.poolSize ?? questions.length;
    const finite = questions.length <= 1000 && pool >= questions.length && pool <= 1000
      ? { poolSize: pool, wins: majorityWins, losses: majorityLosses, lowerBound: round(finitePopulationLowerBound(pool, questions.length, majorityWins, majorityLosses, alpha)),
        oneSidedPValue: round(finitePopulationPValue(pool, questions.length, majorityWins, majorityLosses), 8) }
      : null;
    const sliced = (by: (m: EvolutionQuestionMeta) => string) => slice(questions, meta, by).map(([label, qs]) => ({ label, questions: qs.length,
      wins: qs.filter(q => deltaOf(q) > 0).length, losses: qs.filter(q => deltaOf(q) < 0).length, ties: qs.filter(q => deltaOf(q) === 0).length,
      candidateMean: round(qs.reduce((s, q) => s + meanOf(candidate, q), 0)), controlMean: round(qs.reduce((s, q) => s + meanOf(control, q), 0)),
      deltaPoints: points(mean(qs.map(deltaOf))) }));
    const developmentIds = (predicate: (q: string) => boolean) => questions.filter(q => metaOf(meta, q).partition === "development" && predicate(q)).map(q => metaOf(meta, q).id).sort(compare);
    const gained = (q: string) => majorityOf(candidate, q) === 1 && majorityOf(control, q) === 0, lost = (q: string) => majorityOf(candidate, q) === 0 && majorityOf(control, q) === 1;
    const replicated = (q: string) => verdictsOf(candidate, q).every(v => v === 1) && verdictsOf(control, q).every(v => v === 0);
    const predictionFile = input.predictions;
    const predictions = predictionFile === undefined ? null : (() => {
      const inScope = new Map(questions.map(q => [metaOf(meta, q).id, q] as const));
      const predicted = predictionFile.predictions.filter(p => inScope.has(p.questionId));
      const predictedSet = new Set(predicted.map(p => inScope.get(p.questionId) ?? ""));
      const gainedSet = new Set(questions.filter(gained)), hits = [...predictedSet].filter(q => gainedSet.has(q));
      const mechanisms = [...new Set(predicted.map(p => p.mechanism))].sort(compare).map(mechanism => {
        const ids = predicted.filter(p => p.mechanism === mechanism).map(p => inScope.get(p.questionId) ?? "");
        return { mechanism, predicted: ids.length, realized: ids.filter(q => gainedSet.has(q)).length };
      });
      const unpredictedGains = questions.filter(q => gainedSet.has(q) && !predictedSet.has(q));
      return { basisSha256: predictionFile.basisSha256, predictedInScope: predictedSet.size, predictedOutsideScope: predictionFile.predictions.length - predicted.length,
        realized: hits.length, precision: predictedSet.size ? round(hits.length / predictedSet.size) : null, recall: gainedSet.size ? round(hits.length / gainedSet.size) : null,
        unpredictedGains: unpredictedGains.length, unpredictedGainsReplicatedInAllRepeats: unpredictedGains.filter(replicated).length,
        unpredictedLosses: questions.filter(q => lost(q) && !predictedSet.has(q)).length, byMechanism: mechanisms };
    })();
    return { candidate: candidate.arm, control: control.arm, questions: questions.length, repeats: { candidate: candidate.repeats.length, control: control.repeats.length },
      wins, losses, ties: questions.length - wins - losses, majority: { wins: majorityWins, losses: majorityLosses, ties: questions.length - majorityWins - majorityLosses },
      meanDeltaPoints: points(meanDelta), signTest: { discordant: wins + losses, wins, oneSidedPValue: round(exactSignTestPValue(wins, losses), 8) },
      clusterBootstrap: { clusters: declared.length, resamples, seed, ...interval(samples, alpha, resamples) },
      contentReclusterBootstrap: reclustered, finitePopulation: finite, byCategory: sliced(m => m.category), byStratum: sliced(m => m.stratum),
      developmentFlips: { gained: developmentIds(gained), lost: developmentIds(lost), replicatedGains: developmentIds(q => gained(q) && replicated(q)) },
      closedFlips: { gained: questions.filter(q => metaOf(meta, q).partition !== "development" && gained(q)).length, lost: questions.filter(q => metaOf(meta, q).partition !== "development" && lost(q)).length },
      predictedFlips: predictions, samples };
  });
  const holm = holmAdjust(comparisons.map(c => Math.max(c.clusterBootstrap.pDeltaAtMostZero, 1 / resamples)), alpha);
  const decided = comparisons.map(({ samples, ...c }, i) => {
    const h = holm[i] ?? fail("Holm output missing"), holmLowerBound = round(quantile(samples, h.level), 4);
    return { ...c, holm: { level: h.level, adjustedP: h.adjustedP, lowerBoundPoints: holmLowerBound, better: holmLowerBound > 0,
      clearlyBetter: holmLowerBound > 0 && c.meanDeltaPoints >= EVOLUTION_CLEAR_GAIN_POINTS } };
  });
  const allQuestions = [...new Set(arms.flatMap(a => a.questions))].sort(compare);
  const anyMajority = allQuestions.filter(q => arms.some(a => a.majority.get(q) === 1)).length;
  const recoverable = arms.map(a => ({ variantId: a.arm.variantId, reader: a.arm.reader,
    recoverableFromOtherArms: a.questions.filter(q => a.majority.get(q) === 0 && arms.some(o => o !== a && o.majority.get(q) === 1)).length }));
  return { protocol: EVOLUTION_PAIRED_STATS_PROTOCOL, alpha, verdictRule: EVOLUTION_VERDICT_RULE,
    questions: allQuestions.length, strata: summarizeEvolutionStrata(allQuestions.map(q => metaOf(meta, q))),
    arms: arms.map(a => armSummary(a, meta)), comparisons: decided,
    canaries: canaries.map(c => ({ id: c.id, byArm: arms.filter(a => a.meanScore.has(c.runnerId)).map(a => ({ variantId: a.arm.variantId, reader: a.arm.reader, meanCorrect: round(meanOf(a, c.runnerId)) })) })),
    recoverablePool: { rule: "a question counts as answered by an arm when correct in a majority of that arm's repeats", questions: allQuestions.length,
      anyArmMajorityCorrect: anyMajority, allArmsMajorityWrong: allQuestions.length - anyMajority, byArm: recoverable },
    qualification: "Descriptive in-sample statistics over declared strata; declared groups are not proven independent; the judge is a Gateway alias; repeats average reader and judge noise and do not add independent questions." };
}
export type EvolutionPairedAnalysis = ReturnType<typeof analyzeEvolutionPairs>;

/** Attribute campaign cost to arms: reader requests belong to one arm; judge requests shared by arms are split equally. */
export function attributeEvolutionArmCost(readers: unknown, judges: unknown, physical: unknown) {
  const r = loose(readers, "reader plan"), j = loose(judges, "judge plan");
  const cost = new Map<string, number>();
  for (const item of list(physical, "physical rows", MAX_ROWS)) {
    const row = loose(item, "physical row"), key = digest(row.requestSha256, "physical request digest");
    const micros = integer(row.knownUsageMicros, "known usage", 1e12); text(row.phase, "phase", 16);
    if (cost.has(key)) fail("duplicate physical row");
    cost.set(key, micros);
  }
  const arms = new Map<string, { reader: number; judge: number; questions: number }>();
  const arm = (variantId: unknown, reader: unknown) => {
    const key = armKey({ variantId: text(variantId, "variant ID"), reader: text(reader, "reader") }), bucket = arms.get(key) ?? { reader: 0, judge: 0, questions: 0 };
    arms.set(key, bucket); return bucket;
  };
  for (const item of list(r.cases, "reader cases", MAX_ROWS)) {
    const c = record(item, READER_CASE_KEYS, "reader case"), micros = cost.get(digest(c.requestSha256, "reader request"));
    if (micros === undefined) fail("reader request lacks a physical row");
    const bucket = arm(c.variantId, c.reader); bucket.reader += micros; bucket.questions++;
  }
  const sharing = new Map<string, string[]>();
  for (const item of list(j.cases, "judge cases", MAX_ROWS)) {
    const c = record(item, JUDGE_CASE_KEYS, "judge case");
    if (c.requestSha256 === null) continue;
    const key = digest(c.requestSha256, "judge request"), owners = sharing.get(key) ?? [];
    owners.push(armKey({ variantId: text(c.variantId, "variant ID"), reader: text(c.reader, "reader") })); sharing.set(key, owners);
  }
  for (const [key, owners] of sharing) {
    const micros = cost.get(key);
    if (micros === undefined) fail("judge request lacks a physical row");
    for (const owner of owners) {
      const bucket = arms.get(owner);
      if (bucket === undefined) fail("judge case names an arm without reader cases");
      bucket.judge += micros / owners.length;
    }
  }
  return [...arms.entries()].sort((a, b) => compare(a[0], b[0])).map(([key, v]) => {
    const [variantId, reader] = JSON.parse(key) as [string, string];
    return { variantId, reader, questions: v.questions, readerMicros: Math.round(v.reader), judgeMicrosShared: Math.round(v.judge), totalMicros: Math.round(v.reader + v.judge) };
  });
}

export type EvolutionPowerRule = Readonly<{ kind: "majority-gain"; minimumGain: number; maximumRegressions: number }>
  | Readonly<{ kind: "mean-lower-bound"; alpha: number; minimumGainPoints: number }>;
export type EvolutionPowerInput = Readonly<{
  questions: number; repeats: number; baseAccuracy: number; trueGainPoints: number; flipRate: number; rule: EvolutionPowerRule; simulations?: number; seed?: number;
}>;

/** Power and false-positive simulator: latent correctness per question, an injected true gain, and independent per-run verdict flips. */
export function simulateEvolutionPower(input: EvolutionPowerInput) {
  const n = integer(input.questions, "questions", MAX_QUESTIONS, 1), k = integer(input.repeats, "repeats", MAX_REPEATS, 1);
  const simulations = integer(input.simulations ?? 2_000, "simulations", MAX_SIMULATIONS, 1), seed = input.seed ?? 17;
  const { baseAccuracy, trueGainPoints, flipRate } = input;
  if (!(baseAccuracy > 0 && baseAccuracy < 1) || !(flipRate >= 0 && flipRate < 0.5) || !(trueGainPoints >= 0 && trueGainPoints <= 100)) fail("power parameters out of range");
  const rule = input.rule;
  if (rule.kind === "majority-gain") { integer(rule.minimumGain, "minimum gain", n); integer(rule.maximumRegressions, "maximum regressions", n); }
  else if (rule.kind === "mean-lower-bound") { if (!(rule.alpha > 0 && rule.alpha < 0.5) || !(rule.minimumGainPoints >= 0)) fail("lower-bound rule parameters out of range"); }
  else fail("unknown power rule");
  const random = seededRandom(seed), gain = Math.round((trueGainPoints / 100) * n), z = rule.kind === "mean-lower-bound" ? normalQuantile(1 - rule.alpha) : 0;
  let passes = 0; const deltas: number[] = [];
  const control = new Uint8Array(n), candidate = new Uint8Array(n), controlSum = new Float64Array(n), candidateSum = new Float64Array(n);
  for (let s = 0; s < simulations; s++) {
    const wrong: number[] = [];
    for (let i = 0; i < n; i++) { const c = random() < baseAccuracy ? 1 : 0; control[i] = c; candidate[i] = c; if (c === 0) wrong.push(i); }
    // Partial Fisher-Yates: the injected gain converts a uniform subset of control-wrong questions.
    for (let chosen = 0; chosen < Math.min(gain, wrong.length); chosen++) {
      const pick = chosen + Math.floor(random() * (wrong.length - chosen)), a = wrong[chosen] ?? 0, b = wrong[pick] ?? 0;
      wrong[chosen] = b; wrong[pick] = a; candidate[b] = 1;
    }
    controlSum.fill(0); candidateSum.fill(0);
    for (let r = 0; r < k; r++) for (let i = 0; i < n; i++) {
      const c = control[i] ?? 0, d = candidate[i] ?? 0;
      controlSum[i] = (controlSum[i] ?? 0) + (random() < flipRate ? 1 - c : c);
      candidateSum[i] = (candidateSum[i] ?? 0) + (random() < flipRate ? 1 - d : d);
    }
    let sum = 0, sumSquares = 0, majorityGain = 0, regressions = 0;
    for (let i = 0; i < n; i++) {
      const cs = candidateSum[i] ?? 0, ks = controlSum[i] ?? 0, d = (cs - ks) / k; sum += d; sumSquares += d * d;
      const mc = cs / k > 0.5 ? 1 : 0, mk = ks / k > 0.5 ? 1 : 0;
      majorityGain += mc - mk; regressions += mc < mk ? 1 : 0;
    }
    const meanDelta = sum / n; deltas.push(meanDelta * 100);
    if (rule.kind === "majority-gain") { if (majorityGain >= rule.minimumGain && regressions <= rule.maximumRegressions) passes++; }
    else {
      const variance = n > 1 ? (sumSquares - n * meanDelta * meanDelta) / (n - 1) : 0, lower = meanDelta - z * Math.sqrt(Math.max(variance, 0) / n);
      if (lower > 0 && meanDelta * 100 >= rule.minimumGainPoints) passes++;
    }
  }
  return { protocol: EVOLUTION_POWER_PROTOCOL, questions: n, repeats: k, baseAccuracy, trueGainPoints, flipRate, rule, simulations, seed, passes, power: round(passes / simulations, 4),
    observedDeltaPoints: { mean: round(mean(deltas), 4), sd: round(sampleSd(deltas) ?? 0, 4) },
    qualification: rule.kind === "mean-lower-bound" ? "normal approximation of the paired per-question mean difference; the analysis itself uses the cluster bootstrap" : "majority-of-k per arm on the same questions" };
}

/** Stable digest of an analysis for pinning in a protocol card or gate report. */
export function evolutionPairedStatsSha256(analysis: unknown): string { return canonicalSha256(analysis); }
