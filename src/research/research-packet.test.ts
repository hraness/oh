import { expect, test } from "bun:test";
import type { OhStoreV1 } from "../store";
import { emptyOhHeadV1 } from "../store";
import { canonicalJson, canonicalSha256 } from "../canonical";
import { createKnowledgeGraphRecordV1, parseKnowledgeGraphRecordV1 } from "../graph";
import { createOhSqliteStoreAuthorityV1 } from "../sqlite/port";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { createKnowledgeStatementV1, createKnowledgeContextV1, createKnowledgeViewSpecV1, parseKnowledgeEntityId, parseKnowledgeInquiryId, type KnowledgeEntityV1 } from "./knowledge-ontology-v1";
import { createKnowledgeInquiryEventV1, parseKnowledgeGraphRecordV1 as parseSource } from "./knowledge-ontology-contract-v1";
import { sha256Text } from "./integrity-domain";
import { compileSpongeKnowledgeProposalV3 } from "./knowledge-proposal-compiler-v3";
import { parseSpongeKnowledgeProposalBundleV2 } from "./knowledge-proposal-v2";
import { prepareOhResearchPacketV1, verifyOhResearchPacketV1, OH_RESEARCH_PACKET_LIMITS_V1,
  type OhResearchPacketV1 } from "./research-packet";
import { commitOhResearchPacketV1, createOhResearchPacketCodecRegistryV1, exportOhResearchPacketV1,
  readOhResearchPacketV1, restoreOhResearchPacketV1, verifyOhResearchExportV1 } from "./research-store";

const instant = "2026-09-13T12:00:00.000Z";
async function fixture() {
  const core = await spongeCoreKnowledgeCatalogV1();
  const concept = core.concepts.find((item) => item.identity.code === "entity")!;
  const object = core.predicates.find((item) => item.identity.code === "object")!;
  const actorId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const actor: KnowledgeEntityV1 = { entityId: actorId, identityOperationId: "identity.local",
    identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
  const draft = { v: 3, entities: [{ kind: "new", key: "note", name: { language: "en", text: "Local note" }, concepts: [concept.ref] }],
    facts: [{ key: "value", subject: { kind: "key", key: "note" }, predicate: object.ref,
      object: { kind: "duration", iso8601: "PT1H", v: 1 }, qualifiers: [], contextKey: null, stance: "reports" }],
    contexts: [], evidence: [{ key: "evidence", factKey: "value", source: { kind: "existing", entityId: actorId },
      bearing: "supports", selector: "local paragraph", attribution: { kind: "agent-supplied", sourceUri: "urn:local:note" } }],
    vocabularyDependencies: [] };
  const compiled = await compileSpongeKnowledgeProposalV3(draft, {
    authorEntityId: actorId, authoringPolicySha256: await sha256Text("explicit local policy"),
    externalOperationReceiptSha256: await sha256Text("explicit local operation"), occurredAt: instant,
    spaceId: "research.local", schemas: core.schemas, existingEntities: new Map([[actorId, { entity: actor, concepts: [concept.ref] }]]),
  });
  if (compiled === null) throw new Error("Invalid synthetic draft fixture");
  const records = [{ kind: "vocabulary", value: core.vocabulary },
    ...core.schemas.map((value) => ({ kind: "schema", value })), { kind: "entity", value: actor }, ...compiled.bundle.records];
  const packet = await prepareOhResearchPacketV1({ records });
  return { packet, records, core, actorId, compiled };
}
function roots(packet: OhResearchPacketV1): string[] { return packet.records.map((record) => record.key); }

// This includes real Bun SQLite transactions, checksums, dependency exports and a
// second independent store, without any hosted identity or credential.
test("compile, commit, read, export and restore preserve both digest layers and source attribution", async () => {
  const { packet, compiled } = await fixture();
  const first = createOhSqliteStoreAuthorityV1({ path: ":memory:", spaceId: "local.first" });
  const second = createOhSqliteStoreAuthorityV1({ path: ":memory:", spaceId: "local.second" });
  try {
    const originalHead = await first.store.head();
    const commit = { store: first.store, packet, actorId: "research.local", expectedHead: originalHead,
      operationId: "research.commit.1", instant };
    const operation = await commitOhResearchPacketV1(commit);
    expect((await commitOhResearchPacketV1(commit)).operationSha256).toBe(operation.operationSha256);
    expect((await first.store.verify()).operations).toBe(1);
    const read = await readOhResearchPacketV1({ store: first.store, roots: roots(packet) });
    expect(read).toEqual(packet);
    const exported = await exportOhResearchPacketV1({ store: first.store, roots: roots(packet) });
    expect(await verifyOhResearchExportV1(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
    const restored = await restoreOhResearchPacketV1({ store: second.store, exported: JSON.parse(JSON.stringify(exported)),
      actorId: "research.restore", operationId: "research.restore.1", expectedHead: await second.store.head(), instant });
    expect(restored.spaceId).toBe("local.second");
    expect(restored.operationSha256).not.toBe(operation.operationSha256);
    expect(await readOhResearchPacketV1({ store: second.store, roots: roots(packet) })).toEqual(packet);
    expect((await second.store.verify()).records).toBe(packet.records.length);
    for (const record of read.records) {
      expect(parseKnowledgeGraphRecordV1(record)).toEqual(record);
      const source = (record.value as { source: { kind: typeof record.kind; value: unknown; recordSha256: string } }).source;
      const parsed = await parseSource(source.kind, source.value);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(String(parsed.value.recordSha256)).toBe(source.recordSha256);
      expect(record.recordSha256).not.toBe(source.recordSha256);
      for (const key of record.dependencies) expect(roots(packet)).toContain(key);
    }
    expect(JSON.stringify(read)).toContain("agent-supplied");
    expect(JSON.stringify(read)).toContain("urn:local:note");
    expect(read.authority).toBe("unasserted");
    expect(compiled.bundle.records.some((r) => r.kind === "review-decision" || r.kind === "rights-decision")).toBe(false);
    await expect(commitOhResearchPacketV1({ ...commit, operationId: "research.stale" })).rejects.toThrow();
  } finally { await first.store.close(); await second.store.close(); }
});

test("packet validation rejects missing, wrong and rewritten dependency bindings even with recomputed envelopes", async () => {
  const { packet, records, core, actorId } = await fixture();
  await expect(prepareOhResearchPacketV1({ records: records.filter((r) => r.kind !== "vocabulary") })).rejects.toThrow("missing dependency");
  const wrongRef = { ...core.predicates[0]!.ref, code: "forged" };
  const wrongStatement = await createKnowledgeStatementV1({ subject: actorId, predicate: wrongRef,
    object: { kind: "string", value: "x", v: 1 }, qualifiers: [], v: 1 });
  if (!wrongStatement.ok) throw new Error("Invalid negative fixture");
  await expect(prepareOhResearchPacketV1({ records: [...records,
    { kind: "statement", callerRecordKey: "wrong.schema", value: wrongStatement.value }] })).rejects.toThrow("exact schema reference");
  const altered = JSON.parse(JSON.stringify(packet));
  const target = altered.records.find((r: { dependencies: string[] }) => r.dependencies.length > 0);
  target.dependencies = [];
  const rewritten = createKnowledgeGraphRecordV1({ key: target.key, kind: target.kind,
    dependencies: [], value: target.value, v: 1 });
  Object.assign(target, rewritten);
  const { packetSha256: _ignored, ...payload } = altered;
  altered.packetSha256 = canonicalSha256(payload);
  expect(await verifyOhResearchPacketV1(altered)).toBeNull();
  expect(await verifyOhResearchPacketV1({ ...packet, authority: "accepted" })).toBeNull();
  const corrupted = JSON.parse(JSON.stringify(packet));
  corrupted.records[0].value.source.recordSha256 = "f".repeat(64);
  expect(await verifyOhResearchPacketV1(corrupted)).toBeNull();
});

test("sealed codecs accept only exact prepared bytes; async, forged, unknown and mutated records cannot enter", async () => {
  const { packet } = await fixture();
  expect(() => createOhResearchPacketCodecRegistryV1(JSON.parse(JSON.stringify(packet)))).toThrow("Prepare or verify");
  const registry = createOhResearchPacketCodecRegistryV1(packet);
  expect(registry.sealed).toBe(true);
  expect(() => registry.register({ kind: "edition", parse: () => null })).toThrow("sealed");
  expect(registry.parseRequired("edition", {})).toBeNull();
  const record = packet.records[0]!;
  expect(registry.parseRequired(record.kind, record.value)).toEqual(record.value);
  expect(registry.parseRequired(record.kind, Promise.resolve(record.value))).toBeNull();
  expect(registry.parseRequired(record.kind, { ...record.value as object, extra: true })).toBeNull();
  expect(Object.isFrozen(record.value)).toBe(true);
  expect(Object.isFrozen(record.dependencies)).toBe(true);
  let invoked = false;
  const getter = Object.defineProperty({}, "profile", { enumerable: true, get() { invoked = true; return "evil"; } });
  expect(registry.parseRequired(record.kind, getter)).toBeNull();
  expect(invoked).toBe(false);
});

test("bounds, duplicates and foreign accessors fail closed before side effects", async () => {
  const { records, compiled } = await fixture();
  await expect(prepareOhResearchPacketV1({ records: [...records, records[0]] })).rejects.toThrow("duplicate source");
  await expect(prepareOhResearchPacketV1({ records: Array(OH_RESEARCH_PACKET_LIMITS_V1.records + 1).fill({}) })).rejects.toThrow("bounds");
  await expect(prepareOhResearchPacketV1({ records: [], unexpected: true })).rejects.toThrow("bounds");
  let invoked = false;
  const array: unknown[] = [];
  Object.defineProperty(array, "0", { enumerable: true, get() { invoked = true; return records[0]; } });
  await expect(prepareOhResearchPacketV1({ records: array })).rejects.toThrow();
  expect(await parseSpongeKnowledgeProposalBundleV2({ records: array, v: 2 })).toBeNull();
  expect(invoked).toBe(false);
  const bundle = await parseSpongeKnowledgeProposalBundleV2(compiled.bundle);
  expect(bundle).toEqual(compiled.bundle);
});

test("local writes reject a conflicting immutable key and corrupted export without altering the store", async () => {
  const { packet } = await fixture();
  const { store } = createOhSqliteStoreAuthorityV1({ path: ":memory:", spaceId: "local.reject" });
  try {
    const record = packet.records[0]!;
    await store.commit({ actorId: "host.local", expectedHead: await store.head(), operationId: "host.conflicting", instant,
      changes: [{ kind: "put", v: 1, record: createKnowledgeGraphRecordV1({ key: record.key, kind: record.kind,
        dependencies: [], value: { untrusted: true }, v: 1 }) }] });
    const head = await store.head();
    await expect(commitOhResearchPacketV1({ store, packet, actorId: "research.local", expectedHead: head,
      operationId: "research.conflict", instant })).rejects.toThrow("immutable");
    await expect(restoreOhResearchPacketV1({ store, exported: { profile: "oh.research-export.v1" }, actorId: "research.local",
      expectedHead: head, operationId: "research.bad-export", instant })).rejects.toThrow("Invalid research export");
    expect(await store.head()).toEqual(head);
    expect((await store.verify()).operations).toBe(1);
  } finally { await store.close(); }
});


test("snapshot keys retain aliases and reorder stability without claiming cross-packet deduplication", async () => {
  const { packet, records, actorId } = await fixture();
  expect(await prepareOhResearchPacketV1({ records: [...records].reverse() })).toEqual(packet);
  const independent: KnowledgeEntityV1 = { entityId: parseKnowledgeEntityId(`kent_${"b".repeat(24)}`)!,
    identityOperationId: "identity.independent", identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
  const expanded = await prepareOhResearchPacketV1({ records: [...records, { kind: "entity", value: independent }] });
  expect(expanded.sourceBindingSha256).not.toBe(packet.sourceBindingSha256);
  for (const record of packet.records) {
    expect(expanded.records.some((item) => item.key === record.key)).toBe(false);
    expect(expanded.records.some((item) => canonicalJson(item.value) === canonicalJson(record.value))).toBe(true);
  }
  const statement = records.find((record) => record.kind === "statement")!;
  const source = await parseSource("statement", statement.value);
  if (!source.ok) throw new Error("Invalid fixture statement");
  const selected = records.filter((record) => record.kind === "schema" || record.kind === "vocabulary");
  const a = await prepareOhResearchPacketV1({ records: [...selected, { kind: "statement", callerRecordKey: "alias.first", value: statement.value }] });
  const b = await prepareOhResearchPacketV1({ records: [...selected, { kind: "statement", callerRecordKey: "alias.second", value: statement.value }] });
  const first = a.records.find((record) => record.kind === "statement")!;
  const second = b.records.find((record) => record.kind === "statement")!;
  expect(first.key).not.toBe(second.key);
  expect((first.value as { source: { recordSha256: string } }).source.recordSha256).toBe(source.value.recordSha256);
  expect((second.value as { source: { recordSha256: string } }).source.recordSha256).toBe(source.value.recordSha256);
  const { store } = createOhSqliteStoreAuthorityV1({ path: ":memory:", spaceId: "local.aliases" });
  try {
    await commitOhResearchPacketV1({ store, packet: a, actorId: "local.writer", operationId: "alias.1", instant, expectedHead: await store.head() });
    await commitOhResearchPacketV1({ store, packet: b, actorId: "local.writer", operationId: "alias.2", instant, expectedHead: await store.head() });
    expect((await store.verify()).operations).toBe(2);
    expect((await readOhResearchPacketV1({ store, roots: roots(a) })).records).toContainEqual(first);
    expect((await readOhResearchPacketV1({ store, roots: roots(b) })).records).toContainEqual(second);
    await expect(readOhResearchPacketV1({ store, roots: [first.key] })).rejects.toThrow("mapping differs");
    await expect(readOhResearchPacketV1({ store, roots: [...roots(a), ...roots(b)] })).rejects.toThrow("duplicate source digest");
  } finally { await store.close(); }
  const event = await createKnowledgeInquiryEventV1({ actorEntityId: actorId,
    inquiryId: parseKnowledgeInquiryId(`kinq_${"c".repeat(24)}`)!, kind: "evidence-added", note: "Typed reference test",
    inputRefs: [{ kind: "schema", sha256: source.value.recordSha256, v: 1 }], outputRefs: [],
    occurredAt: instant, parentEventSha256: null, sequence: 1, v: 1 });
  if (!event.ok) throw new Error("Invalid negative event fixture");
  await expect(prepareOhResearchPacketV1({ records: [...records, { kind: "inquiry-event", value: event.value }] })).rejects.toThrow("dependency kind");
});


test("dependent source bytes under alternate dependency aliases receive distinct snapshot bindings", async () => {
  const { packet, records } = await fixture();
  const changed = records.map((record) => record.kind === "context" ? { ...record, callerRecordKey: "context.alternate" } : record);
  const alternate = await prepareOhResearchPacketV1({ records: changed });
  const a = packet.records.find((record) => record.kind === "activity")!;
  const b = alternate.records.find((record) => record.kind === "activity")!;
  expect(a.value).toEqual(b.value);
  expect(a.key).not.toBe(b.key);
  expect(a.dependencies).not.toEqual(b.dependencies);
  const { store } = createOhSqliteStoreAuthorityV1({ path: ":memory:", spaceId: "local.dependent-aliases" });
  try {
    await commitOhResearchPacketV1({ store, packet, actorId: "local.writer", operationId: "dependency.1", instant, expectedHead: await store.head() });
    await commitOhResearchPacketV1({ store, packet: alternate, actorId: "local.writer", operationId: "dependency.2", instant, expectedHead: await store.head() });
    expect((await store.verify()).operations).toBe(2);
    expect(await readOhResearchPacketV1({ store, roots: roots(packet) })).toEqual(packet);
    expect(await readOhResearchPacketV1({ store, roots: roots(alternate) })).toEqual(alternate);
  } finally { await store.close(); }
});

test("views bind included and excluded context digests to exact context records", async () => {
  const { actorId } = await fixture();
  const included = await createKnowledgeContextV1({ scenario: "actual", dimensions: [], v: 1 });
  const excluded = await createKnowledgeContextV1({ scenario: "hypothetical", dimensions: [], v: 1 });
  if (!included.ok || !excluded.ok) throw new Error("Invalid context fixture");
  const policy = await sha256Text("local view policy");
  const view = await createKnowledgeViewSpecV1({ audience: "local", budgets: { bytes: 65_536, depth: 4, sources: 16 },
    excludedContextSha256s: [excluded.value.contextSha256], includedContextSha256s: [included.value.contextSha256],
    language: "en", policySha256s: { dispute: policy, evidence: policy, rights: policy, traversal: policy },
    root: { entityId: actorId, kind: "entity" }, shapes: [], v: 1, viewForm: "local", vocabularies: [] });
  if (!view.ok) throw new Error("Invalid view fixture");
  const viewRecord = { kind: "view", callerRecordKey: "local.view", value: view.value };
  await expect(prepareOhResearchPacketV1({ records: [viewRecord] })).rejects.toThrow("missing dependency");
  await expect(prepareOhResearchPacketV1({ records: [viewRecord,
    { kind: "context", callerRecordKey: "context.included", value: included.value }] })).rejects.toThrow("missing dependency");
  const packet = await prepareOhResearchPacketV1({ records: [viewRecord,
    { kind: "context", callerRecordKey: "context.included", value: included.value },
    { kind: "context", callerRecordKey: "context.excluded", value: excluded.value }] });
  expect(packet.records.find((record) => record.kind === "view")!.dependencies.length).toBe(2);
});


test("a commit cannot grow beyond the complete snapshot bound and leave its own replay unavailable", async () => {
  const { packet } = await fixture();
  const { store } = createOhSqliteStoreAuthorityV1({ path: ":memory:", spaceId: "local.capacity" });
  let committed = false;
  const boundedStore: OhStoreV1 = { binding: store.binding,
    head: () => store.head(), close: () => store.close(), changesSince: (from, options) => store.changesSince(from, options),
    verify: () => store.verify(), exportDependencyClosure: (input) => store.exportDependencyClosure(input),
    snapshot: async () => ({ head: emptyOhHeadV1(), v: 1,
      records: Array.from({ length: 8_192 }, (_, index) => createKnowledgeGraphRecordV1({
        dependencies: [], key: `occupied.${index}`, kind: "entity", value: { fixture: index }, v: 1 })) }),
    commit: async (input) => { committed = true; return store.commit(input); } };
  try {
    await expect(commitOhResearchPacketV1({ store: boundedStore, packet, actorId: "local.writer", instant,
      expectedHead: emptyOhHeadV1(), operationId: "capacity.reject" })).rejects.toThrow("bounded current snapshot");
    expect(committed).toBe(false);
    expect((await store.head()).generation).toBe(0);
  } finally { await store.close(); }
});
