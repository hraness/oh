/**
 * Derived observation records for benchmark retrieval. A run configuration that pins an
 * `oh.memory.observations.v1` artifact has its derived records rebuilt here, once per
 * corpus, through the library (`rebuildObserveLaneRecords`), so the records a prepared
 * corpus appends are exactly the records a product store would commit, with provenance
 * resolved against the corpus turns. Preparation is asynchronous once; every validator
 * then works from the synchronous map. The outcome-blind router audit lives here too.
 */
import { canonicalSha256, parseSha256Hex } from "../../src/canonical";
import { isOhRecommendationQueryV1 } from "../../src/observe";
import type { Dataset } from "./datasets";
import { evolutionRunnerQuestionId } from "./evolution-dataset";
import type { EvolutionRunnerCorpus } from "./evolution-dataset";
import { observeLaneCorpusSha256, parseObserveLaneArtifact, rebuildObserveLaneRecords, type ObserveLaneArtifact, type ObserveLaneExtractor } from "./evolution-observe-lane";
import type { EvolutionDerivedRecords } from "./evolution-retrieval";

export const EVOLUTION_DERIVED_CORPORA_PROTOCOL = "oh.memory.evolution-derived-corpora.v1" as const;
export const EVOLUTION_ROUTER_AUDIT_PROTOCOL = "oh.memory.observe-router-audit.v1" as const;
export type EvolutionDerivedCorpora = Readonly<{ protocol: typeof EVOLUTION_DERIVED_CORPORA_PROTOCOL; artifactSha256: string;
  extractor: ObserveLaneExtractor; byCorpus: ReadonlyMap<string, EvolutionDerivedRecords> }>;
function fail(reason: string): never { throw new TypeError(`Evolution derived records: ${reason}.`); }

/** Rebuilds the artifact's records for exactly the given corpora; a corpus the artifact does not describe fails closed. */
export async function prepareEvolutionDerivedCorpora(input: Readonly<{ artifactSha256: string; artifact: ObserveLaneArtifact;
  corpora: readonly EvolutionRunnerCorpus[] }>): Promise<EvolutionDerivedCorpora> {
  if (parseSha256Hex(input.artifactSha256) === null) fail("artifact pin digest required");
  if (!Array.isArray(input.corpora) || input.corpora.length < 1 || input.corpora.length > 2000) fail("corpus bounds");
  const artifact = parseObserveLaneArtifact(input.artifact);
  const sessions = artifact.corpora.flatMap(corpus => corpus.sessions);
  const completed = sessions.filter(row => row.status === "completed").length, rejected = sessions.filter(row => row.status === "rejected").length;
  if (!artifact.complete || sessions.some(row => row.status === "not-run" || row.status === "failed")
    || completed === 0 || rejected / (completed + rejected) >= 0.05) fail("artifact has not passed the complete extraction and below-5% parser rejection gate");
  const rows = new Map(artifact.corpora.map(c => [c.corpusId, c]));
  const byCorpus = new Map<string, EvolutionDerivedRecords>();
  for (const corpus of input.corpora) {
    const row = rows.get(corpus.id);
    if (row === undefined) fail(`artifact does not describe corpus ${corpus.id}`);
    if (byCorpus.has(corpus.id)) fail("duplicate corpus");
    if (row.corpusSha256 !== observeLaneCorpusSha256(corpus)) fail("artifact corpus digest differs from the prepared corpus");
    const rebuilt = await rebuildObserveLaneRecords(corpus, row, { extractor: artifact.extractor });
    byCorpus.set(corpus.id, Object.freeze({ artifactSha256: input.artifactSha256, records: rebuilt.derived }));
  }
  return Object.freeze({ protocol: EVOLUTION_DERIVED_CORPORA_PROTOCOL, artifactSha256: input.artifactSha256, extractor: artifact.extractor, byCorpus });
}
export function evolutionDerivedRecordsFor(derived: EvolutionDerivedCorpora, corpusId: string): EvolutionDerivedRecords {
  const records = derived.byCorpus.get(corpusId);
  if (records === undefined) fail(`no derived records for corpus ${corpusId}`);
  return records;
}

/** Category metadata is used only for this pre-read diagnostic, never for retrieval or extraction. */
export function evolutionObserveDatasetRouterAudit(dataset: Pick<Dataset, "questions">): EvolutionRouterAudit {
  return evolutionObserveRouterAudit(dataset.questions.map(q => ({ id: evolutionRunnerQuestionId(q.id), category: q.category, question: q.question })));
}

export type EvolutionRouterAuditQuestion = Readonly<{ id: string; category: string; question: string }>;
export type EvolutionRouterAudit = Readonly<{ protocol: typeof EVOLUTION_ROUTER_AUDIT_PROTOCOL; router: "isOhRecommendationQueryV1";
  questions: number; routed: number; hitRate: number | null;
  byCategory: Readonly<Record<string, Readonly<{ questions: number; routed: number; share: number }>>>; routedIds: readonly string[]; auditSha256: string }>;
/**
 * The share of questions the preference-block router routes, per category, declared before any read. The router is a
 * query-side lexical rule applied identically to every arm; this audit reports its category leakage. It reads no gold,
 * and its output carries counts and question identifiers only.
 */
export function evolutionObserveRouterAudit(questions: readonly EvolutionRouterAuditQuestion[]): EvolutionRouterAudit {
  if (!Array.isArray(questions) || questions.length > 100_000) fail("audit bounds");
  const ids = new Set<string>(), categories = new Map<string, { questions: number; routed: number }>(), routedIds: string[] = [];
  for (const q of questions) {
    if (typeof q.id !== "string" || !q.id || typeof q.category !== "string" || !q.category || typeof q.question !== "string" || Buffer.byteLength(q.id) > 512 || Buffer.byteLength(q.category) > 512 || Buffer.byteLength(q.question) > 16_384 || ids.has(q.id)) fail("audit question");
    ids.add(q.id);
    const bucket = categories.get(q.category) ?? { questions: 0, routed: 0 };
    bucket.questions += 1;
    if (isOhRecommendationQueryV1(q.question)) { bucket.routed += 1; routedIds.push(q.id); }
    categories.set(q.category, bucket);
  }
  const byCategory = Object.fromEntries([...categories].sort(([a], [b]) => a < b ? -1 : 1)
    .map(([category, bucket]) => [category, { ...bucket, share: bucket.routed / bucket.questions }]));
  const payload = { protocol: EVOLUTION_ROUTER_AUDIT_PROTOCOL, router: "isOhRecommendationQueryV1" as const, questions: questions.length, routed: routedIds.length,
    hitRate: questions.length === 0 ? null : routedIds.length / questions.length, byCategory, routedIds: [...routedIds].sort() };
  return Object.freeze({ ...payload, auditSha256: canonicalSha256(payload) });
}
