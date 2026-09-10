/** Additive pure preparation contract for paired completion contexts.
 * Generic CLI admission authenticates original parent artifacts before rebuilding
 * these contexts and using the existing reader/judge/shared-ledger workflow. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { assertExactEvolutionCoverage, type EvolutionRunnerInput, type EvolutionRunnerQuestion } from "./evolution-dataset";
import { boundEvolutionCompletionWire, createEvolutionSourceCompletion, EVOLUTION_COMPLETION_MODES, EVOLUTION_COMPLETION_POLICY,
  freezeEvolutionCompletion, projectEvolutionCompletionCorpus, projectEvolutionCompletionQuestion, validateEvolutionCompletionResultEnvelope,
  type EvolutionCompletionParent, type EvolutionCompletionResult } from "./evolution-completion";
import { evolutionAnswerMessages } from "./evolution-reader-contracts";
import { evolutionReaderContract, makeEvolutionRequest, type EvolutionProfileId, type EvolutionRequest } from "./evolution-model";
import { validateEvolutionContextPlan, validateEvolutionLegacyResultEnvelope, type EvolutionContextPlan, type EvolutionReaderCase } from "./evolution-plan";

export const EVOLUTION_COMPLETION_TREATMENTS = freezeEvolutionCompletion(EVOLUTION_COMPLETION_MODES.map(mode => ({
  id: `oh-focused-prefix-${mode}-completion-120k-v1`, system: "oh-source-completion" as const, mode,
  prefixBytes: 96_000 as const, completionBytes: 24_000 as const,
})));
export type EvolutionCompletionTreatment = typeof EVOLUTION_COMPLETION_TREATMENTS[number];
export function parseEvolutionCompletionTreatment(value: unknown): EvolutionCompletionTreatment {
  boundEvolutionCompletionWire(value, 2_000, 100);
  const found = EVOLUTION_COMPLETION_TREATMENTS.find(t => canonicalSha256(t) === canonicalSha256(value));
  if (!found) throw new TypeError("Evolution completion plan: fixed paired treatment required.");
  return found;
}
export type EvolutionCompletionParentSet = Readonly<{ questionId: string; prefix: EvolutionCompletionParent;
  lexical: EvolutionCompletionParent; semantic: EvolutionCompletionParent }>;
export type EvolutionCompletionPlanInput = Readonly<{ dataset: EvolutionRunnerInput; parents: readonly EvolutionCompletionParentSet[];
  manifestSha256: string; retrievalSourceSha256: string }>;
export type EvolutionCompletionPlan = Readonly<{ protocol: "oh.memory.evolution-context-plan.v4";
  manifestSha256: string; retrievalSourceSha256: string; inputSha256: string; policySha256: string;
  variants: typeof EVOLUTION_COMPLETION_TREATMENTS; questions: readonly EvolutionRunnerQuestion[];
  parents: readonly EvolutionCompletionParentSet[];
  cases: readonly Readonly<{ questionId: string; variantId: string; kind: "source-completion"; result: EvolutionCompletionResult }>[];
  planSha256: string }>;
const MAX_QUESTIONS = 100, MAX_PLAN_BYTES = 128 * 1024 * 1024;
function fail(reason: string): never { throw new TypeError(`Evolution completion plan: ${reason}.`); }
const id = (v: unknown): string => { if (typeof v !== "string" || !v.length || Buffer.byteLength(v) > 512 || /\p{Surrogate}/u.test(v)) fail("bounded ID required"); return v; };
export type EvolutionCompletionArtifactInput = Readonly<Record<"prefix" | "lexical" | "semantic", Readonly<{ plan: unknown; variantId: string }>>>;
/** The caller supplies bytes verified against each original artifact pin. Historical
 * source-manifest hashes stay historical; current record proof happens in the builder. */
export function projectEvolutionCompletionParents(input: EvolutionCompletionArtifactInput, dataset: EvolutionRunnerInput, manifestSha256: string): readonly EvolutionCompletionParentSet[] {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["prefix", "lexical", "semantic"])) fail("three pinned parents required");
  const selected = project(dataset), expectedInput = canonicalSha256(selected);
  const roles = ["prefix", "lexical", "semantic"] as const;
  const projections = roles.map(role => {
    const row = input[role];
    if (!isPlainRecord(row) || !hasExactKeys(row, ["plan", "variantId"])) fail("parent artifact mapping");
    boundEvolutionCompletionWire(row.plan, MAX_PLAN_BYTES, 3_000_000);
    if (!isPlainRecord(row.plan) || !hasExactKeys(row.plan, ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "variants", "questions", "cases", "planSha256"])
      || row.plan.protocol !== "oh.memory.evolution-context-plan.v1") fail("original V1 parent artifact required");
    const plan = validateEvolutionContextPlan(row.plan as unknown as EvolutionContextPlan);
    if (plan.manifestSha256 !== manifestSha256 || plan.inputSha256 !== expectedInput
      || canonicalSha256(plan.questions) !== canonicalSha256(selected.questions)) fail("parent selection or manifest differs");
    const variant = plan.variants.find(v => v.id === row.variantId);
    const system = role === "prefix" ? "oh-focused-window" : role === "lexical" ? "oh-focused" : "oh-semantic";
    if (!variant || variant.system !== system || variant.budget.topK !== 100 || variant.budget.contextBytes !== 96_000) fail("fixed parent variant required");
    const rows = plan.cases.filter(c => c.variantId === row.variantId);
    assertExactEvolutionCoverage(selected.questions.map(q => q.id), rows.map(r => r.questionId));
    return new Map(rows.map(r => [r.questionId, { variant, result: r.result, expectedResultSha256: r.result.resultSha256 }]));
  });
  return selected.questions.map(q => ({ questionId: q.id, prefix: projections[0]!.get(q.id)!, lexical: projections[1]!.get(q.id)!, semantic: projections[2]!.get(q.id)! }));
}
function project(input: EvolutionRunnerInput): EvolutionRunnerInput {
  if (!isPlainRecord(input) || !Array.isArray(input.corpora) || input.corpora.length < 1 || input.corpora.length > MAX_QUESTIONS
    || !Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > MAX_QUESTIONS) fail("bounded source selection required");
  const corpora = input.corpora.map(value => {
    if (!isPlainRecord(value)) fail("corpus object");
    const corpus = projectEvolutionCompletionCorpus({ id: id(value.id), groupId: id(value.id), turns: value.turns });
    return { id: corpus.id, turns: corpus.turns };
  });
  const questions = input.questions.map(value => ({ id: id(value.id), corpusId: id(value.corpusId), ...projectEvolutionCompletionQuestion(value) }));
  assertExactEvolutionCoverage(questions.map(q => q.id), questions.map(q => q.id));
  assertExactEvolutionCoverage([...new Set(questions.map(q => q.corpusId))], corpora.map(c => c.id));
  return { corpora, questions };
}
/** No parent is derived from the candidate itself. Supply parents authenticated by
 * original context-plan/result pins; their finite cached ordering is the candidate order. */
export function makeEvolutionCompletionPlan(input: EvolutionCompletionPlanInput): EvolutionCompletionPlan {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["dataset", "parents", "manifestSha256", "retrievalSourceSha256"])
    || parseSha256Hex(input.manifestSha256) === null || parseSha256Hex(input.retrievalSourceSha256) === null
    || !Array.isArray(input.parents) || input.parents.length < 1 || input.parents.length > MAX_QUESTIONS) fail("exact plan inputs required");
  const dataset = project(input.dataset);
  for (const row of input.parents) if (!isPlainRecord(row) || !hasExactKeys(row, ["questionId", "prefix", "lexical", "semantic"])) fail("exact parent row required");
  assertExactEvolutionCoverage(dataset.questions.map(q => q.id), input.parents.map(row => id(row.questionId)));
  const parents = new Map(input.parents.map(row => [row.questionId, row]));
  const prepared = new Map(dataset.corpora.map(c => [c.id, createEvolutionSourceCompletion({ id: c.id, groupId: c.id, turns: c.turns })]));
  const cases: EvolutionCompletionPlan["cases"][number][] = [];
  for (const q of dataset.questions) {
    const p = parents.get(q.id)!, factory = prepared.get(q.corpusId)!;
    for (const v of EVOLUTION_COMPLETION_TREATMENTS) cases.push({ questionId: q.id, variantId: v.id, kind: "source-completion",
      result: factory.pack({ question: q, mode: v.mode, prefix: p.prefix, pool: p[v.mode] }) });
  }
  const payload = { protocol: "oh.memory.evolution-context-plan.v4" as const, manifestSha256: input.manifestSha256,
    retrievalSourceSha256: input.retrievalSourceSha256, inputSha256: canonicalSha256(dataset), policySha256: canonicalSha256(EVOLUTION_COMPLETION_POLICY),
    variants: EVOLUTION_COMPLETION_TREATMENTS, questions: dataset.questions, parents: dataset.questions.map(q => parents.get(q.id)!), cases };
  boundEvolutionCompletionWire(payload, MAX_PLAN_BYTES, 3_000_000);
  if (Buffer.byteLength(canonicalJson(payload)) > MAX_PLAN_BYTES) fail("plan exceeds128MiB");
  // Detach validated parents too: callers may reuse mutable decoded cache objects.
  return freezeEvolutionCompletion(structuredClone({ ...payload, planSha256: canonicalSha256(payload) }));
}
/** Independent authenticated parents are required even for a fully resealed candidate. */
export function validateEvolutionCompletionPlan(input: EvolutionCompletionPlanInput, value: unknown): EvolutionCompletionPlan {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "policySha256", "variants", "questions", "parents", "cases", "planSha256"])) fail("exact completion plan required");
  boundEvolutionCompletionWire(value, MAX_PLAN_BYTES, 3_000_000);
  const expected = makeEvolutionCompletionPlan(input);
  if (canonicalSha256(value) !== canonicalSha256(expected)) fail("plan differs from authenticated parent matrix or current source selection");
  return expected;
}
/** Self-consistency only; the runner also reloads original pins and invokes the
 * independent-parent/source validator before reader admission or reporting. */
export function validateEvolutionCompletionPlanEnvelope(value: unknown): EvolutionCompletionPlan {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "policySha256", "variants", "questions", "parents", "cases", "planSha256"])
    || value.protocol !== "oh.memory.evolution-context-plan.v4" || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > MAX_QUESTIONS
    || !Array.isArray(value.parents) || value.parents.length !== value.questions.length || !Array.isArray(value.cases) || value.cases.length !== value.questions.length * 2) fail("V4 shape or matrix bounds");
  boundEvolutionCompletionWire(value, MAX_PLAN_BYTES, 3_000_000);
  const plan = value as unknown as EvolutionCompletionPlan;
  for (const d of [plan.manifestSha256, plan.retrievalSourceSha256, plan.inputSha256, plan.planSha256]) if (parseSha256Hex(d) === null) fail("plan digest required");
  if (plan.policySha256 !== canonicalSha256(EVOLUTION_COMPLETION_POLICY) || canonicalSha256(plan.variants) !== canonicalSha256(EVOLUTION_COMPLETION_TREATMENTS)) fail("fixed paired treatments changed");
  for (const q of plan.questions) {
    if (!isPlainRecord(q) || !hasExactKeys(q, ["id", "corpusId", "question", "questionDate"])) fail("question projection shape");
    id(q.id); id(q.corpusId); projectEvolutionCompletionQuestion(q);
  }
  assertExactEvolutionCoverage(plan.questions.map(q => q.id), plan.parents.map(p => p.questionId));
  assertExactEvolutionCoverage(plan.questions.flatMap(q => plan.variants.map(v => JSON.stringify([q.id, v.id]))), plan.cases.map(c => JSON.stringify([c.questionId, c.variantId])));
  const questions = new Map(plan.questions.map(q => [q.id, q]));
  for (const p of plan.parents) {
    if (!isPlainRecord(p) || !hasExactKeys(p, ["questionId", "prefix", "lexical", "semantic"])) fail("parent row shape");
    for (const role of ["prefix", "lexical", "semantic"] as const) {
      const parent = p[role], system = role === "prefix" ? "oh-focused-window" : role === "lexical" ? "oh-focused" : "oh-semantic";
      if (!isPlainRecord(parent) || !hasExactKeys(parent, ["variant", "result", "expectedResultSha256"]) || !isPlainRecord(parent.variant)
        || !hasExactKeys(parent.variant, ["id", "system", "budget"]) || parent.variant.system !== system || !isPlainRecord(parent.variant.budget)
        || !hasExactKeys(parent.variant.budget, ["topK", "contextBytes"]) || parent.variant.budget.topK !== 100 || parent.variant.budget.contextBytes !== 96_000) fail("parent variant shape");
      if (typeof parent.variant.id !== "string" || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(parent.variant.id)) fail("parent variant ID");
      validateEvolutionLegacyResultEnvelope(parent.result, questions.get(p.questionId)!, 96_000);
      if (parent.result.protocol !== "oh.evolution-retrieval.v1" || parent.expectedResultSha256 !== parent.result.resultSha256
        || parent.result.variantSha256 !== canonicalSha256(parent.variant) || parent.result.coverageKind !== null
        || parent.result.turnIds.length > (role === "prefix" ? 300 : 100)) fail("parent result binding");
    }
  }
  const parents = new Map(plan.parents.map(p => [p.questionId, p]));
  for (const c of plan.cases) {
    if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "kind", "result"]) || c.kind !== "source-completion") fail("completion case shape");
    const v = plan.variants.find(v => v.id === c.variantId)!, p = parents.get(c.questionId)!, question = questions.get(c.questionId)!;
    const result = validateEvolutionCompletionResultEnvelope(c.result, { question, mode: v.mode, prefix: p.prefix, pool: p[v.mode] });
    if (result.corpusId !== question.corpusId) fail("case corpus binding");
  }
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== planSha256) fail("plan digest differs");
  return plan;
}
/** Pure request preparation convenience. Requests use
 * existing profiles, messages, byte reservations and identities; this function cannot dispatch. */
export function prepareEvolutionCompletionReaderRequests(input: EvolutionCompletionPlanInput, value: unknown, readerProfiles: readonly EvolutionProfileId[]) {
  if (!Array.isArray(readerProfiles) || readerProfiles.length < 1 || readerProfiles.length > 2 || new Set(readerProfiles).size !== readerProfiles.length
    || readerProfiles.some(p => typeof p !== "string" || !p.endsWith("-reader"))) fail("one or two distinct reader profiles required");
  const plan = validateEvolutionCompletionPlan(input, value), cases: EvolutionReaderCase[] = [], requests = new Map<string, EvolutionRequest>();
  const questions = new Map(plan.questions.map(q => [q.id, q]));
  for (const c of plan.cases) for (const reader of readerProfiles) {
    const request = makeEvolutionRequest(reader, evolutionAnswerMessages(questions.get(c.questionId)!, c.result.context, evolutionReaderContract(reader)));
    requests.set(request.requestSha256, request);
    cases.push({ questionId: c.questionId, variantId: c.variantId, reader, contextSha256: c.result.contextSha256, requestSha256: request.requestSha256 });
  }
  const payload = { protocol: "oh.memory.evolution-completion-reader-inputs.v1" as const, completionPlanSha256: plan.planSha256,
    manifestSha256: plan.manifestSha256, readerProfiles: [...readerProfiles], cases, requests: [...requests.values()] };
  if (Buffer.byteLength(canonicalJson(payload)) > MAX_PLAN_BYTES) fail("reader inputs exceed128MiB");
  return freezeEvolutionCompletion({ ...payload, inputsSha256: canonicalSha256(payload) });
}
