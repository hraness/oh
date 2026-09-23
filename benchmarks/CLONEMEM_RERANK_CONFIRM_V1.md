# CloneMem local-reranker confirmation protocol (frozen before any paid call)

This document fixes a separately frozen **confirmation** screen for the
local-reranker candidate that passed the
[two-persona development screen](CLONEMEM_RERANK_DEV_RESULT_V1.md). The screen
runs only after a free local retrieval probe passes its own fixed gate on the
same population, and only after the exact affordable plan, an independent
launch review, and a root task-budget freeze. It is not launched from this
document alone.

## Population and exposure

- **861 questions** — the complete remaining population of the **seven reserved
  personas**: 76, 78, 142, 167, 110, 181 and 107 questions. Persona identity is
  fixed in the private probe packet (`clonemem-rerank-confirm-v1`), which
  excludes the excluded primary persona and both development personas.
- All nine eligible personas had prior project exposure. These seven were
  reserved from the development screens, but they are **not pristine holdout
  data**; every claim keeps that qualification.
- The two development personas (114 + 32 questions) are excluded from this
  screen. No question is dropped for missing evidence or retrieval
  performance.

## Arms and candidate

Two arms, unchanged from the development screen:

- `raw-vector` — the original top-10 semantic control, reproduced byte-exact
  from the frozen captures.
- `oh-union-qwen3-rerank-v1` — the union of normalized-lexical top 30 and
  original-stem semantic top 30 (at most 60 whole traces per question),
  reranked by the pinned local Qwen3-Reranker-0.6B Q8_0 GGUF model
  (SHA-256 `22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48`,
  revision `a02f48bb4f057028298c21fa033da2b30d7742d5`), top 10 returned.

Both arms index only traces dated at or before the question time. Neither uses
gold choices or evidence labels during retrieval or reranking. The native
context renderer preserves whole traces without byte truncation within the
96 KiB admission ceiling. No new embeddings are created; semantic candidates
replay the captured original rankings.

## Reader and repeats

- The unchanged native single-user multiple-choice prompt with the Gateway
  `openai/gpt-4o-mini` alias, temperature 0.1 and a 512-token output limit.
  No model judge; scoring is the exact option-ID rule applied offline after
  capture.
- **Three independent reader repeats per question and arm.**
- Total logical cases: 861 × 2 × 3 = **5,166**.

## Execution: three sequential campaigns

The shared paired-memory framework bounds one campaign at 300 questions and
1,800 physical calls, and requires each campaign's reservation to fit inside
its authorized cap. The screen therefore executes as **three sequential
persona-group campaigns** against one shared accounting ledger:

| Campaign | Personas (count) | Questions | Physical calls |
| --- | --- | ---: | ---: |
| A | `2289bf34` + `d4f00c57` | 277 | 1,662 |
| B | `b99ae361` + `b2df4690` | 288 | 1,728 |
| C | `600bfee5` + `9fdf4fb7` + `157c536e` | 296 | 1,776 |

Each campaign gets its own frozen input pins, accounting extension,
prepared artifacts, launch packet, independent launch review, budget freeze,
canary and full run — in that order — before the next campaign is reconciled.
Campaign caps are set at or slightly above each plan's exact reservation
(≈$8.1–8.4M micros), so each step satisfies prior actual exposure plus new
cap ≤ the task-wide $25 authorization.

The screen's decision applies to the **pooled 861-question matrix** across all
three campaigns. The campaign split is an execution detail, not a sampling
decision: every planned question enters exactly once per arm per repeat.

## Confirmatory decision rule (pre-registered)

The screen yields `confirmedImprovement: true` only if **all** of the
following hold on the pooled matrix:

1. Complete matrix: all 5,166 responses completed; zero failed, refused,
   truncated, unresolved or unattempted cases.
2. Pooled answer-accuracy delta ≥ **+3 percentage points** over `raw-vector`.
3. The **95% persona-cluster bootstrap lower bound** on the pooled accuracy
   delta is strictly greater than 0: resample the seven personas with
   replacement 10,000 times (fixed seed derived from the screen's frozen
   pins), recompute the pooled delta within each resample, and require the
   2.5th percentile > 0.
4. Nonnegative mean answer-accuracy delta in **every** persona.
5. Strictly positive recall@10 delta overall **and** in every persona,
   using the same flat union of gold trace IDs as the development screens.

Anything weaker — including a large pooled delta whose cluster interval
crosses zero, or any persona regression — yields
`confirmedImprovement: false` and no default change. A pass confirms
improvement **on this reserved population only**; it is still not a pristine
holdout and not a framework-leaderboard claim.

## Accounting and custody

- Task-wide authorization remains **$25 total** for new reader/judge
  experiments. Prior completed task exposure before this screen is
  **$5.862707** (five closed campaigns, zero unresolved charges).
- Each campaign extends the closed-accounting ledger: predecessor store stays
  closed and immutable; no writes to old stores; unresolved charges remain
  zero.
- The same native custody rules apply: bounded artifacts, owned attempts,
  checkpointed jobs, closed-store post-run audit, offline score
  reconstruction, and the private/public artifact split.
- Gold keys enter only offline scoring after all responses are captured.

## Qualifications

- Agent-run measurement on previously exposed benchmark data; no human or
  model grading.
- The reader alias does not prove an immutable provider snapshot; recorded
  client service duration is not isolated model latency.
- Local reranker inference carries no provider charge and is excluded from
  reader costs.
- A passing result authorizes evaluating the candidate for default
  promotion as a separate reviewed change; it does not itself change any
  default.
