import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { OhRecordCodecRegistry } from "../../src/contract";
import { createKnowledgeGraphRecordV1 } from "../../src/graph";
import { createOhMemoryAuthorityV1, type OhMemoryNamedProgramV2, type OhMemoryProofV1 } from "../../src/memory";
import { createOhProjectionDatasetV1, createOhProjectionFactV1, createOhProjectionLiteralV1,
  createOhProjectionQueryV1, createOhProjectionRulePackV1, createOhProjectionRuleV1,
  createOhProjectionSnapshotV1, evaluateOhProjectionV1, ohProjectionVariableV1 as variable,
  type OhProjectionTermV1 } from "../../src/projection";
import { createOhSqliteStoreAuthorityV1 } from "../../src/sqlite/port";
import { OhSqliteStore } from "../../src/sqlite/store";
import { OH_CANONICAL_STORE_PROFILE_V1, OH_WORKING_STORE_PROFILE_V1, OhConflictError } from "../../src/store";
import { mean, percentile, random } from "./metrics";

type Edge = Readonly<{ from: string; to: string }>;
type Event = Readonly<{ key: string; edge: Edge | null }>;
type Check = Readonly<{ seed: number; category: string; passed: boolean; queryMs?: number;
  expected?: readonly string[]; actual?: readonly string[]; appendOnlyCorrect?: boolean }>;
const instant = "2026-01-01T00:00:00.000Z";
const literal = (relation: string, ...terms: OhProjectionTermV1[]) => createOhProjectionLiteralV1({ relation, terms });

function parseEdge(value: unknown): Edge | null {
  return isPlainRecord(value) && hasExactKeys(value, ["from", "to"])
    && typeof value.from === "string" && typeof value.to === "string"
    && /^n\d{1,3}$/.test(value.from) && /^n\d{1,3}$/.test(value.to)
    ? { from: value.from, to: value.to } : null;
}

function replay(events: readonly Event[]): Edge[] {
  const current = new Map<string, Edge>();
  for (const event of events) {
    if (event.edge === null) current.delete(event.key);
    else current.set(event.key, event.edge);
  }
  return [...current.values()];
}

function reachable(edges: readonly Edge[], source: string): string[] {
  const visited = new Set<string>();
  const queue = [source];
  for (let index = 0; index < queue.length; index += 1) {
    for (const edge of edges) {
      if (edge.from !== queue[index] || visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push(edge.to);
    }
  }
  return [...visited].sort();
}

function memoryProgram(): OhMemoryNamedProgramV2 {
  const lane = variable("lane");
  const from = variable("source");
  const via = variable("via");
  const to = variable("target");
  const rulePack = createOhProjectionRulePackV1({ rulePackId: "benchmark.reachability", rulePackRevision: 1, rules: [
    createOhProjectionRuleV1({ body: [literal("benchmark.edge", lane, from, to)],
      head: literal("benchmark.path", lane, from, to), ruleId: "benchmark.direct" }),
    createOhProjectionRuleV1({ body: [literal("benchmark.path", lane, from, via), literal("benchmark.edge", lane, via, to)],
      head: literal("benchmark.path", lane, from, to), ruleId: "benchmark.transitive" }),
  ] });
  return { v: 2, programId: "benchmark.reachable", purpose: "benchmark.state", parameters: ["source"],
    pageSize: 64, maximumRows: 64, maximumPageBytes: 1024 * 1024,
    evaluation: { maximumDerivedTuples: 2_048, maximumProofDepth: 64, maximumProofNodes: 256,
      maximumResultBytes: 8 * 1024 * 1024, maximumRounds: 64, maximumTotalProofNodes: 8_192, maximumWorkUnits: 2_000_000 },
    query: createOhProjectionQueryV1({ find: ["lane", "target"], limit: 64, queryId: "benchmark.reachable",
      where: [literal("benchmark.path", lane, from, to)] }), rulePack };
}

function sources(proofs: readonly OhMemoryProofV1[]) {
  return proofs.flatMap((proof): { key: string; recordSha256: string; lane: string }[] => {
    if (proof.kind === "fact") return proof.sources.map(({ key, recordSha256, lane }) => ({ key, recordSha256, lane }));
    return proof.kind === "derived" ? sources(proof.premises) : [];
  });
}

async function stateSeed(seed: number, steps: number): Promise<Check[]> {
  const canonical = createOhSqliteStoreAuthorityV1({ path: ":memory:", profile: OH_CANONICAL_STORE_PROFILE_V1,
    realmId: "realm:benchmark-canonical", spaceId: "benchmark-canonical" });
  const working = createOhSqliteStoreAuthorityV1({ path: ":memory:", profile: OH_WORKING_STORE_PROFILE_V1,
    realmId: "realm:benchmark-working", spaceId: "benchmark-working" });
  const checks: Check[] = [];
  try {
    const initialCanonicalHead = await canonical.store.head();
    const memory = await createOhMemoryAuthorityV1({ actorId: "benchmark.agent", adoptionActorId: "benchmark.host",
      canonical: { authorityId: "benchmark.canonical", expectedBindingSha256: canonical.store.binding.bindingSha256,
        expectedHead: initialCanonicalHead, store: canonical.store },
      working: { authorityId: "benchmark.working", expectedBindingSha256: working.store.binding.bindingSha256,
        store: working.store, codecs: new OhRecordCodecRegistry().register({ kind: "entity", parse: parseEdge }) },
      programs: [memoryProgram()], now: () => new Date(instant),
      extractors: [{ extractorId: "benchmark.edges", extractorSha256: canonicalSha256({ id: "benchmark.edges", v: 1 }),
        relations: ["benchmark.edge"], extract: ({ lane, record }) => {
          const edge = parseEdge(record.value);
          return edge === null ? [] : [{ relation: "benchmark.edge", tuple: [lane, edge.from, edge.to], v: 1 }];
        } }],
    });
    const events: Event[] = [];
    const query = (source: string) => memory.agent.query({ bindings: { source }, continuation: null,
      programId: "benchmark.reachable", v: 2 });
    const mutate = async (key: string, edge: Edge | null) => {
      const snapshot = await working.store.snapshot();
      const prior = snapshot.records.find((record) => record.key === key);
      if (edge === null && prior === undefined) throw new Error("Synthetic retraction must name an existing record.");
      const request = { expectedHead: { generation: snapshot.head.generation, operationSha256: snapshot.head.operationSha256 },
        puts: edge === null ? [] : [{ dependencies: [], key, kind: "entity", v: 1, value: edge }],
        requestId: `op_state_${seed}_${events.length}`, tombstones: edge === null
          ? [{ key, priorSha256: prior!.recordSha256, v: 1 }] : [], v: 1 };
      const receipt = await memory.agent.remember(request);
      events.push({ key, edge });
      return { receipt, request };
    };
    const assess = async (source: string, category: string) => {
      const start = performance.now();
      const result = await query(source);
      const queryMs = performance.now() - start;
      const actual = result.rows.filter((row) => row.values[0] === "working").map((row) => String(row.values[1])).sort();
      const expected = reachable(replay(events), source);
      const appendOnly = reachable(events.flatMap((event) => event.edge === null ? [] : [event.edge]), source);
      checks.push({ seed, category, passed: canonicalJson(actual) === canonicalJson(expected), queryMs, expected, actual,
        appendOnlyCorrect: canonicalJson(appendOnly) === canonicalJson(expected) });
      const snapshot = await working.store.snapshot();
      for (const [pageRow, row] of result.rows.entries()) {
        if (row.values[0] !== "working") continue;
        const explanation = await memory.agent.explain({ pageRow, resultSha256: result.resultSha256,
          token: result.explainCapability.token, v: 2 });
        const support = sources(explanation.proofs);
        checks.push({ seed, category: "current-proof-provenance", passed: !explanation.proofsTruncated
          && support.length > 0 && support.every((source) => source.lane === "working"
            && snapshot.records.some((record) => record.key === source.key && record.recordSha256 === source.recordSha256)) });
      }
      return result;
    };
    await mutate("entity:root-left", { from: "n0", to: "n1" });
    await mutate("entity:left-leaf", { from: "n1", to: "n3" });
    await mutate("entity:root-right", { from: "n0", to: "n2" });
    await mutate("entity:right-leaf", { from: "n2", to: "n3" });
    await assess("n0", "multi-hop");
    await mutate("entity:root-left", null);
    await assess("n0", "independent-support-survives");
    await mutate("entity:root-right", null);
    await assess("n0", "last-support-retraction");
    const remembered = await mutate("entity:root-left", { from: "n0", to: "n4" });
    await assess("n0", "knowledge-update");
    const replayed = await memory.agent.remember(remembered.request);
    checks.push({ seed, category: "idempotent-write", passed: canonicalJson(replayed) === canonicalJson(remembered.receipt) });
    let rejected = false;
    try { await memory.agent.remember({ ...remembered.request, requestId: "op_stale", puts: [
      { dependencies: [], key: "entity:stale", kind: "entity", v: 1, value: { from: "n0", to: "n9" } },
    ] }); } catch (error) { rejected = error instanceof OhConflictError; }
    checks.push({ seed, category: "stale-write-rejected", passed: rejected
      && canonicalJson(await working.store.head()) === canonicalJson(remembered.receipt.head) });
    const next = random(seed);
    for (let step = 0; step < steps; step += 1) {
      const slot = Math.floor(next() * 12);
      const key = `entity:random-${slot}`;
      const prior = (await working.store.snapshot()).records.find((record) => record.key === key);
      const remove = prior !== undefined && next() < 0.3;
      const from = Math.floor(next() * 8);
      const to = from + 1 + Math.floor(next() * (9 - from));
      await mutate(key, remove ? null : { from: `n${from}`, to: `n${to}` });
      await assess(`n${Math.floor(next() * 8)}`, remove ? "random-retraction" : prior ? "random-update" : "random-recall");
    }
    await assess("n99", "absent-premise");
    const conflicting = createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:root-left", kind: "entity", v: 1,
      value: { from: "n0", to: "n5" } });
    await canonical.store.commit({ actorId: "benchmark.host", expectedHead: initialCanonicalHead,
      changes: [{ kind: "put", record: conflicting, v: 1 }], operationId: "op_canonical_conflict", instant });
    const pinned = await query("n0");
    checks.push({ seed, category: "canonical-pin", passed: canonicalJson(pinned.identity.canonical.head) === canonicalJson(initialCanonicalHead) });
    await memory.host.advanceCanonical({ expectedHead: initialCanonicalHead, nextHead: await canonical.store.head(), v: 1 });
    const conflict = await query("n0");
    checks.push({ seed, category: "visible-authority-conflict", passed: conflict.conflicts.count === 1
      && conflict.rows.some((row) => row.values[0] === "canonical" && row.values[1] === "n5")
      && conflict.rows.some((row) => row.values[0] === "working" && row.values[1] === "n4") });
    checks.push({ seed, category: "operation-replay-integrity", passed: (await working.store.verify()).integrity === "verified"
      && (await canonical.store.verify()).integrity === "verified" });
  } finally { await working.store.close(); await canonical.store.close(); }
  return checks;
}

export async function runState(seed: number, steps: number) {
  const rows: Check[] = [];
  for (const offset of [0, 1, 2]) rows.push(...await stateSeed(seed + offset, steps));
  const measured = rows.filter((row) => row.queryMs !== undefined);
  return { status: rows.every((row) => row.passed) ? "passed" : "failed", rows,
    summaries: { checks: rows.length, passed: rows.filter((row) => row.passed).length,
      queryP50Ms: percentile(measured.map((row) => row.queryMs!), 0.5),
      queryP95Ms: percentile(measured.map((row) => row.queryMs!), 0.95),
      ohExactStateAccuracy: mean(measured.map((row) => Number(row.passed))),
      appendOnlyAblationAccuracy: mean(measured.map((row) => Number(row.appendOnlyCorrect))),
      byCategory: Object.fromEntries([...new Set(rows.map((row) => row.category))].sort().map((category) => {
        const selected = rows.filter((row) => row.category === category);
        return [category, { checks: selected.length, passed: selected.filter((row) => row.passed).length }];
      })) },
    resultSha256: canonicalSha256(rows.map(({ queryMs: _queryMs, ...row }) => row)),
    qualifications: ["Synthetic, typed observations; no language extraction, model reader, or judge.",
      "Oh is checked against an independent full-history replay plus breadth-first reachability oracle.",
      "Append-only is a deliberately stale-state ablation, not an implementation of any OSS competitor.",
      "Retractions are validated through exact-head recomputation, not incremental invalidation."] };
}

export async function runProjection(sizes: readonly number[], repeat: number) {
  const rows = [];
  for (const size of sizes) {
    const store = new OhSqliteStore({ path: ":memory:", spaceId: "benchmark-projection" });
    try {
      const records = Array.from({ length: size - 1 }, (_, index) => createKnowledgeGraphRecordV1({
        dependencies: [], key: `entity:edge-${index}`, kind: "entity", v: 1,
        value: { from: `n${index}`, to: `n${index + 1}` },
      }));
      store.commit({ actorId: "benchmark.projection", expectedHead: store.head(), operationId: "op_seed", instant,
        changes: records.map((record) => ({ kind: "put", record, v: 1 })) });
      const snapshot = createOhProjectionSnapshotV1({ head: store.head(), records, spaceId: store.spaceId });
      const dataset = createOhProjectionDatasetV1({ snapshot, extractorSha256: canonicalSha256({ id: "benchmark.chain", v: 1 }),
        factPackId: "benchmark.chain", factPackRevision: 1, facts: records.map((record) => {
          const edge = parseEdge(record.value)!;
          return createOhProjectionFactV1({ relation: "edge", tuple: [edge.from, edge.to],
            sources: [{ key: record.key, recordSha256: record.recordSha256, v: 1 }] });
        }) });
      const from = variable("from"); const via = variable("via"); const to = variable("to");
      const rulePack = createOhProjectionRulePackV1({ rulePackId: "benchmark.chain", rulePackRevision: 1, rules: [
        createOhProjectionRuleV1({ body: [literal("edge", from, to)], head: literal("path", from, to), ruleId: "path.direct" }),
        createOhProjectionRuleV1({ body: [literal("path", from, via), literal("edge", via, to)],
          head: literal("path", from, to), ruleId: "path.transitive" }),
      ] });
      const query = createOhProjectionQueryV1({ queryId: "benchmark.paths", find: ["from", "to"], limit: 4096,
        where: [literal("path", from, to)] });
      const input = { snapshot, dataset, rulePack, query, options: { maximumProofDepth: 64 } };
      const warmup = evaluateOhProjectionV1(input);
      const timings: number[] = [];
      const hashes: string[] = [];
      for (let index = 0; index < repeat; index += 1) {
        const start = performance.now();
        const result = evaluateOhProjectionV1(input);
        timings.push(performance.now() - start);
        hashes.push(result.resultSha256);
      }
      rows.push({ size, repeat, expectedRows: size * (size - 1) / 2, actualRows: warmup.rows.length,
        passed: !warmup.stats.truncated && !warmup.stats.proofsTruncated
          && warmup.rows.length === size * (size - 1) / 2 && hashes.every((hash) => hash === warmup.resultSha256),
        resultSha256: warmup.resultSha256, stats: warmup.stats, timingsMs: timings,
        p50Ms: percentile(timings, 0.5), p95Ms: percentile(timings, 0.95) });
    } finally { store.close(); }
  }
  return { status: rows.every((row) => row.passed) ? "passed" : "failed", rows, summaries: rows,
    qualifications: ["Local wall-clock timings include complete projection evaluation and proof construction, excluding fixture setup.",
      "One untimed warmup precedes repeated runs. Result hashes must agree, including work-unit statistics and proofs."] };
}
