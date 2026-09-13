import { canonicalJson, type JsonValue } from "../canonical";
import { OhRecordCodecRegistry } from "../contract";
import { parseKnowledgeGraphRecordV1, type KnowledgeGraphRecordKindV1 } from "../graph";
import type { OhOperationV1 } from "../operation";
import { parseOhDependencyClosureV1, verifyOhDependencyClosureAgainstV1,
  type OhCommitInputV1, type OhDependencyClosureV1, type OhHeadV1, type OhStoreV1 } from "../store";
import { freezeKnowledgeDeclaration, knowledgeDeclarativeJson } from "./knowledge-declarative-json";
import { SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1 } from "./knowledge-ontology-contract-v1";
import { hasExactDataKeys, isPlainRecord } from "./unknown";
import { isPreparedOhResearchPacketV1, OH_RESEARCH_PACKET_LIMITS_V1, prepareOhResearchPacketV1,
  verifyOhResearchPacketV1, type OhResearchPacketV1 } from "./research-packet";

export const OH_RESEARCH_STORE_LIMITS_V1 = Object.freeze({ snapshotRecords: 8_192 });

export type OhResearchExportV1 = Readonly<{
  profile: "oh.research-export.v1";
  packet: OhResearchPacketV1;
  /** A source snapshot claim. This is not authority to write or publish at another host. */
  closure: OhDependencyClosureV1;
  v: 1;
}>;

/**
 * A sealed synchronous exact-byte allowlist over a privately branded, asynchronously
 * verified packet. This value-only codec cannot validate envelope keys or dependencies;
 * use commitOhResearchPacketV1 for the complete packet boundary. It is not a host acceptance policy.
 */
export function createOhResearchPacketCodecRegistryV1(packet: OhResearchPacketV1): OhRecordCodecRegistry {
  if (!isPreparedOhResearchPacketV1(packet)) throw new TypeError("Prepare or verify the research packet before creating codecs.");
  const byKind = new Map<KnowledgeGraphRecordKindV1, Map<string, JsonValue>>();
  for (const record of packet.records) {
    if (parseKnowledgeGraphRecordV1(record) === null) throw new TypeError("Invalid Oh research envelope.");
    const values = byKind.get(record.kind) ?? new Map<string, JsonValue>();
    values.set(canonicalJson(record.value), record.value);
    byKind.set(record.kind, values);
  }
  const codecs = new OhRecordCodecRegistry();
  for (const [kind, values] of byKind) codecs.register({ kind, parse(foreign) {
    const copy = knowledgeDeclarativeJson(foreign, OH_RESEARCH_PACKET_LIMITS_V1.recordBytes,
      { maxDepth: 72, maxNodes: 250_000 });
    return copy === undefined ? null : values.get(canonicalJson(copy)) ?? null;
  } });
  return codecs.seal();
}

export type OhResearchCommitInputV1 = Readonly<{
  store: OhStoreV1;
  packet: unknown;
  actorId: string;
  expectedHead: OhCommitInputV1["expectedHead"];
  operationId: string;
  instant: string;
}>;

/** Local explicit-target commit. Source authority records remain transported claims. */
export async function commitOhResearchPacketV1(input: OhResearchCommitInputV1): Promise<OhOperationV1> {
  const packet = isPreparedOhResearchPacketV1(input.packet) ? input.packet : await verifyOhResearchPacketV1(input.packet);
  if (packet === null) throw new TypeError("Invalid research packet.");
  const codecs = createOhResearchPacketCodecRegistryV1(packet);
  // Inspect a complete bounded current snapshot before writing immutable keys. The
  // caller's CAS still governs the commit, including races after this read.
  const snapshot = await input.store.snapshot({ maximumRecords: OH_RESEARCH_STORE_LIMITS_V1.snapshotRecords });
  const current = new Map(snapshot.records.map((record) => [record.key, record]));
  if (new Set([...current.keys(), ...packet.records.map((record) => record.key)]).size
    > OH_RESEARCH_STORE_LIMITS_V1.snapshotRecords) {
    throw new RangeError("Research commit would exceed the bounded current snapshot.");
  }
  for (const record of packet.records) {
    const existing = current.get(record.key);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(record)) {
      throw new TypeError("An immutable research key already contains different bytes.");
    }
    if (codecs.parseRequired(record.kind, record.value) === null) throw new TypeError("Research packet codec rejected a record.");
  }
  return input.store.commit({ actorId: input.actorId, expectedHead: input.expectedHead,
    operationId: input.operationId, instant: input.instant,
    changes: packet.records.map((record) => ({ kind: "put", record, v: 1 })) });
}

async function packetFromClosure(closure: OhDependencyClosureV1): Promise<OhResearchPacketV1> {
  const callerKinds = new Set<string>(SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1);
  const records = closure.records.map((record) => {
    const wrapper = record.value;
    if (!isPlainRecord(wrapper) || !hasExactDataKeys(wrapper, ["profile", "source", "v"])
      || !isPlainRecord(wrapper["source"])) throw new TypeError("The selected closure contains a different record profile.");
    const source = wrapper["source"];
    return { kind: source["kind"], value: source["value"],
      ...(callerKinds.has(source["kind"] as string) ? { callerRecordKey: typeof source["recordKey"] === "string"
        ? source["recordKey"].slice(String(source["kind"]).length + 1) : undefined } : {}) };
  });
  const packet = await prepareOhResearchPacketV1({ records });
  if (canonicalJson(packet.records) !== canonicalJson(closure.records)) throw new TypeError("Research source or dependency mapping differs from its stored envelope.");
  return packet;
}

/** Read a complete research snapshot at one exact local store head. Roots must
 * reach every source in the prepared packet; partial snapshots fail closed. */
export async function exportOhResearchPacketV1(input: Readonly<{
  store: OhStoreV1; roots: readonly string[]; head?: OhHeadV1;
}>): Promise<OhResearchExportV1> {
  const head = input.head ?? await input.store.head();
  const closure = await input.store.exportDependencyClosure({ roots: input.roots, head,
    maximumRecords: OH_RESEARCH_PACKET_LIMITS_V1.records });
  const checked = verifyOhDependencyClosureAgainstV1(closure, { binding: input.store.binding, head });
  if (!checked.ok || canonicalJson(checked.closure.roots) !== canonicalJson([...input.roots].sort())) {
    throw new TypeError("Research export did not match the selected store, head and roots.");
  }
  const packet = await packetFromClosure(checked.closure);
  return freezeKnowledgeDeclaration({ profile: "oh.research-export.v1", packet, closure: checked.closure, v: 1 });
}

export async function readOhResearchPacketV1(input: Parameters<typeof exportOhResearchPacketV1>[0]): Promise<OhResearchPacketV1> {
  return (await exportOhResearchPacketV1(input)).packet;
}

/** Checks bytes and closure. Authenticating the claimed exporting host is a caller responsibility. */
export async function verifyOhResearchExportV1(foreign: unknown): Promise<OhResearchExportV1 | null> {
  try {
    const value = knowledgeDeclarativeJson(foreign, 2 * OH_RESEARCH_PACKET_LIMITS_V1.packetBytes,
      { maxDepth: 80, maxNodes: 1_500_000 });
    if (!isPlainRecord(value) || !hasExactDataKeys(value, ["profile", "packet", "closure", "v"])
      || value["v"] !== 1 || value["profile"] !== "oh.research-export.v1") return null;
    const closure = parseOhDependencyClosureV1(value["closure"]);
    const packet = await verifyOhResearchPacketV1(value["packet"]);
    if (closure === null || packet === null || canonicalJson(packet.records) !== canonicalJson(closure.records)) return null;
    return freezeKnowledgeDeclaration({ profile: "oh.research-export.v1", packet, closure, v: 1 });
  } catch { return null; }
}

/** Import a snapshot as a new local CAS operation; never impersonates its source operation log. */
export async function restoreOhResearchPacketV1(input: Omit<OhResearchCommitInputV1, "packet"> & Readonly<{
  exported: unknown;
}>): Promise<OhOperationV1> {
  const exported = await verifyOhResearchExportV1(input.exported);
  if (exported === null) throw new TypeError("Invalid research export.");
  return commitOhResearchPacketV1({ store: input.store, packet: exported.packet, actorId: input.actorId,
    expectedHead: input.expectedHead, operationId: input.operationId, instant: input.instant });
}
