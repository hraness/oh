# Matched full-context companion

This companion has completed. [EVOLUTION_RELEASE_RESULTS.md](EVOLUTION_RELEASE_RESULTS.md)
reports full history at 355/500 against both retrieval arms, and the
[public summary](results/memory-evolution-full-context-500-v1.json) records it.

The optional V8 run adds one full-context control over the exact500 questions
and five100-question shards already frozen by a V7 LongMemEval study. The V7
study keeps its two original arms. This companion uses a separately pinned
campaign and store; it does not import or replace the parent study's attempts.
Both use the same combined nano reader and native16 Gateway judge profiles.

This is a descriptive full-release comparison. The original exposure manifest
is preserved, including development and closed/unknown entries. These entries
are not reclassified as untouched confirmation. A paired gain on this release
would not establish superiority over other frameworks or published results
that use different readers, judges, source presentation or accounting.

The control uses `evolution-full-history.ts`: every source turn, in the existing
parser's input-corpus order, rendered with the same original turn headers and
two-newline separators. There is no query selection, topK, clipping, embedding
or QMD index. The existing policy rejects oversized sources instead of silently
truncating them. The new context-plan V7 envelope contains one copy of each
context and binds it to the companion study, parent study, parent scope and
exact shard. Its source validation rebuilds the original full-history result.

Reader requests are identical to the existing full-history V3 path for the
same reader, question and source text. They retain the explicit model V2
profile-window accounting: reserve the full400,000-input-token financial
window, preserve the actual body digest/bytes, and label tokenizer fit unknown
until the provider accepts it. The8,192-token output cap includes reasoning.
No tokenizer estimate or byte limit is described as proof of model fit.

## Freeze the companion before preparation

Create a new `oh.memory.evolution-full-context-study.v1` JSON file with these
fields. All pins use `{path: absolutePath, sha256: fileByteSha256}`.

- `mode: "full-release-descriptive-companion"`;
- `parentStudyPin`, `parentScopePin`: the exact original V7 artifacts;
- `datasetPin`, `manifestPin`: exactly equal to the parent study's source pins;
- `campaignPin`: a separate campaign descriptor with a distinct ID and
  non-overlapping canonical store directory;
- `sourceSha256`: the current `retrievalIdentity()` value;
- `fullHistoryPolicySha256`: `canonicalSha256(EVOLUTION_FULL_HISTORY_POLICY)`;
- `variants: [{id: "full-history", system: "full-history"}]`;
- `reader: "gpt5-nano-explicit-abstention-composition-v1-reader"`;
- `judge: "gpt4o-gateway-native-rubric-16-judge-v1"`;
- `rubricSha256`: the unchanged `EVOLUTION_RELEASE_RUBRIC_SHA`;
- `repeatPolicy: "predeclared-full-matrix-first-attempt"`.

The source pin belongs to the companion's execution tree. The parent retains
its original source pin; it is not resealed to pretend that its earlier
retrieval occurred under the new code. Dataset questions and gold are not
needed for the metadata check:

```sh
bun scripts/benchmarks/evolution-full-context-cli.ts check \
  --study /absolute/companion-study.json --study-sha256 SHA \
  --output /absolute/new-admission.json
```

This produces a metadata-only receipt with500 questions/500 reader cases and
five exact shard hashes. It does not verify a spending allowance, open a store,
prepare contexts or establish input capacity. The launch owner must inspect
the actual no-provider dry plans and approve bounded campaign execution.

## Prepare and run each shard

Create five explicit `oh.memory.evolution-run.v8` configs. Each includes the
normal `dataset`, `datasetPin`, `manifestPin`, `campaignPin`, `directory`,
`storeDirectory`, `variants`, `readers`, `judge`, `limit`, `seed` and
`concurrency` fields, plus `companionStudyPin` and one `shardId` from
`shard-001` through `shard-005`. `limit` is100, `seed` is17, and concurrency is
24 or32 using the existing paid queue V2. `readers` contains only the fixed
combined nano profile. There is no semantic-cache field.

Each shard has its own output directory; V8 phase and report outputs must stay
inside it, outside both campaigns' stores. All five use the same companion
campaign/store. Original source and manifest bytes are validated before the
exact parent-shard selection is projected to source/question-only input.
Preparation uses only the source projection; gold remains with the judge.
Contexts and reader plans each retain the128MiB artifact bound. A source or
request that exceeds a bound stops preparation; reducing the control's source
is not an allowed recovery.

Use the existing commands, with pinned config and phase artifacts:

```sh
bun scripts/benchmarks/evolution.ts prepare --config /absolute/shard-config.json --config-sha256 SHA
bun scripts/benchmarks/evolution.ts --help
```

The help lists exact `readers`, `run-reader`, `judge-plan`, `run-judge` and
`report` flags. Every phase reloads the companion/parent scope bindings. The
existing request constructors, store, provider restriction, durable capture,
spending limits, interruption/drain and occupied-attempt rules remain in force.
A new companion campaign is separate accounting, not permission to overwrite
parent answers or reset any earlier cap. The root-owned aggregate spending
record must include both campaigns and other sibling work once each.

## Report and compare

Each companion shard report uses `oh.memory.evolution-report.v3`. It retains
full100 coverage, reader-failure zero, separate judge-failure zero, and full
reservations for unresolved attempts. Never-admitted cases prevent a complete
report. Usage/cost and evidence metrics remain separate. The judge uses the
native prompt and contains-yes rule through a Gateway alias with a16-token
cap, not the official pinned snapshot/10-token reproduction.

After all five parent V2 reports and five companion V3 reports are complete,
create an `oh.memory.evolution-full-context-combine.v1` descriptor containing
`studyPin`, `parentReportPins` and `reportPins`. Each report list contains five
distinct byte pins. Then run:

```sh
bun scripts/benchmarks/evolution-full-context-cli.ts combine \
  --input /absolute/companion-combine.json --input-sha256 SHA \
  --output /absolute/new-comparison.json
```

The offline reducer requires the exact500-ID union for all three arms, keeps
the parent reduction unchanged, and emits aggregate paired/category/exposure
summaries. Physical costs deduplicate within a campaign. Identical request
hashes across distinct campaigns remain separately charged; attributed arm
costs are not incremental invoices. Publication authenticates artifact bytes;
physical response and outcome custody comes from the shard reporter and store,
not a second raw-response reconstruction by the reducer.

## Focused checks

```sh
bun test tests/memory-benchmark-evolution-full-context.test.ts tests/memory-benchmark-evolution-full-context-report.test.ts
```

Fixtures use synthetic500 metadata and source turns, blocked provider calls,
original V3 request parity, source/order/coverage attacks, isolated campaign
reloads, captured failures, unknown usage and complete paired reduction. They
do not inspect closed benchmark answers or qualify actual provider capacity.
