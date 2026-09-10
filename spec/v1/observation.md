# Oh observations V1 (draft)

Status: draft narrative. This document describes an application profile for
ordinary `edition` records that a later release is expected to ship. Nothing
here is part of the V1 contract manifest, no record kind is added, no code
implements it yet, and no wire format is frozen by this page. It follows the
same pattern as [memory pages](memory-page.md): a profile over an existing
record kind, never a new authority.

## Purpose

An observation is one dated statement a host extracted from a source
session: who said it, when it was said, what moment it describes and where
it came from. Observations let recall surface a fact under its own date
even when the source turn buries it in a long exchange. They sit beside the
source turns and never replace them.

## Record

An observation is an `edition` record whose value has `format:
"oh.observation.v1"` and `v: 1`. Parsers require the exact fields below and
reject unknown fields.

| Field | Contract |
| --- | --- |
| `text` | Nonempty single-line NFC text, at most 1 KiB. |
| `speaker` | The source speaker label, unchanged. |
| `statedAt` | Canonical UTC instant of the source session. |
| `eventAt` | Canonical UTC instant the statement describes, or `null`. |
| `resolvedFrom` | The relative expression `eventAt` was resolved from, or `null`. |
| `facet` | Optional lowercase token naming the subject the statement updates, or `null`. |
| `kind` | One of a closed set of statement kinds published with the implementation. |
| `supersedes` | Key of the observation this one replaces, or `null`. |
| `sources` | Ordered, unique source bindings of `{ key, recordSha256 }` naming the turn records the statement came from. |

Every key in `sources` also appears in the record's `dependencies`, so the
graph enforces that the source turns exist before the observation is
committed. One `activity` record per extracted session carries the model
identity, the instruction digest and the response digest as the extraction
receipt. Observations are idempotent by session content: extracting the same
session twice yields the same keys.

## Supersession

When two current observations share a facet and a speaker, the later one
may name the earlier one in `supersedes` and depend on it. When the session
order and the statement timestamps disagree about which is later, the record
sets an ordering-conflict flag and a renderer shows both dates; no rule
picks one.

## Boundaries

- The extraction instruction is frozen and published before any benchmark
  corpus is processed, and its input is session text only: no question,
  reference answer, category or dataset label reaches the extractor.
- Observations never replace raw turns in a rendered context; a renderer
  marks them as derived.
- No ontology assertion is created unless a real subject, predicate and
  object are bound.
- The profile does not change `spec/v1/contract.json`, the closed record
  kinds or any V1 limit.
