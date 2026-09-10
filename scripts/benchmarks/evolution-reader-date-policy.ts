/** Reader date policy for V9 studies. The policy is fixed in the study before any score is read and its
 * digest is recorded in every V9 context plan; the projection stays gold-free and label-free. */
import { canonicalSha256 } from "../../src/canonical";
import type { Dataset } from "./datasets";
import { projectEvolutionRunnerInput, type EvolutionRunnerInput } from "./evolution-dataset";

export const EVOLUTION_READER_DATE_POLICY_PROTOCOL = "oh.memory.evolution-reader-date-policy.v1" as const;
/** `question-date` sends the dataset's own question date verbatim (empty for LoCoMo). `final-session-date` sends
 * the date of the corpus's final turn in corpus order as the reference date, the closest analogue to the
 * leaders' LoCoMo harnesses, which pass a conversation reference date instead of an empty string. */
export const EVOLUTION_READER_DATE_POLICIES = ["question-date", "final-session-date"] as const;
export type EvolutionReaderDatePolicy = typeof EVOLUTION_READER_DATE_POLICIES[number];
function fail(reason: string): never { throw new TypeError(`Evolution reader date policy: ${reason}.`); }
export function parseEvolutionReaderDatePolicy(value: unknown): EvolutionReaderDatePolicy {
  if (typeof value !== "string" || !(EVOLUTION_READER_DATE_POLICIES as readonly string[]).includes(value)) fail("unknown policy");
  return value as EvolutionReaderDatePolicy;
}
export function evolutionReaderDatePolicySha256(policy: EvolutionReaderDatePolicy): string {
  return canonicalSha256({ protocol: EVOLUTION_READER_DATE_POLICY_PROTOCOL, policy: parseEvolutionReaderDatePolicy(policy) });
}
/** Final turn date per corpus, in corpus order; empty when the corpus has no dated turn. */
export function evolutionFinalSessionDates(dataset: Pick<Dataset, "corpora">): ReadonlyMap<string, string> {
  return new Map(dataset.corpora.map(c => {
    const last = c.turns.at(-1);
    if (last === undefined || typeof last.date !== "string" || Buffer.byteLength(last.date) > 256) fail("corpus final turn date required");
    return [c.id, last.date] as const;
  }));
}
/** The V9 projection step: the ordinary gold-free projection with the declared date policy applied to
 * `questionDate` only. Question text, corpus turns and identifiers are untouched, so retrieval queries and
 * source validation do not depend on the policy; only the reader payload does. */
export function projectEvolutionRunnerInputV9(dataset: Dataset, policy: EvolutionReaderDatePolicy): EvolutionRunnerInput {
  const projected = projectEvolutionRunnerInput(dataset), selected = parseEvolutionReaderDatePolicy(policy);
  if (selected === "question-date") return projected;
  const dates = evolutionFinalSessionDates(dataset), byRunnerCorpus = new Map(dataset.corpora.map((c, i) => [projected.corpora[i]!.id, dates.get(c.id)!]));
  return { corpora: projected.corpora, questions: projected.questions.map(q => ({ ...q, questionDate: byRunnerCorpus.get(q.corpusId) ?? fail("question corpus missing") })) };
}
