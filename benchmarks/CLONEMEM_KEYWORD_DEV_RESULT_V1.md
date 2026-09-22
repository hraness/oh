# Keyword-query normalization did not pass the development test

Normalized keyword queries combined with semantic retrieval scored **67.35%**
answer accuracy, compared with **68.95%** for vector retrieval, on the fixed
CloneMem development population. The difference was **−1.60 percentage points**.
Recall@10 improved, but the candidate failed its answer-quality gate. It does
not advance to confirmation or change a default.

This coding-agent experiment completed on 2026-09-22. Model-generated answers
were scored by CloneMem's exact option-ID rule, with no model judge or human
grading. The [frozen protocol](CLONEMEM_KEYWORD_DEV_V1.md) remains unchanged.
The [complete aggregate result](results/memory-clonemem-keyword-dev-v1.json)
retains both arms, every persona and reader repeat, failures, context sizes,
model identities, token use and costs.

## What changed

The screen used all 146 questions from two personas selected by a fixed
identifier-only rule, containing 114 and 32 questions. Both personas and all
nine eligible personas had prior project exposure. The remaining seven were
reserved for a separate screen; they are not pristine holdout data. No question
was dropped for missing evidence or retrieval performance.

The baseline, `raw-vector`, returned the original top ten semantic results.
The candidate, `oh-hybrid-keywords-v1`, combined normalized lexical top-30
results with the same captured original-question semantic top 30. It used the
shipped fusion weights of two for lexical retrieval and one for semantic
retrieval, with reciprocal-rank constant 60, then returned ten whole traces.
The fixed English normalization removes common words, deduplicates tokens and
keeps the first 16 remaining tokens. It does not change the semantic query.
An offline probe selected this candidate before new reader answers were seen.

Both arms indexed only traces dated at or before the question time, before
candidate limits applied. Neither used gold choices or evidence labels during
retrieval. The native context renderer preserved whole traces without byte
truncation, within the same 96 KiB admission ceiling.

Each question had three separate reader attempts per arm. Primary accuracy
averages those three scored outcomes and then all 146 questions, preserving
the personas' unequal sizes.

| Scope | Vector retrieval | Normalized hybrid | Difference |
| --- | ---: | ---: | ---: |
| All 146 questions | 302 / 438 · 68.95% | 295 / 438 · 67.35% | −1.60 pp |
| Persona 1, 114 questions | 233 / 342 · 68.13% | 223 / 342 · 65.20% | −2.92 pp |
| Persona 2, 32 questions | 69 / 96 · 71.88% | 72 / 96 · 75.00% | +3.13 pp |

Across question-level means, the candidate improved 12 questions, regressed on
14 and tied on 120. Advancement required at least **+3 percentage points**
overall, no accuracy decline in either persona, strictly higher recall overall
and in each persona, complete responses and zero failures. Recall and
completion conditions passed; the pooled accuracy and first-persona conditions
failed. Individual repeats and secondary results cannot replace that decision.

Recall@10 rose from **12.05% to 15.17%**, a **+3.12-point** difference across all
146 evaluable questions. Both personas improved: 8.05% to 11.58% for the first
and 26.28% to 27.95% for the second. Recall uses the native flat union of gold
trace IDs, retaining future-dated gold labels in the denominator even though
future traces are unavailable to retrieval.

This is an unsuccessful development screen, not confirmed general harm from
keyword normalization. Two previously exposed personas do not support a
confirmatory confidence interval or a framework leaderboard claim. The recall
result supplies no substitute for the failed answer-quality gate.

## Model settings, context and cost

Both arms used the unchanged native single-user multiple-choice prompt and
Gateway `openai/gpt-4o-mini` alias, temperature 0.1 and a 512-token output limit.
OpenAI was the reported provider; no resolved immutable snapshot was supplied.
Scoring trims and uppercases the response, then requires exact equality to the
correct option ID. Gold keys entered only offline scoring after capture.

All **876 reader calls** completed, with no failed, refused, truncated,
unresolved or unattempted cases and no physical calls shared across arms.
All planned cases remain in the denominators.

The candidate used **20,934.99 context bytes** on average, compared with
**26,049.68** for vector retrieval: **19.63% fewer bytes**. Whole traces remained
intact. Reader charges were **$0.357401** for the candidate and **$0.431385** for
the baseline, an observed **17.15% reduction**. Context lengths and cached input
counts differed, so this is not an isolated estimate of the normalization's
cost effect or an accuracy-adjusted efficiency gain.

The study cost **$0.788786**. At closure, new spending in the task totaled
**$5.088931**, leaving **$19.911069** within its authorized $25 cap. Historical
research spending remains separately recorded.

## Verification and evidence

An independent coding-agent audit reparsed all 876 captured native responses
and checked frozen requests, answer digests, model identities, usage and
charges against the final receipt. A separate Python implementation parsed
the raw responses and independently reconstructed option-ID scores, all
persona and repeat slices, recall, context sizes, costs and the fixed gate
without importing the TypeScript scorer. Both passed and left the closed
database unchanged. The
[audit digest](results/memory-clonemem-keyword-dev-audit-v1.json) records their
hashes and scope. Neither audit made provider calls.

Measurement source was frozen at
`c23aacc43ec0b01eb5e7ac8c8b0e610dce1fbc48`. The public result is an unchanged copy
of the authenticated aggregate, with SHA-256
`c93256816a69c246a3d760bccf08a2e3a8ef40fc1715fc7e65264e6e6ad7ed25`.
Source text, questions, answers, gold keys, raw provider records and local paths
remain outside the repository. The earlier
[CloneMem transfer comparison](CLONEMEM_TRANSFER_V1.md) remains closed and
unchanged. CloneMem's pinned revision, license and upstream attribution are
recorded in the [source profile](profiles/clonemem-source-v1.json).
