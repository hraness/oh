import { canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { BEAM_RELEASED_SCORER_PIN, parseBeamEvaluationDataV1 } from "./beam-evaluation";
import { BEAM_RELEASED_CATEGORIES_V1, type BeamReleasedCategoryV1, type BeamReleasedScalarV1 } from "./beam-released-results-v1";

/** Scores one answer as the pinned BEAM compute_metrics does, with every model reply injected. Calls follow the released
 * order: event ordering sends its discarded fact-extraction prompt, then greedy equivalence checks, then one rubric
 * judgment per item; the other nine categories send one rubric judgment per item. A reply the released code would hand
 * to json_repair, or a score its int()/float() rejects, ends the cell as failed; nothing is emulated or coerced. The
 * same replies always reproduce the same requests and result. */
export const BEAM_RELEASED_SCORER_PROTOCOL_V1 = "oh.beam-released-scorer.v1" as const;
/** SHA-256 of the UTF-8 text assigned to the two scorer templates in the pinned prompts.py, read with Python's ast. */
export const BEAM_RELEASED_SCORER_TEMPLATE_PINS_V1 = Object.freeze({ commit: BEAM_RELEASED_SCORER_PIN.commit,
  promptsSha256: BEAM_RELEASED_SCORER_PIN.promptsSha256,
  nuggetSha256: "d349c9a8559bed9c14bfe2e624212225b09218ff864258a739229c15f4c8e869",
  extractionSha256: "04ab9a64f08674efdac63649059daf27fd499c2e455eaf57641553fd7aae2276" });
export const BEAM_RELEASED_SCORER_LIMITS_V1 = Object.freeze({ rubricItems: 64, itemBytes: 4_096, answerBytes: 262_144,
  questionBytes: 16_384, templateBytes: 65_536, replyBytes: 65_536, replyTotalBytes: 16_777_216, calls: 8_192, jsonDepth: 512 });

/** Exact llm_equivalence messages (compute_metrics.py:109-123). */
const EQUIVALENCE_SYSTEM = "\n            You are a binary classifier.\n            If the TWO snippets describe the SAME event/fact, reply **YES**\n"
  + "            Otherwise reply **NO**. No extra words.\n            DO NOT provide any exaplanation.\n        ";
const equivalenceUser = (first: string, second: string) => `First snippet: ${first} \n\n                       Second snippet: ${second}\n                    `;
/** Characters Python's str.isspace(), str.strip() and re's \s accept. */
const SPACE = "\\t\\n\\u000b\\f\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "gu");
const FENCE = new RegExp("```(?:json)?[" + SPACE + "]*(\\[.*\\]|\\{.*\\})[" + SPACE + "]*```", "su");
const LAZY = /(\{.*?\}|\[.*?\])/su;
const INTEGER = new RegExp(`^[${SPACE}]*([+-]?)([0-9]+(?:_[0-9]+)*)[${SPACE}]*$`, "u");
const DECIMAL = /^[+-]?(?:[0-9]+(?:_[0-9]+)*(?:\.(?:[0-9]+(?:_[0-9]+)*)?)?|\.[0-9]+(?:_[0-9]+)*)(?:[eE][+-]?[0-9]+(?:_[0-9]+)*)?$/u;
const REPAIR = "released parsing would call json_repair";

type Templates = Readonly<{ protocol: "oh.beam-released-scorer-templates.v1"; mode: "released" | "invented"; nugget: string; extraction: string;
  nuggetSha256: string; extractionSha256: string }>;
export type BeamReleasedScorerRequestV1 = Readonly<{ kind: "extraction" | "equivalence" | "nugget";
  messages: readonly Readonly<{ role: "system" | "user"; content: string }>[]; requestSha256: string }>;
type Outcome = Readonly<{ status: "scored"; result: Readonly<Record<string, BeamReleasedScalarV1>> } | { status: "failed"; reason: string }>;
type Input = Readonly<{ category: BeamReleasedCategoryV1; rubric: readonly string[]; answer: string; question: string; templates: Templates }>;

function need(value: unknown, reason: string): asserts value { if (!value) throw new TypeError(`BEAM released scorer: ${reason}.`); }
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const item of Object.values(value)) immutable(item); Object.freeze(value); }
  return value;
}
function text(value: unknown, maximum: number, label: string): string {
  need(typeof value === "string" && Buffer.byteLength(value) <= maximum && !/\p{Surrogate}/u.test(value), `bounded ${label} required`);
  return value;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  need(isPlainRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), "unexpected or missing fields");
  return value;
}
/** Python str.replace: every non-overlapping occurrence, left to right. */
const replace = (source: string, old: string, value: string) => source.split(old).join(value);
const strip = (value: string) => value.replace(STRIP, "");
const encode = (value: number): BeamReleasedScalarV1 => Number.isFinite(value) ? value + 0 : { nonFinite: Number.isNaN(value) ? "nan" : value > 0 ? "inf" : "-inf" };
const failed = (reason: string): Outcome => ({ status: "failed", reason });
function request(kind: BeamReleasedScorerRequestV1["kind"], messages: BeamReleasedScorerRequestV1["messages"]): BeamReleasedScorerRequestV1 {
  return immutable({ kind, messages, requestSha256: canonicalSha256({ protocol: BEAM_RELEASED_SCORER_PROTOCOL_V1, kind, messages }) });
}

export function bindBeamReleasedScorerTemplatesV1(input: Readonly<{ nugget: string; extraction: string }>, mode: "released" | "invented" = "released"): Templates {
  const nugget = text(input.nugget, BEAM_RELEASED_SCORER_LIMITS_V1.templateBytes, "template");
  const extraction = text(input.extraction, BEAM_RELEASED_SCORER_LIMITS_V1.templateBytes, "template");
  need(mode === "released" || mode === "invented", "template mode");
  const templates = { protocol: "oh.beam-released-scorer-templates.v1" as const, mode, nugget, extraction,
    nuggetSha256: sha256Hex(nugget), extractionSha256: sha256Hex(extraction) };
  need(mode === "invented" || (templates.nuggetSha256 === BEAM_RELEASED_SCORER_TEMPLATE_PINS_V1.nuggetSha256
    && templates.extractionSha256 === BEAM_RELEASED_SCORER_TEMPLATE_PINS_V1.extractionSha256), "released template digest mismatch");
  return immutable(templates);
}
function checkedInput(value: unknown): Input {
  const L = BEAM_RELEASED_SCORER_LIMITS_V1, row = exact(parseBeamEvaluationDataV1(value, 1_048_576), ["category", "rubric", "answer", "question", "templates"]);
  need(typeof row.category === "string" && (BEAM_RELEASED_CATEGORIES_V1 as readonly string[]).includes(row.category), "released category required");
  need(Array.isArray(row.rubric) && row.rubric.length <= L.rubricItems, "rubric bound");
  const t = exact(row.templates, ["protocol", "mode", "nugget", "extraction", "nuggetSha256", "extractionSha256"]);
  const templates = bindBeamReleasedScorerTemplatesV1({ nugget: t.nugget as string, extraction: t.extraction as string }, t.mode as "released" | "invented");
  need(t.protocol === templates.protocol && t.nuggetSha256 === templates.nuggetSha256 && t.extractionSha256 === templates.extractionSha256, "template binding changed");
  return { category: row.category as BeamReleasedCategoryV1, rubric: row.rubric.map(item => text(item, L.itemBytes, "rubric item")),
    answer: text(row.answer, L.answerBytes, "answer"), question: text(row.question, L.questionBytes, "question"), templates };
}

type Parsed = Readonly<{ kind: "value"; value: unknown } | { kind: "error" } | { kind: "unsupported"; reason: string }>;
/** Deepest bracket nesting outside strings, scanned without recursion. */
function nesting(source: string): number {
  let deepest = 0, level = 0, quoted = false, escaped = false;
  for (const character of source) {
    if (quoted) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === "\"") quoted = false; }
    else if (character === "\"") quoted = true;
    else if (character === "[" || character === "{") deepest = Math.max(deepest, ++level);
    else if (character === "]" || character === "}") level -= 1;
  }
  return deepest;
}
/** json.loads for replies: standard JSON parses identically; Python-only constants and extreme nesting are not reproduced. */
function loads(source: string): Parsed {
  if (nesting(source) > BEAM_RELEASED_SCORER_LIMITS_V1.jsonDepth) return { kind: "unsupported", reason: "reply nesting exceeds the reproduced depth" };
  try { return { kind: "value", value: JSON.parse(source) }; } catch {
    return /NaN|Infinity/u.test(source) ? { kind: "unsupported", reason: "reply uses a JSON constant only Python accepts" } : { kind: "error" };
  }
}
/** parse_json_response (compute_metrics.py:311-334). */
function parseReply(reply: string): Parsed {
  let source = strip(reply);
  if (source.startsWith("```")) { const match = FENCE.exec(source); if (match !== null) source = strip(match[1]!); }
  const direct = loads(source);
  if (direct.kind !== "error") return direct;
  const match = LAZY.exec(source);
  return match === null ? direct : loads(match[1]!);
}
const scoreOf = (value: unknown): unknown => isPlainRecord(value) && Object.hasOwn(value, "score") ? value.score : undefined;
/** Python int() for a parsed JSON score; undefined where Python raises or this port does not reproduce the value. */
function pythonInt(value: unknown): number | undefined {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? Math.trunc(value) + 0 : undefined;
  const match = typeof value === "string" ? INTEGER.exec(value) : null;
  if (match === null) return undefined;
  const digits = Number(match[2]!.replaceAll("_", ""));
  return digits <= Number.MAX_SAFE_INTEGER ? (match[1] === "-" ? -digits : digits) + 0 : undefined;
}
/** Python float() for a parsed JSON score. */
function pythonFloat(value: unknown): number | undefined {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const source = strip(value), special = /^([+-]?)(inf|infinity|nan)$/iu.exec(source);
  if (special !== null) return special[2]!.toLowerCase() === "nan" ? Number.NaN : special[1] === "-" ? -Infinity : Infinity;
  return DECIMAL.test(source) ? Number(source.replaceAll("_", "")) : undefined;
}

/** scipy.stats.kendalltau(variant="b") 1.16.1: exact pair counts, then con_minus_dis / sqrt(tot - xtie) / sqrt(tot - ytie). */
export function kendallTauBV1(x: readonly number[], y: readonly number[]): number {
  need(Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.length <= 4_096, "rank vectors of equal bounded length required");
  const n = x.length;
  if (n === 0) return Number.NaN;
  let xtie = 0, ytie = 0, ntie = 0, dis = 0;
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) {
    const dx = Math.sign(x[i]! - x[j]!), dy = Math.sign(y[i]! - y[j]!);
    if (dx === 0) xtie += 1;
    if (dy === 0) ytie += 1;
    if (dx === 0 && dy === 0) ntie += 1;
    if (dx * dy < 0) dis += 1;
  }
  const tot = n * (n - 1) / 2;
  if (xtie === tot || ytie === tot) return Number.NaN;
  return Math.min(1, Math.max(-1, (tot - xtie - ytie + ntie - 2 * dis) / Math.sqrt(tot - xtie) / Math.sqrt(tot - ytie)));
}
/** event_ordering_score after alignment (compute_metrics.py:286-308). */
function eventMetrics(reference: readonly string[], system: readonly string[]) {
  const referenceSet = new Set(reference), systemSet = new Set(system);
  const tp = [...referenceSet].filter(item => systemSet.has(item)).length;
  const fp = system.filter(item => !referenceSet.has(item)).length, fn = reference.filter(item => !systemSet.has(item)).length;
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const union = [...new Set([...reference, ...system])], tie = union.length + 1;
  const rank = (sequence: readonly string[]) => { const ranks = new Map<string, number>(); sequence.forEach((item, index) => ranks.set(item, index + 1));
    return union.map(item => ranks.get(item) ?? tie); };
  const tauNorm = (kendallTauBV1(rank(reference), rank(system)) + 1) / 2;
  return { precision, recall, f1, tau_norm: tauNorm, final_score: tauNorm * f1 };
}

function* evaluate(input: Input): Generator<BeamReleasedScorerRequestV1, Outcome, string> {
  const { rubric, answer, templates } = input, empty = failed("empty rubric makes the released reducer divide by zero");
  const judge = (item: string) => request("nugget", [{ role: "user", content: replace(replace(templates.nugget, "<rubric_item>", item), "<llm_response>", answer) }]);
  if (input.category !== "event_ordering") {
    if (rubric.length === 0) return empty;
    let score = 0;
    for (const item of rubric) {
      const parsed = parseReply(strip(yield judge(item)));
      if (parsed.kind !== "value") return failed(parsed.kind === "error" ? REPAIR : parsed.reason);
      const value = pythonInt(scoreOf(parsed.value));
      if (value === undefined) return failed("int() rejects or this port does not reproduce the reply score");
      score += value;
      if (!Number.isSafeInteger(score)) return failed("score sum leaves the exactly reproduced integer range");
    }
    return { status: "scored", result: { llm_judge_score: encode(score / rubric.length) } };
  }
  const system = answer.split("\n");
  if (1 + system.length * rubric.length + rubric.length > BEAM_RELEASED_SCORER_LIMITS_V1.calls) return failed("worst-case event call count exceeds the bound");
  yield request("extraction", [{ role: "user", content: replace(replace(templates.extraction, "<question>", input.question), "<input_text>", answer) }]);
  if (rubric.length === 0) return empty; // The released code still sends the extraction call before failing.
  const used = new Set<number>(), canonical: string[] = [];
  for (const line of system) {
    let matched: number | null = null;
    for (let index = 0; index < rubric.length && matched === null; index += 1) {
      if (used.has(index)) continue;
      const reply = yield request("equivalence", [{ role: "system", content: EQUIVALENCE_SYSTEM }, { role: "user", content: equivalenceUser(rubric[index]!, line) }]);
      if (reply.toLowerCase().includes("yes")) matched = index;
    }
    if (matched === null) canonical.push(line); else { canonical.push(rubric[matched]!); used.add(matched); }
  }
  const metrics = eventMetrics(rubric, canonical);
  let score = 0;
  for (const item of rubric) {
    const parsed = parseReply(strip(yield judge(item)));
    if (parsed.kind !== "value") return failed(parsed.kind === "error" ? REPAIR : parsed.reason);
    const value = pythonFloat(scoreOf(parsed.value));
    if (value === undefined) return failed("float() rejects or this port does not reproduce the reply score");
    score += value;
  }
  return { status: "scored", result: Object.fromEntries(Object.entries({ ...metrics, llm_judge_score: score / rubric.length })
    .map(([name, value]) => [name, encode(value)])) };
}

export type BeamReleasedScoreStepV1 = Readonly<{ status: "request"; index: number; request: BeamReleasedScorerRequestV1; templatesMode: Templates["mode"] }
  | (Outcome & { calls: number; requestSha256s: readonly string[]; transcriptSha256: string; templatesMode: Templates["mode"] })>;

/** Replays the released algorithm over the replies received so far. Returns the next request while replies are missing,
 * then the final outcome with the digest of the complete request and reply transcript. */
export function stepBeamReleasedScoreV1(inputValue: unknown, repliesValue: unknown): BeamReleasedScoreStepV1 {
  const input = checkedInput(inputValue), L = BEAM_RELEASED_SCORER_LIMITS_V1;
  need(Array.isArray(repliesValue) && repliesValue.length <= L.calls, "reply count bound");
  const detached = parseBeamEvaluationDataV1(repliesValue, 2 * L.replyTotalBytes);
  need(Array.isArray(detached), "reply list required");
  const replies = detached.map(reply => text(reply, L.replyBytes, "reply"));
  need(replies.reduce((total, reply) => total + Buffer.byteLength(reply), 0) <= L.replyTotalBytes, "reply byte bound");
  const run = evaluate(input), requests: string[] = [];
  let state = run.next();
  while (!state.done) {
    if (requests.length === replies.length) return immutable({ status: "request", index: requests.length, request: state.value, templatesMode: input.templates.mode });
    requests.push(state.value.requestSha256);
    state = run.next(replies[requests.length - 1]!);
  }
  need(requests.length === replies.length, "more replies than released requests");
  const transcriptSha256 = canonicalSha256({ protocol: BEAM_RELEASED_SCORER_PROTOCOL_V1, input: { category: input.category, rubric: input.rubric,
    answer: input.answer, question: input.question, nuggetSha256: input.templates.nuggetSha256, extractionSha256: input.templates.extractionSha256 },
    requestSha256s: requests, replies });
  return immutable({ ...state.value, calls: requests.length, requestSha256s: requests, transcriptSha256, templatesMode: input.templates.mode });
}
