# Context reserve campaigns (v3)

Use `bun scripts/benchmarks/memory-lab/campaign-v3.ts --help` when comparing
author-log context reserves. Keep v1 and v2 workspaces and source pins unchanged.
The v3 runner uses the existing API transport and shared ledger; a new workspace
does not reset spending, call counts, exposed families or the authorized deadline.

## Freeze the context comparison

`CampaignConfig` in `campaign-contract-v3.ts` adds `contextPolicies`, a
`rankingProfileSha256`, `maximumAnswerJsonBytes`, and `screenCriterion`. A policy has an `id` and
`logReserveBytes`. Each treatment names its `contextPolicyId` alongside its
instruction. The renderer holds the total budget at 180,000 bytes, retrieved
budget at 96,000 bytes, native lists at top 100, previous/next neighbors at one,
and reciprocal-rank fusion constant at 60. Source turns remain verbatim.

Each non-control task input contains its question/date, both hashed contexts,
separate pinned source and ranking files, and judge-only rubric. Source files
contain only the `oh.memory-lab-source.v1` protocol and whitelisted turns. Rank
files use `oh.memory-lab-native-ranks.v1` and bind the exact source bytes, question
digest, profile digest, and native lexical/vector lists. The executor recomposes
every context from these files before any provider call. Do not place labels,
rubric text or expected answers in sources, rankings or reader instructions.

The preparation review must verify actual native ranking provenance against
retained generator, dependency and local model hashes. A declared profile digest
alone is not evidence of native execution. Freeze the candidate before opening
fresh confirmation material; preserve all earlier exposure records. Offline
preparation may produce exact hashed artifacts without exposing confirmation
text to the proposer. Review all exact plan and cost bindings before dispatch.

## Calls and analysis

Plans declare `repeats` from one to eight; controls run once. Repeats use distinct
provider calls and deterministic rotating arm order. Analysis averages repeats
within each task and tasks within their conversation cluster. Repeats do not
increase the independent cluster count. The original baseline is an additional
contemporaneous arm in confirmation after the first promotion. Both comparisons
must pass; the summary reports the smaller effects, larger p-value and weaker
guard bound, with comparator-specific rejection reasons. This intersection gate
does not claim a pooled or adjusted effect estimate.

Use the same control, A/A, screen and confirmation sequence as
[v2](campaign-v2.md). Freeze a sample-size rationale and the full conditional
confirmation budget before screening. Small attainability thresholds still do
not establish adequate power or public benchmark standing.

Freeze `screenCriterion` as either `cluster-sign` (the v2 screening rule) or
`development-effect` before any calls. Development-effect screening is a selection
heuristic: require complete observations, at least three target and guard families,
the minimum mean target effect, and the guard mean floor. Report signs and p-values
descriptively; they do not decide this screen. A/A rejects variation that would pass
the same selected screen, as well as variation above its paired absolute-difference
ceiling. Confirmation always requires the original statistical, effect and guard
confidence gates, regardless of the screening choice. A screen never promotes.

Every reader request must have `prepareApiRequest(...).inputUpperBound <= 200000`,
including transport overhead, before the first call. `maximumAnswerJsonBytes`
counts `Buffer.byteLength(JSON.stringify(answer))`, including the surrounding
quotes. An oversized answer fails the cell without truncation or judge dispatch;
it remains in the planned denominator. Include this failure condition when
freezing the design and calculate judge reservations using that exact envelope.

All captures, failed observations and uncertain effects remain durable. Only
replayed native responses can establish live assessments. A higher development
score or local promotion does not satisfy the skill's public-result threshold.

Planning new controls withdraws both previous qualifications; planning new A/A
withdraws the previous A/A qualification. Screening, new provider dispatches and
promotion require the latest controls and subsequent A/A to have passed and
advanced. Leaving a failed or incomplete requalification unadvanced cannot keep
the old permission active. Historical captured evidence remains replayable.
