# Conversation order did not improve development answers

Restoring the original conversation order did not pass the fixed advancement
rule. On 160 LoCoMo development questions, query-aware packing scored **74.38%**
in its existing order and **73.54%** in source order, a difference of **−0.83
percentage points**. This treatment does not advance to confirmation and does
not change Oh's default retrieval behavior.

This coding-agent experiment completed on 2026-09-22 using model-judged answers.
The [frozen protocol](LOCOMO_ORDER_DEV_V1.md) remains unchanged. The
[complete aggregate result](results/memory-locomo-order-dev-v1.json) includes
every arm, conversation, reader repeat, failure count, context size and cost.

## What was tested

The experiment used 80 questions each from development conversations 49 and 50,
selected by a fixed identifier-only draw from 314 eligible category 1–4
questions. Both conversations had prior project exposure. Each question had
three reader attempts under each of four conditions, giving 1,920 answers.

Each selection policy used the same original top-20 vector ranking and
12,000-byte ceiling. The source-order variant changed only the presentation
order of already-selected turns. Turn text, dates, speakers, identifiers,
membership and byte volume stayed identical within each order pair.

| Selection and presentation | Correct judgments / attempts | Mean answer accuracy |
| --- | ---: | ---: |
| Vector windows, existing order | 367 / 480 | 76.46% |
| Vector windows, source order | 348 / 480 | 72.50% |
| Query-aware packing, existing order | 357 / 480 | 74.38% |
| Query-aware packing, source order | 353 / 480 | 73.54% |

The primary comparison was source-order query-aware packing against the same
packing in its existing order. It needed at least **+2 percentage points**
overall, no decline in either conversation, a complete resolved matrix and
zero judge-only failures. It failed the accuracy conditions:

| Development conversation | Existing order | Source order | Difference |
| --- | ---: | ---: | ---: |
| 49, 80 questions | 74.58% | 73.33% | −1.25 pp |
| 50, 80 questions | 74.17% | 73.75% | −0.42 pp |

Across question-level means, source order improved 11 questions, regressed on
12 and tied on 137. The vector-window ordering comparison also declined,
by 3.96 points, but was a secondary diagnostic. Neither secondary comparisons
nor individual reader repeats can replace the fixed primary comparison.
Two development conversations do not support a confirmatory accuracy claim;
no confidence interval is presented for this development decision.

The mean context sizes were 11,614.93 bytes for either vector-window order and
11,919.37 bytes for either query-aware order. Selection policies share a byte
ceiling, while each presentation pair shares exactly the same realized bytes.

## Measurement and verification

Readers used the `openai/gpt-4o-mini` Gateway alias at temperature zero with a
2,048-token output limit. The separate adapted LoCoMo-J judge used the same
alias at temperature zero with a 512-token limit. The provider reported OpenAI;
no resolved model snapshot was supplied. Gold references entered only the judge.

All 1,920 reader calls and 525 distinct judge calls completed. Byte-identical
judge prompts shared one physical judgment across matching answers, as fixed
before dispatch. There were no truncated, refused, failed or unresolved calls,
and no judge-input-bound failures. Every answer remains in the denominator.

The study cost **$1.067256**: $1.023862 for readers and $0.043394 for judges.
Together with the closed CloneMem and LoCoMo packing answer studies, total new
paid spending was **$3.759317** against the authorized **$25 total cap**.

An independent coding-agent audit replayed all 2,445 captured native responses,
requests, model identities, usage and charges, reconstructed shared judge
requests, and matched the compact receipt. A separate Python implementation
reconstructed all scores, contrasts, advancement conditions and costs without
importing the TypeScript scorer. Both audits passed and left the closed
database unchanged. The [audit digest](results/memory-locomo-order-dev-audit-v1.json)
records their hashes and scope. This is automated review, not human grading.

Measurement source was frozen at
`d71fe2a9269849eba43092c8d7fc0808cd8641da`. The result binds the source,
scorer, plan, launch and final receipt by hash. The public files contain
aggregate metrics and hashes; raw conversations, answers and provider records
remain outside the repository. The result file SHA-256 is
`1592fb40937ef7847637b9ee826bdb98744ef42d35041324553159af516989cc`.

The earlier [packing comparison](LOCOMO_WINDOW_QA_V1.md) remains closed:
it established an evidence-recall improvement within its stated scope, but
did not establish an answer-quality gain. This development result supplies no
stronger accuracy or external-framework superiority claim.

LoCoMo is by Maharana et al. The pinned source revision is
`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`, distributed under
[CC BY-NC 4.0](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/LICENSE.txt).
