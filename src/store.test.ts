import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";

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
    expect(reduceOhRecordRevisionsV1({ changes: [put(4, digest("a"))], fromSequence: 1,
      key: "entity:once", through: 9, truncated: false })).toEqual({
      changes: 1, distinctPutDigests: 1, idempotentPuts: 0, key: "entity:once", latestKind: "put",
      latestSequence: 4, oldestObservedSequence: 4, puts: 1, revisions: 0,
      through: 9, tombstones: 0, truncated: false, v: 1,
    });
  });

  test("reports an absent key as no history rather than an error", () => {
    expect(reduceOhRecordRevisionsV1({ changes: [], fromSequence: 1, key: "entity:absent",
      through: 3, truncated: false })).toEqual({
      changes: 0, distinctPutDigests: 0, idempotentPuts: 0, key: "entity:absent", latestKind: null,
      latestSequence: null, oldestObservedSequence: null, puts: 0, revisions: 0,
      through: 3, tombstones: 0, truncated: false, v: 1,
    });
  });

  test("counts an idempotent rewrite separately from a content change", () => {
    // Sorted, this key is a, a, b: the put at 3 stored bytes the key already
    // held, so exactly one write advanced the log without changing the record.
    const revisions = reduceOhRecordRevisionsV1({ key: "entity:churned", through: 7,
      fromSequence: 1, truncated: false,
      changes: [put(5, digest("b")), put(1, digest("a")), put(3, digest("a"))] });
    expect(revisions).toMatchObject({ changes: 3, distinctPutDigests: 2, idempotentPuts: 1,
      latestKind: "put", latestSequence: 5, oldestObservedSequence: 1, puts: 3, revisions: 2,
      tombstones: 0 });
  });

  test("does not infer a rewrite from a digest that merely repeats", () => {
    // a, b, a holds two distinct digests across three puts with no tombstone,
    // yet every put changed the record. Comparing puts to distinct digests
    // would call this a rewrite, so `idempotentPuts` is the only field that may
    // carry that meaning, and here it is zero.
    expect(reduceOhRecordRevisionsV1({ key: "entity:returned", through: 3, fromSequence: 1,
      truncated: false, changes: [put(1, digest("a")), put(2, digest("b")), put(3, digest("a"))] }))
      .toMatchObject({ distinctPutDigests: 2, idempotentPuts: 0, puts: 3, tombstones: 0 });
    // The genuinely idempotent history a, a, b is a different answer.
    expect(reduceOhRecordRevisionsV1({ key: "entity:rewritten", through: 3, fromSequence: 1,
      truncated: false, changes: [put(1, digest("a")), put(2, digest("a")), put(3, digest("b"))] }))
      .toMatchObject({ distinctPutDigests: 2, idempotentPuts: 1, puts: 3, tombstones: 0 });
    // A tombstone clears the record, so restoring identical bytes changes it.
    expect(reduceOhRecordRevisionsV1({ key: "entity:restored", through: 3, fromSequence: 1,
      truncated: false, changes: [put(1, digest("a")),
        { kind: "tombstone", recordSha256: digest("a"), sequence: 2, v: 1 }, put(3, digest("a"))] }))
      .toMatchObject({ distinctPutDigests: 1, idempotentPuts: 0, puts: 2, tombstones: 1 });
  });

  test("sorts an unordered read and rejects two changes to one key in one operation", () => {
    expect(reduceOhRecordRevisionsV1({ key: "entity:ordered", through: 4, fromSequence: 1,
      truncated: false, changes: [put(4, digest("c")), put(2, digest("b"))] }))
      .toMatchObject({ latestSequence: 4, oldestObservedSequence: 2 });
    expect(() => reduceOhRecordRevisionsV1({ key: "entity:ordered", through: 4, fromSequence: 1,
      truncated: false, changes: [put(2, digest("b")), put(2, digest("c"))] }))
      .toThrow("two changes at one sequence");
  });

  test("keeps a tombstoned key inspectable and names its removal", () => {
    expect(reduceOhRecordRevisionsV1({ key: "entity:removed", through: 6, fromSequence: 1,
      truncated: false, changes: [put(1, digest("a")), put(2, digest("b")),
        { kind: "tombstone", recordSha256: digest("b"), sequence: 3, v: 1 }] }))
      .toMatchObject({ changes: 3, distinctPutDigests: 2, latestKind: "tombstone",
        latestSequence: 3, puts: 2, revisions: 1, tombstones: 1 });
  });

  test("refuses a change ahead of its through sequence and an unparsable change", () => {
    expect(() => reduceOhRecordRevisionsV1({ changes: [put(8, digest("a"))], fromSequence: 1,
      key: "entity:ahead", through: 7, truncated: false })).toThrow("ahead of its through sequence");
    expect(() => reduceOhRecordRevisionsV1({ changes: [{ kind: "put", recordSha256: "short", sequence: 1, v: 1 }],
      fromSequence: 1, key: "entity:invalid", through: 1, truncated: false }))
      .toThrow("Invalid record revision change");
    expect(() => reduceOhRecordRevisionsV1({ changes: [{ kind: "revise", recordSha256: digest("a"), sequence: 1, v: 1 }],
      fromSequence: 1, key: "entity:invalid", through: 1, truncated: false }))
      .toThrow("Invalid record revision change");
    expect(parseOhRecordRevisionChangeV1({ kind: "put", recordSha256: digest("a"), sequence: 0, v: 1 })).toBeNull();
    expect(parseOhRecordRevisionChangeV1({ kind: "put", recordSha256: digest("a"), sequence: 1, v: 1, extra: 1 })).toBeNull();
  });

  test("bounds the change set it will reduce", () => {
    const changes = Array.from({ length: OH_RECORD_REVISIONS_LIMITS_V1.changesPerKey + 1 },
      (_, index) => put(index + 1, digest("a")));
    expect(() => reduceOhRecordRevisionsV1({ changes, fromSequence: 1, key: "entity:unbounded",
      through: changes.length, truncated: false })).toThrow(RangeError);
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
    const read = ohRecordRevisionChangesFromOperationsV1({ key: "entity:feed", operations, spaceId: "feed" });
    expect(read.fromSequence).toBe(1);
    expect(read.changes).toEqual([
      { kind: "put", recordSha256: putDigest(first.operation), sequence: 1, v: 1 },
      { kind: "put", recordSha256: putDigest(second.operation), sequence: 2, v: 1 },
    ]);
    expect(reduceOhRecordRevisionsV1({ changes: read.changes, fromSequence: read.fromSequence,
      key: "entity:feed", through: 2, truncated: false }))
      .toMatchObject({ distinctPutDigests: 2, puts: 2, revisions: 1, truncated: false });
    expect(ohRecordRevisionChangesFromOperationsV1({ key: "entity:absent", operations, spaceId: "feed" }))
      .toEqual({ changes: [], fromSequence: 1 });
    expect(() => ohRecordRevisionChangesFromOperationsV1({ key: "entity:feed", spaceId: "feed",
      operations: [{ not: "an operation" }] as never })).toThrow("revision source operation is invalid");
  });

  test("refuses operations from a space other than the one the caller named", () => {
    // A sequence numbers an operation within one space. Inferring the space from
    // the feed would accept a wholly wrong space and return plausible, wrong
    // counts, so the caller names it and every operation is checked against it.
    const operationFor = (spaceId: string, name: string) => transitionOhSnapshotV1({
      actorId: "agent.test", changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({
        dependencies: [], key: "entity:shared", kind: "entity", v: 1, value: { name } }), v: 1 }],
      instant: "2026-09-07T12:00:00.000Z", operationId: "op_shared",
      snapshot: { head: emptyOhHeadV1(), records: [], v: 1 }, spaceId }).operation;
    expect(() => ohRecordRevisionChangesFromOperationsV1({ key: "entity:shared", spaceId: "left",
      operations: [operationFor("left", "Left"), operationFor("right", "Right")] }))
      .toThrow("belongs to right, not left");
    // The whole feed from the wrong space is the case inference cannot detect.
    expect(() => ohRecordRevisionChangesFromOperationsV1({ key: "entity:shared", spaceId: "left",
      operations: [operationFor("right", "Right")] })).toThrow("belongs to right, not left");
    expect(() => ohRecordRevisionChangesFromOperationsV1({ key: "entity:shared",
      operations: [], spaceId: "Bad Space" })).toThrow("Invalid space ID");
  });

  test("refuses a feed with a missing page rather than lowering the counts silently", () => {
    const first = transitionOhSnapshotV1({ actorId: "agent.test",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
        key: "entity:gap", kind: "entity", v: 1, value: { name: "One" } }), v: 1 }],
      instant: "2026-09-07T12:00:00.000Z", operationId: "op_gap_one",
      snapshot: { head: emptyOhHeadV1(), records: [], v: 1 }, spaceId: "gap" });
    const second = transitionOhSnapshotV1({ actorId: "agent.test",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
        key: "entity:gap", kind: "entity", v: 1, value: { name: "Two" } }), v: 1 }],
      instant: "2026-09-07T12:01:00.000Z", operationId: "op_gap_two", snapshot: first.snapshot, spaceId: "gap" });
    const third = transitionOhSnapshotV1({ actorId: "agent.test",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
        key: "entity:gap", kind: "entity", v: 1, value: { name: "Three" } }), v: 1 }],
      instant: "2026-09-07T12:02:00.000Z", operationId: "op_gap_three", snapshot: second.snapshot, spaceId: "gap" });
    // Dropping the middle operation would otherwise report two puts, one
    // revision, and truncated: false — a wrong answer that looks complete.
    expect(() => ohRecordRevisionChangesFromOperationsV1({ key: "entity:gap", spaceId: "gap",
      operations: [first.operation, third.operation] })).toThrow("one contiguous run");
    expect(() => ohRecordRevisionChangesFromOperationsV1({ key: "entity:gap", spaceId: "gap",
      operations: [second.operation, first.operation] })).toThrow("one contiguous run");
    const whole = ohRecordRevisionChangesFromOperationsV1({ key: "entity:gap", spaceId: "gap",
      operations: [first.operation, second.operation, third.operation] });
    expect(whole.changes).toHaveLength(3);
    expect(whole.fromSequence).toBe(1);
    expect(reduceOhRecordRevisionsV1({ changes: whole.changes, fromSequence: whole.fromSequence,
      key: "entity:gap", through: 3, truncated: false }))
      .toMatchObject({ puts: 3, revisions: 2, truncated: false });
    // A later page is internally contiguous, so the adapter accepts it, but it
    // did not observe the log from its first operation. A consumer following a
    // live feed from its cursor is always in this position, and the counts it
    // gets are lower bounds that would otherwise be indistinguishable from an
    // exact answer for a key first written at sequence 2.
    const later = ohRecordRevisionChangesFromOperationsV1({ key: "entity:gap", spaceId: "gap",
      operations: [second.operation, third.operation] });
    expect(later.changes).toHaveLength(2);
    expect(later.fromSequence).toBe(2);
    expect(reduceOhRecordRevisionsV1({ changes: later.changes, fromSequence: later.fromSequence,
      key: "entity:gap", through: 3, truncated: false }))
      .toMatchObject({ puts: 2, revisions: 1, truncated: true });
    // Stitching the pages back together recovers the exact answer.
    expect(reduceOhRecordRevisionsV1({ changes: [...whole.changes], fromSequence: 1,
      key: "entity:gap", through: 3, truncated: false })).toMatchObject({ puts: 3, truncated: false });
  });

  test("bounds the operations it will read at the operation page bound", () => {
    expect(OH_RECORD_REVISIONS_LIMITS_V1.operationsPerRead).toBe(1_000);
    const operations = Array.from({ length: OH_RECORD_REVISIONS_LIMITS_V1.operationsPerRead + 1 },
      () => ({ not: "an operation" }));
    // The bound is checked before any operation digest is recomputed.
    expect(() => ohRecordRevisionChangesFromOperationsV1({ key: "entity:feed",
      operations: operations as never, spaceId: "feed" })).toThrow(RangeError);
  });

  test("parses and orders any generated change set (property)", () => {
    fc.assert(fc.property(fc.uniqueArray(fc.record({
      kind: fc.constantFrom("put" as const, "tombstone" as const),
      recordSha256: fc.string({ maxLength: 64, minLength: 64, unit: fc.constantFrom(
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f") }),
      sequence: fc.integer({ max: 4_096, min: 1 }),
      v: fc.constant(1 as const),
    }), { maxLength: 24, selector: (change) => change.sequence }), (changes) => {
      const parsed = changes.map(parseOhRecordRevisionChangeV1);
      expect(parsed.every((change) => change !== null)).toBe(true);
      const through = changes.reduce((highest, change) => Math.max(highest, change.sequence), 0);
      const revisions = reduceOhRecordRevisionsV1({ changes, fromSequence: 1,
        key: "entity:property", through, truncated: false });
      const sequences = changes.map((change) => change.sequence);
      // Ordering law: the reported endpoints do not depend on the read order.
      expect(revisions.latestSequence).toBe(changes.length === 0 ? null : Math.max(...sequences));
      expect(revisions.oldestObservedSequence).toBe(changes.length === 0 ? null : Math.min(...sequences));
      expect(reduceOhRecordRevisionsV1({ changes: [...changes].reverse(), fromSequence: 1,
        key: "entity:property", through, truncated: false })).toEqual(revisions);
      // Independent oracle: replay the changes as a state machine instead of
      // recounting them, so a wrong definition fails and not only a typo.
      let held: string | null = null;
      let writes = 0;
      let removals = 0;
      const everHeld = new Set<string>();
      for (const change of [...changes].sort((left, right) => left.sequence - right.sequence)) {
        if (change.kind === "put") { held = change.recordSha256; everHeld.add(held); writes += 1; }
        else { held = null; removals += 1; }
      }
      expect(revisions.puts).toBe(writes);
      expect(revisions.tombstones).toBe(removals);
      expect(revisions.distinctPutDigests).toBe(everHeld.size);
      expect(revisions.revisions).toBe(Math.max(0, writes - 1));
      // The replayed end state must agree with what the read says is latest.
      expect(revisions.latestKind === "put").toBe(held !== null);
      expect(revisions.latestKind === null).toBe(changes.length === 0);
    }));
  });
});
