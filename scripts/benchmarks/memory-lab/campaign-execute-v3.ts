/** Stage-by-stage execution through the existing API authority. A captured stage is never dispatched twice. */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, unlinkSync, writeSync, fsyncSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { ApiLabTransport, parseApiReply, prepareApiRequest, type ApiReply } from "./api-transport";
import { bindBeamReleasedScorerTemplatesV1, stepBeamReleasedScoreV1 } from "../beam-released-scorer-v1";
import { evolutionAnswerMessages } from "../evolution-reader-contracts";
import { type Message } from "../model";
import { sha256Hex } from "../../../src/canonical";
import { CAMPAIGN_V3, exact, integer, need, planArms, parseTaskInput, readerInputUpperBound, sha, type CampaignConfig, type Observation, type Plan, type Task } from "./campaign-contract-v3";
import { durableCreate, getRun, readBounded, readPinned, readState, requireQualifications, saveVerifiedAssessment, recoverStateLock, syncDirectory, verifyConfigPins } from "./campaign-store-v3";

import { verifyContexts } from "./campaign-context-v3";

type Intent = { protocol: typeof CAMPAIGN_V3; planSha256: string; stage: string; profileId: string; requestSha256: string; ledgerPrefix: string[] };
type Receipt = { intentSha256: string; reply: ApiReply; providerAttempt: string };
type LedgerRow = { id: string; kind: "reserved" | "settled"; micros: number };
export type ExecutionOptions = { fetcher?: typeof fetch; now?: () => number; afterStage?: (stage: string) => void; afterProviderCapture?: (stage: string) => void; replayOnly?: boolean };
function ledgerPath(config: CampaignConfig): string { return JSON.parse(readPinned(config.budget, 8192)).ledgerPath as string; }
function ledger(config: CampaignConfig): LedgerRow[] {
  const path = ledgerPath(config); if (!existsSync(path)) return [];
  const raw = readBounded(path); need(!raw || raw.endsWith("\n"), "partial provider ledger blocks execution");
  return raw.split("\n").filter(Boolean).map(line => JSON.parse(line) as LedgerRow);
}
function reservations(config: CampaignConfig): string[] { return ledger(config).filter(e => e.kind === "reserved").map(e => e.id); }
function recover(config: CampaignConfig, intent: Intent, messages: readonly Message[]): Receipt | null {
  const events = ledger(config), ids = events.filter(e => e.kind === "reserved").map(e => e.id);
  need(intent.ledgerPrefix.every((id, i) => ids[i] === id), "provider ledger history changed");
  const newer = ids.slice(intent.ledgerPrefix.length);
  if (newer.length === 0) return null; // No native reservation means no request was dispatched.
  need(newer.length === 1, "ambiguous provider attempt; reconcile without replay");
  const id = newer[0]!, settled = events.find(e => e.id === id && e.kind === "settled"), dir = ledgerPath(config) + ".attempts";
  need(settled && existsSync(join(dir, id + ".result.json")), "unknown or rejected provider outcome blocks replay");
  const selected = [config.api.reader, config.api.judge].find(b => b.id === intent.profileId)!;
  const request = prepareApiRequest(selected, messages), capture = JSON.parse(readBounded(join(dir, id + ".request.json")));
  need(capture.requestSha256 === intent.requestSha256 && request.requestSha256 === intent.requestSha256, "captured request belongs to a different stage");
  const response = JSON.parse(readBounded(join(dir, id + ".response.json"))), reply = parseApiReply(JSON.parse(response.body), request);
  need(response.httpStatus >= 200 && response.httpStatus < 300 && reply.usage.micros === settled.micros
    && sha(reply) === sha(JSON.parse(readBounded(join(dir, id + ".result.json")))), "capture/settlement mismatch");
  return { intentSha256: sha(intent), reply, providerAttempt: id };
}
function observationsPath(root: string, id: string): string { return join(root, "runs", id, "observations.json"); }
export function readObservations(root: string, id: string): Observation[] {
  const path = observationsPath(root, id); if (existsSync(path)) return JSON.parse(readBounded(path)) as Observation[];
  const dir = join(root, "runs", id); if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(x => x.endsWith(".cell.json")).sort().map(x => JSON.parse(readBounded(join(dir, x))) as Observation);
}
export function assessRun(root: string, id: string) { return saveVerifiedAssessment(root, id); }
export async function executeRun(root: string, id: string, options: ExecutionOptions = {}) {
  const state = readState(root), run = getRun(state, id), config = state.config, plan = run.plan;
  const readerBound = readerInputUpperBound(config);
  const checkReaderBound = (inputUpperBound: number) => need(inputUpperBound <= readerBound, `reader reservation exceeds frozen ${readerBound}-byte bound`);
  need(run.review?.approved && run.review.planSha256 === run.planSha256, "independent exact-plan launch review required");
  need(plan.executionKey === sha(config), "execution config changed"); verifyConfigPins(config);
  if (!options.replayOnly) need((options.now ?? Date.now)() < Date.parse(config.expiresAt), "campaign expired");
  // A changed global champion cannot affect these immutable treatment snapshots; stale plans may finish but cannot promote.
  const dir = join(root, "runs", id); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(root, "execution.lock"), lock = openSync(lockPath, "wx", 0o600);
  writeSync(lock, JSON.stringify({ pid: process.pid, run: id, planSha256: run.planSha256 })); fsyncSync(lock); syncDirectory(root);
  let transport: ApiLabTransport | null = null, dispatched = 0;
  const assertPins = () => { verifyConfigPins(config); need(sha(getRun(readState(root), id).plan) === run.planSha256, "plan changed during execution"); };
  try {
    const templatesValue = JSON.parse(readPinned(config.templates, 131072));
    need(config.evidenceMode === "offline-synthetic" ? options.fetcher !== undefined || options.replayOnly : options.fetcher === undefined, "offline campaigns require injected transport; live campaigns prohibit injected evidence");
    const templates = bindBeamReleasedScorerTemplatesV1(templatesValue.templates, config.evidenceMode === "live" ? "released" : "invented");
    // Read only allocated exposed inputs. Reject preflight errors before a single provider call.
    const inputs = new Map(plan.tasks.map(task => [task.id, parseTaskInput(JSON.parse(readPinned(task.input, 2 * 1024 * 1024)), task)]));
    for (const input of inputs.values()) verifyContexts(config, input);
    // Freeze and bound every reader request before the first effect, including the third comparator.
    for (const task of plan.tasks) for (const arm of planArms(plan)) if (plan.kind !== "controls") {
      const input = inputs.get(task.id)!, context = input.contexts.find(c => c.policyId === plan[arm].contextPolicyId);
      need(context, "missing treatment context");
      const user = evolutionAnswerMessages({ question: input.question, questionDate: input.questionDate }, context.context, "task-complete-v10")[1]!;
      checkReaderBound(prepareApiRequest(config.api.reader, [{ role: "system", content: plan[arm].instruction }, user]).inputUpperBound);
    }
    for (const task of plan.tasks) if (task.category !== "event_ordering") need(inputs.get(task.id)!.rubric.length === task.maxJudgeCalls, "judge-call allocation differs from rubric count");
    async function stage(key: string, profileId: string, messages: readonly Message[]): Promise<ApiReply> {
      assertPins(); const path = join(dir, key), binding = [config.api.reader, config.api.judge].find(b => b.id === profileId)!;
      const request = prepareApiRequest(binding, messages), intentPath = path + ".intent.json", receiptPath = path + ".receipt.json";
      const checkDispatch = () => {
        need(!options.replayOnly, "missing captured stage; assessment remains incomplete");
        if (profileId === config.api.reader.id) checkReaderBound(request.inputUpperBound);
        if (plan.kind === "screen" || plan.kind === "confirmation") requireQualifications(readState(root));
        need((options.now ?? Date.now)() < Date.parse(config.expiresAt), "campaign expired before dispatch");
      };
      let intent: Intent;
      if (existsSync(intentPath)) {
        intent = JSON.parse(readBounded(intentPath)); need(intent.planSha256 === run.planSha256 && intent.stage === key
          && intent.profileId === profileId && intent.requestSha256 === request.requestSha256, "stage request changed");
        if (existsSync(receiptPath)) {
          const receipt = JSON.parse(readBounded(receiptPath)) as Receipt;
          need(receipt.intentSha256 === sha(intent) && receipt.reply.identity.requestSha256 === request.requestSha256, "stage receipt changed");
          const attempts = ledgerPath(config) + ".attempts", events = ledger(config);
          need(events.filter(e => e.kind === "reserved")[intent.ledgerPrefix.length]?.id === receipt.providerAttempt
            && events.some(e => e.id === receipt.providerAttempt && e.kind === "settled" && e.micros === receipt.reply.usage.micros), "receipt/native settlement mismatch");
          const raw = JSON.parse(readBounded(join(attempts, receipt.providerAttempt + ".response.json")));
          need(sha(parseApiReply(JSON.parse(raw.body), request)) === sha(receipt.reply), "stage receipt differs from native response");
          return receipt.reply;
        }
        const recovered = recover(config, intent, messages);
        if (recovered) { durableCreate(receiptPath, recovered); return recovered.reply; }
      } else {
        checkDispatch(); // No undispatched intent may straddle intervening requalification calls.
        const stages = readdirSync(dir).filter(x => x.endsWith(".intent.json")).length;
        need(stages < plan.maxCalls, "run call cap exhausted across restarts");
        intent = { protocol: CAMPAIGN_V3, planSha256: run.planSha256, stage: key, profileId, requestSha256: request.requestSha256, ledgerPrefix: reservations(config) };
        durableCreate(intentPath, intent);
      }
      checkDispatch();
      const clock = options.now ?? Date.now;
      // The campaign may expire before the shared API budget. Bound the in-flight request too.
      const boundedFetch: typeof fetch = Object.assign(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const remaining = Date.parse(config.expiresAt) - clock(); need(remaining > 0, "campaign expired before network dispatch");
        const deadline = AbortSignal.timeout(Math.min(120_000, remaining));
        return (options.fetcher ?? fetch)(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
      }, { preconnect: fetch.preconnect });
      // ApiLabTransport retains its whole-ledger lock for this entire run; no lock bypass or per-worker ledger exists.
      if (!transport) transport = await ApiLabTransport.open({ config: config.api, maxCalls: plan.maxCalls,
        fetcher: boundedFetch, ...(options.now ? { now: options.now } : {}) });
      const reply = await transport.invoke(profileId, messages); dispatched++;
      options.afterProviderCapture?.(key);
      const receipt = recover(config, intent, messages); need(receipt && sha(receipt.reply) === sha(reply), "native captured response required");
      durableCreate(receiptPath, receipt); options.afterStage?.(key); return reply;
    }
    async function cell(task: Task, arm: Observation["arm"], index: number, repeat: number): Promise<Observation> {
      const key = `${String(index).padStart(4, "0")}-r${repeat}-${arm}`, output = join(dir, key + ".cell.json");
      const input = inputs.get(task.id)!;
      const fail = (reason: string): Observation => ({ taskId: task.id, arm, repeat, status: "failed", score: null, reason });
      let answer = input.controlAnswer;
      if (plan.kind !== "controls") {
        // Construct the reader from the explicit reader projection. Gold fields never enter its messages.
        const user = evolutionAnswerMessages({ question: input.question, questionDate: input.questionDate }, input.contexts.find(c => c.policyId === plan[arm].contextPolicyId)!.context, "task-complete-v10")[1]!;
        const reader = await stage(key + "-reader", config.api.reader.id, [{ role: "system", content: plan[arm].instruction }, user]);
        if (reader.result.status !== "completed" || !reader.result.answer) return fail(reader.result.failureReason ?? "reader failed");
        answer = reader.result.answer;
      }
      need(answer !== null, "answer required");
      if (Buffer.byteLength(JSON.stringify(answer)) > config.maximumAnswerJsonBytes) return fail("answer exceeds frozen judge JSON byte envelope; no truncation or grading");
      const replies: string[] = [];
      for (;;) {
        const next = stepBeamReleasedScoreV1({ category: task.category, rubric: input.rubric, answer, question: input.question, templates }, replies);
        if (next.status === "failed") return fail(next.reason);
        if (next.status === "scored") {
          const score = next.result.llm_judge_score ?? next.result.tau_norm;
          if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return fail("non-finite or invalid score");
          return { taskId: task.id, arm, repeat, status: "scored", score, reason: null };
        }
        need(replies.length < task.maxJudgeCalls, "dynamic scorer exceeds preregistered judge-call ceiling");
        const judged = await stage(`${key}-judge-${replies.length}`, config.api.judge.id, next.request.messages);
        if (judged.result.status !== "completed" || !judged.result.answer) return fail(judged.result.failureReason ?? "judge failed");
        replies.push(judged.result.answer);
      }
    }
    const observations: Observation[] = [];
    for (const [index, task] of plan.tasks.entries()) {
      // Counterbalance pair order while preserving distinct A/A calls and deterministic restart positions.
      for (let repeat = 0; repeat < plan.repeats; repeat++) {
        const declared = planArms(plan), offset = (index + repeat) % declared.length;
        const arms = [...declared.slice(offset), ...declared.slice(0, offset)];
        for (const arm of arms) {
          const result = await cell(task, arm, index, repeat), path = join(dir, `${String(index).padStart(4, "0")}-r${repeat}-${arm}.cell.json`);
          if (!existsSync(path)) durableCreate(path, result); else need(sha(JSON.parse(readBounded(path))) === sha(result), "saved cell differs from replayed stage evidence"); observations.push(result);
        }
      }
    }
    if (!existsSync(observationsPath(root, id))) durableCreate(observationsPath(root, id), observations);
    else need(sha(JSON.parse(readBounded(observationsPath(root, id)))) === sha(observations), "saved observations differ from replayed evidence");
    return { completed: true, reused: dispatched === 0, calls: dispatched };
  } finally { if (transport !== null) (transport as ApiLabTransport).close(); closeSync(lock); unlinkSync(lockPath); syncDirectory(root); }
}

/** Explicit restart recovery, limited to the dead owner of this exact campaign.
 * Unknown effects and another owner's native lock remain untouched. */
export function recoverAbandonedExecution(root: string) {
  const state = readState(root), path = join(root, "execution.lock");
  const recoveredState = recoverStateLock(root);
  if (!existsSync(path)) return { recoveredRun: null, recoveredState, effectsReplayed: 0, ledgerModified: false };
  const localStat = lstatSync(path);
  const owner = exact(JSON.parse(readBounded(path, 4096)), ["pid", "run", "planSha256"]), pid = integer(owner.pid, 1, 2147483647);
  need(typeof owner.run === "string" && getRun(state, owner.run).planSha256 === owner.planSha256, "recovery owner is not this frozen run");
  let dead = false;
  try { process.kill(pid, 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === "ESRCH"; }
  need(dead, "execution owner is alive or cannot be proved dead");
  const events = ledger(state.config), reserved = events.filter(e => e.kind === "reserved"), settled = events.filter(e => e.kind === "settled");
  need(new Set(reserved.map(e => e.id)).size === reserved.length && new Set(settled.map(e => e.id)).size === settled.length
    && reserved.length === settled.length && reserved.every(r => settled.some(s => s.id === r.id && Number.isSafeInteger(s.micros) && s.micros >= 0 && s.micros <= r.micros)),
    "unknown provider outcomes require reconciliation; locks retained");
  const nativePath = ledgerPath(state.config) + ".lock";
  if (existsSync(nativePath)) {
    const nativeStat = lstatSync(nativePath), native = exact(JSON.parse(readBounded(nativePath, 4096)), ["pid", "protocol", "budgetSha256"]);
    need(native.pid === pid && native.protocol === "oh.memory-lab-api.v1" && native.budgetSha256 === sha256Hex(readPinned(state.config.budget, 8192)), "native lock belongs to another owner or authority");
    need(lstatSync(nativePath).ino === nativeStat.ino && lstatSync(path).ino === localStat.ino, "recovery lock identity changed");
    unlinkSync(nativePath); syncDirectory(dirname(nativePath));
  }
  need(lstatSync(path).ino === localStat.ino, "execution lock identity changed"); unlinkSync(path); syncDirectory(root);
  return { recoveredRun: owner.run, recoveredState, effectsReplayed: 0, ledgerModified: false };
}
