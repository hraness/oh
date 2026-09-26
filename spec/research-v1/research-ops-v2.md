# Research operations V2

This pack records the operations of a research corpus: declared monitors, the
append-only ledger of what each run accepted into the corpus or rejected,
recorded review decisions, and the publication policy those decisions run
under. Ledgers append; they never rewrite. A rejected candidate and its reason
stay recorded beside the accepted records.

Catalog V9 includes revision 2 of `sponge.research-ops`. Revision 2 has the
same seven concepts, sixteen predicates, definitions, shapes, and queries as
revision 1, which `createSpongeResearchOpsPackV1(previous, temporalRolesPack)`
builds from catalog V7 and the catalog V8 `sponge.temporal-roles` manifest.
Its schema references point at revision 2 of this pack and of
`sponge.temporal-roles`, and its manifest pins this guide. These are original
local definitions under MIT; no upstream vocabulary mapping is claimed.

## Declare a monitor, then ledger its runs

`research-monitor` identifies a declared input with a stated scope that a
corpus checks on a cadence. `monitor-run` identifies one recorded execution of
a monitor or of a manual sweep. `rejection-record` identifies a recorded
decision not to accept a candidate.

- `monitors-inquiry` connects a monitor to the `sponge.core/inquiry` it
  watches for.
- `monitor-target` names the source or venue entity the monitor checks.
- `monitor-cadence-days` records the stated check cadence in whole days.
- `monitor-status` records `active`, `paused` or `retired`.
- `run-of-monitor` connects a run to its monitor; a run without a monitor is a
  declared manual sweep.
- `run-scope` records the declared scope of the sweep.
- `admitted-in-run` names each entity a run accepted into the corpus.
- `rejected-in-run` connects a rejection record to its run; `rejection-of`
  names the candidate entity and `rejection-reason` keeps the stated reason.

## Record review and policy separately from the records they govern

`review-event` identifies one recorded review decision; `review-of` names the
reviewed entity and `review-outcome` names a `review-outcome-descriptor`
entity such as accepted, rejected, deferred or escalated. The times of review
and reassessment stay under `sponge.temporal-roles` `reviewed-at` and
`reassess-by` on the governed record or the event.

`publication-policy` identifies a stated policy. `policy-class` names a
`policy-class-descriptor` entity, for example auto-publishable,
review-required or not-publishable. `policy-applies-to` names the stratum,
grade descriptor or record class the policy governs, and
`reassessment-window-days` records the stated window in whole days.
`policy-reference` records a URI for the governing document.

## Limits

These records describe what a corpus declared and decided. They do not run the
monitor, schedule the cadence, enforce the deadline or grant publication. A
recorded acceptance is evidence about a decision, not authority over the
accepted content. Rejection records preserve disagreement and refusal; they
are not errors.

The direct dependencies are `sponge.core`, `sponge.foundation`,
`sponge.reference` and `sponge.temporal-roles`, pinned to their catalog V9
manifests. `policy-applies-to` keeps a deliberately broad entity range so it
can name a `sponge.evidence-grading` stratum or grade descriptor without this
pack depending on that vocabulary. The temporal-roles predicates are declared
as permitted qualifiers on the operations predicates, so a run or review
statement can carry the times it was recorded under. The query entries are
declarative predicate inventories, not executable queries.
