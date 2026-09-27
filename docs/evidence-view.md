# Evidence views

This experimental view keeps raw records alongside date expressions and caller-supplied, source-quoted relationships. It performs no model calls or store writes. Date expressions in a conversation are annotations; associating a date with a particular event still requires an explicit pointer.

## Frozen development scenarios

These invented scenario families were fixed before implementation on 2026-09-27. They use no benchmark questions, answers, labels, or source conversations. The author is the Codex evidence-view implementation agent. An independent evaluation agent reviewed the implementation and confirmed repairs preventing future links from changing historical components and non-event mentions from establishing event order. The focused receipt is `bun test src/evidence-view.test.ts`: 20 tests and 132 assertions passed on Bun 1.3.14. Repository-wide validation remains the integration owner's responsibility.

- Mira schedules a telescope visit, cancels it, and later reactivates it. Explicit source-quoted links change the current state while preserving earlier states for queries about what was known earlier.
- A second correction competes with the first. Both remain visible and the view reports an unresolved branch.
- A suggestion names the same place as a plan. Shared wording alone creates no adoption, replacement, or event identity.
- Repeat a mention of one visit and connect the mentions with an explicit same-event link. The identity group stays the same. A second explicitly distinct visit stays separate. Unlinked mentions do not establish a count.
- Remove the only source of a statement, replace its digest, or alter its quote. The statement becomes unsupported and cannot drive an ordering or current-state result.
- Move the statement date independently of a quoted absolute event date. Only the statement-time result changes. Relative dates continue to resolve against their own statement's date.
- Compare disjoint intervals, overlapping intervals, multiple date expressions, and an unknown date. Only disjoint supported intervals establish order without an explicit link.
- Add an unrelated record, permute record storage, include assistant-only evidence, and vary Unicode quotation bytes. Supported results and attribution remain unchanged.
- Supply ambiguous, missing, cyclic, or contradictory links. Preserve the sources and report uncertainty instead of inventing a total order.
- Render at several byte limits. Omit whole annotations with explicit omission metadata and preserve raw source records in the constructed view.

## Interpretation boundary

Source matching proves that a quote belongs to a current record. It does not prove the meaning of a caller-supplied relationship. A caller must validate semantic extraction separately and preserve its own provenance. Existing observation supersession links are heuristic and are not automatically imported as explicit corrections.

Raw date annotations reuse the existing frozen recall date grammar. A date mentioned in a source is not automatically the event date of every statement in that source. Missing sources, missing dates, and incomplete extraction cannot support negative claims or complete event counts.

## Source API

This module is experimental source code at `src/evidence-view.ts`; it is not a stable package or SDK export and adds no stored-record contract.

`buildOhEvidenceViewV1({ records, mentions?, links?, sourceView? })` accepts graph records or native ranked `{ record }` results. It validates current record digests, detaches and freezes the raw input, and retains unsupported pointers with their reason. Duplicate source keys are rejected. The default projection reads `text`, `speaker`, and a canonical `statedAt` or `observedAt`. A custom projection can map statement metadata but must preserve the default raw text exactly.

Each mention names a unique ID, kind, source key and digest, exact unique quote, and optional quoted time expression. Supported absolute calendar dates resolve to an inclusive UTC day. Relative expressions use the frozen recall grammar against the statement's own instant. The whole expression must match. Ambiguous or unknown expressions keep a null interval.

Each link has an ID, kind, `from` and `to` mention IDs, and its own exact source quote. `supersedes`, `cancels`, and `reactivates` point from the new statement to the previous statement. `before` points from the earlier event to the later event. `same-event` and `distinct-event` describe caller-supplied identity. A source quote authenticates bytes; the view labels these semantic relationships `caller-asserted`.

- `compareOhEvidenceEventsV1(view, leftId, rightId)` reports before, after, unknown, conflict, or unsupported. Only supported `event` mentions can be endpoints or intermediate steps of a path; a suggestion, plan, state, or unclear mention cannot establish event order. Disjoint intervals and explicit paths can establish order. Overlap never forces an order, and contradictory paths or dates remain conflicts.
- `currentOhEvidenceStateV1(view, mentionId, asOf?)` follows explicit state changes and reports competing branches, cycles, unsupported history, or reversed statement dates. `asOf` means what had been stated by that instant; it does not imply event-time validity. Known-future link evidence cannot connect statements or rewrite a past result. Unknown link timestamps remain explicitly unresolved. The full constructed view retains every statement and source-linked change.
- `groupOhEvidenceEventsV1(view)` groups caller-linked event mentions, reports contradictory identity links, and identifies unlinked mentions. The number of groups is not a verified count of distinct events.
- `renderOhEvidenceViewIndexV1(view, maximumBytes?)` writes a supplementary JSON index with exact citation quotes, dates, and counts of omitted annotations. It never replaces or truncates the raw sources retained in the view. Callers must keep their original raw context beside it. Mentions and links take priority, followed by sources with date expressions, then source metadata without expressions. Omitted links remain visible in the counts.

Without explicit mentions, the view produces only source date annotations. It cannot extract event identity, infer which event a date modifies, discover corrections, or adopt suggestions. A benchmark adapter with no semantic extraction must report that restricted scope.

The opt-in [event inventory development experiment](../benchmarks/event-inventory-development-v1.md) adds a source-only extraction prompt, a checked model-proposal parser, and calls into these operations. Its simulated-transport tests verify wiring and deterministic behavior; live semantic extraction remains unverified.

Input limits are 2,048 records, 128 mentions, 256 links, and 4 MiB of combined serialized records and projected text. Quotes are at most 4 KiB. Raw date scans admit source text up to 4 KiB and consume at most 128 KiB total in source-key order. Larger sources retain their original text and report `scan-limit`; explicit short quoted mentions can still resolve dates. The index uses a caller-selected byte budget between 512 bytes and 256 KiB and omits whole annotations.
