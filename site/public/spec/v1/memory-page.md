# Oh memory pages V1

An Oh memory page is a Markdown document of limited size that lists its
sources and carries provenance supplied by the host. It is an application
profile for an ordinary Oh `edition` record. A page is stored like any other
record under the same ontology, and the format defines no database or search
index of its own.

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
| `sources` | At most 128 source objects, strictly ordered and unique by URL. |
| `provenance` | A reference to the host’s attestation receipt, described below. |

A source has exactly `url`, `title`, `observedAt`, `contentSha256`, and `v`.
Its URL MUST be a canonical absolute HTTP or HTTPS URL, MUST NOT contain user
information, and is limited to 4 KiB. Its title is nonempty, single-line NFC
text limited to 1 KiB. `observedAt` is canonical and MUST NOT be later than the
page’s `updatedAt`. `contentSha256` identifies the exact source bytes the host
observed. It makes no claim about what the URL serves later.

Every percent escape in a source URL MUST contain two uppercase hexadecimal
digits. An unreserved ASCII character (`ALPHA`, `DIGIT`, `-`, `.`, `_`, or
`~`) MUST appear literally rather than percent encoded. The WHATWG URL
serialization MUST otherwise reproduce the input exactly. These rules reject
malformed escapes and accept only one spelling of each URL, so variants in
escape case or in escaped unreserved characters cannot give the same page two
record digests.

The source array is sorted by URL in UTF-16 code-unit order. No URL appears
twice, even with a different title, observation time, or content digest.

Provenance points to an attestation receipt, the host’s own record that it
vouched for the page. Provenance has exactly:

- `kind: "host-attested"`;
- the host-controlled `actorId`;
- the canonical `attestedAt` instant, no earlier than `updatedAt`;
- `attestationSha256`, the digest of the attestation receipt; and
- `v: 1`.

The codec checks only that the receipt digest is well formed. It does not
fetch the receipt, verify a signature, decide whether the actor was
authorized, or turn caller-supplied text into trusted provenance. A
consumer-facing agent facade MUST populate and verify these fields in trusted
host code rather than accept them from model input.

The complete canonical-JSON page value is limited to 768 KiB. All text rejects
unpaired Unicode surrogates and disallowed control characters. A calendar
instant is accepted only when parsing and serializing it reproduces the exact
input.

## Oh record envelope

`createOhMemoryPageRecordV1` stores the page value in an ordinary V1 graph
record with `kind: "edition"`. The caller supplies the record key and ordered
graph dependencies. The generic Oh graph contract computes and verifies the
record digest, the dependency rules, and the 1 MiB limit on a record value.

A codec registry that includes the memory-page codec,
`OH_MEMORY_PAGE_RECORD_CODEC_V1`, reserves `edition` for this profile. A
registry that needs other edition formats must hold one dispatching edition
codec, supplied by the host, because the core registry accepts only one codec
per record kind.

## Canonical `.oh.md` interchange

A `.oh.md` file is a self-contained transport for one memory-page record. The
frontmatter carries the exact V1 record key, `edition` kind, record version,
ordered graph dependencies, and `recordSha256`. Parsing recreates the record
from its page value and requires the recomputed digest to equal the frontmatter
digest. Several records, or the operations that wrote them, travel in an
ordinary Oh sync bundle instead.

The file begins with `---` followed by LF, contains a fixed-order YAML 1.2
mapping, then an LF-delimited closing `---`. The Markdown body begins
immediately after the closing delimiter’s LF and is preserved byte for byte.
The renderer adds no final newline.

Every frontmatter value is a deterministic JSON string, `null`, or nonnegative
integer. U+2028 and U+2029 inside a string use the exact `\u2028` and `\u2029`
escapes, so each mapping entry stays on one physical YAML line; every other
value is written exactly as `JSON.stringify` writes it. These are valid YAML
1.2 scalars. Because values are limited to this subset, the parser needs no
YAML library, and files cannot contain YAML comments, anchors, aliases, tags,
implicit booleans, alternate number forms, duplicate keys, or
implementation-specific schema resolution.

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

The `record-sha256` value in this example is a placeholder; a conforming file
contains the graph digest recomputed from all record fields.

Dependencies use zero-based, four-digit indexes and MUST already be ordered,
unique, non-reflexive record keys (no record lists itself). Sources use
zero-based, three-digit indexes and the exact five-key sequence shown above.
The parser checks each count against the graph and page limits before it
allocates entries.

The parser validates the page and the graph record, renders the result again,
and accepts the file only when every byte matches. A file is therefore
noncanonical if it uses CRLF, reorders the frontmatter, adds whitespace or
metadata, uses alternate JSON escapes, changes the body, or carries a stale
record digest.

The whole file is limited to 1 MiB. The parser rejects frontmatter longer than
4,754 physical lines before it parses any scalar. That is the exact maximum
the 4,096-dependency and 128-source limits allow.

## Models and retrieval

Memory pages contain no vectors, embedding model, provider, score, index
generation, or search configuration. Local and hosted retrieval systems may
build indexes from the same record bytes. Each such index has its own exact
profile and can be deleted and rebuilt, and none is part of the page or its
record digest.

Markdown is untrusted data. A host MUST NOT treat page text, source titles, or
frontmatter strings as instructions, executable configuration, authority, or
proof that an external claim is true.
