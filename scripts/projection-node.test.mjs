import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import * as projectionSurface from "../dist/projection-public.js";

import {
  createOhProjectionDatasetV1,
  createOhProjectionLiteralV1,
  createOhProjectionQueryV1,
  createOhProjectionRulePackV1,
  createOhProjectionRuleV1,
  createOhProjectionSnapshotV1,
  evaluateOhProjectionV1,
  ohProjectionVariableV1,
} from "../dist/projection-public.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("the projection subpath runs under Node without loading the SQLite runtime", async () => {
  const snapshot = createOhProjectionSnapshotV1({
    head: { generation: 0, graphRevisionSha256: null, operationSha256: null,
      recordsSha256: sha256("[]"), sequence: 0 },
    records: [],
    spaceId: "node.serverless",
  });
  const dataset = createOhProjectionDatasetV1({ extractorSha256: "a".repeat(64),
    factPackId: "node.empty", factPackRevision: 1, facts: [], snapshot });
  const x = ohProjectionVariableV1("x");
  const base = createOhProjectionLiteralV1({ relation: "base", terms: [x] });
  const derived = createOhProjectionLiteralV1({ relation: "derived", terms: [x] });
  const rulePack = createOhProjectionRulePackV1({ rulePackId: "node.rules", rulePackRevision: 1,
    rules: [createOhProjectionRuleV1({ body: [base], head: derived, ruleId: "derived.from-base" })] });
  const query = createOhProjectionQueryV1({ find: ["x"], queryId: "node.query", where: [derived] });
  const result = evaluateOhProjectionV1({ dataset, query, rulePack, snapshot });
  assert.deepEqual(result.rows, []);
  assert.equal(result.authority, "derived");
  assert.equal(Object.hasOwn(projectionSurface, "evaluateOhProjectionWithMaterializerV1"), false);

  const sources = await Promise.all(["projection-public.js", "projection-suss.js"]
    .map(async (path) => await readFile(new URL(`../dist/${path}`, import.meta.url), "utf8")));
  assert.equal(sources.some((source) => source.includes("bun:sqlite")), false);
});
