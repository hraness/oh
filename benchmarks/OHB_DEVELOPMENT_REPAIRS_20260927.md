# Ohb development repairs

The completed 100K experiment recorded 115/380 majority-correct answers for
Oh-next and Supermemory and 100/380 for BM25. It does not establish statistical
equivalence or superiority. Its custom binary judge omitted some explicit
answer fields, and its Supermemory representation differed from the previously
qualified session ingestion and native-memory configuration. Historical files
and scores remain unchanged.

## Implemented changes

- The source adapter derives numeric message order within each session.
  An optional renderer callback preserves numeric session order when dates tie.
  Existing renderer defaults remain compatible.
- The opt-in evidence-context generator combines native lexical and vector
  ranks before clipping. It packs supporting dialogue and explicitly declared
  dependencies with each anchor, then renders the admitted sources in order.
  It rejects clipped lists as native input and retains current-record checks.
- The experimental [evidence view](../docs/evidence-view.md) separates statement
  time from event intervals, follows explicitly source-linked state changes,
  and preserves ambiguous order and missing support. It does not infer semantic
  links from arbitrary conversation text. Its raw-only mode adds source date
  annotations; these are not automatically event dates.
- The [evaluation adapters](BEAM_DEVELOPMENT_ADAPTERS_V1.md) preserve every
  supported explicit answer field and rubric, reject malformed judge verdicts,
  bind configurations to requests, and enforce complete result cells. The
  Supermemory helpers preserve ordered sessions and native generated memories
  and require both document processing and memory generation to finish.

## Exposure record

The [v2 declarations](results/beam-exposure-declarations-v2.json) mark all 19
evaluated 100K histories as exposed and retain the original preview declaration.
The [v2 review](results/beam-exposure-review-v2.json) was produced from review
metadata only. No new conversation or question content was needed. All 20
100K histories are closed; 70 other histories remain eligible under the
existing declared-exposure and overlap policy. Eligibility alone does not
prove independence or absence of undeclared exposure.

Fresh CLI draws reject a review that predates these declarations before
loading a dataset. Historical selections remain replayable. New reviews merge
the committed declarations automatically, and amendments cannot reduce an
existing exposure classification. A declared exposure closes its whole related
family.

```sh
bun scripts/benchmarks/beam-seal-cli.ts amend \
  --review benchmarks/results/beam-exposure-review-v1.json \
  --output /tmp/beam-amended-review.json
```

The output path must be new. The command preserves its input and prints the
old and new review hashes and aggregate counts.

## Development experiment

The fixed reader diagnostic selects the first question in each of four
categories—contradiction resolution, event ordering, temporal reasoning, and
knowledge update—from exposed histories 1, 2, 3, and 4. It uses 16 questions,
one repeat, a shared $8 ceiling, and at most 112 new reader and judge calls.

The historical first response is rejudged using the repaired custom judge.
Three additional arms use the existing task-complete reader profile with,
respectively, the historical context, corrected source ordering, and corrected
ordering plus at most 8 KiB of source time annotations. The reader-profile
treatment includes its declared deadline as well as its instruction. Exact
historical context and request reconstruction must pass before execution.
The corrected-order arms retain the old clipped retrieval lists to isolate
ordering; they do not measure the new native-rank fusion.

This small, deliberately targeted development comparison cannot establish a
superiority result. It uses the repaired custom binary judge, not official BEAM
nugget/event scoring. A future confirmation run still needs the fixed system
configuration, official scorer qualification, a representative live comparator,
and an up-to-date exposure review before a fresh family draw.
