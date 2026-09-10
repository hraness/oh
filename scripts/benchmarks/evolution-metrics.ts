import type { Question } from "./datasets";
import { assertExactEvolutionCoverage } from "./evolution-dataset";

export const LOCOMO_F1_PROTOCOL = "oh.locomo.f1.nltk-extensions.v1" as const;
export const LOCOMO_F1_REFERENCE = {
  evaluator: "https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/task_eval/evaluation.py",
  stemmer: "NLTK PorterStemmer NLTK_EXTENSIONS",
  referenceNltkVersion: "3.9.2",
} as const;

// Dependency-free implementation of the Porter rules with NLTK extensions.
// Algorithm references: Martin Porter (1980), and NLTK's Apache-2.0 implementation:
// https://github.com/nltk/nltk/blob/3.9.2/nltk/stem/porter.py
// This is a new implementation of the rules, not a vendored copy of that source.
function consonants(word: string): boolean[] {
  const values: boolean[] = [];
  for (const char of word) values.push("aeiou".includes(char) ? false : char === "y" ? !values.at(-1) : true);
  return values;
}
function measure(word: string): number {
  const cs = consonants(word);
  return cs.reduce((n, c, i) => n + Number(i > 0 && c && !cs[i - 1]), 0);
}
function shortCvc(word: string): boolean {
  const cs = consonants(word);
  return cs.length === 2 ? !cs[0] && cs[1]! : cs.length >= 3 && cs.at(-3)! && !cs.at(-2)
    && cs.at(-1)! && !"wxy".includes(word.at(-1)!);
}
type SuffixRule = readonly [string, string];
function suffixStep(word: string, rules: readonly SuffixRule[], threshold: number): string {
  for (const [suffix, replacement] of rules) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    return measure(stem) > threshold ? stem + replacement : word;
  }
  return word;
}
const irregular = new Map<string, string>([
  ["sky", "sky"], ["skies", "sky"], ["dying", "die"], ["lying", "lie"], ["tying", "tie"], ["news", "news"],
  ["innings", "inning"], ["inning", "inning"], ["outings", "outing"], ["outing", "outing"],
  ["cannings", "canning"], ["canning", "canning"], ["howe", "howe"], ["proceed", "proceed"],
  ["exceed", "exceed"], ["succeed", "succeed"],
]);
const stepTwoRules: readonly SuffixRule[] = [
  ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"], ["izer", "ize"], ["bli", "ble"],
  ["alli", "al"], ["entli", "ent"], ["eli", "e"], ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"],
  ["ator", "ate"], ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"],
  ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"], ["fulli", "ful"],
];
function stepTwo(word: string): string {
  // NLTK applies successful ALLI rules before the remaining suffixes and repeats step 2.
  while (word.endsWith("alli") && measure(word.slice(0, -4)) > 0) word = word.slice(0, -4) + "al";
  for (const [suffix, replacement] of stepTwoRules) {
    if (word.endsWith(suffix)) return measure(word.slice(0, -suffix.length)) > 0 ? word.slice(0, -suffix.length) + replacement : word;
  }
  return word.endsWith("logi") && measure(word.slice(0, -3)) > 0 ? word.slice(0, -4) + "log" : word;
}

export function stemLocomoNltkPorter(token: string): string {
  if (typeof token !== "string" || Buffer.byteLength(token) > 65_536) throw new TypeError("Stem token is not bounded text.");
  let word = token.toLowerCase();
  const special = irregular.has(token) ? irregular.get(word) : undefined;
  if (special !== undefined) return special;
  if ([...token].length <= 2) return word;
  // Step 1a.
  if (word.endsWith("ies") && [...word].length === 4) word = word.slice(0, -3) + "ie";
  else if (word.endsWith("sses")) word = word.slice(0, -2);
  else if (word.endsWith("ies")) word = word.slice(0, -3) + "i";
  else if (!word.endsWith("ss") && word.endsWith("s")) word = word.slice(0, -1);
  // Step 1b. The EED rule blocks ED even when its measure condition fails.
  if (word.endsWith("ied")) word = word.slice(0, -3) + ([...word].length === 4 ? "ie" : "i");
  else if (word.endsWith("eed")) {
    if (measure(word.slice(0, -3)) > 0) word = word.slice(0, -1);
  } else {
    const suffix = ["ed", "ing"].find(s => word.endsWith(s) && consonants(word.slice(0, -s.length)).includes(false));
    if (suffix !== undefined) {
      word = word.slice(0, -suffix.length);
      if (["at", "bl", "iz"].some(s => word.endsWith(s))) word += "e";
      else {
        const chars = [...word];
        const double = chars.length > 1 && chars.at(-1) === chars.at(-2) && consonants(word).at(-1);
        if (double) {
          if (!"lsz".includes(chars.at(-1)!)) word = chars.slice(0, -1).join("");
        } else if (measure(word) === 1 && shortCvc(word)) word += "e";
      }
    }
  }
  // Step 1c, NLTK's consonant-before-Y rule.
  if (word.endsWith("y") && [...word].length > 2 && consonants(word.slice(0, -1)).at(-1)) word = word.slice(0, -1) + "i";
  word = stepTwo(word);
  word = suffixStep(word, [["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"], ["ical", "ic"], ["ful", ""], ["ness", ""]], 0);
  for (const suffix of ["al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment", "ent", "ion", "ou", "ism", "ate", "iti", "ous", "ive", "ize"]) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    if (measure(stem) > 1 && (suffix !== "ion" || /[st]$/.test(stem))) word = stem;
    break;
  }
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1), m = measure(stem);
    if (m > 1 || (m === 1 && !shortCvc(stem))) word = stem;
  }
  if (word.endsWith("ll") && measure(word.slice(0, -1)) > 1) word = word.slice(0, -1);
  return word;
}

function boundedAnswer(value: string): void {
  if (typeof value !== "string" || Buffer.byteLength(value) > 262_144) throw new TypeError("Answer is not bounded text.");
}
// Python string.punctuation is ASCII-only. Python regex uses Unicode word characters;
// JavaScript's \b would be ASCII-only.
const asciiPunctuation = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");
export function normalizeLocomoAnswer(value: string): string {
  boundedAnswer(value);
  return [...value.toLowerCase()].filter(c => !asciiPunctuation.has(c)).join("")
    .replace(/(?<![\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u200c\u200d])(?:a|an|the|and)(?![\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u200c\u200d])/gu, " ")
    .split(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u).filter(Boolean).join(" ");
}
function tokenF1(prediction: string, answer: string): number {
  const tokens = (value: string) => normalizeLocomoAnswer(value).split(" ").filter(Boolean).map(stemLocomoNltkPorter);
  const predicted = tokens(prediction), expected = tokens(answer);
  const counts = new Map<string, number>();
  for (const token of expected) counts.set(token, (counts.get(token) ?? 0) + 1);
  let common = 0;
  for (const token of predicted) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) { common++; counts.set(token, remaining - 1); }
  }
  return common === 0 ? 0 : 2 * common / (predicted.length + expected.length);
}

/** Official LoCoMo QA F1 rubric, including its exact category-specific rules. */
export function scoreLocomoF1(question: Pick<Question, "category" | "answer">, prediction: string): number {
  boundedAnswer(prediction); boundedAnswer(question.answer);
  if (!/^locomo:[1-5]$/.test(question.category)) throw new TypeError("LoCoMo scoring requires a LoCoMo category.");
  if (question.category === "locomo:5") return /no information available|not mentioned/.test(prediction.toLowerCase()) ? 1 : 0;
  const answer = question.category === "locomo:3" ? question.answer.split(";")[0]!.trim() : question.answer;
  if (question.category !== "locomo:1") return tokenF1(prediction, answer);
  const guesses = prediction.split(",").map(p => p.trim());
  const expected = answer.split(",").map(a => a.trim());
  // Bound the cross-product before the multi-answer maxima; ordinary benchmark answers are tiny.
  if (guesses.length * expected.length > 100_000
    || (prediction.length + answer.length) * (guesses.length + expected.length) > 8_000_000) {
    throw new RangeError("LoCoMo subanswer pair bound exceeded.");
  }
  return expected.reduce((sum, a) => sum + Math.max(...guesses.map(p => tokenF1(p, a))), 0) / expected.length;
}

export function scoreEvolutionEvidence(expectedIds: readonly string[], retrievedIds: readonly string[]): Readonly<{
  expected: number; found: number; recall: number | null; all: boolean | null;
}> {
  if (expectedIds.length > 100_000 || retrievedIds.length > 100_000) throw new RangeError("Evidence ID bound exceeded.");
  if ([...expectedIds, ...retrievedIds].some(id => typeof id !== "string" || !id.length || id.length > 512)) throw new TypeError("Invalid evidence ID.");
  const expected = new Set(expectedIds), retrieved = new Set(retrievedIds);
  const found = [...expected].filter(id => retrieved.has(id)).length;
  return { expected: expected.size, found, recall: expected.size ? found / expected.size : null,
    all: expected.size ? found === expected.size : null };
}

/** `judge-mean` is the per-question mean judge decision over declared repeats (V9); fractional, never null. */
export type EvolutionMetric = "judge-accuracy" | "judge-mean" | "locomo-f1" | "evidence-recall" | "evidence-all";
export type EvolutionMetricCase = Readonly<{ id: string; groupId: string; historyId: string; category: string }>;
export type EvolutionScore = Readonly<{ id: string; score: number | null; failed: boolean }>;
function validScore(result: EvolutionScore, metric: EvolutionMetric): void {
  if (typeof result.failed !== "boolean" || (result.score !== null && (!Number.isFinite(result.score) || result.score < 0 || result.score > 1))) {
    throw new TypeError("Invalid metric score or failure flag.");
  }
  if ((metric === "judge-accuracy" || metric === "judge-mean" || metric === "locomo-f1") && result.score === null) throw new TypeError("Answer metrics require every eligible score, including failures.");
  if (result.failed && result.score !== 0) throw new TypeError("A failed result must score zero.");
  if ((metric === "judge-accuracy" || metric === "evidence-all") && result.score !== null && result.score !== 0 && result.score !== 1) {
    throw new TypeError("Binary metric received a fractional score.");
  }
}
export function summarizeEvolutionScores(cases: readonly EvolutionMetricCase[], results: readonly EvolutionScore[], metric: EvolutionMetric) {
  if (!["judge-accuracy", "judge-mean", "locomo-f1", "evidence-recall", "evidence-all"].includes(metric)) throw new TypeError("Unknown evolution metric.");
  assertExactEvolutionCoverage(cases.map(c => c.id), results.map(r => r.id));
  results.forEach(result => validScore(result, metric));
  for (const c of cases) if ([c.groupId, c.historyId, c.category].some(v => typeof v !== "string" || !v.length || v.length > 512)) throw new TypeError("Invalid metric case grouping.");
  const byId = new Map(results.map(r => [r.id, r]));
  const aggregate = (subset: readonly EvolutionMetricCase[]) => {
    const scored = subset.map(c => byId.get(c.id)!), eligible = scored.filter(r => r.score !== null);
    return { cases: subset.length, scored: eligible.length, unscored: scored.length - eligible.length,
      failed: scored.filter(r => r.failed).length, mean: eligible.length ? eligible.reduce((sum, r) => sum + r.score!, 0) / eligible.length : null,
      declaredGroups: new Set(subset.map(c => c.groupId)).size, declaredHistories: new Set(subset.map(c => c.historyId)).size };
  };
  const breakdown = (key: "category" | "groupId" | "historyId") => [...new Set(cases.map(c => c[key]))].sort()
    .map(id => ({ id, ...aggregate(cases.filter(c => c[key] === id)) }));
  return { metric, overall: aggregate(cases), byCategory: breakdown("category"), byGroup: breakdown("groupId"), byHistory: breakdown("historyId"),
    qualification: "Descriptive summaries of declared groups; no independent-sample count or confidence interval inferred." as const };
}

export function summarizeEvolutionPairs(cases: readonly EvolutionMetricCase[], left: readonly EvolutionScore[], right: readonly EvolutionScore[], metric: EvolutionMetric) {
  const leftSummary = summarizeEvolutionScores(cases, left, metric), rightSummary = summarizeEvolutionScores(cases, right, metric);
  const l = new Map(left.map(r => [r.id, r])), r = new Map(right.map(row => [row.id, row]));
  const aggregate = (subset: readonly EvolutionMetricCase[]) => {
    let wins = 0, losses = 0, ties = 0, delta = 0, unscored = 0;
    for (const c of subset) {
      const a = l.get(c.id)!.score, b = r.get(c.id)!.score;
      if ((a === null) !== (b === null)) throw new TypeError("Paired metrics have different eligibility.");
      if (a === null || b === null) { unscored++; continue; }
      if (a > b) wins++; else if (a < b) losses++; else ties++;
      delta += a - b;
    }
    const scored = wins + losses + ties;
    return { cases: subset.length, scored, unscored, wins, losses, ties, meanDelta: scored ? delta / scored : null,
      declaredGroups: new Set(subset.map(c => c.groupId)).size, declaredHistories: new Set(subset.map(c => c.historyId)).size };
  };
  const breakdown = (key: "category" | "groupId" | "historyId") => [...new Set(cases.map(c => c[key]))].sort()
    .map(id => ({ id, ...aggregate(cases.filter(c => c[key] === id)) }));
  return { metric, left: leftSummary, right: rightSummary, paired: aggregate(cases),
    byCategory: breakdown("category"), byGroup: breakdown("groupId"), byHistory: breakdown("historyId"),
    qualification: "Paired descriptive differences; repeated questions and histories do not create independent samples." as const };
}
