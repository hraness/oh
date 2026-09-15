# Portable research profile

The optional `@hraness/oh/research` entry point supplies typed research records,
versioned vocabularies, proposal compilation and offline Wikidata capture
verification. `@hraness/oh/research-store` connects verified packets to an
explicit Oh store. Both are introduced in package version 0.5.0.

The profile preserves the `sponge.*` source namespaces and source digest
preimages. These names identify a public wire contract; using it requires no
Sponge account, server, editor or database. The base `oh.ontology.v1` contract,
its native parsers and applied storage migrations remain unchanged.

## Meaning and evidence

A statement represents a proposition. An assertion records its attributed
stance, purpose and review state. Evidence records how a source bears on an
assertion. Context and qualifiers carry time, place, language, method,
population and other scope. An entity's opaque identity is separate from its
labels, types and lifecycle revisions.

Values support entities, multilingual text, strings, booleans, arbitrary-precision
integer strings, decimal strings, quantities, time with precision and
uncertainty, intervals, durations, recurrences, geometry, URIs, identifiers,
media, lists, sets and explicitly registered extensions. Exact schema
references contain namespace, code, revision and schema digest. A label or
external identifier does not establish schema or entity identity.

`parseKnowledgeGraphRecordV1` verifies the source record for its kind, including
its canonical digest. Constructors and parsers are asynchronous where SHA-256
verification is required. `canonicalJson` and `sha256Text` in this entry point
implement the source preimages with Web Crypto. The portable module has no
required runtime dependencies or access to a host's credentials.

URI admission rejects the executable `javascript:`, `data:` and `vbscript:`
schemes and local `file:` references. Values must also have no URL credentials
and already match their canonical URL serialization. The initial research
profile security repair adds the missing `vbscript:` rejection; it changes
neither canonical digest preimages nor accepted benign URI bytes. A previously
stored record containing such a URI remains unchanged and fails revalidation.
Other URI schemes can represent identifiers; parsing a URI does not authorize
navigation, execution or source acquisition.

## Select vocabularies

`spongeKnowledgeDomainCatalog()` returns a core pack, a reference pack and
14 optional domain packs, containing 182 schema definitions in total:

| Pack | Scope |
| --- | --- |
| `sponge.language` | Words, phrases, senses and language relationships |
| `sponge.culture` | Cultural references, symbols and motifs |
| `sponge.natural-world` | Natural phenomena and observations |
| `sponge.body` | Anatomical features and bodily observations |
| `sponge.research` | Papers, methods, datasets and research results |
| `sponge.substances` | Substances, supply chains and vendor evidence |
| `sponge.organizations` | Organizations, products and company history |
| `sponge.editorial` | Events, categories and editorial coverage |
| `sponge.software` | Software, models, benchmarks and agent harnesses |
| `sponge.music` | Musical works, recordings and related knowledge |
| `sponge.people` | Person and contact relationships |
| `sponge.finance` | Instruments, strategies and financial observations |
| `sponge.formal-systems` | Computation, formal systems and artificial life |
| `sponge.agent-work` | Tasks, attempts, artifacts, checks and skills |

`spongeKnowledgeDomainCatalogV4()` adds the optional `sponge.identity-context`
pack without changing V1–V3 bytes. It supplies reusable identity, identifier
scheme, temporal, spatial, evidence, typed value and provenance records. See
[identity-context-v1.md](./identity-context-v1.md). The pack remains open-world:
relations never merge identities or imply truth, completeness, conversion,
access or publication authority.

The original definitions and manifests are MIT licensed. These packs are a
curated starting vocabulary. They do not contain a copy of Wikipedia or
Wikidata, and they do not assert complete coverage of any domain. Imported
source material retains its own attribution and license requirements.

Manifests pin exact schema, vocabulary, shape, codec and dependency digests.
Resolve them with `resolveKnowledgeVocabularyPacksV1` and verify the resulting
lock with `verifyKnowledgeVocabularyPackLockV1`. Catalog availability is
separate from installation in a host's selected graph. A host MUST check
actual installed definitions against the chosen lock before accepting a draft.
The value codecs load only their core and reference definitions.

## Compile an agent proposal

`parseSpongeKnowledgeProposalDraftV3` accepts an untrusted draft.
`compileSpongeKnowledgeProposalV3` also requires a caller-supplied context with
an explicit author, space, time, operation receipt, authoring policy, installed
schema definitions and permitted existing entities. The host MUST obtain this
context from its own trusted boundary, independently of the draft.

Compilation creates proposed, private records and retains source attribution.
It cannot authenticate an author, accept a claim, install a vocabulary or
publish a result. Schema candidates remain unreviewed. Review and rights
records have portable formats and deterministic evaluation rules; their
presence in a packet is not proof that the receiving host has accepted them.

## Preserve a captured Wikidata revision

`createKnowledgeWikidataImportPreviewV1` takes a bounded request containing
captured JSON source strings, requested and resolved entity IDs, redirects,
source URIs, capture times, selected properties and explicit coverage. Each
capture declares complete-entity, selected-properties or partial coverage.

The preview retains source-byte digests, source revision, statement ranks,
value/some-value/no-value snaks, qualifiers, references, metadata and an
omission ledger. External IDs and mapping candidates remain distinct from
local assertions. `verifyKnowledgeWikidataImportPreviewV1(preview, request)`
regenerates the preview from that original request. Neither function fetches
content, follows a redirect, logs into a provider or grants disclosure rights.

## Exchange a verified packet

`prepareOhResearchPacketV1({ records })` takes complete source records, using
`callerRecordKey` only for source kinds that require it. It verifies source
codecs and digests before creating immutable Oh envelopes. Every required
explicit graph digest and exact schema reference MUST resolve inside the
packet with the correct kind. Cyclic graph references are retained. Missing,
wrong-kind and inconsistent schema references fail verification.

An envelope retains the original source kind, logical record key, semantic
digest and exact canonical value. Its Oh key binds the complete snapshot's source identities, including logical
keys, so aliases with identical semantic bytes in separate snapshots remain
distinct. Duplicate source digests inside one packet are rejected. Exact replay
and reordering preserve transport keys; changing the snapshot can repeat
unchanged source records under new transport keys. A source digest,
an Oh envelope digest and a packet digest are separate identities. Logical
entity references remain source data; this transport does not select current
entity heads. Artifact, policy and external receipt digests are retained as
opaque source data when their contract does not identify a graph dependency.

`verifyOhResearchPacketV1` rebuilds the packet, dependencies and both digest
layers. Prepared packets are frozen and carry a private in-process verification
mark. `createOhResearchPacketCodecRegistryV1` returns a sealed synchronous
allowlist of their exact values; the registry alone does not verify an
envelope's key, dependency list or receiving authority. Use the packet commit
helper for writes.

`commitOhResearchPacketV1` requires an explicit store, actor, expected head,
operation ID and instant. It checks immutable key collisions and commits one
compare-and-swap operation. `exportOhResearchPacketV1` reads a selected dependency
closure at an exact local head. Select all saved packet record keys as roots:
V1 export requires the complete prepared snapshot to reproduce its binding.
A partial closure fails explicitly, even if its individual records are valid. `restoreOhResearchPacketV1` verifies an export
and creates a new local operation under the receiving caller's authority.
It does not impersonate the source operation log or synchronize divergent
histories. Generic database tools can still write generic Oh records; only the
research helpers provide this profile's verification boundary.

A packet admits at most 1,024 source records, 8 MiB of source JSON, 16 MiB of
packet JSON, 1 MiB per record and 4,096 dependencies per record. Storage commit
also requires both the complete current and resulting snapshots to contain
at most 8,192 records; a larger store or operation fails explicitly. These are admission bounds, not an assurance that any
particular source collection fits. The receiving host remains responsible for
identity selection, authenticated authority, current rights, and purpose.

## Host boundaries

Sponge can use the profile for its document and review workbench while keeping
accounts, authorization, live rights decisions and publication under its own
control. Wordcell can project Markdown and Git source snapshots into research
packets while retaining Markdown and Git as its source authority. Neither
consumer becomes a required dependency of Oh or of the other consumer.

An agent chooses the tools used to acquire sources, performs research and
submits a proposal to its selected host. A browser provider may return capture
receipts; those are inputs to verification. The research package requires no
hosted agent and does not select a model or subscription.

This immutable record format is unsuitable for secrets or personal payloads
that must later be erased from all history. A host needs separately deletable,
access-controlled payload storage and durable non-sensitive references before
using that workflow. The person/contact vocabulary alone does not implement
such storage.

## Offline commands

The CLI opens no database and performs no network calls for these commands:

```sh
oh research catalog
oh research validate-draft --file proposal.json
oh research wikidata-preview --file captures.json
oh research prepare-packet --file source-records.json
oh research verify-packet --file packet.json
```

File inputs must be bounded regular files. Output is canonical JSON. The
commands validate or prepare artifacts; they do not install packs or accept
proposals. See the [profile manifest](manifest.json), [packet schema](packet.schema.json)
and colocated `src/research/*.test.ts` conformance tests for exact limits,
source preservation, malformed inputs and round-trip evidence.

## Qualified profiles and Wikidata coverage

Package 0.6.0 adds a separate qualified catalog and V2 source-preserving
Wikidata importer while retaining this original packet and catalog contract.
See [coverage and qualified profiles](coverage-v2.md) for the pinned inventory,
units, relationship constraints and explicit installation lineage.

Package 0.7.1 adds [source relationships](source-relations-v1.md) through a new
catalog and mapping version. It preserves every previous pack and preview.
