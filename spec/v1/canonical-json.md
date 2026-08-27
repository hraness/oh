# Canonical JSON and digests V1

Every content digest in Oh is SHA-256 over UTF-8 canonical JSON. The lowercase
64-character hexadecimal digest is part of the record, operation, schema,
vocabulary, contract, or sync envelope that names it.

## Accepted JSON

V1 accepts JSON null, booleans, strings, finite numbers other than negative
zero, arrays, and plain objects. It rejects non-finite numbers, `-0`, unpaired
UTF-16 surrogates, cycles, non-plain objects, `undefined`, bigint, symbols, and
functions.

Canonical encoding has these rules:

1. Sort object keys by JavaScript's default UTF-16 code-unit order.
2. Preserve array order exactly.
3. Encode strings and finite numbers with the ECMAScript JSON representation.
4. Emit no insignificant whitespace.
5. Preserve a valid string's code points. General canonical JSON does not
   normalize text. Ontology text fields separately require NFC where stated.

The result is RFC 8785-style canonical JSON for the narrower JSON subset
accepted by Oh. Implementations MUST reproduce Oh's exact V1 ordering and
number rules instead of substituting a serializer whose edge cases differ.

## Parsing canonical bytes

A canonical JSON parser MUST bound input before parsing, parse JSON, encode the
value again with the V1 rules, and require byte-for-byte equality with the
input. Pretty-printed or differently ordered JSON can be accepted as user
input only when the receiving command explicitly canonicalizes it before the
value reaches a persisted or exchanged boundary.

## Digest preimages

Each creator hashes the envelope without its own digest field:

- `recordSha256` hashes `dependencies`, `key`, `kind`, `v`, and `value`.
- `schemaSha256` hashes the schema revision without `schemaSha256`.
- `vocabularySha256` hashes the vocabulary revision without
  `vocabularySha256`.
- `recordsSha256` hashes the ordered complete record-reference array. Each
  reference contains `dependencies`, `key`, `kind`, `sha256`, and `v`.
- `graphRevisionSha256` hashes `changes`, `operationId`,
  `parentGraphRevisionSha256`, `recordsSha256`, `revision`, and `v`.
- `operationSha256` hashes the operation without `operationSha256`.
- `bundleSha256` hashes the sync bundle without `bundleSha256`.
- `contractSha256` hashes the contract manifest without `contractSha256`.

Parsers MUST recompute and compare the digest. They MUST NOT trust a digest
because its syntax is valid.

## Bounds

V1 bounds a graph record value at 1,048,576 canonical UTF-8 bytes and an
operation at 67,108,864 bytes. The general canonical text parser defaults to
16 MiB. More specific ontology fields may have smaller limits. A receiver MUST
apply the smallest applicable bound before unbounded allocation or work.
