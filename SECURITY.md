# Security

Oh parses untrusted JSON and stores agent memory and research records. It can
call a local embedding engine, or a hosted embedding provider if you configure
one, and it can use a remote libSQL database as its primary store, as a sync
remote, or as a derived semantic cache. Please report vulnerabilities
privately.

## Report a vulnerability

Open a [private security advisory](https://github.com/hraness/oh/security/advisories/new)
that includes:

- the affected version and operating system;
- the impact;
- the steps to reproduce;
- the smallest safe proof of concept you can provide.

Leave out credentials, private research records, and third-party personal
data.

Please do not open a public issue for an unpatched vulnerability. Maintainers
will acknowledge a complete report, assess which releases and which versions
of the wire contract (the format of the data Oh stores and exchanges) it
affects, and coordinate disclosure after a fix is available.

## Supported releases

Security fixes target the latest stable release. An older release may receive
a fix while its wire contract is still in active use, but older releases are
not promised separate maintenance. If the latest stable release already fixes a
problem, upgrade instead of reporting it.

## Threat model

Each entry names what Oh protects and what your application must supply.

### Records and digests

- **Records and the append-only operation chain**, in SQLite or direct libSQL,
  are the source of truth. Semantic documents, vectors, and FTS rows are
  derived data that Oh can rebuild.
- **Digests** of contracts, operations, records, and bundles detect accidental
  changes, and hostile ones when you compare them with a digest you trust,
  such as a canonical head your host pinned. Each is a SHA-256 hash of
  canonical JSON, which gives every accepted value exactly one byte encoding.
  Anyone who can rewrite the data can also recompute its digests, so digests
  do not encrypt data or authenticate an actor, and this threat model never
  treats one as a signature, an authorization decision, or proof that a
  statement is true.
- **Oh does not redact record values.** Do not write secrets or sensitive
  research into a space unless the database, filesystem, backups, and sync
  destination have the protection that data requires.
- **Store profiles** are control metadata for the host. The built-in canonical
  profile permits operation replication and forbids whole-space purge; the
  working profile forbids replication and permits purge. V1 operation digests
  do not cover the profile, and the profile API does not constrain callers
  with raw database or filesystem access.

### libSQL

- **The sync transport** (`createLibSqlOperationSyncTransportV1`) confirms that
  the remote uses the same wire contract, byte for byte, and accepts only
  fast-forward history.
- **The direct libSQL store** (`@hraness/oh/libsql`), which makes libSQL the
  primary store, also enforces compare-and-swap batches. It refuses to open a
  space under a realm (a label your host chooses) or a profile other than the
  ones the space was created with.
- **Your application** remains responsible for transport security,
  credentials, access control, tenant isolation, backups, and service
  configuration in both modes.
- **Schema creation** for the direct libSQL store happens only in
  `bootstrapOhLibSqlAuthorityV1`. Use a short-lived schema credential for that
  step and a narrower data credential for runtime opens, commits, reads, and
  host-controlled purge.
- **A reader or purge worker** can hold a credential that cannot create spaces
  or bindings. `openExistingOhLibSqlStoreAuthorityV1` verifies an existing
  space with reads only, and `purgeOhLibSqlWorkingSpaceV1` needs no permission
  to create spaces or bindings.

### Agent memory

`createOhMemoryAuthorityV1` (`@hraness/oh/memory`) binds two stores: a working
store the agent writes, and a canonical store the agent can only read, at a
head the host selects. It returns an `agent` object for the model and a
separate `host` object for trusted code.

- **Access control** comes from which objects code holds, and it applies only
  inside one process. The memory API is not a tenant authenticator or a
  sandbox. The host must:
  - bind the canonical and working store handles;
  - check tenant and session authorization before every call;
  - keep raw credentials and purge handles out of model tools;
  - never reuse the objects from one `createOhMemoryAuthorityV1` call across
    authorization domains;
  - give a model only the four-method `agent` object (`remember`, `query`,
    `explain`, and `nominate`), and keep the `host` object, which can advance
    canonical knowledge, in trusted control-plane code.
- **Requests and bound-store responses** are copied once by a recursive walk
  over their data-property descriptors: a request at method entry, and a store
  response before Oh parses or compares it. Accessors are rejected without
  being called, and symbols, proxies, sparse arrays, and non-JSON values are
  rejected too. Parsing, byte limits, digests, and execution all read that one
  frozen copy. The walk rejects a value nested deeper than 128 levels, with
  more than 65,536 entries in one container, or with more than 1,048,576
  nodes in total. It also counts canonical JSON bytes as it goes, so a value
  over its byte limit fails before the copy finishes. Do not treat this
  validation as a sandbox for host callbacks or store implementations.
- **Fact extractors** are trusted host code, and they receive complete record
  values. An extractor’s declared digest identifies its policy; it does not
  sandbox, authenticate, or vouch for the JavaScript function. Review
  extractors as code, make them deterministic, and give them no network, file,
  or credential access beyond what they need. Oh limits how many times
  extractors run, how many facts they return, and the size of each fact, but
  not how long a synchronous extractor runs or how much temporary memory it
  uses.
- **Explanation tokens** from `query` are short-lived bearer tokens, valid only
  in the process that issued them and bound to one exact result. A token can
  explain several rows until it expires or is evicted. Tokens last 15 minutes
  by default, and `explainCapabilityLifetimeMs` accepts a whole number of
  milliseconds from 1,000 to 3,600,000 (1 second to 1 hour). Advancing the
  canonical head creates a new agent generation, but every generation shares
  one token registry, capped at 256 tokens and 64 MiB, and one set of clock
  guards that reject time running backward, so the caps and expiry order hold
  across advances. Do not log or persist tokens, share them across tenants, or
  treat one as proof that a caller may read either store.
- **`OhMemoryContinuationError`** means only that a caller’s cursor was
  malformed, failed authentication, or no longer matches the exact query,
  result, and memory state it was issued for. Store integrity, query
  evaluation, extractor, and availability failures keep their own error types,
  so handle them separately.
- **Adopting a nomination** (`adoptNomination`, host-only) applies the
  8,192-record and 32 MiB limits to the canonical snapshot the adoption would
  produce, before its single compare-and-swap write, and then reconciles the
  head that write returns with the store’s current head. Duplicate operation
  IDs and concurrent later writes cannot roll memory back to an intermediate
  head.
- **Replacing a canonical record** is host-only. It requires the canonical
  head the host reviewed and, for each record key it replaces, the digest of
  the record being replaced. Omitted, stale, wrong, duplicate, and absent-key
  claims are rejected. Oh validates every claim, even one for a key that
  already holds the nominated record, and when the same request is replayed,
  it checks each claim against that request’s reviewed head. Replacement never
  auto-merges and never uses last-write-wins.
- **`advanceCanonical`** accepts at most 16,384 operations and 64 change-feed
  pages per call. Advance a longer history in reviewed chunks.
- **Query rows** are derived even when every visible premise comes from the
  canonical store. A prepared nomination is a content-addressed proposal for a
  later review by its destination; it is not approval, sync, or permission to
  change canonical knowledge.

### Semantic search

- **The QMD cache**, kept by the optional local embedding engine, contains
  derived text from records. Protect and delete it according to the
  sensitivity of the source database.
- **The hosted adapter** (`@hraness/oh/semantic-cloud`) runs inference
  remotely. It sends source titles and content, rendered into inputs of at
  most 448 UTF-8 bytes, over HTTPS to the fixed Cloudflare Workers AI
  EmbeddingGemma route, and it sends every search query to the same route.
  Decide whether your source data may leave your systems this way before you
  enable it, and apply the Cloudflare account’s current data-processing,
  logging, geography, retention, and abuse policies. The adapter’s errors
  carry only a fixed classification and an optional HTTP status, but that
  does not stop a host, proxy, or the provider from logging request data
  outside Oh.
- **Give the hosted adapter a least-privilege account token** that can invoke
  Workers AI only. Keep the token and account ID in trusted host
  configuration, never in an Oh record, memory page, model tool argument,
  browser bundle, log, or semantic database. Configure provider budgets and
  usage alerts: Oh limits each request and each staged generation, but it does
  not enforce an account-wide spending ceiling or protect against calls made
  with the same token outside Oh.
- **The V2 semantic cache** in direct libSQL deliberately stores no source
  title, body, query, record JSON, account ID, or provider token. It does keep
  record keys and digests, formatted-input digests, the embedding vectors,
  generation timing, authority IDs (each names one set of Oh records that the
  cache indexes), and opaque isolation digests (`isolationSha256`). Treat
  these values as sensitive: they can reveal equality across raw vector bytes
  or known input digests, and they may support dictionary guesses for known
  text. Isolation keeps each authority’s and each epoch’s cache rows apart, so
  none reuses another’s cache entries or depends on another for deletion. It
  is not encryption and does not hide equal embedding output from anyone who
  holds the database. Use a separate protected database and short-lived schema
  credentials, and scope runtime and purge credentials to the operations each
  role needs.

### Deleting data

- **A working-store purge** removes rows reachable through the supported
  store and leaves a purge receipt: a stored record of the purge that holds no
  record content. It does not erase provider backups, replicas outside that
  store, copies exported with `exportDependencyClosure`, logs the host
  created, or bytes copied by a process that already held raw credentials.
  Base any retention promise on every system that holds or backs up a copy.
- **A V2 semantic-cache purge** writes a permanent authority tombstone and
  removes that authority’s heads, generations, memberships, and every vector
  in the isolation scopes it reserved. Its receipt records that no
  generations, memberships, or scoped vectors remained in the live database,
  and replaying the purge returns the same receipt. It does not erase
  Cloudflare processing or logs, libSQL backups and replicas, host logs,
  network captures, or bytes copied by a holder of raw credentials.

To expire working memory:

1. Stop new writes.
2. Purge the semantic cache.
3. Purge the working space in the primary store.
4. Acknowledge expiry only after both purges have completed. A failed cache
   purge stays retryable, and a successful store purge does not make it
   complete.
