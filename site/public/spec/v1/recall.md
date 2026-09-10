# Oh recall V1 (draft)

Status: draft narrative. This document describes the recall interface that a
later release is expected to ship. Nothing here is part of the V1 contract
manifest, no code implements it yet, and no wire format is frozen by this
page. The document exists so the evaluation protocol can name the shape it
will measure and so the implementing change can be checked against a text
written before any benchmark score was read.

## Purpose

Recall answers one question of an agent: "what does this store remember that
bears on this query, as of this moment?" It composes the existing V1 search
without changing it. `searchOhV1` keeps its 1 through 100 result bound, its
keyword and semantic lanes, its reciprocal-rank fusion weights and its rule
that every hit is rejoined to a current record digest. Recall issues at most
six bounded queries through that function, fuses their ranked lists, and
renders the result in chronological order under a supplied reference
instant.

## Request

| Field | Contract |
| --- | --- |
| `queries` | One through six nonempty NFC strings, each at most 4 KiB. |
| `limit` | Integer 1 through 100 applied to each query and to the fused list. |
| `asOf` | A canonical UTC instant with exactly three fractional digits, or `null`. |
| `window` | Optional `{ since, until }` of canonical instants; `since` is not later than `until`. |

`asOf` is parsed before the call; recall never interprets natural-language
dates in the request. A relative expression such as "last week" is resolved
by a separate pure rule table over a fixed grammar, and an expression outside
that grammar resolves to `null` rather than a guess. The table is frozen
before any dataset label is read and is published with the implementation.

## Response

The response lists fused hits in rank order. Each hit carries the record
key, the record's current digest, the lane scores that produced it and the
rank of each query that returned it. Recall reads records; it writes nothing
and creates no derived state.

## Rendering

The renderer is a pure function of the response, `asOf` and a byte budget.
It emits the reference date first, then sessions in chronological order
under a date header that states how many days before the reference instant
the session took place, with gap markers between sessions that are far
apart. Record text is rendered unchanged. When `asOf` is `null` the renderer
falls back to rank order and omits every relative-time phrase. All instants
are treated as UTC, which the evaluation protocol card states.

## Boundaries

- Recall does not widen the V1 search bound; a caller who needs more than
  100 results per query issues more queries.
- Recall does not add records, ontology assertions, projections or
  application profiles.
- Recall makes no model call.
- Recall is not a benchmark adapter. The benchmark harness that measures it
  lives in `scripts/benchmarks` and is not part of the package.
