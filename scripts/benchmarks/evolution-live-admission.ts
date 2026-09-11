import { EVOLUTION_PROFILES, type EvolutionProfileId } from "./evolution-model";

/** Operational eligibility is separate from immutable profile/request identity. Call with every
 * configured stage before preparing a new run; transport also checks each cache miss. This deny
 * guard is not provider qualification and never substitutes a profile or changes its budget. */
export function assertEvolutionLiveProfiles(profiles: readonly EvolutionProfileId[]): void {
  for (const profile of profiles) {
    if (!Object.hasOwn(EVOLUTION_PROFILES, profile)) throw new TypeError("Evolution live admission: unknown profile.");
    // Public negative qualification: benchmarks/results/memory-evolution-native-judge-rejection-v1.json.
    // Keep the catalog, constructors and stored evidence valid for historical replay.
    if (profile === "gpt4o-gateway-native-rubric-judge-v1") throw new TypeError(
      "Evolution live admission: the Gateway native 10-token judge is historical replay only; its captured provider rejection requires at least 16 output tokens. "
      + "New work requires an explicitly selected, separately qualified compatible profile; no automatic substitution.");
  }
}
