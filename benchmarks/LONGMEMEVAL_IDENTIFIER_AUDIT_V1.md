# LongMemEval identifier audit

On 2026-09-23, source review found that the legacy LongMemEval benchmark path
exposes original dataset session identifiers to retrieval and readers. In one
fixed pipeline sample of 46 sessions, two identifiers contained answer-label
wording. Omitting explicit answer and evidence-label fields therefore did not
establish that the remaining identifiers were neutral. The effect on retrieval
or answer scores is unmeasured.

## Default preparation for new runs

The current LongMemEval parser assigns neutral session aliases in source order
and turn IDs that distinguish each session occurrence. Repeated original session
IDs share one alias, preserving evidence-session grouping and recall denominators.
Authored text, roles, dates and chronological ordering remain intact. Answers
stay in the evaluator's question records. Evidence references are remapped to
neutral IDs; missing references remain distinct misses.

Changed turn IDs invalidate the associated corpus, source-record, extraction,
retrieval and reader request identities. Legacy manifests, extraction bundles and prepared contexts
must be rebuilt. Reproduce historical artifacts with their frozen source commit;
do not mix them with current preparation. This repair supplies no new quality
score or estimate of the historical effect.

## How the identifiers reach the reader

The audited source is commit `d805ed524e70cd46c875f6455b14c9e3a6074696`.
The following legacy path preserves the original identifiers:

1. [`parseLongMemEval`](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/datasets.ts#L166) copies
   `haystack_session_ids` into each turn's `sessionId` and uses that value to
   construct its turn ID. An occurrence suffix disambiguates repeated sessions;
   it does not conceal the original identifier.
2. [`renderTurn`](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/retrieval.ts#L49) places that turn ID
   before the date, speaker and text. Both the
   [basic BM25 index](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/retrieval.ts#L254) and the
   [evolution passage and session indexes](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/evolution-retrieval.ts#L423)
   index this rendered text. The [semantic path](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/evolution-retrieval.ts#L196)
   includes the identifiers in turn-record values; its
   [`recordDocument` renderer](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/src/semantic-model.ts#L86) includes that complete
   value in embedding input.
3. [`pack`](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/retrieval.ts#L67) and the
   [evolution context reconstruction](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/evolution-retrieval.ts#L359)
   preserve the rendered IDs in selected context.
4. [`answerMessages`](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/model.ts#L58) sends that context in
   the reader's `memory` field. The
   [evolution reader contracts](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/evolution-reader-contracts.ts#L92)
   retain this message when changing the system instruction.

The [extraction input](https://github.com/hraness/oh/blob/d805ed524e70cd46c875f6455b14c9e3a6074696/scripts/benchmarks/units.ts#L37) also includes original
turn IDs for source attribution. Excluding explicit answer fields from these
projections does not remove a cue already encoded in an identifier.

The sample count above came from inspecting prepared identifier fields without
reading answers, evidence-label fields or model outcomes. It establishes the
presence of label-like wording, not whether any reader used it. It is not an
audit of every identifier or captured request in all historical runs. No private
identifiers, conversation text or answers are published here.

## Requirements for a new comparison

Assign neutral structural session and turn IDs before ingestion, embedding,
indexing, extraction or context rendering. Keep the mapping to original IDs
outside provider inputs so a separate evaluator can resolve evidence references.
Preserve authored text, roles, dates and ordering; do not erase conversation
content to remove an identifier match. Verify the complete rendered requests,
including metadata and citations, before sending them.

Build fresh indexes and retrieval artifacts, then run fresh readers under a
fixed matched protocol. Removing identifiers only from a final prompt cannot
undo their possible effect on earlier indexing or extraction. Existing contexts,
reader responses and scores cannot stand in for this new evaluation.

The [historical LongMemEval results](EVOLUTION_RELEASE_RESULTS.md), their frozen
protocols and artifacts remain unchanged. This audit neither estimates score
inflation nor establishes a framework ranking. It does not make previously
exposed questions a holdout. The separate
[CloneMem SDK study](SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md) uses a different
dataset and preparation path; this LongMemEval finding does not establish a
defect in that study or alter its stated limits.
