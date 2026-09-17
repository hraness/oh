# Temporal roles V1

This pack separates the times attached to a record into named roles. The moment
a reported event happened, the moment a source observed it, the moment content
became retrievable, and the moments a record entered the store, was reviewed,
or must be reassessed are different facts. Conflating them silently changes
point-in-time meaning: a claim that was true when published may be wrong when
retrieved, and a record reviewed yesterday may be overdue under its own policy
today.

`createSpongeTemporalRolesPackV1(previous)` accepts catalog V7 and returns
revision 1 of `sponge.temporal-roles`. Catalog V8 includes this optional pack.
It adds ten predicates and no concepts. These are original local definitions
under MIT; no upstream vocabulary mapping is claimed.

## Record each time under its own role

Every predicate takes an entity as its subject and a normalized `time` value as
its object. Each predicate names exactly one role. Supplying several roles on
one record is normal, and no role implies another.

- `event-time` records when the reported event or occurrence happened, as the
  source states it. It never doubles as the time the report was written,
  retrieved or reviewed.
- `observation-time` records when the source observed or collected the
  reported content. It is distinct from `sponge.natural-world/observed-at`,
  which names a location, and from `sponge.foundation/measured-at`, which
  belongs to a measurement record.
- `available-at` records when the content became retrievable to the observer.
  A claim admitted under point-in-time discipline uses this role rather than
  the source's reported publication date, which remains a source string under
  `sponge.core/published-date`.
- `first-seen-at` records when the recording system first observed the
  content, however stale its original publication.
- `entered-at` records when the record entered the local store. It asserts
  nothing about the source or the event.
- `searched-at` records when a bounded search ran. Pair it with an
  `sponge.evidence-grading` absence finding when the search's outcome is
  itself recorded.
- `as-of-time` records the point in time the record's content describes, where
  a source publishes data as of a stated snapshot.
- `reviewed-at` records when a review or reassessment decision was recorded.
  The decision and its outcome stay a separate
  `sponge.research-ops` review event.
- `reassess-by` records the time by which the record must be reassessed under
  its declared policy. The deadline is stated, not enforced; passing it
  changes nothing by itself.
- `superseded-at` records when the record was superseded by a correction or
  withdrawal. The superseding record remains a separate entity.

## Boundaries

These roles record stated times; they do not verify them. A record may carry
contradictory roles from different sources, and keeping them separate is the
point. None of these predicates revise `sponge.reference` `at-time` or
`valid-during`, `sponge.foundation` `retrieved-at`, or
`sponge.identity-context` `captured-at`; those keep their narrower roles. No
predicate here establishes ordering, freshness or correctness. In particular,
`available-at` does not prove public availability and `reassess-by` does not
trigger reassessment.

The ten predicates may also appear as qualifiers on catalog V8 predicates that
declare them, such as the grading and operations predicates in this release.
Predicates defined in catalogs V1–V7 keep their frozen qualifier sets.

The direct dependencies are `sponge.core`, `sponge.foundation` and
`sponge.reference`, pinned to their V7 manifests. The single query entry is a
declarative predicate inventory for enumerating the temporal roles attached to
one record; it is not an executable query.
