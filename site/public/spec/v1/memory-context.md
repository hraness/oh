# Oh memory context V1

Oh memory context is a progressive-detail reading aid over the append-only
operation log defined in [Store](store.md) and [Memory](memory.md). It never
adds a data store. A capture snapshots each recorded change — the record a put
wrote, or the digest a tombstone removed — together with its lane, instant,
operation digest, and captured head. A reader then offers an overview with the
most recent changes in detail, expandable host-supplied summaries for older
ranges, exact record reads, and bounded search over the originals.

Summaries are reading aids supplied by trusted host code. They are not Oh
records, never enter the operation log, never become query premises or
reviewed memory, and their publication never writes an original record.
Ordinary reads perform no inference and no summary maintenance. The working
and canonical lanes keep their own labels and permissions throughout.

## History record

`captureOhMemoryContextV1` walks each supplied lane's `changesSince` feed from
an exclusive `from` head (default: genesis) through a pinned `through` head
(default: the lane's head at capture), verifying the contiguous operation
chain exactly as the sync feed does. The resulting history record carries:

- `bindings`: one or two lane bindings, ordered `canonical` then `working`,
  each naming the store `bindingSha256` and the full captured `head`;
- `leaves`: at most 4,096 leaf records in the canonical merge order —
  `instant`, then `lane`, `sequence`, `changeIndex`; and
- `v: 1`.

A leaf carries `changeIndex`, `instant`, `key`, `kind` (`put` or
`tombstone`), `lane`, `live`, `operationSha256`, `parentOperationSha256`,
`recordSha256`, `sequence`, and `v`. `live` reports whether the record still
exists with that digest in the captured head's snapshot. The history digest is
`canonicalSha256` of the record. Because a capture names its bindings and
heads, a reader can detect a rebound store or a rolled-back log instead of
serving from another history.

## Nodes, summaries, and generations

A node names an aligned power-of-two leaf range `[start, end)` inside one
history, where `end - start` is a power of two and `start` is a multiple of
that size. Its `sourcesSha256` is `canonicalSha256` of the leaf digests in
that range.

A summary is a host-supplied object with `body` (nonempty NFC text, at most
32 KiB), `childrenSha256s` (empty, or exactly the two digests of summaries
covering the node's halves), and explicit lineage: `historySha256`,
`nodeSha256`, `sourcesSha256`, `summarizerSha256`, `promptSha256`, and
`policySha256`. A summary is admitted only when its node digest recomputes
from the same history and its source set, recipe digests, and children are
consistent with the declared generation.

A generation groups the admitted summaries into one `summaries` index ordered
by node digest plus the recipe digests and a counter. Hosts publish a new
generation with `publishDerivatives` naming the expected previous generation
digest; the publish succeeds only when the expectation matches and the
counter advances by exactly one. Replaying the identical candidate returns
the current digest; a stale or alternative proposal can never overwrite an
existing completion. A generation change invalidates outstanding
continuations, so a corrected summary cannot strand a paged reader on old
navigation.

The complete canonical-JSON pool record submitted for a generation is limited
to 8 MiB and 2,048 summaries.

## Reading

`overview` emits a page of items in leaf order. The most recent leaves appear
as `leaf` items carrying the exact record; older aligned ranges appear as
`summary` items when the current generation supplies one, or `pending` items
otherwise. The page carries a `binding` naming the history, generation, and
selection digests, and an authenticated `continuation` when the page is
partial. `expand` splits a node into its two child ranges — or, at a size-one
range, the exact leaf. `read` returns one leaf's exact stored record.
`search` scans every permitted put's canonical record text with a bounded
regular expression and returns match positions with their leaf references.

Every read re-checks the current permission decision through the host's
access resolver: a per-leaf permit set, a per-lane permit set, and an
`active`/`revoked` state. A leaf outside the grant denies an exact read;
inside an overview it renders as an unpermitted `pending` item, and a summary
whose range contains an unpermitted leaf is withheld rather than trusted to
hide the gap. Each call also proves every bound lane still serves the log
containing its captured head, and leaf-bearing items re-fetch their source
operation from the live store at that head — so a purged working space or a
history that no longer contains the head denies the read instead of exposing
cached bytes, including pages served only from summaries.

Page continuations are issued, signed capabilities: HMAC-bound to the
continuation key, the admitted reference, the history, the selection, the
generation, and the surface, with a monotonic expiry. A forged, tampered,
expired, cross-surface, or stale-generation continuation denies the read.
Expiring a continuation never writes to the log.

## Boundaries

- The operation log and SQLite records stay authoritative; nothing in this
  profile writes on a read path.
- Summaries never become reviewed memory or query premises, and are withheld
  rather than exposed when any covered leaf leaves the grant.
- Concurrent writes after a capture cannot shift an admitted view; they
  appear only in a later capture.
- A continuation or page proves navigation state, not fact; only `read` and
  `search` return record bodies, and only from the live log.
- Memory context adds no storage surface. All admitted state lives in the
  host's memory-context registry and is rebuildable from the operation log.
