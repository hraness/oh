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
  parseOhProjectionProofV1,
  parseOhProjectionResultV1,
} from "../dist/projection-public.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("projection and optional Suss subpaths run under Node without loading SQLite", async () => {
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
  assert.deepEqual(parseOhProjectionResultV1(result), result);
  assert.equal(parseOhProjectionProofV1({ unexpected: true }), null);
  assert.equal(Object.hasOwn(projectionSurface, "evaluateOhProjectionWithMaterializerV1"), false);

  // Frozen root development dependencies supply the optional Suss peer; the
  // isolated packed-artifact gate deliberately remains dependency-free.
  const stable = await import("@hraness/oh/projection-suss");
  const compatibility = await import("@hraness/oh/experimental/projection-suss");
  assert.equal(stable.evaluateOhProjectionWithSussV1, compatibility.evaluateOhProjectionWithSussV1);
  assert.equal(stable.OH_PROJECTION_SUSS_VERSION_V1, "0.20.0");
  const external = stable.evaluateOhProjectionWithSussV1({ dataset, query, rulePack, snapshot });
  assert.equal(external.engine, stable.OH_PROJECTION_SUSS_ENGINE_V1);
  assert.equal(external.authority, "derived");
  assert.deepEqual(external.rows, result.rows);

  const sources = await Promise.all(["projection-public.js", "projection-suss.js"]
    .map(async (path) => await readFile(new URL(`../dist/${path}`, import.meta.url), "utf8")));
  assert.equal(sources.some((source) => source.includes("bun:sqlite")), false);
});
