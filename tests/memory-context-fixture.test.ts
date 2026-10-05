import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { canonicalSha256 } from "../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../src/graph";
import {
  captureOhMemoryContextV1,
  createOhMemoryContextHostV1,
  createOhMemoryContextNodeV1,
  ohMemoryContextCoverV1,
  ohMemoryContextGenerationSha256V1,
  ohMemoryContextHistorySha256V1,
  ohMemoryContextLeafSha256V1,
  ohMemoryContextNodeSha256V1,
  ohMemoryContextSummarySha256V1,
} from "../src/memory-context";
import { createOhSqliteStoreAuthorityV1 } from "../src/sqlite/port";
import { OH_WORKING_STORE_PROFILE_V1 } from "../src/store";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/memory-context-v1.json", import.meta.url), "utf8")) as {
  cover: { end: number; start: number }[];
  generationSha256: string;
  historySha256: string;
  leafSha256s: string[];
  nodeSha256s: string[];
  summaryNodeSha256: string;
  summarySha256: string;
  v: 1;
};

async function buildFixtureStore() {
  const authority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
    profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:fixture",
    spaceId: "fixture.context" });
  for (let index = 0; index < 7; index += 1) {
    const head = await authority.store.head();
    await authority.store.commit({ actorId: "agent.fixture",
      changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({
        dependencies: [], key: `entity:fixture-${index}`, kind: "entity", v: 1,
        value: { name: `Fixture ${index}` } }), v: 1 }],
      expectedHead: { generation: head.generation,
        operationSha256: head.operationSha256 },
      instant: `2026-10-01T00:00:0${index}.000Z`, operationId: `op_fixture_${index}` });
  }
  const head = await authority.store.head();
  const snapshot = await authority.store.snapshot({ head: {
    operationSha256: head.operationSha256, sequence: head.sequence } });
  const prior = snapshot.records.find((entry) => entry.key === "entity:fixture-0")!;
  await authority.store.commit({ actorId: "agent.fixture",
    changes: [{ key: "entity:fixture-0", kind: "tombstone",
      priorSha256: prior.recordSha256, v: 1 }],
    expectedHead: { generation: head.generation, operationSha256: head.operationSha256 },
    instant: "2026-10-01T00:00:07.000Z", operationId: "op_fixture_tombstone" });
  return authority;
}

describe("frozen memory-context V1 fixture", () => {
  test("reproduces every pinned digest from a fresh store", async () => {
    const authority = await buildFixtureStore();
    const history = await captureOhMemoryContextV1({ working: { store: authority.store } });
    expect(ohMemoryContextHistorySha256V1(history)).toBe(fixture.historySha256);
    expect(history.leaves.map((leaf) => ohMemoryContextLeafSha256V1(leaf)))
      .toEqual(fixture.leafSha256s);
    expect(history.leaves.at(-1)!.kind).toBe("tombstone");
    const cover = ohMemoryContextCoverV1(history.leaves.length, 2);
    expect(cover.map((range) => ({ end: range.end, start: range.start })))
      .toEqual(fixture.cover);
    expect(cover.map((range) => ohMemoryContextNodeSha256V1(
      createOhMemoryContextNodeV1(history, range.start, range.end))))
      .toEqual(fixture.nodeSha256s);
    const recipe = { policySha256: canonicalSha256("policy.fixture.v1"),
      promptSha256: canonicalSha256("prompt.fixture.v1"),
      summarizerSha256: canonicalSha256("summarizer.fixture.v1") };
    const summaryNode = createOhMemoryContextNodeV1(history, 0, 4);
    expect(ohMemoryContextNodeSha256V1(summaryNode)).toBe(fixture.summaryNodeSha256);
    const summary = {
      body: "Fixtures zero through three were written; fixture zero was later removed.",
      childrenSha256s: [],
      historySha256: fixture.historySha256, nodeSha256: fixture.summaryNodeSha256,
      ...recipe, sourcesSha256: summaryNode.sourcesSha256, v: 1 as const };
    expect(ohMemoryContextSummarySha256V1(summary)).toBe(fixture.summarySha256);
    const generation = { generation: 1, historySha256: fixture.historySha256,
      ...recipe, summaries: [{ nodeSha256: fixture.summaryNodeSha256,
        summarySha256: fixture.summarySha256 }], v: 1 as const };
    expect(ohMemoryContextGenerationSha256V1(generation))
      .toBe(fixture.generationSha256);
    await authority.store.close();
  });

  test("serves the published generation inside a real read", async () => {
    const authority = await buildFixtureStore();
    const history = await captureOhMemoryContextV1({ working: { store: authority.store } });
    const host = createOhMemoryContextHostV1({
      continuationKey: new Uint8Array(32).fill(3),
      resolveAccess: (ref) => ({ historySha256: ref.historySha256, indices: null,
        lanes: null, revision: 1, state: "active" as const, v: 1 as const }),
      working: { expectedBindingSha256: authority.store.binding.bindingSha256,
        store: authority.store } });
    const ref = await host.admit(history, { recentLeaves: 2 });
    const reader = host.bind(ref);
    const empty = await reader.overview();
    const pool = {
      generation: { generation: 1,
        historySha256: fixture.historySha256,
        policySha256: canonicalSha256("policy.fixture.v1"),
        promptSha256: canonicalSha256("prompt.fixture.v1"),
        summaries: [{ nodeSha256: fixture.summaryNodeSha256,
          summarySha256: fixture.summarySha256 }],
        summarizerSha256: canonicalSha256("summarizer.fixture.v1"), v: 1 as const },
      nodes: [createOhMemoryContextNodeV1(history, 0, 4)],
      summaries: [{
        body: "Fixtures zero through three were written; fixture zero was later removed.",
        childrenSha256s: [], historySha256: fixture.historySha256,
        nodeSha256: fixture.summaryNodeSha256,
        policySha256: canonicalSha256("policy.fixture.v1"),
        promptSha256: canonicalSha256("prompt.fixture.v1"),
        sourcesSha256: createOhMemoryContextNodeV1(history, 0, 4).sourcesSha256,
        summarizerSha256: canonicalSha256("summarizer.fixture.v1"), v: 1 as const }] };
    const published = await host.publishDerivatives(ref, pool,
      empty.binding.generationSha256);
    expect(published).toBe(fixture.generationSha256);
    const page = await reader.overview();
    const summarized = page.items.find((item) => item.kind === "summary");
    expect(summarized?.kind === "summary" && summarized.summarySha256)
      .toBe(fixture.summarySha256);
    const tombstoned = page.items.find((item) => item.kind === "leaf"
      && item.leaf.kind === "tombstone");
    expect(tombstoned?.kind === "leaf" && tombstoned.record).toBe(null);
    await authority.store.close();
  });
});
