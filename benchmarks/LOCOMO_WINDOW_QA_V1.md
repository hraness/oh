# LoCoMo conversation packing: matched answer comparison

Status: protocol fixed on 2026-09-22, before selecting the answer-study sample
or making its reader and judge calls. Results will be added after completion.

[LoCoMo](https://github.com/snap-research/locomo) tests questions about long
conversations. This study uses the pinned `locomo10.json` release at commit
`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`, SHA-256
`79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`.

This comparison asks whether a confirmed improvement in evidence selection
also improves answers. Two methods select unchanged conversation turns from
the same captured vector rankings, with a **12,000-byte context ceiling**.
The reader, answer prompt and judge are identical across methods.

## Candidate and prior evidence

The control is `vector-window`. The candidate, `anchors-query-4`, gives the
original top-20 vector anchors first priority, then fills remaining space with
nearby turns using a fixed query-aware ordering and radius four. Both keep
whole turns. The candidate retains anchor-rank order followed by neighbor
priority; the control retains its existing vector-window order. This is a
benchmark context-selection policy;
it is not a new default in the Oh SDK.

The candidate was selected using only conversations 49 and 50. On the other
eight conversations, its evidence recall was **90.08%**, versus **88.93%** for
the control: **+1.15 percentage points**, with a conversation-cluster 95%
interval of **+0.62 to +1.70 points**. This recall denominator contains 1,224
questions with evidence labels. All eight conversation differences were
positive. The [confirmation artifact](results/memory-locomo-window-confirmation-v1.json)
records both methods, conversation results, intervals and source hashes.
The candidate used 236 more bytes per question on average, so the
comparison has an equal ceiling, not equal realized context length.

Those eight conversations were excluded from this policy's selection, but
the broader project has previously evaluated them. This answer experiment is
a follow-up selected after the retrieval result. Neither the source data nor
this follow-up should be described as a completely unseen benchmark.

## Frozen questions and contexts

The answer pool contains all **1,226 questions in categories 1–4** from
conversations 26, 30, 41, 42, 43, 44, 47 and 48. Their respective populations
are 152, 81, 152, 199, 178, 123, 150 and 191. Category 5 has no ordinary gold
answer and is outside this judge's task. The two eligible questions without
evidence labels remain in the answer pool.

Select **300 questions**, with 37 or 38 from each conversation. Seed-17
SHA-256 ordering of identifiers orders conversations and questions within
each conversation, using the domain
`oh.locomo.window-reader-draw.v1:${seed}:${id}`. Round-robin allocation makes
the draw without using answer text, category performance, retrieval gains
or evidence coverage. The sole fallback is the first **120 questions** in
the same ordering, 15 per conversation, and is permitted only if the complete
300-question reservation exceeds the campaign cap before any outcomes exist.

Original data, captured rankings, context-selection code and confirmation
rows receive content hashes. The adapter verifies exact context bytes and
ordered source-turn identities. It emits a reader source containing only
identifiers, questions, question dates and the two contexts. Answers and
categories live in a separate scorer artifact; neither enters retrieval,
context selection or the reader prompt. The question date is the source
conversation's final session date, identically for both arms.

## Reader and judge

Each question has three separate reader attempts per arm. Readers use the
existing `gpt4o-mini-reader` profile, temperature zero and a 2,048-token output
limit, with the unchanged `evolutionAnswerMessages` legacy answer prompt.
Byte-identical reader requests may share a physical response within a repeat;
different reader repeats always have separately indexed attempts.

The existing `gpt4o-mini-locomo-j-judge-v1` profile grades completed answers
against the original gold answer, at temperature zero and a 512-token output
limit. The [rubric and its adaptations](profiles/locomo-judge-v1.json) are
explicit: normalized Zep/Mem0 wording and a free-text CORRECT/WRONG parser.
Exactly one valid label is required. This is an **adapted, matched LoCoMo-J
comparison**, not a reproduction of a published leaderboard score. Both
reader and judge use the Gateway `openai/gpt-4o-mini` alias. A resolved snapshot
may be reported if the response supplies one, but this remains an unpinned
alias treatment.

One physical judge request grades each distinct, byte-identical native judge
prompt across arms and reader repeats. Its repeat index is zero. Sharing
prevents different random grades for identical question, gold and answer
bytes; the report counts physical calls and logical judgments separately.
Three reader attempts do not mean three independent judges.

The full UTF-8 `JSON.stringify(messages)` judge input has a **24,000-byte
limit**, fixed before sampling or answers. An oversized judge prompt is an
explicit judge-bound failure scored zero. It is never truncated, silently
removed or retried with another prompt. Existing profile qualification is
reused; no additional paid calibration examples are selected.

## Spending, execution and failures

The user authorized **$25 total** for new reader and judge experiments. The
closed [CloneMem comparison](CLONEMEM_TRANSFER_V1.md) spent **$1.664274**.
This campaign is capped at **$20 and 3,600 physical calls**, leaving at least
**$3.335726** unallocated even if its entire cap is consumed. Historical
experiments remain separately reconciled and do not reset this task's cap.

Before dispatch, the native request constructor reserves the complete reader
matrix plus a worst-case bounded judge for every logical answer. No expected
request reuse or cached-input discount is needed to fit the plan. The
300-question design permits at most 1,800 readers and 1,800 judges. The
actual plan, selected IDs, source, scorer, profile, authority, campaign and
clean source checkpoint are pinned before the first call.

The first two selected questions across both arms and all reader repeats are
an included structural canary. Its checks concern request identity, complete
responses, limits and accounting, never whether an answer is correct. Reader
dispatch cannot load the scorer's gold fields. Judge dispatch uses only
authenticated native reader outcomes and the separate scorer artifact.

There are no automatic retries. Unknown or occupied responses stop admission;
owned calls drain and their original reservations remain accounted for.
Explicit same-identity continuation may dispatch only never-reserved work
after reconciliation, with immutable attempt receipts. Failed reader answers
score zero in the original denominator. Judge failures also score zero and
are reported separately. No failed run, question or repeat is replaced.

## Scoring and claims

The primary statistic is each question's mean model-judged correctness over
three reader attempts, averaged over the fixed **conversation-balanced
sample**. Report both arms and the paired difference, with a 95% interval
from 10,000 conversation-cluster bootstrap resamples, seed 17. Eight groups
limit precision; repeated answers do not create more independent groups.

An answer-improvement claim requires a positive paired interval lower bound
above the numerical-zero tolerance `1e-12`, **zero judge-only failures**, and
a fully attempted, resolved matrix. Report the measured effect and interval;
this criterion does not establish a large or practically important gain.
Known reader failures stay zero. Unattempted or unresolved work blocks a
public score. An interval including zero does not establish improvement.

Report per-conversation results, repeat scores and their range, reader and
judge failures, logical and physical calls, model identity, context sizes,
captured usage and cost. Native token F1, majority correctness and a
population-weighted estimate using each conversation's pool/sample ratio are
secondary diagnostics. None replaces the balanced primary result or becomes
a full 1,226-question leaderboard score. A post-run answer audit chosen by
blinded IDs is diagnostic only; it cannot rescore or substitute outcomes.

The policy, sample, prompts, denominators and decision rule do not change
after outcomes are visible. README and site claims must link the exact
artifacts and disclose the model judge, sample and prior exposure. This
two-policy comparison does not establish superiority over another framework.

## Reproduce the source admission

The public source adapter replays the frozen contexts without a model or
network access. Supply the original confirmation directory and development
result whose hashes appear in the confirmation artifact:

```sh
bun run scripts/benchmarks/locomo-window-source.ts verify \
  CONFIRMATION_DIRECTORY DEVELOPMENT_RESULT
```

This verifies the pinned LoCoMo source, all 1,986 historical vector-window
controls, and all 3,172 confirmation contexts before projecting the answer
pool. `prepare` creates a new, separate reader source, scorer source and
complete reservation plan; it makes no provider calls:

```sh
bun run scripts/benchmarks/locomo-window-report.ts prepare \
  CONFIRMATION_DIRECTORY DEVELOPMENT_RESULT CAMPAIGN NEW_PRIVATE_DIRECTORY
```

Paid dispatch additionally requires a reviewed clean-checkpoint launch,
bounded native campaign and explicitly selected OIDC authority. Preparation
alone never grants permission to spend. The final `score` command authenticates
the complete native reader and judge ledger against that same preparation:

```sh
bun run scripts/benchmarks/locomo-window-report.ts score \
  PREPARED_RECEIPT LAUNCH FINAL_JUDGE_RESULT NEW_PRIVATE_DIRECTORY
```

Original provider responses, source text and private account paths remain in
the local experiment store. Public artifacts contain aggregates and hashes.
