# LoCoMo conversation order: development experiment

Status: protocol fixed on 2026-09-22 before drawing this experiment's question
sample or making provider calls. This is a development test, not a confirmatory
benchmark or a leaderboard comparison.

The [closed packing comparison](LOCOMO_WINDOW_QA_V1.md) improved evidence recall
without establishing an answer-quality gain. A post-hoc mechanism inspection
found that many candidate failures retained the annotated evidence but separated
related dialogue turns. This motivates one new hypothesis: restoring source
order may make already-selected evidence easier to use. The inspection does not
demonstrate that ordering caused the regression.

## Fixed treatment

Use only conversations 49 and 50 from the same pinned LoCoMo source and original
development vector capture. These conversations have prior project exposure.
The eligible population contains 314 category 1–4 questions: 156 and 158
respectively. Category 5 is outside the native judge's task.

Draw 80 questions from each conversation, 160 total, using only identifiers.
Sort identifiers by SHA-256 of `oh.locomo.order-dev-draw.v1:17:${id}` and
round-robin the two identically sorted conversation groups. The sample, context
bytes, source code, complete requests, profiles, separate scorer and spending
plan are pinned before the first call. There is no sample-size fallback.

Cross two existing selection policies with two presentation orders:

| Selection | Existing presentation | Source-order presentation |
| --- | --- | --- |
| Vector windows | `vector-window` | `vector-window-source-order` |
| Query-aware packing | `anchors-query-4` | `anchors-query-4-source-order` |

Each policy selects once from the same original top-20 vector ranking under
the 12,000-byte ceiling. Source-order presentation sorts only the selected turn
identifiers by their position in the original conversation. Whole turn text,
dates, speakers, identifiers and the two-newline separator remain unchanged.
No turn is added, removed, rewritten or repacked. Membership, cardinality and
UTF-8 byte volume must match exactly within each presentation pair. Questions
whose order is already unchanged remain in the original denominator.

## Reader, judge and accounting

Each question has three separate reader attempts for each of four arms: 1,920
logical answers. Reader and judge profiles, prompts and failure handling match
the closed packing study: GPT-4o mini reader, temperature zero, 2,048 output
tokens; adapted LoCoMo-J judge using the same alias, temperature zero, 512
output tokens. These are unpinned model aliases, not verified snapshots.

Byte-identical reader requests may share a physical response within a repeat;
different reader repeats remain separate. Exactly identical judge prompts share
one physical judge response across all arms and repeats at judge index zero.
The complete serialized judge-message input is bounded to 24,000 UTF-8 bytes.
Oversize prompts fail explicitly; they are never truncated or substituted.
Gold references remain separate from reader inputs and enter only the judge.

The first two selected questions across all arms and repeats are an included
structural canary. It checks identities, accounting and response completeness,
not answer quality. Arm order rotates by each question's within-conversation
ordinal and reader repeat, balancing every arm's dispatch position within both
development conversations. No automatic
retries are allowed. Unknown calls retain their reservations and stop new
admissions while owned calls drain; an explicit continuation can run only
never-reserved work after reconciliation. Each phase has immutable receipts.

The campaign ceiling is **$15 and 3,840 physical calls**, including the full
reader reservation and a worst-case judge for every logical answer before
dispatch. Prior spending in this task is **$2.692061**; worst-case task exposure
is **$17.692061**, within the user's **$25 total**. The complete 25-ledger
historical chain is preserved separately. A later experiment requires its own
frozen plan within the remaining task budget; this campaign does not authorize
extra treatments or reset spending.

## Development decision

The predeclared contrast is `anchors-query-4-source-order` minus
`anchors-query-4`, averaged over questions after taking the mean of three
reader judgments per question. Source order advances to a separately frozen
confirmation only if this contrast is at least **+2 percentage points** overall,
is nonnegative in **each** development conversation, all logical cases have
been attempted and resolved, and there are **zero judge-only failures**.
Use numerical tolerance `1e-12` at these boundaries. Known reader failures and
judge failures retain zero scores in the original denominator.

The two vector-window arms diagnose whether any ordering effect also appears
with the control's selected turns. All four arms, per-conversation and
per-repeat scores, ties, failures, physical-call reuse and costs are reported.
These secondary contrasts cannot select a different winner or replace the
predeclared advancement contrast. Two development conversations cannot support
a confirmatory improvement claim. No development score is promoted as a
general accuracy gain, and the earlier negative result stays closed.

The experiment and analysis are performed by coding agents with model-judged
answers. LoCoMo is by Maharana et al.; its source dataset is distributed under
[CC BY-NC 4.0](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/LICENSE.txt).
