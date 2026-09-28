import { canonicalSha256, isPlainRecord } from "../../src/canonical";
import { parseBeamEvaluationDataV1 } from "./beam-evaluation";

/** Released BEAM reporting is a ten-column category panel per system, not one
 * benchmark scalar. This pure unit binds externally captured official values to
 * a frozen plan and reduces them as the pinned reporter does, keeping every
 * missing, unresolved, failed and non-finite cell explicit. It opens no dataset,
 * provider or file, and it neither runs nor selects a scorer. */
export const BEAM_RELEASED_RESULTS_PROTOCOL_V1 = "oh.beam-released-results.v1" as const;
export const BEAM_RELEASED_RESULTS_PLAN_PROTOCOL_V1 = "oh.beam-released-results-plan.v1" as const;
export const BEAM_RELEASED_REPORTER_PIN_V1 = Object.freeze({
  commit: "3e12035532eb85768f1a7cd779832b650c4b2ef9",
  reportResultsSha256: "1486a44fac721717c0a9373b32f4487c277d2bf28044cf28f649a6a74e692c96",
});
/** Reporter column order (report_results.py:27-28). Values are keyed by these
 * identifiers and never follow the insertion order of evaluation-file keys. */
export const BEAM_RELEASED_CATEGORIES_V1 = Object.freeze(["abstention", "contradiction_resolution", "event_ordering",
  "information_extraction", "instruction_following", "knowledge_update", "multi_session_reasoning",
  "preference_following", "summarization", "temporal_reasoning"] as const);
export type BeamReleasedCategoryV1 = (typeof BEAM_RELEASED_CATEGORIES_V1)[number];
export const BEAM_RELEASED_RESULTS_LIMITS_V1 = Object.freeze({ arms: 16, questions: 4_096, repeats: 16, cells: 131_072, reasonBytes: 512 });

const EVENT_FIELDS = ["tau_norm", "final_score", "f1", "precision", "recall", "llm_judge_score"] as const;
const JUDGE_FIELDS = ["llm_judge_score"] as const;
const NON_FINITE = Object.freeze({ nan: Number.NaN, inf: Number.POSITIVE_INFINITY, "-inf": Number.NEGATIVE_INFINITY });
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PLAN_FIELDS = ["scorePolicySha256", "arms", "repeats", "questions", "requests"] as const;
const CELL_FIELDS = ["arm", "history", "question", "repeat"] as const;
const OBSERVATION_FIELDS = [...CELL_FIELDS, "requestSha256", "scorePolicySha256", "category", "status"] as const;

export type BeamReleasedScalarV1 = number | Readonly<{ nonFinite: keyof typeof NON_FINITE }>;
export type BeamReleasedCellV1 = Readonly<{ arm: string; history: string; question: string; repeat: number }>;
export type BeamReleasedResultsPlanV1 = Readonly<{
  protocol: typeof BEAM_RELEASED_RESULTS_PLAN_PROTOCOL_V1; scorePolicySha256: string; arms: readonly string[]; repeats: number;
  questions: readonly Readonly<{ history: string; question: string; category: BeamReleasedCategoryV1 }>[];
  requests: readonly Readonly<BeamReleasedCellV1 & { requestSha256: string }>[]; planSha256: string;
}>;

function need(value: unknown, reason: string): asserts value { if (!value) throw new TypeError(`BEAM released results: ${reason}.`); }
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const item of Object.values(value)) immutable(item); Object.freeze(value); }
  return value;
}
/** Read exactly the named own data fields without invoking accessors. */
function fields<K extends string>(input: unknown, keys: readonly K[]): Record<K, unknown> {
  need(isPlainRecord(input), "plain object required");
  const own = Reflect.ownKeys(input);
  need(own.length === keys.length && own.every(key => typeof key === "string" && (keys as readonly string[]).includes(key)), "unexpected or missing fields");
  const row = {} as Record<K, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    need(descriptor?.enumerable && "value" in descriptor, "enumerable data fields required");
    row[key] = descriptor.value;
  }
  return row;
}
function list(input: unknown, minimum: number, maximum: number): unknown[] {
  need(Array.isArray(input), "array required");
  const length: unknown = Object.getOwnPropertyDescriptor(input, "length")?.value;
  need(typeof length === "number" && length >= minimum && length <= maximum, "array length bound exceeded");
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    need(descriptor?.enumerable && "value" in descriptor, "enumerable array items required");
    return descriptor.value;
  });
}
/** Each row is bounded, canonicalized and detached before any field is read. */
function detach(input: unknown): Record<string, unknown> {
  need(isPlainRecord(input), "plain object row required");
  const value = parseBeamEvaluationDataV1(input, 4_096);
  need(isPlainRecord(value), "plain object row required");
  return value;
}
const row = <K extends string>(input: unknown, keys: readonly K[]): Record<K, unknown> => fields(detach(input), keys);
function id(value: unknown): string { need(typeof value === "string" && IDENTIFIER.test(value), "identifier required"); return value; }
function digest(value: unknown): string { need(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), "digest required"); return value; }
function category(value: unknown): BeamReleasedCategoryV1 {
  need(typeof value === "string" && (BEAM_RELEASED_CATEGORIES_V1 as readonly string[]).includes(value), "released category required");
  return value as BeamReleasedCategoryV1;
}
function repeat(value: unknown, repeats: number): number {
  need(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < repeats, "repeat index bound");
  return value;
}
function reason(value: unknown): string {
  need(typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value) <= BEAM_RELEASED_RESULTS_LIMITS_V1.reasonBytes, "bounded reason required");
  return value;
}
/** Finite released values are bounded by construction; a value outside [0, 1]
 * is a malformed capture for the caller to record as a failed cell. */
function scalar(value: unknown): number {
  if (typeof value === "number") {
    need(Number.isFinite(value) && value >= 0 && value <= 1, "finite score must lie in [0, 1]");
    return value;
  }
  const tag = fields(value, ["nonFinite"]).nonFinite;
  need(typeof tag === "string" && Object.hasOwn(NON_FINITE, tag), "non-finite tag required");
  return NON_FINITE[tag as keyof typeof NON_FINITE];
}
function encode(value: number): BeamReleasedScalarV1 {
  if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  return { nonFinite: Number.isNaN(value) ? "nan" : value > 0 ? "inf" : "-inf" };
}
const key = (...parts: readonly (string | number)[]): string => JSON.stringify(parts);
const cellKey = (cell: BeamReleasedCellV1): string => key(cell.arm, cell.history, cell.question, cell.repeat);
/** Sequential accumulation from zero, as the reporter's per-history `score +=`. */
const accumulate = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
/** CPython 3.12+ builtin `sum` over floats with integer start 0: the first item
 * replaces the start, later items use Neumaier compensation, and a finite
 * nonzero compensation is added once. The reporter averages histories this way. */
function pythonSum(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0 + values[0]!, compensation = 0;
  for (const value of values.slice(1)) {
    const next = total + value;
    compensation += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }
  return compensation !== 0 && Number.isFinite(compensation) ? total + compensation : total;
}

function planPayload(input: Record<(typeof PLAN_FIELDS)[number], unknown>) {
  const { cells: maximumCells, arms: maximumArms, questions: maximumQuestions, repeats: maximumRepeats } = BEAM_RELEASED_RESULTS_LIMITS_V1;
  const scorePolicySha256 = digest(input.scorePolicySha256), arms = list(input.arms, 1, maximumArms).map(id);
  need(new Set(arms).size === arms.length, "duplicate arm");
  need(typeof input.repeats === "number" && Number.isSafeInteger(input.repeats) && input.repeats >= 1 && input.repeats <= maximumRepeats, "repeat count bound");
  const repeats = input.repeats;
  const questions = list(input.questions, 1, maximumQuestions).map(value => {
    const question = row(value, ["history", "question", "category"]);
    return { history: id(question.history), question: id(question.question), category: category(question.category) };
  });
  const planned = new Set(questions.map(question => key(question.history, question.question)));
  need(planned.size === questions.length, "duplicate question");
  const expected = arms.length * questions.length * repeats;
  need(expected <= maximumCells, "cell bound exceeded");
  const seen = new Set<string>();
  const requests = list(input.requests, expected, expected).map(value => {
    const request = row(value, [...CELL_FIELDS, "requestSha256"]);
    const cell = { arm: id(request.arm), history: id(request.history), question: id(request.question), repeat: repeat(request.repeat, repeats) };
    need(arms.includes(cell.arm) && planned.has(key(cell.history, cell.question)), "foreign planned cell");
    need(!seen.has(cellKey(cell)), "duplicate planned cell"); seen.add(cellKey(cell));
    return { ...cell, requestSha256: digest(request.requestSha256) };
  });
  return { protocol: BEAM_RELEASED_RESULTS_PLAN_PROTOCOL_V1, scorePolicySha256, arms, repeats, questions, requests };
}

/** Freeze every intended arm × question × repeat cell, its exact request
 * identity and the declared score policy before any official value exists.
 * The request list must be the complete grid; declare histories and questions
 * in released file order for bit-identical floating-point sums. */
export function createBeamReleasedResultsPlanV1(input: unknown): BeamReleasedResultsPlanV1 {
  const payload = planPayload(fields(input, PLAN_FIELDS));
  return immutable({ ...payload, planSha256: canonicalSha256(payload) });
}
function validatePlan(input: unknown): BeamReleasedResultsPlanV1 {
  const plan = fields(input, ["protocol", ...PLAN_FIELDS, "planSha256"]);
  need(plan.protocol === BEAM_RELEASED_RESULTS_PLAN_PROTOCOL_V1, "plan protocol");
  const payload = planPayload(plan), planSha256 = digest(plan.planSha256);
  need(canonicalSha256(payload) === planSha256, "plan digest mismatch");
  return immutable({ ...payload, planSha256 });
}

/** Reduce captured official values without choosing among scorers. Event
 * ordering projects `tau_norm` and keeps its other metrics as diagnostics; the
 * nine other categories project `llm_judge_score`. Repeats average within a
 * question, questions within category and history, then histories carry equal
 * weight. Missing, unresolved, failed and non-finite cells stay explicit and
 * never become zero, disappear from a denominator or authorize a retry. */
export function reduceBeamReleasedResultsV1(planInput: unknown, observationsInput: unknown) {
  const plan = validatePlan(planInput);
  const categories = new Map(plan.questions.map(question => [key(question.history, question.question), question.category]));
  const requests = new Map(plan.requests.map((request, index) => [cellKey(request), { request, index }]));
  const scored = new Map<string, Readonly<Record<string, number>>>(), observedCells = new Set<number>();
  const unresolved: { index: number; cell: object }[] = [], failed: typeof unresolved = [], nonFinite: typeof unresolved = [];
  for (const value of list(observationsInput, 0, plan.requests.length)) {
    const detached = detach(value), status = detached.status;
    const extra = status === "scored" ? ["captureSha256", "result"] as const
      : status === "failed" ? ["captureSha256", "reason"] as const : status === "unresolved" ? ["reason"] as const : null;
    need(extra, "explicit cell status required");
    const observed: Record<string, unknown> = fields(detached, [...OBSERVATION_FIELDS, ...extra]);
    const cell = { arm: id(observed.arm), history: id(observed.history), question: id(observed.question), repeat: repeat(observed.repeat, plan.repeats) };
    const planned = requests.get(cellKey(cell));
    need(planned, "foreign observed cell");
    need(!observedCells.has(planned.index), "duplicate observed cell"); observedCells.add(planned.index);
    need(digest(observed.requestSha256) === planned.request.requestSha256, "request identity mismatch");
    need(digest(observed.scorePolicySha256) === plan.scorePolicySha256, "score policy mismatch");
    const expectedCategory = categories.get(key(cell.history, cell.question))!;
    need(category(observed.category) === expectedCategory, "unexpected category assignment");
    if (observed.status === "unresolved") { unresolved.push({ index: planned.index, cell: { ...cell, reason: reason(observed.reason) } }); continue; }
    const captureSha256 = digest(observed.captureSha256);
    if (observed.status === "failed") { failed.push({ index: planned.index, cell: { ...cell, captureSha256, reason: reason(observed.reason) } }); continue; }
    const names = expectedCategory === "event_ordering" ? EVENT_FIELDS : JUDGE_FIELDS, result = fields(observed.result, names);
    const values = Object.fromEntries(names.map(name => [name, scalar(result[name])]));
    scored.set(cellKey(cell), values);
    const projected = values[expectedCategory === "event_ordering" ? "tau_norm" : "llm_judge_score"]!;
    if (!Number.isFinite(projected)) nonFinite.push({ index: planned.index, cell: { ...cell, captureSha256, value: encode(projected) } });
  }
  const ordered = (entries: typeof unresolved) => entries.sort((left, right) => left.index - right.index).map(entry => entry.cell);
  const missing = plan.requests.filter((_, index) => !observedCells.has(index))
    .map(({ arm, history, question, repeat: index }) => ({ arm, history, question, repeat: index }));

  const byCategory = new Map<BeamReleasedCategoryV1, Map<string, string[]>>(), historyCategories = new Map<string, Set<BeamReleasedCategoryV1>>();
  for (const question of plan.questions) {
    const histories = byCategory.get(question.category) ?? new Map<string, string[]>();
    histories.set(question.history, [...histories.get(question.history) ?? [], question.question]);
    byCategory.set(question.category, histories);
    historyCategories.set(question.history, (historyCategories.get(question.history) ?? new Set()).add(question.category));
  }
  const releasedCompatible = [...historyCategories.values()].every(set => set.size === BEAM_RELEASED_CATEGORIES_V1.length);
  const reduce = (arm: string, histories: Map<string, string[]>, name: string) => {
    const means = [...histories].map(([history, questions]) => {
      const perQuestion = questions.map(question => {
        const values = Array.from({ length: plan.repeats }, (_, index) => scored.get(cellKey({ arm, history, question, repeat: index }))?.[name]);
        return values.every(item => item !== undefined) ? accumulate(values as number[]) / plan.repeats : null;
      });
      return { history, questions: questions.length, perQuestion,
        mean: perQuestion.every(item => item !== null) ? accumulate(perQuestion as number[]) / questions.length : null };
    });
    const complete = means.every(item => item.mean !== null), all = means.flatMap(item => item.perQuestion) as number[];
    return { means, complete, released: complete ? pythonSum(means.map(item => item.mean!)) / means.length : null,
      questionWeighted: complete ? accumulate(all) / all.length : null };
  };
  const arms = plan.arms.map(arm => {
    const panel = BEAM_RELEASED_CATEGORIES_V1.map(name => {
      const histories = byCategory.get(name);
      if (histories === undefined) return { category: name, status: "empty" as const, histories: 0, questions: 0, cells: 0, historyMeans: [], releasedMean: null, questionWeightedMean: null };
      const reduced = reduce(arm, histories, name === "event_ordering" ? "tau_norm" : "llm_judge_score");
      const questions = reduced.means.reduce((total, item) => total + item.questions, 0);
      return { category: name, status: !reduced.complete ? "incomplete" as const : Number.isFinite(reduced.released) ? "finite" as const : "non-finite" as const,
        histories: histories.size, questions, cells: questions * plan.repeats,
        historyMeans: reduced.means.map(item => ({ history: item.history, questions: item.questions, mean: item.mean === null ? null : encode(item.mean) })),
        releasedMean: reduced.released === null ? null : encode(reduced.released),
        questionWeightedMean: reduced.questionWeighted === null ? null : encode(reduced.questionWeighted) };
    });
    const events = byCategory.get("event_ordering"), diagnostics = events === undefined ? null
      : Object.fromEntries(EVENT_FIELDS.filter(name => name !== "tau_norm").map(name => {
        const reduced = reduce(arm, events, name);
        return [name, reduced.released === null ? null : encode(reduced.released)];
      }));
    const finite = releasedCompatible && panel.every(item => item.status === "finite");
    return { arm, categories: panel, releasedPanel: finite ? panel.map(item => item.releasedMean as number) : null, eventDiagnostics: diagnostics };
  });
  const payload = {
    protocol: BEAM_RELEASED_RESULTS_PROTOCOL_V1, planSha256: plan.planSha256, scorePolicySha256: plan.scorePolicySha256,
    reporter: BEAM_RELEASED_REPORTER_PIN_V1, columns: BEAM_RELEASED_CATEGORIES_V1,
    complete: missing.length === 0 && unresolved.length === 0 && failed.length === 0, releasedCompatible,
    counts: { planned: plan.requests.length, observed: scored.size + unresolved.length + failed.length, scored: scored.size,
      nonFinite: nonFinite.length, unresolved: unresolved.length, failed: failed.length, missing: missing.length },
    missing, unresolved: ordered(unresolved), failed: ordered(failed), nonFinite: ordered(nonFinite), arms,
  };
  return immutable({ ...payload, resultSha256: canonicalSha256(payload) });
}
