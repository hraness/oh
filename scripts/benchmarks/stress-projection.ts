// stress-projection.ts
// Offline projection saturation stress helper. Network-free; writes only the requested new report.
// Run: bun run ./scripts/benchmarks/stress-projection.ts --expected-source-sha256 HEX --output ABS.json
//
// Exercises the real oh-io/oh-graph/oh-projection public APIs against synthetic
// reachability fixtures, cross-checked against an independent BFS oracle.
// Never mutates the repository; writes only the requested output file.

import {
  beginStressRun,
  finishStressRun,
  parseStressArguments,
  writeStressReport,
} from "./stress-common";
import type { OhProjectionProofV1, OhProjectionResultV1 } from "../../src/projection";

class StressFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StressFailure";
  }
}

function fail(message: string): never {
  throw new StressFailure(message);
}

// ---- deterministic PRNG / shuffle (seed 17) ----
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// ---- graph fixtures ----
type Edge = readonly [number, number];
type Fixture = Readonly<{ name: string; nodes: number; edges: readonly Edge[] }>;

function chainEdges(n: number): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < n - 1; i += 1) edges.push([i, i + 1]);
  return edges;
}
function cycleEdges(n: number): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < n; i += 1) edges.push([i, (i + 1) % n]);
  return edges;
}
function outwardStar(n: number): Edge[] {
  const edges: Edge[] = [];
  for (let i = 1; i < n; i += 1) edges.push([0, i]);
  return edges;
}
function inwardStar(n: number): Edge[] {
  const edges: Edge[] = [];
  for (let i = 1; i < n; i += 1) edges.push([i, 0]);
  return edges;
}
function disconnectedChains(totalNodes: number, chainLength: number): Edge[] {
  const edges: Edge[] = [];
  for (let base = 0; base < totalNodes; base += chainLength) {
    for (let i = 0; i < chainLength - 1; i += 1) edges.push([base + i, base + i + 1]);
  }
  return edges;
}
function denseDag(n: number): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) edges.push([i, j]);
  return edges;
}

function buildFixtures(): readonly Fixture[] {
  const fixtures: Fixture[] = [];
  fixtures.push({ name: "empty0", nodes: 0, edges: [] });
  fixtures.push({ name: "singleton-noedges1", nodes: 1, edges: [] });
  fixtures.push({ name: "selfloop1", nodes: 1, edges: [[0, 0]] });
  for (const n of [2, 8, 16, 32]) fixtures.push({ name: `chain${n}`, nodes: n, edges: chainEdges(n) });
  for (const n of [2, 3, 8, 12]) fixtures.push({ name: `directedcycle${n}`, nodes: n, edges: cycleEdges(n) });
  for (const n of [8, 32]) fixtures.push({ name: `outwardstar${n}`, nodes: n, edges: outwardStar(n) });
  for (const n of [8, 32]) fixtures.push({ name: `inwardstar${n}`, nodes: n, edges: inwardStar(n) });
  fixtures.push({ name: "diamond4", nodes: 4, edges: [[0, 1], [0, 2], [1, 3], [2, 3]] });
  fixtures.push({ name: "disconnected8", nodes: 8, edges: disconnectedChains(8, 4) });
  fixtures.push({
    name: "selfloopspluschain8", nodes: 8,
    edges: [...chainEdges(8), ...Array.from({ length: 8 }, (_, i): Edge => [i, i])],
  });
  fixtures.push({
    name: "bidirectionalchain8", nodes: 8,
    edges: [...chainEdges(8), ...chainEdges(8).map(([a, b]): Edge => [b, a])],
  });
  fixtures.push({ name: "denseDAG12", nodes: 12, edges: denseDag(12) });
  return fixtures;
}

function dedupeEdges(edges: readonly Edge[]): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (const edge of edges) {
    const key = `${edge[0]}-${edge[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

// ---- independent BFS oracle ----
function bfsOracle(nodes: number, edges: readonly Edge[]): readonly (readonly [number, number])[] {
  const adjacency = new Map<number, number[]>();
  for (const [from, to] of edges) {
    const list = adjacency.get(from);
    if (list === undefined) adjacency.set(from, [to]); else list.push(to);
  }
  const rows: (readonly [number, number])[] = [];
  for (let s = 0; s < nodes; s += 1) {
    const start = adjacency.get(s) ?? [];
    const visited = new Set<number>(start);
    const queue = [...start];
    while (queue.length > 0) {
      const v = queue.shift() as number;
      for (const w of adjacency.get(v) ?? []) {
        if (!visited.has(w)) { visited.add(w); queue.push(w); }
      }
    }
    for (const t of visited) rows.push([s, t]);
  }
  rows.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return rows;
}

// ---- benchmark driver ----
type ProjectionApi = typeof import("../../src/projection");
type GraphApi = typeof import("../../src/graph");

type CaseReport = {
  name: string;
  nodes: number;
  edges: number;
  permutations: { label: string; resultSha256: string; proofCount: number; rounds: number; workUnits: number }[];
  oracleClosureHash: string;
  orderInvariant: boolean;
  matchesOracle: boolean;
  truncationOk: boolean;
  parsedRoundtripOk: boolean;
  passed: boolean;
  failures: string[];
};

export async function main(argv: readonly string[]): Promise<void> {
  const run = await beginStressRun(new URL(import.meta.url), parseStressArguments(argv));
  try {
    // Repository modules are imported only after the shared network tripwire is installed.
    const projection = await import("../../src/projection");
    const graph = await import("../../src/graph");
    const canonical = await import("../../src/canonical");

    const identityBefore = run.identityBefore;

    const v = projection.ohProjectionVariableV1;
    const c = projection.ohProjectionConstantV1;
    const literal = (relation: string, ...terms: ReturnType<typeof v>[]) =>
      projection.createOhProjectionLiteralV1({ relation, terms });

    function nodeName(i: number): string { return `n${i}`; }

    function edgeRecord(from: number, to: number) {
      return graph.createKnowledgeGraphRecordV1({
        dependencies: [], key: `view:edge-n${from}-n${to}`,
        kind: "view", v: 1, value: { from: nodeName(from), to: nodeName(to) },
      });
    }

    const syntheticDigest = (character: string) => {
      const value = canonical.parseSha256Hex(character.repeat(64));
      if (value === null) fail("invalid synthetic digest fixture");
      return value;
    };

    function buildSnapshot(records: readonly ReturnType<typeof edgeRecord>[]) {
      const refs = [...records].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        .map(graph.knowledgeGraphRecordRefV1);
      return projection.createOhProjectionSnapshotV1({
        head: {
          generation: 1,
          graphRevisionSha256: syntheticDigest("1"),
          operationSha256: syntheticDigest("2"),
          recordsSha256: canonical.canonicalSha256(refs),
          sequence: 1,
        },
        records, spaceId: "session.saturate",
      });
    }

    function buildDataset(records: readonly ReturnType<typeof edgeRecord>[], snap: ReturnType<typeof buildSnapshot>) {
      const facts = records.map((record) => {
        const value = record.value;
        if (!canonical.isPlainRecord(value)
          || typeof value.from !== "string" || typeof value.to !== "string") {
          fail("synthetic edge record lost its endpoint values");
        }
        return projection.createOhProjectionFactV1({
          relation: "edge",
          sources: [{ key: record.key, recordSha256: record.recordSha256, v: 1 }],
          tuple: [value.from, value.to],
        });
      });
      return projection.createOhProjectionDatasetV1({
        extractorSha256: syntheticDigest("e"), factPackId: "saturate.edges", factPackRevision: 1,
        facts, snapshot: snap,
      });
    }

    function buildRulePack(reverse: boolean) {
      const x = v("x"); const y = v("y"); const z = v("z");
      const direct = projection.createOhProjectionRuleV1({
        body: [literal("edge", x, y)], head: literal("path", x, y), ruleId: "path.direct",
      });
      const transitive = projection.createOhProjectionRuleV1({
        body: [literal("path", x, y), literal("edge", y, z)], head: literal("path", x, z),
        ruleId: "path.transitive",
      });
      return projection.createOhProjectionRulePackV1({
        rulePackId: "saturate.reachability", rulePackRevision: 1,
        rules: reverse ? [transitive, direct] : [direct, transitive],
      });
    }

    function allPairsQuery(limit: number) {
      return projection.createOhProjectionQueryV1({
        find: ["x", "z"], limit, queryId: "all.pairs",
        where: [literal("path", v("x"), v("z"))],
      });
    }

    function countProofNodes(proof: OhProjectionProofV1): number {
      return proof.kind === "derived"
        ? 1 + proof.premises.reduce((sum: number, premise) => sum + countProofNodes(premise), 0)
        : 1;
    }

    const OH_LIMITS = projection.OH_PROJECTION_LIMITS_V1;
    const reports: CaseReport[] = [];
    let allPassed = true;

    function evaluateFor(
      permutationRecords: readonly ReturnType<typeof edgeRecord>[],
      reverseRules: boolean,
      query: ReturnType<typeof allPairsQuery>,
      options: NonNullable<Parameters<ProjectionApi["evaluateOhProjectionV1"]>[0]["options"]>,
    ) {
      const snap = buildSnapshot(permutationRecords);
      const dataset = buildDataset(permutationRecords, snap);
      const rulePack = buildRulePack(reverseRules);
      return projection.evaluateOhProjectionV1({ dataset, options, query, rulePack, snapshot: snap });
    }

    let normalAttempted = 0;
    let normalSucceeded = 0;
    function runFixtureCase(fixture: Fixture): CaseReport {
      const failures: string[] = [];
      const edges = dedupeEdges(fixture.edges);
      const records = edges.map(([from, to]) => edgeRecord(from, to));
      const oracle = bfsOracle(fixture.nodes, edges);
      const oracleTuples = oracle.map(([a, b]) => [nodeName(a), nodeName(b)]);
      const oracleClosureHash = canonical.canonicalSha256(oracleTuples);
      const limit = Math.min(Math.max(fixture.nodes * fixture.nodes, 1), OH_LIMITS.queryResults);
      const query = allPairsQuery(limit);
      const options = { maximumProofDepth: 64, maximumTotalProofNodes: 65_536 };

      const orderings: { label: string; records: readonly ReturnType<typeof edgeRecord>[]; reverse: boolean }[] = [
        { label: "original", records, reverse: false },
        { label: "reverse", records: [...records].reverse(), reverse: true },
        { label: "seed17shuffle", records: seededShuffle(records, 17), reverse: false },
      ];

      const permutationReports: CaseReport["permutations"] = [];
      const resultShas = new Set<string>();
      let matchesOracle = true;
      let truncationOk = true;
      let parsedRoundtripOk = true;

      for (const ordering of orderings) {
        normalAttempted += 1;
        let result: OhProjectionResultV1;
        try {
          result = evaluateFor(ordering.records, ordering.reverse, query, options);
        } catch (error) {
          failures.push(`${ordering.label}: evaluation threw: ${(error as Error).message}`);
          allPassed = false;
          continue;
        }
        const parsed = projection.parseOhProjectionResultV1(result, result.identity.projectionSha256);
        if (parsed === null || parsed.resultSha256 !== result.resultSha256) {
          parsedRoundtripOk = false;
          failures.push(`${ordering.label}: parseOhProjectionResultV1 roundtrip failed`);
        }
        const actualTuples = [...result.rows.map((row) => canonical.canonicalJson(row.values))].sort();
        const expectedTuples = [...oracleTuples.map((t) => canonical.canonicalJson(t))].sort();
        if (canonical.canonicalJson(actualTuples) !== canonical.canonicalJson(expectedTuples)) {
          matchesOracle = false;
          failures.push(`${ordering.label}: row values do not match BFS oracle`);
        }
        if (result.stats.truncated) {
          truncationOk = false;
          failures.push(`${ordering.label}: unexpected row truncation`);
        }
        if (result.stats.proofsTruncated) {
          truncationOk = false;
          failures.push(`${ordering.label}: unexpected proof truncation`);
        }
        const proofCount = result.rows.reduce(
          (sum, row) => sum + row.proofs.reduce((inner, proof) => inner + countProofNodes(proof), 0), 0);
        permutationReports.push({
          label: ordering.label, resultSha256: result.resultSha256, proofCount,
          rounds: result.stats.rounds, workUnits: result.stats.workUnits,
        });
        resultShas.add(result.resultSha256);
        normalSucceeded += 1;
      }

      const orderInvariant = permutationReports.length === 3 && resultShas.size === 1;
      if (!orderInvariant) failures.push("resultSha256 differs across input permutations");

      const passed = failures.length === 0;
      if (!passed) allPassed = false;
      return {
        name: fixture.name, nodes: fixture.nodes, edges: edges.length,
        permutations: permutationReports, oracleClosureHash, orderInvariant,
        matchesOracle, truncationOk, parsedRoundtripOk, passed, failures,
      };
    }

    const fixtures = buildFixtures();
    if (fixtures.length !== 20) fail(`expected exactly 20 fixtures, got ${fixtures.length}`);
    if (new Set(fixtures.map((f) => f.name)).size !== fixtures.length) fail("fixture names must be unique");
    for (const fixture of fixtures) reports.push(runFixtureCase(fixture));
    if (reports.some((r) => r.permutations.length !== 3)) {
      fail("every fixture must produce exactly 3 successful permutation reports");
    }

    // Sharp proof-budget cases.
    const sharpFailures: string[] = [];
    let sharpAttempted = 0;
    let sharpSucceeded = 0;
    function trySharpEval(
      label: string, fn: () => ReturnType<ProjectionApi["evaluateOhProjectionV1"]>,
    ): ReturnType<ProjectionApi["evaluateOhProjectionV1"]> | null {
      sharpAttempted += 1;
      try {
        const result = fn();
        sharpSucceeded += 1;
        return result;
      } catch (error) {
        sharpFailures.push(`${label}: evaluation threw: ${(error as Error).message}`);
        allPassed = false;
        return null;
      }
    }
    const chain8Edges = chainEdges(8);
    const chain8Records = chain8Edges.map(([f, t]) => edgeRecord(f, t));
    const chain8Query = allPairsQuery(64);

    const chain8Cap168 = trySharpEval("chain8 cap168",
      () => evaluateFor(chain8Records, false, chain8Query, { maximumTotalProofNodes: 168 }));
    if (chain8Cap168 === null) {
      sharpFailures.push("chain8 cap168: no result to validate");
    } else {
      if (chain8Cap168.rows.length !== 28 || chain8Cap168.stats.truncated !== false
        || chain8Cap168.stats.proofsTruncated !== false || chain8Cap168.stats.proofNodes !== 168) {
        sharpFailures.push("chain8 cap168: expected 28 complete rows without truncation and proofNodes 168");
      }
      if (projection.parseOhProjectionResultV1(chain8Cap168, chain8Cap168.identity.projectionSha256) === null) {
        sharpFailures.push("chain8 cap168: roundtrip parse failed");
      }
    }

    const chain8Cap167 = trySharpEval("chain8 cap167",
      () => evaluateFor(chain8Records, false, chain8Query, { maximumTotalProofNodes: 167 }));
    if (chain8Cap167 === null) {
      sharpFailures.push("chain8 cap167: no result to validate");
    } else {
      if (chain8Cap167.rows.length !== 28 || chain8Cap167.stats.proofsTruncated !== true
        || chain8Cap167.stats.truncated !== false || chain8Cap167.stats.proofNodes !== 167) {
        sharpFailures.push("chain8 cap167: expected 28 rows, proofsTruncated true, truncated false, proofNodes 167");
      }
      if (projection.parseOhProjectionResultV1(chain8Cap167, chain8Cap167.identity.projectionSha256) === null) {
        sharpFailures.push("chain8 cap167: roundtrip parse failed");
      }
    }

    const chain64Edges = chainEdges(64);
    const chain64Records = chain64Edges.map(([f, t]) => edgeRecord(f, t));
    const fromN0Query = projection.createOhProjectionQueryV1({
      find: ["z"], limit: 4_096, queryId: "from.n0",
      where: [literal("path", c("n0"), v("z"))],
    });
    const chain64Result = trySharpEval("chain64 from n0", () => evaluateFor(chain64Records, false, fromN0Query,
      { maximumProofDepth: 64, maximumProofNodes: OH_LIMITS.proofNodes, maximumTotalProofNodes: 65_536 }));
    if (chain64Result === null) {
      sharpFailures.push("chain64 from n0: no result to validate");
    } else {
      if (chain64Result.rows.length !== 63 || chain64Result.stats.proofNodes !== 4_032
        || chain64Result.stats.truncated !== false || chain64Result.stats.proofsTruncated !== false) {
        sharpFailures.push(
          `chain64 from n0: expected 63 rows / 4032 proofNodes / complete, got rows=${chain64Result.rows.length} `
          + `proofNodes=${chain64Result.stats.proofNodes} truncated=${chain64Result.stats.truncated} `
          + `proofsTruncated=${chain64Result.stats.proofsTruncated}`);
      }
    const chain64ExpectedTuples = Array.from({ length: 63 }, (_, i) => [nodeName(i + 1)]);
      const chain64ActualTuples = [...chain64Result.rows.map((row) => canonical.canonicalJson(row.values))].sort();
      const chain64ExpectedSorted = [...chain64ExpectedTuples.map((t) => canonical.canonicalJson(t))].sort();
      if (canonical.canonicalJson(chain64ActualTuples) !== canonical.canonicalJson(chain64ExpectedSorted)) {
        sharpFailures.push("chain64 from n0: row values do not match expected n1..n63");
      }
      if (projection.parseOhProjectionResultV1(chain64Result, chain64Result.identity.projectionSha256) === null) {
        sharpFailures.push("chain64 from n0: roundtrip parse failed");
      }
    }
    if (sharpFailures.length > 0) allPassed = false;

    const totalAttempted = normalAttempted + sharpAttempted;
    const totalSucceeded = normalSucceeded + sharpSucceeded;
    if (normalAttempted !== 60 || sharpAttempted !== 3 || totalAttempted !== 63) {
      fail(`expected 60 normal + 3 sharp = 63 attempted evaluations, got ${totalAttempted}`);
    }
    if (normalSucceeded !== 60 || sharpSucceeded !== 3 || totalSucceeded !== 63) allPassed = false;

    // This suite owns no temporary resources, so the shared finish check runs directly.
    const finished = await finishStressRun(run);
    const identityAfter = finished.identityAfter;

    const report = {
      protocol: "oh.projection-saturation-benchmark.v1",
      generatedAt: new Date().toISOString(),
      codeIdentity: { expectedSourceSha256: run.expectedSourceSha256,
        sourceSha256Before: identityBefore.sourceSha256, sourceSha256After: identityAfter.sourceSha256,
        gitHead: identityAfter.gitHead, dirty: identityAfter.dirty },
      helperFileSha256: { before: run.helperSha256Before, after: finished.helperSha256After },
      observedGlobalFetchAttempts: finished.networkAttempts,
      ownedTemporaryDirectories: 0,
      modelCalls: 0,
      fixtureCount: reports.length,
      permutationLabels: ["original", "reverse", "seed17shuffle"],
      evaluationCounts: { normalAttempted, normalSucceeded, sharpAttempted, sharpSucceeded, totalAttempted, totalSucceeded },
      cases: reports,
      sharpCases: {
        chain8Cap168: chain8Cap168 === null ? null : { rows: chain8Cap168.rows.length,
          resultSha256: chain8Cap168.resultSha256, proofsTruncated: chain8Cap168.stats.proofsTruncated,
          truncated: chain8Cap168.stats.truncated, proofNodes: chain8Cap168.stats.proofNodes },
        chain8Cap167: chain8Cap167 === null ? null : { rows: chain8Cap167.rows.length,
          resultSha256: chain8Cap167.resultSha256, proofsTruncated: chain8Cap167.stats.proofsTruncated,
          truncated: chain8Cap167.stats.truncated, proofNodes: chain8Cap167.stats.proofNodes },
        chain64FromN0: chain64Result === null ? null : { rows: chain64Result.rows.length,
          resultSha256: chain64Result.resultSha256, proofsTruncated: chain64Result.stats.proofsTruncated,
          truncated: chain64Result.stats.truncated, proofNodes: chain64Result.stats.proofNodes },
        failures: sharpFailures,
      },
      saturatedStatus: allPassed && sharpFailures.length === 0 ? "passed" : "failed",
    };

    await writeStressReport(run, report);

    if (report.saturatedStatus !== "passed") {
      const failedCases = reports.filter((r) => !r.passed).map((r) => `${r.name}: ${r.failures.join("; ")}`);
      console.error("stress-projection: benchmark did not saturate.");
      for (const line of failedCases) console.error(`  - ${line}`);
      for (const line of sharpFailures) console.error(`  - sharp: ${line}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ status: "passed", fixtures: reports.length, evaluations: totalAttempted }));
  } finally {
    run.restoreFetch();
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`stress-projection: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
