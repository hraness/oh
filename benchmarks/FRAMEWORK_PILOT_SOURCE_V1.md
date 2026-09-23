# Shared source and context preparation for framework comparisons

The [source-unit builder](../scripts/benchmarks/framework-pilot-source-v1.ts)
defines an answer-blind input boundary for a future matched memory-framework
comparison. It validates an explicit lossless split of conversation text and
derives neutral unit identities. This is an offline preparation contract, not a
completed comparison or a live provider adapter. The separate
[context packer](../scripts/benchmarks/framework-pilot-context-v1.ts) applies a
common ranked-evidence budget after source validation.

## Prepare the source

Project the source into ordered sessions containing only neutral session
aliases, occurrence indices, dates, and ordered role/text pairs. The runtime
schema rejects unknown fields. Question records, reference answers, evidence
labels, original dataset IDs and their private mapping belong outside this
projection. Preserve authored text even when it contains words that resemble
labels or identifiers; neutrality applies to structural metadata.

Session aliases preserve equivalence: repeated occurrences of the same source
session share an alias, while their occurrence and turn identities remain
distinct. The builder preserves the order supplied by this projection. It does
not choose a chronology policy or infer equivalence from similar text.
Its ordered `occurrences` manifest retains the alias, index, date and turn count
of empty sessions. At least one session and one turn are required; an entirely
empty history is rejected.

Construct a split plan bound to the projected source digest. Every turn must be
covered by ordered, contiguous UTF-8 byte spans. Splits may occur only at valid
Unicode scalar boundaries; a combining sequence may span multiple units.
The builder rejects omitted, overlapping, reordered or
altered text rather than silently repairing it. It derives unit metadata and
digests from the checked source instead of accepting caller-authored citations.
An empty turn uses one span from byte zero to byte zero.

Losslessness is relative to this explicit source input. A dataset adapter must
separately establish that its projection includes the complete permitted raw
history. In particular, the existing benchmark `Corpus` is not interchangeable
with raw sessions: LongMemEval parsing orders turns chronologically, and its
turn-only representation cannot retain empty sessions. Do not serialize a full
`Corpus` or `Dataset` into a provider request.

## Assemble a common context

Pass already-rendered, source-validated evidence blocks to
`packFrameworkPilotContextV1`. It accepts at most 20 ranked candidates and a
context ceiling from 1 to 8,192 tokens. Each canonical candidate JSON is limited
to 65,536 bytes, and the complete canonical input to 262,144 bytes.
Its JSON-lines renderer includes the
neutral unit ID and complete content of each block. Embedded newlines cannot
impersonate a block boundary.

Supply an explicit tokenizer identity and a synchronous token-count function.
There is no default tokenizer or byte-to-token estimate. The packer counts the
entire candidate context, including IDs, JSON framing and separators; token
counts for separate blocks need not be additive. It also counts empty context
and rejects a budget that cannot accommodate it.
The identity is a caller assertion: a live run must separately pin and qualify
the actual tokenizer implementation and assets.

Identical duplicate IDs are omitted; conflicting content for one ID is rejected.
Packing preserves rank and complete blocks, stops at the first overflow, and
records omissions. It validates the complete input before counting, including
the suffix that may be omitted. It never truncates a block or selects later
smaller blocks to fill unused space.

The reported count covers the context string only. It excludes the question,
instructions and chat-message framing, so it is not a full-request token count
or proof that a model request fits. The packer does not authenticate source
provenance or establish that a provider-generated memory is a verbatim source.
Assigning a neutral unit ID to generated memory text does not turn it into a
verified source block. A later provider adapter must either resolve returned
references to authenticated original source text under a declared projection,
or use a separate contract that identifies generated memory as such. These
choices measure different retrieval behavior and must be named in the protocol.

## Verify before provider work

Run the synthetic contract checks from the repository root:

```sh
bun test tests/memory-benchmark-framework-pilot-source.test.ts
bun test tests/memory-benchmark-framework-pilot-context.test.ts
```

The [source tests](../tests/memory-benchmark-framework-pilot-source.test.ts) and
[context tests](../tests/memory-benchmark-framework-pilot-context.test.ts) check
preservation and rejection behavior without reading benchmark data, credentials
or model outcomes. Their synthetic counters do not qualify a real model
tokenizer. The [identifier audit](LONGMEMEVAL_IDENTIFIER_AUDIT_V1.md)
explains why structural aliases are part of the comparison boundary.

A checked source bundle and packing contract are requirements for a matched run. Before
execution, freeze the provider renderers, source mappings, tokenizer and context
packing, actual retrieval settings, reader and judge, complete input population,
failure accounting and spending limits. Check rendered requests separately:
source byte bounds do not establish wire size or model token fit. Provider
generated memories and verbatim source units are different evidence types;
their provenance and recall denominators need an explicit common rule.

No new reader accuracy, retrieval recall, latency or framework ranking follows
from these synthetic checks. The published results and their exposure limits
remain in the [benchmark index](README.md).
