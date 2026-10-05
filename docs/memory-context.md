# Progressive memory context

`@hraness/oh/memory-context` reads Oh's append-only operation history as a
progressive-detail view: the most recent changes come back as exact records,
older ranges come back as summaries your host published, and every summary can
be expanded back into the originals it covers. It runs on Bun and Node 24,
adds no database of its own, and performs no inference.

This is an opt-in reading surface for hosts that manage their own summary
maintenance. It does not change what Oh stores, and it is off unless your code
creates a host and admits a history.

## Capture a history

A capture walks each lane's change feed — the same `changesSince` primitive
sync uses — and freezes an ordered list of leaves, one per recorded change,
bound to the store's binding and pinned head:

```ts
import { captureOhMemoryContextV1 } from "@hraness/oh/memory-context";

const history = await captureOhMemoryContextV1({
  working: { store: workingStore },
  // Optional: { canonical: { store: canonicalStore }, ... }
  // Optional per lane: { from: headRef, through: headRef }
});
```

The capture is immutable data. Concurrent writes after it lands cannot shift
it; they appear in the next capture instead.

## Admit and read

`createOhMemoryContextHostV1` binds store ports, a continuation key, and an
access resolver that returns the current permission decision for each
admitted history. Every read re-checks that decision, so revoking or
narrowing a grant takes effect immediately and without rewriting history:

```ts
const host = createOhMemoryContextHostV1({
  resolveAccess: (ref) => currentGrant(ref), // -> OhMemoryContextAccessV1
  working: { expectedBindingSha256: workingStore.binding.bindingSha256,
    store: workingStore },
});

const ref = await host.admit(history, { recentLeaves: 8 });
const reader = host.bind(ref);

const page = await reader.overview();                 // items: leaf | summary | pending
const leaf = page.items.find((item) => item.kind === "leaf");
if (leaf) await reader.read(leaf.leafIndex);          // exact stored record
const found = await reader.search({ pattern: "deploy", flags: "i" });
```

Partial pages carry a signed `continuation`; pass it back to resume exactly
where the page ended. Continuations are bound to the captured history, the
selection, the current summary generation, and the surface they came from, and
they expire on the host's monotonic clock.

## Publish summaries

Summaries are host-supplied reading aids, never records. Publish them as a
generation, conditionally against the generation the reader last reported:

```ts
await host.publishDerivatives(ref, pool, inspection.generationSha256);
```

A stale or competing proposal is refused; replaying the identical proposal is
idempotent. Until a range has a summary it renders as `pending`, so a missing
summary shows as an honest gap rather than silently dropped context.

Reads re-fetch each leaf's source operation from the live store, so a purged
working space, a rebound store, or a head that left the log denies the read
instead of serving cached bytes.

## Boundaries

- Summaries never become reviewed memory, query premises, or Oh records.
- A summary whose range contains an unpermitted leaf is withheld, not trusted
  to hide the gap.
- Reads never write to the log, the working store, or the canonical record.
- The registry is in-memory: restart your host process and re-admit the
  history to restore the view. Derivatives are rebuildable by construction.

The wire-level contract, bounds, and record shapes live in
[the specification](../spec/v1/memory-context.md).
