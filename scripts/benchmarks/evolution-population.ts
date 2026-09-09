import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { EVOLUTION_PROFILES, type EvolutionProfileId } from "./evolution-model";
import { EVOLUTION_RETRIEVAL_SYSTEMS, type EvolutionRetrievalSystem } from "./evolution-retrieval";

export type EvolutionReaderGene = Extract<EvolutionProfileId, `${string}-reader`>;
export type EvolutionGenome = Readonly<{ system: EvolutionRetrievalSystem; topK: number; contextBytes: number; reader: EvolutionReaderGene }>;
export type EvolutionGeneAxis = keyof EvolutionGenome;
const AXES: readonly EvolutionGeneAxis[] = ["system", "topK", "contextBytes", "reader"];
export type EvolutionPopulationPolicy = Readonly<{ protocol: "oh.evolution-population-policy.v1";
  mode: "fixed-reader-memory" | "system-frontier"; fixedReader: EvolutionReaderGene | null;
  allowed: Readonly<{ system: readonly EvolutionRetrievalSystem[]; topK: readonly number[];
    contextBytes: readonly number[]; reader: readonly EvolutionReaderGene[] }>;
  maximumPopulation: number; policySha256: string }>;
export type EvolutionCandidate = Readonly<{ protocol: "oh.evolution-candidate.v1"; id: string; policySha256: string;
  genome: EvolutionGenome; genomeSha256: string; parentIds: readonly string[]; hypothesis: string; seed: number;
  generation: number; origin: "seed" | "mutation" | "crossover"; mutationAxis: EvolutionGeneAxis | null }>;
export type EvolutionDevelopmentIdentity = Readonly<{ protocol: "oh.evolution-paired-development.v1";
  split: "development"; design: "paired"; datasetSha256: string; selectionSha256: string;
  judgeProfileSha256: string; evaluationProtocolSha256: string; totalQuestions: number }>;
/** The caller authenticates report bytes. These primitives check matching treatment and lineage, not model truth. */
export type EvolutionDevelopmentFitness = Readonly<{ protocol: "oh.evolution-development-fitness.v1";
  identity: EvolutionDevelopmentIdentity; candidateId: string; reportSha256: string; correct: number; total: number;
  costMicros: number; latencyMs: number; categories: readonly Readonly<{ id: string; correct: number; total: number }>[] }>;

function fail(reason: string): never { throw new TypeError(`Evolution population: ${reason}.`); }
function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= maximum;
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}
function reader(value: unknown): value is EvolutionReaderGene {
  return typeof value === "string" && value.endsWith("-reader") && Object.hasOwn(EVOLUTION_PROFILES, value);
}
function unique<T>(values: readonly T[]): boolean { return new Set(values).size === values.length; }

/** Parse explicit gene domains. Ordering is preserved and contributes to the deterministic policy identity. */
export function parseEvolutionPopulationPolicy(value: unknown): EvolutionPopulationPolicy {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "mode", "fixedReader", "allowed", "maximumPopulation"])
    || value.protocol !== "oh.evolution-population-policy.v1" || !["fixed-reader-memory", "system-frontier"].includes(String(value.mode))
    || !integer(value.maximumPopulation, 128) || value.maximumPopulation < 1 || !isPlainRecord(value.allowed)
    || !hasExactKeys(value.allowed, AXES)) fail("invalid explicit population policy");
  const allowed = value.allowed;
  for (const axis of AXES) if (!Array.isArray(allowed[axis]) || allowed[axis].length < 1
    || allowed[axis].length > 32 || !unique(allowed[axis])) fail("invalid or duplicate allowed gene values");
  const systems = allowed.system as unknown[], topKs = allowed.topK as unknown[];
  const contexts = allowed.contextBytes as unknown[], readers = allowed.reader as unknown[];
  if (systems.some(system => !EVOLUTION_RETRIEVAL_SYSTEMS.includes(system as EvolutionRetrievalSystem))
    || topKs.some(k => !integer(k, 100) || k < 1) || contexts.some(bytes => !integer(bytes, 4_000_000) || bytes < 1)
    || readers.some(value => !reader(value))) fail("unsupported gene value");
  if (value.mode === "fixed-reader-memory") {
    if (!reader(value.fixedReader) || readers.length !== 1 || readers[0] !== value.fixedReader) fail("fixed-reader memory policy cannot breed another reader");
  } else if (value.fixedReader !== null) fail("system frontier must declare no fixed reader");
  const payload = { protocol: "oh.evolution-population-policy.v1" as const,
    mode: value.mode as EvolutionPopulationPolicy["mode"], fixedReader: value.fixedReader as EvolutionReaderGene | null,
    allowed: { system: [...systems] as EvolutionRetrievalSystem[], topK: [...topKs] as number[],
      contextBytes: [...contexts] as number[], reader: [...readers] as EvolutionReaderGene[] }, maximumPopulation: value.maximumPopulation };
  return immutable({ ...payload, policySha256: canonicalSha256(payload) });
}
function policy(value: EvolutionPopulationPolicy): EvolutionPopulationPolicy {
  if (!isPlainRecord(value)) fail("invalid policy");
  const { policySha256, ...payload } = value, checked = parseEvolutionPopulationPolicy(payload);
  if (checked.policySha256 !== policySha256) fail("population policy changed");
  return checked;
}
function genome(value: unknown, p: EvolutionPopulationPolicy): EvolutionGenome {
  if (!isPlainRecord(value) || !hasExactKeys(value, AXES)
    || AXES.some(axis => !(p.allowed[axis] as readonly unknown[]).includes(value[axis]))) fail("genome is outside the explicit allowed gene values");
  return immutable({ system: value.system as EvolutionRetrievalSystem, topK: value.topK as number,
    contextBytes: value.contextBytes as number, reader: value.reader as EvolutionReaderGene });
}
function lineageOptions(value: Readonly<{ hypothesis: string; seed: number }>) {
  if (!text(value.hypothesis, 2048) || !integer(value.seed, 0xffff_ffff)) fail("invalid hypothesis or lineage seed");
  return { hypothesis: value.hypothesis, seed: value.seed };
}
function makeCandidate(p: EvolutionPopulationPolicy, g: EvolutionGenome, options: Readonly<{ hypothesis: string; seed: number }>,
  parents: readonly EvolutionCandidate[], origin: EvolutionCandidate["origin"], mutationAxis: EvolutionGeneAxis | null): EvolutionCandidate {
  const generation = parents.length ? Math.max(...parents.map(parent => parent.generation)) + 1 : 0;
  if (generation > 1024) fail("lineage generation bound exceeded");
  const payload = { protocol: "oh.evolution-candidate.v1" as const, policySha256: p.policySha256, genome: g,
    genomeSha256: canonicalSha256(g), parentIds: parents.map(parent => parent.id), ...lineageOptions(options), generation, origin, mutationAxis };
  return immutable({ ...payload, id: canonicalSha256(payload) });
}
export function validateEvolutionCandidate(value: EvolutionCandidate, inputPolicy: EvolutionPopulationPolicy): EvolutionCandidate {
  const p = policy(inputPolicy);
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "id", "policySha256", "genome", "genomeSha256", "parentIds",
    "hypothesis", "seed", "generation", "origin", "mutationAxis"]) || value.protocol !== "oh.evolution-candidate.v1"
    || value.policySha256 !== p.policySha256 || !Array.isArray(value.parentIds) || value.parentIds.length > 2
    || value.parentIds.some(id => parseSha256Hex(id) === null) || !unique(value.parentIds)
    || !integer(value.generation, 1024) || !["seed", "mutation", "crossover"].includes(value.origin)) fail("incompatible candidate lineage or policy");
  const g = genome(value.genome, p); lineageOptions(value);
  if (value.genomeSha256 !== canonicalSha256(g)
    || (value.origin === "seed" ? value.parentIds.length !== 0 || value.generation !== 0 || value.mutationAxis !== null
      : value.origin === "mutation" ? value.parentIds.length !== 1 || value.generation === 0 || !AXES.includes(value.mutationAxis as EvolutionGeneAxis)
        || p.mode === "fixed-reader-memory" && value.mutationAxis === "reader"
        : value.parentIds.length !== 2 || value.generation === 0 || value.mutationAxis !== null)) fail("invalid origin or genome identity");
  const { id, ...payload } = value;
  if (id !== canonicalSha256(payload) || value.parentIds.includes(id)) fail("candidate identity changed");
  return immutable(structuredClone(value));
}
export function createEvolutionSeedCandidate(inputGenome: EvolutionGenome, inputPolicy: EvolutionPopulationPolicy,
  options: Readonly<{ hypothesis: string; seed: number }>): EvolutionCandidate {
  const p = policy(inputPolicy);
  return makeCandidate(p, genome(inputGenome, p), options, [], "seed", null);
}
function choice(seed: number, identity: unknown, length: number): number {
  return Number.parseInt(canonicalSha256({ seed, identity }).slice(0, 8), 16) % length;
}
export function mutateEvolutionCandidate(parentInput: EvolutionCandidate, inputPolicy: EvolutionPopulationPolicy,
  options: Readonly<{ hypothesis: string; seed: number; axis?: EvolutionGeneAxis }>): EvolutionCandidate {
  const p = policy(inputPolicy), parent = validateEvolutionCandidate(parentInput, p); lineageOptions(options);
  const available = AXES.filter(axis => (p.mode !== "fixed-reader-memory" || axis !== "reader")
    && (p.allowed[axis] as readonly unknown[]).some(value => value !== parent.genome[axis]));
  if (!available.length || options.axis !== undefined && !available.includes(options.axis)) fail("no allowed single-axis mutation");
  const axis = options.axis ?? available[choice(options.seed, [parent.id, "axis"], available.length)]!;
  const alternatives = (p.allowed[axis] as readonly unknown[]).filter(value => value !== parent.genome[axis]);
  const changed = { ...parent.genome, [axis]: alternatives[choice(options.seed, [parent.id, axis], alternatives.length)] };
  return makeCandidate(p, genome(changed, p), options, [parent], "mutation", axis);
}
export function crossoverEvolutionCandidates(leftInput: EvolutionCandidate, rightInput: EvolutionCandidate,
  inputPolicy: EvolutionPopulationPolicy, options: Readonly<{ hypothesis: string; seed: number }>): EvolutionCandidate {
  const p = policy(inputPolicy), left = validateEvolutionCandidate(leftInput, p), right = validateEvolutionCandidate(rightInput, p);
  lineageOptions(options);
  if (left.id === right.id) fail("crossover needs two distinct compatible parents");
  const mixed: Record<string, unknown> = {};
  for (const axis of AXES) mixed[axis] = choice(options.seed, [left.id, right.id, axis], 2) ? left.genome[axis] : right.genome[axis];
  // With two or more different loci, inherit at least one distinguishing gene from each parent.
  const different = AXES.filter(axis => left.genome[axis] !== right.genome[axis]);
  if (different.length > 1) {
    const first = choice(options.seed, [left.id, right.id, "left-locus"], different.length);
    mixed[different[first]!] = left.genome[different[first]!]!;
    mixed[different[(first + 1) % different.length]!] = right.genome[different[(first + 1) % different.length]!]!;
  }
  return makeCandidate(p, genome(mixed, p), options, [left, right], "crossover", null);
}

function developmentIdentity(value: EvolutionDevelopmentIdentity): EvolutionDevelopmentIdentity {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "split", "design", "datasetSha256", "selectionSha256", "judgeProfileSha256",
    "evaluationProtocolSha256", "totalQuestions"]) || value.protocol !== "oh.evolution-paired-development.v1"
    || value.split !== "development" || value.design !== "paired" || !integer(value.totalQuestions, 20_000) || value.totalQuestions < 1
    || [value.datasetSha256, value.selectionSha256, value.judgeProfileSha256, value.evaluationProtocolSha256].some(digest => parseSha256Hex(digest) === null)) {
    fail("paired development-only evaluation identity required");
  }
  return immutable(structuredClone(value));
}
function fitness(value: EvolutionDevelopmentFitness, identity: EvolutionDevelopmentIdentity): EvolutionDevelopmentFitness {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "identity", "candidateId", "reportSha256", "correct", "total", "costMicros", "latencyMs", "categories"])
    || value.protocol !== "oh.evolution-development-fitness.v1" || parseSha256Hex(value.candidateId) === null || parseSha256Hex(value.reportSha256) === null
    || canonicalSha256(developmentIdentity(value.identity)) !== canonicalSha256(identity)
    || value.total !== identity.totalQuestions || !integer(value.correct, value.total) || !integer(value.costMicros, 1_000_000_000_000)
    || typeof value.latencyMs !== "number" || !Number.isFinite(value.latencyMs) || value.latencyMs < 0 || Object.is(value.latencyMs, -0) || value.latencyMs > 86_400_000
    || !Array.isArray(value.categories) || value.categories.length > 64) fail("incompatible or incomplete paired-development fitness");
  for (const category of value.categories) if (!isPlainRecord(category) || !hasExactKeys(category, ["id", "correct", "total"])
    || !text(category.id, 256) || !integer(category.total, value.total) || category.total < 1 || !integer(category.correct, category.total)
    || category.correct > value.correct || category.total - category.correct > value.total - value.correct) fail("invalid category fitness");
  if (!unique(value.categories.map(category => category.id))) fail("duplicate category fitness");
  return immutable(structuredClone(value));
}
function dominates(a: EvolutionDevelopmentFitness, b: EvolutionDevelopmentFitness): boolean {
  return a.correct >= b.correct && a.costMicros <= b.costMicros && a.latencyMs <= b.latencyMs
    && (a.correct > b.correct || a.costMicros < b.costMicros || a.latencyMs < b.latencyMs);
}
function compareFitness(a: EvolutionDevelopmentFitness, b: EvolutionDevelopmentFitness): number {
  return b.correct - a.correct || a.costMicros - b.costMicros || a.latencyMs - b.latencyMs || a.candidateId.localeCompare(b.candidateId);
}

/** Development ranking only. No confidence interval, held-out score or superiority claim is generated. */
export function selectEvolutionParents(input: Readonly<{ policy: EvolutionPopulationPolicy; candidates: readonly EvolutionCandidate[];
  results: readonly EvolutionDevelopmentFitness[]; identity: EvolutionDevelopmentIdentity; limit: number;
  specialistCategories?: readonly string[] }>) {
  const p = policy(input.policy), identity = developmentIdentity(input.identity);
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > p.maximumPopulation
    || !Array.isArray(input.results) || input.results.length !== input.candidates.length
    || !integer(input.limit, input.candidates.length) || input.limit < 1) fail("population or parent selection bound");
  const candidates = input.candidates.map(candidate => validateEvolutionCandidate(candidate, p));
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const scores = input.results.map(result => fitness(result, identity)).sort(compareFitness);
  if (byId.size !== candidates.length || !unique(scores.map(score => score.candidateId)) || scores.some(score => !byId.has(score.candidateId))) fail("complete unique candidate/fitness correspondence required");
  const categories = input.specialistCategories ?? [];
  if (!Array.isArray(categories) || categories.length > 8 || categories.some(category => !text(category, 256)) || !unique(categories)) fail("invalid specialist category request");
  const categoryShape = (score: EvolutionDevelopmentFitness) => score.categories.map(category => [category.id, category.total]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (scores.some(score => canonicalSha256(categoryShape(score)) !== canonicalSha256(categoryShape(scores[0]!)))) fail("category comparisons use different evaluation cases");
  const pareto = scores.filter(score => !scores.some(other => dominates(other, score)));
  const specialists: string[] = [];
  for (const category of categories) {
    const ranked = [...scores].sort((a, b) => {
      const left = a.categories.find(value => value.id === category), right = b.categories.find(value => value.id === category);
      if (left === undefined || right === undefined) fail("requested specialist category is absent");
      return right.correct - left.correct || compareFitness(a, b);
    });
    if (!ranked[0]!.categories.some(value => value.id === category)) fail("requested specialist category is absent");
    if (!specialists.includes(ranked[0]!.candidateId)) specialists.push(ranked[0]!.candidateId);
  }
  if (specialists.length > input.limit) fail("parent limit cannot retain every requested specialist");
  const selected = [...specialists];
  for (const score of pareto) if (selected.length < input.limit && !selected.includes(score.candidateId)) selected.push(score.candidateId);
  const payload = { protocol: "oh.evolution-parent-selection.v1" as const, policySha256: p.policySha256,
    identitySha256: canonicalSha256(identity), fitnessSha256: canonicalSha256(scores),
    parentIds: selected, paretoIds: pareto.map(score => score.candidateId), specialistIds: specialists,
    requestedLimit: input.limit, specialistCategories: [...categories] };
  return immutable({ ...payload, parents: selected.map(id => byId.get(id)!), selectionSha256: canonicalSha256(payload) });
}
