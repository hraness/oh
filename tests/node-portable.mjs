import assert from "node:assert/strict";

// Exercise the published package subpaths, not internal build paths. This also
// catches an export that accidentally makes Bun-only modules reachable.
const store = await import("@hraness/oh/store");
const libsql = await import("@hraness/oh/libsql");
const memory = await import("@hraness/oh/experimental/memory");
const memoryPage = await import("@hraness/oh/memory-page");
const projection = await import("@hraness/oh/projection");
const semanticCloud = await import("@hraness/oh/semantic-cloud");

assert.equal(typeof store.createOhStoreBindingV1, "function");
assert.equal(typeof store.OhRecordCodecRegistry, "function");
assert.equal(typeof store.OhSemanticBundleIngressV1, "function");
assert.equal(typeof libsql.createOhLibSqlStoreAuthorityV1, "function");
assert.equal(typeof libsql.openExistingOhLibSqlStoreAuthorityV1, "function");
assert.equal(typeof libsql.purgeOhLibSqlWorkingSpaceV1, "function");
assert.equal(typeof memory.createOhMemoryAgentV1, "function");
assert.equal(typeof memory.createOhMemoryAgentV2, "function");
assert.equal(typeof memoryPage.createOhMemoryPageRecordV1, "function");
assert.equal(typeof memoryPage.parseOhMemoryPageMarkdownV1, "function");
assert.equal(typeof semanticCloud.OhCloudflareEmbeddingClientV1, "function");
assert.equal(typeof semanticCloud.bootstrapOhLibSqlSemanticCacheV1, "function");
assert.equal(typeof semanticCloud.openOhLibSqlSemanticCacheV1, "function");
assert.equal(store.OH_WORKING_STORE_PROFILE_V1.profileKind, "working");
assert.equal(store.OH_WORKING_STORE_PROFILE_V1.capabilities.operationReplication, false);
assert.equal(store.OH_WORKING_STORE_PROFILE_V1.capabilities.wholeSpacePurge, true);

function emptyStore(profile, realmId, spaceId) {
  const binding = store.createOhStoreBindingV1({ profile, realmId, spaceId, v: 1 });
  const head = store.emptyOhHeadV1();
  return {
    binding,
    async head() { return head; },
    async snapshot(options = {}) {
      assert.equal(options.maximumRecords, memory.OH_MEMORY_LIMITS_V1.maximumRecordsPerLane);
      return { head, records: [], v: 1 };
    },
  };
}

const canonicalStore = emptyStore(store.OH_CANONICAL_STORE_PROFILE_V1,
  "realm:node-canonical", "node-canonical");
const workingStore = emptyStore(store.OH_WORKING_STORE_PROFILE_V1,
  "realm:node-working", "node-working");
const lane = projection.ohProjectionVariableV1("lane");
const key = projection.ohProjectionVariableV1("key");
const kind = projection.ohProjectionVariableV1("kind");
const digest = projection.ohProjectionVariableV1("digest");
const record = projection.createOhProjectionLiteralV1({
  relation: "memory.record", terms: [lane, key, kind, digest],
});
const visible = projection.createOhProjectionLiteralV1({
  relation: "memory.visible", terms: [lane, key, digest],
});
const rulePack = projection.createOhProjectionRulePackV1({
  rulePackId: "memory.node-visible", rulePackRevision: 1,
  rules: [projection.createOhProjectionRuleV1({
    body: [record], head: visible, ruleId: "memory.node-visible",
  })],
});
const query = projection.createOhProjectionQueryV1({
  find: ["lane", "key", "digest"], limit: 10, queryId: "memory.node-visible",
  where: [visible],
});
const agent = await memory.createOhMemoryAgentV1({
  actorId: "node.memory-agent",
  canonical: { authorityId: "node.canonical",
    expectedBindingSha256: canonicalStore.binding.bindingSha256,
    expectedHead: await canonicalStore.head(), store: canonicalStore },
  monotonicNow: () => 0,
  now: () => new Date("2026-08-29T12:00:00.000Z"),
  programs: [{ programId: "memory.node-visible", purpose: "node.portability", query, rulePack }],
  working: { authorityId: "node.working", codecs: new store.OhRecordCodecRegistry(),
    expectedBindingSha256: workingStore.binding.bindingSha256, store: workingStore },
});
const result = await agent.query({ programId: "memory.node-visible", v: 1 });
assert.equal(result.authority, "derived");
assert.equal(result.identity.purpose, "node.portability");
assert.deepEqual(result.rows, []);
assert.equal(Object.isFrozen(result.rows), true);

const queryV2 = projection.createOhProjectionQueryV1({
  find: ["digest"], limit: 10, queryId: "memory.node-visible-v2",
  where: [visible],
});
const agentV2 = await memory.createOhMemoryAgentV2({
  actorId: "node.memory-agent-v2",
  canonical: { authorityId: "node.canonical-v2",
    expectedBindingSha256: canonicalStore.binding.bindingSha256,
    expectedHead: await canonicalStore.head(), store: canonicalStore },
  continuationKey: new Uint8Array(32).fill(1),
  monotonicNow: () => 0,
  now: () => new Date("2026-08-29T12:00:00.000Z"),
  programs: [{
    evaluation: { maximumDerivedTuples: 100, maximumProofDepth: 16,
      maximumProofNodes: 16, maximumResultBytes: 1024 * 1024, maximumRounds: 16,
      maximumTotalProofNodes: 100, maximumWorkUnits: 10_000 },
    maximumPageBytes: 256 * 1024,
    maximumRows: 10,
    pageSize: 5,
    parameters: ["key", "lane"],
    programId: "memory.node-visible-v2",
    purpose: "node.portability-v2",
    query: queryV2,
    rulePack,
    v: 2,
  }],
  working: { authorityId: "node.working-v2", codecs: new store.OhRecordCodecRegistry(),
    expectedBindingSha256: workingStore.binding.bindingSha256, store: workingStore },
});
const resultV2 = await agentV2.query({ bindings: { key: "entity:portable", lane: "working" },
  continuation: null, programId: "memory.node-visible-v2", v: 2 });
assert.equal(resultV2.identity.purpose, "node.portability-v2");
assert.equal(resultV2.page.completeness, "complete");
assert.equal(resultV2.page.hasMore, false);
assert.equal(resultV2.continuation, null);
assert.equal(resultV2.continuationSha256, null);
assert.deepEqual(resultV2.rows, []);
