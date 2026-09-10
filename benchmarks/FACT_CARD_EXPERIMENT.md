# Quote-card development experiment

This optional benchmark lane compares two answer pipelines on exactly the same
100 exposed development questions and their existing semantic top100/96,000-byte
contexts. It does not retrieve again, change QMD, or change the full-release
candidate. No package runtime or default search behavior changes.

`evolution-fact-cards.ts` prepares one `gpt5-nano-reader` extraction request per
question, using the existing low-effort profile and its 8,192-token output cap
including reasoning. It supplies the original retained source turn texts in the
same order, with opaque aliases, original speakers and statement dates. It
whitelists source fields and never receives benchmark gold or evidence labels.
The original context artifact remains separately pinned: source validation
checks its current records and rendering, but does not repeat or independently
prove the historical semantic ranking execution.

The extractor returns exactly `cards` and `operations`. Each of at most32 cards
contains `source`, `quote` and `tag`. A quote is at most2,048 UTF-8 bytes and must
occur exactly once in that source turn. The host derives the original turn and
record identities, speaker, statement date and scalar-aligned UTF-8 byte range.
Duplicate cards, duplicate JSON keys, foreign aliases, malformed or oversized
responses and ambiguous quote matches fail extraction. The answer bound is
32,768 bytes. An exact quote proves where the text came from; it does not prove
the model's relevance judgment or its interpretation of that text.

Both arms consume the same authenticated extraction capture:

- `quote-cards` gives the finalizer validated quotes and explicitly labeled model
  tags. It includes no operation plans or results.
- `quote-cards-ops` adds results from a pure interpreter. It supports
  `distinct-literals`, `sum`, `difference`, `date-interval-days` and `date-order`.
  Each operation has `kind`, `operands: [{cardId, literal}]` and `unit`.

There are at most16 independent operations with at most32 operands each.
An operand must match a unique exact substring of a validated card. Distinct
counts compare literal strings exactly; they do not deduplicate people, events
or paraphrases. Arithmetic uses exact decimal/rational values and the explicit
units `mm`, `cm`, `m`, `km`, `mg`, `g`, `kg`, `s`, `min`, `h`, and `d`. Conversions
stay within a dimension and require an explicit target unit. `unit: null`
arithmetic accepts only bare numbers. Difference subtracts the second operand
from the first. No model-provided calculated value or executable code is used.

Date operands must be complete, valid Gregorian `YYYY-MM-DD` literals. Intervals
use `unit: "d"` and compute second date minus first in UTC calendar days.
Date ordering preserves ties. Relative dates, approximate dates, missing years
and automatic use of statement dates are unsupported. Unsupported kinds,
operands, units or other ambiguous specifications produce visible unresolved
results without a calculated value. Choosing operands still requires model
judgment: deterministic arithmetic does not prove that values are separate
increments, that they refer to the same entity, or that quoted dates are true
event dates.

Each final memory is at most16,384 UTF-8 bytes, including all metadata and, for
B, operation results. Overflow fails that arm without trimming quotes. Empty
valid cards may reach the finalizer. Both arms use the unchanged
`gpt5-nano-explicit-abstention-composition-v1-reader` answer contract. Only after
every finalizer has finished or been accounted for does the scorer open the
separate gold pin and prepare `gpt4o-gateway-native-rubric-16-judge-v1` requests.
That judge uses the native rubric/reduction through a Gateway alias with a
16-token cap; it is not the official pinned10-token reproduction.

## Preparation and execution boundary

The callable entrypoints are `prepareEvolutionFactCardLane(configPin)` and
`runEvolutionFactCardLane({configPin, planPin, credential, ...})` in
`scripts/benchmarks/evolution-fact-card-lane.ts`. A config uses the new
`oh.memory.fact-card-experiment.v1` protocol and includes:

- `partition: "development"` and the exact ordered100 `questionIds`;
- separate `sourcePin`, `contextPin`, `scorerPin` and `campaignPin` file pins;
- the existing semantic `variantId` and current `executionSourceSha256`;
- `maximumNewCalls` from0 through500 and `concurrency` from1 through12.

The source and scorer use the existing source-selector input projection
schemas. The context pin must contain the original V1 context plan, with exact
source selection and an `oh-semantic` top100/96,000-byte variant. The source pin
has a64MiB read bound, the context/plan pins128MiB, the scorer32MiB and config64KiB.
Preparation reads source/config/context only, constructs all extractor requests
and emits a new plan. It opens no paid store or scorer and makes no provider
request. Write this plan to a new private file and pin its bytes before running.

The plan reports actual prepared extractor reservations at the full8,192-token
cap, a conservative escaped16KiB reader reservation ceiling, and a conservative
judge profile-window ceiling. Their sum is a ceiling, not expected spend or a
new allowance. Every actual downstream request uses the existing public request
constructor's reservation. The root-owned campaign and store enforce the actual
shared monetary and call caps; a small campaign cap need not cover all ceiling
reservations simultaneously.

The first six lexically sorted question IDs form the extractor service canary.
Its exact captures are reused in the100-question matrix. Zero completed
extractor responses stop new admission. Transport uncertainty or admission
rejection stops new calls and drains active work. No correctness or label is
used for expansion. All100 questions remain in each arm's denominator.

Execution uses `invokeEvolutionRequest` and one canonical `EvolutionStore` for
extraction, finalization and judging. There is no alternative HTTP dispatcher,
retry or provider fallback. Every reconstruction reparses `store.readRaw` and
checks the exact request and settled response. Each downstream phase's complete
request matrix is constructed and frozen before its dispatch. The optional
awaited `onPhasePrepared` callback lets a root-owned runner persist those plans
before admission; a callback failure stops the run. The store itself durably
reserves every exact physical request before sending it.

The live caller owns credentials, clean committed execution source, output
custody and campaign approval. The callable returns a private report; it does
not publish artifacts or open credentials. Its explicit `fetcher` seam exists
for synthetic tests and still goes through request validation, selected-auth
checks, canonical reservation, capture, settlement and raw authentication.

Malformed extraction and required-stage failures score zero. Downstream skips
are distinct from attempted failures, and never-admitted requests are marked
not-run. A complete report means every planned case has a terminal accounting
path, not that every answer succeeded. Missing attempts or extractor preparation
failures make it incomplete. Unresolved physical requests keep their original
full reservation; a repeated invocation reuses captures and never redispatches
an occupied request.

Reports contain both full100 arm summaries, category counts, B-versus-A paired
outcomes, all phase plans/captures/attempts and original service latency.
Physical costs are deduplicated globally. Each standalone arm attributes its
shared extractor and judge costs, so arm totals must not be summed. Comparison
against the frozen semantic82 parent is a separate post-run join against that
authenticated report; it never feeds the extraction or answer stages. These
development results cannot establish untouched benchmark accuracy.

## Synthetic validation

Run the focused source/quote/lane and operation tests with Bun1.3.14:

```sh
bun test tests/memory-benchmark-evolution-fact-cards.test.ts tests/memory-benchmark-evolution-fact-card-ops.test.ts
```

The integration fixture prepares a synthetic semantic backend through actual
Oh search and current SQLite joins, then uses a fake provider through the real
store and transport to complete the100-question, two-arm pipeline. It checks
source/range binding, phase separation, shared capture reuse, native16 requests,
cost attribution, replay, invalid/truncated extraction, empty cards, unsupported
operations, unresolved reservations and a zero-call incomplete run. It does not
load a model, read benchmark source/gold, access an actual campaign or call a
provider.
