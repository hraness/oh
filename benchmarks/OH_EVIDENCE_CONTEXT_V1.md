# Source order and support-preserving context experiment

Use `scripts/benchmarks/oh-evidence-context-run.ts` to generate new development
contexts with native retrieval ranks and complete support bundles. Existing
context artifacts and historical composition scripts retain their original
meaning. Regenerate through this route when evaluating the new packing method;
an already clipped or neighbor-expanded turn list cannot recover native ranks.

The local command accepts a source-only `Corpus` JSON file and a plain-text
question. It uses lexical retrieval and makes no provider calls:

```sh
bun scripts/benchmarks/oh-evidence-context-run.ts \
  --corpus .cache/benchmarks/invented-corpus.json \
  --query .cache/benchmarks/invented-question.txt \
  --output .cache/benchmarks/new-evidence-context.json \
  --bytes 96000 --top-k 100 --previous 1 --next 1
```

The output file must not exist. The artifact binds the prepared source identity,
projected records, question hash, configuration, native rankings and rendered
context. It is a context-generation record, not a reader result or a superiority
claim. Choose development material under the experiment's exposure policy before
running this command; it does not select or authorize a benchmark sample.

For semantic fusion, call `createOhEvidenceContextGeneratorV1(corpus, options)`
with the existing pinned semantic backend or cache directory, then call
`generate(question, { contextBytes, topK, vector: true })`. Always await `close()`
in a `finally` block. Missing, failed or stale vector results are errors. The
lexical limit is 400 anchors and the vector limit is 100. The generator reuses
the prepared retrieval indexes and their current-source and shutdown checks.

`projectOhEvidenceTurnsV1` reads only source fields. It treats `sessionIndex` as
the outer session occurrence and counts within-session positions from the corpus
turn array. Shuffled storage requires a complete `positions` list of
`{ turnId, sessionOrder, turnOrder }`. Session positions must be unique across
different occurrences and turn positions unique within each occurrence. Use its
`records`, `view` and `sessionOrder` together with the author-log or session-zoom
renderer. This keeps numeric positions above nine in source order and preserves
the correct preceding-author reference.

Optional dependencies use `{ turnId, sourceTurnIds }` and must resolve to supplied
source turns. They are explicit source relationships; the adapter does not infer
corrections, acceptance or referents from arbitrary prose. Source IDs, dependencies,
source dates and bounds are validated before rendering. Projected records and
lookup entries are immutable and use a separate `oh.evidence-source-turn.v1`
value format.

`nativeRanks` on a prepared evolution corpus emits `oh.evolution-native-ranks.v1`
before expansion or byte clipping. `fuseOhNativeRanksV1` combines their 1-based
ranks with reciprocal rank fusion (`k = 60` by default). The packer then adds
the selected same-session neighbors and the transitive explicit dependencies of
every bundle member. It includes a complete bundle or skips its new turns, counts
shared support once, and renders raw turns in numeric source order. Text is never
truncated. The context limit is 4,000,000 UTF-8 bytes; each neighbor radius is at
most 32 turns. Bundle omissions are explicit in the artifact.

This preserves supplied support relationships; adjacency alone does not prove
that a passage is semantically self-contained. Changes to the reader, token budget
or comparator remain separate experimental factors. Do not describe packed
historical retrieval lists as native rankings.

Run the invented source-order, dependency, byte-boundary, native-rank and lifecycle
regressions with:

```sh
bun test src/author-log.test.ts \
  tests/memory-benchmark-oh-evidence-context.test.ts \
  tests/memory-benchmark-evolution-retrieval.test.ts
```
