import { hasExactKeys, isPlainRecord } from "../../src/canonical";
import { EVOLUTION_RETRIEVAL_SYSTEMS, type EvolutionRetrievalSystem, type EvolutionRetrievalVariant } from "./evolution-retrieval";

/** Experiment treatments are separate from native search modes. */
export const EVOLUTION_EXPERIMENT_SYSTEMS = [...EVOLUTION_RETRIEVAL_SYSTEMS, "oh-source-spans"] as const;
export type EvolutionExperimentSystem = typeof EVOLUTION_EXPERIMENT_SYSTEMS[number];
export type EvolutionSpanVariant = Readonly<{ id: string; system: "oh-source-spans"; budget: Readonly<{ topK: 100; contextBytes: number }> }>;
export type EvolutionExperimentVariant = EvolutionRetrievalVariant | EvolutionSpanVariant;

export function isEvolutionSpanVariant(value: EvolutionExperimentVariant): value is EvolutionSpanVariant {
  return value.system === "oh-source-spans";
}
export function evolutionGenomeCompatible(value: Readonly<{ system: EvolutionExperimentSystem; topK: number; contextBytes: number }>): boolean {
  if (value.system.startsWith("oh-recall") || value.system.endsWith("-obs")) return value.topK <= 100;
  return value.system !== "oh-source-spans" || value.topK === 100 && value.contextBytes <= 96_000;
}
export function parseEvolutionExperimentVariant(value: unknown): EvolutionExperimentVariant {
  const fail = (): never => { throw new TypeError("Evolution variant: invalid treatment or budget."); };
  if (!isPlainRecord(value) || !hasExactKeys(value, ["id", "system", "budget"])
    || typeof value.id !== "string" || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(value.id)
    || !EVOLUTION_EXPERIMENT_SYSTEMS.includes(value.system as EvolutionExperimentSystem)
    || !isPlainRecord(value.budget) || !hasExactKeys(value.budget, ["topK", "contextBytes"])) return fail();
  const { topK, contextBytes } = value.budget;
  if (typeof topK !== "number" || !Number.isSafeInteger(topK) || topK < 1 || topK > 400
    || typeof contextBytes !== "number" || !Number.isSafeInteger(contextBytes) || contextBytes < 1 || contextBytes > 1_000_000
    || !evolutionGenomeCompatible({ system: value.system as EvolutionExperimentSystem, topK, contextBytes })) return fail();
  return value.system === "oh-source-spans"
    ? { id: value.id, system: value.system, budget: { topK: 100, contextBytes } }
    : { id: value.id, system: value.system as EvolutionRetrievalSystem, budget: { topK, contextBytes } };
}
