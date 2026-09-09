import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createEvolutionSeedCandidate, crossoverEvolutionCandidates, mutateEvolutionCandidate, parseEvolutionPopulationPolicy,
  selectEvolutionParents, validateEvolutionCandidate, type EvolutionCandidate, type EvolutionDevelopmentFitness,
  type EvolutionDevelopmentIdentity, type EvolutionGenome } from "../scripts/benchmarks/evolution-population";

const policyInput = { protocol: "oh.evolution-population-policy.v1", mode: "fixed-reader-memory", fixedReader: "gpt5-nano-reader",
  allowed: { system: ["bm25-window", "bm25-session", "oh-facets"], topK: [10, 20, 40], contextBytes: [12_000, 24_000, 96_000], reader: ["gpt5-nano-reader"] },
  maximumPopulation: 16 };
const policy = parseEvolutionPopulationPolicy(policyInput);
const genome: EvolutionGenome = { system: "bm25-window", topK: 20, contextBytes: 24_000, reader: "gpt5-nano-reader" };
const seed = (index: number, g: EvolutionGenome = genome) => createEvolutionSeedCandidate(g, policy,
  { hypothesis: `Bounded development hypothesis ${index}`, seed: index });
const identity: EvolutionDevelopmentIdentity = { protocol: "oh.evolution-paired-development.v1", split: "development", design: "paired",
  datasetSha256: sha256Hex("dataset"), selectionSha256: sha256Hex("same development questions"), judgeProfileSha256: sha256Hex("same judge"),
  evaluationProtocolSha256: sha256Hex("same failure/cost/latency protocol"), totalQuestions: 100 };
function score(candidate: EvolutionCandidate, correct: number, costMicros: number, latencyMs: number,
  temporal = 10): EvolutionDevelopmentFitness {
  return { protocol: "oh.evolution-development-fitness.v1", candidateId: candidate.id, identity, reportSha256: sha256Hex(`report:${candidate.id}`),
    correct, total: 100, costMicros, latencyMs, categories: [{ id: "temporal", correct: temporal, total: 20 }] };
}

describe("pure bounded memory evolution", () => {
  test("seeds have immutable policy-bound genome and lineage hashes", () => {
    const left = seed(17), right = seed(17);
    expect(left).toEqual(right); expect(left.parentIds).toEqual([]); expect(left.generation).toBe(0);
    expect(left.origin).toBe("seed"); expect(left.genomeSha256).toBe(canonicalSha256(genome));
    const { id, ...payload } = left; expect(id).toBe(canonicalSha256(payload));
    expect(Object.isFrozen(left.genome)).toBe(true); expect(Object.isFrozen(left.parentIds)).toBe(true);
    expect(validateEvolutionCandidate(JSON.parse(JSON.stringify(left)), policy)).toEqual(left);
    expect(seed(18).id).not.toBe(left.id); expect(seed(18).genomeSha256).toBe(left.genomeSha256);
  });

  test("single-axis mutations are deterministic, different, allowed and keep the fixed reader", () => {
    const parent = seed(1);
    for (const axis of ["system", "topK", "contextBytes"] as const) {
      const options = { hypothesis: `Change only ${axis}`, seed: 72, axis };
      const child = mutateEvolutionCandidate(parent, policy, options);
      expect(child).toEqual(mutateEvolutionCandidate(parent, policy, options));
      expect(Object.keys(genome).filter(key => child.genome[key as keyof EvolutionGenome] !== parent.genome[key as keyof EvolutionGenome])).toEqual([axis]);
      expect(child.genome.reader).toBe(parent.genome.reader); expect(child.parentIds).toEqual([parent.id]);
      expect(child).toMatchObject({ origin: "mutation", mutationAxis: axis, generation: 1, seed: 72 });
      expect(validateEvolutionCandidate(child, policy)).toEqual(child);
    }
    const automatic = { seed: 42, hypothesis: "One declared deterministic mutation" };
    expect(mutateEvolutionCandidate(parent, policy, automatic)).toEqual(mutateEvolutionCandidate(parent, policy, automatic));
    expect(() => mutateEvolutionCandidate(parent, policy, { ...automatic, axis: "reader" })).toThrow("single-axis");
  });

  test("compatible crossover mixes parental genes and records both parents", () => {
    const left = seed(1), right = seed(2, { ...genome, system: "oh-facets", topK: 40, contextBytes: 96_000 });
    const options = { hypothesis: "Combine independent source packing and depth ideas", seed: 17 };
    const child = crossoverEvolutionCandidates(left, right, policy, options);
    expect(child).toEqual(crossoverEvolutionCandidates(left, right, policy, options));
    expect(child.parentIds).toEqual([left.id, right.id]); expect(child.origin).toBe("crossover"); expect(child.generation).toBe(1);
    const different = ["system", "topK", "contextBytes"] as const;
    expect(different.some(axis => child.genome[axis] === left.genome[axis])).toBe(true);
    expect(different.some(axis => child.genome[axis] === right.genome[axis])).toBe(true);
    expect(different.every(axis => [left.genome[axis], right.genome[axis]].includes(child.genome[axis] as never))).toBe(true);
    expect(child.genome.reader).toBe("gpt5-nano-reader");
    expect(() => crossoverEvolutionCandidates(left, left, policy, options)).toThrow("two distinct");
    const differentPolicy = parseEvolutionPopulationPolicy({ ...policyInput, maximumPopulation: 8 });
    expect(() => crossoverEvolutionCandidates(left, right, differentPolicy, options)).toThrow("incompatible");
  });

  test("reader evolution requires an explicit system-frontier policy", () => {
    expect(() => parseEvolutionPopulationPolicy({ ...policyInput, allowed: { ...policyInput.allowed, reader: ["gpt5-nano-reader", "gpt5-mini-reader"] } })).toThrow("cannot breed");
    const frontier = parseEvolutionPopulationPolicy({ ...policyInput, mode: "system-frontier", fixedReader: null,
      allowed: { ...policyInput.allowed, reader: ["gpt5-nano-reader", "gpt5-mini-reader"] } });
    const parent = createEvolutionSeedCandidate(genome, frontier, { hypothesis: "System cost/quality frontier", seed: 0 });
    const child = mutateEvolutionCandidate(parent, frontier, { hypothesis: "Measure reader upgrade separately", seed: 1, axis: "reader" });
    expect(child.genome.reader).toBe("gpt5-mini-reader");
    expect(child.genome.topK).toBe(parent.genome.topK); expect(child.genome.contextBytes).toBe(parent.genome.contextBytes);
    expect(() => validateEvolutionCandidate(child, policy)).toThrow("incompatible");
  });

  test("invalid domains, unsupported genes and unbounded populations fail before breeding", () => {
    for (const invalid of [
      { ...policyInput, maximumPopulation: 129 }, { ...policyInput, maximumPopulation: 0 },
      { ...policyInput, allowed: { ...policyInput.allowed, topK: [20, 20] } },
      { ...policyInput, allowed: { ...policyInput.allowed, topK: [0] } },
      { ...policyInput, allowed: { ...policyInput.allowed, contextBytes: [4_000_001] } },
      { ...policyInput, allowed: { ...policyInput.allowed, system: ["imaginary-memory"] } },
      { ...policyInput, allowed: { ...policyInput.allowed, reader: ["gpt4o-gateway-judge"] } },
    ]) expect(() => parseEvolutionPopulationPolicy(invalid)).toThrow();
    expect(() => createEvolutionSeedCandidate({ ...genome, topK: 99 }, policy, { hypothesis: "Invalid gene", seed: 1 })).toThrow("allowed");
    expect(() => createEvolutionSeedCandidate(genome, policy, { hypothesis: "Invalid seed", seed: -1 })).toThrow("lineage seed");
    const constant = parseEvolutionPopulationPolicy({ ...policyInput, allowed: { system: [genome.system], topK: [genome.topK],
      contextBytes: [genome.contextBytes], reader: [genome.reader] } });
    const parent = createEvolutionSeedCandidate(genome, constant, { hypothesis: "One fixed genotype", seed: 1 });
    expect(() => mutateEvolutionCandidate(parent, constant, { hypothesis: "No mutation exists", seed: 1 })).toThrow("single-axis");
  });

  test("Pareto parent selection compares paired accuracy/cost/latency without selecting dominated rows", () => {
    const candidates = [seed(1), seed(2), seed(3), seed(4)];
    const results = [score(candidates[0]!, 80, 1000, 50), score(candidates[1]!, 79, 1100, 60),
      score(candidates[2]!, 85, 1500, 70), score(candidates[3]!, 78, 500, 40)];
    const input = { policy, identity, candidates, results, limit: 3 };
    const selected = selectEvolutionParents(input);
    expect(selected.parentIds).toEqual([candidates[2]!.id, candidates[0]!.id, candidates[3]!.id]);
    expect(selected.paretoIds).not.toContain(candidates[1]!.id);
    expect(selected).toEqual(selectEvolutionParents({ ...input, candidates: [...candidates].reverse(), results: [...results].reverse() }));
    expect(Object.isFrozen(selected.parents)).toBe(true);
  });

  test("optional category specialists survive overall Pareto domination", () => {
    const champion = seed(1), specialist = seed(2), cheap = seed(3), candidates = [champion, specialist, cheap];
    const results = [score(champion, 85, 1000, 50, 17), score(specialist, 82, 1200, 60, 20), score(cheap, 75, 500, 40, 10)];
    const ordinary = selectEvolutionParents({ policy, identity, candidates, results, limit: 2 });
    expect(ordinary.parentIds).not.toContain(specialist.id);
    const selected = selectEvolutionParents({ policy, identity, candidates, results, limit: 2, specialistCategories: ["temporal"] });
    expect(selected.parentIds).toEqual([specialist.id, champion.id]); expect(selected.specialistIds).toEqual([specialist.id]);
    expect(selected.paretoIds).not.toContain(specialist.id);
    expect(() => selectEvolutionParents({ policy, identity, candidates, results, limit: 2, specialistCategories: ["unknown"] })).toThrow("absent");
    const twoSpecialists = results.map((result, index) => ({ ...result,
      categories: [...result.categories, { id: "abstention", correct: index === 0 ? 20 : 10, total: 20 }] }));
    expect(() => selectEvolutionParents({ policy, identity, candidates, results: twoSpecialists, limit: 1,
      specialistCategories: ["temporal", "abstention"] })).toThrow("retain every");
  });

  test("rejects held-out, unpaired, different-selection and different-judge scores", () => {
    const candidate = seed(1), good = score(candidate, 80, 1000, 50);
    for (const change of [
      { protocol: "unreviewed-evaluation" }, { split: "test" }, { design: "unpaired" },
      { selectionSha256: sha256Hex("different sample") }, { judgeProfileSha256: sha256Hex("different judge") },
      { datasetSha256: sha256Hex("different dataset") }, { evaluationProtocolSha256: sha256Hex("different failure policy") },
    ]) {
      const bad = { ...good, identity: { ...identity, ...change } } as EvolutionDevelopmentFitness;
      expect(() => selectEvolutionParents({ policy, identity, candidates: [candidate], results: [bad], limit: 1 })).toThrow();
    }
    expect(() => selectEvolutionParents({ policy, identity: { ...identity, split: "test" } as unknown as EvolutionDevelopmentIdentity,
      candidates: [candidate], results: [good], limit: 1 })).toThrow("development-only");
  });

  test("requires complete result correspondence, safe scores and matching category counts", () => {
    const left = seed(1), right = seed(2), candidates = [left, right], results = [score(left, 80, 1000, 50), score(right, 81, 1100, 60)];
    const input = { policy, identity, candidates, results, limit: 1 };
    for (const changed of [
      { results: results.slice(0, 1) }, { results: [results[0]!, results[0]!] }, { limit: 0 },
      { results: [{ ...results[0]!, correct: 101 }, results[1]!] }, { results: [{ ...results[0]!, costMicros: -1 }, results[1]!] },
      { results: [{ ...results[0]!, latencyMs: NaN }, results[1]!] }, { results: [{ ...results[0]!, total: 99 }, results[1]!] },
      { results: [{ ...results[0]!, correct: 5, categories: [{ id: "temporal", correct: 10, total: 20 }] }, results[1]!] },
      { results: [{ ...results[0]!, categories: [{ id: "temporal", correct: 9, total: 19 }] }, results[1]!] },
    ]) expect(() => selectEvolutionParents({ ...input, ...changed })).toThrow();
    const bounded = parseEvolutionPopulationPolicy({ ...policyInput, maximumPopulation: 1 });
    expect(() => selectEvolutionParents({ ...input, policy: bounded })).toThrow("population");
  });
});
