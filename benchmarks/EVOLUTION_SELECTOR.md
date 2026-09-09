# Oh source ID selector prototype

This is an offline implementation of query-conditioned selection from Oh's native
focused top100 source pool. A cheap model chooses opaque turn aliases. The final
memory contains only unchanged, dated source turns from that pool. It does not
extract, summarize, rewrite, or generate memory facts.

The prototype has no CLI or provider dispatcher. It does not alter
production Oh, an existing retrieval/result protocol, a reader prompt, or any
active experiment. No real benchmark or provider calls were made for this artifact.

## Fixed experiment

The source pool is the existing complete `OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT`:
Oh focused native keyword search, top100, a 4,000,000-byte offline pool bound, and
zero pool omissions. The caller supplies the authenticated pool result digest
from its pinned prepared context plan. The source factory checks that digest,
query identity, current canonical records, exact source text, and pool policy.
It does not independently establish that a search operation produced that pool.

One existing `gpt5-nano-reader` request at low reasoning effort performs the
selection. Its role is explicitly `source-selection`, with a separate versioned
selector plan. It is not an answer-reader case even though it reuses that closed
model profile and its current prices, routing, output cap, and conservative input
accounting. Changing the system prompt creates a different immutable request.

The model sees the question/date and each full source turn's opaque alias, opaque
session-occurrence alias, date, speaker, original text, and rendered byte count.
Gold labels, answers, task categories, and scorer prompts are not inputs. The
response must contain only `{"ids":["s000", "s003"]}` or an empty list. At most
32 unique supplied aliases are accepted. Extra keys, duplicate keys, escapes,
unknown IDs, markdown, explanations, and generated text fail validation.

A complete pool whose selector body exceeds 262,144 UTF-8 bytes is rejected without
truncation. The final context has a fixed 48,000-byte cap. Selected turns are
considered in the model's priority order, packed atomically including source
headers and two-newline separators, and rendered in original corpus order. Every
selected turn that does not fit is listed in `omittedAliasesForBudget`. Empty
selection or no fitting selection yields an explicit empty source context. There
is no silent fallback and no selected text is clipped.

This experiment can test whether query-conditioned removal of distractors helps
the final reader. Source-session coverage alone cannot establish that the chosen
turns contain an answer. Selection errors, lost necessary context, budget omissions,
invalid JSON, and selector latency/cost can all make it worse.

## API and custody

`prepareOhSourceSelector(corpus)` whitelists and detaches the source fields once,
constructing one reusable current-source validator. Its methods are:

- `makePlan(question, pool, expectedPoolResultSha256)` builds the fixed immutable
  request, aliases, source digests, one-call limit and reservation.
- `validatePlan(question, pool, expectedPoolResultSha256, plan)` rebuilds the entire
  plan from current source inputs. A resealed request, changed question date,
  different source corpus or different pool cannot silently replace it.
- `reconstruct(question, pool, expectedPoolResultSha256, plan, raw, response)`
  reparses exact model-response bytes, compares the supplied parsed response,
  requires completed status, parses the alias list, and rebuilds source context.
- `validateResult(...)` repeats that derivation and compares the complete result,
  including source/provenance lists, packing omissions, bytes and identities.

The result uses `oh.memory.selected-source-context.v1-prototype`, distinct from
whole-turn retrieval, source spans, and generated-memory results. It binds the
selector plan, current source/pool identity, question/date, selected aliases,
retained aliases, canonical source-record digests and captured-response digest.

Raw bytes must come from `store.readRaw(plan.request)` after obtaining the exact
finalized first response from the existing canonical store. Re-parsing arbitrary
caller-supplied bytes does not prove provider or HTTP/capture custody. This pure
module deliberately does not manufacture that authority. The focused fixture
exercises actual isolated store admission, capture, finalize, authenticated raw
readback and reopen; it makes no provider calls.

## Integration boundary

The selector is not yet wired into the benchmark CLI. Before a real experiment:

1. Add this as a separate selector plan/phase, with exact config, source, pool,
   model-profile and execution-code pins. Include its module in the source manifest.
   Load only the already-authorized source projection; keep the evidence scorer
   separate. Reuse each prepared source factory and one pool per question.
2. Execute through existing `invokeEvolutionRequest` and the same canonical campaign
   store/credential authorization. Set a shared explicit financial cap and at most
   one newly occupied selector request per planned question. Do not create another
   allowance, ignore selector costs, or retry an occupied response. Planned maximum
   reservation is the sum of the exact prepared request reservations.
3. Require store-authenticated first responses before source reconstruction. Invalid,
   truncated, refused, missing or unknown selections remain counted failures, with
   captured cost or the full unresolved reservation retained. There is no automatic
   repair call. Stop on systematic provider rejection and drain admitted work.
4. Introduce an explicit context-case union member for selected sources, with source
   validation that receives the current corpus, authenticated pool and captured
   selector response. Do not masquerade it as existing V1 whole-turn retrieval.
   Existing plans and caches remain immutable; regenerate new source-bound plans.
5. Reuse the selected context across reader model/effort arms. Charge the selector
   once per distinct occupied request; report selector plus reader/judge cost and
   end-to-end latency separately from cache reuse. Preserve request/profile hashes
   and all previously occupied captures.
6. Compare the same complete paired development selection with the existing native
   pool/whole-turn controls under the same reader, answer contract and judge. Keep
   the corpus-level confirmation boundary closed. This prototype has no measured
   accuracy benefit, provider qualification or throughput claim.

## Focused checks

Run the focused test from the repository root:

```sh
bun test tests/memory-benchmark-evolution-selector.test.ts
```

The tests cover actual native-pool preparation, exact dated text and occurrence
metadata, gold-shaped getter isolation, frozen prepared reuse, strict ID grammar,
resealed source/plan/context defenses, raw-response identity, truncated output,
empty output, atomic byte packing, complete-pool input limits, and isolated
one-charge store replay. No dataset files, live campaign store, or credentials are
opened. The execution source manifest must include the selector and its unchanged dependencies.
