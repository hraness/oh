# Proposed next evaluation method

Draft for a future public methods section. Prepared 2026-09-09; these are planned checks, not completed qualification or superiority results.

Our current LongMemEval experiments use an exposed 100-question development selection spanning 94 declared families. The 24-question calibration is a balanced subset of that selection. Additional reader calls, variants and cached answers do not add independent questions or histories. The earlier frozen and reserved studies remain closed. We will report paired development differences with the reader fixed, retain reader and judge failures in the denominator, and distinguish changes in memory implementation from changes in context allowance. Different context budgets describe a system configuration comparison.

We propose one external comparator: **Mem0 OSS v2.0.20**, pinned to [9a7924befd7026e41e445ba809370009e5e985a6](https://github.com/mem0ai/mem0/commit/9a7924befd7026e41e445ba809370009e5e985a6). Oh and Mem0 will receive the same permitted source messages, chronology and date representation, and use the same calibrated reader and declared retrieval/context limits. We will publish extraction and embedding settings, ingestion cost, query cost, cold and amortized cost, storage and latency. SDK temporal parameters are unavailable in this OSS version, so the date convention must be explicit. This comparison will not be described as reproducing a managed Mem0 headline. The adapter and its accounting still require qualification. [Pinned SDK](https://raw.githubusercontent.com/mem0ai/mem0/9a7924befd7026e41e445ba809370009e5e985a6/mem0/memory/main.py).

We propose **BEAM** as a separate confirmation source. Before viewing evaluation outcomes, we will pin the [dataset revision](https://huggingface.co/datasets/Mohammadta/BEAM/commit/3205395e897e7318c7b094ef4e6047b9b82dbb03), record prior exposure, scan normalized histories and generation seeds for overlap, group related histories, and freeze an eligible confirmation manifest. The HF release contains 90 histories across three sizes; its 20-history small partition provides 400 questions, while all 90 provide 1,800. Eligibility and exact counts require acquisition checks. Message content and legitimate time anchors will be visible to memory systems; author plans, profiles, reference answers and rubric nuggets will remain outside their inputs. BEAM data is CC BY-SA 4.0 and its code is MIT. [Dataset card](https://huggingface.co/datasets/Mohammadta/BEAM/blob/main/README.md), [code license](https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/3e12035532eb85768f1a7cd779832b650c4b2ef9/LICENSE).

Finalists, comparator settings, the primary metric, aggregation, practical margin, resource limits, sample size and stopping rule will be fixed before confirmation. Analysis will preserve history clusters and account for the planned multiple comparisons. A proposed clear-win criterion is an absolute gain of at least five percentage points with simultaneous 95% paired confidence intervals above zero against the declared controls; this is our proposed decision rule, not a benchmark standard. Judge failures must not be able to reverse that conclusion under conservative missing-score assignments. Development scores will not support that claim.

For LongMemEval development, the existing short GPT-4o proxy judge and exact-request caching are sufficient until a cheaper judge demonstrates useful agreement; adding another unqualified judge would introduce another source of error. Reportable native LongMemEval results require its pinned official judge protocol. BEAM instead needs its category rubric: its released scorer calls per nugget, and event ordering adds equivalence calls. We will resolve or separately label the released scorer's integer truncation of half credit before unsealing; the paper describes 0/0.5/1 scoring. [BEAM paper](https://arxiv.org/html/2510.27246v2), [released scorer](https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/compute_metrics.py).

An exposed benchmark can remain useful for reproducible descriptive scores. High development performance alone will not be called benchmark saturation, fresh generalization or framework superiority.

## Full-history control and next memory experiments

A source-only sizing audit matched all 100 exposed source projections and the
legacy full-history renderer. The histories contain 409–616 turns, with median
rendered length 514,950 bytes. All are rejected by the current nano/mini
constructor's conservative JSON-byte input bound. These are byte measurements;
no tokenizer count or full-history answer was measured. The
[sizing receipt](results/memory-evolution-full-history-sizing-v1.json) records
source pins, completeness, distributions and zero provider calls.

The next full-history control must include every source turn in source order,
with an explicit all-source contract and exact membership validation. It must
not be represented as a top100 retrieval result. Keep the answer prompt and
reader settings matched. A pinned local tokenizer can estimate token fit, while
financial admission conservatively reserves the full model window until that
estimate is qualified. Preserve existing V1 request identities. Two readers'
full-history message arrays already total about 101 MiB before plan metadata,
so begin with full history plus one locked retrieval control and validate the
128 MiB plan bound before dispatch.

The first source-excerpt policy failed to improve accuracy. The next fixed
mechanism candidates are a focused native source pool, contiguous continuation
within a source turn, and source-diverse packing. Compare focusing against the
existing pool, then continuation and diversity against the focused control at
48 KB with nano fixed. Preserve V1 policies and reports; these new hypotheses
have no measured answer fitness. Source completeness and provenance checks must
pass before they enter a separately pinned reader experiment.

## Additional BEAM scorer qualification

Source-only characterization identified two further compatibility details: the
released reporter uses normalized Kendall tau for event ordering, and nugget
prompt construction leaves the question placeholder literal. Keep released
compatibility scores separate from a corrected half-credit reduction; inserting
the question changes prompt bytes and requires a separately named judge profile.
The reporter weights histories equally after within-history aggregation.
[Pinned reporter](https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/report_results.py),
[pinned scorer](https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/compute_metrics.py).

Private synthetic qualification covered 28 exact prompt cases, 243 nugget
reductions, 256 greedy event traces/rank reductions and 24 reporter matrices.
These are bounded source-characterization checks, not full numerical or parser
parity. The pinned SciPy 1.16.1 and json-repair 0.44.1 differential gates remain
unrun. Before live BEAM scoring, qualify those gates, exact category/history
joins, failed-score handling and a bound on event-equivalence calls. Reuse one
captured judgment set for deterministic reductions; do not buy duplicate calls
merely to report both reductions. No BEAM dataset questions or answers were
opened during this source work.
