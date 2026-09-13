import { canonicalJson, type JsonValue } from "./document-domain";
import { knowledgeDeclarativeJson } from "./knowledge-declarative-json";
import {
  knowledgeGraphRecordKeyV1,
  parseKnowledgeGraphRecordV1,
  SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1,
  type KnowledgeGraphRecordKindV1,
} from "./knowledge-ontology-contract-v1";
import { exactKeys, isRecord } from "./unknown";
import type { SpongeKnowledgeSemanticRecordInputV2 } from
  "./record-input";

export const SPONGE_AGENT_CORE_CONCEPT_CODES_V2 = [
  "account",
  "agent",
  "artifact",
  "concept",
  "entity",
  "event",
  "information-resource",
  "inquiry",
  "organization",
  "person",
  "place",
  "process",
  "source",
  "work",
] as const;

export const SPONGE_AGENT_CORE_PREDICATE_CODES_V2 = [
  "about",
  "authored-by",
  "cites",
  "created-by",
  "derived-from",
  "description",
  "identifier",
  "located-in",
  "name",
  "object",
  "part-of",
  "related-to",
  "same-as",
] as const;

export const SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2 = [
  "activity",
  "assertion",
  "context",
  "entity",
  "evidence",
  "identity-operation",
  "inquiry",
  "inquiry-event",
  "schema",
  "shape",
  "statement",
  "type-membership",
  "view",
  "vocabulary",
] as const satisfies readonly KnowledgeGraphRecordKindV1[];

export type SpongeAgentProposableKnowledgeKindV2 =
  (typeof SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2)[number];

export type SpongeKnowledgeProposalBundleV2 = Readonly<{
  records: readonly SpongeKnowledgeSemanticRecordInputV2[];
  v: 2;
}>;

const callerKeyPattern = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
const maximumRecords = 256;

function validCallerKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512
    && callerKeyPattern.test(value);
}

function authorityFreeProposalRecord(
  kind: SpongeAgentProposableKnowledgeKindV2,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false;
  if (kind === "assertion") return value["state"] === "proposed"
    && Array.isArray(value["acceptedPurposes"])
    && value["acceptedPurposes"].length === 0
    && value["reviewActivitySha256"] === null;
  if (kind === "evidence") return value["disclosure"] === "private";
  if (kind === "schema") return value["reviewDecisionSha256"] === null;
  if (kind === "activity") return value["kind"] !== "human-review";
  return true;
}

/** Revalidates the compiled, authority-free proposal envelope. */
export async function parseSpongeKnowledgeProposalBundleV2(
  foreign: unknown,
): Promise<SpongeKnowledgeProposalBundleV2 | null> {
  const value = knowledgeDeclarativeJson(foreign, 4 * 1_024 * 1_024, { maxDepth: 48, maxNodes: 250_000 });
  if (!isRecord(value) || !exactKeys(value, ["records", "v"])
    || value["v"] !== 2 || !Array.isArray(value["records"])
    || value["records"].length < 1 || value["records"].length > maximumRecords) {
    return null;
  }
  const parsed: Array<Readonly<{
    input: SpongeKnowledgeSemanticRecordInputV2;
    orderKey: string;
  }>> = [];
  const callerKinds = new Set<KnowledgeGraphRecordKindV1>(
    SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1,
  );
  const allowedKinds = new Set<KnowledgeGraphRecordKindV1>(
    SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2,
  );
  for (const candidate of value["records"]) {
    if (!isRecord(candidate)) return null;
    const hasCallerKey = Object.hasOwn(candidate, "callerRecordKey");
    if (!exactKeys(candidate, hasCallerKey
      ? ["callerRecordKey", "kind", "value"]
      : ["kind", "value"])) return null;
    const kind = SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2.find(
      (item) => item === candidate["kind"],
    );
    if (kind === undefined || !allowedKinds.has(kind)) return null;
    const needsCallerKey = callerKinds.has(kind);
    if (hasCallerKey !== needsCallerKey) return null;
    const callerRecordKey = hasCallerKey && validCallerKey(candidate["callerRecordKey"])
      ? candidate["callerRecordKey"] : undefined;
    if (needsCallerKey && callerRecordKey === undefined) return null;
    const record = await parseKnowledgeGraphRecordV1(kind, candidate["value"]);
    if (!record.ok || !authorityFreeProposalRecord(kind, record.value.value)) return null;
    const recordKey = knowledgeGraphRecordKeyV1(
      kind,
      record.value.value,
      callerRecordKey,
    );
    if (!recordKey.ok) return null;
    const input: SpongeKnowledgeSemanticRecordInputV2 = {
      ...(callerRecordKey === undefined ? {} : { callerRecordKey }),
      kind,
      value: record.value.value,
    };
    const orderPayload: JsonValue = {
      kind,
      recordKey: recordKey.value,
      recordSha256: record.value.recordSha256,
      v: 2,
    };
    parsed.push({ input, orderKey: canonicalJson(orderPayload) });
  }
  parsed.sort((left, right) => left.orderKey.localeCompare(right.orderKey));
  if (parsed.some((item, index) => index > 0
    && parsed[index - 1]?.orderKey === item.orderKey)) return null;
  return { records: parsed.map((item) => item.input), v: 2 };
}
