# Memory pages and `.oh.md` files

A memory page lets an agent keep a readable note, such as a session summary or
a long-running task’s state, as an ordinary Oh record that you can also save
as a Markdown file and read back byte for byte. `@hraness/oh/memory-page`
builds the record, renders the file, and parses it again. It runs on Bun and
Node 24.

## Build a page

A memory page is an ordinary `edition` record with Markdown text, a list of
the sources it was written from, and a reference to a receipt your host wrote
when it vouched for the page (`kind: "host-attested"`). Summaries and agent
notes get the same record format as everything else, with no second memory
ontology. The `.oh.md` form holds the record key, dependencies, digest,
metadata, and body:

```ts
import {
  createOhMemoryPageRecordV1,
  renderOhMemoryPageMarkdownV1,
} from "@hraness/oh/memory-page";

const page = createOhMemoryPageRecordV1({
  dependencies: ["activity:memory-attestation"],
  key: "edition:session-summary",
  value: {
    body: "## Current state\n\nThe provider rollout is paused before activation.",
    createdAt: "2026-08-31T12:00:00.000Z",
    format: "oh.memory-page.v1",
    language: "en",
    provenance: {
      actorId: "host.memory",
      attestationSha256: receiptSha256,
      attestedAt: "2026-08-31T12:00:00.000Z",
      kind: "host-attested",
      v: 1,
    },
    sources: [],
    summary: "The exact resumable session frontier.",
    title: "Session frontier",
    updatedAt: "2026-08-31T12:00:00.000Z",
    v: 1,
  },
});

const portable = renderOhMemoryPageMarkdownV1(page);
```

`receiptSha256` stands for the digest of your host’s own attestation record,
here `activity:memory-attestation`. `createOhMemoryPageRecordV1` throws a
`TypeError` for input that fails any rule below.

## Rules a page follows

| Field | Limit |
| --- | --- |
| `body` | Markdown, at most 512 KiB. |
| `summary` | At most 8,192 bytes. |
| `title` | One line, at most 512 bytes. |
| `language` | A language tag of at most 255 bytes. |
| `sources` | At most 128, each with a unique URL of at most 4,096 bytes, a one-line title of at most 1,024 bytes, and an `observedAt` time. |
| Whole value | At most 768 KiB as canonical JSON. |
| `.oh.md` file | At most 1 MiB. |

Times are canonical UTC instants, and they must be in order: `createdAt` is no
later than `updatedAt`, `updatedAt` no later than the attestation’s
`attestedAt`, and every source’s `observedAt` no later than `updatedAt`.

`renderOhMemoryPageMarkdownV1(record)` returns the file text and throws a
`RangeError` past 1 MiB. `parseOhMemoryPageMarkdownV1(text)` returns the record
or `null`, and `parseOhMemoryPageRecordV1(value)` does the same for a record
already in memory. Register `OH_MEMORY_PAGE_RECORD_CODEC_V1` only in a space
where every `edition` record is a memory page.

The page never stores vectors, model IDs, scores, or provider settings. Treat
its Markdown and source titles as untrusted input when you display or prompt
with them. The [memory-page specification](../spec/v1/memory-page.md) defines
the file format and the round-trip rules.
