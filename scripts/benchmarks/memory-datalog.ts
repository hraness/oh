/**
 * Bounded proof-carrying Datalog memory engine.
 *
 * Faithful TypeScript port of ALGAL's `crates/algal/src/memory.rs`: bounded
 * bottom-up (naive fixpoint) positive Datalog evaluation where every retained
 * tuple carries a content-addressed proof node and query results embed the
 * pruned proof DAG, so `verify` replays canonical equality.
 *
 * The wire contract literals `algal.memory.v1`, `algal.query.v1`, and
 * `algal.query-result.v1`, the `sha256:<64 lowercase hex>` digest format, every
 * bound, and the stable error messages are kept verbatim for
 * cross-implementation parity: a result produced by this port re-verifies
 * against the Rust evaluator and vice versa. Canonicalization and hashing go
 * through the repository's `src/canonical` helpers, which match the Rust
 * encoder on every value that can appear in validated contract data.
 */
import {
  canonicalJson,
  hasExactKeys,
  isPlainRecord,
  parseSha256Hex,
  sha256Hex,
  utf8ByteLength,
  type JsonValue,
} from "../../src/canonical";

export type { JsonValue };

export interface Fact {
  relation: string;
  tuple: JsonValue[];
  sources: string[];
}

export interface Literal {
  relation: string;
  terms: JsonValue[];
}

export interface Rule {
  id: string;
  head: Literal;
  body: Literal[];
}

export interface Limits {
  maxWork: number;
  maxRounds: number;
  maxDerived: number;
  maxBindings: number;
  maxRows: number;
  maxOutputBytes: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxWork: 250_000,
  maxRounds: 32,
  maxDerived: 4096,
  maxBindings: 4096,
  maxRows: 256,
  maxOutputBytes: 262_144,
});

export type ProofNode =
  | { kind: "fact"; fact: string; sources: string[] }
  | { kind: "rule"; rule: string; premises: string[] };

export interface QueryResult {
  contract: "algal.query-result.v1" | "algal.query-result.v2";
  snapshot: string;
  program: string;
  complete: true;
  witnessPolicy: "first-canonical-derivation";
  rows: Array<{ tuple: JsonValue[]; proof: string }>;
  proofs: Record<string, ProofNode>;
  work: number;
  rounds: number;
  baseFacts: number;
  derivedFacts: number;
}

export interface Snapshot {
  contract: "algal.memory.v1";
  facts: Fact[];
}

const MAX_SNAPSHOT_BYTES = 262_144;
const MAX_PROGRAM_BYTES = 65_536;
const MAX_FACTS = 2048;
const MAX_RULES = 64;
const MAX_FACT_SOURCES = 16;
const MAX_TERMS = 8;
const MAX_BODY_LITERALS = 8;
const MAX_ATOM_BYTES = 1024;
const MAX_ID_UNITS = 64;
const MAX_JSON_DEPTH = 64;
const DIGEST_LENGTH = 71;

const LIMIT_NAMES = [
  "maxWork",
  "maxRounds",
  "maxDerived",
  "maxBindings",
  "maxRows",
  "maxOutputBytes",
] as const;

const IDENTIFIER = /^[a-z][a-z0-9-]*$/u;

interface Tuple {
  relation: string;
  values: JsonValue[];
  proof: string;
}

interface Binding {
  values: Map<string, JsonValue>;
  premises: string[];
}

/**
 * Rust `String::cmp` orders by UTF-8 bytes (code-point order), not UTF-16 code
 * units. The difference is only observable for atoms containing non-BMP
 * characters; byte comparison keeps ordering identical to the Rust maps.
 */
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * The Rust canonical encoder fails above depth 64; `canonicalJson` has no
 * depth bound, so foreign values are walked first. Re-visits are only
 * expanded at strictly greater depths so cyclic input still terminates.
 */
function assertJsonDepth(value: unknown): void {
  const deepest = new Map<object, number>();
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop()!;
    if (depth > MAX_JSON_DEPTH) {
      throw new Error("JSON depth exceeds 64");
    }
    if (typeof current !== "object" || current === null) {
      continue;
    }
    const seen = deepest.get(current);
    if (seen !== undefined && seen >= depth) {
      continue;
    }
    deepest.set(current, depth);
    if (Array.isArray(current)) {
      for (const item of current) stack.push([item, depth + 1]);
    } else {
      for (const key of Object.keys(current)) {
        stack.push([(current as Record<string, unknown>)[key], depth + 1]);
      }
    }
  }
}

function canonical(value: unknown): string {
  assertJsonDepth(value);
  return canonicalJson(value);
}

/** `sha256:<64 lowercase hex>` over the canonical encoding, as in algal. */
function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonical(value))}`;
}

function checkDigest(value: string): string {
  if (
    value.length !== DIGEST_LENGTH ||
    !value.startsWith("sha256:") ||
    parseSha256Hex(value.slice(7)) === null
  ) {
    throw new Error("expected sha256:<64 lowercase hex> digest");
  }
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") throw new Error("expected text");
  if (value.length > max) throw new Error("text exceeds bound");
  return value;
}

function id(value: unknown): string {
  const name = text(value, MAX_ID_UNITS);
  if (!IDENTIFIER.test(name)) {
    throw new Error("expected lowercase kebab-case id");
  }
  return name;
}

function object(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error("expected object");
  return value;
}

/** Reject unknown keys without requiring every allowed key to be present. */
function keys(value: unknown, allowed: readonly string[]): void {
  for (const key of Object.keys(object(value))) {
    if (!allowed.includes(key)) {
      throw new Error(`unknown key ${key}`);
    }
  }
}

/** Mirror serde's `deny_unknown_fields` plus required-field behavior. */
function exact(value: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error(`invalid ${what}`);
  if (!hasExactKeys(value, allowed)) {
    const extra = Object.keys(value).find((key) => !allowed.includes(key));
    throw new Error(extra === undefined ? `invalid ${what}` : `unknown key ${extra}`);
  }
  return value;
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected array");
  if (value.length > max) throw new Error("array count");
  return value;
}

function variable(term: JsonValue): string | null {
  if (isPlainRecord(term) && typeof term["var"] === "string") {
    return term["var"];
  }
  return null;
}

function atom(value: JsonValue): void {
  if (typeof value === "object" && value !== null) {
    throw new Error("memory atoms must be JSON primitives");
  }
  if (utf8ByteLength(canonical(value)) > MAX_ATOM_BYTES) {
    throw new Error("memory atom bytes");
  }
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  return left === right || canonical(left) === canonical(right);
}

/** Validate a literal; returns the set of variable names it binds. */
function literalVars(literal: Literal, arities: Map<string, number>): Set<string> {
  id(literal.relation);
  if (literal.terms.length > MAX_TERMS) {
    throw new Error("relation arity");
  }
  const arity = arities.get(literal.relation);
  if (arity !== undefined && arity !== literal.terms.length) {
    throw new Error("inconsistent relation arity");
  }
  arities.set(literal.relation, literal.terms.length);
  const vars = new Set<string>();
  for (const term of literal.terms) {
    const name = variable(term);
    if (name !== null) {
      keys(term, ["var"]);
      id(name);
      vars.add(name);
    } else {
      atom(term);
    }
  }
  return vars;
}

function charge(state: { work: number }, limits: Limits): void {
  state.work += 1;
  if (state.work > limits.maxWork) {
    throw new Error("Datalog work exhausted; no complete answer");
  }
}

function sortedValues<V>(map: Map<string, V>): V[] {
  return [...map.entries()].sort((a, b) => compareUtf8(a[0], b[0])).map((entry) => entry[1]);
}

function join(
  literals: readonly Literal[],
  tuples: Map<string, Tuple>,
  state: { work: number },
  limits: Limits,
): Binding[] {
  const ordered = sortedValues(tuples);
  let bindings: Binding[] = [{ values: new Map(), premises: [] }];
  for (const literal of literals) {
    const next: Binding[] = [];
    for (const binding of bindings) {
      for (const tuple of ordered) {
        charge(state, limits);
        if (tuple.relation !== literal.relation) {
          continue;
        }
        const candidate: Binding = {
          values: new Map(binding.values),
          premises: [...binding.premises],
        };
        let matched = true;
        const count = Math.min(literal.terms.length, tuple.values.length);
        for (let index = 0; index < count; index += 1) {
          const term = literal.terms[index]!;
          const value = tuple.values[index]!;
          const name = variable(term);
          if (name !== null) {
            const bound = candidate.values.get(name);
            if (bound !== undefined) {
              if (!jsonEquals(bound, value)) {
                matched = false;
                break;
              }
            } else {
              candidate.values.set(name, value);
            }
          } else if (!jsonEquals(term, value)) {
            matched = false;
            break;
          }
        }
        if (matched) {
          if (next.length >= limits.maxBindings) {
            throw new Error("Datalog join bindings");
          }
          candidate.premises.push(tuple.proof);
          next.push(candidate);
        }
      }
    }
    bindings = next;
  }
  return bindings;
}

/**
 * v2 indexed evaluation. Buckets preserve `sortedValues(tuples)` order, so the
 * match enumeration is the same subsequence the naive scan produces — identical
 * binding order, identical first-canonical witnesses, byte-identical `rows` and
 * `proofs`. Only `work` accounting differs: indexed evaluation charges per
 * candidate tuple actually examined (post-index), plus one unit per tuple per
 * fixpoint round for index maintenance. That is a different metric, so results
 * carry `algal.query-result.v2`; snapshots and programs stay `v1`.
 */
interface TupleIndex {
  byRelation: Map<string, Tuple[]>;
  byPosition: Map<string, Tuple[]>;
}

function buildIndex(tuples: Map<string, Tuple>, state: { work: number },
  limits: Limits): TupleIndex {
  const index: TupleIndex = { byRelation: new Map(), byPosition: new Map() };
  for (const tuple of sortedValues(tuples)) {
    charge(state, limits);
    const bucket = index.byRelation.get(tuple.relation);
    if (bucket === undefined) index.byRelation.set(tuple.relation, [tuple]);
    else bucket.push(tuple);
    for (let position = 0; position < tuple.values.length; position += 1) {
      const key = `${tuple.relation} ${position} ${canonical(tuple.values[position])}`;
      const positional = index.byPosition.get(key);
      if (positional === undefined) index.byPosition.set(key, [tuple]);
      else positional.push(tuple);
    }
  }
  return index;
}

function joinIndexed(
  literals: readonly Literal[],
  index: TupleIndex,
  state: { work: number },
  limits: Limits,
): Binding[] {
  let bindings: Binding[] = [{ values: new Map(), premises: [] }];
  for (const literal of literals) {
    const next: Binding[] = [];
    for (const binding of bindings) {
      // Narrow to the smallest candidate bucket: any constant term or already-
      // bound variable selects a positional index; otherwise the relation index.
      let candidates: readonly Tuple[] | undefined;
      let bestSize = Infinity;
      for (let position = 0; position < literal.terms.length; position += 1) {
        const term = literal.terms[position]!;
        const name = variable(term);
        const boundValue = name === null ? term : binding.values.get(name);
        if (boundValue === undefined) continue;
        const bucket = index.byPosition.get(
          `${literal.relation} ${position} ${canonical(boundValue)}`);
        if (bucket === undefined) { candidates = []; bestSize = 0; break; }
        if (bucket.length < bestSize) { candidates = bucket; bestSize = bucket.length; }
      }
      if (candidates === undefined) candidates = index.byRelation.get(literal.relation) ?? [];
      for (const tuple of candidates) {
        charge(state, limits);
        const candidate: Binding = {
          values: new Map(binding.values),
          premises: [...binding.premises],
        };
        let matched = true;
        const count = Math.min(literal.terms.length, tuple.values.length);
        for (let index = 0; index < count; index += 1) {
          const term = literal.terms[index]!;
          const value = tuple.values[index]!;
          const name = variable(term);
          if (name !== null) {
            const bound = candidate.values.get(name);
            if (bound !== undefined) {
              if (!jsonEquals(bound, value)) {
                matched = false;
                break;
              }
            } else {
              candidate.values.set(name, value);
            }
          } else if (!jsonEquals(term, value)) {
            matched = false;
            break;
          }
        }
        if (matched) {
          if (next.length >= limits.maxBindings) {
            throw new Error("Datalog join bindings");
          }
          candidate.premises.push(tuple.proof);
          next.push(candidate);
        }
      }
    }
    bindings = next;
  }
  return bindings;
}

function instantiate(literal: Literal, binding: Binding): JsonValue[] {
  return literal.terms.map((term) => {
    const name = variable(term);
    if (name === null) return term;
    const bound = binding.values.get(name);
    if (bound === undefined) throw new Error("unbound head variable");
    return bound;
  });
}

function parseFact(value: unknown): Fact {
  const record = exact(value, ["relation", "tuple", "sources"], "memory fact");
  const relation = record["relation"];
  const tuple = record["tuple"];
  const sources = record["sources"];
  if (
    typeof relation !== "string" ||
    !Array.isArray(tuple) ||
    !Array.isArray(sources) ||
    !sources.every((source) => typeof source === "string")
  ) {
    throw new Error("invalid memory fact");
  }
  return {
    relation,
    tuple: tuple.slice() as JsonValue[],
    sources: sources.slice() as string[],
  };
}

function parseLiteral(value: unknown, what = "memory literal"): Literal {
  const record = exact(value, ["relation", "terms"], what);
  const relation = record["relation"];
  const terms = record["terms"];
  if (typeof relation !== "string" || !Array.isArray(terms)) {
    throw new Error(`invalid ${what}`);
  }
  return { relation, terms: terms.slice() as JsonValue[] };
}

function parseRule(value: unknown): Rule {
  const record = exact(value, ["id", "head", "body"], "memory rule");
  const ruleId = record["id"];
  const body = record["body"];
  if (typeof ruleId !== "string" || !Array.isArray(body)) {
    throw new Error("invalid memory rule");
  }
  return {
    id: ruleId,
    head: parseLiteral(record["head"]),
    body: body.map((item) => parseLiteral(item)),
  };
}

function parseLimits(value: unknown): Limits {
  const limits: Limits = { ...DEFAULT_LIMITS };
  if (value === undefined) return limits;
  const record = object(value);
  keys(record, LIMIT_NAMES);
  for (const name of LIMIT_NAMES) {
    const raw = record[name];
    if (raw === undefined) continue;
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < 1 ||
      raw > DEFAULT_LIMITS[name]
    ) {
      throw new Error(`invalid memory limit ${name}`);
    }
    limits[name] = raw;
  }
  return limits;
}

export type EvaluationMode = "scan" | "indexed";

export function query(snapshot: unknown, program: unknown,
  options: Readonly<{ evaluation?: EvaluationMode }> = {}): QueryResult {
  if (options.evaluation !== undefined
    && options.evaluation !== "scan" && options.evaluation !== "indexed") {
    throw new Error("memory/query evaluation must be scan or indexed");
  }
  const indexed = options.evaluation === "indexed";
  if (
    utf8ByteLength(canonical(snapshot)) > MAX_SNAPSHOT_BYTES ||
    utf8ByteLength(canonical(program)) > MAX_PROGRAM_BYTES
  ) {
    throw new Error("memory/query input bytes");
  }
  keys(snapshot, ["contract", "facts"]);
  keys(program, ["contract", "rules", "query", "limits"]);
  const snapshotValue = object(snapshot);
  const programValue = object(program);
  if (
    snapshotValue["contract"] !== "algal.memory.v1" ||
    programValue["contract"] !== "algal.query.v1"
  ) {
    throw new Error("memory/query contract");
  }
  const facts = list(snapshotValue["facts"], MAX_FACTS).map(parseFact);
  const rules = list(programValue["rules"], MAX_RULES).map(parseRule);
  const wanted = parseLiteral(programValue["query"], "memory query");
  const limits = parseLimits(programValue["limits"]);

  rules.sort((a, b) => compareUtf8(a.id, b.id));
  const ruleIds = new Set<string>();
  const arities = new Map<string, number>();
  for (const rule of rules) {
    id(rule.id);
    if (ruleIds.has(rule.id) || rule.body.length === 0 || rule.body.length > MAX_BODY_LITERALS) {
      throw new Error("rule id/body bound");
    }
    ruleIds.add(rule.id);
    const headVars = literalVars(rule.head, arities);
    const bound = new Set<string>();
    for (const bodyLiteral of rule.body) {
      for (const name of literalVars(bodyLiteral, arities)) bound.add(name);
    }
    for (const name of headVars) {
      if (!bound.has(name)) {
        throw new Error("unsafe rule: every head variable must occur in the body");
      }
    }
  }
  literalVars(wanted, arities);

  const orderedFacts: Array<{ identity: string; fact: Fact }> = [];
  for (const fact of facts) {
    literalVars({ relation: fact.relation, terms: fact.tuple }, arities);
    for (const value of fact.tuple) atom(value);
    if (fact.sources.length === 0 || fact.sources.length > MAX_FACT_SOURCES) {
      throw new Error("fact requires 1..16 source digests");
    }
    for (const source of fact.sources) checkDigest(source);
    orderedFacts.push({ identity: digest(fact), fact });
  }
  orderedFacts.sort((a, b) => compareUtf8(a.identity, b.identity));

  const tuples = new Map<string, Tuple>();
  const proofs = new Map<string, ProofNode>();
  for (const { identity, fact } of orderedFacts) {
    const key = canonical([fact.relation, fact.tuple]);
    if (tuples.has(key)) continue;
    const proof: ProofNode = { kind: "fact", fact: identity, sources: [...fact.sources] };
    const proofId = digest(proof);
    proofs.set(proofId, proof);
    tuples.set(key, { relation: fact.relation, values: fact.tuple, proof: proofId });
  }
  const base = tuples.size;
  const state = { work: 0 };
  let rounds = 0;
  for (;;) {
    if (rounds >= limits.maxRounds) {
      throw new Error("Datalog rounds exhausted; no complete answer");
    }
    rounds += 1;
    const index = indexed ? buildIndex(tuples, state, limits) : null;
    const additions = new Map<string, Tuple>();
    for (const rule of rules) {
      const ruleDigest = digest(rule);
      const ruleBindings = index === null
        ? join(rule.body, tuples, state, limits)
        : joinIndexed(rule.body, index, state, limits);
      for (const binding of ruleBindings) {
        charge(state, limits);
        const values = instantiate(rule.head, binding);
        const key = canonical([rule.head.relation, values]);
        if (tuples.has(key) || additions.has(key)) continue;
        if (tuples.size - base + additions.size >= limits.maxDerived) {
          throw new Error("Datalog derived tuples");
        }
        const proof: ProofNode = { kind: "rule", rule: ruleDigest, premises: binding.premises };
        const proofId = digest(proof);
        proofs.set(proofId, proof);
        additions.set(key, { relation: rule.head.relation, values, proof: proofId });
      }
    }
    if (additions.size === 0) break;
    for (const [key, tuple] of additions) tuples.set(key, tuple);
  }

  const rows = new Map<string, { tuple: JsonValue[]; proof: string }>();
  const wantedIndex = indexed ? buildIndex(tuples, state, limits) : null;
  const wantedBindings = wantedIndex === null
    ? join([wanted], tuples, state, limits)
    : joinIndexed([wanted], wantedIndex, state, limits);
  for (const binding of wantedBindings) {
    const values = instantiate(wanted, binding);
    const key = canonical(values);
    if (!rows.has(key)) {
      rows.set(key, { tuple: values, proof: binding.premises[0]! });
    }
    if (rows.size > limits.maxRows) {
      throw new Error("Datalog result rows; no truncated answer returned");
    }
  }

  const needed = new Set<string>();
  const pending: string[] = [];
  for (const row of rows.values()) pending.push(row.proof);
  while (pending.length > 0) {
    const proofId = pending.pop()!;
    if (needed.has(proofId)) continue;
    needed.add(proofId);
    const node = proofs.get(proofId);
    if (node !== undefined && node.kind === "rule") {
      for (const premise of node.premises) pending.push(premise);
    }
  }
  for (const key of proofs.keys()) {
    if (!needed.has(key)) proofs.delete(key);
  }

  const result: QueryResult = {
    contract: indexed ? "algal.query-result.v2" : "algal.query-result.v1",
    snapshot: digest(snapshot),
    program: digest(program),
    complete: true,
    witnessPolicy: "first-canonical-derivation",
    rows: sortedValues(rows),
    proofs: Object.fromEntries(
      [...proofs.entries()].sort((a, b) => compareUtf8(a[0], b[0])),
    ),
    work: state.work,
    rounds,
    baseFacts: base,
    derivedFacts: tuples.size - base,
  };
  if (utf8ByteLength(canonical(result)) > limits.maxOutputBytes) {
    throw new Error("Datalog result bytes");
  }
  return result;
}

export function remember(
  snapshot: unknown,
  relation: string,
  tuple: JsonValue[],
  source: unknown,
): Snapshot {
  keys(snapshot, ["contract", "facts"]);
  const record = object(snapshot);
  if (record["contract"] !== "algal.memory.v1") {
    throw new Error("memory contract");
  }
  const name = id(relation);
  if (!Array.isArray(tuple)) throw new Error("memory tuple must be an array");
  const facts = record["facts"];
  if (!Array.isArray(facts)) throw new Error("memory facts");
  const fact: Fact = { relation: name, tuple: tuple.slice(), sources: [digest(source)] };
  const key = canonical(fact);
  const nextFacts = facts.some((existing) => canonical(existing) === key)
    ? facts.slice()
    : [...facts, fact];
  const next = { ...record, facts: nextFacts };
  const check = {
    contract: "algal.query.v1",
    rules: [],
    query: { relation: name, terms: tuple },
  };
  query(next, check);
  return next as Snapshot;
}

export function verify(snapshot: unknown, program: unknown, result: unknown): boolean {
  const contract = isPlainRecord(result) ? result["contract"] : undefined;
  const evaluation: EvaluationMode =
    contract === "algal.query-result.v2" ? "indexed" : "scan";
  return canonical(query(snapshot, program, { evaluation })) === canonical(result);
}

export function sourceId(value: unknown): string {
  return checkDigest(text(value, DIGEST_LENGTH));
}
