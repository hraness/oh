import {
  Database,
  constant,
  evaluate,
  lit,
  rule,
  variable,
  type Rule,
  type Term,
} from "@suss/datalog";

import { canonicalJson, parseCanonicalJson } from "./canonical";
import {
  evaluateOhProjectionWithMaterializerV1,
  type OhProjectionAtomV1,
  type OhProjectionDatasetV1,
  type OhProjectionEvaluationOptionsV1,
  type OhProjectionLiteralV1,
  type OhProjectionQueryV1,
  type OhProjectionResultV1,
  type OhProjectionRulePackV1,
  type OhProjectionSnapshotV1,
  type OhProjectionTermV1,
} from "./projection";

export const OH_PROJECTION_SUSS_VERSION_V1 = "0.20.0" as const;
export const OH_PROJECTION_SUSS_ENGINE_V1 = "suss.datalog.v0-20-0.equivalence" as const;

function encodeAtom(value: OhProjectionAtomV1): string {
  return canonicalJson(value);
}

function decodeAtom(value: string | number): OhProjectionAtomV1 {
  if (typeof value !== "string") throw new TypeError("Suss returned a non-encoded projection atom.");
  const decoded = parseCanonicalJson(value, 16 * 1024);
  if (decoded !== null && typeof decoded === "object") {
    throw new TypeError("Suss returned a non-atomic projection value.");
  }
  return decoded;
}

function sussTerm(term: OhProjectionTermV1): Term {
  return term.kind === "constant" ? constant(encodeAtom(term.value)) : variable(term.name);
}

function sussLiteral(literal: OhProjectionLiteralV1) {
  return lit(literal.relation, ...literal.terms.map(sussTerm));
}

function sussRule(input: OhProjectionRulePackV1["rules"][number]): Rule {
  return rule(input.head.relation, input.head.terms.map(sussTerm),
    input.body.map(sussLiteral), input.ruleId);
}

function projectionDomainSize(dataset: OhProjectionDatasetV1, rulePack: OhProjectionRulePackV1,
  query: OhProjectionQueryV1): number {
  const atoms = new Set<string>();
  for (const fact of dataset.facts) for (const value of fact.tuple) atoms.add(encodeAtom(value));
  const addTerms = (literal: OhProjectionLiteralV1): void => {
    for (const term of literal.terms) if (term.kind === "constant") atoms.add(encodeAtom(term.value));
  };
  for (const item of rulePack.rules) {
    addTerms(item.head);
    for (const literal of item.body) addTerms(literal);
  }
  for (const literal of query.where) addTerms(literal);
  return atoms.size;
}

function assertConservativeOutputBound(input: Readonly<{
  dataset: OhProjectionDatasetV1;
  maximumDerivedTuples: number;
  query: OhProjectionQueryV1;
  rulePack: OhProjectionRulePackV1;
}>): void {
  const domainSize = BigInt(projectionDomainSize(input.dataset, input.rulePack, input.query));
  const heads = new Map<string, number>();
  for (const item of input.rulePack.rules) heads.set(item.head.relation, item.head.terms.length);
  const baseCounts = new Map<string, number>();
  for (const fact of input.dataset.facts) {
    if (heads.has(fact.relation)) baseCounts.set(fact.relation, (baseCounts.get(fact.relation) ?? 0) + 1);
  }
  let possible = 0n;
  const maximum = BigInt(input.maximumDerivedTuples);
  for (const [relation, arity] of heads) {
    const relationSpace = domainSize ** BigInt(arity);
    const existing = BigInt(baseCounts.get(relation) ?? 0);
    possible += relationSpace > existing ? relationSpace - existing : 0n;
    if (possible > maximum) {
      throw new RangeError("The Suss equivalence adapter cannot prove the requested derived-tuple bound before evaluation; use the bounded Oh evaluator.");
    }
  }
}

/**
 * Evaluates the positive rule pack with Suss 0.20.0, then requires its complete
 * relation sets to equal Oh's bounded reference semantics before returning the
 * canonical derived-only result. The conservative admission check keeps Suss,
 * whose public evaluator has no execution-budget hook, inside Oh's tuple bound.
 */
export function evaluateOhProjectionWithSussV1(input: Readonly<{
  dataset: OhProjectionDatasetV1;
  options?: OhProjectionEvaluationOptionsV1;
  query: OhProjectionQueryV1;
  rulePack: OhProjectionRulePackV1;
  snapshot: OhProjectionSnapshotV1;
}>): OhProjectionResultV1 {
  return evaluateOhProjectionWithMaterializerV1({
    dataset: input.dataset,
    engine: OH_PROJECTION_SUSS_ENGINE_V1,
    ...(input.options === undefined ? {} : { options: input.options }),
    query: input.query,
    rulePack: input.rulePack,
    snapshot: input.snapshot,
    materialize: (program) => {
      assertConservativeOutputBound(program);
      const database = new Database();
      for (const fact of program.dataset.facts) {
        database.add(fact.relation, fact.tuple.map(encodeAtom));
      }
      evaluate(database, program.rulePack.rules.map(sussRule));
      const relationFacts = new Map<string, readonly OhProjectionAtomV1[][]>();
      for (const relation of database.relationNames()) {
        relationFacts.set(relation, database.facts(relation).map((values) => values.map(decodeAtom)));
      }
      return { relationFacts };
    },
  });
}
