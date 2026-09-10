# LongMemEval protocol card

This card fixes every setting that an arm must share before its score can be
compared with another arm on the [full 500-question LongMemEval comparison](EVOLUTION_RELEASE_RESULTS.md).
It is the reference for the [pre-registered analysis plan](ANALYSIS_PLAN.md).
A number that was produced under a different setting is reported as a
different protocol, never as a matched result. The card was fixed on
2026-09-10, before any candidate of the current program was run.

## Budget policy

Every experiment under this card runs inside one campaign with a cap of at
most $20 of accounted exposure. Readers are GPT-5 nano or GPT-5 mini only.
The sealed holdout is the LoCoMo test split, not BEAM. No direct OpenAI key
is used, so the official LongMemEval judge snapshot is never called; the judge
below is a Gateway alias and every result is labelled alias-only. Accounted
exposure is a conservative ledger figure, not a provider invoice.

## Dataset and strata

| Item | Value |
| --- | --- |
| Source file | `longmemeval_s_cleaned.json` from `xiaowu0162/longmemeval-cleaned` |
| Revision | `98d7416c24c778c2fee6e6f3006e7a073259d48f` |
| SHA-256 | `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442` |
| Questions | 500 in 471 declared groups (442 singletons, 29 pairs) |
| Exposure | All 500 questions are development or evaluated as of 2026-09-10. None is a holdout. |
| Strata | development 100 questions in 94 groups; inspected-closed 44 questions in 40 groups; aggregate-only-closed 356 questions in 337 groups |

The strata come from a second exposure manifest kept beside the original pin.
Partition labels are unchanged, so every development configuration still
selects the same 100 questions and every `byte-identical` gate compares the
same contexts. Closed groups are declared `evaluated`; the stratum is a tag in
each group's evidence text. Inspected-closed groups contain the 41 closed
questions that were read per question during the 2026-09-10 failure analysis
of the mini reader, plus their group mates. Because those 41 were selected as
failures of one arm, that stratum's score is a selection artefact and is
reported only so the other two strata can be read cleanly. Aggregate-only
questions are scored in aggregate and never read per question again.

The strata manifest keeps the `oh.memory-evolution.dataset.v1` protocol and
its exact keys. The stratum is carried as a prefix of each group's `evidence`
text with the grammar `stratum=<name>; ` followed by the citation, where
`<name>` is `development`, `inspected-closed` or `aggregate-only-closed`; a
development tag needs the development partition, a closed tag needs the
closed partition with exposure `evaluated`, and a manifest without the prefix
is read as a V1 pin whose stratum is its partition. The runner never sees the
strata manifest: every configuration keeps the original V1 file as its
`manifestSha256` pin, and the scorer accepts a run pinned to either file only
after checking that both files carry the same dataset digest, questions and
partitions (`rescore --manifest <V2> --pin <V1>`). When the manifest is next
versioned, the stratum moves to an explicit field under a `.v2` literal.

## Matched settings

| Setting | Value under this card |
| --- | --- |
| Memory budget | top-100 retrieved turns packed into 96,000 bytes, retrieval order |
| Retrieval unit | whole source turn, rendered by the benchmark's `renderTurn` |
| Question date | supplied as the `questionDate` field of the JSON user message beside `question` and `memory` |
| Reader | `openai/gpt-5-mini`, reasoning effort medium, 8,192 output tokens including reasoning, Gateway alias; nano tier is `openai/gpt-5-nano` at low effort with the same cap |
| Answer contract | `explicit-abstention-composition-v1`: the shared instruction plus an explicit abstention sentence and a composition sentence; identical for every arm |
| Calls per question per arm | one reader call and one judge call; identical answers from two arms share one judge request |
| Judge | native LongMemEval per-category prompts on the `openai/gpt-4o` Gateway alias, 16-token cap, verdict rule "answer contains yes" |
| Judge status | alias-only; agreement with the pinned official evaluator (`gpt-4o-2024-08-06`, 10 tokens) is unknown and is not measured under the budget policy |
| Failure policy | every question stays in the denominator; a reader failure scores zero; a judge failure scores zero and is counted separately; no retries, no provider fallback |
| Repeats | three reader repeats per arm through the campaign store's repeat index inside one campaign; per-question mean is the scored quantity |
| Controls | BM25 window at the same budget and the previous Oh semantic configuration, both run with the promoted reader contract and the same number of calls |
| Accounting | reader and judge micros from the campaign ledger; judge cost split equally between arms that share a request |

The router and the two-stage reader that the reader workstream proposes live
in `scripts/benchmarks`, not in the shipped library. Only the recall and
observation layers are reproducible from the package. The router instruction
and its category-confusion table are added to this card by that workstream's
pull request before any paid run uses them.

## Differences from published protocols

| Setting | Oh (this card) | Mastra | Mem0 memory-benchmarks | ProsusAI MemEval | Official evaluator |
| --- | --- | --- | --- | --- | --- |
| Question date | JSON field `questionDate` | `Current Date: {date}\nQuestion: {question}` prefix on the user turn | inside a tuned answer prompt | not supplied | not part of judging |
| Answer cap | 8,192 tokens including reasoning | undisclosed | 4,096 tokens | 50 tokens | not part of judging |
| Answer prompt | shared generic contract | Mastra's own | tuned prompt with counting and temporal rules | short generic prompt | not part of judging |
| Judge | gpt-4o Gateway alias, 16 tokens | gpt-4o with LongMemEval prompts | GPT-5 | gpt-4o | `gpt-4o-2024-08-06`, 10 tokens, temperature 0 |
| Memory | top-100 turns, 96 KB | observational memory, undisclosed caps | top-200 memories | per-system adapter | oracle evidence sessions |

Only Mem0's open-source harness is re-runnable locally, and even that cannot
reproduce its published embedder. Vendor figures on the results page are
self-reported single runs.

## Cost per question

Accounted exposure attributed to arms by
`bun scripts/benchmarks/evolution-paired-stats-cli.ts cost` over each run
directory's reader plan, judge plan and the physical ledger of its report:
a reader request belongs to its arm, a judge request shared by arms that gave
the same answer is split equally, and a failed attempt's retained reservation
counts. The pinned output is the cost artifact in the table below.

| Arm | Reader tier | Correct | Accounted per question | Accounted per correct answer |
| --- | --- | ---: | ---: | ---: |
| Oh semantic, 96 KB | GPT-5 mini | 449/500 | $0.0069 | $0.0077 |
| BM25 window, 96 KB | GPT-5 mini | 427/500 | $0.0073 | $0.0086 |
| Oh semantic, 96 KB | GPT-5 nano | 379/500 | $0.0016 | $0.0021 |
| BM25 window, 96 KB | GPT-5 nano | 378/500 | $0.0017 | $0.0022 |
| Full history | GPT-5 nano | 355/500 | $0.0067 | $0.0094 |

## Noise and power

Near-identical mini runs on the same 100 development questions disagreed on 4
of 100 verdicts per arm, and on byte-identical contexts the same reader gave
89 agreeing correct, 7 agreeing wrong and 4 differing verdicts. The power
rows below use that 4% per-run flip rate for LongMemEval and 5% for LoCoMo,
independent per question and per run, and were computed with
`bun scripts/benchmarks/evolution-paired-stats-cli.ts power` at 2,000
simulations and seed 17. A row with a true gain of zero is the false-positive
rate of the gate.

| Gate | Questions | Repeats | Base accuracy | True gain (points) | Pass rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| dev100 reader gate: majority-of-3 gain of at least 3 with at most 2 regressions | 100 | 3 | 0.92 | 0 | 0.006 |
| same | 100 | 3 | 0.92 | 3 | 0.72 |
| same | 100 | 3 | 0.92 | 5 | 0.97 |
| same, single run | 100 | 1 | 0.92 | 0 | 0.11 |
| same, single run | 100 | 1 | 0.92 | 5 | 0.29 |
| full-500 rule: paired lower bound above zero at one-sided 0.025 | 500 | 3 | 0.898 | 0 | 0.025 |
| same | 500 | 3 | 0.898 | 2 | 0.52 |
| same | 500 | 3 | 0.898 | 3 | 0.86 |
| same | 500 | 3 | 0.898 | 5 | 0.999 |
| same plus observed gain of at least 5 points | 500 | 3 | 0.898 | 5 | 0.28 |
| same plus observed gain of at least 5 points | 500 | 3 | 0.898 | 8 | 0.998 |
| full-500 rule, single run | 500 | 1 | 0.898 | 3 | 0.49 |
| LoCoMo test rule: paired lower bound above zero at one-sided 0.025 | 1,540 | 3 | 0.75 | 0 | 0.026 |
| same | 1,540 | 3 | 0.75 | 2 | 0.94 |
| same | 1,540 | 3 | 0.75 | 3 | 0.999 |
| same, single run | 1,540 | 1 | 0.75 | 3 | 0.89 |

Two consequences are fixed here. A single dev100 run cannot distinguish a
5-point gain from noise, so no promotion is made from one run. A memory-side
change whose expected dev100 effect is inside 3 points is screened on dev100
for regressions only and decided on mechanism diagnostics plus the full-500
checkpoint read. The simulator's lower-bound rule uses a normal
approximation; the analysis itself uses the cluster bootstrap.

## Pinned private artifacts

These files stay with the run operator. Their digests are recorded so a later
gate report can prove it used the pre-committed version.

| Artifact | SHA-256 |
| --- | --- |
| Private failure atlas of the 51 mini-reader failures | `2ab15411eacf7a04d58151f02723e3683d777ecb04ed35713988e6b40e5fa27c` |
| Predicted-flip list, mechanism to question identifiers, derived from the atlas before any candidate run | `01c7ec990029644fc68a32d3952aa85a03adeb36f484c2d01a06ac8135860090` |
| Inspected closed identifiers (41) | `3aa4951cf6066b8d0afa111fb6c19d64b97c743bab1b0285fd49222093c92013` |
| Original exposure manifest (V1 pin) | `c58ac7878cc0235fb6b5d55ad72bd48ecc85f1d64e17d6a39759accd885476b9` |
| Strata manifest (V2, beside the pin) | `83b53e17bf47ee60e7c19093adf8af96d1c614534bd6eceb560f8d351f94ab57` |
| Re-score of every published run through the paired-statistics module (one `rescore` invocation, seven studies: mini, nano, full-history, dev100, contracts, readers, width) | `95e1ee1ce81d04177cecb75e4714c7a07b4bafccb652c544b14e1785d6b9a996` |
| Cost attribution over the mini, nano and full-history run directories (`cost`) | `54439882983e91e4d8d8e828f5100fc05396cda3b592822434328e9c16c6873f` |

The re-score file holds all seven studies from one invocation with the
strata manifest, the V1 pin, the pinned dataset for reclustering, the
predicted-flip list, 100,000 resamples and seed 17. It reproduces 449, 427,
379, 378 and 355 correct on the three 500-question studies and 92/87,
92/87/87/84, 89/87/76 and 93/93 on the four development studies; the paired
mini comparison gives 39 wins, 17 losses and 444 ties with an exact one-sided
sign-test p of 0.0023 and a 95% cluster-bootstrap interval of +1.6 to +7.3
points over the 471 declared groups (+1.6 to +7.3 over 453 evidence-content
clusters). The full-history study carries two comparisons in one Holm family
(BM25 window and Oh semantic against full history, both better at the nano
tier). The predicted-flip list names 48 of the 51 failures; the three with no
proposed mechanism are excluded. The scorer is
`scripts/benchmarks/evolution-paired-stats.ts`; it is not a context-affecting
file, so retrieval identity is unchanged.
