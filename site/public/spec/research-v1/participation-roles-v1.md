# Participation and roles V1

This pack records who participated, the exact subject of that participation, and the role attributed to them. A recording credit, a translation credit and an organization assignment can share a role descriptor while remaining separate records with their own dates and evidence.

`createSpongeParticipationRolesPackV1(previous)` accepts catalog V6 and returns revision 1 of `sponge.participation-roles`. Catalog V7 includes this optional pack. It adds two concepts and three predicates without changing earlier declarations or locks. These are original local definitions under MIT; no upstream vocabulary mapping is claimed.

## Describe a participation

`participation` identifies one source-scoped participation or credit. `role-descriptor` identifies a stated capacity, such as adviser, recording engineer or translator. Role descriptors are entities whose names, source and interpretation remain explicit. Equal labels do not establish that two roles are equivalent.

- `participant` connects a participation to an agent, including a person or organization.
- `participation-in` connects a participation to its exact focal entity. The range deliberately permits any entity: a source may name an event, process, work, recording, edition or organization. A credit on one recording does not transfer to another recording, performance, work or edition.
- `assigned-role` connects either a participation or an existing `sponge.organizations/role-assignment` to a role descriptor.

Continue to describe organization assignments with `sponge.organizations/held-by` and `sponge.bridge-relations/role-assignment-at-organization`; add `assigned-role` to identify the stated capacity. A participation record does not replace those existing assignments or imply employment, ownership, legal authority, transaction completion or account control.

Use separate participation or assignment identities when sources distinguish credits, focal subjects, periods or capacities. Partial records are allowed. Missing participants, roles, dates or subjects remain unknown; multiple attributed descriptions can coexist.

## Keep dates and attribution with their claims

The new predicates permit the existing reference and foundation qualifiers, including `valid-during`, `at-time`, `source-context`, `retrieved-at` and `version-context`. Keep the effective interval separate from the source's publication or retrieval time. A source version is distinct from both its continuing source identity and the work or recording discussed in that source.

Native assertions retain stance, context and review state; native evidence links retain supporting or contrary source attribution. This pack supplies no new claim, confidence or provenance system. The existing proposal compiler produces proposed assertions and agent-supplied evidence, not accepted conclusions or verified captures. A URL, version entity or digest alone does not prove byte retention, capture admission or permission to access a source.

An optional open shape for `participation` checks supplied relation values without requiring complete records or limiting how many claims may coexist. Its entity-kind checks complement the compiler's typed participant and focal-entity checks; `assigned-role` retains its role-descriptor range. The V1 shape evaluator does not select claims by their temporal context or assertion stance. Passing this shape therefore does not establish context-aware conformance, a current role, absence of conflict or factual correctness.

## Follow the declarative query paths

The two query entries are inventories of exact predicate references and human-readable join guidance, not executable query programs.

For `dated-organization-roles`, find assignments with `held-by` pointing to the person and `role-assignment-at-organization` pointing to the organization. Follow `assigned-role` to the role descriptor. Return each statement's `valid-during`, `source-context` and `version-context` qualifiers where supplied. `version-of` can identify the continuing source behind a cited source version; `name` supplies display labels. The synthetic compiler example keeps one person's earlier executive assignment and later adviser assignment separate, with native evidence for both.

For `scoped-credits`, reverse `participant` from the agent, then follow `participation-in` and `assigned-role`. Return each participation's exact focal identity and its source, version and date qualifiers. The synthetic compiler example has separate credits for two recordings and a translated edition. Another edition receives no credit merely because it belongs to the same continuing work. `version-of` describes only the explicitly supplied version relationships; `name` supplies display labels. Neither query resolves conflicting sources, selects a current role or infers authorship, influence, ownership or identity.

The direct dependencies are `sponge.bridge-relations`, `sponge.core`, `sponge.foundation`, `sponge.organizations` and `sponge.reference`, pinned to their V6 manifests. The existing bridge pack brings its complete published dependency closure; resolving this extension requires 21 packs including the extension. Music and language examples use their already installed domain concepts but introduce no music- or language-specific predicate dependencies.
