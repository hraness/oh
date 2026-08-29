import { describe, expect, test } from "bun:test";

import { canonicalJson, canonicalSha256, type Sha256Hex } from "./canonical";
import { createKnowledgeGraphRecordV1, knowledgeGraphRecordRefV1,
  type KnowledgeGraphRecordV1 } from "./graph";
import {
  createOhProjectionDatasetV1,
  createOhProjectionFactV1,
  createOhProjectionIdentityV1,
  createOhProjectionLiteralV1,
  createOhProjectionQueryV1,
  createOhProjectionRecordFactsV1,
  createOhProjectionRulePackV1,
  createOhProjectionRuleV1,
  createOhProjectionSnapshotV1,
  evaluateOhProjectionV1,
  invalidationForOhProjectionV1,
  OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1,
  ohProjectionConstantV1,
  ohProjectionVariableV1,
  parseOhProjectionQueryV1,
  parseOhProjectionIdentityV1,
  parseOhProjectionSnapshotV1,
  type OhProjectionAtomV1,
  type OhProjectionDatasetV1,
  type OhProjectionProofV1,
  type OhProjectionQueryV1,
  type OhProjectionRulePackV1,
  type OhProjectionSnapshotV1,
} from "./projection";
import { evaluateOhProjectionWithSussV1, OH_PROJECTION_SUSS_ENGINE_V1,
  OH_PROJECTION_SUSS_VERSION_V1 } from "./projection-suss";

const extractorSha256 = "e".repeat(64) as Sha256Hex;

const v = ohProjectionVariableV1;
const c = ohProjectionConstantV1;
const literal = (relation: string, ...terms: ReturnType<typeof v>[]) =>
  createOhProjectionLiteralV1({ relation, terms });

function edgeRecord(from: string, to: string): KnowledgeGraphRecordV1 {
  return createKnowledgeGraphRecordV1({ dependencies: [], key: `view:edge-${from}-${to}`,
    kind: "view", v: 1, value: { from, to } });
}

function snapshot(records: readonly KnowledgeGraphRecordV1[], sequence = 1): OhProjectionSnapshotV1 {
  const refs = [...records].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map(knowledgeGraphRecordRefV1);
  return createOhProjectionSnapshotV1({
    head: {
      generation: sequence,
      graphRevisionSha256: `${sequence.toString(16).padStart(64, "0")}` as Sha256Hex,
      operationSha256: `${(sequence + 100).toString(16).padStart(64, "0")}` as Sha256Hex,
      recordsSha256: canonicalSha256(refs),
      sequence,
    },
    records,
    spaceId: "session.test",
  });
}

function dataset(records: readonly KnowledgeGraphRecordV1[], exactSnapshot: OhProjectionSnapshotV1,
  reverse = false): OhProjectionDatasetV1 {
  const ordered = reverse ? [...records].reverse() : records;
  const facts = ordered.map((record) => createOhProjectionFactV1({ relation: "edge",
    sources: [{ key: record.key, recordSha256: record.recordSha256, v: 1 }],
    tuple: [(record.value as { from: string }).from, (record.value as { to: string }).to] }));
  return createOhProjectionDatasetV1({ extractorSha256, factPackId: "test.edges",
    factPackRevision: 1, facts, snapshot: exactSnapshot });
}

function reachabilityRules(reverse = false): OhProjectionRulePackV1 {
  const x = v("x");
  const y = v("y");
  const z = v("z");
  const direct = createOhProjectionRuleV1({ body: [literal("edge", x, y)],
    head: literal("path", x, y), ruleId: "path.direct" });
  const transitive = createOhProjectionRuleV1({ body: [literal("path", x, y), literal("edge", y, z)],
    head: literal("path", x, z), ruleId: "path.transitive" });
  return createOhProjectionRulePackV1({ rulePackId: "test.reachability", rulePackRevision: 1,
    rules: reverse ? [transitive, direct] : [direct, transitive] });
}

function allPathsQuery(limit = 1_000): OhProjectionQueryV1 {
  return createOhProjectionQueryV1({ find: ["x", "z"], limit, queryId: "all.paths",
    where: [literal("path", v("x"), v("z"))] });
}

function countProofNodes(proof: OhProjectionProofV1): number {
  return proof.kind === "derived"
    ? 1 + proof.premises.reduce((sum, premise) => sum + countProofNodes(premise), 0)
    : 1;
}

function expectedClosure(edges: readonly (readonly [string, string])[]): readonly OhProjectionAtomV1[][] {
  const nodes = [...new Set(edges.flat())].sort();
  const reachable = new Set(edges.map((edge) => canonicalJson(edge)));
  for (const through of nodes) {
    for (const from of nodes) {
      for (const to of nodes) {
        if (reachable.has(canonicalJson([from, through])) && reachable.has(canonicalJson([through, to]))) {
          reachable.add(canonicalJson([from, to]));
        }
      }
    }
  }
  return [...reachable].sort().map((value) => JSON.parse(value) as OhProjectionAtomV1[]);
}

describe("projection identity and validation", () => {
  test("binds facts to an exact graph head without changing V1 graph bytes", () => {
    const records = [edgeRecord("a", "b"), edgeRecord("b", "c")];
    const exact = snapshot(records);
    expect(parseOhProjectionSnapshotV1(exact)).toEqual(exact);
    expect(exact.recordsSha256).toBe(canonicalSha256(records
      .map(knowledgeGraphRecordRefV1).sort((left, right) => left.key.localeCompare(right.key))));

    const facts = dataset(records, exact);
    expect(facts.snapshotSha256).toBe(exact.snapshotSha256);
    expect(facts.facts).toHaveLength(2);
    expect(() => createOhProjectionDatasetV1({ extractorSha256, factPackId: "test.edges",
      factPackRevision: 1, facts: [createOhProjectionFactV1({ relation: "edge",
        sources: [{ key: records[0]!.key, recordSha256: records[1]!.recordSha256, v: 1 }],
        tuple: ["a", "b"] })], snapshot: exact })).toThrow("exact input snapshot");

    const forged = { ...facts, factsSha256: "f".repeat(64) as Sha256Hex };
    expect(() => evaluateOhProjectionV1({ dataset: forged, query: allPathsQuery(),
      rulePack: reachabilityRules(), snapshot: exact })).toThrow("Invalid projection snapshot");
  });

  test("canonicalizes declaration order and rejects non-positive AST shapes", () => {
    const forward = reachabilityRules();
    const reverse = reachabilityRules(true);
    expect(reverse).toEqual(forward);
    expect(parseOhProjectionQueryV1({ ...allPathsQuery(), where: [{
      ...allPathsQuery().where[0], negated: true,
    }] })).toBeNull();
    expect(() => createOhProjectionRuleV1({ body: [literal("edge", v("x"), v("y"))],
      head: literal("path", v("x"), v("unbound")), ruleId: "unsafe" })).toThrow("must be bound");
  });

  test("keeps every JSON primitive atom unambiguous", () => {
    const record = edgeRecord("a", "b");
    const exact = snapshot([record]);
    const fact = createOhProjectionFactV1({ relation: "primitive",
      sources: [{ key: record.key, recordSha256: record.recordSha256, v: 1 }],
      tuple: [null, false, 0, "null"] });
    const primitives = createOhProjectionDatasetV1({ extractorSha256, factPackId: "test.primitives",
      factPackRevision: 1, facts: [fact], snapshot: exact });
    const query = createOhProjectionQueryV1({ find: ["n", "b", "z", "s"], queryId: "all.primitives",
      where: [createOhProjectionLiteralV1({ relation: "primitive",
        terms: [v("n"), v("b"), v("z"), v("s")] })] });
    const passthrough = createOhProjectionRulePackV1({ rulePackId: "test.primitives",
      rulePackRevision: 1, rules: [createOhProjectionRuleV1({ body: query.where,
        head: createOhProjectionLiteralV1({ relation: "copy",
          terms: [v("n"), v("b"), v("z"), v("s")] }), ruleId: "copy.primitives" })] });
    const input = { dataset: primitives, query, rulePack: passthrough, snapshot: exact };
    const internal = evaluateOhProjectionV1(input);
    expect(internal.rows[0]?.values).toEqual([null, false, 0, "null"]);
    expect(evaluateOhProjectionWithSussV1(input).rows).toEqual(internal.rows);
  });

  test("coalesces duplicate tuples while retaining every exact source", () => {
    const records = [edgeRecord("a", "b"), createKnowledgeGraphRecordV1({ dependencies: [],
      key: "view:edge-a-b-second", kind: "view", v: 1, value: { from: "a", to: "b" } })];
    const exact = snapshot(records);
    const facts = records.map((record) => createOhProjectionFactV1({ relation: "edge",
      sources: [{ key: record.key, recordSha256: record.recordSha256, v: 1 }], tuple: ["a", "b"] }));
    const merged = createOhProjectionDatasetV1({ extractorSha256, factPackId: "test.edges",
      factPackRevision: 1, facts, snapshot: exact });
    expect(merged.facts).toHaveLength(1);
    expect(merged.facts[0]?.sources).toHaveLength(2);
  });

  test("marks every identity change as an explicit full rebuild", () => {
    const records = [edgeRecord("a", "b")];
    const firstSnapshot = snapshot(records, 1);
    const secondSnapshot = snapshot(records, 2);
    const firstDataset = dataset(records, firstSnapshot);
    const secondDataset = dataset(records, secondSnapshot);
    const rules = reachabilityRules();
    const query = allPathsQuery();
    const first = createOhProjectionIdentityV1({ dataset: firstDataset, query, rulePack: rules,
      snapshot: firstSnapshot });
    expect(parseOhProjectionIdentityV1(first)).toEqual(first);
    expect(parseOhProjectionIdentityV1({ ...first, querySha256: "f".repeat(64) })).toBeNull();
    expect(invalidationForOhProjectionV1(first, first)).toEqual({ kind: "reusable", v: 1 });
    const second = createOhProjectionIdentityV1({ dataset: secondDataset, query, rulePack: rules,
      snapshot: secondSnapshot });
    expect(invalidationForOhProjectionV1(first, second)).toEqual({ kind: "full-rebuild",
      reasons: ["snapshot-changed", "dataset-changed"], v: 1 });
    const changedQuery = createOhProjectionQueryV1({ ...query, limit: 1 });
    const third = createOhProjectionIdentityV1({ dataset: firstDataset, query: changedQuery,
      rulePack: rules, snapshot: firstSnapshot });
    expect(invalidationForOhProjectionV1(first, third)).toEqual({ kind: "full-rebuild",
      reasons: ["query-changed"], v: 1 });
  });
});

describe("positive recursive evaluation", () => {
  test("computes a deterministic fixpoint and bounded proof trees", () => {
    const records = [edgeRecord("a", "b"), edgeRecord("b", "c"), edgeRecord("c", "d")];
    const exact = snapshot(records);
    const result = evaluateOhProjectionV1({ dataset: dataset(records, exact, true),
      options: { maximumProofNodes: 7 }, query: createOhProjectionQueryV1({ find: ["z"],
        queryId: "paths.from-a", where: [createOhProjectionLiteralV1({ relation: "path",
          terms: [c("a"), v("z")] })] }), rulePack: reachabilityRules(true), snapshot: exact });
    expect(result.authority).toBe("derived");
    expect(result.cache.strategy).toBe("full-rebuild");
    expect(result.rows.map((row) => row.values)).toEqual([["b"], ["c"], ["d"]]);
    expect(result.stats).toMatchObject({ baseFacts: 3, derivedFacts: 6, rounds: 3,
      truncated: false });
    expect(result.rows.every((row) => row.proofs.reduce((sum, proof) => sum + countProofNodes(proof), 0) <= 7))
      .toBe(true);
    expect(canonicalSha256((({ resultSha256: _digest, ...payload }) => payload)(result)))
      .toBe(result.resultSha256);
  });

  test("fails closed at evaluation and arity bounds", () => {
    const records = [edgeRecord("a", "b"), edgeRecord("b", "c")];
    const exact = snapshot(records);
    expect(() => evaluateOhProjectionV1({ dataset: dataset(records, exact),
      options: { maximumDerivedTuples: 1 }, query: allPathsQuery(),
      rulePack: reachabilityRules(), snapshot: exact })).toThrow("derived tuple bound");
    const badQuery = createOhProjectionQueryV1({ find: ["x"], queryId: "bad.arity",
      where: [literal("path", v("x"))] });
    expect(() => evaluateOhProjectionV1({ dataset: dataset(records, exact), query: badQuery,
      rulePack: reachabilityRules(), snapshot: exact })).toThrow("conflicting arities");
  });

  test("matches graph reachability across generated input orders", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const edges: [string, string][] = [];
      for (let from = 0; from < 7; from += 1) {
        for (let to = from + 1; to < 7; to += 1) {
          if (((seed * 31 + from * 17 + to * 13) % 5) < 2) edges.push([`n${from}`, `n${to}`]);
        }
      }
      if (edges.length === 0) edges.push(["n0", "n1"]);
      const records = edges.map(([from, to]) => edgeRecord(from, to));
      const exact = snapshot(records);
      const result = evaluateOhProjectionV1({ dataset: dataset(records, exact, seed % 2 === 0),
        query: allPathsQuery(), rulePack: reachabilityRules(seed % 3 === 0), snapshot: exact });
      expect(result.rows.map((row) => row.values)).toEqual([...expectedClosure(edges)]);
    }
  });

  test("exposes stable structural record and dependency facts", () => {
    const parent = createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:parent",
      kind: "entity", v: 1, value: { name: "parent" } });
    const child = createKnowledgeGraphRecordV1({ dependencies: [parent.key], key: "statement:child",
      kind: "statement", v: 1, value: { name: "child" } });
    expect(OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1).toMatchObject({ factPackId: "oh.record-facts",
      factPackRevision: 1 });
    expect(createOhProjectionRecordFactsV1([child, parent]).map((fact) => [fact.relation, fact.tuple]))
      .toEqual([
        ["oh.dependency", ["statement:child", "entity:parent"]],
        ["oh.record", ["entity:parent", "entity", parent.recordSha256]],
        ["oh.record", ["statement:child", "statement", child.recordSha256]],
      ]);
  });
});

describe("optional Suss equivalence adapter", () => {
  test("pins the evaluated package and agrees on complete relation sets", () => {
    expect(OH_PROJECTION_SUSS_VERSION_V1).toBe("0.20.0");
    const records = [edgeRecord("a", "b"), edgeRecord("b", "c"), edgeRecord("a", "d")];
    const exact = snapshot(records);
    const input = { dataset: dataset(records, exact), query: allPathsQuery(),
      rulePack: reachabilityRules(), snapshot: exact };
    const internal = evaluateOhProjectionV1(input);
    const external = evaluateOhProjectionWithSussV1(input);
    expect(external.engine).toBe(OH_PROJECTION_SUSS_ENGINE_V1);
    expect(external.identity).toEqual(internal.identity);
    expect(external.rows).toEqual(internal.rows);
    expect(external.stats).toEqual(internal.stats);
  });

  test("rejects programs Suss cannot prove within the requested bound", () => {
    const records = [edgeRecord("a", "b"), edgeRecord("b", "c")];
    const exact = snapshot(records);
    expect(() => evaluateOhProjectionWithSussV1({ dataset: dataset(records, exact),
      options: { maximumDerivedTuples: 1 }, query: allPathsQuery(),
      rulePack: reachabilityRules(), snapshot: exact })).toThrow("cannot prove");
  });
});
