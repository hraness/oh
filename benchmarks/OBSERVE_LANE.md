# Observation extraction lane

`scripts/benchmarks/evolution-observe-lane.ts` distils benchmark corpus
sessions into `oh.observation.v1` records through the library's
`observeOhV1`, question-blind, under one campaign cap. It is the write-time
memory layer described in [`spec/v1/observation.md`](../spec/v1/observation.md),
applied to a development corpus so that later retrieval arms can add derived
observations beside raw turns.

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

## Not yet wired

Retrieval does not yet read the artifact. Appending derived records to a
prepared corpus, the semantic cache key extension, the `oh-recall-mq-obs`
systems and the derived-item result protocol are separate changes on top of
the recall work.

`renderOhObservationContextV1` gates its `Remembered preferences` block on
`isOhRecommendationQueryV1`, a query-side lexical router. It reads no label
and is corpus-general, but the methodology treats any router as a shared
mechanism: when the recall work wires it, the same routing decision must be
applied to every retrieval arm, including the controls' derived-free
rendering path, and audited for category leakage (the share of routed
queries per category on the development partition, declared before the
read), before any Phase B read is taken.
