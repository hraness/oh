# libSQL authority ownership

The direct libSQL authority runs schema bootstrap, space opening, head and bounded
snapshot reads, change feeds, commit and replay proofs, verification and working
space purge as native Effect programs. Its public functions and store handles
retain their Promise signatures and original rejection values.

`libsql-model.ts` holds the existing public DTOs, exact schema statements, limits,
canonical digests and row validators. These helpers retain their existing bodies.
`LibSqlAuthorityClient` is the named local capability for the structural provider
client and canonical wall-clock sampling; `libSqlAuthorityClientLive` supplies it.
A caller-supplied operation instant bypasses the lazy clock capability. Internal store methods compose
Effects directly. Only the public runtime bridge executes a program, once per
public operation rather than once per SQL statement. Effect 3.22.1 is bundled into
`@hraness/oh/libsql` without adding a required consumer dependency. The portable
store, SQLite, page, projection and semantic-cloud graphs remain independent.

Each native `batch` remains one atomic provider transaction with its exact SQL,
argument order, mode, compare-and-swap guards and result validation. The adapter
retains ownership until the foreign Promise settles. Interruption cannot make a
still-running native write disappear from the owner. Canonical commit does not
resubmit an ambiguous write: its existing recovery reads either prove the exact
reachable operation, report a changed head, or preserve the original failure.
The existing bounded working-space purge reconciliation remains unchanged.

Calling `close()` immediately fences new calls. Each authority owns an admission
count and one drain signal; admitted complete operations retain that ownership
through validation and recovery after their native calls. The gate does not
serialize independent commits. After the count reaches zero, an owned client is
closed once. Borrowed clients are never closed. Repeated close calls observe the
same result. This drain-before-close behavior strengthens the earlier immediate
shutdown, which could close a client while a batch was still pending.

Operation and close failures remain separate for authority handles: each Promise
rejects with its own original value. The standalone purge helper retains the
original `try/finally` precedence, so its native close failure wins if both purge
and close fail. Expected conflict, dependency, integrity, profile, purge,
validation and capacity failures enter explicit error tags. Unrelated program
defects remain defects until the Promise boundary projects their original cause.

Regression evidence includes real SQLite-backed atomic batches, two concurrent
commits with one compare-and-swap winner, a held write followed by close, failed
write recovery followed by failed close, lost-response exact replay without a
second write, borrowed-client ownership, and interruption that waits for native
settlement. Existing hostile-row, replay, purge, schema and provider-bound tests
remain the contract oracle. The architecture, compiler, packed Node/Bun and final
repository gates remain mandatory.
