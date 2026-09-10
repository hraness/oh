# Full-release descriptive LongMemEval comparison (V7)

V7 admits one separately frozen, full500 descriptive study. It compares BM25 window retrieval and Oh semantic retrieval, both top100/96,000 UTF-8 context bytes, using `gpt5-nano-explicit-abstention-composition-v1-reader` and `gpt4o-gateway-native-rubric-16-judge-v1`. Semantic contexts retain their retrieval order. The fixed candidate must be selected before study preparation or access to additional scores. This path does not broaden an existing development configuration.

The existing exposure manifest stays unchanged. Every release question is included, and declared family/history components stay in one shard. Admission requires exactly five100-question shards; a different grouping that cannot satisfy this bound fails. Development/evaluated and closed/unknown strata are reported separately. A closed question is not made unseen or held out by this path. Generic sealed-scope metadata helpers are not an implemented BEAM evaluator or freshness attestation.

This is the full question set under a declared adapted evaluator. The judge uses the native LongMemEval prompt and contains-yes reduction, but the Gateway GPT-4o alias is not the official pinned snapshot and the16-token output cap differs from the native10-token cap. Neither the run nor its report is an official-protocol reproduction. There is no confidence interval, independent-sample claim, or superiority decision in this descriptive reducer.

## Freeze the study and exact scope

Create a private JSON study with this shape. All paths are absolute; substitute actual file-byte SHA-256 values and the current `retrievalIdentity()` digest exported by `scripts/benchmarks/evolution.ts`. The official dataset pin is checked against `DATASETS["longmemeval-s"]`. The campaign is an independently admitted shared authority, with one canonical store and its existing budget limits.

```json
{
  "protocol": "oh.memory.evolution-release-study.v1",
  "mode": "full-release-descriptive",
  "dataset": "longmemeval-s",
  "datasetPin": {"path": "/private/study/longmemeval_s_cleaned.json", "sha256": "ACTUAL_OFFICIAL_FILE_SHA256"},
  "manifestPin": {"path": "/private/study/exposure.json", "sha256": "ACTUAL_MANIFEST_FILE_SHA256"},
  "campaignPin": {"path": "/private/study/campaign.json", "sha256": "ACTUAL_CAMPAIGN_FILE_SHA256"},
  "retrievalSourceSha256": "ACTUAL_RETRIEVAL_SOURCE_DIGEST",
  "variants": [
    {"id": "window-96k", "system": "bm25-window", "budget": {"topK": 100, "contextBytes": 96000}},
    {"id": "semantic-96k", "system": "oh-semantic", "budget": {"topK": 100, "contextBytes": 96000}}
  ],
  "reader": "gpt5-nano-explicit-abstention-composition-v1-reader",
  "judge": "gpt4o-gateway-native-rubric-16-judge-v1",
  "rubricSha256": "00d319ba0a194a69871576d8c677c1557d7706f69b599c9b7beee32441d58cfc",
  "candidatePresentation": "retrieval-order",
  "repeatPolicy": "predeclared-full-matrix-first-attempt"
}
```

Run the metadata-only scope command before preparing any shard. It reads the study and exposure manifest, checks the current retrieval source, and exclusively writes the scope. It does not open source questions, a campaign store, or a provider connection.

```sh
bun scripts/benchmarks/evolution-release-cli.ts scope \
  --study /private/study/study.json --study-sha256 ACTUAL_STUDY_FILE_SHA256 \
  --output /private/study/scope.json
```

The scope binds exact ordered question IDs, metadata/exposure, candidate and control definitions, reader/judge profile hashes, rubric, and failure rule. Hashes authenticate selected bytes; they do not prove that declared histories are independent or that an exposure declaration is true. Keep the source tree, study, candidate, profiles and original manifest fixed for all shards. Do not use intermediate shard scores to select or revise the candidate.

## Run five ordinary reader/judge pipelines

Create five explicit configs with `protocol: "oh.memory.evolution-run.v7"`. Each carries the usual `dataset`, `datasetPin`, `manifestPin`, `campaignPin`, `variants`, `readers`, `judge`, `directory`, `storeDirectory`, `limit`, `seed`, `concurrency` fields plus:

```json
{
  "studyPin": {"path": "/private/study/study.json", "sha256": "ACTUAL_STUDY_FILE_SHA256"},
  "scopePin": {"path": "/private/study/scope.json", "sha256": "ACTUAL_SCOPE_FILE_SHA256"},
  "shardId": "shard-001",
  "semanticCacheDirectory": "/private/study/qmd-cache"
}
```

Use exactly `limit: 100`, `seed: 17`, `readers: ["gpt5-nano-explicit-abstention-composition-v1-reader"]`, the fixed variants/judge above, and concurrency24 or32 through the existing queueV2. Shard IDs are `shard-001` through `shard-005`; `seed` does not sample or reorder scope IDs. Use a separate output directory per shard and the same campaign/store. Cache, store and output paths must be disjoint, and pinned inputs must remain outside them. The optional QMD package/model runtime must already be qualified and available. V7 loads `@tobilu/qmd` before its first SQLite instance and uses the actual Oh semantic backend with a persistent optional cache; preparing contexts performs local embedding inference, not paid reader calls. `modelCalls: 0` in preparation refers to paid reader/judge calls, not absence of local embedding work.

The default optional package must resolve as `@tobilu/qmd` from this execution tree; a globally installed package reachable only through an absolute path does not meet that prerequisite. Pin and qualify its exact version, model files and native loading before the study. This patch has synthetic integration evidence only. The public `prepare` command writes the completed shard at the end; it does not provide a per-corpus checkpoint or a supervisor lifetime bound. Run it under the repository scheduler with a bounded native supervisor. Keep completed shard artifacts immutable. A supervisor may assemble a baseV1 plan from separately authenticated corpus results and call the pure `makeEvolutionReleaseContextPlan` wrapper, but it must preserve exact scope order, source/ranking evidence and runtime custody; normal reader admission still rebuilds scope/source validation. No partial shard can be reported as complete.

For each pinned config, use the unchanged public commands documented in [EVOLUTION.md](EVOLUTION.md): `prepare`, `readers`, `run-reader`, `judge-plan`, `run-judge`, then `report`. Every paid invocation still needs explicit `--max-usd`, `--max-new-calls`, exact plan/config pins and an exclusive output. V7 uses the same request profiles, durable capture, store admission, first-attempt occupancy, failure projection, queue stop/drain, and global spending guards. It has no additional provider transport or retry mechanism. Contexts use context-planV6; reports use reportV2. Original retrieval/result and request bytes remain unchanged inside that scope wrapper.

Preparation and every context reload authenticate the scope, exact selected source/gold projection, current retrieval source and fixed matrix. The reader projection contains source/question fields only; scorer metadata is joined separately. Preparation does not rerun or authenticate a vendor's published baseline. Each config covers200 logical reader cases. Across the study there are1,000 logical reader cases and at most1,000 judge cases requiring new physical requests before exact request deduplication; reader failures suppress their judge dispatch. Existing occupied requests are preserved, and any reused responses must be disclosed rather than treated as newly sampled answers. Campaign capacity can prevent completion; these counts create no spending authority.

## Reconcile all shards

Each reportV2 contains private opaque per-case IDs and authenticated score/failure projections, plus per-request evidence hashes and conservative usage/reservation figures. Keep those detailed reports private. Create a combine input containing the study/scope pins and exactly five report pins:

```json
{
  "protocol": "oh.memory.evolution-release-combine.v1",
  "studyPin": {"path": "/private/study/study.json", "sha256": "ACTUAL_STUDY_FILE_SHA256"},
  "scopePin": {"path": "/private/study/scope.json", "sha256": "ACTUAL_SCOPE_FILE_SHA256"},
  "reportPins": [
    {"path": "/private/study/shard-001/report.json", "sha256": "ACTUAL_REPORT1_SHA256"},
    {"path": "/private/study/shard-002/report.json", "sha256": "ACTUAL_REPORT2_SHA256"},
    {"path": "/private/study/shard-003/report.json", "sha256": "ACTUAL_REPORT3_SHA256"},
    {"path": "/private/study/shard-004/report.json", "sha256": "ACTUAL_REPORT4_SHA256"},
    {"path": "/private/study/shard-005/report.json", "sha256": "ACTUAL_REPORT5_SHA256"}
  ]
}
```

```sh
bun scripts/benchmarks/evolution-release-cli.ts combine \
  --input /private/study/combine.json --input-sha256 ACTUAL_INPUT_FILE_SHA256 \
  --output /private/study/combined-public.json
```

The offline reducer requires every exact shard and500-question/1,000-case coverage, recomputes aggregate/category/exposure and paired descriptive summaries, checks consistent scoring and campaign identities, and deduplicates physical cost by exact request/evidence identity across shards. Its public projection omits question IDs, source/answer text and local paths. It verifies report-byte custody and internal consistency; the upstream report's authenticated reader/phase/store relationship remains the evidence boundary. Combining hashes is not a second raw-response or provider-billing audit.

Every question remains in its answer-score denominator. A failed reader answer scores zero; judge failures also score zero for judge accuracy and are counted separately. Retrieval evidence remains a separate metric. Unverifiable occupied attempts retain full reserved exposure without invented tokens or usage. A reserved request with no capture does not establish that a physical dispatch occurred. A never-admitted request, missing phase evidence, duplicate/foreign ID or incomplete shard prevents a complete combined report. Known cost plus unresolved reservation is conservative accounted exposure, not an invoice or an incremental cost of a cache-reusing invocation.

Synthetic scope, config, source/request parity and generic native16 reader/judge/report fixtures qualify the additive artifact. They do not establish the wall time, local model runtime, provider service performance or accuracy of an actual full500 run; record that live evidence separately when the authorized study is executed.

## What this comparison can establish

A paired score difference describes performance on this fixed500-question set under the same reader, context budget and evaluator. A separately specified statistical analysis must retain the declared question/family/history dependence and the history of adaptive development; it does not turn these data into untouched confirmation. A claim about unseen-task superiority needs a separately sealed benchmark and exposure audit, with the candidate fixed before its scores are accessed. A scope file alone does not establish state-of-the-art performance.

The next standards comparison should include a complete original full-context control on the same500 questions with the same nano reader and judge, as a declared third arm in a separately admitted study. That control is outside this fixed two-arm V7 scope. Compare external frameworks through matched adapters and measured ingestion/reader/judge costs; do not substitute their paper scores from different models or protocols. BEAM remains a separate confirmation-adapter/exposure-qualification task rather than a relabeling of the current closed/unknown questions.
