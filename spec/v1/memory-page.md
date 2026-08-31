# Oh memory pages V1

An Oh memory page is a bounded Markdown document with explicit source and
host-provenance metadata. It is an application profile for an ordinary Oh
`edition` record, not a new authority, ontology, database, or search index.

The page value has `format: "oh.memory-page.v1"` and `v: 1`. Parsers require
the exact fields described here and reject unknown fields.

## Page value

| Field | Contract |
| --- | --- |
| `title` | Nonempty, single-line NFC text, at most 512 UTF-8 bytes. A line break is CR, LF, NEL, U+2028, or U+2029. |
| `summary` | Nonempty NFC text, at most 8 KiB. |
| `body` | Nonempty NFC Markdown text, at most 512 KiB. |
| `language` | `null`, `und`, or a lowercase language tag of at most 255 ASCII/UTF-8 bytes. |
| `createdAt` | Canonical UTC instant with exactly three fractional digits. |
| `updatedAt` | Canonical UTC instant no earlier than `createdAt`. |
| `sources` | At most 128 exact source objects, strictly ordered and unique by URL. |
| `provenance` | One host-owned attestation-receipt reference. |

A source has exactly `url`, `title`, `observedAt`, `contentSha256`, and `v`.
Its URL MUST be a canonical absolute HTTP or HTTPS URL, MUST NOT contain user
information, and is limited to 4 KiB. Its title is nonempty, single-line NFC
text limited to 1 KiB. `observedAt` is canonical and MUST NOT be later than the
page's `updatedAt`. `contentSha256` identifies the exact source bytes the host
observed; it does not claim that the URL will continue serving those bytes.

Every percent escape in a source URL MUST contain two uppercase hexadecimal
digits. An unreserved ASCII character (`ALPHA`, `DIGIT`, `-`, `.`, `_`, or
`~`) MUST appear literally rather than percent encoded. The WHATWG URL
serialization MUST otherwise reproduce the input exactly. These rules reject
malformed escapes and give equivalent percent-case or unreserved spellings one
canonical record identity.

The source array is a canonical set ordered by URL using Unicode code-unit
order. Two entries cannot use the same URL, even if their titles, observation
times, or content digests differ.

Provenance has exactly:

- `kind: "host-attested"`;
- the host-controlled `actorId`;
- the canonical `attestedAt` instant, no earlier than `updatedAt`;
- `attestationSha256`, the digest of a host-owned attestation receipt; and
- `v: 1`.

The codec validates the receipt digest's shape. It does not fetch the receipt,
verify a signature, decide whether the actor was authorized, or turn
caller-supplied text into trusted provenance. A consumer-facing agent facade
MUST populate and verify these fields in trusted host code rather than accept
them from model input.

The complete canonical-JSON page value is limited to 768 KiB. All text rejects
unpaired Unicode surrogates and disallowed control characters. A calendar
instant is accepted only when parsing and serializing it reproduces the exact
input.

## Oh record envelope

`createOhMemoryPageRecordV1` stores the page value in an ordinary V1 graph
record with `kind: "edition"`. The caller supplies the record key and ordered
graph dependencies. The generic Oh graph contract computes and verifies the
record digest, dependency rules, and 1 MiB record-value ceiling.

An authority that registers the memory-page codec reserves its `edition` kind
for this profile. An authority that needs other edition formats must use a
host-owned dispatching edition codec; the core registry intentionally permits
only one codec per record kind.

## Canonical `.oh.md` interchange

A `.oh.md` file is a self-contained transport for one memory-page record. The
frontmatter carries the exact V1 record key, `edition` kind, record version,
ordered graph dependencies, and `recordSha256`. Parsing recreates the record
from its page value and requires the recomputed digest to equal the frontmatter
digest. An ordinary Oh bundle remains the authoritative multi-record and
operation transport.

The file begins with `---` followed by LF, contains a fixed-order YAML 1.2
mapping, then an LF-delimited closing `---`. The Markdown body begins
immediately after the closing delimiter's LF and is preserved byte for byte.
The renderer does not add a final newline.

Every frontmatter value is a deterministic JSON string, `null`, or nonnegative
integer. U+2028 and U+2029 inside a string use the exact `\u2028` and `\u2029`
escapes so each mapping entry remains one physical YAML line; other strings use
the runtime's ordinary JSON serialization. These are valid YAML 1.2 scalars.
This exact scalar subset keeps the parser dependency-free and excludes YAML
comments, anchors, aliases, tags, implicit booleans, alternate number forms,
duplicate keys, and implementation specific schema resolution.

The fixed fields are:

```yaml
---
format: "oh.memory-page.v1"
record-v: 1
record-kind: "edition"
record-key: "edition:memory-page"
record-sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
dependency-count: 1
dependency-0000-key: "activity:page-attestation"
page-v: 1
title: "Example"
summary: "A bounded summary."
language: "en"
created-at: "2026-08-30T10:30:00.000Z"
updated-at: "2026-08-30T11:00:00.000Z"
provenance-kind: "host-attested"
provenance-v: 1
provenance-actor-id: "host.memory"
provenance-attested-at: "2026-08-30T12:00:00.000Z"
provenance-attestation-sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
source-count: 1
source-000-v: 1
source-000-url: "https://example.com/source"
source-000-title: "Example source"
source-000-observed-at: "2026-08-30T10:00:00.000Z"
source-000-content-sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
---
The Markdown body starts here.
```

The digest in this illustrative fragment is a placeholder; a conforming file
contains the graph digest recomputed from all record fields.

Dependencies use zero-based, four-digit indexes and MUST already be ordered,
unique, non-reflexive record keys. Sources use zero-based, three-digit indexes
and the exact five-key sequence shown above. Counts are checked against graph
and page limits before allocating entries.

The parser validates the page and graph record, renders the result again, and
accepts the file only when all bytes match. CRLF, reordered frontmatter, extra
whitespace, alternate JSON escapes, extra metadata, a changed body, and a stale
record digest are therefore noncanonical.

The whole file is limited to 1 MiB. Frontmatter is rejected before scalar
parsing when it exceeds 4,754 physical lines, the exact maximum implied by the
4,096 dependency and 128 source limits.

## Model and retrieval boundary

Memory pages contain no vectors, embedding model, provider, score, index
generation, or search configuration. Local and hosted retrieval systems may
derive indexes from the same record bytes, but those indexes are disposable
projections with their own exact profiles. They are not part of the page or its
record digest.

Markdown is untrusted data. A host MUST NOT treat page text, source titles, or
frontmatter strings as instructions, executable configuration, authority, or
proof that an external claim is true.
