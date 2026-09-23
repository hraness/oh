import { describe, expect, test } from "bun:test";

import { canonicalJson, canonicalSha256, type Sha256Hex } from "./canonical";
import { createKnowledgeGraphRecordV1, knowledgeGraphRecordRefV1, type KnowledgeGraphRecordV1 } from "./graph";
import {
  createOhProjectionDatasetV1,
  createOhProjectionFactV1,
  createOhProjectionQueryV1,
  createOhProjectionRulePackV1,
  createOhProjectionRuleV1,
  createOhProjectionSnapshotV1,
  evaluateOhProjectionV1,
  ohProjectionVariableV1,
  type OhProjectionRuleV1,
} from "./projection";
import { loadProjectionRustEngineV1, OH_PROJECTION_RUST_ENGINE_V1 } from "./projection-rust";

const extractorSha256 = "e".repeat(64) as Sha256Hex;

function snapshot(records: readonly KnowledgeGraphRecordV1[], sequence = 1) {
  const refs = [...records].sort((left, right) => (left.key < right.key ? -1 : 1)).map(knowledgeGraphRecordRefV1);
  return createOhProjectionSnapshotV1({
    head: {
      generation: sequence,
      graphRevisionSha256: `${sequence.toString(16).padStart(64, "0")}` as Sha256Hex,
      operationSha256: `${(sequence + 100).toString(16).padStart(64, "0")}` as Sha256Hex,
      recordsSha256: canonicalSha256(refs),
      sequence,
    },
    records,
    spaceId: "test.graph",
  });
}

describe("projection-rust engine parity", () => {
  test("Rust engine agrees with TypeScript engine on transitive closure", async () => {
    const rust = await loadProjectionRustEngineV1();
    if (rust === null) {
      console.error("[oh-projection-rust-fallback] wasm artifact not available in this environment");
      return;
    }

    const records: KnowledgeGraphRecordV1[] = [
      createKnowledgeGraphRecordV1({ key: "edge:a-b", kind: "view", value: { from: "a", to: "b" }, dependencies: [], v: 1 }),
      createKnowledgeGraphRecordV1({ key: "edge:b-c", kind: "view", value: { from: "b", to: "c" }, dependencies: [], v: 1 }),
      createKnowledgeGraphRecordV1({ key: "edge:c-d", kind: "view", value: { from: "c", to: "d" }, dependencies: [], v: 1 }),
    ];
    const snap = snapshot(records);
    const facts = records.map((record) =>
      createOhProjectionFactV1({
        relation: "edge",
        sources: [{ key: record.key, recordSha256: record.recordSha256, v: 1 }],
        tuple: [(record.value as { from: string }).from, (record.value as { to: string }).to],
      }),
    );
    const dataset = createOhProjectionDatasetV1({
      extractorSha256,
      factPackId: "test.edges",
      factPackRevision: 1,
      facts,
      snapshot: snap,
    });

    const rule = (id: string, body: OhProjectionRuleV1["body"], head: OhProjectionRuleV1["head"]): OhProjectionRuleV1 =>
      createOhProjectionRuleV1({ body, head, ruleId: id });

    const xv = ohProjectionVariableV1("x");
    const yv = ohProjectionVariableV1("y");
    const zv = ohProjectionVariableV1("z");
    const edgeLiteral = { relation: "edge", terms: [xv, yv], v: 1 as const };
    const pathLiteral = { relation: "path", terms: [xv, yv], v: 1 as const };
    const pathZLiteral = { relation: "path", terms: [zv, yv], v: 1 as const };

    const rulePack = createOhProjectionRulePackV1({
      rulePackId: "test.rules",
      rulePackRevision: 1,
      rules: [
        rule("path-direct", [edgeLiteral], pathLiteral),
        rule("path-indirect", [edgeLiteral, pathZLiteral], pathLiteral),
      ],
    });

    const query = createOhProjectionQueryV1({
      find: ["x", "y"],
      queryId: "test.query",
      where: [pathLiteral],
    });

    const tsResult = evaluateOhProjectionV1({ dataset, rulePack, query, snapshot: snap });
    const rustResult = rust.evaluate({ dataset, rulePack, query, snapshot: snap });

    expect(rustResult.engine).toBe(OH_PROJECTION_RUST_ENGINE_V1);
    expect(rustResult.rows.length).toBe(tsResult.rows.length);
    expect(rustResult.stats.derivedFacts).toBe(tsResult.stats.derivedFacts);
    expect(canonicalJson(rustResult.rows.map((row) => row.values).sort())).toBe(
      canonicalJson(tsResult.rows.map((row) => row.values).sort()),
    );
  });
});
