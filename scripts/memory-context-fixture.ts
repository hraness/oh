// Regenerates tests/fixtures/memory-context-v1.json. The fixture pins exact
// digests for a small deterministic scenario so the reader's canonical
// encodings cannot drift silently.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, canonicalSha256 } from "../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../src/graph";
import {
  captureOhMemoryContextV1,
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

const record = (key: string, name: string) => createKnowledgeGraphRecordV1({
  dependencies: [], key, kind: "entity", v: 1, value: { name } });

const authority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
  profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:fixture", spaceId: "fixture.context" });
const store = authority.store;
const keys: string[] = [];
for (let index = 0; index < 7; index += 1) {
  const key = `entity:fixture-${index}`;
  keys.push(key);
  const head = await store.head();
  await store.commit({ actorId: "agent.fixture",
    changes: [{ kind: "put", record: record(key, `Fixture ${index}`), v: 1 }],
    expectedHead: { generation: head.generation, operationSha256: head.operationSha256 },
    instant: `2026-10-01T00:00:0${index}.000Z`, operationId: `op_fixture_${index}` });
}
{
  const head = await store.head();
  const removed = await store.snapshot({ head: { operationSha256: head.operationSha256,
    sequence: head.sequence } });
  const prior = removed.records.find((entry) => entry.key === "entity:fixture-0")!;
  await store.commit({ actorId: "agent.fixture",
    changes: [{ key: "entity:fixture-0", kind: "tombstone",
      priorSha256: prior.recordSha256, v: 1 }],
    expectedHead: { generation: head.generation, operationSha256: head.operationSha256 },
    instant: "2026-10-01T00:00:07.000Z", operationId: "op_fixture_tombstone" });
}

const history = await captureOhMemoryContextV1({ working: { store } });
const cover = ohMemoryContextCoverV1(history.leaves.length, 2);
const nodes = cover.map((range) => createOhMemoryContextNodeV1(history, range.start, range.end));
const recipe = { policySha256: canonicalSha256("policy.fixture.v1"),
  promptSha256: canonicalSha256("prompt.fixture.v1"),
  summarizerSha256: canonicalSha256("summarizer.fixture.v1") };
const summaryNode = createOhMemoryContextNodeV1(history, 0, 4);
const summary = { body: "Fixtures zero through three were written; fixture zero was later removed.",
  childrenSha256s: [], historySha256: ohMemoryContextHistorySha256V1(history),
  nodeSha256: ohMemoryContextNodeSha256V1(summaryNode), ...recipe,
  sourcesSha256: summaryNode.sourcesSha256, v: 1 as const };
const generation = { generation: 1,
  historySha256: ohMemoryContextHistorySha256V1(history), ...recipe,
  summaries: [{ nodeSha256: summary.nodeSha256,
    summarySha256: ohMemoryContextSummarySha256V1(summary) }], v: 1 as const };
const fixture = {
  comment: "Pinned memory-context V1 digests for the seven-put one-tombstone fixture scenario.",
  cover: cover.map((range) => ({ end: range.end, start: range.start })),
  generationSha256: ohMemoryContextGenerationSha256V1(generation),
  historySha256: ohMemoryContextHistorySha256V1(history),
  leafSha256s: history.leaves.map((leaf) => ohMemoryContextLeafSha256V1(leaf)),
  nodeSha256s: nodes.map((node) => ohMemoryContextNodeSha256V1(node)),
  summarySha256: ohMemoryContextSummarySha256V1(summary),
  summaryNodeSha256: summary.nodeSha256,
  v: 1 as const,
};
const out = join(import.meta.dir, "..", "tests", "fixtures", "memory-context-v1.json");
await mkdir(join(import.meta.dir, "..", "tests", "fixtures"), { recursive: true });
await writeFile(out, `${JSON.stringify(JSON.parse(canonicalJson(fixture)), null, 2)}\n`);
await store.close();
console.log(`wrote ${out}`);
console.log(canonicalJson({ historySha256: fixture.historySha256,
  leaves: history.leaves.length }));
