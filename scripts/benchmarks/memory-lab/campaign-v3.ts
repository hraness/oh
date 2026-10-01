#!/usr/bin/env bun
/** Explicit finite CLI. Parallel agents may propose; only run owns provider effects. */
import { resolve } from "node:path";
import { need } from "./campaign-contract-v3";
import { advance, closeStoppedRun, createPlan, initialize, propose, readBounded, readState, reviewPlan, sourcePins } from "./campaign-store-v3";
import { assessRun, executeRun, recoverAbandonedExecution } from "./campaign-execute-v3";

export async function main(argv: string[]) {
  const [command, workspace, arg, extra] = argv;
  if (command === "source-pins") return sourcePins();
  if (!command || command === "--help") return { usage: "campaign-v3.ts COMMAND WORKSPACE [FILE|RUN_ID] [REVIEW_FILE]",
    commands: { init: "config/baseline JSON file; creates a new private v3 workspace", status: "read campaign and next required actions", propose: "candidate JSON file",
      plan: "plan-spec JSON file", review: "run ID and independent review JSON file", run: "run ID; captured stages resume without replay",
      assess: "run ID; all planned observations required", "close-stopped": "run ID; offline verified terminal rejection, full-denominator incomplete assessment, no advancement", advance: "run ID; qualification, rejection or conditional champion promotion", "source-pins": "print the current execution-source closure", "recover-locks": "explicitly release this campaign dead owner locks only when every native effect is settled" } };
  need(workspace, "workspace required"); const root = resolve(workspace);
  const json = (path: string | undefined) => { need(path, "JSON file required"); return JSON.parse(readBounded(resolve(path))); };
  if (command === "init") { const input = json(arg); return initialize(root, input.config, input.baseline); }
  if (command === "status") {
    const s = readState(root); return { id: s.config.id, champion: s.champion, startingBaseline: s.startingBaseline, qualifications: s.qualifications,
      candidates: s.candidates.map(c => ({ id: c.treatment.id, mechanism: c.mechanism, strategy: c.strategy, status: c.status })),
      runs: s.runs.map(r => ({ id: r.plan.id, kind: r.plan.kind, reviewed: r.review !== null, result: r.assessment?.status ?? null, advanced: r.advanced })),
      limits: { proposals: [s.candidates.length, s.config.maxProposals], plans: [s.runs.length, s.config.maxPlans],
        allocatedCalls: [s.runs.reduce((n, r) => n + r.plan.maxCalls, 0), s.config.maxCalls], confirmations: [s.confirmationAttempts, s.config.maxConfirmationAttempts], expiresAt: s.config.expiresAt },
      stagnation: s.stagnation, promotions: s.promotions,
      next: !s.qualifications.controls ? "plan/review/run/assess/advance grader controls" : !s.qualifications.aa ? "plan/review/run/assess/advance identical-treatment A/A"
        : s.candidates.some(c => c.status === "screened") ? "allocate fresh confirmation clusters for a screened candidate"
        : "select a queued mechanism, freeze a screen and obtain independent launch review" };
  }
  if (command === "recover-locks") return recoverAbandonedExecution(root);
  if (command === "propose") return propose(root, json(arg));
  if (command === "plan") return createPlan(root, json(arg));
  need(arg, "run ID required");
  if (command === "review") return reviewPlan(root, arg, json(extra));
  if (command === "run") return executeRun(root, arg);
  if (command === "assess") return assessRun(root, arg);
  if (command === "close-stopped") return closeStoppedRun(root, arg);
  if (command === "advance") return advance(root, arg);
  throw new Error("Unknown command; use --help.");
}
if (import.meta.main) main(Bun.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(String(error)); process.exitCode = 1; });
