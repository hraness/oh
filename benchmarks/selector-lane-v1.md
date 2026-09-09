# Source selector experiment lane

The isolated `oh.memory.source-selector-experiment.v1` lane compares a native Oh
focused top100 whole-turn control with query-conditioned source ID selection.
Both contexts have a 48,000-byte bound and use identical reader prompts and
profiles, including the exact instruction selected by each answer-contract profile. The selector chooses up to 32 unchanged whole turns from the complete
focused native top100 pool. Its context retains the distinct
`oh.memory.selected-source-context.v1-prototype` protocol.

This is an experiment implementation, with synthetic integration evidence. It
has no measured accuracy or live provider qualification claim. It does not
modify the existing evolution V1–V3 context plans, requests, caches or reports.

## Inputs and execution

The callable API lives in `scripts/benchmarks/evolution-selector-lane.ts`:

```ts
const plan = await prepareSelectorLane(configPin);
// Write the plan as a new private file and calculate its exact file SHA-256.
const report = await runSelectorLane({ configPin, planPin, credential });
```

Both pins use the existing absolute-path, non-symlink, exact-byte
`EvolutionPin` contract. The returned report accounts for every fixed case and has a
canonical `reportSha256`; the caller writes it to a new private output file.
`credential` is the selected campaign's Gateway project OIDC credential. A
caller can supply `stopped()` for cooperative admission shutdown. A bounded
`fetcher` injection supports the offline integration test; it still passes the
same credential qualification, request admission, HTTP capture, accounting and
raw readback paths. Omitting it uses the existing paid transport and requires
clean committed source. No environment credential is discovered automatically.

The exact config contains:

- `protocol`: `oh.memory.source-selector-experiment.v1`.
- `sourcePin`, `scorerPin`, `campaignPin`: three distinct pinned input files.
- `executionSourceSha256`: the current `codeIdentity().sourceSha256`. The source
  manifest automatically includes both selector modules and their dependencies.
- `readers`: one to eight distinct existing reader profile IDs. For example,
  `gpt5-nano-reader` and `gpt5-nano-medium-reader` compare low and medium effort.
- `maximumNewCalls`: an explicit integer from zero to 20,000 across all three
  phases of this invocation. The canonical campaign's persistent financial and
  call caps remain authoritative across invocations and other experiments.
- `concurrency`: one to twelve workers. Identical physical requests share one
  in-flight operation within the lane. Each phase drains before the next phase.
- `partition`: `development` only.

The caller must first authorize and freeze the intended development projection.
The lane does not select from or open a raw benchmark dataset. The source file
has exactly `protocol: "oh.memory.source-selector-input.v1"`,
`partition: "development"`, `corpora`, and `questions`. Corpora have `id` and
`turns`; questions have `id`, `corpusId`, `question`, and `questionDate`. Turns
have `id`, `sessionId`, `date`, `speaker`, `text`, and optional `sessionIndex`.
Unknown fields, including labels and categories, are rejected. There are at most
2,000 questions, 8,192 turns per corpus and 100,000 turns overall, inside a
64 MiB pinned source-file bound. Every corpus must be used and every question must have
an existing corpus. The projection declaration alone does not establish that a
caller has preserved benchmark partition independence.

The separate scorer file has exactly
`protocol: "oh.memory.source-selector-scoring-input.v1"`, `inputSha256` of the
parsed source projection, and `questions`. Each scoring question contains the
four exact projected question fields plus `answer`, `category`, `unanswerable`,
`evidenceSessionIds`, and `evidenceTurnIds`. Its coverage must match the entire
source question set. The selector and reader stages receive no scorer labels.
Only the scorer stage parses this file, after all reader work drains. It uses
the pinned LongMemEval native rubric and the distinct Gateway native-rubric
16-token judge profile. It does not claim the alias is an official snapshot.

Preparation performs native retrieval once per corpus preparation and records
the exact pool, control and selector plans. Execution reconstructs preparation
from the pinned source and current execution source, then compares the complete
prepared artifact before dispatch. Selector reconstruction receives only the
first settled response authenticated by `store.lookup` and `store.readRaw`.
No caller-supplied response can replace that evidence.

## Failures, cost and comparisons

All planned questions remain in every reader/arm denominator. Missing,
unresolved, refused, truncated and invalid selector results score zero for the
selected arm; they do not receive a fallback context or repair request. Failed
readers and judges also score zero. An empty valid selection is an explicit
empty context, and can proceed to the reader. A pool that cannot form the
bounded selector request records a preparation failure while preserving the
native control case.

An uncertain first request retains its full reservation and stops new
admissions. Already admitted work drains. Settled invalid ID output retains its
captured charge. Occupied requests are never dispatched again; replay may
finalize an already captured valid first response. A zero new-call allowance
can replay occupied requests and marks uncached cases as missing. Reports with
never-admitted requests have `complete: false` and `status: "incomplete"` while
retaining all fixed cases and zero scores. `coverage` separates complete case
accounting from occupied-attempt coverage. Skipped readers and judges are
reported separately; an upstream failure does not become a judge failure.

Reports include every context case, request/profile identity, parsed response,
unresolved attempt, per-phase physical cost, semantic case failures, shared
campaign before/after totals, fixed-denominator accuracy and exact per-question
paired deltas. Aggregate cost counts each selector, reader and judge request
once. A standalone arm includes the selector cost it requires; arm costs can
share requests and must not be summed. Original captured selector + reader +
judge service times accompany each successful case, with missing timings
explicit. Current invocation wall time is separate. Cache replay does not
pretend that original cost or original service time was zero.

## Offline proof

From a Bun 1.3.14 checkout:

```sh
bun test tests/memory-benchmark-evolution-selector.test.ts tests/memory-benchmark-evolution-selector-lane.test.ts
```

The complete fake-provider fixture creates synthetic source, scorer, authority,
empty historical ledger, campaign, config and prepared-plan pins in a fresh
private temporary directory. It executes two questions, two readers and two
arms through the real native pool, canonical store and transport. Fourteen
physical calls cover two selectors, eight readers and four shared judges.
It checks selected source bytes, gold isolation, the paired denominator,
selector-inclusive cost and latency, store reopen/raw readback and replay.
Additional cases prove invalid IDs, uncertain request reservations, stopped
admission, input/plan tampering, an explicit zero-call allowance, all four answer contracts,
phase-specific truncation, and the exact64MiB source-pin boundary. These
requests never leave the injected fake provider.
