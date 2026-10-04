# Oh north star: memory that can be traced and corrected

Status: proposed product direction, 2026-10-04. Drafted by Devin; independent design review and implementation are pending.

Oh should let an agent recover the evidence behind an earlier answer, understand what changed, and use the corrected information in later work. A short summary should help it find the right material without replacing the original or deciding what enters reviewed memory.

The product's [record and operation model](../README.md#how-oh-behaves) supplies the starting point. This document sets the next direction and the evidence needed to adopt it. It does not claim that hierarchical summaries improve Oh's reader results.

## Start from the memory Oh has

Oh stores versioned records and an append-only history of accepted operations. The default store is local SQLite. Keyword and optional semantic indexes are derived from records and checked against their content digests before a result is returned.

The [memory interface](working-memory.md) separates an agent's working store from a reviewed store pinned at a particular head, meaning one point in its operation history. The agent can remember, query, explain, and nominate. Only trusted application code can move the reviewed pin or adopt a nomination. A logical query identifies the origin of its premises; a proof shows a derivation from those premises, not that they are true outside the store.

[Memory pages](memory-pages.md) provide readable Markdown with source references and a reference to a host-written attestation. They can round-trip through `.oh.md` files. Parsing a page does not establish that the attestation exists or that its prose is correct. None of these interfaces supplies an automatic chronological summary tree.

## Add a small overview with a path back to the original

[OptMem](https://github.com/VictorTaelin/OptMem) demonstrates a useful reading pattern: an append-only note log, recent notes shown in detail, older ranges summarized in a binary tree, and expansion or exact search when detail is needed. The relevant reference is [its implementation at `1fb164c`](https://github.com/VictorTaelin/OptMem/blob/1fb164cf39028047781f72ac3bb1e5a691c1dcb0/memo). Its structural tests use a fake compressor; they do not establish better answer quality.

Oh should borrow progressive detail as an optional view over its own records:

- An overview identifies the store binding, captured head, permitted source selection, recent events, unresolved decisions, and older summary ranges.
- Expanding a range returns its children or the original records with their keys and digests. Exact search remains available even when a summary omitted the fact being sought.
- Pages keep the same captured head and summary generation. Concurrent writes cannot shift the meaning of a continuation.
- Changing the reading allowance selects a different view. It does not rewrite records, change retention, or require every summary to be recomputed.
- Missing or invalid summaries produce addressable raw ranges or an explicit incomplete result. Reading never writes a summary or calls a model.

The operation sequence establishes chronology. A record digest identifies content; it is not a timestamp or permission to read. A source key alone is insufficient when the record at that key has changed.

Recency is one allocation rule. An old constraint, a later correction, or a rare piece of counterevidence can matter more than a recent note. Protect selected constraints and unresolved items, and compare query-directed expansion with chronology-only views before choosing a default.

## Keep summaries apart from reviewed knowledge

A generated summary is a reading aid. Its lineage must name the original source records, captured heads, generation, and the summarizer configuration. That metadata belongs in an additive profile or a separate record, not new fields inserted into the existing memory-page format.

Summary work should be an explicit application operation with an idempotent identity and a finite allowance. The application records the model's returned bytes and the work spent creating and repairing them. Rebuilding a cache cannot silently adopt a nomination, move a reviewed pin, or turn prose into a premise of a logical query.

A correction preserves the prior accepted history and creates a new current record through Oh's ordinary write rules. Derivatives that depend on the superseded record are invalidated. A historical view can remain useful for explaining an old decision, but it must not present old support as current support.

Scope applies to the summary body as well as its citations. A summary made from more sources than an agent may read cannot be shared with that agent by hiding references. Purged working memory, revoked access, and unavailable source history also make their derived summaries unavailable. The application chooses retention; Oh should not promise that every source is kept forever.

## Preserve the division of responsibilities

Oh owns records, accepted operation history, reviewed/working memory composition, and source-based derivations. A host owns source selection, permissions, retention, model execution, summary policy, and adoption. ALGAL can run that host's limited procedures and record their execution; Excalibur (xcb) can provide model access while keeping account credentials and running processes outside the memory store.

These are composable interfaces, not a requirement to install a second runtime or database. Oh's base package remains useful without a model, embedding service, or ALGAL dependency. Wordcell's Markdown vault remains authoritative when it uses Oh as a rebuildable graph. The current local Sponge uses ALGAL for application memory; the earlier Sponge Library's Oh store is a separate integration, not an automatic migration target.

## Measure later use, not the amount saved

The comparison must intentionally acquire history before testing later unseen questions. A fresh empty store cannot establish the benefit of memory. Freeze the source histories, source-family split, reader, evaluator, context allowance, and total work allowance before evaluation.

Compare recent raw history, ordinary keyword or semantic retrieval, a chronological summary tree, and a tree with query-directed expansion. Include memory off as a baseline where it answers the same task, and keep a larger full-history reader as a separately labeled diagnostic. Charge ingestion, summary creation, repairs, retrieval, failed calls, and judging; extra preprocessing is not free.

| Question | Evidence required |
| --- | --- |
| Can a reader recover the original? | Byte-identical expansion and source search under the captured head, including Unicode and concurrent writes |
| Can it use a correction? | Later answers prefer applicable corrected evidence; stale-belief persistence and conflict handling are measured separately |
| Does less context help? | Matched later-question quality and source support, with fresh confirmation rather than evidence recall alone |
| Is maintenance affordable? | Overview and expansion latency, storage growth, summary backlog, rebuild work, and total cost per useful later answer |
| Is it scoped correctly? | No cross-realm, cross-store, narrower-grant, or purged-working-memory disclosure, including cached summary bodies |

A smaller prompt or a faster lookup does not establish lower provider usage or billing. A verified operation history does not establish answer quality. The [benchmark guide](../benchmarks/README.md) separates state correctness, evidence retrieval, reader results, and the exposure limits of prior studies.

## Delivery order

| Increment | Outcome | Exit condition |
| --- | --- | --- |
| Source/view protocol | Captured-head identity, source ordering, node lineage, explicit limits, and failure states | Strict parsing, negative vectors, and source permission tests without a provider |
| Deterministic reader | Overview, expansion, and bounded exact search over scripted summaries | Original bytes recovered; writes, pin changes, missing cache, and altered budgets do not corrupt a captured view |
| Optional maintenance | Explicit summary jobs and invalidation through the host | No model work on reads; duplicate, interruption, conflict, and purge cases preserve existing memory rules |
| Consumer pilot | One application uses the adapter through an immutable dependency pin | Existing memory-page, store, Node/Bun, and packed-package interfaces pass their normal checks |
| Adoption decision | A frozen policy is compared on later unseen work | Fresh quality/correction evidence, complete cost accounting, independent review, and a tested return to the prior reader |

The first increment needs no ontology rewrite, provider service, or storage migration. Keep the feature optional until the later-use comparison passes; preserve rejected policies and failures alongside the selected one.
