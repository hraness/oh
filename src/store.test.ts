import { describe, expect, test } from "bun:test";

import { canonicalJson, canonicalSha256 } from "./canonical";
import { OhRecordCodecRegistry } from "./contract";
import { createKnowledgeGraphRecordV1 } from "./graph";
import { createOhSqliteStoreAuthorityV1 } from "./sqlite/port";
import {
  createOhDependencyClosureV1,
  createOhStoreBindingV1,
  createOhStoreProfileV1,
  emptyOhHeadV1,
  OH_RECORD_REVISIONS_LIMITS_V1,
  OH_WORKING_STORE_PROFILE_V1,
  OhOperationSizeError,
  OhProfileError,
  ohRecordRevisionChangesFromOperationsV1,
  OhSemanticBundleIngressV1,
  parseOhDependencyClosureV1,
  parseOhRecordRevisionChangeV1,
  parseOhStoreBindingV1,
  reduceOhRecordRevisionsV1,
  replayOhOperationsV1,
  transitionOhSnapshotV1,
  verifyOhDependencyClosureV1,
  verifyOhDependencyClosureAgainstV1,
} from "./store";

describe("runtime-neutral Oh store contracts", () => {
  test("applies an injected operation byte bound during canonical construction", () => {
    const snapshot = { head: emptyOhHeadV1(), records: [], v: 1 as const };
    expect(() => transitionOhSnapshotV1({ actorId: "agent.test",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
        key: "entity:bounded", kind: "entity", v: 1, value: { name: "Bounded" } }), v: 1 }],
      instant: "2026-09-06T12:00:00.000Z", maximumOperationBytes: 1,
      operationId: "op_bounded", snapshot, spaceId: "bounded" }))
      .toThrow(OhOperationSizeError);
    expect(snapshot).toEqual({ head: emptyOhHeadV1(), records: [], v: 1 });
  });

  test("binds a host-selected realm and application profile without changing V1 operations", () => {
    const applicationProfileSha256 = canonicalSha256({ application: "fixture", v: 1 });
    const profile = createOhStoreProfileV1({
      applicationProfileSha256,
      capabilities: OH_WORKING_STORE_PROFILE_V1.capabilities,
      profileId: "fixture.working.v1",
      profileKind: "working",
      v: 1,
    });
    const binding = createOhStoreBindingV1({ profile, realmId: "tenant:one/thread:two",
      spaceId: "thread:two", v: 1 });
    expect(parseOhStoreBindingV1(binding)).toEqual(binding);
    expect(binding.profile.applicationProfileSha256).toBe(applicationProfileSha256);
    expect(binding.bindingSha256).toBe(canonicalSha256({ contractSha256: binding.contractSha256,
      profile, realmId: binding.realmId, spaceId: binding.spaceId, v: 1 }));
    expect(() => createOhStoreProfileV1({ applicationProfileSha256: null,
      capabilities: { ...OH_WORKING_STORE_PROFILE_V1.capabilities, operationReplication: true },
      profileId: "unsafe.working.v1", profileKind: "working", v: 1 })).toThrow(OhProfileError);
  });

  test("exports only an exact dependency closure and detects tampering or smuggled records", () => {
    const parent = createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:parent",
      kind: "entity", v: 1, value: { name: "Parent" } });
    const child = createKnowledgeGraphRecordV1({ dependencies: [parent.key], key: "entity:child",
      kind: "entity", v: 1, value: { name: "Child" } });
    const unrelated = createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:unrelated",
      kind: "entity", v: 1, value: { name: "Unrelated" } });
    const binding = createOhStoreBindingV1({ profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "realm:test", spaceId: "space:test", v: 1 });
    const first = replayOhOperationsV1(binding.spaceId, []);
    const snapshot = transitionOhSnapshotV1({ actorId: "agent.test", changes: [
      { kind: "put", record: child, v: 1 }, { kind: "put", record: parent, v: 1 },
      { kind: "put", record: unrelated, v: 1 },
    ], instant: "2026-08-29T12:00:00.000Z", operationId: "op_closure",
    snapshot: first, spaceId: binding.spaceId }).snapshot;
    const closure = createOhDependencyClosureV1({ binding, roots: [child.key],
      snapshot });
    expect(closure.records.map(({ key }) => key)).toEqual([child.key, parent.key].sort());
    expect(parseOhDependencyClosureV1(closure)).toEqual(closure);
    expect(verifyOhDependencyClosureV1(closure)).toEqual({ closure, ok: true });
    expect(verifyOhDependencyClosureAgainstV1(closure, { binding, head: snapshot.head }))
      .toEqual({ closure, ok: true, verification: "expected-authority-and-head" });
    expect(verifyOhDependencyClosureAgainstV1(closure, { binding,
      head: { ...snapshot.head, recordsSha256: "a".repeat(64) as typeof snapshot.head.recordsSha256 } }))
      .toEqual({ ok: false, reason: "head-mismatch" });
    expect(parseOhDependencyClosureV1({ ...closure, records: [...closure.records, unrelated] })).toBeNull();
    expect(parseOhDependencyClosureV1({ ...closure,
      closureSha256: "a".repeat(64) })).toBeNull();
    expect(first.records).toEqual([]);
  });

  test("requires a sealed explicit codec for every semantic put and commits one atomic bundle", async () => {
    const authority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:semantic", spaceId: "semantic" });
    const codecs = new OhRecordCodecRegistry().register({ kind: "entity", parse: (value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)
        || Object.keys(value).length !== 1 || typeof (value as { name?: unknown }).name !== "string") return null;
      return { name: (value as { name: string }).name.normalize("NFC") };
    } });
    const ingress = new OhSemanticBundleIngressV1(authority.store, codecs);
    expect(codecs.sealed).toBe(true);
    expect(() => codecs.register({ kind: "statement", parse: () => ({}) })).toThrow("sealed");
    const head = await authority.store.head();
    const operation = await ingress.commit({ actorId: "agent.test", expectedHead: {
      generation: head.generation, operationSha256: head.operationSha256 }, instant: "2026-08-29T12:00:00.000Z",
      operationId: "op_semantic", puts: [{ dependencies: [], key: "entity:ada", kind: "entity",
        v: 1, value: { name: "Ada" } }], tombstones: [], v: 1 });
    expect(operation.changes).toHaveLength(1);
    await expect(ingress.commit({ actorId: "agent.test", expectedHead: {
      generation: 1, operationSha256: operation.operationSha256 }, instant: null,
      operationId: "op_unregistered", puts: [{ dependencies: [], key: "statement:no-codec",
        kind: "statement", v: 1, value: {} }], tombstones: [], v: 1 }))
      .rejects.toThrow("codec rejected");
    expect((await authority.store.head()).sequence).toBe(1);
    await expect(ingress.commit({ actorId: "agent.test", expectedHead: {
      generation: 1, operationSha256: operation.operationSha256 }, instant: null,
      operationId: "op_missing_dependency", puts: [{ dependencies: ["entity:missing"],
        key: "entity:child", kind: "entity", v: 1, value: { name: "Child" } }],
      tombstones: [], v: 1 })).rejects.toThrow("Missing dependency");
    expect((await authority.store.head()).sequence).toBe(1);
    expect(canonicalJson((await authority.store.snapshot()).records[0]?.value)).toBe('{"name":"Ada"}');
    await authority.store.close();
  });

  test("rejects duplicate operation IDs during generic replay", () => {
    const first = transitionOhSnapshotV1({ actorId: "agent.test",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
        key: "entity:first", kind: "entity", v: 1, value: { name: "First" } }), v: 1 }],
      instant: "2026-08-29T12:00:00.000Z", operationId: "op_duplicate",
      snapshot: { head: emptyOhHeadV1(), records: [], v: 1 }, spaceId: "duplicate" });
    const second = transitionOhSnapshotV1({ actorId: "agent.test",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
        key: "entity:second", kind: "entity", v: 1, value: { name: "Second" } }), v: 1 }],
      instant: "2026-08-29T12:01:00.000Z", operationId: "op_duplicate",
      snapshot: first.snapshot, spaceId: "duplicate" });
    expect(() => replayOhOperationsV1("duplicate", [first.operation, second.operation])).toThrow("replay chain");
  });
});

describe("record revision facts derived from the operation log", () => {
  const put = (sequence: number, recordSha256: string) =>
    ({ kind: "put" as const, recordSha256, sequence, v: 1 as const });
  const digest = (byte: string) => byte.repeat(64);

  test("reports zero revisions for a key written once", () => {
    expect(reduceOhRecordRevisionsV1({ changes: [put(4, digest("a"))],
      key: "entity:once", through: 9 })).toEqual({
      changes: 1, distinctPutDigests: 1, key: "entity:once", latestKind: "put",
      latestSequence: 4, oldestObservedSequence: 4, puts: 1, revisions: 0,
      through: 9, tombstones: 0, truncated: false, v: 1,
    });
  });

  test("reports an absent key as no history rather than an error", () => {
    expect(reduceOhRecordRevisionsV1({ changes: [], key: "entity:absent", through: 3 })).toEqual({
      changes: 0, distinctPutDigests: 0, key: "entity:absent", latestKind: null,
      latestSequence: null, oldestObservedSequence: null, puts: 0, revisions: 0,
      through: 3, tombstones: 0, truncated: false, v: 1,
    });
  });

  test("counts rewrites and separates them from content changes", () => {
    // The third put stores the digest the first one already stored, so the key
    // was written three times and held two distinct contents.
    const revisions = reduceOhRecordRevisionsV1({ key: "entity:churned", through: 7,
      changes: [put(5, digest("b")), put(1, digest("a")), put(3, digest("a"))] });
    expect(revisions).toMatchObject({ changes: 3, distinctPutDigests: 2, latestKind: "put",
      latestSequence: 5, oldestObservedSequence: 1, puts: 3, revisions: 2, tombstones: 0 });
  });

  test("sorts an unordered read and rejects two changes to one key in one operation", () => {
    expect(reduceOhRecordRevisionsV1({ key: "entity:ordered", through: 4,
      changes: [put(4, digest("c")), put(2, digest("b"))] }))
      .toMatchObject({ latestSequence: 4, oldestObservedSequence: 2 });
    expect(() => reduceOhRecordRevisionsV1({ key: "entity:ordered", through: 4,
      changes: [put(2, digest("b")), put(2, digest("c"))] })).toThrow("two changes in one operation");
  });

  test("keeps a tombstoned key inspectable and names its removal", () => {
    expect(reduceOhRecordRevisionsV1({ key: "entity:removed", through: 6,
      changes: [put(1, digest("a")), put(2, digest("b")),
        { kind: "tombstone", recordSha256: digest("b"), sequence: 3, v: 1 }] }))
      .toMatchObject({ changes: 3, distinctPutDigests: 2, latestKind: "tombstone",
        latestSequence: 3, puts: 2, revisions: 1, tombstones: 1 });
  });

  test("refuses a change ahead of its through sequence and an unparsable change", () => {
    expect(() => reduceOhRecordRevisionsV1({ changes: [put(8, digest("a"))],
      key: "entity:ahead", through: 7 })).toThrow("ahead of its through sequence");
    expect(() => reduceOhRecordRevisionsV1({ changes: [{ kind: "put", recordSha256: "short", sequence: 1, v: 1 }],
      key: "entity:invalid", through: 1 })).toThrow("Invalid record revision change");
    expect(() => reduceOhRecordRevisionsV1({ changes: [{ kind: "revise", recordSha256: digest("a"), sequence: 1, v: 1 }],
      key: "entity:invalid", through: 1 })).toThrow("Invalid record revision change");
    expect(parseOhRecordRevisionChangeV1({ kind: "put", recordSha256: digest("a"), sequence: 0, v: 1 })).toBeNull();
    expect(parseOhRecordRevisionChangeV1({ kind: "put", recordSha256: digest("a"), sequence: 1, v: 1, extra: 1 })).toBeNull();
  });

  test("bounds the change set it will reduce", () => {
    const changes = Array.from({ length: OH_RECORD_REVISIONS_LIMITS_V1.changesPerKey + 1 },
      (_, index) => put(index + 1, digest("a")));
    expect(() => reduceOhRecordRevisionsV1({ changes, key: "entity:unbounded",
      through: changes.length })).toThrow(RangeError);
  });

  test("derives the same facts from a change feed as from a local log read", () => {
    const first = transitionOhSnapshotV1({ actorId: "agent.test",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
        key: "entity:feed", kind: "entity", v: 1, value: { name: "One" } }), v: 1 }],
      instant: "2026-09-07T12:00:00.000Z", operationId: "op_feed_one",
      snapshot: { head: emptyOhHeadV1(), records: [], v: 1 }, spaceId: "feed" });
    const second = transitionOhSnapshotV1({ actorId: "agent.test",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
        key: "entity:feed", kind: "entity", v: 1, value: { name: "Two" } }), v: 1 }],
      instant: "2026-09-07T12:01:00.000Z", operationId: "op_feed_two",
      snapshot: first.snapshot, spaceId: "feed" });
    const operations = [first.operation, second.operation];
    const putDigest = (operation: (typeof operations)[number]) => {
      const change = operation.changes[0];
      if (change?.kind !== "put") throw new Error("expected a put");
      return change.record.recordSha256;
    };
    const changes = ohRecordRevisionChangesFromOperationsV1("entity:feed", operations);
    expect(changes).toEqual([
      { kind: "put", recordSha256: putDigest(first.operation), sequence: 1, v: 1 },
      { kind: "put", recordSha256: putDigest(second.operation), sequence: 2, v: 1 },
    ]);
    expect(reduceOhRecordRevisionsV1({ changes, key: "entity:feed", through: 2 }))
      .toMatchObject({ distinctPutDigests: 2, puts: 2, revisions: 1, truncated: false });
    expect(ohRecordRevisionChangesFromOperationsV1("entity:absent", operations)).toEqual([]);
    expect(() => ohRecordRevisionChangesFromOperationsV1("entity:feed", [{ not: "an operation" }] as never))
      .toThrow("revision source operation is invalid");
  });
});
