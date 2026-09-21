import { describe, expect, test } from "bun:test";

import { canonicalSha256 } from "../src/canonical";
import {
  buildQuery, FACT_RELATIONS, FACT_RELATIONS_SHA256, MEMORY_CONTRACT, QUERY_CONTRACT,
  RULE_PACK_LIMITS, RULE_PACKS, validateMemoryFact, validateRulePack,
  type AlgalFactV1, type AlgalLiteralV1,
} from "../scripts/benchmarks/consistency-rules";

const v = (name: string) => ({ var: name });
const lit = (relation: string, ...terms: readonly unknown[]) =>
  ({ relation, terms: terms as never[] });
const rule = (id: string, head: AlgalLiteralV1, body: readonly AlgalLiteralV1[]) =>
  ({ id, head, body });

describe("FACT_RELATIONS", () => {
  test("declares the canonical projection vocabulary with arities", () => {
    const expected: Record<string, number> = {
      entity: 1, states: 3, "states-at": 4, asserts: 4, supersedes: 2,
      contradicts: 2, alias: 2, mentions: 2, "record-kind": 2, "valid-after": 2,
    };
    for (const [relation, arity] of Object.entries(expected)) {
      expect(FACT_RELATIONS[relation]?.arity).toBe(arity);
      expect(FACT_RELATIONS[relation]?.doc.length).toBeGreaterThan(0);
    }
    expect(Object.keys(FACT_RELATIONS).sort()).toEqual(Object.keys(expected).sort());
    // Comparison-dependent projections are marked at the boundary.
    expect(FACT_RELATIONS["contradicts"]?.projection).toBe("projected-comparison");
    expect(FACT_RELATIONS["valid-after"]?.projection).toBe("projected-comparison");
    expect(Object.isFrozen(FACT_RELATIONS)).toBe(true);
    expect(FACT_RELATIONS_SHA256).toBe(canonicalSha256(FACT_RELATIONS));
  });
});

describe("RULE_PACKS", () => {
  test("ships the four named packs as frozen validated data", () => {
    expect(Object.keys(RULE_PACKS).sort()).toEqual(
      ["alias-expansion", "consistency-audit", "supersession", "temporal"]);
    for (const pack of Object.values(RULE_PACKS)) {
      expect(Object.isFrozen(pack)).toBe(true);
      expect(Object.isFrozen(pack.program)).toBe(true);
      expect(pack.program.contract).toBe(QUERY_CONTRACT);
      // Every exported pack passes its own validator.
      expect(validateRulePack(pack.program)).toBeDefined();
      expect(validateRulePack(pack.program).rules.length).toBe(pack.program.rules.length);
      // Derived relations are never fact relations.
      for (const derived of pack.derivedRelations) {
        expect(pack.factRelations).not.toContain(derived);
        expect(FACT_RELATIONS[derived]).toBeUndefined();
      }
      // Every consumed extensional relation is a declared projection.
      for (const consumed of pack.factRelations) {
        expect(FACT_RELATIONS[consumed]).toBeDefined();
      }
    }
  });

  test("packSha256 is canonical over the program and stable across runs", () => {
    for (const pack of Object.values(RULE_PACKS)) {
      const first = canonicalSha256(pack.program);
      const second = canonicalSha256(validateRulePack(pack.program));
      expect(pack.packSha256).toBe(first);
      expect(first).toBe(second);
      expect(pack.packSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("packs consume and derive the expected relations", () => {
    expect(RULE_PACKS["alias-expansion"]?.factRelations).toEqual(
      ["alias", "entity", "mentions"]);
    expect(RULE_PACKS["alias-expansion"]?.derivedRelations).toEqual(
      ["record-refers", "refers"]);
    expect(RULE_PACKS["supersession"]?.factRelations).toEqual(
      ["asserts", "supersedes"]);
    expect(RULE_PACKS["supersession"]?.derivedRelations).toEqual(
      ["stale", "stale-assertion", "superseded-by"]);
    expect(RULE_PACKS["temporal"]?.factRelations).toEqual(
      ["asserts", "states-at", "supersedes", "valid-after"]);
    expect(RULE_PACKS["temporal"]?.derivedRelations).toEqual(
      ["current-at", "expired-at", "history-at"]);
    expect(RULE_PACKS["consistency-audit"]?.factRelations).toEqual(
      ["asserts", "contradicts"]);
    expect(RULE_PACKS["consistency-audit"]?.derivedRelations).toEqual(
      ["conflict-attr", "conflict-pair", "conflict-value", "conflicted"]);
  });
});

describe("validateRulePack", () => {
  const safeRule = rule("r-ok",
    lit("p", v("x")) as AlgalLiteralV1,
    [lit("q", v("x")) as AlgalLiteralV1]);
  const program = (rules: readonly unknown[], extra: Record<string, unknown> = {}) =>
    ({ contract: QUERY_CONTRACT, rules, ...extra });

  test("rejects non-records, wrong contract, and unexpected keys", () => {
    expect(() => validateRulePack(null)).toThrow("plain object");
    expect(() => validateRulePack([])).toThrow("plain object");
    expect(() => validateRulePack({ contract: "algal.query.v2", rules: [] }))
      .toThrow(QUERY_CONTRACT);
    expect(() => validateRulePack({ contract: QUERY_CONTRACT }))
      .toThrow("rules");
    expect(() => validateRulePack({ contract: QUERY_CONTRACT, rules: [], extra: 1 }))
      .toThrow("unexpected program key");
  });

  test("rejects an unsafe rule (unbound head variable)", () => {
    const unsafe = rule("r-unsafe",
      lit("p", v("x")) as AlgalLiteralV1,
      [lit("q", v("y")) as AlgalLiteralV1]);
    expect(() => validateRulePack(program([unsafe]))).toThrow("not bound");
  });

  test("rejects arity mismatch across literals", () => {
    const mismatch = rule("r-arity",
      lit("p", v("x")) as AlgalLiteralV1,
      [lit("p", v("x"), v("y")) as AlgalLiteralV1]);
    expect(() => validateRulePack(program([mismatch]))).toThrow("arity");
    // Query participates in the same arity discipline.
    expect(() => validateRulePack(program([safeRule], {
      query: lit("q", v("x"), v("y")),
    }))).toThrow("arity");
  });

  test("rejects duplicate rule ids", () => {
    const other = rule("r-ok",
      lit("s", v("x")) as AlgalLiteralV1,
      [lit("t", v("x")) as AlgalLiteralV1]);
    expect(() => validateRulePack(program([safeRule, other])))
      .toThrow("duplicate");
  });

  test("enforces body literal, arity, and rule count bounds", () => {
    const wideBody = rule("r-wide",
      lit("p", v("x")) as AlgalLiteralV1,
      Array.from({ length: RULE_PACK_LIMITS.maxBodyLiterals + 1 },
        () => lit("q", v("x")) as AlgalLiteralV1));
    expect(() => validateRulePack(program([wideBody]))).toThrow("body literal");

    const wideHead = rule("r-fat",
      lit("p", v("a"), v("b"), v("c"), v("d"), v("e"), v("f"), v("g"), v("h"),
        "extra") as AlgalLiteralV1,
      [lit("q", v("a"), v("b"), v("c"), v("d"), v("e"), v("f"), v("g"), v("h"),
        "extra") as AlgalLiteralV1]);
    expect(() => validateRulePack(program([wideHead]))).toThrow("arity");

    const many = Array.from({ length: RULE_PACK_LIMITS.maxRules + 1 },
      (_, i) => rule(`r-${i}`,
        lit(`p${i}`, v("x")) as AlgalLiteralV1,
        [lit(`q${i}`, v("x")) as AlgalLiteralV1]));
    expect(() => validateRulePack(program(many))).toThrow("rule count");
  });

  test("rejects non-identifier relations, variables, and rule ids", () => {
    const badRelation = rule("r-rel",
      lit("Not A Relation", v("x")) as AlgalLiteralV1,
      [lit("q", v("x")) as AlgalLiteralV1]);
    expect(() => validateRulePack(program([badRelation]))).toThrow("relation");

    const badVar = rule("r-var",
      lit("p", { var: "1bad" }) as AlgalLiteralV1,
      [lit("q", { var: "1bad" }) as AlgalLiteralV1]);
    expect(() => validateRulePack(program([badVar]))).toThrow("variable");

    const badId = { id: "bad id", head: lit("p"), body: [lit("q")] };
    expect(() => validateRulePack(program([badId]))).toThrow("rule id");

    const badTerm = rule("r-term",
      lit("p", v("x")) as AlgalLiteralV1,
      [{ relation: "q", terms: [{ var: "x", extra: 1 }] } as never]);
    expect(() => validateRulePack(program([badTerm]))).toThrow("var");
  });

  test("rebuilds a frozen canonical program", () => {
    const validated = validateRulePack(program([safeRule],
      { limits: { maxDerived: 128 } }));
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.rules)).toBe(true);
    expect(validated.contract).toBe(QUERY_CONTRACT);
    expect(validated.limits?.["maxDerived"]).toBe(128);
    expect(() => validateRulePack(program([safeRule], { limits: { bad: -1 } })))
      .toThrow("limit");
  });
});

describe("buildQuery", () => {
  test("returns a complete validated algal.query.v1 program", () => {
    const program = buildQuery("alias-expansion",
      { relation: "record-refers", terms: ["doc-1", v("c")] });
    expect(program.contract).toBe(QUERY_CONTRACT);
    expect(program.rules.length)
      .toBe(RULE_PACKS["alias-expansion"]!.program.rules.length);
    expect(program.query).toEqual(
      { relation: "record-refers", terms: ["doc-1", { var: "c" }] });
    expect(validateRulePack(program)).toBeDefined();
    expect(Object.isFrozen(program)).toBe(true);
  });

  test("produces stable program digests", () => {
    const query = { relation: "conflicted", terms: [v("e")] };
    const first = buildQuery("consistency-audit", query);
    const second = buildQuery("consistency-audit", query);
    expect(canonicalSha256(first)).toBe(canonicalSha256(second));
    const third = buildQuery("consistency-audit",
      { relation: "conflict-value", terms: [v("e"), v("a"), v("v")] });
    expect(canonicalSha256(third)).not.toBe(canonicalSha256(first));
  });

  test("rejects unknown packs and invalid query literals", () => {
    expect(() => buildQuery("no-such-pack", { relation: "p", terms: [] }))
      .toThrow("no consistency rule pack");
    // Arity of the query is checked against the pack's relations.
    expect(() => buildQuery("consistency-audit",
      { relation: "conflict-pair", terms: [v("a"), v("b"), v("c")] }))
      .toThrow("arity");
    expect(() => buildQuery("temporal",
      { relation: "bad relation", terms: [] })).toThrow("relation");
  });
});

describe("fixture facts (structural sanity — no evaluation)", () => {
  // Hand-built algal.memory.v1 rows covering every declared projection.
  const digest = (n: number) => n.toString(16).padStart(64, "0");
  const facts: AlgalFactV1[] = [
    { relation: "entity", tuple: ["e-acme"], sources: [digest(1)] },
    { relation: "alias", tuple: ["e-acme", "acme-inc"], sources: [digest(1)] },
    { relation: "alias", tuple: ["acme-inc", "acme"], sources: [digest(2)] },
    { relation: "mentions", tuple: ["d-1", "acme"], sources: [digest(3)] },
    { relation: "record-kind", tuple: ["d-1", "email"], sources: [digest(3)] },
    { relation: "states", tuple: ["e-acme", "plan", "monthly"], sources: [digest(4)] },
    { relation: "states-at",
      tuple: ["e-acme", "plan", "monthly", "2025-01-01T00:00:00.000Z"],
      sources: [digest(4)] },
    { relation: "asserts", tuple: ["f-1", "e-acme", "plan", "monthly"],
      sources: [digest(4)] },
    { relation: "asserts", tuple: ["f-2", "e-acme", "plan", "yearly"],
      sources: [digest(5)] },
    { relation: "supersedes", tuple: ["f-2", "f-1"], sources: [digest(5)] },
    { relation: "contradicts", tuple: ["f-1", "f-2"], sources: [digest(6)] },
    { relation: "valid-after",
      tuple: ["f-1", "2026-06-01T00:00:00.000Z"], sources: [digest(7)] },
    { relation: "valid-after",
      tuple: ["f-2", "2026-06-01T00:00:00.000Z"], sources: [digest(7)] },
  ];

  test("fixture rows are valid memory facts over declared arities", () => {
    for (const fact of facts) {
      expect(validateMemoryFact(fact)).toBeDefined();
      expect(fact.tuple.length).toBe(FACT_RELATIONS[fact.relation]!.arity);
    }
    expect(MEMORY_CONTRACT).toBe("algal.memory.v1");
  });

  test("fixture covers every fact relation each pack consumes", () => {
    const emitted = new Set(facts.map((f) => f.relation));
    for (const pack of Object.values(RULE_PACKS)) {
      for (const consumed of pack.factRelations) {
        expect(emitted).toContain(consumed);
      }
    }
    // And the whole declared vocabulary is exercised.
    for (const relation of Object.keys(FACT_RELATIONS)) {
      expect(emitted).toContain(relation);
    }
  });

  test("pack queries target derived relations over the fixture", () => {
    // Structural: the query relations the audit would ask about are derived
    // by the packs, not projected by the fixture.
    const emitted = new Set(facts.map((f) => f.relation));
    for (const relation of ["refers", "record-refers", "stale", "superseded-by",
      "current-at", "expired-at", "conflict-pair", "conflicted"]) {
      expect(emitted).not.toContain(relation);
    }
    expect(() => buildQuery("supersession",
      { relation: "stale-assertion", terms: [v("e"), v("a"), v("v")] })).not.toThrow();
    expect(() => buildQuery("temporal",
      { relation: "expired-at", terms: [v("e"), v("a"), v("v"), "2026-06-01T00:00:00.000Z"] }))
      .not.toThrow();
  });

  test("validateMemoryFact rejects malformed rows", () => {
    expect(() => validateMemoryFact({ relation: "entity", tuple: [] }))
      .toThrow("exactly");
    expect(() => validateMemoryFact(
      { relation: "entity", tuple: ["a", "b"], sources: [] }))
      .toThrow("arity");
    expect(() => validateMemoryFact(
      { relation: "entity", tuple: [{ var: "x" }], sources: [digest(1)] }))
      .toThrow("primitives");
    expect(() => validateMemoryFact(
      { relation: "entity", tuple: ["a"], sources: [""] })).toThrow("digest");
  });
});
