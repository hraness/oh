// Shared lab plumbing: profile, dev pool, arm identity and the cell cache. Development screening only (Haiku reader and
// judge through xcb); nothing here is comparable with the released GPT-4o scorer.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const workspace = process.env.OH_MEMORY_LAB;
if (!workspace) throw new Error("set OH_MEMORY_LAB to the private lab workspace (profile.json, champion.json, instructions/, experiments/, cache/)");
export const LAB: string = workspace;
export const profile = JSON.parse(readFileSync(`${LAB}/profile.json`, "utf8"));
export const CELLS = `${LAB}/cache/cells.jsonl`;
export const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export type Question = { id: string; corpusId: string; category: string; question: string; questionDate: string; answer: string };
export type Arm = { name: string; instructionFile: string; context: string };
export type Plan = { id: string; hypothesis: string; challenger: Arm; pool: "screen" | "confirm";
  targets: { categories: string[]; families: number }; guard: { categories: string[]; families: number }; replicate?: number; maxCalls: number };

export const CATEGORIES = ["abstention", "contradiction_resolution", "event_ordering", "information_extraction", "instruction_following",
  "knowledge_update", "multi_session_reasoning", "preference_following", "summarization", "temporal_reasoning"];
export const dataset = JSON.parse(readFileSync(profile.devData, "utf8")) as { questions: Question[] };
const familyNumber = (id: string) => Number(/^beam-1M-(\d+):/u.exec(id)![1]);
/** Families are ordered by number; a plan takes the first n, so screens are nested and paired across experiments. */
export function planQuestions(plan: Plan): Question[] {
  const index = plan.pool === "screen" ? "0" : "1";
  const families = [...new Set(dataset.questions.map(q => familyNumber(q.id)))].sort((a, b) => a - b);
  const pick = (categories: string[], n: number) => dataset.questions.filter(q => categories.includes(q.category.replace(/^beam:/u, ""))
    && q.id.endsWith(`:${index}`) && families.slice(0, n).includes(familyNumber(q.id)));
  return [...pick(plan.targets.categories, plan.targets.families), ...pick(plan.guard.categories, plan.guard.families)];
}
export function instruction(arm: Arm): string { return readFileSync(`${LAB}/instructions/${arm.instructionFile}`, "utf8"); }
/** Arm identity: instruction bytes, context source, reader and judge. Cached cells are reused only on an exact match. */
export function armKey(arm: Arm): string {
  return sha(JSON.stringify({ instructionSha256: sha(instruction(arm)), context: arm.context, reader: profile.readerProfile, judge: profile.judgeProtocol })).slice(0, 16);
}
export type Cell = { armKey: string; arm: string; rep: number; questionId: string; category: string; status: string; score: number | null;
  reason?: string | null; answer?: string; judgeCalls?: number; experiment: string; at: string };
export function readCells(): Cell[] {
  return existsSync(CELLS) ? readFileSync(CELLS, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
}
/** Reader truncation scores 0; other failures are missing and reported. */
export function cellScore(cell: Cell): number | undefined {
  if (cell.status === "scored") return cell.score ?? undefined;
  return cell.reason === "output-token-limit" ? 0 : undefined;
}
export const champion = () => JSON.parse(readFileSync(`${LAB}/champion.json`, "utf8")) as { arm: Arm; history: unknown[] };
