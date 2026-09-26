# Evidence grading V2

This pack records how a record's evidence was graded: the stratum it was
accepted under, the tier it holds on that stratum's own ladder, its recorded
epistemic grade and corroboration state, the criteria version it was assessed
under, and the exact payload a claim was bound to. It also records searches
with a stated scope that found nothing or covered too little.

Catalog V9 includes revision 2 of `sponge.evidence-grading`. Revision 2 has
the same five concepts, sixteen predicates, definitions, shape, and queries as
revision 1, which `createSpongeEvidenceGradingPackV1(previous,
temporalRolesPack)` builds from catalog V7 and the catalog V8
`sponge.temporal-roles` manifest. Its schema references point at revision 2 of
this pack and of `sponge.temporal-roles` and `sponge.content-occurrences`, and
its manifest pins this guide. These are original local definitions under MIT;
no upstream vocabulary mapping is claimed.

## Give each channel its own ladder

`evidence-stratum` identifies an evidence channel class that has its own tier
ladder. A corpus declares its own stratum entities: one corpus might keep
clinical, community, historical, registry and gray-literature strata, while
another keeps primary, licensed and private channels. `stratum-tier`
identifies one rung of exactly one stratum's ladder.

- `of-stratum` records the stratum under which a record was accepted.
- `of-tier` records the tier the record holds on its stratum's ladder. A tier
  is meaningless across strata: a strong community tier is not a weaker
  clinical tier, and strata are never collapsed.
- `tier-in-stratum` records which ladder a tier belongs to.
- `tier-rank` records a tier's ordinal rank within its ladder. Ordering inside
  one ladder does not compare across ladders.

## Keep grade and corroboration as recorded evidence

`epistemic-grade-descriptor` and `corroboration-descriptor` are concepts whose
entities name the recorded states a policy uses. Examples are established,
emerging, contested, community-signal, historical-record or refuted grades,
and convergent, contested, refuted or single-source corroboration. A record's
grade is attributed data about the record. It is not the assertion's review
state, and it is never a verdict about truth.

- `epistemic-grade` records the grade a policy assigned to the record.
- `corroboration-state` records the recorded corroboration state; a
  multi-stratum record can carry `contested`.
- `corroborated-by` names an explicitly identified record or source that
  corroborates or contests the subject. Contesting evidence stays attached.
- `assessed-under` names the criteria version or era entity under which the
  record was assessed. A historical practice documented under an earlier era
  is not endorsed under a later one.
- `corpus-novelty` records how the record relates to the rest of the corpus:
  `new`, `update`, `known` or `unknown`.

## Bind a claim to its bytes

- `bound-selector` records the verbatim selector or quote span that locates a
  claim's support inside a payload.
- `bound-payload` names the exact `retained-content-version` or source the
  selector reads from. Binding to a version does not verify the bytes; a
  selector that matches nothing is itself evidence about the claim.
- `corrects` names the earlier record this record corrects or retracts.
  Corrections supersede; they do not rewrite. The corrected record stays in
  the corpus.

## Record a search that found nothing

`absence-finding` records a search with a stated scope. `search-scope` states
that scope as the queries, source set and window. `searched-within` identifies
the corpus or source set searched, `search-method` identifies the
`sponge.research/method` used, and `absence-outcome` is `no-result` or
`insufficient-coverage`. `sponge.temporal-roles/searched-at` records when the
search ran. A null result is evidence about the search, never about
nonexistence. "Not searched" and "not applicable" are not findings; they are
expressed by the absence of a finding record or by a declared descriptor.

The direct dependencies are `sponge.content-occurrences`, `sponge.core`,
`sponge.foundation`, `sponge.reference`, `sponge.research` and
`sponge.temporal-roles`, pinned to their catalog V9 manifests. The grading
predicates declare the temporal-roles predicates as permitted qualifiers, so a
grading statement can carry the review or search times it was recorded under.
The query entries are declarative predicate inventories, not executable
queries.
