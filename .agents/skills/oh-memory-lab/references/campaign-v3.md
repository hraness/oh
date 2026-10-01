# Context reserve campaigns (v3)

Use `bun scripts/benchmarks/memory-lab/campaign-v3.ts --help` when comparing
author-log context reserves. Keep v1 and v2 workspaces and source pins unchanged.
The v3 runner uses the existing API transport and shared ledger; a new workspace
does not reset spending, call counts, exposed families or the authorized deadline.

## Freeze the context comparison

`CampaignConfig` in `campaign-contract-v3.ts` adds `contextPolicies`, a
`rankingProfileSha256`, `maximumAnswerJsonBytes`, `screenCriterion`, and optional
`maximumReaderInputUpperBound`. A policy has an `id` and
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

Every reader request must have `prepareApiRequest(...).inputUpperBound` within
the frozen `maximumReaderInputUpperBound`, including transport overhead. Omission
retains the 200,000-byte limit and historical configuration identity. An explicit
value must be a positive safe integer no greater than 262,144; it becomes part of
the execution identity. Validate the bound before the first call and immediately
before each reader dispatch. Changing it requires a new frozen configuration,
review and full-episode cost calculation. It does not change the 180,000-byte
context limit, reader messages, model, scorer or statistical rules.

`maximumAnswerJsonBytes`
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

## Close a terminal output overrun

A complete provider response can exceed the requested output-token bound while
its verified token cost still fits the reserved amount. The transport keeps that
response in a separate `oh.memory-lab-api-terminal-rejection.v1` receipt, charges
the full reservation conservatively, and halts. It creates no accepted result or
score. Model identity, token accounting, response shape and reservation checks
remain required; uncertain outcomes remain unresolved.

For a campaign frozen with this source version, run:

```sh
bun scripts/benchmarks/memory-lab/campaign-v3.ts close-stopped /private/campaign RUN_ID
```

This offline command replays every completed cell from native captures, verifies
the terminal rejection and saves an `INCOMPLETE` assessment with the entire
planned denominator. It retains a separate `stopped.json`, leaves the champion
and advancement unchanged, and prevents further dispatch for that run. Repeating
it verifies the same evidence without changing the saved assessment.

If a crash occurred before settlement, use `reconcileTerminalApiAttempt` from
`api-transport.ts` with the exact config, attempt ID and expected request digest.
It uses the existing ledger lock, verifies captured request/response bytes and
the reservation, writes the rejection receipt before settlement, and appends at
most one full-reservation settlement. It needs no credential or provider access;
matching existing settlement is preserved. Conflicting evidence and live lock
ownership fail. Accounting is a conservative bound, not a provider billing
attestation. This path handles verified output overruns only.

When an actual crash retained the native lock, explicit `recoverDeadOwner: true`
first verifies the exact lock authority, proves its process absent and checks all
terminal evidence. It serializes lock transfer, preserves the old lock bytes and
requires this target to be unresolved, with no other unresolved attempts. After settlement, the existing `recover-locks`
command can release the dead campaign owner. An existing recovery mutex remains
untouched and requires separate custody review; ambiguous ownership never grants
permission to dispatch. Later ledger appends do not invalidate this run's exact
terminal-attempt binding.

Keep previous frozen execution trees and external stopped-run decisions intact.
A newer source version does not authorize repinning or resuming an old trial.
