# Semantic nano development diagnosis

The frozen semantic nano reader scored **82/100** on the repeatedly used development selection. Its 18 errors comprise nine multi-session, four temporal, three knowledge-update and two preference questions. All seven designated abstention questions passed; no reader, judge or transport failure accounts for these 18 errors.

Seventeen errors include every annotated evidence turn, and all eighteen include every annotated session. Across all questions, 93/94 with turn annotations have complete annotated-turn coverage; 76/93 were answered correctly. Annotations are an incomplete diagnostic proxy: inclusion does not establish that every necessary fact is present or internally consistent.

Retrospective manual review assigned one primary hypothesis per error:

| Hypothesis | Errors |
|---|---:|
| Answer construction with annotated evidence present | 11 |
| Missing annotated fact | 1 |
| Grading, timestamp or precision conflict | 6 |

The eleven construction cases concern set enumeration (3), event-date/duration/order operations (4), preferences or advice (2), source attribution (1), and old/new state construction (1). These are hypotheses, not causal findings. The six ambiguous cases retain their original incorrect grades, as does every other error.

The mini reader with explicit abstention answered ten of these eighteen cases correctly, while losing two nano successes: 90 versus 82 overall. This changes both model and prompt. It supports testing the reader pipeline; it does not isolate a model effect.

| Same nano and answer contract | Score | Semantic parent's paired wins / losses |
|---|---:|---:|
| Semantic parent | 82 | — |
| BM25 window | 78 | 9 / 5 |
| Focused native retrieval | 81 | 6 / 5 |
| Opening-turn completion | 76 | 11 / 5 |
| Hybrid retrieval | 73 | 14 / 5 |
| Protected lexical completion, 120KB | 74 | 12 / 4 |
| Protected semantic completion, 120KB | 76 | 10 / 4 |
| Same semantic turns in source order | 76 | 9 / 3 |

All rows use the same 100 questions; completion also changes the context budget. Earlier raw-span experiments used different reader/judge protocols and did not expose a validated intermediate fact representation. The prior whole-turn ID selector had no completed accuracy artifact in the inspected output location, so it is not evidence of a failed accuracy experiment.

The next proposed mechanism is explicit, source-validated quote extraction before answering, followed by a separate test of deterministic operations over those quotes. The existing composition prompt already asks for dates, sets, arithmetic, state and preferences internally. These two arms make the intermediate representation inspectable; they do not add another retrieval pass.

The [aggregate evidence](memory-evolution-semantic-error-diagnosis-100-v1.json) contains counts and artifact hashes only. It relies on previously authenticated stage artifacts, not a new raw-provider audit. The judge uses the native prompt/reduction through an unpinned Gateway alias with a 16-token cap, not the official pinned 10-token configuration. This adaptive development diagnosis makes no untouched-confirmation or superiority claim. The frozen full500 study is unchanged.
