# CloneMem local reranker: development screen

This fixed screen tests whether reranking the frozen candidate union with a
small local model improves answer accuracy over raw vector retrieval. Both arms
retain whole traces and use the same reader. It is development work on
previously exposed data, not a fresh benchmark or a leaderboard claim.

Status: prepared on 2026-09-22 before new reader calls. The earlier CloneMem
comparisons remain closed. This protocol, source, policy, plan and complete
participating code are pinned before dispatch; no result is implied here.

## Population and fixed treatment

Use all **146 questions** from two personas selected by the frozen SHA-256
identifier rule. The selected personas contain **114 and 32 questions**. There
is no question subsample, evidence-coverage filter, category filter or fallback
draw. The other seven personas are reserved for a separately fixed confirmation
screen; they are not pristine holdout data. Only the two selected personas
enter this study's source replay, requests and scoring.

The closed local reranker probe compared frozen retrieval arms on these two
personas and passed its prespecified recall gate before any new reader
outcomes. This screen evaluates that fixed candidate; it does not select
between prompts or change the policy based on answer accuracy.

| Arm | Fixed retrieval procedure |
| --- | --- |
| `raw-vector` | Original top ten semantic results from the captured top-30 ranking |
| `oh-union-qwen3-rerank-v1` | Top ten of the frozen normalized-lexical-30 union original-stem-semantic-30 candidate pool after local Qwen3-Reranker-0.6B reranking |

The candidate pool is the exact union of normalized lexical top 30 and the
unchanged original-question semantic top 30, at most 60 traces per question
(7,834 pairs total), identical to the closed free probe. The reranker query is
the original question stem only; the reranker document is the single-trace
rendered evidence text. Ranking is descending model score with ASCII record-key
tie order. The model is `Qwen3-Reranker-0.6B` Q8_0 GGUF, revision
`a02f48bb4f057028298c21fa033da2b30d7742d5`, SHA-256
`22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48`, run locally
through QMD 2.5.3 / node-llama-cpp 3.18.1 on one 4,096-token context with full
per-pair token admission and no truncation. Reranking happened entirely before
this screen's preparation; it is never rerun. Local inference makes no provider
calls and adds no provider charge.

Semantic search continues to use the **unchanged original question stem**.
Question text and eligible memory are the only runtime evidence; choices, gold
keys, evidence labels and earlier answer correctness never enter retrieval.
Only original traces dated at or before the question time enter candidates,
before limits apply. Context uses native top-ten whole traces with the
unchanged renderer, without byte truncation. The request admission ceiling is
96 KiB of memory per arm; a bound violation stops preparation instead of
silently shortening evidence. The two contexts may have different lengths.

The source adapter replays the frozen probe selections and checks every rank,
context hash and byte count, the complete prior token admission, control parity
against the closed `raw-vector` source, and model/provenance pins.

## Reader, scoring and execution

Both arms use the existing `gpt4o-mini-clonemem-choice-v1-reader`: Gateway
`openai/gpt-4o-mini`, OpenAI routing, temperature 0.1, a 512-token output
ceiling and the unchanged native single-user multiple-choice prompt. It is a
model alias, not a verified immutable snapshot. Each question has **three
reader attempts per arm**, giving **876 logical answers**. There is no model
judge. Fresh calls are made for both arms; historical baseline responses are
not reused.

Scoring is the unchanged native option-ID rule against the closed gold rows,
which never enter reader source or reranking. The prespecified development gate
requires: at least **3 percentage points** aggregate answer gain over
`raw-vector`, nonnegative answer delta in both personas, strictly positive
reference-recall delta versus `raw-vector` overall and in both personas, all
876 cases complete with zero failed, refused, truncated, unresolved or
unattempted cases. Secondary views never select another candidate. No bootstrap
interval or confirmatory superiority claim is made for two exposed development
personas.

## Budget

New task spend before this study: **$5.088931**. Campaign cap: **$5** and at
most 876 physical calls. Task maximum after this campaign: **$10.088931** of
the authorized $25 total, leaving at least $14.911069 unallocated. All 28
historical ancestry ledger pins (254,047,944 microdollars) are preserved
separately and are not reused as task authorization.
