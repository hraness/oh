import { describe, expect, test } from "bun:test";

import { canonicalSha256, type JsonValue } from "./canonical";
import { OhRecordCodecRegistry } from "./contract";
import { createKnowledgeGraphRecordV1 } from "./graph";
import {
  createOhMemoryAgentV1,
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
