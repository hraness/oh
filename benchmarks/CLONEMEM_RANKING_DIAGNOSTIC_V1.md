# CloneMem ranking diagnostics: one rejected weight change

Equal lexical and semantic fusion weights improved pooled evidence-label recall,
but failed the fixed development rule because one persona regressed against the
existing normalized-query control. The candidate does not advance to paid answer
testing. A separate inspection found complementary annotated evidence in the
two candidate pools; it did not establish a better runtime ranking or answer
accuracy.

These coding-agent diagnostics completed on 2026-09-22 using the same **146
questions from two previously exposed development personas**, containing 114 and
32 questions. The other seven personas were unused here. No new model or provider
calls were made. The [closed keyword-query answer study](CLONEMEM_KEYWORD_DEV_RESULT_V1.md)
and its failed advancement decision remain unchanged.

## Equal weights failed the fixed rule

The sole change was lexical weight two to one, leaving semantic weight one,
reciprocal-rank constant 60 and tie ordering unchanged. Both normalized policies
used lexical top 30 and the same captured original-question semantic top 30,
then returned ten whole traces with the native renderer. Temporal eligibility
preceded indexing and candidate limits. The baseline and prior normalized-query
contexts reproduced exactly, including ranks, text, hashes and byte counts.

| Population | Vector top ten | Normalized 2:1 fusion | Normalized 1:1 fusion |
| --- | ---: | ---: | ---: |
| All 146 questions | 12.0453% | 15.1669% | 16.3072% |
| Persona 1, 114 questions | 8.0493% | 11.5789% | 13.1140% |
| Persona 2, 32 questions | 26.2811% | 27.9491% | 27.6826% |

The rule required strictly higher recall than **both controls, overall and in
each persona**. The 32-question persona lost **0.2665 percentage points** against
2:1 fusion, so the rule failed despite the pooled improvement. There was no
weight sweep, alternative candidate selection or paid answer allocation.

Equal weights restored 359 semantic-only top-ten positions across 121 questions.
Compared with 2:1 fusion, it had ten recall wins, six losses and 130 ties. Mean
context size rose from 20,934.99 to 23,502.53 bytes; the vector baseline averaged
26,049.68 bytes. These are whole-trace comparisons with variable context size,
not an equal-byte result or a measured latency improvement.

Ranking used no choices or gold labels. All 146 selections were saved before
the separate scorer artifact was read. An independent coding-agent review
recomputed the fusion, all contrasts, persona aggregates and failed decision
from the pinned artifacts.

## What the candidate pools contain

The follow-up diagnostic used gold trace identifiers to compute the best possible
annotated recall from up to ten traces in each frozen pool. This **gold-informed
oracle is a diagnostic**, unavailable to a runtime ranker. It is not an answer-
quality ceiling or evidence that a model can achieve the score.

| Frozen candidate pool | Mean top-ten annotated oracle recall | Questions with any annotated reference | Questions with all annotated references |
| --- | ---: | ---: | ---: |
| Semantic top 30 | 20.59% | 59 / 146 | 11 / 146 |
| Normalized lexical top 30 | 26.85% | 66 / 146 | 17 / 146 |
| Their union, at most 60 | 37.49% | 91 / 146 | 25 / 146 |

The union averaged 53.66 traces per question, totaling 7,834 query-trace pairs.
Lexical retrieval added 62 annotated references across 50 questions and supplied
at least one reference on 32 questions where the semantic pool had none. This
shows complementary label coverage, not proven answer sufficiency. The oracle
limits trace count only; it does not establish byte or token feasibility.

The annotation boundary matters: on the 55 questions whose union contained no
annotated reference, the existing vector reader still answered 108 of 165
attempts correctly, or 65.45%. Missing or equivalent annotations and inference
from the choices are possible explanations; this aggregate cannot distinguish
them. Observational slices of the closed answers cannot establish causal rescue
or harm. No confidence interval or confirmation claim is made for two exposed
development personas.

The diagnostic reopened the closed answer database only in immutable read-only
mode and reparsed all 876 existing responses. It reproduced the closed totals
without changing the database, made no new retrievals and selected no candidate.
Independent review checked 6,181 arithmetic comparisons, including every pool,
persona and answer stratum. This diagnostic does not report a reranker result.

## Recorded evidence

The reviewed source artifacts are identified below. Full selection and
diagnostic rows remain private because they contain question and gold-reference
identifiers; this page publishes aggregate findings only.

- Balanced-fusion result: `1673f3311973feca5d741034e8a71a549281b37fc5b46a1203bbca075fdaa0dd`
- Balanced-fusion independent review: `8246626821ba07e49c34e07f9c3bb44abf19ee8f1e885186f14f932cecae1c5a`
- Candidate selections saved before scoring: `68185716ecc7cde0ef6e38da818454af27e80854ed8d216a3b26f04a48886832`
- Candidate-pool diagnostic result: `443aaee57488c67a364c227843990de6577ae15ac85b70991c930065b058431a`
- Candidate-pool independent review: `863cc0662e625515beb29bdf3e99382073ec583961ccc1729b00a0f04ee8570b`

CloneMem's pinned source, license and upstream attribution are recorded in the
[source profile](profiles/clonemem-source-v1.json). These are automated research
diagnostics, not human validation, a framework leaderboard result or a change
to Oh's defaults.
