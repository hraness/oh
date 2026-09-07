import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beginStressRun, finishStressRun, parseStressArguments, type StressRun } from "../scripts/benchmarks/stress-common";
import { buildExtractionChunks } from "../scripts/benchmarks/units";
import { canonicalSha256, parseSha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1, knowledgeGraphRecordRefV1 } from "../src/graph";
import {
  createOhProjectionDatasetV1, createOhProjectionFactV1, createOhProjectionLiteralV1,
  createOhProjectionQueryV1, createOhProjectionRulePackV1, createOhProjectionRuleV1,
  createOhProjectionSnapshotV1, evaluateOhProjectionV1, ohProjectionVariableV1,
} from "../src/projection";

const HEX = "a".repeat(64);
const ROOT = resolve(import.meta.dir, "..");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function withTempDirectory<T>(body: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "oh-stress-test-"));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withStressRun(body: (run: StressRun) => Promise<void>): Promise<void> {
  await withTempDirectory(async (directory) => {
    const { codeIdentity } = await import("../scripts/benchmarks/io");
    const identity = await codeIdentity();
    const helper = new URL("../scripts/benchmarks/stress-projection.ts", import.meta.url);
    const run = await beginStressRun(helper, {
      expectedSourceSha256: identity.sourceSha256, outputPath: join(directory, "report.json"),
    });
    try { await body(run); } finally { run.restoreFetch(); }
  });
}

describe("stress helper CLI identity and output admission", () => {
  test("accepts exactly one expected hash and one absolute new output path", () => {
    const parsed = parseStressArguments(["--output", "/tmp/oh-stress/report.json", "--expected-source-sha256", HEX]);
    expect(parsed).toEqual({ expectedSourceSha256: HEX, outputPath: "/tmp/oh-stress/report.json" });
  });

  test("rejects missing, duplicate, malformed, and positional arguments", () => {
    expect(() => parseStressArguments(["--output", "/tmp/oh-stress/report.json"])).toThrow();
    expect(() => parseStressArguments(["--expected-source-sha256", HEX])).toThrow();
    expect(() => parseStressArguments(["--expected-source-sha256", HEX, "--expected-source-sha256", HEX,
      "--output", "/tmp/oh-stress/report.json"])).toThrow();
    expect(() => parseStressArguments(["--expected-source-sha256", HEX, "--output", "/tmp/a.json",
      "--output", "/tmp/b.json"])).toThrow();
    expect(() => parseStressArguments(["--expected-source-sha256", "A".repeat(64), "--output", "/tmp/a.json"])).toThrow();
    expect(() => parseStressArguments(["--expected-source-sha256", `${HEX}x`, "--output", "/tmp/a.json"])).toThrow();
    expect(() => parseStressArguments(["--expected-source-sha256", HEX, "--output", "relative.json"])).toThrow();
    expect(() => parseStressArguments(["--expected-source-sha256", HEX, "--output", "/tmp/a\u0000.json"])).toThrow();
    expect(() => parseStressArguments(["--expected-source-sha256", HEX, "--output", "/tmp/a.json", "extra"])).toThrow();
    expect(() => parseStressArguments(["--repo", "/tmp"])).toThrow();
  });

  test("refuses an output inside the checkout without writing anything", async () => {
    const helper = new URL("../scripts/benchmarks/stress-projection.ts", import.meta.url);
    const inside = join(ROOT, "oh-stress-test-inside.json");
    await expect(beginStressRun(helper, { expectedSourceSha256: HEX, outputPath: inside })).rejects.toThrow();
    expect(await Bun.file(inside).exists()).toBe(false);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  test("refuses an existing file, an existing directory, and a dangling symlink", async () => {
    const helper = new URL("../scripts/benchmarks/stress-projection.ts", import.meta.url);
    await withTempDirectory(async (directory) => {
      const existing = join(directory, "existing.json");
      await writeFile(existing, "{}\n", { mode: 0o600 });
      await expect(beginStressRun(helper, { expectedSourceSha256: HEX, outputPath: existing })).rejects.toThrow();
      expect(await Bun.file(existing).text()).toBe("{}\n");

      await expect(beginStressRun(helper, { expectedSourceSha256: HEX, outputPath: directory })).rejects.toThrow();

      const dangling = join(directory, "dangling.json");
      await symlink(join(directory, "absent-target.json"), dangling);
      await expect(beginStressRun(helper, { expectedSourceSha256: HEX, outputPath: dangling })).rejects.toThrow();
      expect(globalThis.fetch).toBe(originalFetch);
    });
  });

  test("restores the original fetch when the source digest does not match", async () => {
    const helper = new URL("../scripts/benchmarks/stress-projection.ts", import.meta.url);
    await withTempDirectory(async (directory) => {
      const output = join(directory, "report.json");
      await expect(beginStressRun(helper, { expectedSourceSha256: "0".repeat(64), outputPath: output }))
        .rejects.toThrow();
      expect(globalThis.fetch).toBe(originalFetch);
      expect(await Bun.file(output).exists()).toBe(false);
    });
  });

  test("finishes an active guard and preserves the exact source identity", async () => {
    const fetchBefore = globalThis.fetch;
    await withStressRun(async (run) => {
      const guardedFetch = globalThis.fetch;
      expect(guardedFetch).not.toBe(fetchBefore);
      const result = await finishStressRun(run);
      expect(result.identityAfter.sourceSha256).toBe(run.expectedSourceSha256);
      expect(result.helperSha256After).toBe(run.helperSha256Before);
      expect(result.networkAttempts).toBe(0);
      expect(globalThis.fetch).toBe(guardedFetch);
    });
    expect(globalThis.fetch).toBe(fetchBefore);
  });

  test("refuses to finish a session whose fetch was already restored", async () => {
    const fetchBefore = globalThis.fetch;
    await withStressRun(async (run) => {
      run.restoreFetch();
      run.restoreFetch();
      await expect(finishStressRun(run)).rejects.toThrow("network guard must remain active");
    });
    expect(globalThis.fetch).toBe(fetchBefore);
  });

  test("refuses replaced fetch and restores the original owned reference", async () => {
    const fetchBefore = globalThis.fetch;
    const replacement: typeof fetch = () => { throw new Error("The synthetic replacement must never run."); };
    await withStressRun(async (run) => {
      globalThis.fetch = replacement;
      await expect(finishStressRun(run)).rejects.toThrow("network guard must remain active");
      expect(run.networkAttempts()).toBe(0);
    });
    expect(globalThis.fetch).toBe(fetchBefore);
  });

  test("refuses restoration during the awaited finish identity check", async () => {
    const fetchBefore = globalThis.fetch;
    await withStressRun(async (run) => {
      const finishing = finishStressRun(run);
      run.restoreFetch();
      await expect(finishing).rejects.toThrow("network guard must remain active");
    });
    expect(globalThis.fetch).toBe(fetchBefore);
  });

  test("importing a helper exposes main without running a suite or touching globals", async () => {
    const exitCodeBefore = process.exitCode;
    const projection = await import("../scripts/benchmarks/stress-projection");
    const resume = await import("../scripts/benchmarks/stress-extraction-resume");
    expect(typeof projection.main).toBe("function");
    expect(typeof resume.main).toBe("function");
    expect(globalThis.fetch).toBe(originalFetch);
    expect(process.exitCode).toBe(exitCodeBefore);
  });
});

describe("stress oracle spot checks through the real public APIs", () => {
  const variable = ohProjectionVariableV1;
  const literal = (relation: string, ...terms: ReturnType<typeof variable>[]) =>
    createOhProjectionLiteralV1({ relation, terms });

  function reachablePairs(edges: readonly (readonly [string, string])[]): string[] {
    const records = edges.map(([from, to]) => createKnowledgeGraphRecordV1({
      dependencies: [], key: `view:edge-${from}-${to}`, kind: "view", v: 1, value: { from, to },
    }));
    const refs = [...records].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      .map(knowledgeGraphRecordRefV1);
    const snapshot = createOhProjectionSnapshotV1({
      head: { generation: 0, graphRevisionSha256: null, operationSha256: null,
        recordsSha256: canonicalSha256(refs), sequence: 0 },
      records, spaceId: "session.stress",
    });
    const facts = edges.map(([from, to], index) => createOhProjectionFactV1({
      relation: "edge",
      sources: [{ key: records[index]!.key, recordSha256: records[index]!.recordSha256, v: 1 }],
      tuple: [from, to],
    }));
    const dataset = createOhProjectionDatasetV1({
      extractorSha256: parseSha256Hex("e".repeat(64))!, factPackId: "stress.edges",
      factPackRevision: 1, facts, snapshot,
    });
    const x = variable("x");
    const y = variable("y");
    const z = variable("z");
    const rulePack = createOhProjectionRulePackV1({
      rulePackId: "stress.reachability", rulePackRevision: 1,
      rules: [
        createOhProjectionRuleV1({ body: [literal("edge", x, y)], head: literal("path", x, y), ruleId: "path.direct" }),
        createOhProjectionRuleV1({ body: [literal("path", x, y), literal("edge", y, z)],
          head: literal("path", x, z), ruleId: "path.transitive" }),
      ],
    });
    const query = createOhProjectionQueryV1({
      find: ["x", "z"], limit: 64, queryId: "all.pairs", where: [literal("path", x, z)],
    });
    const result = evaluateOhProjectionV1({ dataset, options: { maximumProofDepth: 64,
      maximumTotalProofNodes: 4_096 }, query, rulePack, snapshot });
    expect(result.stats.truncated).toBe(false);
    expect(result.stats.proofsTruncated).toBe(false);
    return result.rows.map((row) => row.values.join("->")).sort();
  }

  test("an empty graph derives nothing and a two-node cycle derives every pair", () => {
    expect(reachablePairs([])).toEqual([]);
    expect(reachablePairs([["n0", "n1"], ["n1", "n0"]]))
      .toEqual(["n0->n0", "n0->n1", "n1->n0", "n1->n1"]);
  });

  test("the synthetic resume chunk plan is deterministic and preserves known chunks in order", () => {
    const corpus = {
      id: "A", groupId: "A",
      turns: Array.from({ length: 25 }, (_, i) => ({
        id: `A:${i}`, sessionId: `A-session-${i}`, date: "2026-01-01", speaker: "Ada",
        text: `synthetic corpus A turn ${i}: fact ${i} recorded verbatim.`,
      })),
    };
    const plan = buildExtractionChunks(corpus);
    const ids = plan.map((chunk) => chunk.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(buildExtractionChunks(corpus).map((chunk) => chunk.id)).toEqual(ids);

    const known = new Set(ids.slice(0, 2));
    const missing = ids.filter((id) => !known.has(id));
    expect(missing).toHaveLength(23);
    const resumed = new Set([...known, ...missing]);
    expect(ids.filter((id) => resumed.has(id))).toEqual(ids);
  });
});
