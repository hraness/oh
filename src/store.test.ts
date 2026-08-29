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
  OH_WORKING_STORE_PROFILE_V1,
  OhProfileError,
  OhSemanticBundleIngressV1,
  parseOhDependencyClosureV1,
  parseOhStoreBindingV1,
  replayOhOperationsV1,
  transitionOhSnapshotV1,
  verifyOhDependencyClosureV1,
} from "./store";

describe("runtime-neutral Oh store contracts", () => {
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
});
