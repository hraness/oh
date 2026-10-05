import { describe, expect, test } from "bun:test";

import { canonicalJson, canonicalSha256, type Sha256Hex } from "./canonical";
import { createKnowledgeGraphRecordV1 } from "./graph";
import {
  captureOhMemoryContextV1,
  createOhMemoryContextHostV1,
  createOhMemoryContextNodeV1,
  OH_MEMORY_CONTEXT_LIMITS_V1,
  OhMemoryContextContinuationError,
  OhMemoryContextError,
  ohMemoryContextCoverV1,
  ohMemoryContextGenerationSha256V1,
  ohMemoryContextHistorySha256V1,
  ohMemoryContextNodeSha256V1,
  ohMemoryContextSummarySha256V1,
  parseOhMemoryContextHistoryV1,
  parseOhMemoryContextPoolV1,
  type OhMemoryContextAccessV1,
  type OhMemoryContextGenerationV1,
  type OhMemoryContextHistoryV1,
  type OhMemoryContextItemV1,
  type OhMemoryContextPoolV1,
  type OhMemoryContextRefV1,
} from "./memory-context";
import { createOhSqliteStoreAuthorityV1 } from "./sqlite/port";
import {
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_WORKING_STORE_PROFILE_V1,
  type OhStoreV1,
} from "./store";

const ZERO_KEY = new Uint8Array(32);
let instantTick = 0;
function instant(): string {
  instantTick += 1;
  return `2026-10-01T12:${String(Math.floor(instantTick / 60)).padStart(2, "0")}:`
    + `${String(instantTick % 60).padStart(2, "0")}.000Z`;
}

function record(key: string, name: string) {
  return createKnowledgeGraphRecordV1({ dependencies: [], key, kind: "entity", v: 1,
    value: { name } });
}

async function commit(store: OhStoreV1, changes: ReadonlyArray<
  ReturnType<typeof record> | { key: string; priorSha256: Sha256Hex }>, id: string) {
  const head = await store.head();
  return store.commit({ actorId: "agent.test", changes: changes.map((change) =>
    "priorSha256" in change ? { key: change.key, kind: "tombstone" as const,
      priorSha256: change.priorSha256, v: 1 as const }
      : { kind: "put" as const, record: change, v: 1 as const }),
  expectedHead: { generation: head.generation, operationSha256: head.operationSha256 },
  instant: instant(), operationId: id });
}

type Fixture = {
  authority: ReturnType<typeof createOhSqliteStoreAuthorityV1>;
  canonicalAuthority?: ReturnType<typeof createOhSqliteStoreAuthorityV1>;
  history: OhMemoryContextHistoryV1;
  keyCount: number;
  store: OhStoreV1;
};

async function makeFixture(count: number, options: { canonical?: boolean } = {}): Promise<Fixture> {
  const authority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:ctx", spaceId: "ctx.working" });
  for (let index = 0; index < count; index += 1) {
    await commit(authority.store, [record(`entity:item-${index}`, `Item ${index}`)],
      `op_ctx_${index}`);
  }
  if (!options.canonical) {
    const history = await captureOhMemoryContextV1({ working: { store: authority.store } });
    return { authority, history, keyCount: count, store: authority.store };
  }
  const canonicalAuthority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:ctx", spaceId: "ctx.canonical" });
  for (let index = 0; index < 3; index += 1) {
    await commit(canonicalAuthority.store,
      [record(`entity:reviewed-${index}`, `Reviewed ${index}`)], `op_can_${index}`);
  }
  const history = await captureOhMemoryContextV1({
    canonical: { store: canonicalAuthority.store },
    working: { store: authority.store } });
  return { authority, canonicalAuthority, history, keyCount: count, store: authority.store };
}

type Grant = { indices: readonly number[] | null; lanes: readonly ("canonical" | "working")[] | null;
  state: "active" | "revoked" };

function makeHost(fixture: Fixture, grant: Grant = { indices: null, lanes: null, state: "active" },
  clock?: { now: number }) {
  const host = createOhMemoryContextHostV1({
    ...(fixture.canonicalAuthority === undefined ? {} : { canonical: {
      expectedBindingSha256: fixture.canonicalAuthority.store.binding.bindingSha256,
      store: fixture.canonicalAuthority.store } }),
    continuationKey: ZERO_KEY,
    ...(clock === undefined ? {} : { monotonicNow: () => clock.now }),
    resolveAccess: (ref: OhMemoryContextRefV1): OhMemoryContextAccessV1 =>
      Object.freeze({ historySha256: ref.historySha256, indices: grant.indices,
        lanes: grant.lanes, revision: 1, state: grant.state, v: 1 }),
    working: { expectedBindingSha256: fixture.store.binding.bindingSha256,
      store: fixture.store },
  });
  return host;
}

function makePool(history: OhMemoryContextHistoryV1, generation: number,
  ranges: readonly { start: number; end: number; text: string }[],
  recipe = { policy: "policy.test.v1", prompt: "prompt.test.v1", summarizer: "summarizer.test.v1" })
  : OhMemoryContextPoolV1 {
  const recipeDigests = { policySha256: canonicalSha256(recipe.policy),
    promptSha256: canonicalSha256(recipe.prompt),
    summarizerSha256: canonicalSha256(recipe.summarizer) };
  const nodes = ranges.map((range) => createOhMemoryContextNodeV1(history, range.start, range.end));
  const summaries = ranges.map((range, index) => ({
    body: range.text, childrenSha256s: [] as Sha256Hex[],
    historySha256: ohMemoryContextHistorySha256V1(history),
    nodeSha256: ohMemoryContextNodeSha256V1(nodes[index]!),
    ...recipeDigests,
    sourcesSha256: nodes[index]!.sourcesSha256, v: 1 as const }));
  const generationRecord: OhMemoryContextGenerationV1 = {
    generation, historySha256: ohMemoryContextHistorySha256V1(history),
    ...recipeDigests,
    summaries: summaries.map((summary) => ({ nodeSha256: summary.nodeSha256,
      summarySha256: ohMemoryContextSummarySha256V1(summary) }))
      .sort((left, right) => left.nodeSha256 < right.nodeSha256 ? -1 : 1),
    v: 1 };
  return { generation: generationRecord, nodes, summaries };
}

function kinds(items: readonly OhMemoryContextItemV1[]): string[] {
  return items.map((item) => item.kind);
}

describe("memory-context capture and codecs", () => {
  test("captures every change with deterministic digests and lane bindings", async () => {
    const fixture = await makeFixture(6);
    const again = await captureOhMemoryContextV1({ working: { store: fixture.store } });
    expect(ohMemoryContextHistorySha256V1(fixture.history))
      .toBe(ohMemoryContextHistorySha256V1(again));
    expect(fixture.history.leaves).toHaveLength(6);
    expect(fixture.history.bindings.map((binding) => binding.lane)).toEqual(["working"]);
    for (const leaf of fixture.history.leaves) {
      expect(leaf.kind).toBe("put");
      expect(leaf.live).toBe(true);
      expect(leaf.lane).toBe("working");
    }
    const tombstone = await commit(fixture.store,
      [{ key: "entity:item-0", priorSha256: fixture.history.leaves[0]!.recordSha256 }], "op_ctx_tombstone");
    void tombstone;
    const updated = await captureOhMemoryContextV1({ working: { store: fixture.store } });
    expect(updated.leaves).toHaveLength(7);
    expect(updated.leaves.at(-1)!.kind).toBe("tombstone");
    expect(updated.leaves.at(-1)!.live).toBe(false);
    await fixture.authority.store.close();
  });

  test("merges canonical and working lanes into one ordered history", async () => {
    const fixture = await makeFixture(3, { canonical: true });
    expect(fixture.history.bindings.map((binding) => binding.lane))
      .toEqual(["canonical", "working"]);
    expect(fixture.history.leaves).toHaveLength(6);
    const lanes = new Set(fixture.history.leaves.map((leaf) => leaf.lane));
    expect(lanes).toEqual(new Set(["canonical", "working"]));
    await fixture.store.close();
    await fixture.canonicalAuthority!.store.close();
  });

  test("rejects malformed histories, pools, and access records", async () => {
    const fixture = await makeFixture(2);
    expect(() => parseOhMemoryContextHistoryV1({ ...fixture.history, v: 2 })).toThrow(TypeError);
    expect(() => parseOhMemoryContextHistoryV1({ ...fixture.history, bindings: [] })).toThrow(TypeError);
    expect(() => parseOhMemoryContextHistoryV1({ bindings: fixture.history.bindings,
      leaves: [...fixture.history.leaves].reverse(), v: 1 })).toThrow("merge order");
    const pool = makePool(fixture.history, 0, [{ start: 0, end: 2, text: "Old range." }]);
    expect(() => parseOhMemoryContextPoolV1(fixture.history, pool)).not.toThrow();
    expect(() => parseOhMemoryContextPoolV1(fixture.history,
      { ...pool, generation: { ...pool.generation, historySha256: "a".repeat(64) } }))
      .toThrow("another history");
    const tampered = { ...pool.summaries[0]!, body: "Substituted." };
    expect(() => parseOhMemoryContextPoolV1(fixture.history,
      { ...pool, summaries: [tampered] })).toThrow();
    const misaligned = createOhMemoryContextNodeV1(fixture.history, 0, 2);
    const alien = { ...pool.summaries[0]!, sourcesSha256: misaligned.sourcesSha256,
      nodeSha256: ohMemoryContextNodeSha256V1(createOhMemoryContextNodeV1(fixture.history, 0, 1)) };
    expect(() => parseOhMemoryContextPoolV1(fixture.history,
      { ...pool, summaries: [alien] })).toThrow();
    await fixture.authority.store.close();
  });
});

describe("memory-context reading", () => {
  test("shows recent leaves in detail and older ranges as pending nodes", async () => {
    const fixture = await makeFixture(10);
    const host = makeHost(fixture);
    const ref = await host.admit(fixture.history, { recentLeaves: 2 });
    const reader = host.bind(ref);
    const inspection = await reader.inspect();
    expect(inspection.leaves).toBe(10);
    expect(inspection.heads.working!.sequence).toBe(10);
    const page = await reader.overview();
    expect(page.status).toBe("complete");
    expect(page.binding.historySha256).toBe(ohMemoryContextHistorySha256V1(fixture.history));
    const leafItems = page.items.filter((item) => item.kind === "leaf");
    const pendingItems = page.items.filter((item) => item.kind === "pending");
    expect(leafItems.map((item) => item.kind === "leaf" ? item.leafIndex : -1)).toEqual([8, 9]);
    expect(pendingItems.every((item) => item.kind === "pending"
      && item.reason === "missing-summary")).toBe(true);
    expect(pendingItems.length).toBeGreaterThan(0);
    for (const item of leafItems) {
      if (item.kind !== "leaf") continue;
      expect(item.record!.recordSha256).toBe(item.leaf.recordSha256);
    }
    await fixture.authority.store.close();
  });

  test("recovers an exact record body and finds it by search", async () => {
    const fixture = await makeFixture(5);
    const host = makeHost(fixture);
    const reader = host.bind(await host.admit(fixture.history));
    const found = await reader.read(3);
    expect(found.record!.value).toEqual({ name: "Item 3" });
    expect(found.leaf.key).toBe("entity:item-3");
    const search = await reader.search({ pattern: "Item [24]" });
    expect(search.complete).toBe(true);
    expect(search.denied).toBe(0);
    expect(search.matches.map((match) => match.key))
      .toEqual(["entity:item-2", "entity:item-4"]);
    await fixture.authority.store.close();
  });

  test("publishes one derivative generation and refuses stale or alternative writes", async () => {
    const fixture = await makeFixture(8);
    const host = makeHost(fixture);
    const ref = await host.admit(fixture.history, { recentLeaves: 4 });
    const reader = host.bind(ref);
    const before = await reader.overview();
    const pool = makePool(fixture.history, 1, [
      { start: 0, end: 4, text: "Items zero through three." }]);
    const published = await host.publishDerivatives(ref, pool, before.binding.generationSha256);
    expect(published).toBe(ohMemoryContextGenerationSha256V1(pool.generation));
    const after = await reader.overview();
    expect(after.binding.generationSha256).toBe(published);
    const summarized = after.items.find((item) => item.kind === "summary");
    expect(summarized).toBeDefined();
    if (summarized?.kind === "summary") {
      expect(summarized.text).toBe("Items zero through three.");
      expect(summarized.start).toBe(0);
      expect(summarized.end).toBe(4);
    }
    // Replaying the same proposal is idempotent even with the stale expected
    // digest; a competing proposal for generation 1 can never overwrite it.
    expect(await host.publishDerivatives(ref, pool, before.binding.generationSha256))
      .toBe(published);
    expect(await host.publishDerivatives(ref, pool, published)).toBe(published);
    const rival = makePool(fixture.history, 1, [
      { start: 0, end: 4, text: "A different old range." }]);
    await expect(host.publishDerivatives(ref, rival, before.binding.generationSha256))
      .rejects.toBeInstanceOf(OhMemoryContextError);
    const next = makePool(fixture.history, 2, [
      { start: 0, end: 4, text: "Items zero through three, corrected." }]);
    await expect(host.publishDerivatives(ref, next, before.binding.generationSha256))
      .rejects.toBeInstanceOf(OhMemoryContextError);
    await fixture.authority.store.close();
  });

  test("expands a summarized node into its children and then the originals", async () => {
    const fixture = await makeFixture(8);
    const host = makeHost(fixture);
    const ref = await host.admit(fixture.history, { recentLeaves: 4 });
    const reader = host.bind(ref);
    const first = makePool(fixture.history, 1, [
      { start: 0, end: 4, text: "First half." }]);
    await host.publishDerivatives(ref, first,
      ohMemoryContextGenerationSha256V1({ generation: 0,
        historySha256: ohMemoryContextHistorySha256V1(fixture.history),
        policySha256: canonicalSha256("oh.memory-context.no-policy"),
        promptSha256: canonicalSha256("oh.memory-context.no-prompt"),
        summarizerSha256: canonicalSha256("oh.memory-context.no-summarizer"),
        summaries: [], v: 1 }));
    const nodeSha256 = first.summaries[0]!.nodeSha256;
    const expanded = await reader.expand(nodeSha256);
    expect(expanded.status).toBe("incomplete");
    expect(kinds(expanded.items)).toEqual(["pending", "pending"]);
    const halves = [createOhMemoryContextNodeV1(fixture.history, 0, 2),
      createOhMemoryContextNodeV1(fixture.history, 2, 4)];
    const second = makePool(fixture.history, 2, [
      { start: 0, end: 2, text: "Items zero and one." },
      { start: 2, end: 4, text: "Items two and three." }]);
    await host.publishDerivatives(ref, {
      generation: { ...second.generation,
        summaries: second.generation.summaries },
      nodes: [...first.nodes, ...second.nodes],
      summaries: [...first.summaries, ...second.summaries] },
      ohMemoryContextGenerationSha256V1(first.generation));
    const expandedAgain = await reader.expand(nodeSha256);
    expect(expandedAgain.status).toBe("complete");
    expect(kinds(expandedAgain.items)).toEqual(["summary", "summary"]);
    // A size-two node expands straight into its two exact leaves.
    const leafExpansion = await reader.expand(
      ohMemoryContextNodeSha256V1(halves[0]!));
    expect(kinds(leafExpansion.items)).toEqual(["leaf", "leaf"]);
    if (leafExpansion.items[0]!.kind === "leaf") {
      expect(leafExpansion.items[0]!.record!.value).toEqual({ name: "Item 0" });
    }
    // Reaching a size-one range returns the exact leaf, not another node.
    const single = createOhMemoryContextNodeV1(fixture.history, 0, 1);
    const leafExpansionTwo = await reader.expand(ohMemoryContextNodeSha256V1(single));
    expect(kinds(leafExpansionTwo.items)).toEqual(["leaf"]);
    await fixture.authority.store.close();
  });
});

describe("memory-context permission and staleness boundaries", () => {
  test("denies reads after host revocation and after the resolver revokes", async () => {
    const fixture = await makeFixture(4);
    const grant: Grant = { indices: null, lanes: null, state: "active" };
    const host = makeHost(fixture, grant);
    const ref = await host.admit(fixture.history);
    const reader = host.bind(ref);
    await reader.inspect();
    host.revoke(ref);
    await expect(reader.overview()).rejects.toMatchObject({ reason: "authorization" });
    // A revoked reference cannot be re-admitted on the same host.
    await expect(host.admit(fixture.history)).rejects.toMatchObject({ reason: "authorization" });
    const grantTwo: Grant = { indices: null, lanes: null, state: "active" };
    const hostTwo = makeHost(fixture, grantTwo);
    const refTwo = await hostTwo.admit(fixture.history);
    const readerTwo = hostTwo.bind(refTwo);
    await readerTwo.inspect();
    grantTwo.state = "revoked";
    await expect(readerTwo.overview()).rejects.toMatchObject({ reason: "authorization" });
    await expect(readerTwo.read(0)).rejects.toMatchObject({ reason: "authorization" });
    // A resolver that starts revoked denies admission itself.
    const hostThree = makeHost(fixture, { indices: null, lanes: null, state: "revoked" });
    await expect(hostThree.admit(fixture.history)).rejects.toMatchObject({ reason: "authorization" });
    await fixture.authority.store.close();
  });

  test("hides bodies outside a narrowed grant and marks their ranges pending", async () => {
    const fixture = await makeFixture(6);
    const grant: Grant = { indices: [4, 5], lanes: null, state: "active" };
    const host = makeHost(fixture, grant);
    const pool = makePool(fixture.history, 0, [
      { start: 0, end: 2, text: "Items zero and one." },
      { start: 2, end: 4, text: "Items two and three." }]);
    const ref = await host.admit(fixture.history, { derivatives: pool, recentLeaves: 2 });
    const reader = host.bind(ref);
    const page = await reader.overview();
    const pending = page.items.filter((item) => item.kind === "pending");
    expect(pending.some((item) => item.kind === "pending"
      && item.reason === "unpermitted")).toBe(true);
    await expect(reader.read(0)).rejects.toMatchObject({ reason: "authorization" });
    const allowed = await reader.read(5);
    expect(allowed.record!.value).toEqual({ name: "Item 5" });
    const search = await reader.search({ pattern: "Item" });
    expect(search.denied).toBe(4);
    expect(search.matches.map((match) => match.key))
      .toEqual(["entity:item-4", "entity:item-5"]);
    // A summary is never a laundering path: denying one leaf in its range
    // withholds the summary body even though the caller asked for the range.
    await fixture.authority.store.close();
  });

  test("denies a rebound store and a captured head that left the log", async () => {
    const fixture = await makeFixture(3);
    const other = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:other", spaceId: "ctx.other" });
    const reboundHost = createOhMemoryContextHostV1({
      continuationKey: ZERO_KEY,
      resolveAccess: (ref: OhMemoryContextRefV1) => Object.freeze({
        historySha256: ref.historySha256, indices: null, lanes: null,
        revision: 1, state: "active" as const, v: 1 as const }),
      working: { expectedBindingSha256: other.store.binding.bindingSha256,
        store: other.store } });
    await expect(reboundHost.admit(fixture.history))
      .rejects.toMatchObject({ reason: "stale" });
    const host = makeHost(fixture);
    const ref = await host.admit(fixture.history);
    const reader = host.bind(ref);
    await reader.inspect();
    await fixture.authority.host.purgeWorkingSpace({ purgedAt: "2026-10-02T00:00:00.000Z" });
    await expect(reader.read(0)).rejects.toMatchObject({ reason: "availability" });
    await expect(reader.overview()).rejects.toMatchObject({ reason: "availability" });
    await other.store.close();
  });

  test("denies an all-summary expansion after the lane's store is purged", async () => {
    const fixture = await makeFixture(4);
    const host = makeHost(fixture);
    const pool = makePool(fixture.history, 0, [
      { start: 0, end: 2, text: "Items zero and one." },
      { start: 2, end: 4, text: "Items two and three." }]);
    const ref = await host.admit(fixture.history, { derivatives: pool, recentLeaves: 0 });
    const reader = host.bind(ref);
    // Expansion of the whole range is served entirely from summaries; no
    // leaf body is fetched, so this is the path that must still re-probe.
    const whole = createOhMemoryContextNodeV1(fixture.history, 0, 4);
    expect(kinds((await reader.expand(ohMemoryContextNodeSha256V1(whole))).items))
      .toEqual(["summary", "summary"]);
    await fixture.authority.host.purgeWorkingSpace({ purgedAt: "2026-10-02T00:00:00.000Z" });
    // Cached summary bodies cannot outlive the lane that produced them.
    await expect(reader.inspect()).rejects.toMatchObject({ reason: "availability" });
    await expect(reader.overview()).rejects.toMatchObject({ reason: "availability" });
    await expect(reader.expand(ohMemoryContextNodeSha256V1(whole)))
      .rejects.toMatchObject({ reason: "availability" });
  });

  test("keeps a captured view stable while later writes arrive", async () => {
    const fixture = await makeFixture(4);
    const host = makeHost(fixture);
    const ref = await host.admit(fixture.history, { recentLeaves: 2 });
    const reader = host.bind(ref);
    const before = await reader.overview();
    await commit(fixture.store, [record("entity:item-4", "Item 4")], "op_ctx_late");
    const after = await reader.overview();
    expect(canonicalJson(before.items)).toBe(canonicalJson(after.items));
    expect(after.binding.historySha256).toBe(before.binding.historySha256);
    expect((await reader.inspect()).heads.working!.sequence).toBe(4);
    await fixture.authority.store.close();
  });
});

describe("memory-context continuations", () => {
  test("issues partial pages and follows their continuations", async () => {
    const fixture = await makeFixture(12);
    const host = makeHost(fixture);
    const ref = await host.admit(fixture.history, { recentLeaves: 2 });
    const reader = host.bind(ref);
    const first = await reader.overview({ limits: { maxItems: 3 } });
    expect(first.status).toBe("partial");
    expect(first.continuation).not.toBeNull();
    expect(first.items).toHaveLength(3);
    const seen: number[] = [];
    let cursor: string | null = first.continuation;
    let start = first.end;
    while (cursor !== null) {
      const page = await reader.overview({ continuation: cursor,
        limits: { maxItems: 3 } });
      expect(page.start).toBe(start);
      seen.push(page.end);
      start = page.end;
      cursor = page.continuation;
    }
    expect(start).toBe(12);
    await fixture.authority.store.close();
  });

  test("rejects tampered, expired, misbound, and replayed continuations", async () => {
    const fixture = await makeFixture(12);
    const clock = { now: 0 };
    const host = makeHost(fixture, { indices: null, lanes: null, state: "active" }, clock);
    const ref = await host.admit(fixture.history, { recentLeaves: 2 });
    const reader = host.bind(ref);
    const first = await reader.overview({ limits: { maxItems: 3 } });
    expect(first.status).toBe("partial");
    const continuation = first.continuation!;
    const tampered = `${continuation.slice(0, -4)}AAAA`;
    await expect(reader.overview({ continuation: tampered, limits: { maxItems: 3 } }))
      .rejects.toBeInstanceOf(OhMemoryContextContinuationError);
    await expect(reader.overview({ continuation: "!!!!", limits: { maxItems: 3 } }))
      .rejects.toMatchObject({ reason: "encoding" });
    // A different selection may not resume the page.
    await expect(reader.overview({ continuation, limits: { maxItems: 4 } }))
      .rejects.toMatchObject({ reason: "identity" });
    // Expiry is measured on the host's monotonic clock, not wall time.
    clock.now = 16 * 60 * 1000;
    await expect(reader.overview({ continuation, limits: { maxItems: 3 } }))
      .rejects.toMatchObject({ reason: "expired" });
    clock.now = 0;
    // An overview continuation cannot be spent on another surface.
    await expect(reader.expand(
      ohMemoryContextNodeSha256V1(createOhMemoryContextNodeV1(fixture.history, 0, 1)),
      { continuation }))
      .rejects.toBeInstanceOf(OhMemoryContextContinuationError);
    // A generation bump invalidates outstanding continuations.
    const pool = makePool(fixture.history, 1, [
      { start: 0, end: 8, text: "The old items." }]);
    const inspection = await reader.inspect();
    await host.publishDerivatives(ref, pool, inspection.generationSha256);
    await expect(reader.overview({ continuation, limits: { maxItems: 3 } }))
      .rejects.toMatchObject({ reason: "identity" });
    await fixture.authority.store.close();
  });
});

describe("memory-context cover", () => {
  test("produces aligned ranges that get finer toward the present", () => {
    const cover = ohMemoryContextCoverV1(70, 2);
    expect(cover.at(-1)).toEqual({ start: 69, end: 70 });
    expect(cover.at(-2)).toEqual({ start: 68, end: 69 });
    for (const range of cover) {
      const length = range.end - range.start;
      expect(length & (length - 1)).toBe(0);
      expect(range.start % length).toBe(0);
    }
    let cursor = 0;
    for (const range of cover) {
      expect(range.start).toBe(cursor);
      cursor = range.end;
    }
    expect(cursor).toBe(70);
  });

  test("forces detail around selected leaves", () => {
    const cover = ohMemoryContextCoverV1(70, 2, [3]);
    const leaf = cover.find((range) => range.start === 3);
    expect(leaf).toEqual({ start: 3, end: 4 });
    expect(cover.filter((range) => range.start <= 3 && range.end > 3)).toHaveLength(1);
  });
});
