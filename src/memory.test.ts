import { describe, expect, test } from "bun:test";

import { canonicalJson, canonicalSha256, type JsonValue } from "./canonical";
import { OhRecordCodecRegistry } from "./contract";
import { createKnowledgeGraphRecordV1, knowledgeGraphRecordRefV1,
  type KnowledgeGraphRecordV1 } from "./graph";
import {
  createOhMemoryAgentV1,
  createOhMemoryAgentV2,
  createOhMemoryAuthorityV1,
  OH_MEMORY_AUTHORITY_LIMITS_V1,
  OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1,
  OH_MEMORY_LIMITS_V1,
  OH_MEMORY_QUERY_LIMITS_V2,
  OhMemoryAdoptionConflictError,
  OhMemoryContinuationError,
  parseOhMemoryNominationV1,
  type OhMemoryAuthoritySourceV1,
  type OhMemoryProofV1,
} from "./memory";
import {
  createOhProjectionLiteralV1,
  createOhProjectionQueryV1,
  createOhProjectionRulePackV1,
  createOhProjectionRuleV1,
  ohProjectionVariableV1,
} from "./projection";
import { createOhSqliteStoreAuthorityV1 } from "./sqlite/port";
import {
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_WORKING_STORE_PROFILE_V1,
  OhConflictError,
  OhIntegrityError,
  OhProfileError,
  type OhHeadV1,
  type OhSnapshotV1,
  type OhStoreV1,
} from "./store";

function entity(key: string, name: string) {
  return createKnowledgeGraphRecordV1({ dependencies: [], key, kind: "entity", v: 1,
    value: { name } });
}

async function put(store: OhStoreV1, key: string, name: string, operationId: string) {
  return await store.commit({ actorId: "test.host", changes: [
    { kind: "put", record: entity(key, name), v: 1 },
  ], expectedHead: await store.head(), instant: "2026-08-29T12:00:00.000Z", operationId });
}

function entityCodecs() {
  return new OhRecordCodecRegistry().register({ kind: "entity", parse: (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || typeof (value as { name?: unknown }).name !== "string") return null;
    return { name: (value as { name: string }).name } satisfies JsonValue;
  } });
}

function visibleProgram() {
  const lane = ohProjectionVariableV1("lane");
  const key = ohProjectionVariableV1("key");
  const kind = ohProjectionVariableV1("kind");
  const digest = ohProjectionVariableV1("digest");
  const literal = (relation: string, ...terms: ReturnType<typeof ohProjectionVariableV1>[]) =>
    createOhProjectionLiteralV1({ relation, terms });
  return {
    programId: "memory.visible-records",
    purpose: "answer.research",
    query: createOhProjectionQueryV1({ find: ["lane", "key", "digest"], limit: 50,
      queryId: "memory.visible-records", where: [literal("memory.visible", lane, key, digest)] }),
    rulePack: createOhProjectionRulePackV1({ rulePackId: "memory.visible-records",
      rulePackRevision: 1, rules: [createOhProjectionRuleV1({
        body: [literal("memory.record", lane, key, kind, digest)],
        head: literal("memory.visible", lane, key, digest), ruleId: "memory.visible-records", })] }),
  } as const;
}

function nameProgram() {
  const lane = ohProjectionVariableV1("lane");
  const key = ohProjectionVariableV1("key");
  const name = ohProjectionVariableV1("name");
  const literal = (relation: string, ...terms: ReturnType<typeof ohProjectionVariableV1>[]) =>
    createOhProjectionLiteralV1({ relation, terms });
  return {
    programId: "memory.domain-names",
    purpose: "answer.domain",
    query: createOhProjectionQueryV1({ find: ["lane", "key", "name"], limit: 50,
      queryId: "memory.domain-names", where: [literal("domain.visible-name", lane, key, name)] }),
    rulePack: createOhProjectionRulePackV1({ rulePackId: "memory.domain-names",
      rulePackRevision: 1, rules: [createOhProjectionRuleV1({
        body: [literal("domain.name", lane, key, name)],
        head: literal("domain.visible-name", lane, key, name), ruleId: "memory.domain-names", })] }),
  } as const;
}

function chunkProgram(maximumRows = 400, pageSize = 64,
  maximumResultBytes = 8 * 1024 * 1024, maximumPageBytes = 1024 * 1024) {
  const lane = ohProjectionVariableV1("lane");
  const key = ohProjectionVariableV1("key");
  const index = ohProjectionVariableV1("index");
  const chunk = ohProjectionVariableV1("chunk");
  const source = createOhProjectionLiteralV1({ relation: "domain.value-chunk",
    terms: [lane, key, index, chunk] });
  const visible = createOhProjectionLiteralV1({ relation: "domain.visible-value-chunk",
    terms: [lane, key, index, chunk] });
  return {
    evaluation: {
      maximumDerivedTuples: 2_048,
      maximumProofDepth: 16,
      maximumProofNodes: 16,
      maximumResultBytes,
      maximumRounds: 16,
      maximumTotalProofNodes: 8_192,
      maximumWorkUnits: 2_000_000,
    },
    maximumPageBytes,
    maximumRows,
    pageSize,
    parameters: ["key", "lane"],
    programId: "memory.value-chunks",
    purpose: "answer.memory-value",
    query: createOhProjectionQueryV1({ find: ["index", "chunk"], limit: maximumRows,
      queryId: "memory.value-chunks", where: [visible] }),
    rulePack: createOhProjectionRulePackV1({ rulePackId: "memory.value-chunks",
      rulePackRevision: 1, rules: [createOhProjectionRuleV1({ body: [source], head: visible,
        ruleId: "memory.value-chunks" })] }),
    v: 2,
  } as const;
}

function stableVisibleProgram(pageSize = 50) {
  const program = visibleProgram();
  return {
    evaluation: {
      maximumDerivedTuples: 2_048,
      maximumProofDepth: 16,
      maximumProofNodes: 64,
      maximumResultBytes: 8 * 1024 * 1024,
      maximumRounds: 16,
      maximumTotalProofNodes: 8_192,
      maximumWorkUnits: 2_000_000,
    },
    maximumPageBytes: 1024 * 1024,
    maximumRows: 50,
    pageSize,
    parameters: [],
    programId: program.programId,
    purpose: program.purpose,
    query: program.query,
    rulePack: program.rulePack,
    v: 2 as const,
  };
}

async function authorityFixture(configuration: Readonly<{
  canonicalRecords?: readonly ReturnType<typeof entity>[];
  explainCapabilityLifetimeMs?: number;
  monotonicNow?: () => number;
  now?: () => Date;
  pageSize?: number;
  workingStore?: (store: OhStoreV1) => OhStoreV1;
}> = {}) {
  const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:authority-c", spaceId: "authority-c" });
  const working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:authority-w", spaceId: "authority-w" });
  const records = configuration.canonicalRecords ?? [entity("entity:canonical", "Canonical")];
  if (records.length > 0) {
    await canonical.store.commit({ actorId: "test.canonical-seed",
      changes: records.map((record) => ({ kind: "put" as const, record, v: 1 as const })),
      expectedHead: await canonical.store.head(), operationId: "op_authority_seed" });
  }
  const initialCanonicalHead = await canonical.store.head();
  const selectedWorkingStore = configuration.workingStore?.(working.store) ?? working.store;
  const authority = await createOhMemoryAuthorityV1({
    actorId: "test.memory-agent", adoptionActorId: "test.memory-reviewer",
    canonical: { authorityId: "authority.canonical",
      expectedBindingSha256: canonical.store.binding.bindingSha256,
      expectedHead: initialCanonicalHead, store: canonical.store },
    continuationKey: Uint8Array.from({ length: 32 }, (_, index) => index),
    ...(configuration.explainCapabilityLifetimeMs === undefined ? {} : {
      explainCapabilityLifetimeMs: configuration.explainCapabilityLifetimeMs,
    }),
    ...(configuration.monotonicNow === undefined ? {} : {
      monotonicNow: configuration.monotonicNow,
    }),
    nominationRoutes: [{ destinationPurpose: "kb.review", nominationId: "kb.review" }],
    ...(configuration.now === undefined ? {} : { now: configuration.now }),
    programs: [stableVisibleProgram(configuration.pageSize)],
    working: { authorityId: "authority.working", codecs: entityCodecs(),
      expectedBindingSha256: selectedWorkingStore.binding.bindingSha256,
      store: selectedWorkingStore },
  });
  return { authority, canonical, initialCanonicalHead, working };
}

function staticSnapshot(records: readonly KnowledgeGraphRecordV1[]): OhSnapshotV1 {
  const sorted = [...records].sort((left, right) => left.key < right.key ? -1 : 1);
  const recordsSha256 = canonicalSha256(sorted.map(knowledgeGraphRecordRefV1));
  return Object.freeze({
    head: Object.freeze({
      generation: 1,
      graphRevisionSha256: canonicalSha256({ kind: "test.static-graph", recordsSha256, v: 1 }),
      operationSha256: canonicalSha256({ kind: "test.static-operation", recordsSha256, v: 1 }),
      recordsSha256,
      sequence: 1,
      v: 1 as const,
    }),
    records: Object.freeze(sorted),
    v: 1 as const,
  });
}

async function capacityAuthority(records: readonly KnowledgeGraphRecordV1[]) {
  const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:capacity-c", spaceId: "capacity-c" });
  const working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:capacity-w", spaceId: "capacity-w" });
  const snapshot = staticSnapshot(records);
  let commitCalls = 0;
  const canonicalStore: OhStoreV1 = {
    binding: canonical.store.binding,
    changesSince: canonical.store.changesSince.bind(canonical.store),
    close: canonical.store.close.bind(canonical.store),
    async commit() { commitCalls += 1; throw new Error("capacity preflight must precede CAS"); },
    exportDependencyClosure: canonical.store.exportDependencyClosure.bind(canonical.store),
    async head() { return snapshot.head; },
    async snapshot(options) {
      if (options?.maximumRecords !== undefined && records.length > options.maximumRecords) {
        throw new RangeError("static snapshot record bound");
      }
      return snapshot;
    },
    verify: canonical.store.verify.bind(canonical.store),
  };
  const authority = await createOhMemoryAuthorityV1({
    actorId: "test.capacity-agent", adoptionActorId: "test.capacity-reviewer",
    canonical: { authorityId: "authority.capacity-canonical",
      expectedBindingSha256: canonicalStore.binding.bindingSha256,
      expectedHead: snapshot.head, store: canonicalStore },
    continuationKey: Uint8Array.from({ length: 32 }, (_, index) => index),
    nominationRoutes: [{ destinationPurpose: "kb.review", nominationId: "kb.review" }],
    programs: [stableVisibleProgram()],
    working: { authorityId: "authority.capacity-working", codecs: entityCodecs(),
      expectedBindingSha256: working.store.binding.bindingSha256, store: working.store },
  });
  return { authority, canonical, canonicalStore, commitCalls: () => commitCalls, snapshot, working };
}

async function fixtureV2(maximumRows = 400, pageSize = 64,
  maximumResultBytes = 8 * 1024 * 1024, configuration: Readonly<{
    chunkBytes?: number;
    chunkCount?: number;
    continuationKey?: Uint8Array;
    extractorInvoked?: () => void;
    maximumPageBytes?: number;
    wrapWorkingStore?: (store: OhStoreV1) => OhStoreV1;
  }> = {}) {
  const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:v2-canonical", spaceId: "v2-canonical" });
  const working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:v2-working", spaceId: "v2-working" });
  await put(canonical.store, "entity:chunked", "Chunked", "op_v2_chunked");
  const chunkCount = configuration.chunkCount ?? 300;
  const chunkBytes = configuration.chunkBytes ?? 0;
  const baseProgram = chunkProgram(maximumRows, pageSize, maximumResultBytes,
    configuration.maximumPageBytes ?? 1024 * 1024);
  const expectedCanonicalHead = await canonical.store.head();
  const selectedWorkingStore = configuration.wrapWorkingStore?.(working.store) ?? working.store;
  const createAgent = async (continuationKey?: Uint8Array) => await createOhMemoryAgentV2({
    actorId: "test.memory-agent-v2",
    canonical: { authorityId: "authority.v2-canonical",
      expectedBindingSha256: canonical.store.binding.bindingSha256,
      expectedHead: expectedCanonicalHead, store: canonical.store },
    ...(continuationKey === undefined ? {} : { continuationKey }),
    extractors: [{ extractorId: "domain.value-chunks",
      extractorSha256: canonicalSha256({ extractor: "domain.value-chunks", revision: 1 }),
      relations: ["domain.value-chunk"],
      extract: ({ lane, record }) => {
        configuration.extractorInvoked?.();
        return Array.from({ length: chunkCount }, (_, index) => ({
          relation: "domain.value-chunk", tuple: [lane, record.key, index,
            `chunk:${index.toString().padStart(3, "0")}${"x".repeat(chunkBytes)}`], v: 1 as const,
        }));
      },
    }],
    monotonicNow: () => 0,
    now: () => new Date("2026-08-29T12:00:00.000Z"),
    programs: [baseProgram, { ...baseProgram, maximumPageBytes: 1024 * 1024,
      programId: "memory.value-chunks-alternate", purpose: "answer.memory-value-alternate" }],
    working: { authorityId: "authority.v2-working", codecs: entityCodecs(),
      expectedBindingSha256: selectedWorkingStore.binding.bindingSha256,
      store: selectedWorkingStore },
  });
  const agent = await createAgent(configuration.continuationKey);
  return { agent, canonical, createAgent, working };
}

function physicalSources(proofs: readonly OhMemoryProofV1[]) {
  const sources: OhMemoryAuthoritySourceV1[] = [];
  const visit = (proof: OhMemoryProofV1) => {
    if (proof.kind === "fact") sources.push(...proof.sources);
    else if (proof.kind === "derived") proof.premises.forEach(visit);
  };
  proofs.forEach(visit);
  return sources;
}

function countedWorkingStore(store: OhStoreV1, counter: { reads: number }): OhStoreV1 {
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (property === "head" || property === "snapshot") counter.reads += 1;
        return Reflect.apply(value, target, args);
      };
    },
  }) as OhStoreV1;
}

function frozenForwardingStore(store: OhStoreV1): OhStoreV1 {
  return Object.freeze({
    binding: store.binding,
    changesSince: store.changesSince.bind(store),
    close: store.close.bind(store),
    commit: store.commit.bind(store),
    exportDependencyClosure: store.exportDependencyClosure.bind(store),
    head: store.head.bind(store),
    snapshot: store.snapshot.bind(store),
    verify: store.verify.bind(store),
  });
}

function saturatedWorkingStore(
  store: OhStoreV1,
  snapshot: OhSnapshotV1,
  counter: { commits: number },
): OhStoreV1 {
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "commit") {
        return async () => {
          counter.commits += 1;
          throw new Error("working capacity preflight must precede CAS");
        };
      }
      if (property === "head") return async () => snapshot.head;
      if (property === "snapshot") return async () => snapshot;
      return typeof value === "function"
        ? (...args: unknown[]) => Reflect.apply(value, target, args)
        : value;
    },
  }) as OhStoreV1;
}

function replayProbeWorkingStore(
  store: OhStoreV1,
  state: { rejectSnapshots: boolean; snapshotReads: number },
): OhStoreV1 {
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "snapshot") {
        return async (...args: unknown[]) => {
          state.snapshotReads += 1;
          if (state.rejectSnapshots) {
            throw new RangeError("a stale replay must not run a prospective capacity snapshot");
          }
          return await Reflect.apply(value as (...values: unknown[]) => unknown, target, args);
        };
      }
      return typeof value === "function"
        ? (...args: unknown[]) => Reflect.apply(value, target, args)
        : value;
    },
  }) as OhStoreV1;
}

type HostileCapacityResponse = "accessor-snapshot" | "mismatched-snapshot"
  | "mutated-head-snapshot" | "oversize-head" | "oversize-snapshot";

function hostileCapacityWorkingStore(
  store: OhStoreV1,
  mode: HostileCapacityResponse,
  counter: { accessorReads?: number; commits: number; snapshotReads: number },
): OhStoreV1 {
  let returnedMutableHead: OhHeadV1 | undefined;
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "commit") {
        return async () => {
          counter.commits += 1;
          throw new Error("a hostile capacity response must fail before CAS");
        };
      }
      if (property === "head" && mode === "oversize-head") {
        return async () => ({ ...await target.head(), padding: "x".repeat(8 * 1024) });
      }
      if (property === "head" && mode === "mutated-head-snapshot") {
        return async () => {
          returnedMutableHead = { ...await target.head() };
          return returnedMutableHead;
        };
      }
      if (property === "snapshot") {
        return async (...args: unknown[]) => {
          counter.snapshotReads += 1;
          if (mode === "mismatched-snapshot") return staticSnapshot([]);
          if (mode === "mutated-head-snapshot") {
            if (returnedMutableHead === undefined) throw new Error("Expected a prior head read.");
            const substituted = staticSnapshot([]);
            Object.assign(returnedMutableHead as unknown as Record<string, unknown>,
              substituted.head);
            return { head: returnedMutableHead, records: substituted.records, v: 1 };
          }
          const snapshot = await Reflect.apply(value as (...values: unknown[]) => unknown,
            target, args) as OhSnapshotV1;
          if (mode === "oversize-snapshot") {
            return { ...snapshot, padding: "x".repeat(OH_MEMORY_LIMITS_V1.snapshotBytesPerLane) };
          }
          if (mode === "accessor-snapshot") {
            const response = { head: snapshot.head, v: 1 } as {
              head: OhHeadV1;
              readonly records: readonly KnowledgeGraphRecordV1[];
              v: 1;
            };
            Object.defineProperty(response, "records", {
              enumerable: true,
              get: () => {
                counter.accessorReads = (counter.accessorReads ?? 0) + 1;
                return snapshot.records;
              },
            });
            return response;
          }
          return snapshot;
        };
      }
      return typeof value === "function"
        ? (...args: unknown[]) => Reflect.apply(value, target, args)
        : value;
    },
  }) as OhStoreV1;
}

async function fixture(configuration: Readonly<{
  wrapWorkingStore?: (store: OhStoreV1) => OhStoreV1;
}> = {}) {
  const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:canonical", spaceId: "canonical" });
  const working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:working", spaceId: "working" });
  await put(canonical.store, "entity:shared", "Reviewed", "op_canonical_shared");
  await put(canonical.store, "entity:canonical", "Canonical", "op_canonical_only");
  const canonicalHead = await canonical.store.head();
  let now = new Date("2026-08-29T12:00:00.000Z");
  const clockOrigin = now.getTime();
  let monotonicNow = 0;
  const baseProgram = visibleProgram();
  const selectedWorkingStore = configuration.wrapWorkingStore?.(working.store) ?? working.store;
  const agent = await createOhMemoryAgentV1({
    actorId: "test.memory-agent",
    canonical: { authorityId: "authority.canonical", expectedBindingSha256: canonical.store.binding.bindingSha256,
      expectedHead: canonicalHead, store: canonical.store },
    now: () => now,
    nominationRoutes: [{ destinationPurpose: "kb.review", nominationId: "kb.review" }],
    monotonicNow: () => monotonicNow,
    programs: [baseProgram, { ...baseProgram, programId: "memory.visible-records-alternate",
      purpose: "answer.alternate" }, { ...baseProgram,
      evaluation: { maximumRounds: 2 }, programId: "memory.visible-records-bounded" }],
    working: { authorityId: "authority.working", codecs: entityCodecs(),
      expectedBindingSha256: selectedWorkingStore.binding.bindingSha256,
      store: selectedWorkingStore },
  });
  return { agent, canonical, canonicalHead, setNow(value: string) {
    now = new Date(value); monotonicNow = now.getTime() - clockOrigin;
  }, working };
}

describe("composite Oh memory V1", () => {
  test("keeps two physical authorities explicit and makes working conflicts visible", async () => {
    expect(Object.isFrozen(OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.relations)).toBe(true);
    const value = await fixture();
    const emptyWorkingHead = await value.working.store.head();
    const firstRemember = { expectedHead: {
      generation: emptyWorkingHead.generation, operationSha256: emptyWorkingHead.operationSha256,
    }, requestId: "op_working_shared",
    puts: [{ dependencies: [], key: "entity:shared", kind: "entity", v: 1,
      value: { name: "Proposed correction" } }], tombstones: [], v: 1 } as const;
    const receipt = await value.agent.remember(firstRemember);
    expect(receipt).toMatchObject({ actorId: "test.memory-agent", authorityId: "authority.working",
      lane: "working", requestId: "op_working_shared", status: "committed" });
    expect(Object.keys(receipt)).not.toContain("changes");
    expect(await value.agent.remember(firstRemember)).toEqual(receipt);
    const head = await value.working.store.head();
    await value.agent.remember({ expectedHead: {
      generation: head.generation, operationSha256: head.operationSha256,
    }, requestId: "op_working_only",
    puts: [{ dependencies: [], key: "entity:working", kind: "entity", v: 1,
      value: { name: "Working" } }], tombstones: [], v: 1 });

    const result = await value.agent.query({ programId: "memory.visible-records", v: 1 });
    expect({ memorySha256: String(result.identity.memorySha256), resultSha256: String(result.resultSha256),
      rowSha256: result.rows.map(({ resultRowSha256 }) => String(resultRowSha256)) }).toEqual({
      memorySha256: "b2327cb013af29646ab6beaa953771153c10f076bb8f3e061f106b0a5f234a3a",
      resultSha256: "44e9fb7af61aa2395f6e028acdfdf327f64c07be9dca40b5097f9d5d3248291e",
      rowSha256: [
        "9abe30330d18d8ee271f25f5db9e9a0bad09eaa8a10fb206b2850336f016903d",
        "ccfc0b064abbbea14ddbdb17a03708cb151f166c82c9c028c159c1e07f10bff5",
        "c4f1ce2d57b8324858892d7a1e3362a77b098d5a8e9b794df269f49dd25d1456",
        "6ca55f381d076658aef1d4b7f238fc7730413c55a4474d3a96703912170c7485",
      ],
    });
    expect(result.authority).toBe("derived");
    expect(result.rows.map(({ values }) => values.slice(0, 2))).toEqual([
      ["canonical", "entity:canonical"], ["canonical", "entity:shared"],
      ["working", "entity:shared"], ["working", "entity:working"],
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.key).toBe("entity:shared");
    expect(result.identity.canonical.authorityId).toBe("authority.canonical");
    expect(result.identity.working.authorityId).toBe("authority.working");
    expect(result.identity.canonical.head).toEqual(value.canonicalHead);
    expect(result.identity.working.head).toEqual(await value.working.store.head());
    expect(result.identity.purpose).toBe("answer.research");
    expect(Object.isFrozen(result.rows)).toBe(true);
    expect(Object.isFrozen(result.rows[0]?.values)).toBe(true);
    expect(() => (result.rows as unknown as unknown[]).splice(0, 1)).toThrow();
    expect(() => (result.rows[0]!.values as unknown as unknown[]).push("tamper")).toThrow();

    const workingRow = result.rows.findIndex(({ values }) => values[0] === "working");
    const explanation = await value.agent.explain({ resultSha256: result.resultSha256,
      row: workingRow, token: result.explainCapability.token, v: 1 });
    expect(explanation.premiseAuthority).toBe("working");
    expect(physicalSources(explanation.proofs)).toEqual([expect.objectContaining({
      authorityId: "authority.working", bindingSha256: value.working.store.binding.bindingSha256,
      head: await value.working.store.head(), key: "entity:shared", lane: "working",
    })]);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("binds both heads and host-owned program purpose and evaluation into identity", async () => {
    const value = await fixture();
    const first = await value.agent.query({ programId: "memory.visible-records", v: 1 });
    const purposeChanged = await value.agent.query({
      programId: "memory.visible-records-alternate", v: 1 });
    const evaluationChanged = await value.agent.query({
      programId: "memory.visible-records-bounded", v: 1 });
    expect(purposeChanged.identity.purpose).toBe("answer.alternate");
    expect(evaluationChanged.identity.evaluationSha256).not.toBe(first.identity.evaluationSha256);
    expect(new Set([first.identity.memorySha256, purposeChanged.identity.memorySha256,
      evaluationChanged.identity.memorySha256]).size).toBe(3);

    const workingHead = await value.working.store.head();
    await value.agent.remember({ expectedHead: {
      generation: workingHead.generation, operationSha256: workingHead.operationSha256,
    }, requestId: "op_identity_change",
    puts: [{ dependencies: [], key: "entity:new", kind: "entity", v: 1,
      value: { name: "New" } }], tombstones: [], v: 1 });
    const headChanged = await value.agent.query({ programId: "memory.visible-records", v: 1 });
    expect(headChanged.identity.memorySha256).not.toBe(first.identity.memorySha256);
    expect(headChanged.identity.working.head.sequence).toBe(1);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("binds host-owned domain extractors while retaining physical sources", async () => {
    const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:domain-c", spaceId: "domain-c" });
    const working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:domain-w", spaceId: "domain-w" });
    await put(canonical.store, "entity:domain", "Domain name", "op_domain_name");
    const agent = await createOhMemoryAgentV1({ actorId: "test.domain-agent",
      canonical: { authorityId: "authority.domain-c",
      expectedBindingSha256: canonical.store.binding.bindingSha256,
      expectedHead: await canonical.store.head(), store: canonical.store }, extractors: [{
        extractorId: "domain.mutator",
        extractorSha256: canonicalSha256({ extractor: "domain.mutator", v: 1 }),
        relations: ["domain.mutation-attempt"],
        extract: ({ lane, record }) => {
          try { (record.value as { name: string }).name = "Mutated"; } catch { /* frozen input */ }
          return [{ relation: "domain.mutation-attempt", tuple: [lane, record.key], v: 1 }];
        },
      }, { extractorId: "domain.names",
        extractorSha256: canonicalSha256({ extractor: "domain.names", v: 1 }),
        relations: ["domain.name"], extract: ({ lane, record }) => [{ relation: "domain.name",
          tuple: [lane, record.key, (record.value as { name: string }).name], v: 1 }],
      }], programs: [nameProgram()], working: { authorityId: "authority.domain-w",
      codecs: entityCodecs(), expectedBindingSha256: working.store.binding.bindingSha256,
      store: working.store } });
    const result = await agent.query({ programId: "memory.domain-names", v: 1 });
    expect(result.rows.map(({ values }) => values)).toEqual([
      ["canonical", "entity:domain", "Domain name"],
    ]);
    const explanation = await agent.explain({ resultSha256: result.resultSha256, row: 0,
      token: result.explainCapability.token, v: 1 });
    expect(physicalSources(explanation.proofs)[0]).toMatchObject({ key: "entity:domain", lane: "canonical" });
    const topProof = explanation.proofs[0];
    expect(topProof?.kind).toBe("derived");
    if (topProof?.kind !== "derived") throw new Error("Expected a derived domain proof.");
    const domainProof = topProof.premises[0];
    expect(domainProof?.kind).toBe("fact");
    if (domainProof?.kind !== "fact") throw new Error("Expected a domain fact premise.");
    expect(domainProof.factPolicy).toMatchObject({ extractorId: "domain.names", kind: "domain" });
    await canonical.store.close(); await working.store.close();
  });

  test("captures host options and detaches store-owned snapshots before the first await", async () => {
    const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:captured-c", spaceId: "captured-c" });
    const working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:captured-w", spaceId: "captured-w" });
    const swapped = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:swapped-w", spaceId: "swapped-w" });
    await put(swapped.store, "entity:swapped", "Swapped", "op_swapped");
    let leakedSnapshot: { head: unknown; records: ReturnType<typeof entity>[]; v: 1 } | undefined;
    const canonicalStore = {
      binding: canonical.store.binding,
      head: () => canonical.store.head(),
      snapshot: async (options?: Parameters<OhStoreV1["snapshot"]>[0]) => {
        const snapshot = await canonical.store.snapshot(options);
        leakedSnapshot = { head: { ...snapshot.head }, records: [...snapshot.records], v: 1 };
        return leakedSnapshot;
      },
    } as unknown as OhStoreV1;
    const program = visibleProgram();
    const mutableOptions = { actorId: "test.captured-agent", canonical: {
      authorityId: "authority.captured-c", expectedBindingSha256: canonical.store.binding.bindingSha256,
      expectedHead: await canonical.store.head(), store: canonicalStore },
    nominationRoutes: [{ destinationPurpose: "kb.review", nominationId: "kb.review" }],
    programs: [program], working: { authorityId: "authority.captured-w", codecs: entityCodecs(),
      expectedBindingSha256: working.store.binding.bindingSha256, store: working.store } };
    const pending = createOhMemoryAgentV1(mutableOptions);
    mutableOptions.working.store = swapped.store;
    (mutableOptions.programs[0] as { purpose: string }).purpose = "attacker.relabel";
    const agent = await pending;
    if (leakedSnapshot === undefined) throw new Error("Expected the test store to return a snapshot.");
    leakedSnapshot.records.push(entity("entity:mutated-snapshot", "Mutated"));
    const head = await working.store.head();
    const receipt = await agent.remember({ expectedHead: { generation: head.generation,
      operationSha256: head.operationSha256 }, puts: [{ dependencies: [], key: "entity:bound",
      kind: "entity", v: 1, value: { name: "Bound" } }], requestId: "captured-remember",
    tombstones: [], v: 1 });
    expect(receipt.bindingSha256).toBe(working.store.binding.bindingSha256);
    const result = await agent.query({ programId: "memory.visible-records", v: 1 });
    expect(result.identity.purpose).toBe("answer.research");
    expect(result.rows.map(({ values }) => values.slice(0, 2))).toEqual([
      ["working", "entity:bound"],
    ]);
    const nomination = await agent.nominate({ nominationId: "kb.review",
      roots: ["entity:bound"], v: 1 });
    expect(nomination.closure.records.map(({ key }) => key)).toEqual(["entity:bound"]);
    await canonical.store.close(); await working.store.close(); await swapped.store.close();
  });

  test("rejects query injection and misbound or expired explanation capabilities", async () => {
    const value = await fixture();
    expect(Object.keys(value.agent).sort()).toEqual(["explain", "nominate", "query", "remember"]);
    await expect(value.agent.query({ programId: "memory.visible-records",
      query: { relation: "attacker" }, v: 1 }))
      .rejects.toThrow(TypeError);
    await expect(value.agent.query({ programId: "memory.visible-records",
      purpose: "attacker.label", v: 1 })).rejects.toThrow(TypeError);
    await expect(value.agent.query({ programId: "unknown", v: 1 })).rejects.toThrow("Unknown named");
    const result = await value.agent.query({ programId: "memory.visible-records", v: 1 });
    await expect(value.agent.explain({ resultSha256: "f".repeat(64), row: 0,
      token: result.explainCapability.token, v: 1 })).rejects.toThrow(OhProfileError);
    await expect(value.agent.explain({ resultSha256: result.resultSha256, row: 0,
      token: "A".repeat(43), v: 1 })).rejects.toThrow(OhProfileError);
    value.setNow("2026-08-29T12:10:00.000Z");
    const later = await value.agent.query({ programId: "memory.visible-records", v: 1 });
    value.setNow("2026-08-29T12:05:00.000Z");
    await expect(value.agent.explain({ resultSha256: later.resultSha256, row: 0,
      token: later.explainCapability.token, v: 1 })).rejects.toThrow("monotonic clock regressed");
    value.setNow("2026-08-29T12:15:00.000Z");
    await expect(value.agent.explain({ resultSha256: result.resultSha256, row: 0,
      token: result.explainCapability.token, v: 1 })).rejects.toThrow(OhProfileError);
    value.setNow("invalid");
    await expect(value.agent.explain({ resultSha256: result.resultSha256, row: 0,
      token: result.explainCapability.token, v: 1 })).rejects.toThrow(TypeError);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("prepares an exact working closure without writing canonical authority", async () => {
    const value = await fixture();
    const beforeCanonical = await value.canonical.store.head();
    const head = await value.working.store.head();
    await value.agent.remember({ expectedHead: {
      generation: head.generation, operationSha256: head.operationSha256,
    }, requestId: "op_nomination",
    puts: [{ dependencies: [], key: "entity:candidate", kind: "entity", v: 1,
      value: { name: "Candidate" } }, { dependencies: [], key: "entity:other", kind: "entity", v: 1,
      value: { name: "Other" } }], tombstones: [], v: 1 });
    const nomination = await value.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:candidate"], v: 1 });
    expect(nomination.status).toBe("prepared");
    expect(nomination.destinationPurpose).toBe("kb.review");
    expect(nomination.source.lane).toBe("working");
    expect(nomination.closure.records.map(({ key }) => key)).toEqual(["entity:candidate"]);
    expect(await value.canonical.store.head()).toEqual(beforeCanonical);
    const exactHead = await value.working.store.head();
    const originalExport = value.working.store.exportDependencyClosure.bind(value.working.store);
    const substituted = await originalExport({ head: { operationSha256: exactHead.operationSha256,
      sequence: exactHead.sequence }, roots: ["entity:other"] });
    (value.working.store as unknown as { exportDependencyClosure: () => Promise<typeof substituted> })
      .exportDependencyClosure = async () => substituted;
    await expect(value.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:candidate"], v: 1 })).rejects.toThrow("substituted different roots");
    await expect(value.agent.nominate({ nominationId: "attacker.destination",
      roots: ["entity:candidate"], v: 1 })).rejects.toThrow("Unknown named");
    await expect(value.agent.nominate({ nominationId: "kb.review",
      roots: Array.from({ length: 1_025 }, (_, index) => `entity:${index}`), v: 1 }))
      .rejects.toThrow(TypeError);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("fails closed on host binding, profile, and pinned-head mistakes", async () => {
    const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:c", spaceId: "c" });
    const working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:w", spaceId: "w" });
    const head = await canonical.store.head();
    await expect(createOhMemoryAgentV1({ actorId: "test.agent",
      canonical: { authorityId: "authority.c",
      expectedBindingSha256: working.store.binding.bindingSha256, expectedHead: head,
      store: canonical.store }, programs: [visibleProgram()], working: { authorityId: "authority.w",
      codecs: entityCodecs(), expectedBindingSha256: working.store.binding.bindingSha256,
      store: working.store } })).rejects.toThrow(OhIntegrityError);
    await expect(createOhMemoryAgentV1({ actorId: "test.agent",
      canonical: { authorityId: "authority.c",
      expectedBindingSha256: canonical.store.binding.bindingSha256,
      expectedHead: { ...head, recordsSha256: "f".repeat(64) as typeof head.recordsSha256 },
      store: canonical.store }, programs: [visibleProgram()], working: { authorityId: "authority.w",
      codecs: entityCodecs(), expectedBindingSha256: working.store.binding.bindingSha256,
      store: working.store } })).rejects.toThrow();
    await expect(createOhMemoryAgentV1({ actorId: "test.agent",
      canonical: { authorityId: "same",
      expectedBindingSha256: canonical.store.binding.bindingSha256, expectedHead: head,
      store: canonical.store }, programs: [visibleProgram()], working: { authorityId: "same",
      codecs: entityCodecs(), expectedBindingSha256: working.store.binding.bindingSha256,
      store: working.store } })).rejects.toThrow(OhProfileError);
    await canonical.store.close(); await working.store.close();
  });

  test("rejects a V1 remember that would exceed working record capacity before CAS", async () => {
    const snapshot = staticSnapshot(Array.from({
      length: OH_MEMORY_LIMITS_V1.maximumRecordsPerLane,
    }, (_, index) => entity(`entity:v1-capacity-${index.toString().padStart(4, "0")}`, "x")));
    const counter = { commits: 0 };
    const value = await fixture({
      wrapWorkingStore: (store) => saturatedWorkingStore(store, snapshot, counter),
    });
    await expect(value.agent.remember({ expectedHead: {
      generation: snapshot.head.generation,
      operationSha256: snapshot.head.operationSha256,
    }, puts: [{ dependencies: [], key: "entity:v1-capacity-extra", kind: "entity", v: 1,
      value: { name: "Extra" } }], requestId: "v1-capacity-extra", tombstones: [], v: 1 }))
      .rejects.toThrow("working memory would exceed its record snapshot bound");
    expect(counter.commits).toBe(0);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("accepts an immutable host working-store capability", async () => {
    const value = await fixture({ wrapWorkingStore: frozenForwardingStore });
    const head = await value.working.store.head();
    const receipt = await value.agent.remember({
      expectedHead: {
        generation: head.generation,
        operationSha256: head.operationSha256,
      },
      puts: [{
        dependencies: [],
        key: "entity:frozen-host-store",
        kind: "entity",
        v: 1,
        value: { name: "Frozen host store" },
      }],
      requestId: "v1-frozen-host-store",
      tombstones: [],
      v: 1,
    });
    expect(receipt.status).toBe("committed");
    expect((await value.working.store.snapshot()).records.map(({ key }) => key))
      .toContain("entity:frozen-host-store");
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("lets the V1 store resolve an exact stale replay after a later write", async () => {
    const state = { rejectSnapshots: false, snapshotReads: 0 };
    const value = await fixture({
      wrapWorkingStore: (store) => replayProbeWorkingStore(store, state),
    });
    const initialHead = await value.working.store.head();
    const request = { expectedHead: { generation: initialHead.generation,
      operationSha256: initialHead.operationSha256 }, puts: [{ dependencies: [],
      key: "entity:v1-replay", kind: "entity", v: 1, value: { name: "Replay" } }],
    requestId: "v1-exact-replay", tombstones: [], v: 1 } as const;
    const receipt = await value.agent.remember(request);
    await put(value.working.store, "entity:v1-later", "Later", "v1_later_write");
    const snapshotReads = state.snapshotReads;
    state.rejectSnapshots = true;
    expect(await value.agent.remember(request)).toEqual(receipt);
    expect(state.snapshotReads).toBe(snapshotReads);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("bounds a host-supplied working head before capacity preflight", async () => {
    const counter = { commits: 0, snapshotReads: 0 };
    const value = await fixture({
      wrapWorkingStore: (store) => hostileCapacityWorkingStore(store, "oversize-head", counter),
    });
    const head = await value.working.store.head();
    await expect(value.agent.remember({ expectedHead: {
      generation: head.generation, operationSha256: head.operationSha256,
    }, puts: [{ dependencies: [], key: "entity:v1-hostile-head", kind: "entity", v: 1,
      value: { name: "Hostile head" } }], requestId: "v1-hostile-head", tombstones: [], v: 1 }))
      .rejects.toThrow("canonical byte bound");
    expect(counter).toEqual({ commits: 0, snapshotReads: 0 });
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("rejects a capacity snapshot that is not at the requested current head", async () => {
    const counter = { commits: 0, snapshotReads: 0 };
    const value = await fixture({
      wrapWorkingStore: (store) => hostileCapacityWorkingStore(store,
        "mismatched-snapshot", counter),
    });
    const head = await value.working.store.head();
    await expect(value.agent.remember({ expectedHead: {
      generation: head.generation, operationSha256: head.operationSha256,
    }, puts: [{ dependencies: [], key: "entity:v1-mismatched-snapshot", kind: "entity", v: 1,
      value: { name: "Mismatched snapshot" } }], requestId: "v1-mismatched-snapshot",
    tombstones: [], v: 1 })).rejects.toThrow(OhIntegrityError);
    expect(counter).toEqual({ commits: 0, snapshotReads: 1 });
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("detaches the working head before a store mutates and reuses its response", async () => {
    const counter = { commits: 0, snapshotReads: 0 };
    const value = await fixture({
      wrapWorkingStore: (store) => hostileCapacityWorkingStore(store,
        "mutated-head-snapshot", counter),
    });
    const head = await value.working.store.head();
    await expect(value.agent.remember({ expectedHead: {
      generation: head.generation, operationSha256: head.operationSha256,
    }, puts: [{ dependencies: [], key: "entity:v1-mutated-head", kind: "entity", v: 1,
      value: { name: "Mutated head" } }], requestId: "v1-mutated-head",
    tombstones: [], v: 1 })).rejects.toThrow(OhIntegrityError);
    expect(counter).toEqual({ commits: 0, snapshotReads: 1 });
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("bounds a host-supplied working snapshot before capacity math", async () => {
    const counter = { commits: 0, snapshotReads: 0 };
    const value = await fixture({
      wrapWorkingStore: (store) => hostileCapacityWorkingStore(store,
        "oversize-snapshot", counter),
    });
    const head = await value.working.store.head();
    await expect(value.agent.remember({ expectedHead: {
      generation: head.generation, operationSha256: head.operationSha256,
    }, puts: [{ dependencies: [], key: "entity:v1-oversize-snapshot", kind: "entity", v: 1,
      value: { name: "Oversize snapshot" } }], requestId: "v1-oversize-snapshot",
    tombstones: [], v: 1 })).rejects.toThrow("canonical byte bound");
    expect(counter).toEqual({ commits: 0, snapshotReads: 1 });
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("rejects accessor-bearing working snapshots without invoking them", async () => {
    const counter = { accessorReads: 0, commits: 0, snapshotReads: 0 };
    const value = await fixture({
      wrapWorkingStore: (store) => hostileCapacityWorkingStore(store,
        "accessor-snapshot", counter),
    });
    const head = await value.working.store.head();
    await expect(value.agent.remember({ expectedHead: {
      generation: head.generation, operationSha256: head.operationSha256,
    }, puts: [{ dependencies: [], key: "entity:v1-accessor-snapshot", kind: "entity", v: 1,
      value: { name: "Accessor snapshot" } }], requestId: "v1-accessor-snapshot",
    tombstones: [], v: 1 })).rejects.toThrow("non-data property");
    expect(counter).toEqual({ accessorReads: 0, commits: 0, snapshotReads: 1 });
    await value.canonical.store.close(); await value.working.store.close();
  });
});

describe("parameterized and paginated Oh memory V2", () => {
  test("binds host-declared lane and key constants and returns more than 256 value chunks in stable pages",
    async () => {
      const value = await fixtureV2();
      let continuation: string | null = null;
      const rows: (readonly (boolean | null | number | string)[])[] = [];
      const starts: number[] = [];
      let first: Awaited<ReturnType<typeof value.agent.query>> | undefined;
      let later: Awaited<ReturnType<typeof value.agent.query>> | undefined;
      do {
        const result = await value.agent.query({ bindings: {
          key: "entity:chunked", lane: "canonical",
        }, continuation, programId: "memory.value-chunks", v: 2 });
        first ??= result;
        if (result.page.start === 64) later = result;
        starts.push(result.page.start);
        rows.push(...result.rows.map((row) => row.values));
        expect(result.page.truncation).toEqual({ reasons: [], truncated: false, v: 2 });
        expect(result.page.hasMore).toBe(result.continuation !== null);
        expect(result.page.hasMore).toBe(result.continuationSha256 !== null);
        expect(result.page.completeness).toBe(result.page.hasMore ? "partial" : "complete");
        continuation = result.continuation;
      } while (continuation !== null);

      expect(starts).toEqual([0, 64, 128, 192, 256]);
      expect(rows).toHaveLength(300);
      expect(rows[0]).toEqual([0, "chunk:000"]);
      expect(rows).toContainEqual([299, "chunk:299"]);
      expect(rows.map((row) => row[0] as number).sort((left, right) => left - right))
        .toEqual(Array.from({ length: 300 }, (_, index) => index));
      expect(first?.identity.bindings).toEqual({ key: "entity:chunked", lane: "canonical" });
      expect(first?.identity.bindingsSha256).not.toBe(first?.identity.templateQuerySha256);
      expect(first?.identity.boundQuerySha256).not.toBe(first?.identity.templateQuerySha256);
      expect(Object.isFrozen(first?.identity.bindings)).toBe(true);
      if (first === undefined) throw new Error("Expected a first V2 page.");
      const explanation = await value.agent.explain({ pageRow: 0,
        resultSha256: first.resultSha256, token: first.explainCapability.token, v: 2 });
      expect(explanation.page).toEqual(first.page);
      expect(explanation.resultSha256).toBe(first.resultSha256);
      expect(physicalSources(explanation.proofs)).toEqual([expect.objectContaining({
        key: "entity:chunked", lane: "canonical",
      })]);
      if (later === undefined) throw new Error("Expected a later V2 page.");
      const laterExplanation = await value.agent.explain({ pageRow: 0,
        resultSha256: later.resultSha256, token: later.explainCapability.token, v: 2 });
      expect(laterExplanation.page.start).toBe(64);
      expect(laterExplanation.pageRow).toBe(0);
      expect(laterExplanation.values).toEqual(later.rows[0]!.values);
      expect(physicalSources(laterExplanation.proofs)).toEqual([expect.objectContaining({
        key: "entity:chunked", lane: "canonical",
      })]);
      await expect(value.agent.explain({ pageRow: 0, resultSha256: "f".repeat(64),
        token: first.explainCapability.token, v: 2 })).rejects.toThrow(OhProfileError);
      await value.canonical.store.close(); await value.working.store.close();
    });

  test("pins continuations to the exact source, program, bindings, and complete projection", async () => {
    const value = await fixtureV2();
    const first = await value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: null, programId: "memory.value-chunks", v: 2 });
    expect(first.continuation).not.toBeNull();
    const continuation = first.continuation!;
    const last = continuation.at(-1);
    const tampered = `${continuation.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    await expect(value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: tampered, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow(OhMemoryContinuationError);
    const decoded = JSON.parse(Buffer.from(continuation, "base64url").toString("utf8")) as
      Record<string, unknown>;
    const noncanonical = Buffer.from(JSON.stringify(Object.fromEntries(
      Object.entries(decoded).reverse())), "utf8").toString("base64url");
    await expect(value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: noncanonical, programId: "memory.value-chunks", v: 2 }))
      .rejects.toMatchObject({ code: "memory-continuation", reason: "encoding" });
    await expect(value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation, programId: "memory.value-chunks-alternate", v: 2 }))
      .rejects.toThrow(OhMemoryContinuationError);
    await expect(value.agent.query({ bindings: {
      key: "entity:other", lane: "canonical",
    }, continuation, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow(OhMemoryContinuationError);

    const head = await value.working.store.head();
    await value.agent.remember({ expectedHead: { generation: head.generation,
      operationSha256: head.operationSha256 }, puts: [{ dependencies: [], key: "entity:head-change",
      kind: "entity", v: 1, value: { name: "Head change" } }], requestId: "v2_head_change",
    tombstones: [], v: 1 });
    await expect(value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation, programId: "memory.value-chunks", v: 2 }))
      .rejects.toMatchObject({ code: "memory-continuation", reason: "identity" });
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("rejects an aligned offset forgery after every public cursor digest is recomputed", async () => {
    const value = await fixtureV2(8, 2, 8 * 1024 * 1024, {
      chunkCount: 8,
      continuationKey: new Uint8Array(32).fill(7),
    });
    const request = { bindings: { key: "entity:chunked", lane: "canonical" },
      continuation: null, programId: "memory.value-chunks", v: 2 as const };
    const first = await value.agent.query(request);
    if (first.continuation === null) throw new Error("Expected an issued V2 continuation.");
    const decoded = JSON.parse(Buffer.from(first.continuation, "base64url").toString("utf8")) as
      Record<string, unknown>;
    expect(decoded.nextOffset).toBe(2);
    decoded.nextOffset = 6;
    const unsigned = Object.fromEntries(Object.entries(decoded).filter(([key]) =>
      key !== "continuationHmacSha256" && key !== "continuationSha256"));
    decoded.continuationSha256 = canonicalSha256(unsigned);
    const forged = Buffer.from(canonicalJson(decoded), "utf8").toString("base64url");
    await expect(value.agent.query({ ...request, continuation: forged }))
      .rejects.toMatchObject({ code: "memory-continuation", reason: "authentication" });

    const replayOne = await value.agent.query({ ...request, continuation: first.continuation });
    const replayTwo = await value.agent.query({ ...request, continuation: first.continuation });
    expect(replayOne.page.start).toBe(2);
    expect(replayTwo.page).toEqual(replayOne.page);
    expect(replayTwo.rows).toEqual(replayOne.rows);
    expect(replayTwo.resultSha256).toBe(replayOne.resultSha256);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("scopes default cursors to one agent and preserves keyed cursors and public digests", async () => {
    const mutableHostKey = new Uint8Array(32).fill(3);
    const persistedHostKey = mutableHostKey.slice();
    const value = await fixtureV2(400, 64, 8 * 1024 * 1024, {
      continuationKey: mutableHostKey,
    });
    mutableHostKey.fill(9);
    const request = { bindings: { key: "entity:chunked", lane: "canonical" },
      continuation: null, programId: "memory.value-chunks", v: 2 as const };
    const keyed = await value.agent.query(request);
    if (keyed.continuation === null) throw new Error("Expected a keyed continuation.");
    const { continuation: _opaqueContinuation, explainCapability: _explainCapability,
      resultSha256: _resultSha256, ...deterministicResultIdentity } = keyed;
    expect(canonicalSha256(deterministicResultIdentity)).toBe(keyed.resultSha256);

    const otherKeyAgent = await value.createAgent(new Uint8Array(32).fill(4));
    const otherKey = await otherKeyAgent.query(request);
    expect(otherKey.continuation).not.toBe(keyed.continuation);
    expect(otherKey.continuationSha256).toBe(keyed.continuationSha256);
    expect(otherKey.resultSha256).toBe(keyed.resultSha256);
    await expect(otherKeyAgent.query({ ...request, continuation: keyed.continuation }))
      .rejects.toThrow(OhMemoryContinuationError);

    const reconstructed = await value.createAgent(persistedHostKey);
    const resumed = await reconstructed.query({ ...request, continuation: keyed.continuation });
    expect(resumed.page.start).toBe(64);

    const localOne = await value.createAgent();
    const localFirst = await localOne.query(request);
    if (localFirst.continuation === null) throw new Error("Expected a local continuation.");
    const localTwo = await value.createAgent();
    await expect(localTwo.query({ ...request, continuation: localFirst.continuation }))
      .rejects.toThrow(OhMemoryContinuationError);
    await expect(value.createAgent(new Uint8Array(
      OH_MEMORY_QUERY_LIMITS_V2.continuationKeyMinimumBytes - 1)))
      .rejects.toThrow("32 through 64 raw bytes");
    await expect(value.createAgent(new Uint8Array(
      OH_MEMORY_QUERY_LIMITS_V2.continuationKeyMaximumBytes + 1)))
      .rejects.toThrow("32 through 64 raw bytes");
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("authenticates and statically binds cursors before working reads or extraction", async () => {
    const counter = { extractorInvocations: 0, workingReads: 0 };
    const key = new Uint8Array(32).fill(5);
    const value = await fixtureV2(400, 64, 8 * 1024 * 1024, {
      continuationKey: key,
      extractorInvoked: () => { counter.extractorInvocations += 1; },
      wrapWorkingStore: (store) => countedWorkingStore(store, {
        get reads() { return counter.workingReads; },
        set reads(value) { counter.workingReads = value; },
      }),
    });
    const request = { bindings: { key: "entity:chunked", lane: "canonical" },
      continuation: null, programId: "memory.value-chunks", v: 2 as const };
    const first = await value.agent.query(request);
    if (first.continuation === null) throw new Error("Expected an issued continuation.");
    counter.extractorInvocations = 0;
    counter.workingReads = 0;

    let encodingFailure: unknown;
    try { await value.agent.query({ ...request, continuation: "!" }); }
    catch (error) { encodingFailure = error; }
    expect(encodingFailure).toBeInstanceOf(OhMemoryContinuationError);
    expect(encodingFailure).toMatchObject({ code: "memory-continuation", reason: "encoding" });
    expect(Object.getOwnPropertyDescriptor(encodingFailure, "reason")?.writable).toBe(false);
    const invalidMacPayload = JSON.parse(
      Buffer.from(first.continuation, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    invalidMacPayload.continuationHmacSha256 = invalidMacPayload.continuationHmacSha256
      === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64);
    const invalidMac = Buffer.from(canonicalJson(invalidMacPayload), "utf8").toString("base64url");
    await expect(value.agent.query({ ...request, continuation: invalidMac }))
      .rejects.toMatchObject({ code: "memory-continuation", reason: "authentication" });
    await expect(value.agent.query({ ...request, continuation: first.continuation,
      programId: "memory.value-chunks-alternate" }))
      .rejects.toMatchObject({ code: "memory-continuation", reason: "identity" });
    await expect(value.agent.query({ ...request,
      bindings: { key: "entity:other", lane: "canonical" },
      continuation: first.continuation }))
      .rejects.toThrow(OhMemoryContinuationError);
    expect(counter).toEqual({ extractorInvocations: 0, workingReads: 0 });
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("does not relabel store failures as continuation failures", async () => {
    let failWorkingRead = false;
    const value = await fixtureV2(8, 2, 8 * 1024 * 1024, {
      chunkCount: 8,
      continuationKey: new Uint8Array(32).fill(6),
      wrapWorkingStore: (store) => new Proxy(store, {
        get(target, property) {
          const member = Reflect.get(target, property, target) as unknown;
          if (property === "head") return async () => {
            if (failWorkingRead) throw new OhIntegrityError("The working store failed verification.");
            return await target.head();
          };
          return typeof member === "function"
            ? (...args: unknown[]) => Reflect.apply(member, target, args)
            : member;
        },
      }) as OhStoreV1,
    });
    const request = { bindings: { key: "entity:chunked", lane: "canonical" },
      continuation: null, programId: "memory.value-chunks", v: 2 as const };
    const first = await value.agent.query(request);
    if (first.continuation === null) throw new Error("Expected an issued continuation.");
    failWorkingRead = true;
    let thrown: unknown;
    try { await value.agent.query({ ...request, continuation: first.continuation }); }
    catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(OhIntegrityError);
    expect(thrown).not.toBeInstanceOf(OhMemoryContinuationError);
    expect(thrown).toHaveProperty("message", "The working store failed verification.");
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("bounds and flattens V2 query input before canonical serialization", async () => {
    const value = await fixtureV2();
    const base = { continuation: null, programId: "memory.value-chunks", v: 2 as const };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(value.agent.query({ ...base,
      bindings: { key: "entity:chunked", lane: cyclic } }))
      .rejects.toThrow("JSON primitives");
    await expect(value.agent.query({ ...base,
      bindings: { key: "entity:chunked", lane: "x".repeat(16 * 1024 + 1) } }))
      .rejects.toThrow("atom byte bound");
    await expect(value.agent.query({ ...base, bindings: Object.fromEntries(
      Array.from({ length: OH_MEMORY_QUERY_LIMITS_V2.bindings + 1 }, (_, index) =>
        [`p${index}`, index]),
    ) })).rejects.toThrow("too many entries");
    await expect(value.agent.query({ ...base, bindings: Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [`p${index}`, "x".repeat(14 * 1024)]),
    ) })).rejects.toThrow("canonical byte bound");
    await expect(value.agent.query({ ...base, bindings: {},
      continuation: "A".repeat(OH_MEMORY_QUERY_LIMITS_V2.continuationBytes + 1) }))
      .rejects.toThrow(OhMemoryContinuationError);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("fails closed instead of returning a silently row- or byte-truncated page", async () => {
    const rowBound = await fixtureV2(256, 64);
    await expect(rowBound.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: null, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow("projection was truncated (query-limit)");
    await rowBound.canonical.store.close(); await rowBound.working.store.close();

    const byteBound = await fixtureV2(400, 64, 64 * 1024);
    await expect(byteBound.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: null, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow("projection was truncated (result-bytes)");
    await byteBound.canonical.store.close(); await byteBound.working.store.close();

    const pageBound = await fixtureV2(400, 64, 8 * 1024 * 1024,
      { chunkBytes: 2_048, maximumPageBytes: 64 * 1024 });
    await expect(pageBound.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: null, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow("page exceeds its host-declared canonical byte bound");
    const recovered = await pageBound.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: null, programId: "memory.value-chunks-alternate", v: 2 });
    const explanation = await pageBound.agent.explain({ pageRow: 0,
      resultSha256: recovered.resultSha256, token: recovered.explainCapability.token, v: 2 });
    expect(explanation.values).toEqual(recovered.rows[0]!.values);
    await pageBound.canonical.store.close(); await pageBound.working.store.close();
  });

  test("reports zero and exact-page results as complete without a continuation", async () => {
    const value = await fixtureV2(400, 64, 8 * 1024 * 1024, { chunkCount: 64 });
    const zero = await value.agent.query({ bindings: {
      key: "entity:absent", lane: "canonical",
    }, continuation: null, programId: "memory.value-chunks", v: 2 });
    expect(zero.rows).toEqual([]);
    expect(zero.page).toMatchObject({ completeness: "complete", endExclusive: 0,
      hasMore: false, returnedRows: 0, start: 0, totalRows: 0 });
    expect(zero.continuation).toBeNull();
    expect(zero.continuationSha256).toBeNull();

    const exact = await value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: null, programId: "memory.value-chunks", v: 2 });
    expect(exact.rows).toHaveLength(64);
    expect(exact.page).toMatchObject({ completeness: "complete", endExclusive: 64,
      hasMore: false, returnedRows: 64, start: 0, totalRows: 64 });
    expect(exact.continuation).toBeNull();
    expect(exact.continuationSha256).toBeNull();
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("accepts only exact primitive bindings and rejects caller-supplied query policy", async () => {
    const value = await fixtureV2();
    await expect(value.agent.query({ bindings: { key: "entity:chunked" }, continuation: null,
      programId: "memory.value-chunks", v: 2 })).rejects.toThrow("exactly match");
    await expect(value.agent.query({ bindings: { key: "entity:chunked", lane: { value: "canonical" } },
      continuation: null, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow("JSON primitives");
    await expect(value.agent.query({ bindings: { key: "entity:chunked", lane: "canonical" },
      continuation: null, programId: "memory.value-chunks", query: {}, v: 2 }))
      .rejects.toThrow("Invalid parameterized memory query");
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("rejects a V2 remember that would exceed working byte capacity before CAS", async () => {
    const largeName = "x".repeat(875_000);
    const snapshot = staticSnapshot(Array.from({ length: 38 }, (_, index) =>
      entity(`entity:v2-capacity-${index.toString().padStart(2, "0")}`, largeName)));
    expect(Buffer.byteLength(canonicalJson(snapshot), "utf8"))
      .toBeLessThanOrEqual(OH_MEMORY_LIMITS_V1.snapshotBytesPerLane);
    const counter = { commits: 0 };
    const value = await fixtureV2(400, 64, 8 * 1024 * 1024, {
      wrapWorkingStore: (store) => saturatedWorkingStore(store, snapshot, counter),
    });
    await expect(value.agent.remember({ expectedHead: {
      generation: snapshot.head.generation,
      operationSha256: snapshot.head.operationSha256,
    }, puts: [{ dependencies: [], key: "entity:v2-capacity-extra", kind: "entity", v: 1,
      value: { name: largeName } }], requestId: "v2-capacity-extra", tombstones: [], v: 1 }))
      .rejects.toThrow("working memory would exceed its snapshot byte bound");
    expect(counter.commits).toBe(0);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("lets the V2 store resolve an exact stale replay after a later write", async () => {
    const state = { rejectSnapshots: false, snapshotReads: 0 };
    const value = await fixtureV2(400, 64, 8 * 1024 * 1024, {
      wrapWorkingStore: (store) => replayProbeWorkingStore(store, state),
    });
    const initialHead = await value.working.store.head();
    const request = { expectedHead: { generation: initialHead.generation,
      operationSha256: initialHead.operationSha256 }, puts: [{ dependencies: [],
      key: "entity:v2-replay", kind: "entity", v: 1, value: { name: "Replay" } }],
    requestId: "v2-exact-replay", tombstones: [], v: 1 } as const;
    const receipt = await value.agent.remember(request);
    await put(value.working.store, "entity:v2-later", "Later", "v2_later_write");
    const snapshotReads = state.snapshotReads;
    state.rejectSnapshots = true;
    expect(await value.agent.remember(request)).toEqual(receipt);
    expect(state.snapshotReads).toBe(snapshotReads);
    await value.canonical.store.close(); await value.working.store.close();
  });
});

describe("stable host-bound Oh memory authority", () => {
  test("strictly parses prepared nominations and separates agent and host authority", async () => {
    const value = await authorityFixture();
    expect(Object.keys(value.authority).sort()).toEqual(["agent", "host"]);
    expect(Object.keys(value.authority.agent).sort()).toEqual(["explain", "nominate", "query", "remember"]);
    expect(Object.keys(value.authority.host).sort()).toEqual(["adoptNomination", "advanceCanonical"]);
    expect("host" in value.authority.agent).toBe(false);

    const workingHead = await value.working.store.head();
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:candidate", kind: "entity", v: 1,
        value: { name: "Candidate" } }], requestId: "remember_candidate",
      tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:candidate"], v: 1 });
    expect(parseOhMemoryNominationV1(nomination)).toEqual(nomination);
    expect(parseOhMemoryNominationV1({ ...nomination, extra: true })).toBeNull();
    expect(parseOhMemoryNominationV1({ ...nomination,
      nominationSha256: "f".repeat(64) })).toBeNull();
    expect(parseOhMemoryNominationV1({ ...nomination,
      source: { ...nomination.source, bindingSha256: "f".repeat(64) } })).toBeNull();
    expect(Object.isFrozen(parseOhMemoryNominationV1(nomination)?.closure.records)).toBe(true);
    await expect(value.authority.host.adoptNomination({
      expectedCanonicalHead: value.initialCanonicalHead, extra: true, nomination, v: 1 }))
      .rejects.toThrow("Invalid memory adoption request");
    await expect(value.authority.host.advanceCanonical({
      expectedHead: value.initialCanonicalHead, extra: true,
      nextHead: value.initialCanonicalHead, v: 1 }))
      .rejects.toThrow("Invalid canonical memory advance request");
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("descriptor-detaches stable unknown inputs and never executes accessors or proxies", async () => {
    const value = await authorityFixture();
    const workingHead = await value.working.store.head();
    let accessorReads = 0;
    const hostilePut = { dependencies: [], key: "entity:hostile", kind: "entity", v: 1 } as
      Record<PropertyKey, unknown>;
    Object.defineProperty(hostilePut, "value", { enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); } });
    await expect(value.authority.agent.remember({
      expectedHead: { generation: workingHead.generation,
        operationSha256: workingHead.operationSha256 },
      puts: [hostilePut], requestId: "remember_accessor", tombstones: [], v: 1,
    })).rejects.toThrow("non-data property");
    expect(accessorReads).toBe(0);
    expect(await value.working.store.head()).toEqual(workingHead);

    let proxyDescriptorReads = 0;
    const proxyBundle = new Proxy({
      expectedHead: { generation: workingHead.generation,
        operationSha256: workingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:proxy", kind: "entity", v: 1,
        value: { name: "Proxy" } }], requestId: "remember_proxy", tombstones: [], v: 1,
    }, { getOwnPropertyDescriptor(target, property) {
      proxyDescriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    } });
    await expect(value.authority.agent.remember(proxyBundle)).rejects.toThrow("contains a proxy");
    expect(proxyDescriptorReads).toBe(0);
    expect(await value.working.store.head()).toEqual(workingHead);

    const hostileBindings = new Proxy({}, {});
    await expect(value.authority.agent.query({ bindings: hostileBindings, continuation: null,
      programId: "memory.visible-records", v: 2 })).rejects.toThrow("JSON primitives");
    const explainPromise = value.authority.agent.explain(new Proxy({}, {}));
    expect(explainPromise).toBeInstanceOf(Promise);
    await expect(explainPromise).rejects.toThrow("contains a proxy");

    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:valid", kind: "entity", v: 1,
        value: { name: "Valid" } }], requestId: "remember_valid_after_hostile",
      tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:valid"], v: 1 });
    const hostileNomination = { ...nomination } as Record<PropertyKey, unknown>;
    Object.defineProperty(hostileNomination, "source", { enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); } });
    expect(parseOhMemoryNominationV1(hostileNomination)).toBeNull();
    expect(accessorReads).toBe(0);
    const hostileAdoption = { expectedCanonicalHead: value.initialCanonicalHead, v: 1 } as
      Record<PropertyKey, unknown>;
    Object.defineProperty(hostileAdoption, "nomination", { enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); } });
    const adoptionPromise = value.authority.host.adoptNomination(hostileAdoption);
    expect(adoptionPromise).toBeInstanceOf(Promise);
    await expect(adoptionPromise).rejects.toThrow("non-data property");
    expect(accessorReads).toBe(0);
    const priorRecord = (await value.canonical.store.snapshot()).records[0]!;
    const hostileReplacement = { key: priorRecord.key, v: 1 } as Record<PropertyKey, unknown>;
    Object.defineProperty(hostileReplacement, "expectedPriorRecordSha256", { enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); } });
    await expect(value.authority.host.adoptNomination({
      expectedCanonicalHead: value.initialCanonicalHead, nomination,
      replacements: [hostileReplacement], v: 1,
    })).rejects.toThrow("non-data property");
    expect(accessorReads).toBe(0);
    expect(await value.canonical.store.head()).toEqual(value.initialCanonicalHead);
    let deeplyNested: unknown = "f".repeat(64);
    for (let depth = 0; depth <= OH_MEMORY_LIMITS_V1.detachedCanonicalDepth; depth += 1) {
      deeplyNested = { value: deeplyNested };
    }
    await expect(value.authority.host.adoptNomination({
      expectedCanonicalHead: value.initialCanonicalHead, nomination,
      replacements: [{ expectedPriorRecordSha256: deeplyNested,
        key: priorRecord.key, v: 1 }], v: 1,
    })).rejects.toThrow("canonical nesting depth bound");
    const tooBroad = new Array(OH_MEMORY_LIMITS_V1.detachedCanonicalBreadth + 1);
    await expect(value.authority.host.adoptNomination({
      expectedCanonicalHead: value.initialCanonicalHead, nomination,
      replacements: tooBroad, v: 1,
    })).rejects.toThrow("canonical breadth bound");
    expect(await value.canonical.store.head()).toEqual(value.initialCanonicalHead);
    const symbolAdvance = { expectedHead: value.initialCanonicalHead,
      nextHead: value.initialCanonicalHead, v: 1 } as Record<PropertyKey, unknown>;
    symbolAdvance[Symbol("extra")] = true;
    await expect(value.authority.host.advanceCanonical(symbolAdvance))
      .rejects.toThrow("symbol property");
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("adopts a re-exported closure once and makes a concurrent replay already present", async () => {
    const value = await authorityFixture();
    const workingHead = await value.working.store.head();
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:parent", kind: "entity", v: 1,
        value: { name: "Parent" } }, { dependencies: ["entity:parent"],
        key: "entity:child", kind: "entity", v: 1, value: { name: "Child" } }],
      requestId: "remember_adoption_closure", tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:child"], v: 1 });
    const request = { expectedCanonicalHead: value.initialCanonicalHead, nomination, v: 1 } as const;
    const [first, second] = await Promise.all([
      value.authority.host.adoptNomination(request),
      value.authority.host.adoptNomination(request),
    ]);
    expect([first.status, second.status]).toEqual(["adopted", "already-present"]);
    expect(first.actorId).toBe("test.memory-reviewer");
    expect(first.operationSha256).not.toBeNull();
    expect(second.operationSha256).toBeNull();
    expect(Object.isFrozen(first.head)).toBe(true);
    expect(first.receiptSha256).toBe(canonicalSha256({ actorId: first.actorId,
      authorityId: first.authorityId, bindingSha256: first.bindingSha256, head: first.head,
      nominationSha256: first.nominationSha256, operationSha256: first.operationSha256,
      priorHead: first.priorHead, status: first.status, v: 1 }));
    const canonical = await value.canonical.store.snapshot();
    expect(canonical.records.map(({ key }) => key)).toEqual([
      "entity:canonical", "entity:child", "entity:parent",
    ]);
    const visible = await value.authority.agent.query({ bindings: {}, continuation: null,
      programId: "memory.visible-records", v: 2 });
    expect(visible.identity.canonical.head).toEqual(first.head);
    expect(visible.rows.some(({ values }) => values[0] === "canonical"
      && values[1] === "entity:child")).toBe(true);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("replaces canonical records only with exact host-supplied prior digests", async () => {
    const original = entity("entity:canonical", "Canonical");
    const equal = entity("entity:equal", "Already equal");
    const value = await authorityFixture({ canonicalRecords: [original, equal] });
    const workingHead = await value.working.store.head();
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 }, puts: [{ dependencies: [],
      key: original.key, kind: "entity", v: 1, value: { name: "Reviewed replacement" } },
    { dependencies: [], key: equal.key, kind: "entity", v: 1,
      value: { name: "Already equal" } },
    { dependencies: [], key: "entity:new", kind: "entity", v: 1,
      value: { name: "New alongside replacement" } }], requestId: "remember_replacement",
    tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: [original.key, equal.key, "entity:new"], v: 1 });
    const request = { expectedCanonicalHead: value.initialCanonicalHead, nomination,
      replacements: [{ expectedPriorRecordSha256: original.recordSha256,
        key: original.key, v: 1 }], v: 1 } as const;

    const bogusEqualClaim = canonicalSha256({ kind: "test.bogus-equal-prior", v: 1 });
    await expect(value.authority.host.adoptNomination({ ...request, replacements: [
      ...request.replacements,
      { expectedPriorRecordSha256: bogusEqualClaim, key: equal.key, v: 1 as const },
    ] })).rejects.toMatchObject({ conflict: { conflicts: [{
      canonicalRecordSha256: equal.recordSha256, key: equal.key,
      nominatedRecordSha256: equal.recordSha256, v: 1,
    }] } });
    expect(await value.canonical.store.head()).toEqual(value.initialCanonicalHead);
    expect((await value.canonical.store.snapshot()).records.map(({ key }) => key))
      .toEqual(["entity:canonical", "entity:equal"]);

    const adopted = await value.authority.host.adoptNomination(request);
    expect(adopted.status).toBe("adopted");
    expect(adopted.priorHead).toEqual(value.initialCanonicalHead);
    const snapshot = await value.canonical.store.snapshot();
    expect(snapshot.records.map(({ key }) => key)).toEqual([
      "entity:canonical", "entity:equal", "entity:new",
    ]);
    expect(snapshot.records.find(({ key }) => key === original.key)?.recordSha256)
      .toBe(nomination.closure.records.find(({ key }) => key === original.key)?.recordSha256);
    const page = await value.canonical.store.changesSince({
      operationSha256: value.initialCanonicalHead.operationSha256,
      sequence: value.initialCanonicalHead.sequence,
    }, { through: adopted.head });
    expect(page.operations).toHaveLength(1);
    expect(page.operations[0]?.operationId).toBe(`memory_adopt_${canonicalSha256({
      actorId: "test.memory-reviewer",
      bindingSha256: value.canonical.store.binding.bindingSha256,
      nominationSha256: nomination.nominationSha256,
      priorHead: value.initialCanonicalHead,
      v: 1,
    }).slice(0, 48)}`);
    expect(page.operations[0]?.changes.map((change) => change.kind === "put"
      ? change.record.key : change.key)).toEqual(["entity:canonical", "entity:new"]);

    const replay = await value.authority.host.adoptNomination(request);
    expect(replay.status).toBe("already-present");
    expect(replay.operationSha256).toBeNull();
    expect(replay.head).toEqual(adopted.head);
    expect(await value.canonical.store.head()).toEqual(adopted.head);
    await expect(value.authority.host.adoptNomination({ ...request, replacements: [
      ...request.replacements,
      { expectedPriorRecordSha256: bogusEqualClaim, key: equal.key, v: 1 as const },
    ] })).rejects.toMatchObject({ conflict: { conflicts: [{
      canonicalRecordSha256: equal.recordSha256, key: equal.key,
      nominatedRecordSha256: equal.recordSha256, v: 1,
    }] } });
    expect(await value.canonical.store.head()).toEqual(adopted.head);

    await value.canonical.store.commit({ actorId: "test.canonical-reviser",
      changes: [{ kind: "put", record: original, v: 1 }], expectedHead: adopted.head,
      operationId: "op_restore_prior_canonical" });
    const restoredHead = await value.canonical.store.head();
    await value.authority.host.advanceCanonical({ expectedHead: adopted.head,
      nextHead: restoredHead, v: 1 });
    const readopted = await value.authority.host.adoptNomination({ ...request,
      expectedCanonicalHead: restoredHead });
    expect(readopted.status).toBe("adopted");
    expect(readopted.operationSha256).not.toBe(adopted.operationSha256);
    expect((await value.canonical.store.snapshot()).records
      .find(({ key }) => key === original.key)?.recordSha256)
      .toBe(nomination.closure.records.find(({ key }) => key === original.key)?.recordSha256);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("fails a replacement batch atomically when any prior digest is absent or wrong", async () => {
    const originals = [entity("entity:first-replacement", "First canonical"),
      entity("entity:second-replacement", "Second canonical")];
    const value = await authorityFixture({ canonicalRecords: originals });
    const workingHead = await value.working.store.head();
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 }, puts: [
      { dependencies: [], key: originals[0]!.key, kind: "entity", v: 1,
        value: { name: "First replacement" } },
      { dependencies: [], key: originals[1]!.key, kind: "entity", v: 1,
        value: { name: "Second replacement" } },
      { dependencies: [], key: "entity:would-be-added", kind: "entity", v: 1,
        value: { name: "New record" } },
    ], requestId: "remember_atomic_replacements", tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: [originals[0]!.key, originals[1]!.key, "entity:would-be-added"], v: 1 });
    const wrongDigest = canonicalSha256({ kind: "test.wrong-prior-record", v: 1 });
    let thrown: unknown;
    try {
      await value.authority.host.adoptNomination({
        expectedCanonicalHead: value.initialCanonicalHead, nomination, replacements: [
          { expectedPriorRecordSha256: originals[0]!.recordSha256,
            key: originals[0]!.key, v: 1 },
          { expectedPriorRecordSha256: wrongDigest, key: originals[1]!.key, v: 1 },
        ], v: 1,
      });
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(OhMemoryAdoptionConflictError);
    expect((thrown as OhMemoryAdoptionConflictError).conflict.conflicts).toEqual([{
      canonicalRecordSha256: originals[1]!.recordSha256,
      key: originals[1]!.key,
      nominatedRecordSha256: nomination.closure.records
        .find(({ key }) => key === originals[1]!.key)!.recordSha256,
      v: 1,
    }]);
    expect(await value.canonical.store.head()).toEqual(value.initialCanonicalHead);
    expect((await value.canonical.store.snapshot()).records).toEqual(originals);

    const absent = nomination.closure.records.find(({ key }) => key === "entity:would-be-added")!;
    await expect(value.authority.host.adoptNomination({
      expectedCanonicalHead: value.initialCanonicalHead, nomination,
      replacements: [
        { expectedPriorRecordSha256: originals[0]!.recordSha256,
          key: originals[0]!.key, v: 1 },
        { expectedPriorRecordSha256: originals[1]!.recordSha256,
          key: originals[1]!.key, v: 1 },
        { expectedPriorRecordSha256: wrongDigest, key: absent.key, v: 1 },
      ], v: 1,
    })).rejects.toMatchObject({ conflict: { conflicts: [{
      canonicalRecordSha256: null, key: absent.key,
      nominatedRecordSha256: absent.recordSha256, v: 1,
    }] } });
    expect(await value.canonical.store.head()).toEqual(value.initialCanonicalHead);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("rejects stale replacement proof and bounds exact replacement claims", async () => {
    const original = entity("entity:canonical", "Canonical");
    const value = await authorityFixture({ canonicalRecords: [original] });
    const workingHead = await value.working.store.head();
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 }, puts: [{ dependencies: [], key: original.key,
      kind: "entity", v: 1, value: { name: "Nominated replacement" } }],
    requestId: "remember_stale_replacement", tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: [original.key], v: 1 });
    const current = entity(original.key, "Newer canonical");
    await value.canonical.store.commit({ actorId: "test.canonical-writer",
      changes: [{ kind: "put", record: current, v: 1 }],
      expectedHead: value.initialCanonicalHead, operationId: "op_newer_canonical" });
    const currentHead = await value.canonical.store.head();
    await value.authority.host.advanceCanonical({ expectedHead: value.initialCanonicalHead,
      nextHead: currentHead, v: 1 });
    await expect(value.authority.host.adoptNomination({ expectedCanonicalHead: currentHead,
      nomination, replacements: [{ expectedPriorRecordSha256: original.recordSha256,
        key: original.key, v: 1 }], v: 1 })).rejects.toMatchObject({ conflict: {
      actualHead: currentHead, conflicts: [{ canonicalRecordSha256: current.recordSha256,
        key: original.key, v: 1 }],
    } });
    await expect(value.authority.host.adoptNomination({
      expectedCanonicalHead: value.initialCanonicalHead, nomination,
      replacements: [{ expectedPriorRecordSha256: current.recordSha256,
        key: original.key, v: 1 }], v: 1,
    })).rejects.toMatchObject({ conflict: {
      actualHead: currentHead, expectedHead: value.initialCanonicalHead,
    } });
    expect(await value.canonical.store.head()).toEqual(currentHead);

    const tooMany = Array.from({ length: OH_MEMORY_AUTHORITY_LIMITS_V1.adoptionReplacements + 1 },
      () => ({ expectedPriorRecordSha256: current.recordSha256, key: original.key, v: 1 }));
    await expect(value.authority.host.adoptNomination({ expectedCanonicalHead: currentHead,
      nomination, replacements: tooMany, v: 1 })).rejects
      .toThrow("Invalid memory adoption replacements");
    await expect(value.authority.host.adoptNomination({ expectedCanonicalHead: currentHead,
      nomination, replacements: [
        { expectedPriorRecordSha256: current.recordSha256, key: original.key, v: 1 },
        { expectedPriorRecordSha256: current.recordSha256, key: original.key, v: 1 },
      ], v: 1 })).rejects.toThrow("replacement keys must be unique");
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("aborts adoption atomically with bounded, complete conflict evidence", async () => {
    const count = OH_MEMORY_AUTHORITY_LIMITS_V1.reportedAdoptionConflicts + 2;
    const canonicalRecords = Array.from({ length: count }, (_, index) =>
      entity(`entity:conflict-${index.toString().padStart(3, "0")}`, `Canonical ${index}`));
    const value = await authorityFixture({ canonicalRecords });
    const workingHead = await value.working.store.head();
    const puts = canonicalRecords.map((record, index) => ({ dependencies: [], key: record.key,
      kind: "entity" as const, v: 1 as const, value: { name: `Working ${index}` } }));
    puts.push({ dependencies: [], key: "entity:would-be-inserted", kind: "entity", v: 1,
      value: { name: "Absent" } });
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 }, puts,
      requestId: "remember_conflicts", tombstones: [], v: 1 });
    const roots = puts.map(({ key }) => key);
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review", roots, v: 1 });
    let thrown: unknown;
    try {
      await value.authority.host.adoptNomination({
        expectedCanonicalHead: value.initialCanonicalHead, nomination, v: 1 });
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(OhMemoryAdoptionConflictError);
    const conflict = (thrown as OhMemoryAdoptionConflictError).conflict;
    expect(conflict.totalConflicts).toBe(count);
    expect(conflict.reportedConflicts).toBe(OH_MEMORY_AUTHORITY_LIMITS_V1.reportedAdoptionConflicts);
    expect(conflict.truncated).toBe(true);
    expect(conflict.conflicts.map(({ key }) => key)).toEqual(canonicalRecords
      .slice(0, OH_MEMORY_AUTHORITY_LIMITS_V1.reportedAdoptionConflicts).map(({ key }) => key));
    const nominatedByKey = new Map(nomination.closure.records.map((record) => [record.key, record]));
    const complete = canonicalRecords.map((record) => ({
      canonicalRecordSha256: record.recordSha256,
      key: record.key,
      nominatedRecordSha256: nominatedByKey.get(record.key)!.recordSha256,
      v: 1 as const,
    }));
    expect(conflict.conflictsSha256).toBe(canonicalSha256({ conflicts: complete, v: 1 }));
    expect(Object.isFrozen(conflict.conflicts)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(thrown, "conflict")?.writable).toBe(false);
    expect((await value.canonical.store.snapshot()).records
      .some(({ key }) => key === "entity:would-be-inserted")).toBe(false);
    expect(await value.canonical.store.head()).toEqual(value.initialCanonicalHead);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("reconciles a duplicate adoption against the later physical head", async () => {
    const value = await authorityFixture();
    let returnPinnedHeadOnce = true;
    const laggingStore = new Proxy(value.canonical.store, {
      get(target, property) {
        const member = Reflect.get(target, property, target) as unknown;
        if (property === "head") {
          return async () => {
            if (returnPinnedHeadOnce) {
              returnPinnedHeadOnce = false;
              return value.initialCanonicalHead;
            }
            return await target.head();
          };
        }
        return typeof member === "function"
          ? (...args: unknown[]) => Reflect.apply(member, target, args)
          : member;
      },
    }) as OhStoreV1;
    const replaying = await createOhMemoryAuthorityV1({
      actorId: "test.memory-agent", adoptionActorId: "test.memory-reviewer",
      canonical: { authorityId: "authority.canonical",
        expectedBindingSha256: laggingStore.binding.bindingSha256,
        expectedHead: value.initialCanonicalHead, store: laggingStore },
      continuationKey: Uint8Array.from({ length: 32 }, (_, index) => index),
      nominationRoutes: [{ destinationPurpose: "kb.review", nominationId: "kb.review" }],
      programs: [stableVisibleProgram()],
      working: { authorityId: "authority.working", codecs: entityCodecs(),
        expectedBindingSha256: value.working.store.binding.bindingSha256,
        store: value.working.store },
    });
    const workingHead = await value.working.store.head();
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:replayed", kind: "entity", v: 1,
        value: { name: "Nominated" } }], requestId: "remember_replayed",
      tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:replayed"], v: 1 });
    const adopted = await value.authority.host.adoptNomination({
      expectedCanonicalHead: value.initialCanonicalHead, nomination, v: 1 });
    const overwrittenRecord = entity("entity:replayed", "Overwritten");
    await value.canonical.store.commit({ actorId: "test.overwriter",
      changes: [{ kind: "put", record: overwrittenRecord, v: 1 }],
      expectedHead: adopted.head, operationId: "op_overwrite_adopted_memory" });
    const physicalHead = await value.canonical.store.head();
    let thrown: unknown;
    try {
      await replaying.host.adoptNomination({ expectedCanonicalHead: value.initialCanonicalHead,
        nomination, v: 1 });
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(OhMemoryAdoptionConflictError);
    expect((thrown as OhMemoryAdoptionConflictError).conflict.actualHead).toEqual(physicalHead);
    expect((thrown as OhMemoryAdoptionConflictError).conflict.conflicts[0]).toMatchObject({
      canonicalRecordSha256: overwrittenRecord.recordSha256,
      key: "entity:replayed",
      nominatedRecordSha256: nomination.closure.records[0]!.recordSha256,
    });
    const stillPinned = await replaying.agent.query({ bindings: {}, continuation: null,
      programId: "memory.visible-records", v: 2 });
    expect(stillPinned.identity.canonical.head).toEqual(value.initialCanonicalHead);
    expect(stillPinned.identity.canonical.head).not.toEqual(adopted.head);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("rejects a nomination when the working authority cannot reproduce its exact bytes", async () => {
    const value = await authorityFixture();
    const workingHead = await value.working.store.head();
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:first", kind: "entity", v: 1,
        value: { name: "First" } }, { dependencies: [], key: "entity:second",
        kind: "entity", v: 1, value: { name: "Second" } }],
      requestId: "remember_reexport", tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:first"], v: 1 });
    const sourceHead = await value.working.store.head();
    const substitute = await value.working.store.exportDependencyClosure({ head: sourceHead,
      roots: ["entity:second"] });
    (value.working.store as unknown as { exportDependencyClosure: () => Promise<typeof substitute> })
      .exportDependencyClosure = async () => substitute;
    await expect(value.authority.host.adoptNomination({
      expectedCanonicalHead: value.initialCanonicalHead, nomination, v: 1 }))
      .rejects.toThrow("did not re-export the nominated closure exactly");
    expect(await value.canonical.store.head()).toEqual(value.initialCanonicalHead);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("performs one adoption CAS and reports a racing canonical write without retrying", async () => {
    const value = await authorityFixture();
    const workingHead = await value.working.store.head();
    await value.authority.agent.remember({ expectedHead: { generation: workingHead.generation,
      operationSha256: workingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:raced-candidate", kind: "entity", v: 1,
        value: { name: "Candidate" } }], requestId: "remember_raced_candidate",
      tombstones: [], v: 1 });
    const nomination = await value.authority.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:raced-candidate"], v: 1 });
    const originalCommit = value.canonical.store.commit.bind(value.canonical.store);
    let authorityCommitCalls = 0;
    value.canonical.store.commit = async (input) => {
      authorityCommitCalls += 1;
      await originalCommit({ actorId: "test.competing-writer",
        changes: [{ kind: "put", record: entity("entity:competing", "Competing"), v: 1 }],
        expectedHead: input.expectedHead, operationId: "op_competing_write" });
      return await originalCommit(input);
    };
    let thrown: unknown;
    try {
      await value.authority.host.adoptNomination({
        expectedCanonicalHead: value.initialCanonicalHead, nomination, v: 1 });
    } catch (error) { thrown = error; }
    expect(authorityCommitCalls).toBe(1);
    expect(thrown).toBeInstanceOf(OhMemoryAdoptionConflictError);
    expect((thrown as OhMemoryAdoptionConflictError).conflict.conflicts).toEqual([{
      canonicalRecordSha256: null,
      key: "entity:raced-candidate",
      nominatedRecordSha256: nomination.closure.records[0]!.recordSha256,
      v: 1,
    }]);
    const snapshot = await value.canonical.store.snapshot();
    expect(snapshot.records.map(({ key }) => key)).toEqual(["entity:canonical", "entity:competing"]);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("captures the old canonical pin for in-flight queries and retains their explanations", async () => {
    let shouldBlock = false;
    let releaseSnapshot!: () => void;
    let enteredSnapshot!: () => void;
    const released = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    const entered = new Promise<void>((resolve) => { enteredSnapshot = resolve; });
    const wrapWorkingStore = (store: OhStoreV1): OhStoreV1 => new Proxy(store, {
      get(target, property) {
        const member = Reflect.get(target, property, target) as unknown;
        if (typeof member !== "function") return member;
        if (property !== "snapshot") {
          return (...args: unknown[]) => Reflect.apply(member, target, args);
        }
        return async (...args: unknown[]) => {
          if (shouldBlock) {
            shouldBlock = false;
            enteredSnapshot();
            await released;
          }
          return await Reflect.apply(member, target, args);
        };
      },
    }) as OhStoreV1;
    const value = await authorityFixture({ canonicalRecords: [
      entity("entity:first", "First"), entity("entity:second", "Second"),
    ], pageSize: 1, workingStore: wrapWorkingStore });
    shouldBlock = true;
    const pending = value.authority.agent.query({ bindings: {}, continuation: null,
      programId: "memory.visible-records", v: 2 });
    await entered;
    await value.canonical.store.commit({ actorId: "test.canonical-writer",
      changes: [{ kind: "put", record: entity("entity:third", "Third"), v: 1 }],
      expectedHead: value.initialCanonicalHead, operationId: "op_canonical_rollover" });
    const nextHead = await value.canonical.store.head();
    const advance = await value.authority.host.advanceCanonical({
      expectedHead: value.initialCanonicalHead, nextHead, v: 1 });
    expect(advance.status).toBe("advanced");
    releaseSnapshot();
    const oldPage = await pending;
    expect(oldPage.identity.canonical.head).toEqual(value.initialCanonicalHead);
    const explanation = await value.authority.agent.explain({ pageRow: 0,
      resultSha256: oldPage.resultSha256, token: oldPage.explainCapability.token, v: 2 });
    expect(explanation.resultSha256).toBe(oldPage.resultSha256);
    await expect(value.authority.agent.query({ bindings: {},
      continuation: oldPage.continuation, programId: "memory.visible-records", v: 2 }))
      .rejects.toThrow("does not match this exact source and projection identity");
    const newPage = await value.authority.agent.query({ bindings: {}, continuation: null,
      programId: "memory.visible-records", v: 2 });
    expect(newPage.identity.canonical.head).toEqual(nextHead);
    const unchanged = await value.authority.host.advanceCanonical({
      expectedHead: nextHead, nextHead, v: 1 });
    expect(unchanged.status).toBe("unchanged");
    await expect(value.authority.host.advanceCanonical({ expectedHead: value.initialCanonicalHead,
      nextHead, v: 1 })).rejects.toThrow(OhConflictError);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("bounds and exactly validates canonical descendant proofs before rollover", async () => {
    const value = await authorityFixture();
    await value.canonical.store.commit({ actorId: "test.canonical-writer",
      changes: [{ kind: "put", record: entity("entity:next", "Next"), v: 1 }],
      expectedHead: value.initialCanonicalHead, operationId: "op_advance_validation" });
    const nextHead = await value.canonical.store.head();
    const originalChangesSince = value.canonical.store.changesSince.bind(value.canonical.store);
    let accessorReads = 0;
    value.canonical.store.changesSince = async (from, options) => {
      const page = await originalChangesSince(from, options);
      const hostile = { ...page } as Record<PropertyKey, unknown>;
      Object.defineProperty(hostile, "operations", { enumerable: true,
        get() { accessorReads += 1; throw new Error("must not execute"); } });
      return hostile as never;
    };
    await expect(value.authority.host.advanceCanonical({
      expectedHead: value.initialCanonicalHead, nextHead, v: 1 }))
      .rejects.toThrow("non-data property");
    expect(accessorReads).toBe(0);

    value.canonical.store.changesSince = async (from) => ({
      from, hasMore: true, operations: [], through: nextHead, to: from, v: 1,
    });
    await expect(value.authority.host.advanceCanonical({
      expectedHead: value.initialCanonicalHead, nextHead, v: 1 }))
      .rejects.toThrow("did not prove the requested descendant");

    value.canonical.store.changesSince = originalChangesSince;
    const wrongFullHead: OhHeadV1 = { ...nextHead,
      graphRevisionSha256: canonicalSha256({ kind: "test.wrong-full-head", v: 1 }) };
    await expect(value.authority.host.advanceCanonical({
      expectedHead: value.initialCanonicalHead, nextHead: wrongFullHead, v: 1 }))
      .rejects.toThrow("pinned bounds");

    let feedCalls = 0;
    value.canonical.store.changesSince = async (...args) => {
      feedCalls += 1;
      return await originalChangesSince(...args);
    };
    const fork: OhHeadV1 = { ...value.initialCanonicalHead,
      operationSha256: canonicalSha256({ kind: "test.fork", v: 1 }) };
    await expect(value.authority.host.advanceCanonical({
      expectedHead: value.initialCanonicalHead, nextHead: fork, v: 1 }))
      .rejects.toThrow("not a descendant");
    const rollback: OhHeadV1 = { generation: 0, graphRevisionSha256: null,
      operationSha256: null, recordsSha256: canonicalSha256([]), sequence: 0, v: 1 };
    await expect(value.authority.host.advanceCanonical({
      expectedHead: value.initialCanonicalHead, nextHead: rollback, v: 1 }))
      .rejects.toThrow("not a descendant");
    const distantSequence = value.initialCanonicalHead.sequence
      + OH_MEMORY_AUTHORITY_LIMITS_V1.canonicalAdvanceOperations + 1;
    const tooDistant: OhHeadV1 = { generation: distantSequence,
      graphRevisionSha256: canonicalSha256({ kind: "test.distant-graph", v: 1 }),
      operationSha256: canonicalSha256({ kind: "test.distant-operation", v: 1 }),
      recordsSha256: canonicalSha256({ kind: "test.distant-records", v: 1 }),
      sequence: distantSequence, v: 1 };
    await expect(value.authority.host.advanceCanonical({
      expectedHead: value.initialCanonicalHead, nextHead: tooDistant, v: 1 }))
      .rejects.toThrow("advance in host-reviewed chunks");
    expect(feedCalls).toBe(0);
    await value.canonical.store.close(); await value.working.store.close();
  });

  test("shares explanation eviction and monotonic clock state across canonical generations", async () => {
    const value = await authorityFixture();
    const oldPages = [];
    for (let index = 0; index < OH_MEMORY_LIMITS_V1.explainCapabilities - 1; index += 1) {
      oldPages.push(await value.authority.agent.query({ bindings: {}, continuation: null,
        programId: "memory.visible-records", v: 2 }));
    }
    await value.canonical.store.commit({ actorId: "test.cache-writer",
      changes: [{ kind: "put", record: entity("entity:cache-next", "Cache next"), v: 1 }],
      expectedHead: value.initialCanonicalHead, operationId: "op_cache_rollover" });
    const nextHead = await value.canonical.store.head();
    await value.authority.host.advanceCanonical({ expectedHead: value.initialCanonicalHead,
      nextHead, v: 1 });
    await value.authority.agent.query({ bindings: {}, continuation: null,
      programId: "memory.visible-records", v: 2 });
    await value.authority.agent.query({ bindings: {}, continuation: null,
      programId: "memory.visible-records", v: 2 });
    const evicted = oldPages[0]!;
    await expect(value.authority.agent.explain({ pageRow: 0,
      resultSha256: evicted.resultSha256, token: evicted.explainCapability.token, v: 2 }))
      .rejects.toThrow("absent, expired, or misbound");
    const retained = oldPages[1]!;
    expect((await value.authority.agent.explain({ pageRow: 0,
      resultSha256: retained.resultSha256,
      token: retained.explainCapability.token, v: 2 })).resultSha256)
      .toBe(retained.resultSha256);
    await value.canonical.store.close(); await value.working.store.close();

    let monotonic = 100;
    const clocked = await authorityFixture({ monotonicNow: () => monotonic,
      now: () => new Date("2026-08-29T12:00:00.000Z") });
    await clocked.authority.agent.query({ bindings: {}, continuation: null,
      programId: "memory.visible-records", v: 2 });
    await clocked.canonical.store.commit({ actorId: "test.clock-writer",
      changes: [{ kind: "put", record: entity("entity:clock-next", "Clock next"), v: 1 }],
      expectedHead: clocked.initialCanonicalHead, operationId: "op_clock_rollover" });
    const clockHead = await clocked.canonical.store.head();
    await clocked.authority.host.advanceCanonical({ expectedHead: clocked.initialCanonicalHead,
      nextHead: clockHead, v: 1 });
    monotonic = 50;
    await expect(clocked.authority.agent.query({ bindings: {}, continuation: null,
      programId: "memory.visible-records", v: 2 })).rejects.toThrow("monotonic clock regressed");
    await clocked.canonical.store.close(); await clocked.working.store.close();
  });

  test("rejects record-count and byte-capacity adoption before the only CAS", async () => {
    const fullRecords = Array.from({ length: OH_MEMORY_LIMITS_V1.maximumRecordsPerLane },
      (_, index) => entity(`entity:capacity-${index.toString().padStart(4, "0")}`, "x"));
    const countBound = await capacityAuthority(fullRecords);
    const workingHead = await countBound.working.store.head();
    await countBound.authority.agent.remember({ expectedHead: {
      generation: workingHead.generation, operationSha256: workingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:capacity-extra", kind: "entity", v: 1,
        value: { name: "Extra" } }], requestId: "remember_count_capacity",
      tombstones: [], v: 1 });
    const countNomination = await countBound.authority.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:capacity-extra"], v: 1 });
    await expect(countBound.authority.host.adoptNomination({
      expectedCanonicalHead: countBound.snapshot.head, nomination: countNomination, v: 1 }))
      .rejects.toThrow("record snapshot bound");
    expect(countBound.commitCalls()).toBe(0);
    expect(await countBound.canonicalStore.head()).toEqual(countBound.snapshot.head);
    await countBound.canonical.store.close(); await countBound.working.store.close();

    const largeName = "x".repeat(875_000);
    const byteRecords = Array.from({ length: 38 }, (_, index) =>
      entity(`entity:bytes-${index.toString().padStart(2, "0")}`, largeName));
    const byteBound = await capacityAuthority(byteRecords);
    expect(Buffer.byteLength(canonicalJson(byteBound.snapshot), "utf8"))
      .toBeLessThanOrEqual(OH_MEMORY_LIMITS_V1.snapshotBytesPerLane);
    const byteWorkingHead = await byteBound.working.store.head();
    await byteBound.authority.agent.remember({ expectedHead: {
      generation: byteWorkingHead.generation,
      operationSha256: byteWorkingHead.operationSha256 },
      puts: [{ dependencies: [], key: "entity:bytes-extra", kind: "entity", v: 1,
        value: { name: largeName } }], requestId: "remember_byte_capacity",
      tombstones: [], v: 1 });
    const byteNomination = await byteBound.authority.agent.nominate({ nominationId: "kb.review",
      roots: ["entity:bytes-extra"], v: 1 });
    await expect(byteBound.authority.host.adoptNomination({
      expectedCanonicalHead: byteBound.snapshot.head, nomination: byteNomination, v: 1 }))
      .rejects.toThrow("canonical snapshot byte bound");
    expect(byteBound.commitCalls()).toBe(0);
    expect(await byteBound.canonicalStore.head()).toEqual(byteBound.snapshot.head);
    await byteBound.canonical.store.close(); await byteBound.working.store.close();
  });
});
