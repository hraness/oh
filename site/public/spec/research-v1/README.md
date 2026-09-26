# Portable research profile

The optional `@hraness/oh/research` entry point supplies typed research records,
versioned vocabularies, proposal compilation, and offline verification of
Wikidata captures. `@hraness/oh/research-store` writes verified packets to an
Oh store that the caller names. Both entry points were added in package version
0.5.0.

The profile keeps the `sponge.*` source namespaces and source digest preimages.
These names identify a public wire format. Using it requires no Sponge account,
server, editor, or database. Using the profile changes nothing in the base
`oh.ontology.v1` contract, its native parsers, or the applied storage
migrations.

## Meaning and evidence

A statement represents a proposition. An assertion records who holds the
statement, for what purpose, and its review state. Evidence records how a
source bears on an assertion. Context and qualifiers carry time, place,
language, method, population, and other scope. An entity's opaque identity is
separate from its labels, types, and lifecycle revisions.

Values support entities, multilingual text, strings, booleans, arbitrary-precision
integer strings, decimal strings, quantities, time with precision and
uncertainty, intervals, durations, recurrences, geometry, URIs, identifiers,
media, lists, sets, and explicitly registered extensions. A schema reference
contains the namespace, code, revision, and schema digest. A label or external
identifier does not establish schema or entity identity.

`parseKnowledgeGraphRecordV1` verifies the source record for its kind, including
its canonical digest. Constructors and parsers are asynchronous where SHA-256
verification is required. In this entry point, `canonicalJson` produces the
source preimage bytes, and `sha256Text` hashes them with Web Crypto. The
portable module has no required runtime dependencies and no access to a host's
credentials.

The URI parser rejects the executable `javascript:`, `data:`, and `vbscript:`
schemes and local `file:` references. Values must also omit URL credentials and
equal their canonical URL serialization. The `vbscript:` rejection is a
security repair included in the first published research profile. It changes
no canonical digest preimage and no accepted benign URI bytes. A record stored
before the repair that contains a `vbscript:` URI keeps its stored bytes and
fails revalidation. Other URI schemes can represent identifiers. Parsing a URI
does not authorize navigation, execution, or source acquisition.

## Select vocabularies

`spongeKnowledgeDomainCatalog()` returns a core pack, a reference pack, and
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
pack to the V3 packs and leaves the bytes of catalogs V1 through V3 as
published. The pack supplies reusable records for identity claims, identifier
schemes, time, location, evidence, values, and provenance. See
[identity-context-v1.md](./identity-context-v1.md). The pack is open-world:
its relations never merge identities or imply truth, completeness, a
conversion, or permission to access or publish.

The original definitions and manifests are MIT licensed. These packs are a
curated starting vocabulary. They do not contain a copy of Wikipedia or
Wikidata, and they do not assert complete coverage of any domain. Imported
source material keeps its own attribution and license requirements.

Each pack manifest pins the digests of its schemas, vocabulary, shapes, codecs,
and dependencies. Resolve manifests with `resolveKnowledgeVocabularyPacksV1`.
The result is a lock that pins every resolved pack by ID, revision, and
manifest digest. Verify the lock with `verifyKnowledgeVocabularyPackLockV1`. A
pack in the catalog is not thereby installed in a host's selected graph. A host
MUST check its installed definitions against the chosen lock before accepting a
draft. The value codecs load only their core and reference definitions.

## Compile an agent proposal

`parseSpongeKnowledgeProposalDraftV3` accepts an untrusted draft.
`compileSpongeKnowledgeProposalV3` also requires a context from the caller. The
context names the author, space, time, operation receipt
(`externalOperationReceiptSha256`), authoring policy, installed schema
definitions, and the stored entities the draft may reference. The host MUST
obtain this context from its own trusted sources, independently of the draft.

Compilation creates proposed, private records and keeps source attribution. It
cannot authenticate an author, accept a claim, install a vocabulary, or publish
a result. Compilation leaves schema candidates unreviewed. Review and rights
records have portable formats and deterministic evaluation rules. Their
presence in a packet does not prove that the receiving host has accepted them.

## Preserve a captured Wikidata revision

`createKnowledgeWikidataImportPreviewV1` takes a request containing captured
JSON source strings, requested and resolved entity IDs, redirects, source URIs,
capture times, selected properties, and a coverage declaration for each
capture. By default a request may hold 100 entities, 1,000 statements, 4,096
records, and 8 MiB of source; the optional `bounds` field can lower each
limit. Each capture declares `complete-entity`, `selected-properties`, or
`partial` coverage.

A snak is Wikidata's unit of a property and its value. The preview keeps
source-byte digests, the source revision, statement ranks, value, some-value,
and no-value snaks, qualifiers, references, and metadata. Its omission ledger
lists each part of the source that the preview left out, with the reason.
External IDs and mapping candidates stay distinct from local assertions.
`verifyKnowledgeWikidataImportPreviewV1(preview, request)` rebuilds the preview
from that original request and compares canonical bytes. Neither function
fetches content, follows a redirect, logs into a provider, or grants
disclosure rights.

## Exchange a verified packet

`prepareOhResearchPacketV1({ records })` takes complete source records, using
`callerRecordKey` only for source kinds that require it. It verifies source
codecs and digests before creating immutable Oh envelopes. An envelope is the
Oh record that wraps one source record. Every required
explicit graph digest and exact schema reference MUST resolve inside the
packet with the correct kind. Cyclic graph references are kept. Missing,
wrong-kind, and inconsistent schema references fail verification.

An envelope keeps the original source kind, logical record key, semantic
digest, and canonical value. Its Oh key, also called its transport key, binds
the source identities of the whole snapshot, including logical keys. Aliases
with identical semantic bytes in separate snapshots therefore keep distinct
keys. A packet that holds the same source digest twice is rejected. Replaying
or reordering the same records gives the same transport keys. Changing the
snapshot can repeat the same source record under a different transport
key. A source digest, an Oh envelope digest, and a packet digest are separate
identities. Logical entity references stay source data, and this transport
does not select current entity heads. Artifact, policy, and external receipt
digests are kept as opaque source data when their record format does not
identify a graph dependency.

`verifyOhResearchPacketV1` rebuilds the packet, its dependencies, and both
digest layers: the envelope digests and the packet digest. Prepared packets are
frozen and carry a private in-process verification mark.
`createOhResearchPacketCodecRegistryV1` returns a sealed synchronous allowlist
of their exact values. The registry alone does not verify an envelope's key or
dependency list, and it is not a host acceptance policy. Use
`commitOhResearchPacketV1` for writes.

`commitOhResearchPacketV1` requires the caller to name the store, actor,
expected head, operation ID, and instant. It rejects a key that already holds
different bytes and commits one compare-and-swap operation.
`exportOhResearchPacketV1` reads a selected dependency closure at a given local
head. Select all saved packet record keys as roots, because a V1 export needs
the whole prepared snapshot to reproduce its binding. A partial closure fails
with an error, even if each of its records is valid.
`restoreOhResearchPacketV1` verifies an export and creates a local operation
under the receiving caller's authority. It does not impersonate the source
operation log or synchronize divergent histories. Generic database tools can
write generic Oh records. Only the research helpers apply this profile's
verification.

A packet holds at most 1,024 source records, 8 MiB of source JSON, 16 MiB of
packet JSON, 1 MiB per record, and 4,096 dependencies per record. A storage
commit also requires the whole current snapshot and the whole resulting
snapshot to contain at most 8,192 records. A larger store or operation fails
with an error. The limits do not guarantee that a given source collection
fits.

A corpus larger than the snapshot limit is split by space or domain into
packet snapshots that are committed separately. Records in one snapshot refer
to records in another only through the digests they keep, never through
unverified keys from another snapshot. The monitor and run-ledger records in
the research-operations vocabulary record which records each partition
accepted (`admitted-in-run`) and rejected (`rejected-in-run`). A future packet
or store V2 may relax the limit under a separately versioned contract; V1
limits will not be raised silently. The receiving host is responsible for
identity selection, authentication and authorization, current rights, and
purpose.

## Host responsibilities

Sponge can use the profile for its document and review workbench while keeping
accounts, authorization, live rights decisions, and publication under its own
control. Wordcell can turn Markdown and Git source snapshots into research
packets while Markdown and Git stay its source of truth. Neither consumer
becomes a required dependency of Oh or of the other consumer.

An agent chooses the tools used to acquire sources, performs research, and
submits a proposal to its selected host. A browser provider may return capture
records; verification treats them as inputs. The research package requires no
hosted agent and does not select a model or subscription.

This record format is immutable, so it is unsuitable for secrets or personal
payloads that must later be erased from all history. A host that needs that
workflow first needs payload storage it can delete and control access to,
plus durable references that hold no sensitive data. The person and contact
vocabulary does not provide such storage.

## Offline commands

The CLI opens no database and performs no network calls for these commands:

```sh
oh research catalog
oh research catalog-v7
oh research catalog-v8
oh research validate-draft --file proposal.json
oh research wikidata-preview --file captures.json
oh research prepare-packet --file source-records.json
oh research verify-packet --file packet.json
```

Each `--file` input must be a regular file of at most 16 MiB; the CLI does not
follow symbolic links. Output is canonical JSON. The commands validate or
prepare artifacts; they do not install packs or accept proposals. See the
[profile manifest](manifest.json), [packet schema](packet.schema.json), and
colocated `src/research/*.test.ts` conformance tests for exact limits, source
preservation, malformed inputs, and round-trip evidence.

## Catalog versions and Wikidata coverage

Every published catalog, schema digest, and Wikidata mapping version keeps its
bytes when a later version is added.

Package 0.6.1 added `catalog-v2` and a V2 Wikidata importer that keeps
unfamiliar source properties. The packet format and the V1 catalog stayed as
published. See [coverage and qualified profiles](coverage-v2.md) for the pinned
inventory, units, relationship constraints, and installation lineage.

Package 0.7.1 added [source relationships](source-relations-v1.md) through
`catalog-v3` and mapping catalog V2.

Package 0.8.1 added `catalog-v4` with the identity and context pack, then
[cross-domain bridge relations](bridge-relations-v1.md) through `catalog-v5`.
It also added the source-pinned `wikidata-mappings-v3` catalog. The bridge
relations make 14 cross-domain joins explicit without claiming semantic
completeness.

Package 0.9.0 added `catalog-v6` with
[measurement results](measurement-results-v1.md),
[monetary values and quotes](monetary-values-v1.md), and
[content occurrences](content-occurrences-v1.md), each selectable on its own.
Each pack defines explicit query paths and keeps absent context visible.
Resolve its dependency lock before compiling claims.

Package 0.10.0 added `catalog-v7` with [participation roles](participation-roles-v1.md)
for dated organization assignments and contributions to specific events, works,
recordings, or editions. Role descriptions and the focal entity are explicit.
Source evidence and temporal context are separate records. Manifest queries
describe joins; they do not run them.

Package 0.10.3 added `catalog-v8` with six research-evidence vocabularies:

- [Named temporal roles](temporal-roles-v1.md), which qualify only the
  predicates that declare them.
- [Evidence grading](evidence-grading-v1.md) for strata, tier ladders,
  corroboration, verbatim binding, corrections, and absence findings from
  searches with a stated scope.
- [Ordered citation clusters](citation-v1.md) with locators, quotation
  selectors, intent, and WEMI levels (work, expression, manifestation, and
  item).
- [Research operations](research-ops-v1.md) for monitors, run ledgers,
  rejections, review events, and publication policies.
- [Measured source scorecards](source-quality-v1.md).
- [Recorded source policies](source-policy-v1.md).

Each pack is additive and keeps every claim attributed to its source. A grade is not a review state, and
corroboration does not establish truth. A null result from a limited search
does not show that something is absent. A policy record does not authorize
anything.
