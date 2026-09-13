import type { KnowledgeGraphRecordV1 as OhGraphRecord, KnowledgeGraphRecordKindV1 as OhKind } from "../graph";
import { canonicalJson, type JsonValue } from "./document-domain";
import { parseSha256Hex, sha256Text, utf8ByteLength, type Sha256Hex } from "./integrity-domain";
import { freezeKnowledgeDeclaration, knowledgeDeclarativeJson } from "./knowledge-declarative-json";
import { knowledgeGraphRecordKeyV1, parseKnowledgeGraphRecordV1,
  SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1, SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1,
  type KnowledgeGraphRecordKindV1 } from "./knowledge-ontology-contract-v1";
import { hasExactDataKeys, isPlainRecord } from "./unknown";

export const OH_RESEARCH_PACKET_PROFILE_V1 = "oh.research-packet.v1" as const;
export const OH_RESEARCH_PACKET_LIMITS_V1 = Object.freeze({
  records: 1_024, sourceBytes: 8 * 1_024 * 1_024, packetBytes: 16 * 1_024 * 1_024,
  recordBytes: 1_024 * 1_024, dependenciesPerRecord: 4_096,
});
export type OhResearchSourceRecordV1 = Readonly<{
  kind: KnowledgeGraphRecordKindV1;
  recordKey: string;
  recordSha256: Sha256Hex;
  value: JsonValue;
}>;
export type OhResearchRecordValueV1 = Readonly<{
  profile: typeof OH_RESEARCH_PACKET_PROFILE_V1;
  source: OhResearchSourceRecordV1;
  v: 1;
}>;
export type OhResearchPacketV1 = Readonly<{
  profile: typeof OH_RESEARCH_PACKET_PROFILE_V1;
  dependencyPolicy: "explicit-source-digests-and-schema-refs.v1";
  /** A transport packet supplies no review, identity-head, disclosure or host-authority decision. */
  authority: "unasserted";
  /** Hash of the complete ordered source identity/alias manifest. Exact snapshots
   * replay; changed snapshots may repeat unchanged source records under new keys. */
  sourceBindingSha256: Sha256Hex;
  records: readonly OhGraphRecord[];
  packetSha256: Sha256Hex;
  v: 1;
}>;

const prepared = new WeakSet<object>();
const callerKinds = new Set<KnowledgeGraphRecordKindV1>(SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1);
function json(value: unknown): string { return canonicalJson(value as JsonValue); }
function fail(message: string): never { throw new TypeError(`Invalid research packet: ${message}`); }

/** Immutable transport key; this is never a replacement for a source's semantic identity. */
export function ohResearchRecordKeyV1(kind: KnowledgeGraphRecordKindV1, sourceSha256: string,
  sourceBindingSha256: string): string {
  if (!SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind) || parseSha256Hex(sourceSha256) === null
    || parseSha256Hex(sourceBindingSha256) === null) fail("record key");
  return `research.v1/${sourceBindingSha256}/${kind}/${sourceSha256}`;
}

/** Internal proof of preparation, not a claim that any host has accepted the records. */
export function isPreparedOhResearchPacketV1(value: unknown): value is OhResearchPacketV1 {
  return typeof value === "object" && value !== null && prepared.has(value);
}

type DigestReference = Readonly<{ sha256: string; expectedKind: KnowledgeGraphRecordKindV1 | null;
  schemaRef?: JsonValue }>;
function references(source: OhResearchSourceRecordV1): readonly DigestReference[] {
  const value = source.value as Readonly<Record<string, JsonValue>>;
  const result: DigestReference[] = [];
  const add = (candidate: unknown, expectedKind: KnowledgeGraphRecordKindV1 | null = null): void => {
    if (candidate === null || candidate === undefined) return;
    const sha256 = parseSha256Hex(candidate);
    if (sha256 === null) fail("dependency digest");
    if (sha256 !== source.recordSha256) result.push({ sha256, expectedKind });
  };
  const many = (candidate: unknown, expectedKind: KnowledgeGraphRecordKindV1 | null = null): void => {
    if (!Array.isArray(candidate)) fail("dependency list");
    for (const item of candidate) add(item, expectedKind);
  };
  // Only fields whose source contract denotes graph records are dependencies. Policy,
  // raw artifact, payload, external receipt and synthesis candidate digests stay opaque.
  switch (source.kind) {
    case "activity": many(value["inputSha256s"]); many(value["outputSha256s"]); break;
    case "assertion": add(value["statementSha256"], "statement"); add(value["provenanceActivitySha256"], "activity");
      add(value["reviewActivitySha256"], "activity"); add(value["contextSha256"], "context"); break;
    case "dependency-manifest":
      for (const [field, kind] of [["activitySha256s", "activity"], ["assertionSha256s", "assertion"],
        ["contextSha256s", "context"], ["evidenceSha256s", "evidence"], ["reviewDecisionSha256s", "review-decision"],
        ["rightsDecisionSha256s", "rights-decision"], ["schemaRevisionSha256s", "schema"],
        ["statementSha256s", "statement"]] as const) many(value[field], kind);
      add(value["viewSpecSha256"], "view"); break;
    case "edition": add(value["dependencyManifestSha256"], "dependency-manifest"); add(value["reviewDecisionSha256"], "review-decision"); break;
    case "evidence": add(value["assertionSha256"], "assertion"); add(value["provenanceActivitySha256"], "activity"); break;
    case "identity-operation": add(value["activitySha256"], "activity"); break;
    case "inquiry": add(value["contextSha256"], "context"); break;
    case "inquiry-event": add(value["parentEventSha256"], "inquiry-event");
      for (const ref of [...value["inputRefs"] as JsonValue[], ...value["outputRefs"] as JsonValue[]]) {
        if (isPlainRecord(ref)) add(ref["sha256"], ref["kind"] as KnowledgeGraphRecordKindV1);
      } break;
    case "review-decision":
      if (value["subjectKind"] !== "synthesis-candidate") add(value["subjectSha256"], value["subjectKind"] as KnowledgeGraphRecordKindV1);
      add(value["supersedesDecisionSha256"], "review-decision"); break;
    case "rights-decision": add(value["subjectSha256"]); break;
    case "schema": add(value["previousRevisionSha256"], "schema"); add(value["reviewDecisionSha256"], "review-decision");
      add(value["vocabularySha256"], "vocabulary"); add(value["mappingActivitySha256"], "activity"); break;
    case "type-membership": add(value["assertionSha256"], "assertion"); add(value["contextSha256"], "context"); break;
    case "vocabulary": add(value["previousRevisionSha256"], "vocabulary"); break;
    case "view": many(value["includedContextSha256s"], "context"); many(value["excludedContextSha256s"], "context"); break;
    case "context": case "entity": case "shape": case "statement": break;
  }
  function visit(item: JsonValue): void {
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    if (!isPlainRecord(item)) return;
    if (hasExactDataKeys(item, ["code", "namespace", "revision", "schemaSha256", "v"])) {
      const sha256 = parseSha256Hex(item["schemaSha256"]);
      if (sha256 === null) fail("schema reference");
      if (sha256 !== source.recordSha256) result.push({ sha256, expectedKind: "schema", schemaRef: item as JsonValue });
      return;
    }
    for (const child of Object.values(item)) visit(child as JsonValue);
  }
  visit(source.value);
  if (result.length > OH_RESEARCH_PACKET_LIMITS_V1.dependenciesPerRecord) fail("dependency bound");
  return result;
}

/**
 * Performs asynchronous source codec/hash verification, then binds every declared
 * graph-digest dependency and exact schema reference to an immutable envelope key.
 * Logical entity IDs and opaque policy/artifact digests remain source data. No
 * identity-head, schema installation, factual truth or permission is inferred.
 */
export async function prepareOhResearchPacketV1(foreign: unknown): Promise<OhResearchPacketV1> {
  const input = knowledgeDeclarativeJson(foreign, OH_RESEARCH_PACKET_LIMITS_V1.sourceBytes,
    { maxDepth: 64, maxNodes: 500_000 });
  if (!isPlainRecord(input) || !hasExactDataKeys(input, ["records"]) || !Array.isArray(input["records"])
    || input["records"].length < 1 || input["records"].length > OH_RESEARCH_PACKET_LIMITS_V1.records) fail("input bounds");
  const sources: OhResearchSourceRecordV1[] = [];
  const bySha = new Map<string, OhResearchSourceRecordV1>();
  for (const candidate of input["records"]) {
    if (!isPlainRecord(candidate)) fail("source record");
    const hasCallerKey = Object.hasOwn(candidate, "callerRecordKey");
    if (!hasExactDataKeys(candidate, hasCallerKey ? ["callerRecordKey", "kind", "value"] : ["kind", "value"])) fail("source keys");
    const kind = SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((kind) => kind === candidate["kind"]);
    if (kind === undefined || hasCallerKey !== callerKinds.has(kind)) fail("source kind or caller key");
    const parsed = await parseKnowledgeGraphRecordV1(kind, candidate["value"]);
    if (!parsed.ok || json(parsed.value.value) !== json(candidate["value"])) fail("source codec or canonical bytes");
    const key = knowledgeGraphRecordKeyV1(kind, parsed.value.value, candidate["callerRecordKey"] as string | undefined);
    if (!key.ok) fail("source logical key");
    const source: OhResearchSourceRecordV1 = { kind, recordKey: key.value,
      recordSha256: parsed.value.recordSha256, value: parsed.value.value as JsonValue };
    if (bySha.has(source.recordSha256)) fail("duplicate source digest");
    bySha.set(source.recordSha256, source); sources.push(source);
  }
  const bindings = sources.map(({ kind, recordKey, recordSha256 }) => ({ kind, recordKey, recordSha256 }))
    .sort((a, b) => json(a) < json(b) ? -1 : 1);
  const sourceBindingSha256 = await sha256Text(json({ profile: OH_RESEARCH_PACKET_PROFILE_V1, bindings, v: 1 }));
  const keys = new Map<string, string>();
  for (const source of sources) keys.set(source.recordSha256,
    ohResearchRecordKeyV1(source.kind, source.recordSha256, sourceBindingSha256));
  const records: OhGraphRecord[] = [];
  for (const source of sources) {
    const dependencies = new Set<string>();
    for (const ref of references(source)) {
      const target = bySha.get(ref.sha256);
      if (target === undefined) fail(`missing dependency ${ref.sha256}`);
      if (ref.expectedKind !== null && target.kind !== ref.expectedKind) fail("dependency kind");
      if (ref.schemaRef !== undefined && (!isPlainRecord(target.value)
        || json(target.value["ref"]) !== json(ref.schemaRef))) fail("exact schema reference");
      dependencies.add(keys.get(target.recordSha256)!);
    }
    const value: OhResearchRecordValueV1 = { profile: OH_RESEARCH_PACKET_PROFILE_V1, source, v: 1 };
    if (utf8ByteLength(json(value)) > OH_RESEARCH_PACKET_LIMITS_V1.recordBytes) fail("record bytes");
    const payload = { dependencies: [...dependencies].sort(), key: keys.get(source.recordSha256)!,
      kind: source.kind as OhKind, v: 1 as const, value: value as JsonValue };
    records.push({ ...payload, recordSha256: await sha256Text(json(payload)) as unknown as OhGraphRecord["recordSha256"] });
  }
  records.sort((a, b) => a.key < b.key ? -1 : 1);
  const payload = { profile: OH_RESEARCH_PACKET_PROFILE_V1, dependencyPolicy: "explicit-source-digests-and-schema-refs.v1" as const,
    authority: "unasserted" as const, sourceBindingSha256, records, v: 1 as const };
  const packet = { ...payload, packetSha256: await sha256Text(json(payload)) };
  if (utf8ByteLength(json(packet)) > OH_RESEARCH_PACKET_LIMITS_V1.packetBytes) fail("packet bytes");
  // Stable object insertion order also makes Oh derived search text replay from
  // canonical operation JSON identically to its initial local projection.
  const canonicalPacket = JSON.parse(json(packet)) as OhResearchPacketV1;
  freezeKnowledgeDeclaration(canonicalPacket); prepared.add(canonicalPacket);
  return canonicalPacket;
}

/** Verify a serialized packet by regenerating its source, dependency mapping and both digest layers. */
export async function verifyOhResearchPacketV1(foreign: unknown): Promise<OhResearchPacketV1 | null> {
  try {
    const packet = knowledgeDeclarativeJson(foreign, OH_RESEARCH_PACKET_LIMITS_V1.packetBytes,
      { maxDepth: 72, maxNodes: 750_000 });
    if (!isPlainRecord(packet) || !hasExactDataKeys(packet,
      ["authority", "dependencyPolicy", "packetSha256", "profile", "sourceBindingSha256", "records", "v"])
      || !Array.isArray(packet["records"]) || packet["records"].length > OH_RESEARCH_PACKET_LIMITS_V1.records) return null;
    const records = packet["records"].map((record) => {
      if (!isPlainRecord(record) || !isPlainRecord(record["value"])) fail("envelope");
      const value = record["value"];
      if (!hasExactDataKeys(value, ["profile", "source", "v"]) || !isPlainRecord(value["source"])) fail("source wrapper");
      const source = value["source"];
      if (!hasExactDataKeys(source, ["kind", "recordKey", "recordSha256", "value"])) fail("source envelope");
      const kind = source["kind"] as KnowledgeGraphRecordKindV1;
      return { kind, value: source["value"], ...(callerKinds.has(kind) ? { callerRecordKey: typeof source["recordKey"] === "string"
        ? source["recordKey"].slice(String(source["kind"]).length + 1) : undefined } : {}) };
    });
    const expected = await prepareOhResearchPacketV1({ records });
    return json(expected) === json(packet) ? expected : null;
  } catch { return null; }
}
