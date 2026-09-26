# Canonical JSON and digests V1

Every content digest in Oh is SHA-256 over UTF-8 canonical JSON. A digest is
written as 64 lowercase hexadecimal characters and is a field of the record,
operation, schema, vocabulary, contract, or sync envelope it identifies.

## Accepted JSON

V1 accepts JSON null, booleans, strings, finite numbers other than negative
zero, arrays, and plain objects. It rejects non-finite numbers, `-0`, unpaired
UTF-16 surrogates, cycles, non-plain objects, `undefined`, bigint, symbols, and
functions.

Canonical encoding follows five rules:

1. Sort object keys by JavaScript’s default UTF-16 code-unit order.
2. Preserve array order exactly.
3. Encode strings and finite numbers with the ECMAScript JSON representation.
4. Emit no whitespace outside strings.
5. Preserve the code points of a valid string. Canonical encoding does not
   normalize text. Some ontology text fields separately require NFC, as the
   [ontology specification](ontology.md#values) states.

The result is RFC 8785-style canonical JSON for the narrower subset of JSON
that Oh accepts. Implementations MUST reproduce Oh’s exact V1 ordering and
number rules instead of substituting a serializer whose edge cases differ.

## Parsing canonical bytes

A canonical JSON parser MUST enforce a size limit on its input before parsing,
parse the JSON, encode the value again with the V1 rules, and require
byte-for-byte equality with the input. A command can accept pretty-printed or
differently ordered JSON as user input only when it explicitly canonicalizes
the value before storing or exchanging it.

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

## Size limits

V1 limits a graph record value to 1,048,576 canonical UTF-8 bytes and an
operation to 67,108,864 bytes. The general canonical text parser has a default
limit of 16 MiB. Some ontology fields have smaller limits. A receiver MUST
apply the smallest applicable limit before any allocation or work whose size
the input controls.
