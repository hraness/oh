import { describe, expect, test } from "bun:test";

import { canonicalJson, canonicalSha256 } from "../src/canonical";
import {
  query,
  remember,
  sourceId,
  verify,
  type QueryResult,
} from "../scripts/benchmarks/memory-datalog";

const sourceDigest = (value: unknown) => `sha256:${canonicalSha256(value)}`;

/** Mirrors the Rust `fixture()` in memory.rs. */
function fixture() {
  const source = sourceDigest("observed dependencies");
  const snapshot = {
    contract: "algal.memory.v1",
    facts: [
      { relation: "depends", tuple: ["app", "parser"], sources: [source] },
      { relation: "depends", tuple: ["parser", "lexer"], sources: [source] },
    ],
  };
  const program = {
    contract: "algal.query.v1",
    rules: [
      {
        id: "direct",
        head: { relation: "affects", terms: [{ var: "x" }, { var: "y" }] },
        body: [{ relation: "depends", terms: [{ var: "x" }, { var: "y" }] }],
      },
      {
        id: "transitive",
        head: { relation: "affects", terms: [{ var: "x" }, { var: "z" }] },
        body: [
          { relation: "affects", terms: [{ var: "x" }, { var: "y" }] },
          { relation: "depends", terms: [{ var: "y" }, { var: "z" }] },
        ],
      },
    ],
    query: { relation: "affects", terms: ["app", { var: "target" }] },
  };
  return { snapshot, program };
}

describe("memory-datalog query", () => {
  test("derives transitive context with replayable witnesses", () => {
    const { snapshot, program } = fixture();
    const result = query(snapshot, program);
    expect(result.contract).toBe("algal.query-result.v1");
    expect(result.complete).toBe(true);
    expect(result.witnessPolicy).toBe("first-canonical-derivation");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.tuple).toEqual(["app", "lexer"]);
    expect(result.rows[1]!.tuple).toEqual(["app", "parser"]);
    expect(Object.keys(result.proofs).length).toBeGreaterThanOrEqual(4);
    expect(result.baseFacts).toBe(2);
    expect(result.derivedFacts).toBe(3);
    expect(result.rounds).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(result.work) && result.work > 0).toBe(true);
    expect(verify(snapshot, program, result)).toBe(true);
    result.rows[0]!.tuple = ["invented"];
    expect(verify(snapshot, program, result)).toBe(false);
  });

  test("budgets and unsafe logic fail closed", () => {
    const { snapshot, program } = fixture();
    expect(() => query(snapshot, { ...program, limits: { maxWork: 1 } })).toThrow(
      "Datalog work exhausted; no complete answer",
    );

    const unsafe = JSON.parse(JSON.stringify(program)) as typeof program;
    unsafe.rules[0]!.head.terms[0] = { var: "unbound" };
    expect(() => query(snapshot, unsafe)).toThrow("unsafe rule");

    const unknown = JSON.parse(JSON.stringify(program)) as {
      rules: Array<{ body: Array<Record<string, unknown>> }>;
    };
    unknown.rules[0]!.body[0]!["not"] = true;
    expect(() => query(snapshot, unknown)).toThrow();
  });

  test("every runtime limit fails closed", () => {
    const { snapshot, program } = fixture();
    const withLimits = (limits: Record<string, unknown>) => ({ ...program, limits });
    expect(() => query(snapshot, withLimits({ maxRounds: 1 }))).toThrow(
      "Datalog rounds exhausted; no complete answer",
    );
    expect(() => query(snapshot, withLimits({ maxDerived: 1 }))).toThrow(
      "Datalog derived tuples",
    );
    expect(() => query(snapshot, withLimits({ maxBindings: 1 }))).toThrow(
      "Datalog join bindings",
    );
    expect(() => query(snapshot, withLimits({ maxRows: 1 }))).toThrow(
      "Datalog result rows; no truncated answer returned",
    );
    expect(() => query(snapshot, withLimits({ maxOutputBytes: 100 }))).toThrow(
      "Datalog result bytes",
    );
  });

  test("limit values are positive integers bounded by the defaults", () => {
    const { snapshot, program } = fixture();
    const withLimits = (limits: unknown) => ({ ...program, limits });
    expect(() => query(snapshot, withLimits({ maxWork: 0 }))).toThrow(
      "invalid memory limit maxWork",
    );
    expect(() => query(snapshot, withLimits({ maxWork: 250_001 }))).toThrow(
      "invalid memory limit maxWork",
    );
    expect(() => query(snapshot, withLimits({ maxRows: 1.5 }))).toThrow(
      "invalid memory limit maxRows",
    );
    expect(() => query(snapshot, withLimits({ maxTurns: 4 }))).toThrow("unknown key maxTurns");
    expect(() => query(snapshot, withLimits([]))).toThrow("expected object");
    expect(() => query(snapshot, withLimits({ maxRows: 256 }))).not.toThrow();
  });

  test("multi-hop joins produce a nested proof DAG pruned to needed nodes", () => {
    const source = sourceDigest("edges");
    const edge = (from: string, to: string) => ({
      relation: "edge",
      tuple: [from, to],
      sources: [source],
    });
    const snapshot = {
      contract: "algal.memory.v1",
      facts: [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("x", "y")],
    };
    const program = {
      contract: "algal.query.v1",
      rules: [
        {
          id: "hop",
          head: { relation: "reach", terms: [{ var: "x" }, { var: "y" }] },
          body: [{ relation: "edge", terms: [{ var: "x" }, { var: "y" }] }],
        },
        {
          id: "chain",
          head: { relation: "reach", terms: [{ var: "x" }, { var: "z" }] },
          body: [
            { relation: "reach", terms: [{ var: "x" }, { var: "y" }] },
            { relation: "edge", terms: [{ var: "y" }, { var: "z" }] },
          ],
        },
      ],
      query: { relation: "reach", terms: ["a", { var: "to" }] },
    };
    const result = query(snapshot, program);
    expect(result.witnessPolicy).toBe("first-canonical-derivation");
    expect(result.rows.map((row) => row.tuple)).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["a", "d"],
    ]);
    // Needed DAG: three fact proofs plus hop(a,b), chain(a,c), chain(a,d);
    // the decoy edge(x,y) fact and the reach(x,y)/reach(b,c)/... derivations
    // it feeds are pruned from the result.
    expect(Object.keys(result.proofs)).toHaveLength(6);
    const nodes = Object.values(result.proofs);
    expect(nodes.filter((node) => node.kind === "fact")).toHaveLength(3);
    expect(nodes.filter((node) => node.kind === "rule")).toHaveLength(3);
    for (const node of nodes) {
      if (node.kind === "rule") {
        for (const premise of node.premises) {
          expect(result.proofs[premise]).toBeDefined();
        }
      }
    }
    // At least one rule proof cites another rule proof: the DAG is nested.
    const ruleProofs = nodes.filter((node) => node.kind === "rule");
    expect(
      ruleProofs.some((node) =>
        node.premises.some((premise) => result.proofs[premise]?.kind === "rule"),
      ),
    ).toBe(true);
    // Every row proof is a member of the emitted proof map.
    for (const row of result.rows) {
      expect(result.proofs[row.proof]).toBeDefined();
    }
    expect(verify(snapshot, program, result)).toBe(true);
  });

  test("same inputs produce identical canonical output including digests", () => {
    const { snapshot, program } = fixture();
    const first = query(snapshot, program);
    const second = query(snapshot, program);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    // Object key order and fact array order do not change the result, because
    // canonicalization sorts keys and facts are sorted by digest — but the
    // snapshot digest changes with array order, so permute keys only.
    const reordered = { facts: snapshot.facts, contract: "algal.memory.v1" };
    expect(canonicalJson(query(reordered, program))).toBe(canonicalJson(first));
    // Equal facts in a different array order yield the same derivations and
    // proofs; only the snapshot digest field may differ.
    const shuffled = {
      contract: "algal.memory.v1",
      facts: [snapshot.facts[1]!, snapshot.facts[0]!],
    };
    const third: QueryResult = query(shuffled, program);
    expect(third.rows).toEqual(first.rows);
    expect(third.proofs).toEqual(first.proofs);
    expect(third.work).toBe(first.work);
    expect(third.snapshot).not.toBe(first.snapshot);
    expect(third.program).toBe(first.program);
  });

  test("duplicate facts keep the first canonical derivation", () => {
    const sourceOne = sourceDigest("one");
    const sourceTwo = sourceDigest("two");
    const factOne = { relation: "f", tuple: ["x"], sources: [sourceOne] };
    const factTwo = { relation: "f", tuple: ["x"], sources: [sourceTwo] };
    const snapshot = { contract: "algal.memory.v1", facts: [factTwo, factOne] };
    const program = {
      contract: "algal.query.v1",
      rules: [],
      query: { relation: "f", terms: [{ var: "v" }] },
    };
    const result = query(snapshot, program);
    expect(result.baseFacts).toBe(1);
    const digestOne = sourceDigest(factOne);
    const digestTwo = sourceDigest(factTwo);
    const winner = digestOne < digestTwo ? factOne : factTwo;
    const factProofs = Object.values(result.proofs).filter((node) => node.kind === "fact");
    expect(factProofs).toHaveLength(1);
    expect(factProofs[0]).toEqual({
      kind: "fact",
      fact: sourceDigest(winner),
      sources: winner.sources,
    });
  });

  test("input bounds and contracts fail closed", () => {
    const { snapshot, program } = fixture();
    expect(() => query({ contract: "algal.memory.v1", facts: "nope" }, program)).toThrow(
      "expected array",
    );
    expect(() => query({ contract: "wrong", facts: [] }, program)).toThrow(
      "memory/query contract",
    );
    expect(() => query(snapshot, { ...program, contract: "algal.memory.v1" })).toThrow(
      "memory/query contract",
    );
    expect(() => query({ contract: "algal.memory.v1", facts: [], extra: 1 }, program)).toThrow(
      "unknown key extra",
    );
    const oversized = {
      contract: "algal.memory.v1",
      facts: [{ relation: "f", tuple: ["x".repeat(300_000)], sources: [sourceDigest("s")] }],
    };
    expect(() => query(oversized, program)).toThrow("memory/query input bytes");
    const source = sourceDigest("s");
    const many = {
      contract: "algal.memory.v1",
      facts: Array.from({ length: 2049 }, (_, index) => ({
        relation: "f",
        tuple: [index],
        sources: [source],
      })),
    };
    const listProgram = {
      contract: "algal.query.v1",
      rules: [],
      query: { relation: "f", terms: [{ var: "v" }] },
    };
    expect(() => query(many, listProgram)).toThrow("array count");
    // Empty result sets still produce a complete, verifiable answer.
    const empty = query({ contract: "algal.memory.v1", facts: [] }, listProgram);
    expect(empty.rows).toEqual([]);
    expect(empty.proofs).toEqual({});
    expect(empty.complete).toBe(true);
  });

  test("fact, literal, and rule validation fails closed", () => {
    const { snapshot } = fixture();
    const source = sourceDigest("s");
    const queryWithFacts = (facts: unknown[], queryLiteral?: unknown) =>
      query(
        { contract: "algal.memory.v1", facts },
        {
          contract: "algal.query.v1",
          rules: [],
          query: queryLiteral ?? { relation: "f", terms: [{ var: "v" }] },
        },
      );
    expect(() =>
      queryWithFacts([{ relation: "f", tuple: ["x"], sources: [] }]),
    ).toThrow("fact requires 1..16 source digests");
    expect(() =>
      queryWithFacts([
        {
          relation: "f",
          tuple: ["x"],
          sources: Array.from({ length: 17 }, () => source),
        },
      ]),
    ).toThrow("fact requires 1..16 source digests");
    expect(() =>
      queryWithFacts([{ relation: "f", tuple: ["x"], sources: ["deadbeef"] }]),
    ).toThrow("expected sha256:<64 lowercase hex> digest");
    expect(() =>
      queryWithFacts([{ relation: "f", tuple: [{ nested: 1 }], sources: [source] }]),
    ).toThrow("memory atoms must be JSON primitives");
    expect(() =>
      queryWithFacts([{ relation: "f", tuple: ["y".repeat(2000)], sources: [source] }]),
    ).toThrow("memory atom bytes");
    expect(() =>
      queryWithFacts([{ relation: "f", tuple: ["x"], sources: [source], extra: true }]),
    ).toThrow("unknown key extra");
    expect(() =>
      queryWithFacts(
        [
          { relation: "g", tuple: ["a", "b"], sources: [source] },
          { relation: "g", tuple: ["a"], sources: [source] },
        ],
        { relation: "g", terms: [{ var: "a" }, { var: "b" }] },
      ),
    ).toThrow("inconsistent relation arity");
    expect(() =>
      query(snapshot, {
        contract: "algal.query.v1",
        rules: [
          { id: "dup", head: { relation: "h", terms: [{ var: "x" }] }, body: [{ relation: "depends", terms: [{ var: "x" }, { var: "y" }] }] },
          { id: "dup", head: { relation: "h", terms: [{ var: "x" }] }, body: [{ relation: "depends", terms: [{ var: "x" }, { var: "y" }] }] },
        ],
        query: { relation: "h", terms: [{ var: "x" }] },
      }),
    ).toThrow("rule id/body bound");
    expect(() =>
      query(snapshot, {
        contract: "algal.query.v1",
        rules: [{ id: "empty", head: { relation: "h", terms: [{ var: "x" }] }, body: [] }],
        query: { relation: "h", terms: [{ var: "x" }] },
      }),
    ).toThrow("rule id/body bound");
    expect(() =>
      query(snapshot, {
        contract: "algal.query.v1",
        rules: [
          {
            id: "wide",
            head: { relation: "h", terms: [{ var: "x" }] },
            body: Array.from({ length: 9 }, () => ({
              relation: "depends",
              terms: [{ var: "x" }, { var: "y" }],
            })),
          },
        ],
        query: { relation: "h", terms: [{ var: "x" }] },
      }),
    ).toThrow("rule id/body bound");
    expect(() =>
      query(snapshot, {
        contract: "algal.query.v1",
        rules: [
          {
            id: "Bad Id",
            head: { relation: "h", terms: [{ var: "x" }] },
            body: [{ relation: "depends", terms: [{ var: "x" }, { var: "y" }] }],
          },
        ],
        query: { relation: "h", terms: [{ var: "x" }] },
      }),
    ).toThrow("expected lowercase kebab-case id");
  });
});

describe("memory-datalog remember", () => {
  test("is immutable, dedups, and self-checks through query", () => {
    const snapshot = { contract: "algal.memory.v1", facts: [] as unknown[] };
    const next = remember(snapshot, "decision", ["keep-parser"], "explicit user decision");
    expect(snapshot.facts).toEqual([]);
    expect(next.facts).toHaveLength(1);
    expect(canonicalJson(snapshot)).not.toBe(canonicalJson(next));
    expect(next.facts[0]).toEqual({
      relation: "decision",
      tuple: ["keep-parser"],
      sources: [sourceDigest("explicit user decision")],
    });

    const again = remember(next, "decision", ["keep-parser"], "explicit user decision");
    expect(again.facts).toHaveLength(1);
    expect(canonicalJson(again)).toBe(canonicalJson(next));

    const other = remember(next, "decision", ["keep-parser"], "another source");
    expect(other.facts).toHaveLength(2);
    expect(next.facts).toHaveLength(1);

    expect(() =>
      remember(snapshot, "decision", [{ not: "atomic" }], "source"),
    ).toThrow("memory atoms must be JSON primitives");
    expect(() =>
      remember({ contract: "wrong", facts: [] }, "decision", ["x"], "source"),
    ).toThrow("memory contract");
    expect(() => remember(snapshot, "Bad Relation", ["x"], "source")).toThrow(
      "expected lowercase kebab-case id",
    );
    // Facts the snapshot already held are validated by the self-check too.
    const corrupt = {
      contract: "algal.memory.v1",
      facts: [{ relation: "decision", tuple: ["x"], sources: [] }],
    };
    expect(() => remember(corrupt, "decision", ["y"], "source")).toThrow(
      "fact requires 1..16 source digests",
    );
  });
});

describe("memory-datalog sourceId", () => {
  test("accepts only sha256:<64 lowercase hex> digests", () => {
    const value = sourceDigest("payload");
    expect(sourceId(value)).toBe(value);
    expect(() => sourceId("sha256:deadbeef")).toThrow("expected sha256");
    expect(() => sourceId(value.toUpperCase())).toThrow("expected sha256");
    expect(() => sourceId(42)).toThrow("expected text");
  });
});
