// Run one frozen experiment: for every planned question, the champion cell (reused from the cache when present) and the
// challenger cell, back to back so a halt leaves complete pairs. Haiku reader + released-template Haiku judge via xcb.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { XcbSubscriptionTransport } from "../xcb-subscription";
import { evolutionAnswerMessages } from "../evolution-reader-contracts";
import { bindBeamReleasedScorerTemplatesV1, stepBeamReleasedScoreV1 } from "../beam-released-scorer-v1";
import { CELLS, LAB, type Arm, type Cell, type Plan, type Question, armKey, champion, instruction, planQuestions, profile, readCells, sha } from "./common";

const dir = `${LAB}/experiments/${Bun.argv[2]}`;
const plan = JSON.parse(readFileSync(`${dir}/plan.json`, "utf8")) as Plan;
const frozen = readFileSync(`${dir}/frozen.sha256`, "utf8").trim();
const current = sha(readFileSync(`${dir}/plan.json`, "utf8") + readFileSync(`${dir}/PREREG.md`, "utf8") + instruction(plan.challenger));
if (frozen !== current) throw new Error("plan, PREREG.md or the challenger instruction changed after freezing");

const templates = bindBeamReleasedScorerTemplatesV1(JSON.parse(readFileSync(profile.scorerTemplates, "utf8")).templates, "released");
const contextCache = new Map<string, Map<string, string>>();
function contextFor(arm: Arm, questionId: string): string {
  if (!contextCache.has(arm.context)) {
    const map = new Map<string, string>();
    for (const line of readFileSync(profile.devContexts[arm.context], "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line); if (typeof row.context === "string") map.set(row.questionId, row.context);
    }
    contextCache.set(arm.context, map);
  }
  const context = contextCache.get(arm.context)!.get(questionId);
  if (context === undefined) throw new Error(`no ${arm.context} context for ${questionId}`);
  return context;
}

const champ = champion().arm, rep = plan.replicate ?? 0;
const have = new Set(readCells().map(c => `${c.armKey}|${c.rep}|${c.questionId}`));
const todo: { arm: Arm; rep: number; question: Question }[] = [];
for (const question of planQuestions(plan)) {
  for (const [arm, r] of [[champ, 0], [plan.challenger, rep]] as const) {
    const key = `${armKey(arm)}|${r}|${question.id}`;
    if (!have.has(key) && !todo.some(t => `${armKey(t.arm)}|${t.rep}|${t.question.id}` === key)) todo.push({ arm, rep: r, question });
  }
}
console.log(JSON.stringify({ experiment: plan.id, questions: planQuestions(plan).length, cellsToRun: todo.length, champion: armKey(champ), challenger: armKey(plan.challenger) }));

const xcb = await XcbSubscriptionTransport.open({ bin: profile.xcbBin, ledgerPath: `${dir}/xcb-ledger.jsonl`, profiles: [profile.readerProfile, profile.judgeProfile], maxCalls: plan.maxCalls });
async function runCell({ arm, rep, question }: typeof todo[number]): Promise<Cell> {
  const base = { armKey: armKey(arm), arm: arm.name, rep, questionId: question.id, category: question.category.replace(/^beam:/u, ""), experiment: plan.id };
  // Same user message as the registered contracts; only the system instruction varies. No question metadata enters the prompt.
  const user = evolutionAnswerMessages({ question: question.question, questionDate: question.questionDate }, contextFor(arm, question.id), "task-complete-v10")[1]!;
  const reader = await xcb.invoke(profile.readerProfile, [{ role: "system", content: instruction(arm) }, user]);
  if (reader.result.status !== "completed" || reader.result.answer === null) {
    return { ...base, status: "failed", score: null, reason: reader.result.failureReason ?? "reader-failed", at: new Date().toISOString() };
  }
  const input = { category: base.category, rubric: JSON.parse(question.answer).rubric as string[], answer: reader.result.answer, question: question.question, templates };
  const replies: string[] = [];
  for (;;) {
    const step = stepBeamReleasedScoreV1(input, replies);
    if (step.status !== "request") {
      const result = step.status === "scored" ? step.result as any : null;
      return { ...base, status: step.status, score: result === null ? null : (result.llm_judge_score ?? result.tau_norm ?? null),
        reason: step.status === "failed" ? step.reason : null, answer: reader.result.answer, judgeCalls: step.calls, at: new Date().toISOString() };
    }
    const judged = await xcb.invoke(profile.judgeProfile, step.request.messages);
    replies.push(judged.result.answer ?? judged.result.partialAnswer ?? "");
  }
}
let next = 0, finished = 0;
await Promise.all(Array.from({ length: xcb.concurrency }, async () => {
  while (!xcb.halted && next < todo.length) {
    const cell = todo[next++]!;
    try { appendFileSync(CELLS, JSON.stringify(await runCell(cell)) + "\n"); }
    catch (error) { appendFileSync(`${dir}/errors.jsonl`, JSON.stringify({ arm: cell.arm.name, questionId: cell.question.id, error: String(error).slice(0, 300), at: new Date().toISOString() }) + "\n"); }
    if (++finished % 10 === 0) console.log(JSON.stringify({ finished, of: todo.length, calls: xcb.calls, at: new Date().toISOString() }));
  }
}));
console.log(JSON.stringify({ finished, of: todo.length, calls: xcb.calls, halted: xcb.halted, done: !xcb.halted && finished === todo.length }));
