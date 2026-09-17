# Citations V1

This pack records citations as an ordered cluster with locators, quotation
selectors and stated intent, and lets a cited entity carry the abstraction
level at which it was cited. `sponge.core/cites` already relates one
information resource to a source it references; this pack adds the structure a
research corpus needs around that relation without revising it.

`createSpongeCitationPackV1(previous)` accepts catalog V7 and returns
revision 1 of `sponge.citation`. Catalog V8 includes this optional pack. It
adds three concepts and seven predicates without changing earlier declarations
or locks. These are original local definitions under MIT; no upstream
vocabulary mapping is claimed.

## Cite an ordered, located item

`citation-cluster` identifies an ordered set of citations attached to one
citing entity, such as a synthesis, document or claim record.

- `cited-from` connects a cluster to the entity that cites it.
- `cites-item` connects a cluster to one cited entity, typically a source or
  retained content version. Four predicates in this pack may qualify the
  statement:
  - `citation-order` records the item's ordinal position in the cluster.
  - `citation-locator` records the page, section or locator string inside the
    cited entity.
  - `quotation-selector` records a verbatim quotation selector that binds the
    citation to exact content.
  - `citation-intent` names a `citation-intent-descriptor` entity stating why
    the item is cited — support, method, data, background or disagreement.
- `wemi-level` names a `wemi-level-descriptor` entity stating the abstraction
  level at which an entity was cited — work, expression, manifestation or
  item. A citation to an expression does not transfer to other expressions of
  the work.

`citation-intent-descriptor` and `wemi-level-descriptor` are concepts whose
entities a corpus declares for itself. Ordering is recorded per item; the pack
does not claim that a cluster is complete, that a locator resolves, or that a
selector verifies against any payload.

## Boundaries

A citation cluster records what a citing entity pointed at and why. It does
not establish that the cited source supports the claim, that the selector
matches real bytes, or that the citing entity had rights to read the source.
Typed external identifiers stay under `sponge.foundation/external-identifier`
and `sponge.identity-context` identity claims; this pack adds no identifier
scheme.

The direct dependencies are `sponge.core`, `sponge.foundation` and
`sponge.reference`, pinned to their V7 manifests. The query entries are
declarative predicate inventories, not executable queries.
