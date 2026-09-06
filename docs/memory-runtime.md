# Memory host ownership

The trusted host's canonical advance and reviewed nomination adoption run as
native Effect programs. Each constructed authority owns one FIFO semaphore.
Requests are detached and validated before queue admission. After admission, an
operation retains its permit through actual store settlement, descendant proof,
and publication of the next agent and canonical pin. A failed operation releases
its turn without poisoning later requests. Interruption cannot release an admitted
turn while its foreign store operation is still running.

The canonical store capability includes commit; the working capability admits only
closure re-export. The model-facing agent receives neither host capability. Stores
are borrowed: closing an Effect scope cannot close or purge either authority.
The existing model-facing V1/V2 query, remember, explanation and nomination
implementation remains in the memory core, with its shared clocks and explanation
cache retained across host rollovers.

Canonical writes still perform one exact compare-and-swap. Only an actual
`OhConflictError` enters the existing reconciliation path. Unknown write completion
is not retried. Exact nomination re-export, replacement permission, capacity,
operation identity, full-head ancestry and receipt digest checks remain mandatory.
The next pin becomes visible only after the new canonical snapshot is verified;
already-started agent calls keep their selected generation.

The public memory exports and Promise rejection values remain stable. Effect
3.22.1 is bundled into the memory runtime without adding a required consumer
dependency. Pure page, projection and store graphs remain independent. The packed
package check inspects these actual graph boundaries and installed public types.

The focused memory suite includes real SQLite-backed races, exact replay and
refusal proofs, hostile input and capacity bounds, old-generation explanations,
and a failed queued advance followed by a detached successful request. The full
repository and packed Node/Bun gates remain required before delivery.
