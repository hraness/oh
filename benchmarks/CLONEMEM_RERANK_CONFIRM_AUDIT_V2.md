# CloneMem confirmation: independent recomputation and retry sensitivity

An independent coding-agent audit on September 23, 2026 reproduced the
[original result](CLONEMEM_RERANK_CONFIRM_RESULT_V1.md) directly from all five
closed native capture stores. The successful campaigns scored **70.54% for
vector retrieval and 77.82% for the lexical-semantic union plus local
reranker**, a **7.28 percentage-point** improvement. The original result
artifact remains unchanged.

The audit also found a reporting correction: the campaign retry and inclusion
rule was added during execution. The initial hypotheses, population, arms and
numeric thresholds were declared before the study; the entire final protocol
was not unchanged or fully preregistered. The
[aggregate audit artifact](results/memory-clonemem-rerank-confirm-audit-v2.json)
records the protocol history, input digests, calculations and qualifications.

## What was checked

A separate stdlib Python implementation read SQLite with
`mode=ro&immutable=1` and `query_only`, checked each database digest before and
after reading, and made zero provider calls. It compared stored requests with
the frozen plan, verified raw response and answer digests, reparsed answer
text and usage, reconciled charges, and independently applied the exact
option-ID scorer. All five databases remained unchanged.

The three successful campaigns contain 5,166 completed responses:
**1,822 / 2,583** correct baseline answers and **2,010 / 2,583** correct
candidate answers. The audit reproduced all seven persona totals, 106
question-level wins, 30 losses and 725 ties. It also reconstructed recall from
selected trace IDs and gold trace sets: **14.48% → 32.80%**. Mean context size
was **27,198.62 → 21,201.84 bytes**, a **22.05% reduction**.

The fixed-seed 10,000-resample persona-cluster interval reproduces exactly:
**[+4.61, +10.27] percentage points**. Enumerating all 823,543 possible ordered
draws of seven personas, grouped into 1,716 distinct count vectors, gives
**[+4.61, +10.19] points**. This interval describes the seven observed persona
clusters; three answers per question do not create additional independent
personas or undo prior exposure to the dataset.

## Protocol amendment and failed captures

The first two group-A campaigns halted on provider failures. A1 captured
1,619 completed calls and one unresolved call; A2 captured 835 completed calls
and one unresolved call. Their prepared packets bind the original protocol
digest `8e4da930…`. The retry rule was added after both failures, before A3;
A3, B and C bind the amended digest `738a7314…`. The recovered Git commits are
`f14c3ef` for the initial protocol and `e51e10b` for the amendment; their
pre-loss identities were `d24bb39` and `48e2c8a`.

The amendment specified replacing an incomplete campaign with a fresh complete
campaign and excluding the partial matrix from the primary pooled result.
It did not change the arms, questions, renderer, reader prompt or numeric
thresholds. Both partial captures and their charges remain available. Native
audit receipts record that answer-quality scores were not computed during
those original audits. That recorded procedure is useful provenance, not
independent proof that no person or agent ever inspected an answer.

## Does excluding the failed runs explain the gain?

These are **post-hoc sensitivity analyses**, not a replacement primary result
or new preregistered confirmation.

| Analysis | Candidate gain over vector |
| --- | ---: |
| Original complete campaigns A3, B and C | +7.28 pp |
| Keep A1, B and C; assign all 43 missing A1 answers against the candidate | +6.16 pp |
| Keep A1, B and C; assign all 43 missing A1 answers in favor of the candidate | +7.82 pp |
| First completed answer per logical case across A1/A2/A3, then B/C | +6.97 pp |
| First attempted answer per case, count terminal failure as wrong, fill only unattempted cases | +7.01 pp |
| All 7,620 completed calls, average within each arm/question before pooling | +7.12 pp |

The adversarial bounds retain every observed answer from A1, B and C and vary
only A1's 43 missing cells: 22 baseline and 21 candidate. Even the lower bound
leaves every persona positive; the smallest persona delta is +0.61 points.
The direction and size of the gain therefore survive these treatments of the
excluded captures. The repeated partial campaigns are not independent
replications and do not establish a clean holdout result.

## Costs and claim boundary

All five campaigns attempted 7,622 calls, including two unresolved captures.
The successful campaigns charged **$4.730960** and failed campaigns contributed
**$2.282835**, for **$7.013795** of confirmation exposure. Including earlier
work, task exposure was **$12.876502 of the original $25 authorization**.
These amounts are dollars, not millions of dollars.

Safe public claim: **On 861 previously exposed CloneMem questions, the tested
lexical-semantic union plus local reranker scored 77.82% answer accuracy versus
70.54% for raw vector retrieval; independent recomputation and analyses
including failed-run captures preserve the improvement.**

This is not a comparison with Letta, Supermemory or Mem0, a pristine holdout,
external certification, or a claim of state-of-the-art performance. The reader
used a Gateway alias without a verified immutable snapshot. The measured
reranker used single-trace evidence text, while the SDK supplies
`recordDocument`; a separate production qualification is needed for claims
about the shipped default. Local reranker inference time and resources remain
outside the reader provider charges.

The original public result SHA-256 is
`7875476a0d7257f90739fb7ecef8e6b60b190f09ee74703bac60647934630358`.
The independent auditor source digest and all input/capture digests are in the
aggregate audit artifact. Raw source text, questions, answers, gold keys and
private paths are excluded from that artifact.
