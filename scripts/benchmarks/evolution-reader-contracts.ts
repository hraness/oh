import { canonicalSha256 } from "../../src/canonical";
import type { Question } from "./datasets";
import { ANSWER_INSTRUCTION, answerMessages, type Message } from "./model";

export const EVOLUTION_READER_CONTRACT_IDS = ["legacy-v1", "explicit-abstention-v1", "composition-v1", "explicit-abstention-composition-v1",
  "calibrated-composition-v1", "timeline-composition-v1"] as const;
export type EvolutionReaderContractId = typeof EVOLUTION_READER_CONTRACT_IDS[number];
export type EvolutionReaderAblationContractId = Exclude<EvolutionReaderContractId, "legacy-v1">;
const OLD_ABSTENTION = "If the evidence does not support an answer, reply exactly None.";
const EXPLICIT_ABSTENTION = "If the evidence does not support an answer, state that the supplied conversation does not contain enough information to answer the question. Do not use an ambiguous bare placeholder.";
const COMPOSITION = "Before answering, identify the distinct relevant events and facts across the supplied memory. "
  + "Do not count repeated descriptions of the same event as new events. Resolve relative dates using the date of the source statement, and apply the question date when interpreting time windows. "
  + "For current-state questions, use the latest applicable update rather than an earlier value or the last-mentioned unrelated event. "
  + "Distinguish cumulative totals from separate increments. For a requested count, total, difference, ratio, duration, or order, combine the relevant facts and compute the requested result with consistent units. "
  + "For recommendations, use the person's relevant remembered preferences and exclusions. Check that the final answer addresses the current question, includes every requested part, and does not add unsupported qualifications. "
  + "Keep this work internal and return only the concise complete answer.";
const CALIBRATED_ABSTENTION = "State that the supplied conversation does not contain enough information only when no relevant evidence exists. "
  + "When the evidence supports a best answer under its most natural reading, give that answer directly instead of hedging; for example, treat the only recorded order from a service as the first order. Do not use an ambiguous bare placeholder.";
const CALIBRATION = "Give exact values: state the computed number, amount, date or name itself, without qualifiers such as over, about or at least unless the evidence itself is approximate. "
  + "For yes/no questions, begin with Yes or No. For recommendation or preference questions, answer in one or two sentences that make concrete suggestions tailored to the remembered preferences and exclusions; do not list facts or add a preamble.";
const TIMELINE = "Work through time explicitly before answering: note the date of each relevant statement and the date of each event it describes, convert relative expressions such as last week, four weeks ago or next year using the statement date, and order events by those dates. "
  + "For counts, enumerate each distinct supported item with its date before totaling, include items mentioned across different sessions, and exclude repeated mentions of the same item. Keep this work internal and return only the final answer.";
function instruction(id: EvolutionReaderContractId): string {
  if (id === "legacy-v1") return ANSWER_INSTRUCTION;
  if (id === "calibrated-composition-v1" || id === "timeline-composition-v1") {
    if (ANSWER_INSTRUCTION.split(OLD_ABSTENTION).length !== 2) throw new TypeError("Evolution reader contract: legacy abstention instruction changed.");
    return `${ANSWER_INSTRUCTION.replace(OLD_ABSTENTION, CALIBRATED_ABSTENTION)} ${COMPOSITION} ${CALIBRATION}${id === "timeline-composition-v1" ? ` ${TIMELINE}` : ""}`;
  }
  // Fail closed if the frozen legacy instruction changes rather than silently losing the isolated replacement.
  if (ANSWER_INSTRUCTION.split(OLD_ABSTENTION).length !== 2) throw new TypeError("Evolution reader contract: legacy abstention instruction changed.");
  const abstention = id === "explicit-abstention-v1" || id === "explicit-abstention-composition-v1";
  const composition = id === "composition-v1" || id === "explicit-abstention-composition-v1";
  return (abstention ? ANSWER_INSTRUCTION.replace(OLD_ABSTENTION, EXPLICIT_ABSTENTION) : ANSWER_INSTRUCTION) + (composition ? ` ${COMPOSITION}` : "");
}
function contract(id: EvolutionReaderContractId) {
  const system = instruction(id);
  return Object.freeze({ id, protocol: "oh.memory.evolution-reader-contract.v1" as const, instruction: system, instructionSha256: canonicalSha256(system) });
}
export const EVOLUTION_READER_CONTRACTS = Object.freeze({
  "legacy-v1": contract("legacy-v1"),
  "explicit-abstention-v1": contract("explicit-abstention-v1"),
  "composition-v1": contract("composition-v1"),
  "explicit-abstention-composition-v1": contract("explicit-abstention-composition-v1"),
  "calibrated-composition-v1": contract("calibrated-composition-v1"),
  "timeline-composition-v1": contract("timeline-composition-v1"),
});
export function parseEvolutionReaderContractId(value: unknown): EvolutionReaderContractId {
  if (typeof value !== "string" || !Object.hasOwn(EVOLUTION_READER_CONTRACTS, value)) throw new TypeError("Evolution reader contract: unknown contract.");
  return value as EvolutionReaderContractId;
}
/** Gold-free input whitelist; the legacy path returns the exact prior message bytes. */
export function evolutionAnswerMessages(question: Pick<Question, "question" | "questionDate">, context: string,
  contract: EvolutionReaderContractId = "legacy-v1"): Message[] {
  const selected = parseEvolutionReaderContractId(contract), messages = answerMessages(question, context);
  return selected === "legacy-v1" ? messages : [{ role: "system", content: EVOLUTION_READER_CONTRACTS[selected].instruction }, messages[1]!];
}
