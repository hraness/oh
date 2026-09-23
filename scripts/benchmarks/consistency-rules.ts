// Benchmark-scoped consistency-rule pack library.
//
// This module is DATA plus validators for memory-consistency audit programs
// written in a safe, positive fragment of Datalog. It produces validated rule
// programs only; evaluation (semi-naive fixpoint, proof recording, limits
// accounting) lives in a separate benchmark datalog engine that this module
// intentionally does not import or depend on.
//
// Wire contracts (replicated locally — do not import an engine copy):
//   - Programs target `algal.query.v1`:
//       { contract: "algal.query.v1",
//         rules: [{ id, head: {relation, terms}, body: [{relation, terms}] }],
//         query: {relation, terms}, limits? }
//     Terms are `{ var: name }` or JSON primitives (string | number | boolean | null).
//   - Facts target `algal.memory.v1`:
//       { relation, tuple: primitives[], sources: [digests] }
//     `sources` carries the record digests that evidence the projected tuple.
//
// Safety fragment enforced here: every head variable must be bound in the
// rule body (range-restricted), at most 8 body literals per rule, at most 8
// terms per literal, at most 64 rules per program, identifier grammar on
// relations / variables / rule ids, and globally consistent arity per
// relation across heads, bodies, and the query.
//
// POSITIVE-FRAGMENT BOUNDARY (what this library cannot express, by design):
//   - No negation / negation-as-failure. "No contradiction exists",
//     "not superseded", and "latest wins" are NOT derivable. Packs therefore
//     derive positive evidence only: `conflict-pair`, `conflicted`, `stale`,
//     `expired-at`. A tuple can appear in BOTH `current-at` and `expired-at`;
//     set difference is the consuming audit's job, never a rule's.
//   - No inequality or comparisons. `F1 != F2`, `V1 != V2`, and
//     `validFrom <= t` cannot be stated. The fact projection must therefore
//     emit `contradicts(factA, factB)` only for irreflexive, genuinely
//     conflicting pairs, and emit `valid-after(fact, t)` per (fact, query
//     instant) — those relations are projected computation, not EDB input a
//     store natively holds. FACT_RELATIONS marks each relation's projection
//     kind so the boundary stays explicit.
//   - No aggregation. Counts of conflicts/supersessions are unavailable.
//   - Self-pair exclusion is inexpressible, so `conflicted` joins rely on the
//     projector never emitting `contradicts(f, f)`.
// All rules below are honest under those limits: nothing here simulates
// negation through indirection.
//
// Everything exported is frozen and digest-stamped with the repo canonical
// helpers so pack identity is reproducible across runs.

import {
  canonicalSha256, hasExactKeys, isPlainRecord, OhValidationError, utf8ByteLength,
  type JsonPrimitive, type Sha256Hex,
} from "../../src/canonical";

export const QUERY_CONTRACT = "algal.query.v1" as const;
export const MEMORY_CONTRACT = "algal.memory.v1" as const;

export const RULE_PACK_LIMITS = Object.freeze({
  maxRules: 64,
  maxBodyLiterals: 8,
  maxArity: 8,
  maxIdentifierBytes: 64,
  maxFactTuple: 8,
  maxFactSources: 8,
});

// Identifier grammars. Relations, variables, and rule ids all use the
// engine's lowercase kebab-case grammar (states-at, valid-after,
// conflict-pair); nothing else validates downstream.
const RELATION_IDENTIFIER = /^[a-z][a-z0-9-]*$/u;
const VARIABLE_IDENTIFIER = /^[a-z][a-z0-9-]*$/u;
const RULE_IDENTIFIER = /^[a-z][a-z0-9-]*$/u;

export type AlgalTermV1 = JsonPrimitive | Readonly<{ var: string }>;
export type AlgalLiteralV1 = Readonly<{ relation: string; terms: readonly AlgalTermV1[] }>;
export type AlgalRuleV1 = Readonly<{
  id: string; head: AlgalLiteralV1; body: readonly AlgalLiteralV1[];
}>;
export type AlgalProgramV1 = Readonly<{
  contract: typeof QUERY_CONTRACT;
  rules: readonly AlgalRuleV1[];
  limits?: Readonly<Record<string, number>>;
}>;
export type AlgalQueryProgramV1 = AlgalProgramV1 & Readonly<{ query: AlgalLiteralV1 }>;
export type AlgalFactV1 = Readonly<{
  relation: string; tuple: readonly JsonPrimitive[]; sources: readonly string[];
}>;

/** How a fact relation reaches the snapshot. "projected-comparison" marks
 * relations whose emission requires computation the positive fragment cannot
 * perform (ordering, inequality); "projected" marks straight record-to-tuple
 * extraction. */
export type FactProjection = "projected" | "projected-comparison";

export type FactRelationSpec = Readonly<{
  arity: number; projection: FactProjection; doc: string;
}>;

function spec(arity: number, projection: FactProjection, doc: string): FactRelationSpec {
  return Object.freeze({ arity, projection, doc });
}

/** Canonical fact-projection relations a memory snapshot may emit under
 * `algal.memory.v1`. Rule bodies join over these; rule heads introduce
 * intensional (derived) relations that are NOT part of this table. */
export const FACT_RELATIONS: Readonly<Record<string, FactRelationSpec>> = Object.freeze({
  entity: spec(1, "projected",
    "entity(id): id is a known canonical entity in the snapshot."),
  states: spec(3, "projected",
    "states(entity, attr, value): content-level current assertion; carries no " +
    "fact identity, so contradiction/supersession joins go through asserts."),
  "states-at": spec(4, "projected",
    "states-at(entity, attr, value, validFrom): assertion with its valid-from " +
    "instant as a primitive (canonical ISO-8601 or epoch milliseconds)."),
  asserts: spec(4, "projected",
    "asserts(factDigest, entity, attr, value): bridges fact identity to asserted " +
    "content so supersedes/contradicts/valid-after (all fact-keyed) can join."),
  supersedes: spec(2, "projected",
    "supersedes(newerFactId, olderFactId): the newer fact replaces the older."),
  contradicts: spec(2, "projected-comparison",
    "contradicts(factA, factB): emitted when two facts assert incompatible " +
    "values. Positive Datalog cannot derive conflict (it needs value " +
    "inequality/negation), so detection is delegated to the projector, which " +
    "MUST emit only irreflexive, genuinely conflicting pairs."),
  alias: spec(2, "projected",
    "alias(canonical, aliasName): aliasName is an alternate surface name for " +
    "the canonical entity."),
  mentions: spec(2, "projected",
    "mentions(recordDigest, name): the record mentions the surface name; join " +
    "with refers to resolve canonical targets."),
  "record-kind": spec(2, "projected",
    "record-kind(digest, kind): classification of the source record."),
  "valid-after": spec(2, "projected-comparison",
    "valid-after(fact, t): emitted per (fact, query instant) when " +
    "fact.validFrom <= t. Ordering comparisons are inexpressible in positive " +
    "Datalog, so the projector materializes them for each requested instant."),
});

export const FACT_RELATIONS_SHA256: Sha256Hex = canonicalSha256(FACT_RELATIONS);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function fail(code: string, path: string, message: string): never {
  throw new OhValidationError(code, path, message);
}

function checkIdentifier(value: unknown, pattern: RegExp, what: string, path: string): string {
  if (typeof value !== "string" || !pattern.test(value)
    || utf8ByteLength(value) > RULE_PACK_LIMITS.maxIdentifierBytes) {
    fail("bad-identifier", path, `${what} must match ${pattern.source} within ` +
      `${RULE_PACK_LIMITS.maxIdentifierBytes} bytes`);
  }
  return value;
}

function validateTerm(value: unknown, path: string): AlgalTermV1 {
  if (isPlainRecord(value)) {
    if (!hasExactKeys(value, ["var"])) {
      fail("bad-term", path, "a term record must have exactly the 'var' key");
    }
    return Object.freeze({ var: checkIdentifier(value["var"], VARIABLE_IDENTIFIER, "variable", `${path}.var`) });
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("bad-term", path, "numeric terms must be finite");
    if (Object.is(value, -0)) fail("bad-term", path, "negative zero is not canonical");
    return value;
  }
  fail("bad-term", path, "terms are JSON primitives or { var: name }");
}

function validateLiteral(value: unknown, path: string): AlgalLiteralV1 {
  if (!isPlainRecord(value)) fail("bad-literal", path, "a literal must be a plain object");
  if (!hasExactKeys(value, ["relation", "terms"])) {
    fail("bad-literal", path, "a literal must have exactly { relation, terms }");
  }
  const relation = checkIdentifier(value["relation"], RELATION_IDENTIFIER, "relation", `${path}.relation`);
  const rawTerms = value["terms"];
  if (!Array.isArray(rawTerms)) fail("bad-literal", `${path}.terms`, "terms must be an array");
  if (rawTerms.length > RULE_PACK_LIMITS.maxArity) {
    fail("limit-exceeded", `${path}.terms`, `arity exceeds ${RULE_PACK_LIMITS.maxArity}`);
  }
  const terms = rawTerms.map((term, index) => validateTerm(term, `${path}.terms[${index}]`));
  return Object.freeze({ relation, terms: Object.freeze(terms) });
}

function literalVars(literal: AlgalLiteralV1): Set<string> {
  const vars = new Set<string>();
  for (const term of literal.terms) {
    if (isPlainRecord(term)) vars.add(term.var);
  }
  return vars;
}

export type ValidatedRuleProgram = Readonly<{
  contract: typeof QUERY_CONTRACT;
  rules: readonly AlgalRuleV1[];
  query?: AlgalLiteralV1;
  limits?: Readonly<Record<string, number>>;
}>;

/**
 * Parse and fully check an `algal.query.v1` program (or the rules-only rule
 * pack fragment of one) from unknown input. Rebuilds every node into fresh
 * frozen plain objects so the result is canonical and safe to digest.
 * `query` is optional here because exported packs ship rules only; a program
 * submitted for evaluation must carry one — buildQuery attaches it.
 */
export function validateRulePack(program: unknown): ValidatedRuleProgram {
  if (!isPlainRecord(program)) fail("bad-program", "$", "program must be a plain object");
  const allowed = ["contract", "rules", "query", "limits"];
  for (const key of Object.keys(program)) {
    if (!allowed.includes(key)) fail("bad-program", `$.${key}`, "unexpected program key");
  }
  if (program["contract"] !== QUERY_CONTRACT) {
    fail("bad-contract", "$.contract", `contract must be ${JSON.stringify(QUERY_CONTRACT)}`);
  }
  const rawRules = program["rules"];
  if (!Array.isArray(rawRules)) fail("bad-program", "$.rules", "rules must be an array");
  if (rawRules.length > RULE_PACK_LIMITS.maxRules) {
    fail("limit-exceeded", "$.rules", `rule count exceeds ${RULE_PACK_LIMITS.maxRules}`);
  }

  const ruleIds = new Set<string>();
  const arities = new Map<string, number>();
  const noteArity = (literal: AlgalLiteralV1, path: string): void => {
    const known = arities.get(literal.relation);
    if (known === undefined) arities.set(literal.relation, literal.terms.length);
    else if (known !== literal.terms.length) {
      fail("arity-mismatch", path,
        `relation ${literal.relation} used with arity ${literal.terms.length}, already ${known}`);
    }
  };

  const rules = rawRules.map((rawRule, index) => {
    const path = `$.rules[${index}]`;
    if (!isPlainRecord(rawRule)) fail("bad-rule", path, "a rule must be a plain object");
    if (!hasExactKeys(rawRule, ["id", "head", "body"])) {
      fail("bad-rule", path, "a rule must have exactly { id, head, body }");
    }
    const id = checkIdentifier(rawRule["id"], RULE_IDENTIFIER, "rule id", `${path}.id`);
    if (ruleIds.has(id)) fail("duplicate-rule-id", `${path}.id`, `duplicate rule id ${id}`);
    ruleIds.add(id);
    const head = validateLiteral(rawRule["head"], `${path}.head`);
    const rawBody = rawRule["body"];
    if (!Array.isArray(rawBody)) fail("bad-rule", `${path}.body`, "body must be an array");
    if (rawBody.length > RULE_PACK_LIMITS.maxBodyLiterals) {
      fail("limit-exceeded", `${path}.body`,
        `body literal count exceeds ${RULE_PACK_LIMITS.maxBodyLiterals}`);
    }
    const body = rawBody.map((lit, litIndex) => validateLiteral(lit, `${path}.body[${litIndex}]`));
    // Safety: every head variable must be bound by the body.
    const bound = new Set<string>();
    for (const lit of body) for (const v of literalVars(lit)) bound.add(v);
    for (const v of literalVars(head)) {
      if (!bound.has(v)) {
        fail("unsafe-head-var", `${path}.head`, `head variable ${v} is not bound in the body`);
      }
    }
    noteArity(head, `${path}.head`);
    body.forEach((lit, litIndex) => noteArity(lit, `${path}.body[${litIndex}]`));
    return Object.freeze({ id, head, body: Object.freeze(body) });
  });

  let query: AlgalLiteralV1 | undefined;
  if (program["query"] !== undefined) {
    query = validateLiteral(program["query"], "$.query");
    noteArity(query, "$.query");
  }

  let limits: Readonly<Record<string, number>> | undefined;
  if (program["limits"] !== undefined) {
    const rawLimits = program["limits"];
    if (!isPlainRecord(rawLimits)) fail("bad-limits", "$.limits", "limits must be a plain object");
    const checked: Record<string, number> = {};
    const LIMIT_KEYS = new Set(["maxWork", "maxRounds", "maxDerived", "maxBindings", "maxRows", "maxOutputBytes"]);
    for (const [key, limit] of Object.entries(rawLimits)) {
      if (!LIMIT_KEYS.has(key)) fail("bad-limits", `$.limits.${key}`, `unknown limit key`);
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0) {
        fail("bad-limits", `$.limits.${key}`, "limit values must be non-negative safe integers");
      }
      checked[key] = limit;
    }
    limits = Object.freeze(checked);
  }

  const result: {
    contract: typeof QUERY_CONTRACT;
    rules: readonly AlgalRuleV1[];
    query?: AlgalLiteralV1;
    limits?: Readonly<Record<string, number>>;
  } = { contract: QUERY_CONTRACT, rules: Object.freeze(rules) };
  if (query !== undefined) result.query = query;
  if (limits !== undefined) result.limits = limits;
  return Object.freeze(result);
}

/** Validate a single `algal.memory.v1` fact row. Tuple arity is checked
 * against FACT_RELATIONS when the relation is a known projection; unknown
 * relations still pass so benchmark projections may extend the vocabulary. */
export function validateMemoryFact(fact: unknown): AlgalFactV1 {
  if (!isPlainRecord(fact)) fail("bad-fact", "$", "a fact must be a plain object");
  if (!hasExactKeys(fact, ["relation", "tuple", "sources"])) {
    fail("bad-fact", "$", "a fact must have exactly { relation, tuple, sources }");
  }
  const relation = checkIdentifier(fact["relation"], RELATION_IDENTIFIER, "relation", "$.relation");
  const rawTuple = fact["tuple"];
  if (!Array.isArray(rawTuple)) fail("bad-fact", "$.tuple", "tuple must be an array");
  if (rawTuple.length > RULE_PACK_LIMITS.maxFactTuple) {
    fail("limit-exceeded", "$.tuple", `tuple arity exceeds ${RULE_PACK_LIMITS.maxFactTuple}`);
  }
  const tuple = rawTuple.map((term, index) => {
    const parsed = validateTerm(term, `$.tuple[${index}]`);
    if (isPlainRecord(parsed)) fail("bad-fact", `$.tuple[${index}]`, "fact tuples hold primitives only");
    return parsed as JsonPrimitive;
  });
  const known = FACT_RELATIONS[relation];
  if (known !== undefined && known.arity !== tuple.length) {
    fail("arity-mismatch", "$.tuple",
      `relation ${relation} expects arity ${known.arity}, got ${tuple.length}`);
  }
  const rawSources = fact["sources"];
  if (!Array.isArray(rawSources)) fail("bad-fact", "$.sources", "sources must be an array");
  if (rawSources.length > RULE_PACK_LIMITS.maxFactSources) {
    fail("limit-exceeded", "$.sources", `sources exceed ${RULE_PACK_LIMITS.maxFactSources}`);
  }
  const sources = rawSources.map((source, index) => {
    if (typeof source !== "string" || source.length === 0) {
      fail("bad-fact", `$.sources[${index}]`, "sources are non-empty digest strings");
    }
    return source;
  });
  return Object.freeze({ relation, tuple: Object.freeze(tuple), sources: Object.freeze(sources) });
}

// ---------------------------------------------------------------------------
// Rule packs (data; validated at construction)
// ---------------------------------------------------------------------------

const tv = (name: string): AlgalTermV1 => Object.freeze({ var: name });
const lit = (relation: string, ...terms: readonly AlgalTermV1[]): AlgalLiteralV1 =>
  Object.freeze({ relation, terms: Object.freeze(terms.slice()) });
const rule = (id: string, head: AlgalLiteralV1, ...body: readonly AlgalLiteralV1[]): AlgalRuleV1 =>
  Object.freeze({ id, head, body: Object.freeze(body.slice()) });

export type ConsistencyRulePack = Readonly<{
  name: string;
  doc: string;
  /** Rules-only program fragment: { contract: "algal.query.v1", rules }. */
  program: AlgalProgramV1;
  /** canonicalSha256(program) — stable pack identity. */
  packSha256: Sha256Hex;
  /** Extensional relations the pack consumes (body-only relations). */
  factRelations: readonly string[];
  /** Intensional relations the pack derives (head relations). */
  derivedRelations: readonly string[];
}>;

function definePack(name: string, doc: string, rules: readonly AlgalRuleV1[]): ConsistencyRulePack {
  const program = validateRulePack({ contract: QUERY_CONTRACT, rules: rules.slice() });
  const headRelations = new Set(program.rules.map((r) => r.head.relation));
  const bodyRelations = new Set(program.rules.flatMap((r) => r.body.map((l) => l.relation)));
  const factRelations = [...bodyRelations].filter((r) => !headRelations.has(r)).sort();
  const derivedRelations = [...headRelations].sort();
  return Object.freeze({
    name, doc,
    program: program as AlgalProgramV1,
    packSha256: canonicalSha256(program),
    factRelations: Object.freeze(factRelations),
    derivedRelations: Object.freeze(derivedRelations),
  });
}

const ALIAS_EXPANSION_RULES: readonly AlgalRuleV1[] = Object.freeze([
  // A canonical entity refers to itself so direct canonical mentions resolve.
  rule("refers-self", lit("refers", tv("c"), tv("c")), lit("entity", tv("c"))),
  // refers(name, canonical): a surface name resolves to its canonical entity.
  rule("refers-direct", lit("refers", tv("x"), tv("c")), lit("alias", tv("c"), tv("x"))),
  // Transitive closure over alias chains: if x resolves to m and m is itself
  // an alias of c, then x resolves to c.
  rule("refers-transitive", lit("refers", tv("x"), tv("c")),
    lit("refers", tv("x"), tv("m")), lit("alias", tv("c"), tv("m"))),
  // Records resolve through the names they mention.
  rule("record-refers", lit("record-refers", tv("d"), tv("c")),
    lit("mentions", tv("d"), tv("x")), lit("refers", tv("x"), tv("c"))),
]);

const SUPERSESSION_RULES: readonly AlgalRuleV1[] = Object.freeze([
  // stale(f): f has a declared superseder. Positive evidence only — the
  // complement ("still authoritative") is intentionally not derivable.
  rule("stale-direct", lit("stale", tv("f")), lit("supersedes", tv("g"), tv("f"))),
  // superseded-by(f, g): transitive closure over the supersedes chain, so an
  // audit can cite the full replacement ancestry of a stale fact.
  rule("superseded-by-base", lit("superseded-by", tv("f"), tv("g")),
    lit("supersedes", tv("g"), tv("f"))),
  rule("superseded-by-chain", lit("superseded-by", tv("f"), tv("h")),
    lit("supersedes", tv("g"), tv("f")), lit("superseded-by", tv("g"), tv("h"))),
  // Content view: the (entity, attr, value) carried by a stale fact.
  rule("stale-assertion", lit("stale-assertion", tv("e"), tv("a"), tv("v")),
    lit("stale", tv("f")), lit("asserts", tv("f"), tv("e"), tv("a"), tv("v"))),
]);

const TEMPORAL_RULES: readonly AlgalRuleV1[] = Object.freeze([
  // current-at(e,a,v,t): some assertion of (e,a,v) was valid at instant t.
  // valid-after is PROJECTED (fact.validFrom <= t materialized per instant)
  // because ordering comparisons are outside positive Datalog.
  rule("current-at", lit("current-at", tv("e"), tv("a"), tv("v"), tv("t")),
    lit("asserts", tv("f"), tv("e"), tv("a"), tv("v")), lit("valid-after", tv("f"), tv("t"))),
  // expired-at(e,a,v,t): an assertion was valid at t AND a superseding fact
  // was also valid at t. NOTE: without negation, current-at cannot exclude
  // expired assertions — a value may hold in both; the audit diffs them.
  rule("expired-at", lit("expired-at", tv("e"), tv("a"), tv("v"), tv("t")),
    lit("asserts", tv("f"), tv("e"), tv("a"), tv("v")), lit("valid-after", tv("f"), tv("t")),
    lit("supersedes", tv("g"), tv("f")), lit("valid-after", tv("g"), tv("t"))),
  // history-at: the raw timeline restated as a derived view for audit output.
  rule("history-at", lit("history-at", tv("e"), tv("a"), tv("v"), tv("vf")),
    lit("states-at", tv("e"), tv("a"), tv("v"), tv("vf"))),
]);

const CONSISTENCY_AUDIT_RULES: readonly AlgalRuleV1[] = Object.freeze([
  // conflict-pair: symmetric closure of the PROJECTED contradicts relation, so
  // downstream rules need not care which emission order the projector chose.
  // (contradicts itself cannot be derived here — detecting conflicting values
  // requires inequality, which is outside the positive fragment.)
  rule("conflict-pair", lit("conflict-pair", tv("fa"), tv("fb")),
    lit("contradicts", tv("fa"), tv("fb"))),
  rule("conflict-pair-symmetric", lit("conflict-pair", tv("fa"), tv("fb")),
    lit("contradicts", tv("fb"), tv("fa"))),
  // conflicted(e): entity e has two same-attribute assertions whose facts are
  // a projected conflict pair. Value inequality (v1 != v2) and fact
  // inequality (f1 != f2) are inexpressible — delegated to the projector's
  // irreflexive, truly-conflicting contradicts emission.
  rule("conflicted-entity", lit("conflicted", tv("e")),
    lit("asserts", tv("f1"), tv("e"), tv("a"), tv("v1")),
    lit("asserts", tv("f2"), tv("e"), tv("a"), tv("v2")),
    lit("conflict-pair", tv("f1"), tv("f2"))),
  // conflict-value: the specific (entity, attr, value) tuples under dispute.
  rule("conflict-value", lit("conflict-value", tv("e"), tv("a"), tv("v")),
    lit("asserts", tv("f"), tv("e"), tv("a"), tv("v")), lit("conflict-pair", tv("f"), tv("g"))),
  // conflict-attr: attribute-level rollup for audit summaries.
  rule("conflict-attr", lit("conflict-attr", tv("e"), tv("a")),
    lit("conflict-value", tv("e"), tv("a"), tv("v"))),
]);

export const RULE_PACKS: Readonly<Record<string, ConsistencyRulePack>> = Object.freeze({
  "alias-expansion": definePack("alias-expansion",
    "Resolves surface names to canonical entities: reflexive + direct alias " +
    "edges, transitive closure over alias chains, and record-level refers " +
    "through mentions.",
    ALIAS_EXPANSION_RULES),
  "supersession": definePack("supersession",
    "Flags stale facts from the projected supersedes relation, derives the " +
    "transitive superseded-by replacement ancestry, and projects stale " +
    "assertion content through asserts.",
    SUPERSESSION_RULES),
  "temporal": definePack("temporal",
    "Builds current-at/expired-at over the PROJECTED valid-after comparison " +
    "relation and states-at history. Comparisons (validFrom <= t) are " +
    "materialized by the projector; without negation, current-at overlaps " +
    "expired-at by design.",
    TEMPORAL_RULES),
  "consistency-audit": definePack("consistency-audit",
    "Derives symmetric conflict-pair closure over projected contradicts facts, " +
    "then conflicted entities, conflict-value tuples, and conflict-attr rollups " +
    "through asserts. Conflict detection itself is delegated to projection.",
    CONSISTENCY_AUDIT_RULES),
});

/**
 * Attach a query literal to a named pack and return the complete validated
 * `algal.query.v1` program (frozen, canonical). Throws OhValidationError on
 * unknown packs or invalid query literals; arity is checked against the
 * pack's own relations.
 */
export function buildQuery(packName: string, queryLiteral: unknown): AlgalQueryProgramV1 {
  const pack = RULE_PACKS[packName];
  if (pack === undefined) {
    fail("unknown-pack", "$.pack", `no consistency rule pack named ${JSON.stringify(packName)}`);
  }
  const validated = validateRulePack({
    contract: QUERY_CONTRACT, rules: pack.program.rules.slice(), query: queryLiteral,
  });
  if (validated.query === undefined) fail("bad-query", "$.query", "a query literal is required");
  return validated as AlgalQueryProgramV1;
}
