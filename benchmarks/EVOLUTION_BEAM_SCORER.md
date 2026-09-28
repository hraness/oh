# BEAM scorer qualification — synthetic evidence

Checked 2026-09-09 against BEAM source commit `3e12035532eb85768f1a7cd779832b650c4b2ef9`. Nine offline test groups passed with no failures or skips using Python 3.12.14, SciPy 1.16.1, json_repair 0.44.1, NumPy 1.26.4 and pandas 2.3.0. Their four transitive dependencies also match the pinned upstream requirements. This is a scorer dependency subset; the complete BEAM environment was not installed. [Pinned requirements](https://github.com/mohammadtavakoli78/BEAM/blob/3e12035532eb85768f1a7cd779832b650c4b2ef9/requirements.txt).

The baseline suite checked 28 exact prompt renderings, 243 nugget reductions, 256 deterministic event traces, 24 reporting matrices, seven real SciPy edge cases and four real JSON-repair cases. The expanded suite compared 1,856 real SciPy event cases with the released scorer, including duplicates, aliases, missing events and empty lists; 32 reply shapes across nine nugget categories, yielding 288 matched accepted-or-rejected outcomes; and eight numeric reporting matrices using real pandas. Greedy alignment traces matched and stayed within the declared predicted-events × reference-events comparison bound. [Pinned scorer](https://github.com/mohammadtavakoli78/BEAM/blob/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/compute_metrics.py), [pinned reporter](https://github.com/mohammadtavakoli78/BEAM/blob/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/report_results.py).

The checks preserve released behavior that must be labeled in any future evaluation. Non-event reducers truncate numeric half-credit to zero. Nugget prompts retain an unreplaced question placeholder. Event reporting uses normalized Kendall tau, while a separate returned score multiplies tau by F1. [Pinned scorer](https://github.com/mohammadtavakoli78/BEAM/blob/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/evaluation/compute_metrics.py), [pinned prompt](https://github.com/mohammadtavakoli78/BEAM/blob/3e12035532eb85768f1a7cd779832b650c4b2ef9/src/prompts.py).

Real SciPy produced non-finite tau in 293 of the deliberately degenerate expanded fixtures, including a correct singleton. The compatibility suite preserves those NaNs; they are not a measured failure rate on BEAM. A future operational report must explicitly distinguish released output from any finite-score/failure policy. Corrected half-credit, a question-bound prompt, and changes to non-finite handling each require declared scoring semantics. pandas dataframe values were verified; Excel serialization was intercepted and remains unqualified.

No BEAM dataset files, questions or answers were opened, and no provider calls were made. These results establish bounded synthetic compatibility with specific scorer primitives. They provide no BEAM accuracy result, live judge qualification, end-to-end reproduction, freshness attestation or superiority claim. Dataset exposure review remains pending.

Evidence receipts: baseline `97b8d8a5b2b6e6f24200f20b995ec704a7779f1def0591112622513fcc94e3e9`; expanded `074fe8fd512038fbc5937a6543309786981149586d97a804b630a9ce36d7c425`; pinned environment `6ae5d2683bd0656aa3109f830010d90741d937210297c746abc6d6d6f0b3a3f0`. The accompanying compact JSON omits private paths and retains source and harness hashes.

## Released result panel

`scripts/benchmarks/beam-released-results-v1.ts` turns externally captured official evaluation values into the pinned reporter's per-category panel. A plan fixes every arm, history, question, repeat, request digest and score policy before any value exists. Event ordering reports `tau_norm`; the other nine categories report `llm_judge_score`. Questions average within each category and history, then histories carry equal weight. The result is ten columns per system, not one benchmark number. Repeats average within a question first, and event precision, recall, F1, `final_score` and judge score remain available as diagnostics.

Missing, unresolved, failed and non-finite cells are listed with their capture digests; none becomes zero or leaves a denominator. A category with no planned questions is reported as empty. The complete ten-column panel is returned only when every history has all ten categories and every value is finite. Changed request or score-policy digests, foreign or duplicate cells, category mismatches and finite values outside [0, 1] are rejected; the caller records such a capture as a failed cell. The released reporter reads each file's category scores in key order and labels them by position, so the projection keys values by category name instead.

The reporter averages histories with Python's builtin `sum`, which uses compensated summation from Python 3.12, and accumulates questions with sequential addition. The projection reproduces both. An invented parity check ran the unmodified pinned reporter (SHA-256 `1486a44fac721717c0a9373b32f4487c277d2bf28044cf28f649a6a74e692c96`) under Python 3.12.14, NumPy 1.26.4 and pandas 2.3.0 with Excel output intercepted. All 70 values across three scenarios matched bit for bit, including NaN propagation; sequential addition across histories would have changed 19 of the 50 finite values. This covers reporting only. Scorer model calls, prompts and parsing are not implemented here, and `BEAM_RELEASED_SCORER_PIN.endToEndScorerImplemented` remains false.

## Bounded transport profiles

The native request catalogue now includes three opt-in GPT-4o Gateway profiles:
`gpt4o-beam-event-extraction-v1` (1,024 output tokens),
`gpt4o-beam-event-equivalence-v1` (32), and `gpt4o-beam-nugget-v1`
(512). Extraction and nugget requests use one user message; equivalence uses
system and user messages. They use plain text transport at temperature zero,
preserve the native provider restriction, and reserve the complete input/output
bound before dispatch through the shared campaign store.

These profiles provide request, capture and accounting support. They do not
enable a BEAM experiment through the general benchmark CLI or provide an
end-to-end scorer. Gateway aliases and output limits are operational choices,
not evidence of matching the released model configuration. Live qualification,
dataset allocation and an explicitly bounded campaign remain separate steps.
All existing profile and request bytes remain unchanged.

## Opt-in reader deadline

`gpt5-mini-explicit-abstention-composition-long-deadline-v1-reader` uses a
600,000 ms transport deadline. Its request body, explicit-abstention/composition
instruction, GPT-5 mini medium reasoning, 8,192 output-token cap, prices and
context admission bounds match `gpt5-mini-explicit-abstention-composition-v1-reader`.
The existing reader retains its 120,000 ms deadline and remains the choice
returned by the base-reader/contract selector. Both conservative-input and
explicit profile-window requests retain their existing accounting rules.

The longer deadline has a distinct profile and request hash. Existing captured
responses and unresolved reservations keep their original identities and costs;
selecting this profile does not authorize retrying or replacing an earlier job.
Transport still captures the first response and performs no automatic retry.
An empty response at a deadline leaves provider outcome and billing uncertain,
so its full reservation remains held. The new profile is an operational option,
with no claim of live completion, better accuracy or production activation.

## Paired superiority analysis

`scripts/benchmarks/beam-paired-scores-v1.ts` decides whether one system beats another on released BEAM scores. Its plan is frozen before any score exists and names the released-results plan it binds, the candidate and comparator, declared category weights, the independent families that partition the histories, the resample count, seed, alpha and a superiority margin. The analysis rebuilds the category panel from the plan and observations rather than trusting a supplied panel.

Each history's score is the weighted mean of its category means; histories average within their family, and families carry equal weight. The estimate is the mean candidate-minus-comparator difference over families. A seeded bootstrap resamples whole families, keeping every history, category and repeat of a family together, and the result is "superior" only when the one-sided lower bound at alpha exceeds the margin. A one-sided sign-flip test on the family differences, exact up to 20 families and seeded Monte Carlo above, is reported as a sensitivity check along with whether it agrees. Per-category differences are descriptive and belong to no test.

An incomplete panel, a non-finite category mean, or a declared category missing from a history blocks the decision with its reasons. Nothing is dropped, renormalized or set to zero. The released equal-history panels are reported separately. This module computes no scores and makes no provider calls.
