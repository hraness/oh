# LoCoMo answer composition: development experiment

This fixed development screen tests whether an existing answer-composition
instruction helps the same GPT-4o mini reader use unchanged retrieved evidence.
It changes the system instruction only. It does not change the memory framework,
retrieval, context ordering, reader model or output allowance.

Status: protocol prepared on 2026-09-22 before new reader or judge calls. All
participating code, requests, source, scorer, profiles and this document must be
pinned before execution. No result is implied by this protocol.

## Why test this instruction

The existing `composition-v1` contract asks the reader to combine relevant
facts, distinguish events from repeated mentions, resolve relative dates,
handle updates and cumulative values, compute requested quantities, and cover
each requested part. It keeps the original abstention instruction. The exact
contract is in [evolution-reader-contracts.ts](../scripts/benchmarks/evolution-reader-contracts.ts);
this experiment adds no dataset-specific rule or revised wording.

Earlier LongMemEval development tests with other readers had mixed outcomes.
Composition alone scored 71/100 versus 73/100 for the legacy nano/Oh control,
and 82/100 versus 79/100 for mini/Oh. A stronger timeline instruction later
scored 87/100 versus 92/100. Those results, recorded in
[the answer-contract comparison](EVOLUTION_RESULTS.md#answer-contract-comparison)
and [release results](EVOLUTION_RELEASE_RESULTS.md), establish neither a gain
nor a rejection for this reader and context. The hypothesis here is limited to
this exact existing contract under a matched development comparison.

## Fixed source and treatment

Use only conversations 49 and 50 of the pinned LoCoMo dataset and original
development top-20 vector capture. The eligible population contains all 314
native category 1–4 questions, including questions without evidence labels:
156 in conversation 49 and 158 in conversation 50. Category 5 is outside the
adapted native judge task.

Reuse the exact identifier-only selection from the closed order experiment:
80 questions per conversation, 160 total. Identifiers are sorted by SHA-256 of
`oh.locomo.order-dev-draw.v1:17:${id}` within each group and the identically
ordered groups are drawn round-robin. There is no redraw, outcome-based subset
or sample-size fallback. These questions have prior project exposure, including
the earlier development experiment. Only conversations 49 and 50 enter this
screen's source construction, requests and scoring. The previously closed
eight-conversation QA comparison informed the broader hypothesis development;
this screen does not claim independence from that prior evidence.

The fixed draw contains 27 category-1, **39 category-2**, 12 category-3 and 82
category-4 questions. Conversation 49 contributes 13/21/8/38 and conversation
50 contributes 14/18/4/44 in that order. The temporal gate therefore retains
39 questions and 117 reader attempts per arm. Categories remain outside the
reader projection.

| Arm | Reader profile | Answer contract |
| --- | --- | --- |
| `vector-window` | `gpt4o-mini-reader` | `legacy-v1` |
| `vector-window-composition` | `gpt4o-mini-composition-v1-reader` | `composition-v1` |

Both arms use the exact original vector-window context, produced from the same
top-20 ranking with radius-two neighbors under a 12,000-byte ceiling. Whole
turn text, dates, speakers, identifiers, selected membership, ordered turn IDs
and separators must match byte for byte. No turn is added, removed, rewritten,
reordered or repacked. Question and question date are identical. Neither arm
receives gold references, categories, prior answers, correctness labels or
question-specific instructions.

## Reader, judge and spending

Each arm has three separate reader attempts for every question: 960 logical
answers. Both existing profiles use the same Gateway `openai/gpt-4o-mini`
alias, OpenAI routing, temperature zero, 2,048 output tokens and other decoding
settings. The composition instruction is longer and therefore adds input
tokens; report its actual token use and cost. This is a model-matched comparison,
not an assertion that request token counts are equal. The alias is not a
verified immutable model snapshot.

Gold references enter only the separate adapted LoCoMo-J judge after all
reader answers are fixed. Its unchanged profile uses the GPT-4o mini alias,
temperature zero and 512 output tokens. The rubric is the repository's
documented adaptation, not an official leaderboard reproduction. The complete
serialized judge-message input is bounded to 24,000 UTF-8 bytes. Oversize
inputs fail explicitly without truncation. Identical judge prompts share one
physical judgment across arms and reader repeats at judge index zero; this is
not three independent judge attempts.

The first two selected questions across both arms and all repeats form an
included structural canary. It checks capture, identities and completeness,
not answer quality. Arm order alternates by each question's within-conversation
ordinal and repeat, balancing dispatch position in each conversation. Reader
requests may deduplicate only within the same repeat; different repeats remain
separate physical attempts.

The new campaign is capped at **$8 and 1,920 physical calls**: up to 960 readers
and a worst-case judge for every logical answer. The complete worst-case
reservation must fit before any call. Prior spending in the current task is
**$3.759317**; maximum task exposure with this campaign is **$11.759317**,
leaving **$13.240683** within the authorized **$25 total**. Preserve the complete
historical ledger chain separately; a new campaign does not reset spending.

Reader and judge phases have separate immutable receipts backed by the native
request/response store. No automatic retries are allowed. Unknown calls retain
their reservations and stop new admissions while owned calls drain. Explicit
continuation may execute only never-reserved jobs after reconciliation; no
occupied request is reissued. Source and code identities are checked through
closure. Reporting replays the original source and authenticates native answers
and judge requests before computing or publishing aggregates.

## Development decision

The sole advancement contrast is `vector-window-composition` minus
`vector-window`, taking the mean of three judgments per question and then the
mean across the 160 questions. It advances to a separately fixed confirmation
only if all of the following hold:

- Overall accuracy improves by at least **3 percentage points**.
- The difference is nonnegative in each development conversation.
- Accuracy improves strictly on **native category 2, temporal questions**.
- All 960 logical cases are attempted and resolved, with zero reader failures,
  zero judge-only failures and no unresolved calls.

Use `1e-12` as numerical-zero tolerance. For the temporal gate, require the
difference to exceed that tolerance. Known failures retain zero in their fixed
denominators even though they veto advancement. An incomplete matrix cannot
produce a public score or advance.

Report both arms, paired wins/losses/ties, each conversation, each reader repeat,
all four native category slices, failures, physical reuse, token use and full
cost. Temporal accuracy is a prespecified gate; the other category slices are
secondary descriptions and cannot choose a new prompt or replace the primary
contrast. Two previously exposed development conversations do not establish
confirmation, general memory superiority or an external-framework win. Earlier
closed results and protocols remain unchanged whatever this screen finds.

An instruction-only gain would support an answer-pipeline improvement, not Oh
retrieval superiority. The instruction can also be used with other retrievers;
a matched framework comparison would need to give them the same contract.

The experiment and analysis are performed by coding agents with model-judged
answers. LoCoMo is by Maharana et al.; its source dataset is distributed under
[CC BY-NC 4.0](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/LICENSE.txt).
