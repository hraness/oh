# Answer composition did not pass the development test

Adding the existing composition instruction scored **74.17%**, compared with
**75.42%** for the unchanged reader instruction, on the fixed LoCoMo development
sample. The difference was **−1.25 percentage points**. The treatment failed its
advancement rule and does not advance to confirmation or change a default.

This coding-agent experiment completed on 2026-09-22 using model-judged answers.
The [frozen protocol](LOCOMO_COMPOSITION_DEV_V1.md) remains unchanged. The
[complete aggregate result](results/memory-locomo-composition-dev-v1.json)
retains both arms, every conversation, category and reader repeat, failures,
context sizes, token use and costs.

## What changed

The experiment reused 160 questions, 80 each from development conversations
49 and 50, selected by the fixed identifier-only draw from all 314 eligible
category 1–4 questions. Both conversations and this sample had prior project
exposure. Only these two conversations entered source construction, requests
and scoring. Earlier closed experiments informed the hypothesis; this is not
an independent confirmation set.

Both arms received identical vector-window context, including the same whole
turn text, dates, speakers, ordered identifiers and separators. The mean context
size was **11,614.925 bytes**, under the same 12,000-byte ceiling. Only the system
instruction changed: the candidate used the existing `composition-v1` contract
to request careful event distinction, date handling, aggregation and complete
answers. Its wording was fixed before calls, with no question-specific rules.

Each question had three separate reader attempts per arm, giving 960 answers.
Accuracy averages the three judgments per question and then all 160 questions.

| Scope | Original instruction | Composition instruction | Difference |
| --- | ---: | ---: | ---: |
| All 160 questions | 362 / 480 · 75.42% | 356 / 480 · 74.17% | −1.25 pp |
| Conversation 49, 80 questions | 192 / 240 · 80.00% | 185 / 240 · 77.08% | −2.92 pp |
| Conversation 50, 80 questions | 170 / 240 · 70.83% | 171 / 240 · 71.25% | +0.42 pp |
| Temporal category 2, 39 questions | 68 / 117 · 58.12% | 63 / 117 · 53.85% | −4.27 pp |

Across question-level means, composition improved four questions, regressed on
seven and tied on 149. Advancement required at least **+3 percentage points**
overall, no decline in either conversation, a strictly positive temporal
difference, complete responses and zero reader or judge-only failures. The
accuracy conditions failed; completion and failure conditions passed. Other
category slices and individual repeats cannot replace the fixed decision.

This is an unsuccessful development screen, not confirmed general harm from
composition instructions. Two previously exposed conversations do not support
a confirmatory accuracy claim; no confidence interval is presented. The
instruction applies to other retrievers too, so this comparison supplies no
claim of Oh retrieval superiority.

## Model settings and cost

Both readers used the Gateway `openai/gpt-4o-mini` alias at temperature zero
with a 2,048-token output limit. The separate adapted LoCoMo-J judge used the
same alias at temperature zero with a 512-token limit. OpenAI was the reported
provider; no resolved immutable model snapshot was supplied. Gold references
entered only the judge after reader answers were fixed.

All **960 reader calls and 277 distinct judge calls** completed. Byte-identical
judge prompts shared one physical judgment across matching answers. There
were no reader, judge, input-bound or unresolved failures; all planned cases
remain in the denominators.

The longer composition instruction added **155 input tokens per reader request**.
Original-instruction readers cost **$0.253075** and composition readers cost
**$0.265100**, an observed 4.75% increase. Cache hits and output lengths also
differed, so this charge difference is not an isolated prompt-length estimate.
Judging cost **$0.022653**, bringing the study to **$0.540828**. At closure, total
new spending in the task was **$4.300145**, leaving **$20.699855** within its
authorized $25 cap. Historical research spending remains separately recorded.

## Verification and evidence

An independent coding-agent audit replayed all 1,237 captured native responses,
requests, model identities, usage and charges, rebuilt the shared judge plan,
and matched the final receipt. A separate Python implementation reconstructed
the fixed sample, exact reader messages, scores, category and conversation
slices, advancement gates and costs without importing the TypeScript scorer.
Both passed and left the closed database unchanged. The
[audit digest](results/memory-locomo-composition-dev-audit-v1.json) records their
hashes and scope. This is automated review, not human grading.

Measurement source was frozen at
`457fb8ebc622362df665f23bf3eaabc3c566f115`. The public result is an unchanged copy
of the authenticated aggregate, with SHA-256
`ec8793bfc4689bdd5e300f5f21fb4ca4f541b10a2add3349d1ea37ae2233e411`.
Raw conversations, gold references, answers and provider records remain outside
the repository. The earlier [packing comparison](LOCOMO_WINDOW_QA_V1.md) and
[conversation-order test](LOCOMO_ORDER_DEV_RESULT_V1.md) remain closed and unchanged.

LoCoMo is by Maharana et al. The pinned source revision is
`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`, distributed under
[CC BY-NC 4.0](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/LICENSE.txt).
