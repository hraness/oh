/** Atomic private campaign state and immutable plans. No provider effects occur in state transactions. */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../../../src/canonical";
import { CAMPAIGN_V3, clone, exact, identifier, integer, list, need, parseCandidate, parseConfig, sha, text, treatment,
  type Assessment, type CampaignConfig, type CampaignState, type FileRef, type Plan, type Review, type RunRecord } from "./campaign-contract-v3";
import { attainableClusters, confirmationAlpha, evaluate } from "./campaign-evaluate-v3";

export function readBounded(path: string, maximum = 16 * 1024 * 1024): string {
  const s = lstatSync(path); need(s.isFile() && !s.isSymbolicLink() && s.size <= maximum && realpathSync(path) === path, "unsafe or oversized input");
  const raw = readFileSync(path, "utf8"); need(Buffer.byteLength(raw) <= maximum, "input changed beyond byte limit"); return raw;
}
export function readPinned(ref: FileRef, maximum?: number): string { const raw = readBounded(ref.path, maximum); need(sha256Hex(raw) === ref.sha256, `pin changed: ${ref.path}`); return raw; }
export function sourcePins(): FileRef[] {
  // Include transitive relative imports (including type imports conservatively),
  // rather than silently omitting a newly factored parser or scorer dependency.
  const root = resolve(import.meta.dir, "../../.."), visited = new Map<string, FileRef>();
  const imports = /\b(?:import|export)\s+(?:(?:type\s+)?(?:\{[^}]*\}|\*\s*(?:as\s+\w+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  function visit(path: string): void {
    if (visited.has(path)) return;
    need(path.startsWith(root + "/") && visited.size < 256, "source closure exceeds repository or file bounds");
    const raw = readBounded(path); visited.set(path, { path, sha256: sha256Hex(raw) });
    if (!path.endsWith(".ts")) return;
    for (const match of raw.matchAll(imports)) {
      const specifier = match[1] ?? match[2]!;
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(path), specifier), child = /\.(?:ts|json)$/u.test(target) ? target : target + ".ts";
      visit(child);
    }
  }
  visit(resolve(import.meta.dir, "campaign-v3.ts")); visit(join(root, "package.json")); visit(join(root, "bun.lock"));
  return [...visited.values()].sort((a, b) => a.path.localeCompare(b.path));
}
export function verifyConfigPins(config: CampaignConfig): void {
  for (const required of sourcePins()) need(config.sourcePins.some(pin => pin.path === required.path && pin.sha256 === required.sha256), "execution source closure changed or incomplete");
  for (const pin of [...config.sourcePins, config.budget, config.templates]) readPinned(pin);
}
export function syncDirectory(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function durableCreate(path: string, value: unknown): void {
  const raw = JSON.stringify(value) + "\n"; need(Buffer.byteLength(raw) <= 16 * 1024 * 1024, "campaign artifact exceeds byte ceiling");
  const fd = openSync(path, "wx", 0o600); try { writeSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(dirname(path));
}
function atomicState(root: string, state: CampaignState): void {
  const temp = join(root, `.state-${randomUUID()}.tmp`); durableCreate(temp, { sha256: sha(state), state }); renameSync(temp, join(root, "campaign.json")); syncDirectory(root);
}
function privateRoot(root: string): void { need(resolve(root) === root && realpathSync(root) === root, "canonical absolute workspace required"); const s = lstatSync(root); need(s.isDirectory() && (s.mode & 0o077) === 0 && s.uid === process.getuid?.(), "private owned workspace required"); }
export function readState(root: string): CampaignState {
  privateRoot(root); const wrapper = exact(JSON.parse(readBounded(join(root, "campaign.json"))), ["sha256", "state"]);
  need(sha(wrapper.state) === wrapper.sha256, "campaign checksum changed");
  const state = wrapper.state as CampaignState; need(state.protocol === CAMPAIGN_V3, "v3 state required"); parseConfig(state.config); return state;
}
export function transaction<T>(root: string, mutate: (state: CampaignState) => T): T {
  privateRoot(root); const lock = join(root, "state.lock"), fd = openSync(lock, "wx", 0o600);
  try { writeSync(fd, JSON.stringify({ pid: process.pid })); fsyncSync(fd); const state = readState(root), result = mutate(state); state.revision++; atomicState(root, state); return result; }
  finally { closeSync(fd); unlinkSync(lock); syncDirectory(root); }
}
export function initialize(root: string, configValue: unknown, baselineValue: unknown): CampaignState {
  const config = parseConfig(configValue); verifyConfigPins(config); need(Date.now() < Date.parse(config.expiresAt), "campaign expired");
  mkdirSync(root, { recursive: true, mode: 0o700 }); privateRoot(root); need(!existsSync(join(root, "campaign.json")), "campaign already exists; never reset its budget");
  const baseline = treatment(config, baselineValue);
  const state: CampaignState = { protocol: CAMPAIGN_V3, revision: 0, config, startingBaseline: baseline, champion: { revision: 0, treatment: baseline },
    candidates: [], runs: [], qualifications: { controls: null, aa: null }, allocatedConfirmationClusters: [], confirmationAttempts: 0, stagnation: 0, promotions: [] };
  mkdirSync(join(root, "runs"), { mode: 0o700 }); durableCreate(join(root, "campaign.json"), { sha256: sha(state), state }); return state;
}
export function propose(root: string, value: unknown) { return transaction(root, state => {
  verifyConfigPins(state.config); const candidate = parseCandidate(state.config, value);
  need(state.candidates.length < state.config.maxProposals, "proposal budget exhausted");
  need(candidate.parentRevision === state.champion.revision && candidate.parentKey === state.champion.treatment.semanticKey, "candidate has stale parent");
  need(candidate.treatment.semanticKey !== candidate.parentKey, "candidate must change a mechanism");
  need(!state.candidates.some(c => c.treatment.id === candidate.treatment.id || c.treatment.semanticKey === candidate.treatment.semanticKey), "duplicate candidate");
  if (state.stagnation >= 3) need(candidate.strategy === "explore" && !state.candidates.some(c => c.mechanism === candidate.mechanism), "stagnation requires a new exploratory mechanism");
  state.candidates.push(candidate); return candidate;
}); }
export function getRun(state: CampaignState, id: string): RunRecord { const run = state.runs.find(r => r.plan.id === id); need(run, "unknown run"); need(run.planSha256 === sha(run.plan), "frozen plan changed"); return run; }
/** A new qualification plan withdraws the previous permission before it can fail or remain incomplete. */
export function requireQualifications(state: CampaignState, includeAA = true): void {
  const controls = state.runs.findLast(r => r.plan.kind === "controls");
  need(controls && controls.plan.id === state.qualifications.controls && controls.advanced && controls.assessment?.status === "PASS", "latest grader controls must pass and advance");
  if (!includeAA) return;
  const aa = state.runs.findLast(r => r.plan.kind === "aa");
  need(aa && aa.plan.id === state.qualifications.aa && aa.advanced && aa.assessment?.status === "PASS"
    && state.runs.indexOf(aa) > state.runs.indexOf(controls), "latest A/A after latest controls must pass and advance");
}
export function createPlan(root: string, value: unknown): RunRecord { return transaction(root, state => {
  const r = exact(value, ["id", "kind", "candidateId", "parentScreen", "targetIds", "guardIds", "maxCalls", "sampleSizeRationale", "repeats"]);
  const id = identifier(r.id); need(!state.runs.some(x => x.plan.id === id) && state.runs.length < state.config.maxPlans, "duplicate run or plan budget exhausted");
  need(["controls", "aa", "screen", "confirmation"].includes(String(r.kind)), "invalid run kind"); const kind = r.kind as Plan["kind"];
  need(Date.now() < Date.parse(state.config.expiresAt), "campaign expired"); verifyConfigPins(state.config);
  const targetIds = list(r.targetIds, 1, 4096).map(identifier), guardIds = list(r.guardIds, kind === "controls" ? 0 : 1, 4096).map(identifier);
  const ids = [...targetIds, ...guardIds]; need(new Set(ids).size === ids.length, "duplicate target/guard task");
  const tasks = ids.map(id => { const task = state.config.tasks.find(t => t.id === id); need(task, "task absent from exposed metadata registry"); return clone(task); });
  const pool = kind === "controls" ? "control" : kind === "confirmation" ? "confirmation" : "screen";
  need(tasks.every(t => t.pool === pool), "wrong pool or unexposed input");
  const candidate = state.candidates.find(c => c.treatment.id === r.candidateId);
  if (kind === "screen" || kind === "confirmation") {
    requireQualifications(state);
    need(candidate && (candidate.status === "queued" || candidate.status === "pending" || candidate.status === "screened") && candidate.parentRevision === state.champion.revision
      && candidate.parentKey === state.champion.treatment.semanticKey, "missing candidate or stale lineage");
  } else need(r.candidateId === null && r.parentScreen === null, "qualification cannot name candidate lineage");
  if (kind === "aa") requireQualifications(state, false);
  if (kind === "screen") {
    need(r.parentScreen === null && candidate?.status === "queued", "screen requires an unscreened queued candidate");
    const active = state.candidates.filter(c => c.status === "pending" || c.status === "screened");
    need(active.length < 3 && !active.some(c => c.mechanism === candidate.mechanism), "at most three mechanism-diverse active alternatives");
    candidate.status = "pending";
  }
  const targetClusters = new Set(tasks.filter(t => targetIds.includes(t.id)).map(t => t.cluster));
  const guardClusters = new Set(tasks.filter(t => guardIds.includes(t.id)).map(t => t.cluster));
  let attempt: number | null = null, alpha = state.config.screenAlpha;
  if (kind === "confirmation") {
    need(typeof r.parentScreen === "string" && candidate?.status === "screened", "confirmation needs passing screen lineage");
    const parent = getRun(state, r.parentScreen);
    need(parent.plan.kind === "screen" && parent.assessment?.status === "PASS" && parent.advanced
      && parent.plan.candidate.semanticKey === candidate.treatment.semanticKey && parent.plan.baselineRevision === state.champion.revision, "confirmation parent did not pass this generation");
    const oldCategories = (ids: string[], p: Plan) => [...new Set(p.tasks.filter(t => ids.includes(t.id)).map(t => t.category))].sort().join(",");
    need(oldCategories(targetIds, { tasks } as Plan) === oldCategories(parent.plan.targetIds, parent.plan)
      && oldCategories(guardIds, { tasks } as Plan) === oldCategories(parent.plan.guardIds, parent.plan), "confirmation must retain screened target/guard category family");
    need(state.confirmationAttempts < state.config.maxConfirmationAttempts, "confirmation trial budget exhausted");
    need(tasks.every(t => !state.allocatedConfirmationClusters.includes(t.cluster)), "confirmation clusters already allocated");
    attempt = state.confirmationAttempts + 1; alpha = confirmationAlpha(attempt);
    state.confirmationAttempts = attempt; state.allocatedConfirmationClusters.push(...new Set(tasks.map(t => t.cluster)));
  }
  const minimumClusters = kind === "confirmation" ? Math.max(6, attainableClusters(alpha)) : Math.max(3, attainableClusters(alpha));
  if (kind !== "controls") need(targetClusters.size >= minimumClusters && guardClusters.size >= (kind === "confirmation" ? minimumClusters : 3), "insufficient independent target/guard clusters; three only supports screening");
  else need(tasks.filter(t => t.expected === 1).length >= 2 && tasks.filter(t => t.expected === 0).length >= 2, "at least two positive and two negative controls required");
  const repeats = integer(r.repeats, 1, 8); need(kind !== "controls" || repeats === 1, "controls execute once");
  const armCount = kind === "controls" ? 1 : kind === "confirmation" && state.startingBaseline.semanticKey !== state.champion.treatment.semanticKey ? 3 : 2;
  const maxCalls = integer(r.maxCalls, 1, state.config.maxCalls), plannedCalls = tasks.reduce((n, t) => n + (kind === "controls" ? t.maxJudgeCalls : armCount * (1 + t.maxJudgeCalls)), 0) * repeats;
  need(plannedCalls <= maxCalls, "full planned reader/judge denominator exceeds run cap");
  need(state.runs.reduce((n, run) => n + run.plan.maxCalls, 0) + maxCalls <= state.config.maxCalls, "finite campaign call allocation exhausted");
  const baseline = clone(state.champion.treatment), selected = kind === "aa" || kind === "controls" ? clone(baseline) : clone(candidate!.treatment);
  const plan: Plan = { protocol: CAMPAIGN_V3, id, kind, repeats, original: clone(state.startingBaseline), baselineRevision: state.champion.revision, baseline, candidate: selected,
    candidateId: kind === "screen" || kind === "confirmation" ? candidate!.treatment.id : null, parentScreen: kind === "confirmation" ? r.parentScreen as string : null,
    tasks, targetIds, guardIds, maxCalls, analysis: { screenCriterion: state.config.screenCriterion, minimumEffect: state.config.minimumEffect, guardMargin: state.config.guardMargin, alpha, minimumClusters,
      sampleSizeRationale: text(r.sampleSizeRationale) }, confirmationAttempt: attempt, executionKey: sha(state.config),
    semanticFamilyKey: sha({ screenCriterion: state.config.screenCriterion, baseline: baseline.semanticKey, candidate: selected.semanticKey, targetCategories: [...new Set(tasks.filter(t => targetIds.includes(t.id)).map(t => t.category))].sort(),
      guardCategories: [...new Set(tasks.filter(t => guardIds.includes(t.id)).map(t => t.category))].sort() }), createdAt: new Date().toISOString() };
  const run: RunRecord = { plan, planSha256: sha(plan), review: null, assessment: null, advanced: false };
  if (kind === "controls") { state.qualifications.controls = null; state.qualifications.aa = null; }
  if (kind === "aa") state.qualifications.aa = null;
  state.runs.push(run); return run;
}); }
export function reviewPlan(root: string, id: string, value: unknown) { return transaction(root, state => {
  const run = getRun(state, id), r = exact(value, ["reviewer", "planSha256", "approved", "notes"]), reviewer = identifier(r.reviewer);
  need(r.approved === true && r.planSha256 === run.planSha256 && reviewer !== state.config.owner
    && reviewer !== state.candidates.find(c => c.treatment.id === run.plan.candidateId)?.author, "independent reviewer and exact plan digest required");
  need(run.review === null && run.assessment === null, "review already frozen");
  run.review = { reviewer, planSha256: run.planSha256, approved: true, notes: text(r.notes) }; return run.review;
}); }
function recordAssessment(root: string, id: string, observations: Parameters<typeof evaluate>[1]): Assessment { return transaction(root, state => {
  const run = getRun(state, id); need(run.review?.approved, "independent launch review required");
  const assessment = evaluate(run.plan, observations, state.config.aaMaximumMeanAbsoluteDelta);
  if (run.assessment && run.assessment.status !== "INCOMPLETE") need(sha(run.assessment) === sha(assessment), "settled assessment is immutable");
  run.assessment = assessment; return assessment;
}); }
/** Observation injection exists only for marked machinery tests. Live evidence is captured below. */
export function saveAssessment(root: string, id: string, observations: Parameters<typeof evaluate>[1]): Assessment {
  need(readState(root).config.evidenceMode === "offline-synthetic", "live assessments require replayed native provider evidence");
  return recordAssessment(root, id, observations);
}
export async function saveVerifiedAssessment(root: string, id: string): Promise<Assessment> {
  const { executeRun, readObservations } = await import("./campaign-execute-v3");
  try { await executeRun(root, id, { replayOnly: true }); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("missing captured stage")) throw error;
    return recordAssessment(root, id, []);
  }
  return recordAssessment(root, id, readObservations(root, id));
}
export function advance(root: string, id: string) { return transaction(root, state => {
  const run = getRun(state, id); need(run.review?.planSha256 === run.planSha256 && run.assessment?.planSha256 === run.planSha256, "reviewed assessment required");
  if (run.advanced) return { status: "already-advanced", champion: state.champion };
  need(run.assessment.status !== "INCOMPLETE", "incomplete evidence cannot advance");
  need(state.champion.revision === run.plan.baselineRevision && state.champion.treatment.semanticKey === run.plan.baseline.semanticKey, "stale champion compare-and-swap");
  const candidate = state.candidates.find(c => c.treatment.id === run.plan.candidateId), pass = run.assessment.status === "PASS";
  if (pass && (run.plan.kind === "screen" || run.plan.kind === "confirmation")) requireQualifications(state);
  if (run.plan.kind === "controls" || run.plan.kind === "aa") {
    need(state.runs.findLast(r => r.plan.kind === run.plan.kind)?.plan.id === id, "superseded qualification cannot advance");
    if (run.plan.kind === "aa") {
      requireQualifications(state, false);
      need(state.runs.indexOf(run) > state.runs.findLastIndex(r => r.plan.kind === "controls"), "A/A predates latest controls");
    }
    state.qualifications[run.plan.kind] = pass ? id : null;
  }
  else if (run.plan.kind === "screen" && candidate) { candidate.status = pass ? "screened" : "rejected"; if (!pass) state.stagnation++; }
  else if (run.plan.kind === "confirmation" && candidate) {
    if (pass) {
      state.champion = { revision: state.champion.revision + 1, treatment: clone(run.plan.candidate) }; candidate.status = "promoted"; state.stagnation = 0;
      state.promotions.push({ runId: id, from: run.plan.baseline.semanticKey, to: run.plan.candidate.semanticKey, revision: state.champion.revision });
      for (const alternative of state.candidates) if (alternative.status === "queued" || alternative.status === "pending" || alternative.status === "screened") alternative.status = "rejected";
    } else { candidate.status = "rejected"; state.stagnation++; }
  }
  run.advanced = true; return { status: pass ? "passed" : "rejected", champion: state.champion };
}); }

/** A crashed atomic state transaction can be resumed after proving its owner dead.
 * The checksum verifies the last complete committed state; temporary files are preserved. */
export function recoverStateLock(root: string): boolean {
  privateRoot(root); const path = join(root, "state.lock"); if (!existsSync(path)) return false;
  const stat = lstatSync(path), owner = exact(JSON.parse(readBounded(path, 4096)), ["pid"]), pid = integer(owner.pid, 1, 2147483647);
  let dead = false;
  try { process.kill(pid, 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === "ESRCH"; }
  need(dead, "state transaction owner is alive or cannot be proved dead"); readState(root);
  need(lstatSync(path).ino === stat.ino, "state lock identity changed"); unlinkSync(path); syncDirectory(root); return true;
}
