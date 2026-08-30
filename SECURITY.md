# Security

Oh parses untrusted JSON, persists local research data, optionally invokes a
local embedding engine, and can exchange operation logs with a remote libSQL
service. Please report vulnerabilities privately.

## Report a vulnerability

Open a [private security advisory](https://github.com/hraness/oh/security/advisories/new)
with the affected version, operating system, impact, reproduction steps, and
the smallest safe proof you can provide. Do not include credentials, private
research records, or third-party personal data.

Please do not open a public issue for an unpatched vulnerability. Maintainers
will acknowledge a complete report, assess the affected contract and release
range, and coordinate disclosure after a fix is available.

## Supported releases

Security fixes target the latest stable release. Older releases may receive a
fix when their wire contract is still in active use, but they are not promised
separate maintenance. Upgrade to the latest stable tag before reporting a
problem that has already been fixed there.

## Security boundaries

- SQLite and the append-only operation chain are authoritative. Semantic
  documents, vectors, and FTS rows are derived data.
- Contract, operation, record, and bundle digests detect accidental or hostile
  mutation. They do not encrypt data or authenticate an actor.
- The libSQL sync seam validates contract bytes and fast-forward history. The
  direct libSQL authority additionally enforces compare-and-swap batches and
  exact realm/profile bindings. The client application remains responsible for
  transport security, credentials, access control, tenant isolation, backups,
  and service configuration.
- Direct libSQL schema creation is an explicit bootstrap API. Use a short-lived
  schema credential for that step and a narrower data credential for runtime
  opens, commits, reads, and host-controlled purge.
- A working-store purge removes rows reachable through the supported authority
  and leaves a content-free receipt. It does not erase provider backups,
  replicas outside that authority, exported dependency closures, logs created
  by the host, or bytes copied by a process that already held raw credentials.
  Match retention claims to the complete custody and backup system.
- Store profiles are host control metadata. V1 operation digests do not attest
  to that profile, and callers with raw database or filesystem access remain
  outside the profile API boundary.
- The experimental memory facade is an in-process capability boundary, not a
  tenant authenticator or sandbox. The host must bind its canonical and working
  store handles, enforce tenant and session authorization before every call,
  keep raw credentials and purge handles out of model tools, and never reuse a
  facade across authorization domains.
- Memory fact extractors are trusted host code. They receive complete record
  values, and their declared digest identifies policy but does not sandbox,
  authenticate, or attest to a JavaScript function. Review extractors as code,
  make them deterministic, and give them no ambient authority they do not need.
  Invocation count, returned fact count, and retained bytes are bounded, but a
  synchronous extractor's own execution time and temporary allocation are
  outside the evaluator's resource guarantees.
- Explanation tokens are short-lived, process-local bearer capabilities bound
  to one exact result. They can explain multiple rows until expiry or eviction;
  the process keeps a bounded aggregate evidence cache. Do not log, persist,
  share across tenants, or treat them as evidence that a caller may read either
  underlying store.
- Composite query rows remain derived even when all visible premises are
  canonical. A prepared nomination is content-addressed transport for a later
  destination-owned review; it is not approval, synchronization, or permission
  to mutate canonical knowledge.
- Oh does not redact record values. Do not write secrets or sensitive research
  into a space unless the database, filesystem, backups, and sync destination
  have the required protection.
- QMD is optional and local, but its cache contains derived text from records.
  Protect and delete that cache according to the sensitivity of the source
  database.

The public threat model does not treat a SHA-256 digest as a signature, an
authorization decision, or proof that a statement is true.
