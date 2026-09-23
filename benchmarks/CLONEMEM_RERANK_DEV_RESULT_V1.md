# Local reranker passed the development answer-quality screen

Reranking the frozen lexical-semantic candidate union with a pinned local
Qwen3 reranker scored **78.77%** answer accuracy, compared with **68.72%** for
vector retrieval, on the fixed CloneMem development population. The difference
was **+10.05 percentage points** with recall@10 up **+13.61 points**. The
candidate passed every condition of its prespecified gate and advances to a
separately frozen confirmation on the seven reserved personas.

This coding-agent experiment completed on 2026-09-22. Model-generated answers
were scored by CloneMem's exact option-ID rule, with no model judge or human
grading. The [frozen protocol](CLONEMEM_RERANK_DEV_V1.md) remains unchanged.
The [complete aggregate result](results/memory-clonemem-rerank-dev-v1.json)
retains both arms, every persona and reader repeat, failures, context sizes,
model identities, token use and costs.

## What changed

The screen used all 146 questions from two personas selected by a fixed
identifier-only rule, containing 114 and 32 questions. Both personas and all
nine eligible personas had prior project exposure. The remaining seven were
reserved for a separate screen; they are not pristine holdout data. No question
was dropped for missing evidence or retrieval performance.

The baseline, `raw-vector`, returned the original top ten semantic results.
The candidate, `oh-union-qwen3-rerank-v1`, reranked the union of the normalized
lexical top 30 and the same original-question semantic top 30 — at most 60
whole traces per question, 7,834 pairs in total — with the pinned
Qwen3-Reranker-0.6B Q8_0 GGUF model through QMD 2.5.3 on a 4,096-token context,
then returned the top ten. The query was the unchanged original question stem;
the document was the rendered single-trace evidence text. A closed free probe
passed its fixed recall gate before any new reader calls were made. Local
inference ran entirely before this screen and made no provider calls.

Both arms indexed only traces dated at or before the question time, before
candidate limits applied. Neither used gold choices or evidence labels during
retrieval or reranking. The native context renderer preserved whole traces
without byte truncation, within the same 96 KiB admission ceiling.

Each question had three separate reader attempts per arm. Primary accuracy
averages those three scored outcomes and then all 146 questions, preserving
the personas' unequal sizes.

| Scope | Vector retrieval | Union + local rerank | Difference |
| --- | ---: | ---: | ---: |
| All 146 questions | 301 / 438 · 68.72% | 345 / 438 · 78.77% | +10.05 pp |
| Persona 1, 114 questions | 232 / 342 · 67.84% | 261 / 342 · 76.32% | +8.48 pp |
| Persona 2, 32 questions | 69 / 96 · 71.88% | 84 / 96 · 87.50% | +15.63 pp |

Across question-level means, the candidate improved 24 questions, regressed on
5 and tied on 117. Advancement required at least **+3 percentage points**
overall, no accuracy decline in either persona, strictly higher recall overall
and in each persona, complete responses and zero failures. Every condition
passed. Individual repeats and secondary results cannot replace that decision.

Recall@10 rose from **12.05% to 25.66%**, a **+13.61-point** difference across
all 146 evaluable questions. Both personas improved: 8.05% to 20.67% for the
first and 26.28% to 43.42% for the second. Recall uses the native flat union of
gold trace IDs, retaining future-dated gold labels in the denominator even
though future traces are unavailable to retrieval. The candidate recovered
roughly 68% of the 37.49-point union-oracle headroom measured in the
[ranking diagnostic](CLONEMEM_RANKING_DIAGNOSTIC_V1.md); that oracle is a
coverage bound, not an answer-quality ceiling.

This is a successful development screen, not a confirmed result. Two
previously exposed personas do not support a confirmatory confidence interval
or a framework leaderboard claim. The prespecified next step is a separately
frozen screen on the seven reserved personas; only that study can establish a
confirmed improvement, and no default changes before it.

## Model settings, context and cost

Both arms used the unchanged native single-user multiple-choice prompt and
Gateway `openai/gpt-4o-mini` alias, temperature 0.1 and a 512-token output
limit. OpenAI was the reported provider; no resolved immutable snapshot was
supplied. Scoring trims and uppercases the response, then requires exact
equality to the correct option ID. Gold keys entered only offline scoring
after capture.

All **876 reader calls** completed, with no failed, refused, truncated,
unresolved or unattempted cases and no physical calls shared across arms.
All planned cases remain in the denominators.

The candidate used **19,936.80 context bytes** on average, compared with
**26,049.68** for vector retrieval: **23.47% fewer bytes**. Whole traces
remained intact; the reranker selected more relevant traces, not shorter ones.
Reader charges were **$0.343190** for the candidate and **$0.430586** for the
baseline, an observed **20.30% reduction**. Local reranker inference carried no
provider charge; context lengths and cached input counts differed, so this is
not an isolated estimate of the reranker's cost effect or an
accuracy-adjusted efficiency gain.

The study cost **$0.773776**. At closure, new spending in the task totaled
**$5.862707**, leaving **$19.137293** within its authorized $25 cap. Historical
research spending remains separately recorded.

## Verification and evidence

An independent coding-agent audit reparsed all 876 captured native responses
and checked frozen requests, answer digests, model identities, usage and
charges against the final receipt. A separate Python implementation parsed
the raw responses and independently reconstructed option-ID scores, all
persona and repeat slices, recall, context sizes, costs and the fixed gate
without importing the TypeScript scorer. Both passed and left the closed
database unchanged. The
[audit digest](results/memory-clonemem-rerank-dev-audit-v1.json) records their
hashes and scope. Neither audit made provider calls.

Measurement source was frozen at
`c9ca9efc8c4c66d5e1c752209fa78c53462a7f16`. The public result is an unchanged copy
of the authenticated aggregate, with SHA-256
`eb27d1a410d2c5aadf1ecf101f4fec3de6c1fc1ddecddabb269751106b37cbcc`.
The reranker model pin is SHA-256
`22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48`.
Source text, questions, answers, gold keys, raw provider records and local
paths remain outside the repository. The earlier
[CloneMem keyword screen](CLONEMEM_KEYWORD_DEV_RESULT_V1.md) and
[ranking diagnostic](CLONEMEM_RANKING_DIAGNOSTIC_V1.md) remain closed and
unchanged. CloneMem's pinned revision, license and upstream attribution are
recorded in the [source profile](profiles/clonemem-source-v1.json).
