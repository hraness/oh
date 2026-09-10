/** Leaderboard-parity LoCoMo judge: the Packer/Mem0/Zep CORRECT-WRONG prompt on the gpt-4o-mini alias.
 * Gold references enter only here; the loader is separate from the LongMemEval native profile loader. */
import { join } from "node:path";
import { hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { Question } from "./datasets";
import { ROOT } from "./io";
import type { Message } from "./model";

export const EVOLUTION_LOCOMO_JUDGE_PROFILE_ID = "gpt4o-mini-locomo-j-judge-v1" as const;
/** Digest of the whole profile file (provenance text included); the template bytes have not changed since bf5bbe45…3fae. */
export const EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA = "fbdb3c740e50aeb0224b22dd51f2db02d9b942a8e9bd59023e099a94542dd227";
/** Categories in the J denominator: multi-hop, temporal, open-domain, single-hop. Adversarial (5) has no gold. */
export const EVOLUTION_LOCOMO_J_CATEGORIES = ["locomo:1", "locomo:2", "locomo:3", "locomo:4"] as const;
export const EVOLUTION_LOCOMO_CATEGORY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "locomo:1": "multi-hop", "locomo:2": "temporal", "locomo:3": "open-domain", "locomo:4": "single-hop", "locomo:5": "adversarial" });
export type EvolutionLocomoJudgeProfile = Readonly<{ profileId: "locomo.leaderboard-parity-judge.v1"; sha256: string; source: string;
  scoringRule: "correct-wrong"; templates: Readonly<{ system: string; "correct-wrong": string }> }>;
function fail(reason: string): never { throw new TypeError(`Evolution LoCoMo judge: ${reason}.`); }

export async function loadLocomoJudgeProfile(): Promise<EvolutionLocomoJudgeProfile> {
  const file = Bun.file(join(ROOT, "benchmarks/profiles/locomo-judge-v1.json"));
  if (file.size > 32 * 1024) fail("profile exceeds its byte bound");
  const bytes = await file.bytes(), value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!isPlainRecord(value) || !hasExactKeys(value, ["v", "profileId", "source", "adaptation", "scoringRule", "categories", "license", "templates"])
    || value.v !== 1 || value.profileId !== "locomo.leaderboard-parity-judge.v1" || value.scoringRule !== "correct-wrong"
    || typeof value.source !== "string" || typeof value.adaptation !== "string" || typeof value.license !== "string"
    || !Array.isArray(value.categories) || value.categories.length !== 4 || value.categories.some((c, i) => c !== EVOLUTION_LOCOMO_J_CATEGORIES[i])
    || !isPlainRecord(value.templates) || !hasExactKeys(value.templates, ["system", "correct-wrong"])) fail("invalid profile");
  const system = value.templates.system, user = value.templates["correct-wrong"];
  if (typeof system !== "string" || !system.length || system.length > 1024 || typeof user !== "string" || user.length > 8192
    || !["question", "answer", "response"].every(field => user.split(`{${field}}`).length === 2)) fail("invalid template");
  const sha256 = sha256Hex(bytes);
  if (sha256 !== EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA) fail("profile bytes differ from the pinned rubric digest");
  return Object.freeze({ profileId: value.profileId, sha256, source: value.source, scoringRule: "correct-wrong",
    templates: Object.freeze({ system, "correct-wrong": user }) });
}
/** Categories 1-4 only; the gold answer is passed as the dataset provides it (category 3 keeps its full text,
 * unlike the native F1 rule, because the leaders' harnesses pass the raw answer field). */
export function buildLocomoJudgeMessages(question: Pick<Question, "category" | "question" | "answer" | "unanswerable">, prediction: string,
  profile: EvolutionLocomoJudgeProfile): Message[] {
  if (!(EVOLUTION_LOCOMO_J_CATEGORIES as readonly string[]).includes(question.category) || question.unanswerable) fail("category outside the J denominator");
  if (typeof prediction !== "string" || !prediction.length || Buffer.byteLength(prediction) > 262_144) fail("bounded prediction required");
  const fields: Record<string, string> = { question: question.question, answer: question.answer, response: prediction };
  const content = profile.templates["correct-wrong"].replace(/\{(question|answer|response)\}/g, (_m, field: string) => fields[field]!);
  return [{ role: "system", content: profile.templates.system }, { role: "user", content }];
}
/** Exactly one of the uppercase labels must appear; both or neither is a judge failure, never a score. */
export function parseLocomoJudgeDecision(value: unknown): 0 | 1 | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  const correct = /\bCORRECT\b/.test(value), wrong = /\bWRONG\b/.test(value);
  if (correct === wrong) return null;
  return correct ? 1 : 0;
}
