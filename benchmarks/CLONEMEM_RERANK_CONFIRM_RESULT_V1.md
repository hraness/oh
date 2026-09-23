# Local reranker passed the reserved-persona confirmation screen

Reranking the frozen lexical-semantic candidate union with a pinned local
Qwen3 reranker scored **77.82%** answer accuracy, compared with **70.54%**
for vector retrieval, on the fixed CloneMem reserved population: all 861
questions from the seven reserved personas, three independent reader
attempts each, **5,166** completed cases. The pooled difference was
**+7.28 percentage points**, with a persona-cluster bootstrap 95% lower
bound of **+4.61 points**, and recall@10 up **+18.32 points**. The
candidate passed every numeric condition of the initially declared gate on
the complete-campaign matrix. The campaign retry and inclusion rule was added
during execution; the [dated audit](CLONEMEM_RERANK_CONFIRM_AUDIT_V2.md)
records that amendment and sensitivity analyses including the failed captures.

This coding-agent experiment completed on 2026-09-23. Model-generated
answers were scored by CloneMem's exact option-ID rule, with no model
judge or human grading. The [protocol](CLONEMEM_RERANK_CONFIRM_V1.md)
retains the original hypotheses and numeric thresholds with the documented
retry amendment. The [complete pooled result](results/memory-clonemem-rerank-confirm-v1.json)
retains every persona, group, cost, audit linkage and qualification.

## What changed

The screen used all 861 questions from the seven personas reserved out of
the earlier development work — three sequential persona-group campaigns
because the shared paired-memory framework bounds one campaign at 300
questions and 1,800 calls. All seven personas, and all nine eligible
personas in the population, had prior project exposure; this is not a
pristine holdout. No question was dropped for missing evidence or
retrieval performance.

The baseline, `raw-vector`, returned the original top ten semantic
results. The candidate, `oh-union-qwen3-rerank-v1`, reranked the union of
the normalized lexical top 30 and the same original-question semantic top
30 — at most 60 whole traces per question, 45,392 pairs in total — with
the pinned Qwen3-Reranker-0.6B Q8_0 GGUF model through QMD 2.5.3 on a
4,096-token context, then returned the top ten. The query was the
unchanged original question stem; the document was the rendered
single-trace evidence text. A closed free probe passed its fixed recall
gate on the same 861 questions before any reader calls were made. Local
inference ran entirely before this screen and made no provider calls.

Both arms indexed only traces dated at or before the question time,
before candidate limits applied. Neither used gold choices or evidence
labels during retrieval or reranking. The native context renderer
preserved whole traces without byte truncation, within the same 96 KiB
admission ceiling. Each question had three separate reader attempts per
arm; primary accuracy averages the three scored outcomes and then all
861 questions, preserving the personas' unequal sizes.

| Scope | Vector retrieval | Union + local rerank | Difference |
| --- | ---: | ---: | ---: |
| All 861 questions | 1,822 / 2,583 · 70.54% | 2,010 / 2,583 · 77.82% | +7.28 pp |
| Persona 1, 76 questions | 161 / 228 · 70.61% | 178 / 228 · 78.07% | +7.46 pp |
| Persona 2, 78 questions | 178 / 234 · 76.07% | 204 / 234 · 87.18% | +11.11 pp |
| Persona 3, 142 questions | 339 / 426 · 79.58% | 355 / 426 · 83.33% | +3.76 pp |
| Persona 4, 167 questions | 365 / 501 · 72.85% | 422 / 501 · 84.23% | +11.38 pp |
| Persona 5, 110 questions | 247 / 330 · 74.85% | 254 / 330 · 76.97% | +2.12 pp |
| Persona 6, 181 questions | 376 / 543 · 69.24% | 403 / 543 · 74.22% | +4.97 pp |
| Persona 7, 107 questions | 156 / 321 · 48.60% | 194 / 321 · 60.44% | +11.84 pp |

Across question-level means, the candidate improved 106 questions,
regressed on 30 and tied on 725.

## Confirmatory decision

The initially declared gate required, on the pooled 861-question matrix:

1. **Complete matrix** — all 5,166 responses completed; zero failed,
   refused, truncated, unresolved or unattempted cases. Passed.
2. **Pooled delta ≥ +3 points** — observed +7.28. Passed.
3. **95% persona-cluster bootstrap lower bound > 0** — 10,000 resamples of
   the seven personas with replacement (fixed seed from the frozen screen
   pin) gave a lower bound of +4.61 points. Passed.
4. **Nonnegative reader delta in every persona** — smallest +2.12. Passed.
5. **Positive recall@10 delta overall and in every persona** — pooled
   14.48% → 32.80%, +18.32 points; smallest persona +12.08. Passed.

The screen yields `confirmedImprovement: true`. The decision still sets
`externalFrameworkSuperiority: false` and `defaultChangeAuthorized:
false`: confirmation applies to this reserved population only, not a
leaderboard claim. The measured procedure shipped as the opt-in
`mode: "rerank"` SDK search path (`oh/rerank`, `OhQmdRerankBackendV1`);
Oh's default retrieval remains unchanged.

## Model settings, context and cost

Both arms used the unchanged native single-user multiple-choice prompt
and Gateway `openai/gpt-4o-mini` alias, temperature 0.1 and a 512-token
output limit. OpenAI was the reported provider; no resolved immutable
snapshot was supplied. Scoring trims and uppercases the response, then
requires exact equality to the correct option ID. Gold keys entered only
offline scoring after capture.

The candidate used **21,202 context bytes** on average, compared with
**27,199** for vector retrieval: **22.1% fewer bytes**, consistent with
the development screen's direction. Whole traces remained intact; the
reranker selected more relevant traces, not shorter ones. Reader calls
consumed 31.85M input tokens (0.73M cached) and 10.3K output tokens.

The three completed campaigns charged **$4.730960**. Two earlier group-A
campaign attempts halted on terminal provider failures — one HTTP 500
capture, one provider error envelope under HTTP 200 — and were closed,
  independently audited and replaced under the retry clause added during execution;
their **$2.282835** is reported as failed-run exposure, and their partial
matrices did not join the pooled decision. Total task exposure at closure
was **$12.876502** of the authorized $25; historical research spending
remains separately recorded. Local reranker inference carried no provider
charge.

## Execution incidents and accounting custody

Two events during execution are recorded for transparency:

- **Provider instability.** Two group-A attempts each died on a single
  terminal unresolved provider response (charged at full reservation,
  never retried in place). The protocol's retry clause covered closing
  and auditing each failed campaign and reconciling a fresh campaign
  identity under the same frozen inputs. Group A completed on its third
  attempt (`a3`); groups B and C completed first try.
- **External cleanup of session workdirs.** A system cleanup deleted the
  original repository clone and several historical accounting ledgers
  mid-run. All pinned ledger bytes were restored from the Time Machine
  backup and re-verified by SHA-256 before use. The committed result
  lineage was re-created identically and pushed; the
  `checkpointLineage` note in the public result records which launch
  checkpoints reference the pre-loss local history. Campaign C also
  consolidated three closed retry-campaign export ledgers into one
  ancestry pin (byte-identical events) to stay within the framework's
  32-ledger bound; the consolidation is recorded in its provenance.

Neither incident changed any question, response, score, charge or
decision input.

## Verification and evidence

Each campaign's native ledger was independently audited after closure:
all settled rows replayed against the frozen prepared packet, requests,
response envelopes, usage, charges, identities and transport metadata
verified, and database hashes confirmed unchanged with zero provider
calls. Audit receipts: a3 `c5e82cd4…`, b `329d3a03…`, c `0316b888…`,
plus the closed failed attempts a1 `37e1f4dc…` and a2 `b7dcf2a3…`.
Campaign database SHA-256s: a3 `67b73a02…`, b `a762c78e…`, c
`6b6ef899…`. The reranker model pin is SHA-256
`22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48`.

The public result's SHA-256 is
`7875476a0d7257f90739fb7ecef8e6b60b190f09ee74703bac60647934630358`; its
canonical pooled artifact digest is
`8c9f4f9476937657fba2cdb7580c6575df24ab125402c0264c9b8ec322db435e`.
Source text, questions, answers, gold keys, raw provider records and
local paths remain outside the repository. The earlier
[development screen](CLONEMEM_RERANK_DEV_RESULT_V1.md),
[keyword screen](CLONEMEM_KEYWORD_DEV_RESULT_V1.md) and
[ranking diagnostic](CLONEMEM_RANKING_DIAGNOSTIC_V1.md) remain closed and
unchanged. CloneMem's pinned revision, license and upstream attribution
are recorded in the [source profile](profiles/clonemem-source-v1.json).
