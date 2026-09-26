# Source policy V2

This pack records what a corpus decided about a source: which capabilities the
source's material may be used for, under which status, for which stated
reason, under which terms document, and at which policy revision. The record
is the decision. Whether a source may be fetched, stored, featured or trained on
is a rights question this vocabulary does not settle.

Catalog V9 includes revision 2 of `sponge.source-policy`. Revision 2 has the
same two concepts, ten predicates, definitions, shape, and query as revision 1,
which `createSpongeSourcePolicyPackV1(previous)` builds from catalog V7 for
catalog V8. Its schema references point at revision 2 of this pack, and its
manifest pins this guide. These are original local definitions under MIT; no upstream
vocabulary mapping is claimed.

## Record a per-source capability decision

`capability-policy` identifies one recorded policy decision for one source.

- `policy-for-source` names the source entity the decision governs.
- `capability-storage`, `capability-features`, `capability-labels`,
  `capability-ml` and `capability-network` each record a boolean: whether the
  source's material may be stored, shown as features, used as labels, used for
  machine learning, or fetched over the network under this decision.
- `policy-status` names a `policy-status-descriptor` entity, for example
  denied, requires-entry, prohibited-pending-permission or allowed-with-review.
- `policy-reason` keeps the stated basis for the decision.
- `terms-reference` records a URI for the license or terms document the
  decision cites.
- `policy-revision` records the integer revision of the policy that produced
  the decision, so a decision stays attributable after policy text changes.

## Limits

A capability policy records what was decided, by whom it is attributed, and
under which revision. It does not grant rights, execute the decision, or
prevent a later policy from superseding it. Where a corpus declares no policy
record for a source, the safe consumer default is to deny; this pack does not
create that default or accept any source.

The direct dependencies are `sponge.core`, `sponge.foundation` and
`sponge.reference`, pinned to their V7 manifests. The query entries are
declarative predicate inventories, not executable queries.
