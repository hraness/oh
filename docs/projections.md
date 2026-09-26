# Derive facts with rules

Rules let you ask questions a single record cannot answer, such as everything
a record depends on, directly or through a chain. `@hraness/oh/projection`
evaluates positive recursive rules (Datalog without negation) over one graph
head and returns rows with proofs. The rows are output: Oh never writes them
back to the graph. The module is pure TypeScript and runs in Node 24
serverless functions without loading SQLite.

## Evaluate a rule pack

A snapshot pins the space head and the set of record references it read. A
dataset (the fact pack) records which extractor turned those records into
relations, by ID, revision, and digest. Rules and queries are data built with
constructor functions, never strings or callbacks, so the same inputs always
produce the same digest.

```ts
import {
  OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1,
  createOhProjectionDatasetV1,
  createOhProjectionLiteralV1,
  createOhProjectionQueryV1,
  createOhProjectionRecordFactsV1,
  createOhProjectionRulePackV1,
  createOhProjectionRuleV1,
  createOhProjectionSnapshotV1,
  evaluateOhProjectionV1,
  ohProjectionVariableV1 as variable,
} from "@hraness/oh/projection";

const records = oh.store.snapshotRecords();
const snapshot = createOhProjectionSnapshotV1({
  head: oh.head(),
  records,
  spaceId: oh.store.spaceId,
});
const dataset = createOhProjectionDatasetV1({
  extractorSha256: OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1.extractorSha256,
  factPackId: OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1.factPackId,
  factPackRevision: OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1.factPackRevision,
  facts: createOhProjectionRecordFactsV1(records),
  snapshot,
});

const x = variable("x");
const y = variable("y");
const z = variable("z");
const literal = (relation: string, ...terms: ReturnType<typeof variable>[]) =>
  createOhProjectionLiteralV1({ relation, terms });
const rulePack = createOhProjectionRulePackV1({
  rulePackId: "example.dependencies",
  rulePackRevision: 1,
  rules: [
    createOhProjectionRuleV1({
      body: [literal("oh.dependency", x, y)],
      head: literal("depends", x, y),
      ruleId: "depends.direct",
    }),
    createOhProjectionRuleV1({
      body: [literal("depends", x, y), literal("oh.dependency", y, z)],
      head: literal("depends", x, z),
      ruleId: "depends.transitive",
    }),
  ],
});
const query = createOhProjectionQueryV1({
  find: ["x", "z"],
  queryId: "all.dependencies",
  where: [literal("depends", x, z)],
});

const result = evaluateOhProjectionV1({ dataset, query, rulePack, snapshot });
console.log(result.rows);
```

`createOhProjectionRecordFactsV1` turns each record into facts; the rules
above use its `oh.dependency` relation, one fact per dependency edge.

`result.authority` is always `derived`. Oh does not commit a result, promote
an agent’s assertion to a reviewed one, or treat a proof as a source of truth.
Changing the snapshot, extracted facts, rule pack, or query produces a new
result identity. `invalidationForOhProjectionV1(previous, next)` compares two
identities and returns `reusable` or `full-rebuild` with the reasons, such as
`snapshot-changed` or `query-changed`; nothing is updated incrementally.

## Evaluation limits

`evaluateOhProjectionV1` accepts an `options` object. Each limit accepts any
integer from 1 up to its maximum, and a program that crosses one throws a
`RangeError`:

| Option | Default | Maximum |
| --- | --- | --- |
| `maximumDerivedTuples` | 262,144 | 262,144 |
| `maximumRounds` | 1,024 | 1,024 |
| `maximumWorkUnits` | 16,777,216 | 16,777,216 |
| `maximumProofDepth` | 32 | 128 |
| `maximumProofNodes` | 1,024 | 4,096 |
| `maximumTotalProofNodes` | 65,536 | 65,536 |
| `maximumResultBytes` | 16 MiB | 16 MiB, at least 64 KiB |

Inputs have fixed limits too: at most 262,144 facts, 1,024 rules, 64 literals
per rule, arity 32, 256 variables, and 16 KiB per atom (`OH_PROJECTION_LIMITS_V1`
lists them all). A proof that reaches the depth limit or loops back on itself
ends in a `truncated` node. A result that hits the query row limit or the
result byte limit sets `truncated` and names the reason.

The evaluator favors transparent, predictable results over speed. It supports
positive recursion with set semantics. It does not support negation,
aggregation, arithmetic, or incremental updates. The
[projection specification](../spec/v1/projection.md) defines the formats,
proofs, and digests.

## Cross-check with Suss

An optional second path evaluates the same rules with exactly
`@suss/datalog@0.20.0` and returns a result only when every relation matches
Oh’s evaluator:

```sh
bun add @suss/datalog@0.20.0
```

```ts
import { evaluateOhProjectionWithSussV1 } from "@hraness/oh/projection-suss";

const checked = evaluateOhProjectionWithSussV1({
  dataset,
  query,
  rulePack,
  snapshot,
});
```

Suss has no hook for limiting its own work. Before running it, the adapter
counts the most tuples each rule head could produce: the number of distinct
values raised to the head’s arity, less the facts already present. If that
count could exceed `maximumDerivedTuples`, it throws a `RangeError` without
running Suss. A two-column rule over 513 distinct values, for example, could
produce 513² = 263,169 tuples, more than the default 262,144, so it is
refused. Oh’s own evaluator handles those programs. This path always runs
both engines; it checks that they agree and is slower than either one alone.
