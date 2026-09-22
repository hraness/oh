# CloneMem keyword queries: development screen

This fixed screen tests whether removing common English words from the lexical
query improves hybrid retrieval and answer accuracy. Both arms retain the same
original-question semantic ranking and use the same reader. It is development
work on previously exposed data, not a fresh benchmark or a leaderboard claim.

Status: prepared on 2026-09-22 before new reader calls. The earlier CloneMem
comparison remains closed. This protocol, source, policy, plan and complete
participating code are pinned before dispatch; no result is implied here.

## Population and fixed treatment

Use all **146 questions** from two personas selected by the frozen SHA-256
identifier rule. The selected personas contain **114 and 32 questions**. There
is no question subsample, evidence-coverage filter, category filter or fallback
draw. All nine eligible personas have prior project exposure. The other seven
are reserved for a separately fixed confirmation screen; they are not pristine
holdout data. Only the two selected personas enter this study's source replay,
requests and scoring.

The preceding offline development probe compared retrieval policies on these
two personas and selected one candidate before any new reader outcomes. This
screen evaluates that fixed candidate; it does not select between prompts or
change the policy based on answer accuracy.

| Arm | Fixed retrieval procedure |
| --- | --- |
| `raw-vector` | Original top ten semantic results from the captured top-30 ranking |
| `oh-hybrid-keywords-v1` | Normalized lexical top 30 fused with the same original-question semantic top 30, returning ten traces |

The lexical query is the original question stem normalized to NFC, lowercased
with the `en-US` locale, tokenized with the shipped token expression, deduplicated
in first-occurrence order and filtered by the fixed English stopword list. Keep
the first 16 remaining tokens. There is no stemming. An empty result produces
an empty lexical lane. The complete policy and stopword list are in
[clonemem-keyword-policy.ts](../scripts/benchmarks/clonemem-keyword-policy.ts).

Semantic search continues to use the **unchanged original question stem**. The
candidate does not claim that its normalized lexical query generated the
captured semantic ranking. Fusion uses the shipped search behavior: lexical
weight two, semantic weight one and reciprocal-rank constant 60. Question text
and eligible memory are its only runtime evidence; choices, gold keys, evidence
labels and earlier answer correctness never enter retrieval.

Only original traces dated at or before the question time are indexed, before
candidate limits apply. Context uses native top-ten whole traces with the
unchanged renderer, without byte truncation. The request admission ceiling is
96 KiB of memory per arm; a bound violation stops preparation instead of
silently shortening evidence. The two contexts may have different lengths.
The source adapter replays the original SDK and candidate and checks every
rank, context hash and byte count against the frozen development probe.

## Reader, scoring and execution

Both arms use the existing `gpt4o-mini-clonemem-choice-v1-reader`: Gateway
`openai/gpt-4o-mini`, OpenAI routing, temperature 0.1, a 512-token output ceiling
and the unchanged native single-user multiple-choice prompt. It is a model
alias, not a verified immutable snapshot. Each question has **three reader
attempts per arm**, giving **876 logical answers**. There is no model judge.

Native choice scoring trims the response, uppercases it and requires exact
equality to the option ID. Explanations or extra option text do not count as
correct. Gold keys enter only offline scoring after capture. All attempted
failures retain zero in the original denominator. Unresolved or unattempted
cases make the matrix incomplete and prevent public scoring.

The first two selected questions across both arms and repeats form an included
structural canary. It checks native capture and completeness, not accuracy.
The shared paired runner alternates arm order by question ordinal and repeat.
Exact reader requests may share a physical call only within the same repeat;
the frozen plan currently contains 876 distinct calls. There are no retries of
occupied requests. Unknown calls retain their reservations and stop admission
while owned calls drain; an explicitly reviewed continuation can run only
never-reserved work after reconciliation.

The campaign cap is **$5 and 876 physical calls**. The complete pre-call bound
is **$4.099656**, including all planned outputs. Prior new spending in this task
is **$4.300145**; maximum task exposure with this campaign is **$9.300145**, under
the authorized **$25 total**, leaving **$15.699855** unallocated. The complete
27-ledger historical accounting chain remains separately preserved.

## Development decision

The sole candidate is `oh-hybrid-keywords-v1`, compared with `raw-vector`.
Primary multiple-choice accuracy averages three scored reader outcomes per question and
then all 146 questions. The 114/32 persona sizes are preserved; this is a
question-weighted result, not an equally weighted persona mean.

The candidate advances only when all of these fixed conditions hold:

- Answer accuracy improves by at least **3 percentage points** overall.
- Answer accuracy is nonnegative relative to the baseline in each persona.
- Native recall@10 improves strictly overall and in each persona.
- All 876 logical cases are complete, with zero reader failures, unresolved
  calls or unattempted cases.

Recall uses the upstream flat union of evidence trace IDs per question, with
top ten ranks selected before deduplication. Future-dated evidence labels stay
in the gold denominator even though future traces are ineligible for retrieval.
An empty evidence union yields an unevaluable recall row; report it explicitly
and veto advancement unless all 146 questions have evaluable recall. Use
`1e-12` as numerical-zero tolerance; strict recall gains must exceed it.

Report both arms, paired wins/losses/ties, each persona, every reader repeat,
recall coverage, context bytes, model identities, failures, physical reuse,
token use and costs. Per-arm usage may overlap when requests are shared; the
total counts each physical call once. Two exposed development personas do not
support a confirmatory confidence interval or general superiority claim.
Secondary views cannot select another policy or override the advancement gate.

## Authenticated offline reporting

Preparation reconstructs source, scorer and rank provenance from the pinned
input packet. The reporter repeats that reconstruction, verifies the complete
plan and launch, and opens only a closed native database in immutable read-only
mode. It reparses raw responses, checks every request, answer, charge and final
result, and verifies the database hash before and after scoring.

```sh
bun scripts/benchmarks/clonemem-keyword-dev-prepare.ts prepare \
  INPUT_PINS_JSON CAMPAIGN_JSON NEW_PRIVATE_DIRECTORY

bun scripts/benchmarks/clonemem-keyword-dev-report.ts score \
  PREPARED_JSON LAUNCH_JSON FINAL_RESULT_JSON CLOSED_DATABASE \
  DATABASE_SHA256 NEW_PRIVATE_DIRECTORY
```

These are explicit local artifact paths and the independently supplied closed
database digest. The command makes no provider calls and writes new private
files only. The public projection contains aggregates and provenance hashes;
questions, source text, answers, gold keys and local paths stay private. Code
and protocol must match the frozen preparation; reproducing an older run may
require its recorded source checkout.

This is coding-agent experimentation with model-generated answers scored by
the native option-ID rule. The pinned CloneMem source, license and upstream
links are recorded in [the source profile](profiles/clonemem-source-v1.json).
