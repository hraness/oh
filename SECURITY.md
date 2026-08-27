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
  client application remains responsible for transport security, credentials,
  access control, tenant isolation, backups, and service configuration.
- Oh does not redact record values. Do not write secrets or sensitive research
  into a space unless the database, filesystem, backups, and sync destination
  have the required protection.
- QMD is optional and local, but its cache contains derived text from records.
  Protect and delete that cache according to the sensitivity of the source
  database.

The public threat model does not treat a SHA-256 digest as a signature, an
authorization decision, or proof that a statement is true.
