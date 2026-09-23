# Instruction selection and the Wordcell seam

Two development results narrow the next memory experiment. Independent Jev
scoring improved retrieval of annotated standing directives. Supplying every
extracted directive to the reader did not improve instruction following and
reduced factual and temporal control scores. Together, these results support a
selective evidence step. They do not establish an answer improvement or a
production default.

## Pointwise retrieval result

The request-shape experiment used 24 previously inspected BEAM development
questions from 12 histories. A deterministic pool placed the existing lexical
top eight first, followed by the complete extracted standing-instruction
inventory in source order. That source-only expansion raised annotated target
coverage from 2/25 in the old top-24 pools to 25/25 before any new model result.

The three orderings used the same expanded candidates and text:

| Ordering | Annotated directive hit@8 | Mean reciprocal rank@8 |
| --- | ---: | ---: |
| Pool order | 1/24 (4.2%) | 0.0417 |
| Shared-state Jev | 11/24 (45.8%) | 0.2292 |
| Independent Jev | 14/24 (58.3%) | 0.2573 |

Independent scoring gained four questions, tied nineteen, and lost one against
shared-state scoring. The paired difference was +12.5 percentage points with a
descriptive history-bootstrap 95% interval of 0 to +25 points. The prespecified
strict-applicability slice reached 13/22 versus 11/22, a +9.1-point difference
with an interval of 0 to +21.7 points. The interval includes no improvement.

All 537 Jev calls completed on `jev-1.13.0`, with no unresolved calls and a
rounded usage estimate of $0.015735. Only 25 focal positive directives were
annotated; other turns remain unjudged. The experiment provides no exhaustive
relevance, precision, nDCG, stability, or answer-quality result. The complete
public aggregate is
[`memory-jev-request-shape-v1.json`](results/memory-jev-request-shape-v1.json),
whose SHA-256 is
`2d8e8420ad054bcd7e963be5de6570aa3917373214f8598f91401604a03f7dbe`.

## Complete-inventory reader result

A separate paired development experiment compared an empty
`standingInstructions` channel with every entry from the frozen extracted
instruction inventory. Both arms used the same keyword evidence and common
prompt. It covered 16 questions from eight previously exposed histories: eight
instruction questions and eight factual or temporal controls.

| Slice | Empty channel | Complete inventory | Paired outcomes |
| --- | ---: | ---: | --- |
| Instruction | 81.25% | 81.25% | 0 wins, 0 losses, 8 ties |
| Factual and temporal controls | 68.75% | 50.00% | 0 wins, 2 losses, 6 ties |
| Overall | 75.00% | 65.63% | 0 wins, 2 losses, 14 ties |

The frozen development gate failed. Thirty-two reader calls and 56 physical
judge calls added $0.467044. Cumulative campaign exposure was $5.531621,
including $0.232768 retained for historical unresolved attempts. Reader and
judge identities were Gateway aliases rather than verified immutable snapshots.
The complete public aggregate is
[`memory-complete-instruction-development-v12.json`](results/memory-complete-instruction-development-v12.json),
whose SHA-256 is
`74dd7e1cd9e46109a3e3b516d50712b3f3f353e79b41a075f324234b44aef5ed`.

## Current decision

The benchmark now has three ownership choices:

| Choice | Evidence | Decision |
| --- | --- | --- |
| Move Wordcell note reranking into Oh | Wordcell has a working note-specific adapter, but its title, path, alias, Markdown, QMD, exact-identity, and priority policies are application-owned. | Do not move this policy. |
| Publish an Oh reranker API | Pointwise retrieval is positive on one adapted development cohort, but no fixed-context reader gain or second stable production consumer exists. | Defer the public contract. |
| Keep a provider-neutral benchmark seam | It lets Oh test current record representations with the successful request shape while leaving product defaults and consumer authority unchanged. | Use for the next experiment. |

`scripts/benchmarks/pointwise-relevance.ts` implements the selected experimental
seam. It accepts already-rendered candidates with source digests, assigns opaque
request IDs, binds the exact representation bytes, and creates one isolated
request per candidate. Its reducer admits only a complete set of finite scores
bound to those representations and preserves baseline order for ties. It owns
no prompt, transport, credentials, provider, source loader, protected-match
rule, or final selection policy. A failed reduction leaves the caller's
baseline available; it never returns a partial ranking.

Wordcell continues to own note representation and identity policy. An Oh
experiment may render current records with record digests and use the same
benchmark seam. Model scores remain disposable retrieval evidence and never
become graph facts or authored metadata.

Run the network-free seam checks with:

```sh
bun test tests/memory-benchmark-pointwise-relevance.test.ts
```

The next paid comparison should freeze a new or properly excluded question set,
use a fixed evidence budget, and compare baseline evidence with independently
selected evidence at the reader. It must measure instruction compliance and
factual controls together. The current results do not establish state-of-the-art
memory performance.
