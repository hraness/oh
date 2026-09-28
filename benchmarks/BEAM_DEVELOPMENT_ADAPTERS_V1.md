# BEAM development adapter checks

The offline helpers repair evaluation and comparator boundaries before another
development run. Their tests contain invented text only and make no provider
calls. They establish adapter behavior, not benchmark accuracy or superiority.

`scripts/benchmarks/beam-evaluation.ts` defines a separately named custom binary
judge protocol, `oh.beam-custom-binary-judge.v2`. Its reference includes every
present explicit answer field (`ideal_response`, `ideal_answer`, `answer`,
`ideal_summary`, `expected_compliance`) plus the complete rubric. Structured
answer values remain structured JSON. Other scorer metadata stays out of the
prompt. Malformed references fail; malformed or missing verdicts remain
unresolved. Only a complete `yes` or `no`, ignoring case and surrounding
whitespace, resolves a verdict.

This is not the released BEAM scorer. The source commit and two source hashes
are pinned from the existing [synthetic qualification](EVOLUTION_BEAM_SCORER.md).
The exact upstream scorer and prompt files were unavailable in the inspected
local caches during this change, so no official nugget/event implementation was
reconstructed from prose. Official scoring, live model qualification and the
handling of released half-credit and non-finite event scores remain separate
work. Historical results retain their original scorer identity.

The same module binds a run to its complete declared configuration and every
exact request object. Resuming requires matching manifest, configuration and
request digests. Completion requires every distinct expected cell with its
matching identity and an explicit resolved status. Missing and unresolved cells
remain separate. A caller must write these manifests and outcomes durably using
exclusive creation and the existing reservation/accounting store; the pure
helpers do not provide a journal or authorize retrying uncertain calls.

`scripts/benchmarks/beam-supermemory.ts` accepts the existing answer-free
framework source projection. It produces one complete, ordered document per
session with an explicitly bound provider date. It reuses the framework pilot's
declared search profile and evidence shape. Session identity, full text and
content digest stay in the document map; IDs are never guessed from suffixes.

Query construction and response parsing require a complete accepted-document
map and authenticated GET observations showing both document processing and
memory generation as `done` for every session. Failed documents, incomplete
dreaming, missing observations, ambiguous IDs and mismatched source echoes fail.
Search parsing preserves each generated memory or chunk and every mapped source
reference. An unmapped result fails the retrieval; a genuinely empty response is
reported as empty. Rendering keeps generated content verbatim and performs no
context clipping.

These pure helpers do not qualify a live Supermemory transport, session format,
provider spending, namespace ownership, cleanup or final cost. The later
per-unit framework helper remains a separate experimental profile. A live owner
must retain the existing bounded request journal, fresh-scope checks and cleanup
rules when connecting this session projection.

`scripts/benchmarks/oh-author-log-context.ts` builds the author-log reader
context from source control. The 100K development arm that produced the
115/380 result built it in a private script from lists that were already cut to
96,000 bytes, and it passed the outer session number as the turn order. This
builder fuses the native lexical and optional vector ranks before any cut,
follows each anchor with its same-session neighbors and explicit sources, and
renders `renderOhAuthorLogV1` under one declared byte budget with numeric
session and turn order. Its defaults match the historical renderer budgets of
180,000, 96,000 and 24,000 bytes. A different budget scales the retrieved and
reserve budgets in the same proportions unless they are set explicitly.

At 500K and 1M tokens a user's complete log no longer fits that budget. The
renderer then keeps the user messages the ranking puts first, fills the rest by
recency and labels the log partial; an invented 1.2 MB history rendered in about
0.3 seconds per question with 340 of 1,500 user messages kept. A smaller budget
on the exposed 100K histories reproduces that partial regime for development
without opening longer histories. The builder makes no provider calls, and this
change measures no benchmark accuracy.

Run the focused synthetic checks with:

```sh
bun test ./tests/memory-benchmark-beam-evaluation.test.ts ./tests/memory-benchmark-beam-supermemory.test.ts ./tests/memory-benchmark-oh-author-log-context.test.ts
```
