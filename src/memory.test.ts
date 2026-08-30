import { describe, expect, test } from "bun:test";

import { canonicalSha256, type JsonValue } from "./canonical";
import { OhRecordCodecRegistry } from "./contract";
import { createKnowledgeGraphRecordV1 } from "./graph";
import {
  createOhMemoryAgentV1,
  createOhMemoryAgentV2,
  OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1,
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
  OhIntegrityError,
  OhProfileError,
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

async function fixtureV2(maximumRows = 400, pageSize = 64,
  maximumResultBytes = 8 * 1024 * 1024, configuration: Readonly<{
    chunkBytes?: number;
    chunkCount?: number;
    maximumPageBytes?: number;
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
  const agent = await createOhMemoryAgentV2({ actorId: "test.memory-agent-v2",
    canonical: { authorityId: "authority.v2-canonical",
      expectedBindingSha256: canonical.store.binding.bindingSha256,
      expectedHead: await canonical.store.head(), store: canonical.store },
    extractors: [{ extractorId: "domain.value-chunks",
      extractorSha256: canonicalSha256({ extractor: "domain.value-chunks", revision: 1 }),
      relations: ["domain.value-chunk"],
      extract: ({ lane, record }) => Array.from({ length: chunkCount }, (_, index) => ({
        relation: "domain.value-chunk", tuple: [lane, record.key, index,
          `chunk:${index.toString().padStart(3, "0")}${"x".repeat(chunkBytes)}`], v: 1 as const,
      })),
    }],
    monotonicNow: () => 0,
    now: () => new Date("2026-08-29T12:00:00.000Z"),
    programs: [baseProgram, { ...baseProgram, maximumPageBytes: 1024 * 1024,
      programId: "memory.value-chunks-alternate", purpose: "answer.memory-value-alternate" }],
    working: { authorityId: "authority.v2-working", codecs: entityCodecs(),
      expectedBindingSha256: working.store.binding.bindingSha256, store: working.store },
  });
  return { agent, canonical, working };
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

async function fixture() {
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
      expectedBindingSha256: working.store.binding.bindingSha256, store: working.store },
  });
  return { agent, canonical, canonicalHead, setNow(value: string) {
    now = new Date(value); monotonicNow = now.getTime() - clockOrigin;
  }, working };
}

describe("experimental composite Oh memory", () => {
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
});

describe("experimental parameterized and paginated Oh memory V2", () => {
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
      .rejects.toThrow();
    const decoded = JSON.parse(Buffer.from(continuation, "base64url").toString("utf8")) as
      Record<string, unknown>;
    const noncanonical = Buffer.from(JSON.stringify(Object.fromEntries(
      Object.entries(decoded).reverse())), "utf8").toString("base64url");
    await expect(value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: noncanonical, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow("Invalid memory continuation payload");
    await expect(value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation, programId: "memory.value-chunks-alternate", v: 2 }))
      .rejects.toThrow("exact source, program, and binding identity");
    await expect(value.agent.query({ bindings: {
      key: "entity:other", lane: "canonical",
    }, continuation, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow(OhIntegrityError);

    const head = await value.working.store.head();
    await value.agent.remember({ expectedHead: { generation: head.generation,
      operationSha256: head.operationSha256 }, puts: [{ dependencies: [], key: "entity:head-change",
      kind: "entity", v: 1, value: { name: "Head change" } }], requestId: "v2_head_change",
    tombstones: [], v: 1 });
    await expect(value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation, programId: "memory.value-chunks", v: 2 }))
      .rejects.toThrow("exact source, program, and binding identity");
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

    const exact = await value.agent.query({ bindings: {
      key: "entity:chunked", lane: "canonical",
    }, continuation: null, programId: "memory.value-chunks", v: 2 });
    expect(exact.rows).toHaveLength(64);
    expect(exact.page).toMatchObject({ completeness: "complete", endExclusive: 64,
      hasMore: false, returnedRows: 64, start: 0, totalRows: 64 });
    expect(exact.continuation).toBeNull();
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
});
