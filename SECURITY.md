# Security

Oh parses untrusted JSON, persists research data, can invoke either a local
embedding engine or an explicitly configured hosted embedding provider, and
can use remote libSQL for authority, synchronization, or a derived semantic
cache. Please report vulnerabilities privately.

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
- The stable memory authority is an in-process capability boundary, not a
  tenant authenticator or sandbox. The host must bind its canonical and working
  store handles, enforce tenant and session authorization before every call,
  keep raw credentials and purge handles out of model tools, and never reuse a
  facade across authorization domains. Give a model only the four-method
  `agent` object; the separate `host` object can advance canonical knowledge and
  must remain in trusted control-plane code.
- Stable memory requests and bound-store responses are copied once through
  recursive data-property descriptors. Accessors, symbols, proxies, sparse
  arrays, and non-JSON values fail closed; parsers, byte limits, digests, and
  execution consume only the same detached graph. The walk is bounded to 128
  levels, 65,536 entries per container, and 1,048,576 total nodes, and accounts
  canonical bytes incrementally. Do not treat this validation as a sandbox for
  host callbacks or physical store implementations.
- Memory fact extractors are trusted host code. They receive complete record
  values, and their declared digest identifies policy but does not sandbox,
  authenticate, or attest to a JavaScript function. Review extractors as code,
  make them deterministic, and give them no ambient authority they do not need.
  Invocation count, returned fact count, and retained bytes are bounded, but a
  synchronous extractor's own execution time and temporary allocation are
  outside the evaluator's resource guarantees.
- Explanation tokens are short-lived, process-local bearer capabilities bound
  to one exact result. They can explain multiple rows until expiry or eviction;
  every canonical generation shares one bounded aggregate evidence cache and
  clock guard. Do not log, persist, share across tenants, or treat them as
  evidence that a caller may read either underlying store.
- `OhMemoryContinuationError` identifies only malformed, unauthenticated, or
  exact-identity-mismatched caller cursors. Do not catch it as a substitute for
  handling store integrity, projection, extractor, or availability failures;
  those retain their original error types.
- Canonical adoption applies the 8,192-record and 32 MiB lane limits to the
  prospective snapshot before its only compare-and-swap, then reconciles the
  returned operation with the current physical head. Duplicate operation IDs
  and concurrent later writes cannot roll the facade back to an intermediate
  head. Canonical replacement is host-only and requires both the exact reviewed
  canonical head and the exact prior record digest for every replaced logical
  key. Omitted, stale, wrong, duplicate, and absent-key claims fail closed; the
  API validates even claims for already-equal keys, and exact replays bind them
  back to the request's reviewed head. It does not auto-merge or use
  last-write-wins. Advance longer than 16,384 operations in explicit reviewed
  chunks.
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
- The hosted semantic adapter is not local inference. It sends bounded rendered
  source titles and content, and each search query, over HTTPS to the fixed
  Cloudflare Workers AI EmbeddingGemma route. Decide whether that egress is
  permitted for the source data before enabling it, and apply the Cloudflare
  account's current data-processing, logging, geography, retention, and abuse
  policies. The adapter's sanitized errors do not prevent a host, proxy, or
  provider from logging request data outside Oh.
- Give the hosted adapter a least-privilege account token that can invoke
  Workers AI only. Keep the token and account identifier in trusted host
  configuration, never in an Oh record, memory page, model tool argument,
  browser bundle, log, or semantic database. Configure provider budgets and
  usage alerts: Oh bounds each request and staged generation, but it does not
  enforce an account-wide spend ceiling or protect against calls made with the
  same token outside Oh.
- The isolated V2 direct libSQL semantic cache deliberately stores no source title, body,
  query, record JSON, account identifier, or provider token. It does retain
  record keys and digests, formatted-input digests, vector geometry, generation
  timing, authority identifiers, and opaque isolation digests. Those are
  sensitive metadata, can reveal equality across raw vector bytes or known
  input digests, and may support dictionary guesses for known text. Isolation
  prevents cache reuse and deletion coupling across authorities or epochs; it
  is not encryption and does not conceal equal embedding output from a database
  holder. Use a separate protected database and short-lived schema credentials;
  scope runtime and purge credentials to the operations each role needs.
- V2 semantic-cache purge writes a permanent authority tombstone, removes that
  authority's heads, generations, memberships, and every vector in its reserved
  isolation scopes. Its stable receipt proves zero residual scoped rows at the
  live database boundary. It does not erase Cloudflare processing or
  logs, libSQL backups and replicas, host logs, network captures, or bytes
  copied by a holder of raw credentials. For expiring working memory, stop new
  writes, purge the semantic cache first, then purge the authoritative working
  space, and acknowledge expiry only after both operations converge.

The public threat model does not treat a SHA-256 digest as a signature, an
authorization decision, or proof that a statement is true.
