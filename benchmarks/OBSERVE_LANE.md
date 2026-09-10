# Observation extraction lane

`scripts/benchmarks/evolution-observe-lane.ts` distils benchmark corpus
sessions into `oh.observation.v1` records through the library's
`observeOhV1`, question-blind, under one campaign cap. It is the write-time
memory layer described in [`spec/v1/observation.md`](../spec/v1/observation.md),
applied to a development corpus. The observation retrieval arms add the
derived records beside raw turns.

## What the lane does

- Input is `oh.memory.observe-lane-input.v1`: corpora and their turns only.
  `projectObserveLaneSource` drops questions before the file is written, and
  the parser rejects any other key.
- Prepare groups each corpus into sessions by session identity and
  occurrence (the same grouping retrieval uses), builds the frozen extraction
  prompt for each session, and freezes exactly one request per session. The
  plan pins the instruction digest, the policy digest, the source digest, and
  every request.
- Run executes the plan through the shared campaign store and transport: no
  retries, replay from captured bytes, reservations retained on uncertain
  dispatch. Each completed response passes the bounded parser; a rejected
  response is recorded with its reason code and index.
- The artifact (`oh.memory.observations.v1`) carries, per session, the turn
  keys, the session digest, the request and response digests, the status,
  the raw response text, and counts. `rebuildObserveLaneRecords` replays the
  artifact through `observeOhV1` against the source turns, so the derived
  records are exactly what a product store would commit, with provenance
  dependencies on `edition:turn-*` keys.

## Descriptor limits

`EVOLUTION_OBSERVE_LANE_POLICY` is frozen with the instruction digest
`771ec3c8ec60ebbb4c048d6d2bec703f94543b2ba6e027c0165b44fc8db4d838`
(`OH_OBSERVATION_INSTRUCTION_SHA256_V1`, pinned by `src/observe.test.ts`), so the
instruction was committed before any extraction run and is never tuned after a
benchmark score is read. The
config protocol `oh.memory.observe-lane-experiment.v1` admits only the GPT-5
nano and GPT-5 mini extractor profiles and a campaign cap of at most $20
(`maximumCampaignMicros` at most 20,000,000); a campaign whose budget exceeds
the declared cap is refused before a plan exists.

## Diagnostics

The artifact reports the mechanism diagnostics that gate the extractor before
any reader run: parser rejection rate (gate below 5%), observations per
session, facet fill rate, and observation byte share against the turn bytes.
The corpus-general acceptance rubric in `scripts/benchmarks/observe-rubric.ts`
scores an extractor on the synthetic fixture under `tests/fixtures/` (date
resolution, attribution, verbatim quantities and names, coverage, kind,
hypothetical leakage) and must pass before a benchmark corpus is touched.

## Retrieve observations

A V4 development configuration or V9 study can set `derivedRecordsPin` to a
completed `oh.memory.observations.v1` artifact. The pin and an observation
retrieval arm require each other. Preparation verifies the artifact against
the selected corpus sessions and replays each extraction through
`rebuildObserveLaneRecords`. A changed corpus, source turn, session, response,
or provenance dependency prevents preparation. Reader, judge, and report
steps revalidate the prepared context against these rebuilt records.

Two systems consume observations:

- `oh-semantic-obs` searches raw turns and observations together with the
  existing semantic lane.
- `oh-recall-mq-obs` uses the recall multi-query lane over that same combined
  corpus.

Both emit `oh.evolution-retrieval.v2`. Its `derived` list identifies the
retrieved observations and their source keys. The renderer places dated
`Memory:` lines ahead of raw turns within the variant's byte budget. The
artifact digest participates in the semantic cache and prepared context
identity. A different artifact cannot reuse an earlier derived context.
Raw-only arms retain their existing result bytes and search only raw turns.
Observations do not replace source evidence.

## Recommendation routing

`renderOhObservationContextV1` groups preference observations under
`Remembered preferences` when `isOhRecommendationQueryV1` matches the query.
Every arm uses the same query-side routing decision. With no observations,
the decision leaves the control's rendered text unchanged.

Before reader calls, preparation records the router's hit rate overall and
by category on the selected development questions. The audit contains counts
and identifiers, without question text or answers. Inspect this distribution
before the comparison: the router uses no labels, but its lexical rule can
still favor particular question categories.

## Run an experiment

1. Run the frozen extractor on the synthetic fixture and require a passing
   `scoreObserveRubric` report. Unit tests with supplied responses establish
   the parser and rubric behavior; they do not qualify a live extractor.
2. Project only development corpus turns with `projectObserveLaneSource`,
   pin the source and campaign, and prepare the extraction plan. Review its
   call count and reservation ceiling before dispatch.
3. Execute the plan from clean committed source under the campaign cap.
   Preserve failed and unresolved attempts in the shared spending ledger.
4. Require complete extraction and inspect parser rejection rate,
   observations per session, facet fill rate, and byte share before any
   reader comparison. The declared parser-rejection gate is below 5%.
5. Pin the artifact in the comparison configuration, prepare contexts and
   the router audit, and compare the observation arms with the raw-turn
   control using the same reader, judge, and byte budget.

Extraction quality and reader accuracy are separate measurements. A passing
fixture permits the development experiment; it does not establish improved
retrieval, a higher benchmark score, or superiority to another framework.

## Extractor qualification on September 10, 2026

The frozen eight-session synthetic fixture admitted GPT-5 mini for the
next development experiment. Mini passed every rubric criterion and
produced 24 observations without a parser rejection. Nano failed date
resolution, attribution, verbatim detail, coverage, and parser rejection
criteria; it is not qualified for that experiment.

The two runs used 16 calls and $0.035265 of accounted exposure, with no
unresolved reservations, under a shared $0.25 cap. The
[qualification summary](results/observation-fixture-20260910-v1.json)
records both outcomes, the fixed rubric, source identity, and artifact
digests. These results measure one small synthetic fixture.

The subsequent [development pilot](results/observation-development-pilot-20260910-v1.json)
failed qualification. Of 47 calls, six truncated and ten of the 41 completed
responses failed parsing: five exceeded the observation count, four paired an
unresolved expression with a null date, and one cited the wrong speaker.
The run stopped with $0.615209 in accounted usage and no unresolved
reservations. No reader comparison ran. These are diagnostics from an
adaptively stopped development subset, not a population accuracy estimate.

Each truncated response exhausted its 8,192-token allowance. Reported
reasoning used 5,184–6,464 tokens, leaving 1,728–3,008 visible tokens.
That observation motivates the low-reasoning comparison below; it does not
establish that lower reasoning preserves extraction quality.

## Experimental extractor comparison

Two additional benchmark profiles isolate the next extraction changes:
`gpt5-mini-low-extractor-v1` uses the unchanged V1 prompt with low reasoning,
and `gpt5-mini-structured-extractor-v2` uses low reasoning with a fixed strict
JSON schema. The existing medium-reasoning mini profile remains the control.
All three retain the same 8,192-token output allowance and token prices.
The new profiles cannot be selected as answer readers or through the
full-history reader route.

The V2 inference contract in `scripts/benchmarks/observe-extractor-v2.ts`
limits output to 48 observations and identifies a source turn for attribution.
The parser derives the speaker from that turn and requires all citations to
belong to the same speaker. An explicit time expression carries either a
resolved full date or a null date. Uncertain expressions remain in the text;
they produce null `eventAt` and `resolvedFrom` values when normalized for the
existing observation validator. Recognizable coarse dates and contradictory
ISO dates are rejected. General natural-language date resolution still needs
semantic evaluation.

The original model response and the normalized validation input are distinct
evidence. A V2 response must not be relabeled as a V1 extraction artifact.
The V1 prompt, parser, record bytes, lane policy, and retrieval artifact
acceptance remain unchanged; the new contract is an experimental benchmark
module, not a production observation API.

`makeObserveExtractorFixture` retains the original eight synthetic sessions
and adds four stress sessions. Its companion scorer measures dense fact
coverage, date precision, attribution, corrections, and hypothetical leakage,
alongside the original rubric. The source conversations are separate from
the evaluation expectations. These lexical checks deliberately accept a
limited set of equivalent wording; they do not replace a reader comparison.

A live comparison must pin the source, both fixture files, rubric, profiles,
requests, and budget before dispatch. Qualification requires complete
responses, no unresolved spending, parser rejection below 5%, and a passing
semantic report. Tests with supplied responses establish the contract and
scorer behavior; they do not qualify either new model profile.
