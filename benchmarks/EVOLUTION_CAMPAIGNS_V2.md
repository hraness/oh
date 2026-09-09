# Successor experiment campaigns

A new approved experiment allowance must not change the identity or spending cap
of an occupied campaign. `oh.memory.evolution-campaign.v2` creates a separate
campaign and store. It preserves the V1 fields and adds three `predecessor` pins:
`campaignPin`, `terminalPhasePin`, and `databasePin`.

The predecessor must be a V1 campaign with a different campaign ID and store,
the same historical ledger inventory, and the same selected authentication
authority. This version supports one V1 predecessor. The declared historical
exposure is the original ledger exposure plus the predecessor's current exposure,
including settled usage and full unresolved reservations, exactly once. The new
`additionalBudgetMicros` allowance is separate; it does not reset or enlarge the
old allowance. Merely writing a descriptor does not authorize spending.

Finish every operation in the predecessor campaign before taking its pins. Close
the store so SQLite checkpoints the database and releases its lock and journal
files. Pin the actual final verified, complete phase receipt and the closed
`campaign.sqlite` bytes. A stale receipt, live lock, WAL, shared-memory file,
changed database, alias, mismatched authority, or unreconciled total prevents
successor verification. The verifier hashes the closed database in bounded chunks
and reads its identity and accounting totals through an immutable, read-only
SQLite connection. It does not recreate provider ledger events or modify captures.

Keep the predecessor operationally retired. Snapshot checks at verification
boundaries detect changes; they do not permanently disable the old authority or
hold its lock throughout a successor phase. Do not run both campaigns against a
lineage that describes the predecessor as closed. Retain the exact final source,
inputs, descriptor, receipt and database pins in the handoff.

Separate stores do not share a response cache. An identical model request in a
successor is a new physical call unless an explicitly implemented and authenticated
import path provides otherwise. Declare full comparison repeats before dispatch,
account for their new usage, and retain the old outcomes. Never describe those
calls as cache hits, replace an earlier failed response, or select retries by
answer quality. Repeated development questions do not add independent evaluation
data.
