# Matched framework pilot result: Oh, Supermemory and BM25 on LongMemEval-S

Completed 2026-09-24. This is the first matched three-arm comparison under the
[pilot source, evidence and reader contract](FRAMEWORK_PILOT_EVIDENCE_V1.md) and
the [reader and judge stages](FRAMEWORK_PILOT_PAID_STAGES_V1.md). It is a
balanced development pilot on 60 previously exposed questions, not a holdout
result, and it does not establish that any system is state of the art.

## Outcome

Supermemory scored the highest conservative success rate, 75.00% against Oh's
71.67% and BM25's 68.33%, but the paired primary comparison does not separate
Oh from Supermemory: the Oh − Supermemory difference is −3.33 percentage
points with a 95% within-type bootstrap interval of −13.33 to +6.67. The
secondary Oh − BM25 difference is +3.33 points (−1.67 to +8.33). On completed
judgments only, graded accuracy is 75.44% for Oh (57 judged), 75.00% for
Supermemory (60) and 71.93% for BM25 (57).

| Arm | Correct / 60 | Conservative success | Completed judgments | Graded accuracy | Search p50 |
| --- | --- | --- | --- | --- | --- |
| Oh default retrieval | 43 | 71.67% | 57 | 75.44% | 12,524 ms |
| Supermemory (session documents) | 45 | 75.00% | 60 | 75.00% | 1,003 ms |
| BM25 baseline | 41 | 68.33% | 57 | 71.93% | 2.5 ms |

Correct answers per question type (10 questions each):

| Question type | Oh | Supermemory | BM25 |
| --- | --- | --- | --- |
| knowledge-update | 5 | 9 | 6 |
| multi-session | 7 | 7 | 7 |
| single-session-assistant | 10 | 10 | 10 |
| single-session-preference | 5 | 4 | 2 |
| single-session-user | 9 | 8 | 9 |
| temporal-reasoning | 7 | 7 | 7 |

The arms are tied on three of six types. Supermemory's edge concentrates in
knowledge-update, where two of Oh's three ungraded cells also sit; Oh leads on
single-session-preference, the type where BM25 is weakest. Oh's search latency
includes local reranker inference and is not comparable to a hosted API call.

## What was compared

All three arms received the same 60 LongMemEval-S histories as lossless,
answer-blind source units with neutral identifiers, the same single query per
question, at most 20 returned items, the same typed evidence renderer with an
8,192-token ceiling, the same GPT-4o reader (512 output tokens, temperature 0)
and the same GPT-4o judge with the frozen native LongMemEval rubric. Reference
answers were opened only after every reader response was frozen and audited.

- **Oh**: the fresh default SDK route over turn-level units (configured
  reranking), indexed once per case in a disposable local store.
- **BM25**: SQLite FTS5 over the same turn-level unit content.
- **Supermemory**: a fresh namespace per case with one document per session
  occurrence (`session-occurrence.v1`, the vendor's published LongMemBench
  method), `dreaming: dynamic`, then one `/v4/search` call with the fixed
  `hybrid-rerank-20.v1` profile (hybrid mode, limit 20, threshold 0.6, rerank
  on, no query rewriting, no aggregation, documents included). Returned
  memories and document chunks were joined to the accepted source sessions and
  rendered as provider evidence, distinguishable from original source text.

The Supermemory arm differs in granularity by design: the local arms indexed
turns, Supermemory indexed sessions. The first live attempt at turn-level
ingestion (521 documents for one case) did not finish dreaming inside its
window; see the [adapter note](FRAMEWORK_PILOT_ADAPTERS_V1.md#session-level-supermemory-ingestion-executed-profile-2026-09-24).

## Failures and unattempted cells

Every planned cell stays in the denominator.

- Oh: 57 of 60 cells completed retrieval. Two retrieval failures (c0004,
  c0005, both knowledge-update) and one cell not run (c0060,
  temporal-reasoning) in the corrected native assembly.
- BM25: the same three cells failed or were not run; both local arms share the
  corrected assembly's dispositions.
- Supermemory: 60 of 60 cases completed ingestion, readiness, the single
  search and verified cleanup; zero readiness timeouts under the 150-minute
  campaign window. The slowest completed case (c0003) reached readiness after
  141 minutes. Four completed cases (c0008, c0032, c0034, c0047) returned zero
  candidates; their readers received the fixed prompt with empty evidence.
- Reader: 174 physical calls, all completed; 6 logical cells not run because
  their retrieval was not ready. No truncated, refused or failed responses.
- Judge: 116 physical calls covering the same 174 completed cells (identical
  verdict requests were deduplicated); all verdicts valid; 6 cells not run.

The revision-1 diagnostic for c0001 (45-minute window, 24 polls per document)
timed out at 32 of 46 documents; it was recorded before the campaign as a
diagnostic, its namespace was deleted and verified absent, and c0001 was run
once under the campaign policy. Every campaign case had exactly one attempt.

## Cost and time

| Stage | Calls | Confirmed charge | Unresolved | Notes |
| --- | --- | --- | --- | --- |
| Supermemory ingestion, readiness, search, cleanup | 66,625 requests | $43.342315 credits | — | Pro plan credits, account level |
| Reader (GPT-4o alias via Gateway) | 174 physical / 180 logical | $2.215177 | $0.000000 | cap $9.00 |
| Judge (GPT-4o alias via Gateway) | 116 physical | $0.061688 | $0.000000 | task ceiling $25.00 |

The combined confirmed reader and judge charge is $2.276865. The Supermemory
credit figure spans the first and last account-level balance reads across all
runs, including the diagnostics; the two campaign deltas ($17.928895 and
$42.128185) overlap because the campaigns ran concurrently.

Supermemory readiness (ingest acknowledgement to last dreaming confirmation):
p50 61.5 min, p95 98.8 min, max 141.4 min. Search latency: Supermemory p50
1,003 ms, p95 2,871 ms; Oh p50 12,524 ms, p95 16,794 ms; BM25 p50 2.5 ms,
p95 4.4 ms. Reader contexts used a median of 5,014 tokens for Oh, 1,688 for
Supermemory and 7,675 for BM25 under the shared 8,192-token ceiling.

## Limits

- 60 previously exposed development questions; bootstrap intervals describe
  resampling within this sample only.
- Reader and judge are unpinned Gateway aliases; returned model names do not
  identify an immutable snapshot.
- Supermemory used one fixed search profile and session-level documents; this
  is not a claim about its defaults, its best configuration or its published
  Recall@20 result.
- Retrieval granularity differs by arm.
- Supermemory readiness depended on the provider's asynchronous dreaming
  pipeline under a 16-case concurrent load; timeouts count as failures.
- Oh's search latency includes local reranker inference on this machine; it is
  a development measurement, not a hosted-service comparison.
- Agent-run; no independent audit of this run yet.

## Evidence

- `benchmarks/results/memory-framework-pilot-v1.json`: aggregate result with
  digests of the retrieval freeze, reader and judge plans and results, and the
  report input.
- Private campaign artifacts (raw provider and model responses, transport logs,
  contexts) remain in the ignored `.cache/` tree; they contain source text and
  are not published.
