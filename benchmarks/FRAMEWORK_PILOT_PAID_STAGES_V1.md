# Matched pilot reader and judge stages

The pilot keeps retrieval, answering and grading separate. All three systems
receive the same source histories and reader settings. Reference answers enter
only the judge stage, after every reader outcome is frozen. These preparation
helpers do not execute a paid campaign or establish a new comparison score.

The [source and evidence contract](FRAMEWORK_PILOT_EVIDENCE_V1.md) fixes the
60 previously exposed LongMemEval-S questions, three arms, common context
renderer and report statistics. This is a balanced development pilot with
180 logical cells, including failures and unattempted cells.

## Freeze retrieval before answering

The [reader helper](../scripts/benchmarks/framework-pilot-paid-reader-v1.ts)
requires all 60 question identities and all 180 retrieval dispositions. Completed
searches carry a capture digest and search duration. Contexts bind exact text,
evidence and tokenizer receipts, with an 8,192-token context ceiling.

The caller must authenticate those receipts against the actual source, native
or provider results, tokenizer and collected process owners. A digest supplied
to a pure helper does not establish that work occurred.

Each request is reconstructed from the frozen question, question date and common
evidence string. A successful empty retrieval still receives the fixed reader.
A failed retrieval remains an explicit unattempted reader cell. Context or
request overflow becomes a preparation failure; text is never shortened to
make a request fit.

Requests with identical bytes share one first response. All logical cells and
their physical request references remain present. Deduplication occurs before
outcomes, and a shared failure propagates to every linked cell. Dispatch order
balances question types and rotates the three arms by case ordinal.

## Bound calls and retain failures

The reader uses `gpt4o-gateway-framework-pilot-alias-v1-reader`, with at most
512 output tokens. The judge uses
`gpt4o-gateway-framework-pilot-16-alias-v1-judge`, with at most 16. Both use
temperature zero and the OpenAI route through Vercel Gateway. They are
explicitly unpinned aliases; a returned model name does not establish a fixed
snapshot.

Each stage permits at most 180 unique physical requests, in waves of at most
four. The previous wave must drain before the next is admitted. Unchanged
request reservations must fit the remaining campaign allowance. Confirmed
charges and unresolved reservations both count against that allowance; a failed
or uncertain first attempt is never retried to recover budget or improve a score.

Parsed refusals, truncation and other incomplete answers fail their cells while
other planned cells may continue. Uncertain transport, identity, source or
ownership stops further admission after the current wave drains. The complete
matrix records every resulting failure and unattempted cell.

## Grade only closed reader results

Before judge preparation, the caller closes the reader store, collects its
process owner and audits the immutable database against exact first captures.
The reader result distinguishes complete matrix coverage from all readers
having succeeded. Reference answers remain outside this phase.

The [separate judge helper](../scripts/benchmarks/framework-pilot-paid-judge-v1.ts)
receives only each eligible question, its reference answer
and the complete reader answer, using the previously frozen native LongMemEval
rubric. It receives no arm label or retrieved context. Failed or partial reader
answers are not graded. Invalid judge responses remain failures; they are not
rephrased, retried or replaced by an exact-text abstention shortcut.

The [report contract](FRAMEWORK_PILOT_EVIDENCE_V1.md#fixed-reporting-rules) retains the
fixed denominator and separates correct answers per planned case from accuracy
conditional on completed judgments. Costs, failures, prior exposure and the
Gateway alias limitation remain part of the result.
