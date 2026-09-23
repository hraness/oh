# Framework pilot source, evidence and reader

This pilot compares Oh, Supermemory and a BM25 control over the same conversation
histories. The [60-question selection](results/framework-pilot-selection-v1.json)
is fixed before comparative retrieval or answer scoring. It contains ten
questions from each LongMemEval type, with the declared abstention sampling rule.
Every source question was previously exposed in this repository's research.
This is a balanced development pilot, not a new holdout or the official
500-question overall result. No matched quality result is available yet.

## Complete source histories

[`writePinnedFrameworkPilotLongMemEvalV1`](../scripts/benchmarks/framework-pilot-longmemeval-v1.ts)
accepts existing local bytes of the exact cleaned LongMemEval-S revision and
frozen selection. It verifies file size, SHA-256 and stable file identity. Its
byte scanner validates the complete JSON syntax and Unicode before decoding
selected fields. It does not materialize answer strings, evidence labels,
`has_answer`, or unselected question text.

The exact [source-selection artifact](results/framework-pilot-source-selection-v1.json)
is published unchanged for the fixed file boundary. Its original planning flags
describe the earlier capacity preview. The separate selection manifest above
freezes those same IDs without declaring a live campaign active.

The source artifact contains all selected history occurrences, roles, dates and
turn text, plus each original question and question date. Session aliases
preserve repeated identities; empty occurrences and original ordering remain.
Original question IDs, question types and session-ID mappings go in a separate
private evaluator artifact. They do not enter ingestion or reader prompts.

The file boundary reconciles every selected history against its previously
recorded session count, turn count, UTF-8 content size and complete history
fingerprint. The fixed-source execution reconciled all 60 histories in the
500-row file without decoding gold or evidence-label values. This establishes
source completeness. Native model fit and the common lossless split plan remain
separate requirements.

Outputs are create-only: `source/projection.json`, `private/evaluator-map.json`,
an intent and a completion receipt. Existing output directories are rejected;
failed writes preserve their partial artifacts. Dataset paths and credentials
are not included in the public selection or model-visible artifacts.

## Comparable evidence strings

[`prepareFrameworkPilotEvidenceV1`](../scripts/benchmarks/framework-pilot-evidence-v1.ts)
accepts three evidence kinds. A `source-unit` derives its exact canonical text
from the validated shared source bundle. A `provider-generated-memory` or
`provider-document-chunk` retains the provider's returned text and explicit
document references. Those references must join to admitted source-unit
digests. A valid reference does not authenticate a generated statement as
original source text.

The reader sees one JSON line per item, with `evidenceId`, `kind` and `content`.
The neutral evidence ID identifies that returned item. Original provider IDs
and the evaluator's provenance joins remain outside the reader string. Source
metadata inside canonical source content remains visible. No source-unit ID
is invented for generated text.

The packer validates all candidates before tokenization, including candidates
that might be omitted. It preserves rank, removes exact repeated identities,
and admits complete JSON lines until the next unique item would exceed the
budget. After the first overflow it stops admitting items. Conflicting duplicate
identities fail validation.

The common ceiling is 8,192 tokens for the evidence string. The
[pinned o200k tokenizer](FRAMEWORK_PILOT_TOKENIZER_V1.md) counts every complete
unique prefix, including JSON escaping, metadata and newline separators. The
question, instruction and chat framing are outside that evidence budget and
remain part of the paid request reservation. Native offline qualification
verified mixed evidence at exactly 8,192 tokens and rejection at 8,193, plus
duplicates and first-overflow behavior.

## Shared answer reader

[`renderFrameworkPilotReaderV1`](../scripts/benchmarks/framework-pilot-reader-v1.ts)
renders one user message from a question, question date and packed evidence
string. Its fixed instruction requires evidence-based answers, source-date
reasoning, attribution of statements, and explicit abstention when information
is missing. It asks for the complete concise answer and applies identically to
all three arms. It does not accept the reference answer, question category,
original question ID or arm name.

The renderer preserves the context bytes. Its supplied token count is an
assertion, not an independent tokenizer receipt. Campaign admission must bind
the context hash to the packer's verified output. Reader and judge route
identities, output limits and Gateway deviations are documented in the
[adapter contract](FRAMEWORK_PILOT_ADAPTERS_V1.md#reader-and-judge-routes).

Judging uses the existing [LongMemEval prompt templates](profiles/longmemeval-judge-v1.json)
and exact yes/no parser. Reference answers become available only after every
intended retrieval context or failure has been frozen. Reader failures,
malformed verdicts and unattempted cases remain visible in the full denominator.
The campaign must also freeze every reader outcome before the separate judge
stage can access reference answers.

## Fixed reporting rules

[`reportFrameworkPilotV1`](../scripts/benchmarks/framework-pilot-report-v1.ts)
requires all 180 planned case-and-arm rows, including failures and unattempted
stages. Conservative success is the number of correct completed judgments
divided by all 60 planned questions. Graded answer accuracy uses only completed
judgments and reports that smaller denominator. An incomplete stage contributes
no success; it is not relabeled as an incorrect judge verdict.

The primary comparison is Oh minus Supermemory in conservative success rate.
Oh minus BM25 is a secondary descriptive comparison. Both use the same 10,000
paired bootstrap samples, drawn within the six fixed question types with seed
20260923. The 95% intervals use nearest-rank percentiles. They describe
resampling uncertainty within this balanced development pilot, not performance
on an unseen population.

Search latency includes successful retrievals even when a later stage fails.
Failed retrieval durations remain separate. Observed cost, confirmed charges,
unresolved exposure and prior task/global exposure retain distinct fields;
unknown amounts stay null. The report helper validates the complete matrix and
computes statistics, but does not establish verdict provenance or reconcile
provider billing. Those require the campaign's captured artifacts.

## What a matched result will establish

The pilot uses the same lossless input units, one query, at most 20 results, the
same evidence budget, reader and judge. Supermemory's generated evidence and
Oh's original source records remain distinguishable. This custom common input
profile is not a reproduction of vendor-native session ingestion.

Report answer accuracy separately from source-evidence recall, with paired
differences, uncertainty and per-type results. Include ingestion, indexing,
query, reader, judge and cleanup time and cost, including unresolved charges.
The pilot cannot establish general superiority, reproduce a vendor's published
score, or stand in for a current Letta agent evaluation. A wider claim requires
additional independently specified tasks and clean exposure accounting.
