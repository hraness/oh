# Content occurrences and lexical context V1

This pack connects lexical forms and contextual senses to particular usages, and connects text usages, cultural references and depictions to retained content. A locator belongs to the relation to one retained version. Later content at the same URL does not change that relation.

`createSpongeContentOccurrencesPackV1(previous)` accepts catalog V5 and returns revision 1 of `sponge.content-occurrences`. Catalog V6 includes this pack. It adds one concept and eight predicates without changing earlier declarations. Its direct dependencies are `sponge.core`, `sponge.culture`, `sponge.foundation`, `sponge.language` and `sponge.reference`, pinned to their V5 manifests. These are original local definitions under MIT; no upstream vocabulary mapping is claimed.

## Follow a usage to its retained source

The four lexical predicates are `text-realizes-form`, `text-expresses-sense`, `text-in-language-system` and `form-in-language-system`. Text occurrences, forms, senses and language systems retain their existing distinct concepts. A multilingual passage can have several stated languages. A spelling alone does not establish a language or sense.

`occurrence-in-version` accepts a language text occurrence, cultural reference occurrence or depiction and points to a `retained-content-version`. Its `source-native-locator` qualifier retains an exact source selector, such as a page and line, document block, image region or media interval. Include the selector scheme, units and coordinate basis in that string when the source supplies them. The pack does not parse selectors or invent missing precision. A bare locator on an occurrence does not complete the version-bound query path.

`content-version-of` links the retained version to the source, artifact or work whose content was retained. A document can use the existing source concept. `retained-content` uses the existing `media` value, including `sourceEntityId`, `sourceSha256` and `mediaType`; the digest identifies the retained bytes, including textual content. A version must have one content value and one containing identity to satisfy its executable shape. The content source must be the host-authorized retention source; the containing identity may be a separately identified original work or physical artifact.

The media value reuses the host's retention and access model. A graph declaration does not itself retain bytes, verify their digest, fetch a URL or authorize access. Hosts must resolve the retained source and check its bytes before claiming that a locator has been verified. Keep different transcriptions, image crops and rendered representations as distinct versions with their own digests. Use existing `derived-from` and provenance activities when the transformation is known.

Existing reference and foundation qualifiers retain source, language, method, time, retrieval and version context on the new relations. Existing proposal evidence identifies the cited source and selector. Retained versions are sources and can serve as evidence identities. Agent-supplied evidence remains agent-supplied: this pack does not promote it to a verified capture. An article URL, revision label or retrieval time by itself is insufficient to complete the retained-content path.

## Example queries

The compiler tests use synthetic retained passages containing the English phrase “dark horse” and the Spanish phrase “caballo de batalla”. Each passage has its own form, language and attributed contextual sense; the example does not assert that these two phrases translate each other. Starting at either sense, reverse `text-expresses-sense`, follow `text-realizes-form` and `form-in-language-system`, then follow `occurrence-in-version` with its locator to `retained-content` and `content-version-of`. The result includes the source bytes' digest, language, form, sense and exact selector. A later revision under the same source identity remains a separate result.

A second synthetic example records a curator's interpretation of a horse motif in a brand article and its illustration. The article is `about` the brand. A reference occurrence `alludes-to` the motif and a depiction `depicts` it; each independently follows `occurrence-in-version` to the retained article or image bytes. The allusion has source attribution and proposal evidence for the curator's interpretation. Image containment does not imply that the brand endorses the interpretation, and a depiction alone does not assert an allusion.

These paths use proposed facts and provide no automatic identity merging or accepted conclusion. Full grammar, etymological reconstruction, universal translation equivalence, inferred influence and exhaustive cultural coverage remain outside this pack.
