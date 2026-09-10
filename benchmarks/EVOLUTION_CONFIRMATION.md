# Proposed next evaluation method

Updated 2026-09-09. Completed development and scorer qualifications are separated below from remaining external comparisons and confirmation work. No superiority result has been established.

Our current LongMemEval experiments use an exposed 100-question development selection spanning 94 declared families. The 24-question calibration is a balanced subset of that selection. Additional reader calls, variants and cached answers do not add independent questions or histories. The earlier frozen and reserved studies remain closed. We will report paired development differences with the reader fixed, retain reader and judge failures in the denominator, and distinguish changes in memory implementation from changes in context allowance. Different context budgets describe a system configuration comparison.

We propose one external comparator: **Mem0 OSS v2.0.20**, pinned to [9a7924befd7026e41e445ba809370009e5e985a6](https://github.com/mem0ai/mem0/commit/9a7924befd7026e41e445ba809370009e5e985a6). Oh and Mem0 will receive the same permitted source messages, chronology and date representation, and use the same calibrated reader and declared retrieval/context limits. We will publish extraction and embedding settings, ingestion cost, query cost, cold and amortized cost, storage and latency. SDK temporal parameters are unavailable in this OSS version, so the date convention must be explicit. This comparison will not be described as reproducing a managed Mem0 headline. The adapter and its accounting still require qualification. [Pinned SDK](https://raw.githubusercontent.com/mem0ai/mem0/9a7924befd7026e41e445ba809370009e5e985a6/mem0/memory/main.py).

We propose **BEAM** as a separate confirmation source. Before viewing evaluation outcomes, we will pin the [dataset revision](https://huggingface.co/datasets/Mohammadta/BEAM/commit/3205395e897e7318c7b094ef4e6047b9b82dbb03), record prior exposure, scan normalized histories and generation seeds for overlap, group related histories, and freeze an eligible confirmation manifest. The HF release contains 90 histories across three sizes; its 20-history small partition provides 400 questions, while all 90 provide 1,800. Eligibility and exact counts require acquisition checks. Message content and legitimate time anchors will be visible to memory systems; author plans, profiles, reference answers and rubric nuggets will remain outside their inputs. BEAM data is CC BY-SA 4.0 and its code is MIT. [Dataset card](https://huggingface.co/datasets/Mohammadta/BEAM/blob/main/README.md), [code license](https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/3e12035532eb85768f1a7cd779832b650c4b2ef9/LICENSE).

Finalists, comparator settings, the primary metric, aggregation, practical margin, resource limits, sample size and stopping rule will be fixed before confirmation. Analysis will preserve history clusters and account for the planned multiple comparisons. A proposed clear-win criterion is an absolute gain of at least five percentage points with simultaneous 95% paired confidence intervals above zero against the declared controls; this is our proposed decision rule, not a benchmark standard. Judge failures must not be able to reverse that conclusion under conservative missing-score assignments. Development scores will not support that claim.

LongMemEval development retains the original GPT-4o proxy scores. Separate Gateway native-rubric profiles use the pinned category prompts and contains-yes rule. The 10-token Gateway profile was rejected by the provider. Its separately identified 16-token adaptation has passed a real one-request qualification and completed the high-effort and wider-retrieval comparisons. Both remain alias routes and cannot be described as reproducing the pinned official evaluator. Exact official reproduction requires the native snapshot, messages and output settings. BEAM instead needs its category rubric: its released scorer calls per nugget, and event ordering adds equivalence calls. We will resolve or separately label the released scorer's integer truncation of half credit before unsealing; the paper describes 0/0.5/1 scoring. [BEAM paper](https://arxiv.org/html/2510.27246v2), [released scorer](https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/compute_metrics.py).

An exposed benchmark can remain useful for reproducible descriptive scores. High development performance alone will not be called benchmark saturation, fresh generalization or framework superiority.

## BEAM offline preparation

Updated 2026-09-10. The data-side sealing code for BEAM now exists offline;
no BEAM reader or judge call has been made, and none is scheduled. Under the
current budget policy every experiment is capped at $20 with GPT-5 nano or
GPT-5 mini readers only, and the sealed confirmation source is the LoCoMo test
split. BEAM's per-nugget judging alone exceeds that cap for its 400-question
partition, so BEAM stays a prepared, unfunded confirmation source until a
separate budget decision reopens it. Nothing below reads a BEAM outcome.

`DATASETS.beam` pins the Hugging Face revision `3205395e` as three parquet
parts (byte size and SHA-256 each) plus the canonical JSON re-encoding that the
loaders parse (`oh.beam-source-canonical.v1`, 285,187,170 bytes). Acquisition is
an explicit operator step that downloads about 106 MB and needs `python3` with
`pyarrow==21.0.0` (set `OH_BEAM_PYTHON` to that interpreter):

```sh
bun run bench:memory fetch --dataset beam
```

`parseBeam` sits next to `parseLocomo`. Memory systems receive only chat turns
with their session time anchors; author plans, user profiles, generation seeds,
narratives, planted-turn labels and every probing-question field stay outside
the corpus. Each history is one corpus, each probing question carries the last
session's anchor as its question date, abstention questions are unanswerable,
`source_chat_ids` become evidence turn identifiers, and the scorer-side object
(rubric nuggets and reference answers) travels only in the judge-side answer
field for a later BEAM scoring lane. The release repeats turn identifiers
inside some histories; evidence references map to every matching turn.

The exposure review (`scripts/benchmarks/beam-seal-cli.ts review`) writes
digests, counts and dispositions only: per history, the content digest, the
digests of its seed, profile, narratives, plan and planted user questions,
exact-turn and sampled word-8-gram overlap against the cached LongMemEval S
and LoCoMo releases, and the family it belongs to (histories sharing a seed,
profile or content are one family). Exact-turn matches gate eligibility (zero
allowed by default); sampled shingles are reported per matched reference
corpus and gate only under a declared bound, because a first offline pass on
the pinned files found no identical turn in any of the 90 histories but
template phrases shared with every LongMemEval S haystack. Operator-declared prior exposure, such as
the search preview that showed part of one history's profile scaffold, closes
the whole family and must be declared before any draw. The review's SHA-256 is
the `eligibilityAuditSha256` a sealed-confirmation scope references.

The family draw (`beam-seal-cli.ts draw`) reuses the existing cryptographic
partial Fisher–Yates method over the sealed families and records the pool,
its digest, the review digest, the drawn families and every selected question
identifier. Replay recomputes the pool from the current dataset and review and
fails on any change instead of drawing replacements. A future funded BEAM run
still needs the design-side seal (candidate source digest, non-droppable
controls, readers, judge profile, rubric digest, decision rule and sample size)
and the BEAM nugget-judge protocol before its first reader call.

## Full-history control and next memory experiments

The complete 100-question full-history control and all three fixed source-packing
mechanisms have now run. Their [results](EVOLUTION_RESULTS.md#focused-source-packing-mechanisms)
reject the three new excerpt policies as accuracy finalists. Full history scores
68/100 with nano and 84/100 with mini, versus 75/100 and 82/100 for matched BM25
96 KB. All 200 full-history responses completed with verified usage. Mini's
small increase costs about 5.4 times as much in reader usage.

The distinct [V3 contracts](EVOLUTION_PACKING_V3.md) authenticate complete source
membership and preserve existing V1 request identities. The model window is
reserved conservatively for financial admission; actual provider acceptance has
been measured, while tokenizer fit remains explicitly unqualified.

The high-effort nano experiment and wider-retrieval comparison are complete.
High-effort nano scored 78/100 with BM25 96 KB, 75/100 with focused Oh and
neighbors at 96 KB, and 65/100 with full history. Focused native Oh at 120/192 KB
scored 74/70 with low-effort nano and 70/67 with high effort; BM25 192 KB scored
71/75. These native-rubric results do not establish superiority. They motivate
separate generic answer-contract and source-selection experiments while
preserving every earlier outcome. The next fixed answer-contract comparison
uses low-effort nano and medium-effort mini against matched 96 KB contexts.

Native-rubric regrading of the original answers is also complete: BM25 96 KB
scores 77/83 with nano/mini, focused Oh with neighbors 71/82, and full history
69/85. No reader calls were repeated for these regrades. The small full-history
mini gain and all negative Oh comparisons remain part of the development record.
The next fixed matrix crosses two retrieval methods, two reader models and
four generic answer contracts on all 100 exposed questions. It measures explicit
abstention and instruction for combining facts independently and together.
All 1,600 logical reader cases are declared before dispatch. A separate successor
store makes these new physical comparison repeats; they do not replace any
earlier answer or add independent evaluation data. Two 24-request transport
qualifications precede expansion to concurrency 32, with answer failures retained
in the fixed denominator.

## Additional BEAM scorer qualification

Source-only characterization identified two further compatibility details: the
released reporter uses normalized Kendall tau for event ordering, and nugget
prompt construction leaves the question placeholder literal. Keep released
compatibility scores separate from a corrected half-credit reduction; inserting
the question changes prompt bytes and requires a separately named judge profile.
The reporter weights histories equally after within-history aggregation.
[Pinned reporter](https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/report_results.py),
[pinned scorer](https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/compute_metrics.py).

The numerical and parser differential gates now pass using the real pinned
SciPy 1.16.1, json_repair 0.44.1 and pandas 2.3.0 dependencies. Nine synthetic
test groups passed with no failures or skips. They include 1,856 expanded
SciPy event cases, 32 parser reply shapes across nine nugget categories, and
eight numeric reporting matrices. The
[scorer qualification](EVOLUTION_BEAM_SCORER.md) records exact versions,
source identities, coverage and remaining limits; its
[compact receipt](results/memory-evolution-beam-scorer-qualification-v1.json)
contains no dataset questions or answers.

The compatibility checks preserve non-finite Kendall tau for degenerate cases,
including a correct singleton. A live evaluation must declare how its finite,
failure-inclusive operational score differs from released compatibility output.
No BEAM dataset questions or answers were opened for this qualification, and no
provider calls were made. Data exposure and overlap review, exact category/history
joins, live judge identity, and an end-to-end baseline comparison remain open.
