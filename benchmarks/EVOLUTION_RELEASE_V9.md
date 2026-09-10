# Explicit-selection studies with indexed repeats (V9)

V9 is the runner protocol for every score that must be read on the full 500
LongMemEval-S questions with real repeats, or on a second benchmark. It removes
four plumbing limits of the [V7 full-release lane](EVOLUTION_RELEASE_V7.md)
without changing that lane: a study now names its question set by an explicit
ordered list of runner IDs instead of a seed over a partition, declares a
candidate and a control system with any admitted whole-turn budget, carries an
indexed repeat count for readers and judges through the campaign store, and
fixes a reader date policy and a derived-record pin slot before any score is
read. The V1-V8 parsers, plans, receipts and reports are untouched; V9 has its
own study, scope, context, reader-plan, judge-plan, phase-receipt and report
protocols.

No V9 score has been read yet. This page records the procedure and the offline
evidence; the [results page](EVOLUTION_RELEASE_RESULTS.md) records outcomes.

## What V9 adds

- **Explicit selection.** `oh.memory.evolution-study.v9` pins `selection`, an
  ordered list of runner question IDs. The development stratum is pinned by
  IDs, never by seed; the closed stratum is admitted with its declared exposure
  reported beside it. `oh.memory.evaluation-scope.v2` accepts up to 260
  questions per shard and two shard policies: `packed-clusters` reproduces the
  V1 packing (the full 500 yields the same five shards as V7) and
  `one-cluster-per-shard` gives every declared conversation cluster its own
  shard for LoCoMo. A partially selected cluster (LoCoMo without its adversarial
  category) is admitted, counted and never split across shards. V1 scopes are
  untouched.
- **Candidate and control.** The study names `control` and `candidate`
  whole-turn retrieval variants (any `EVOLUTION_RETRIEVAL_SYSTEMS` member, topK
  1-400, context bytes up to 4,000,000). Contexts, reader plans and reports are
  ordered control first; the report pairs each candidate against the control at
  a fixed reader and each non-first reader against the first reader at a fixed
  variant.
- **Indexed repeats.** `repeats` (1-3) and `judgeRepeats` (1-3) are declared in
  the study and the scope. Reader plan V2 (`oh.memory.evolution-reader-plan.v2`)
  has one case per (question, variant, reader, stage, repeat); judge plan V9
  adds a judge repeat index per reader case. Physical requests are still
  deduplicated by digest, and the campaign store keys every attempt by
  (request, repeat), so a repeat is a distinct predeclared first attempt in the
  same campaign, never a retry. Phase receipts use
  `oh.memory.evolution-phase.v2` with `{requestSha256, repeat, response}` rows.
  The `select` stage name is reserved for the two-stage evidence-selection
  reader; a plan naming it is rejected until that stage's request derivation is
  admitted by its own protocol revision.
- **Reader date policy.** `readerDatePolicy` is `question-date` (send the
  dataset's own question date, empty for LoCoMo) or `final-session-date` (send
  the date of the corpus's final turn as the reference date, the closest
  analogue to the leaders' LoCoMo harnesses). The policy is applied in the V9
  projection step to `questionDate` only, so retrieval queries, source
  validation and the exposure manifest do not depend on it; its digest is part
  of the scope design and of every V9 context plan. It is chosen in the study
  before any score exists and cannot be changed by resealing.
- **Derived-record pin.** `derivedRecordsPin` is a declared slot for a pinned
  write-time memory artifact. This revision admits only `null`: a study that
  declares a pin fails closed at preparation until a retrieval lane consumes
  it. The slot exists so the lane can be added without a study-protocol change.
- **Rebind for every whole-turn parent.** `rebind` now accepts a V9
  configuration whose study declares `retrievalProvenance`, and reuses a V1
  development plan, a V7 release wrapper or an earlier V9 wrapper byte for
  byte: every parent result is re-validated against the current source
  rendering, the current retrieval identity is restamped, and no retrieval,
  embedding or provider call occurs. A V4 development configuration can also
  rebind its own whole-turn V1 contexts after a source identity change.
- **Reports.** `oh.memory.evolution-report.v9` scores the per-question mean
  judge decision over every (reader repeat, judge repeat) cell (`judge-mean`),
  keeps every cell's binary accuracy (`byCell`), counts questions whose cells
  agree (`repeatAgreement`), attributes cost and latency over every physical
  (request, repeat) job, and projects ID-only outcome and physical rows for the
  study reducer `oh.memory.evolution-study-summary.v9`.

## Freeze the study and exact scope

```json
{
  "protocol": "oh.memory.evolution-study.v9",
  "mode": "explicit-selection-descriptive",
  "dataset": "longmemeval-s",
  "datasetPin": {"path": "/private/study/longmemeval_s_cleaned.json", "sha256": "ACTUAL_OFFICIAL_FILE_SHA256"},
  "manifestPin": {"path": "/private/study/exposure.json", "sha256": "ACTUAL_MANIFEST_FILE_SHA256"},
  "campaignPin": {"path": "/private/study/campaign.json", "sha256": "ACTUAL_CAMPAIGN_FILE_SHA256"},
  "retrievalSourceSha256": "ACTUAL_RETRIEVAL_SOURCE_DIGEST",
  "candidate": {"id": "semantic-96k", "system": "oh-semantic", "budget": {"topK": 100, "contextBytes": 96000}},
  "control": {"id": "window-96k", "system": "bm25-window", "budget": {"topK": 100, "contextBytes": 96000}},
  "readers": ["gpt5-mini-explicit-abstention-composition-v1-reader"],
  "judge": "gpt4o-gateway-native-rubric-16-judge-v1",
  "rubricSha256": "00d319ba0a194a69871576d8c677c1557d7706f69b599c9b7beee32441d58cfc",
  "repeats": 3,
  "judgeRepeats": 1,
  "selection": ["q-...", "q-..."],
  "maximumQuestionsPerShard": 100,
  "shardPolicy": "packed-clusters",
  "derivedRecordsPin": null,
  "retrievalProvenance": null,
  "readerDatePolicy": "question-date",
  "candidatePresentation": "retrieval-order",
  "repeatPolicy": "predeclared-full-matrix-indexed-repeats"
}
```

`dataset` admits `longmemeval-s`, `locomo` and `beam`; a BEAM study fails
closed until `DATASETS` carries its revision, bytes and digest. The LoCoMo
parity judge `gpt4o-mini-locomo-j-judge-v1` and the `locomo` dataset require
each other. Readers are any one to four admitted `-reader` profiles. The same
offline scope command writes the V2 scope:

```sh
bun scripts/benchmarks/evolution-release-cli.ts scope \
  --study /private/study/study.json --study-sha256 ACTUAL_STUDY_FILE_SHA256 \
  --output /private/study/scope.json
```

## Run the shards

Each shard configuration uses `protocol: "oh.memory.evolution-run.v9"` with
`dataset`, `datasetPin`, `manifestPin`, `campaignPin`, `studyPin`, `scopePin`,
`shardId`, `limit` (the shard's question count), `variants` (control first,
candidate second), `readers`, `judge`, `repeats`, `judgeRepeats`,
`readerDatePolicy`, `derivedRecordsPin`, `directory`, `storeDirectory`,
`concurrency` (24 or 32) and `semanticCacheDirectory`. There is no `seed`.
Every field is re-checked against the frozen study and the shard on every
reload. Cache, store and output paths must be disjoint and pinned inputs stay
outside them.

The commands are the unchanged public ones from [EVOLUTION.md](EVOLUTION.md):
`prepare` (or `rebind` with a parent `--context`), `readers`, `run-reader`,
`judge-plan`, `run-judge`, `report`. Paid phases still require explicit
`--max-usd` and `--max-new-calls` equal to the campaign's bounds, a clean
committed Bun 1.3.14 tree, and an exclusive output inside the shard directory.
A phase receipt lists every planned (request, repeat) job with exactly one
verified response or one authenticated occupied failure. Reports and
`judge-plan` reload the study, scope, manifest and campaign store on every call.

Combine every shard with a descriptor whose `reportPins` cover each scope shard:

```json
{
  "protocol": "oh.memory.evolution-study-combine.v9",
  "studyPin": {"path": "/private/study/study.json", "sha256": "ACTUAL_STUDY_FILE_SHA256"},
  "scopePin": {"path": "/private/study/scope.json", "sha256": "ACTUAL_SCOPE_FILE_SHA256"},
  "reportPins": [{"path": "/private/study/shard-001/report.json", "sha256": "ACTUAL_REPORT1_SHA256"}]
}
```

```sh
bun scripts/benchmarks/evolution-release-cli.ts combine \
  --input /private/study/combine.json --input-sha256 ACTUAL_INPUT_FILE_SHA256 \
  --output /private/study/combined-public.json
```

The reducer requires every shard, recomputes each shard's judge-mean summary
from its outcome rows, aggregates per-question means, per-cell accuracies,
category and exposure strata, candidate-versus-control pairs per reader, and
deduplicates cost by (request, repeat). Its projection omits question IDs,
source or answer text and local paths.

## Rebind existing contexts (E4a)

The protocol smoke rebound the five mini full-500 V7 context plans (study
`090c3edb…de80`, retrieval source `5cbf1874…f75d`) under a V9 study that
declares that study and source as its `retrievalProvenance`, pins the full 500
selection in scope order, `packed-clusters`, `readerDatePolicy:
"question-date"`, `repeats: 1`, `judgeRepeats: 1`, the same mini reader and
native-16 judge, and a campaign descriptor that was never opened. The run was
read-only against the mini campaign, `fetch` was replaced by a throwing stub,
no campaign store was opened, and every command reported `modelCalls: 0`.

| Artifact | Result |
| --- | --- |
| Retrieval source of this tree | `f2cc0aceb60abbcfd68ab1a0daf0c16a786177904d3953460eb92b1bd6447f0a` |
| V2 scope | `scopeSha256` `36df7bbf…5cc6`; five shards of 100 whose ordered question IDs equal the V1 scope's shards |
| shard-001 | parent plan `ad632ad0…1e94` to rebound plan `037cc61e…dfc5`; 200 contexts byte-identical; 9.8 s |
| shard-002 | parent plan `e0ad6e2a…4ca0` to rebound plan `68fa9dbb…7544`; 200 contexts byte-identical; 9.7 s |
| shard-003 | parent plan `0ecfa4a4…10b0` to rebound plan `b7593ab2…6fec`; 200 contexts byte-identical; 10.6 s |
| shard-004 | parent plan `1629b63a…59a9` to rebound plan `e7e66ab3…2773`; 200 contexts byte-identical; 9.8 s |
| shard-005 | parent plan `6a74452e…c72f` to rebound plan `15544eab…5f81`; 200 contexts byte-identical; 10.0 s |

Byte-identical means every rebound case carries the parent case's exact
`result` (context text, `contextSha256`, `resultSha256`, turn and session
IDs) in the same question and variant order; only `retrievalSourceSha256`,
`inputSha256` and the V9 binding moved. The private receipt
(`ws4-v9-e4a/e4a-receipt.json` beside the study) holds the full digests. The
reader and judge phases were not run; E0b's noise floor can now be expressed as
a V9 study over these contexts with `repeats: 3` inside one campaign.

## LoCoMo parity lane

The LoCoMo lane reads J the way the leaders do: the Packer/Mem0/Zep
CORRECT/WRONG prompt in
[`benchmarks/profiles/locomo-judge-v1.json`](profiles/locomo-judge-v1.json),
profile `gpt4o-mini-locomo-j-judge-v1` (Gateway `openai/gpt-4o-mini` alias,
temperature 0, 128 output tokens), scoring rule `correct-wrong` (exactly one
of the two labels; both or neither is a judge failure), categories 1-4 only
(multi-hop, temporal, open-domain, single-hop; 1,540 questions), and the
official F1 reported as a diagnostic that underestimates abstention because the
native abstention regex does not match the explicit-abstention reader wording.
No LoCoMo-specific abstention phrase was added. `gpt4o-mini-reader` (same
alias, temperature 0, single call) exists as the like-for-like answerer row;
under the current budget policy every descriptor written in this phase uses
GPT-5 nano or mini readers and a cap of $20 or less, so the gpt-4o-mini row
stays declared but unfunded.

Exposure is declared once by
`scripts/benchmarks/evolution-locomo-exposure.ts`, which reads only the pinned
official file and writes a manifest plus the ordered parity selection: the two
seed-17 development conversations are development/development and the eight
test conversations are closed/evaluated, because both were read by earlier
public runs. Nothing in LoCoMo is unseen. The generated private manifest
(`40c46fec…07bd`) declares 10 conversations, 1,986 questions and the 1,540
parity questions per conversation: conv-26 152, conv-30 81, conv-41 152,
conv-42 199, conv-43 178, conv-44 123, conv-47 150, conv-48 191, conv-49 156
and conv-50 158. The reader date policy for LoCoMo is `final-session-date`,
fixed in the study before any score. Studies shard one conversation per shard;
the reducer's strata and category breakdowns use the leaders' category names.

The E4b descriptor written in this phase (study `1dedd8de…f7ba`, scope
`e875f794…b158`, ten shards of 158/150/191/123/199/81/152/156/178/152
questions, strata closed/evaluated 1,226 questions over 8 conversations and
development 314 over 2) uses the GPT-5 nano explicit-abstention reader with
three indexed repeats, one judge repeat on the parity judge, a 24 KB
`bm25-window` control against a 24 KB `oh-semantic` candidate at top-100,
and a campaign cap of $20 / 20,000 calls (expected exposure about $5). It has
not been opened; no reader or judge call has been dispatched.

## Boundaries

V9 is descriptive. Repeats average reader and judge noise; they do not shrink
question-sampling uncertainty, and declared clusters are not proven independent.
A V9 report contains no confidence interval or superiority decision. Closed
questions keep their declared exposure; evaluated or unknown does not mean
unseen. The Gateway aliases are not pinned snapshots. Synthetic fixtures
qualify the artifact offline; live wall time, provider behaviour and accuracy
are recorded separately when an authorized study runs.
