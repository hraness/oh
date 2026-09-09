import { hasExactKeys, isPlainRecord } from "../../src/canonical";
import { parseEvolutionExperimentVariant, type EvolutionExperimentVariant } from "./evolution-variants";
import { OH_SPAN_PROTOTYPE_VARIANTS, type OhSpanPrototypeVariant } from "./evolution-spans-prototype";

/** Fixed mechanism experiments and an untruncated control stay outside the V1 genetic domain. */
export type EvolutionPrototypeVariant = Readonly<{ id: string; system: "oh-source-spans-v2";
  mechanism: OhSpanPrototypeVariant; budget: Readonly<{ topK: 100; contextBytes: 48000 }> }>;
export type EvolutionFullHistoryVariant = Readonly<{ id: string; system: "full-history" }>;
export type EvolutionTreatment = EvolutionExperimentVariant | EvolutionPrototypeVariant | EvolutionFullHistoryVariant;
export function isEvolutionV3Treatment(value: EvolutionTreatment): value is EvolutionPrototypeVariant | EvolutionFullHistoryVariant {
  return value.system === "oh-source-spans-v2" || value.system === "full-history";
}
export function parseEvolutionTreatment(value: unknown): EvolutionTreatment {
  const fail = (): never => { throw new TypeError("Evolution V3 treatment: invalid fixed mechanism or full-history control."); };
  if (!isPlainRecord(value) || !["oh-source-spans-v2", "full-history"].includes(String(value.system))) return parseEvolutionExperimentVariant(value);
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(value.id)) return fail();
  if (value.system === "full-history") {
    if (!hasExactKeys(value, ["id", "system"])) return fail();
    return { id: value.id, system: value.system };
  }
  if (!hasExactKeys(value, ["id", "system", "mechanism", "budget"])
    || !OH_SPAN_PROTOTYPE_VARIANTS.includes(value.mechanism as OhSpanPrototypeVariant)
    || !isPlainRecord(value.budget) || !hasExactKeys(value.budget, ["topK", "contextBytes"])
    || value.budget.topK !== 100 || value.budget.contextBytes !== 48000) return fail();
  return { id: value.id, system: "oh-source-spans-v2", mechanism: value.mechanism as OhSpanPrototypeVariant,
    budget: { topK: 100, contextBytes: 48000 } };
}
