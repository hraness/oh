import { describe, expect, test } from "bun:test";
import { sha256Text } from "../src/research/integrity-domain";
import { spongeKnowledgeDomainCatalogV5 } from "../src/research/knowledge-domain-catalog-v5";
import { parseKnowledgeEntityId, type KnowledgeEntityV1 } from "../src/research/knowledge-ontology-v1";
import {
  compileSpongeKnowledgeProposalV3,
  type SpongeKnowledgeExistingEntityV3,
  type SpongeKnowledgeProposalCompilerAuthorityV3,
} from "../src/research/knowledge-proposal-compiler-v3";
import type { SpongeKnowledgeProposalDraftV3 } from "../src/research/knowledge-proposal-v3";

type SchemaCode = readonly [namespace: string, code: string];
type Join = Readonly<{ subject: SchemaCode; predicate: SchemaCode; object: SchemaCode }>;
const support = ["sponge.identity-context", "supports-claim"] as const;
const listing = ["sponge.bridge-relations", "listing-at-venue"] as const;
const profile = ["sponge.bridge-relations", "profile-for-account"] as const;
const validJoins = [
  { subject: ["sponge.identity-context", "evidence-bundle"], predicate: support, object: ["sponge.identity-context", "identity-claim"] },
  { subject: ["sponge.identity-context", "evidence-item"], predicate: support, object: ["sponge.identity-context", "identity-claim"] },
  { subject: ["sponge.finance", "listing"], predicate: listing, object: ["sponge.core", "place"] },
  { subject: ["sponge.finance", "listing"], predicate: listing, object: ["sponge.core", "organization"] },
  { subject: ["sponge.people", "profile-projection"], predicate: profile, object: ["sponge.core", "account"] },
  { subject: ["sponge.people", "public-profile-document"], predicate: profile, object: ["sponge.core", "account"] },
] as const satisfies readonly Join[];
const wrongJoins = [
  { subject: ["sponge.identity-context", "identity-claim"], predicate: support, object: ["sponge.identity-context", "identity-claim"] },
  { subject: ["sponge.identity-context", "evidence-item"], predicate: support, object: ["sponge.core", "source"] },
  { subject: ["sponge.finance", "instrument"], predicate: listing, object: ["sponge.core", "organization"] },
  { subject: ["sponge.finance", "listing"], predicate: listing, object: ["sponge.core", "agent"] },
  { subject: ["sponge.people", "source-contact-record"], predicate: profile, object: ["sponge.core", "account"] },
  { subject: ["sponge.people", "public-profile-document"], predicate: profile, object: ["sponge.core", "person"] },
] as const satisfies readonly Join[];

async function fixture(join: Join) {
  const catalog = await spongeKnowledgeDomainCatalogV5();
  const ref = ([namespace, code]: SchemaCode) => {
    const schema = catalog.schemas.find(item => item.identity.namespace === namespace && item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing fixture schema ${namespace}/${code}.`);
    return schema.ref;
  };
  const actorId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`);
  const sourceId = parseKnowledgeEntityId(`kent_${"b".repeat(24)}`);
  if (actorId === null || sourceId === null) throw new Error("Invalid fixture identities.");
  const entity = (entityId: KnowledgeEntityV1["entityId"]): KnowledgeEntityV1 => ({
    entityId, identityOperationId: "identity.depth-fixture", identityRevision: 1,
    redirectEntityId: null, state: "active", v: 1,
  });
  const authority: SpongeKnowledgeProposalCompilerAuthorityV3 = {
    authorEntityId: actorId, authoringPolicySha256: await sha256Text("depth fixture policy"),
    externalOperationReceiptSha256: await sha256Text("depth fixture receipt"),
    occurredAt: "2026-09-14T04:00:00.000Z", spaceId: "space.depth-fixture", schemas: catalog.schemas,
    existingEntities: new Map<string, SpongeKnowledgeExistingEntityV3>([
      [actorId, { entity: entity(actorId), concepts: [ref(["sponge.core", "agent"])] }],
      [sourceId, { entity: entity(sourceId), concepts: [ref(["sponge.core", "source"])] }],
    ]),
  };
  const time = { kind: "time", calendar: ref(["sponge.reference", "gregorian-calendar"]),
    certainty: "exact", earliest: null, latest: null, precision: "day", timezone: null, value: "2026-09-14", v: 1 } as const;
  const draft: SpongeKnowledgeProposalDraftV3 = {
    v: 3,
    entities: [
      { key: "subject", kind: "new", concepts: [ref(join.subject)], name: { language: "en", text: `Synthetic ${join.subject[1]}` } },
      { key: "object", kind: "new", concepts: [ref(join.object)], name: { language: "en", text: `Synthetic ${join.object[1]}` } },
    ],
    contexts: [],
    facts: [{ key: "relation", subject: { kind: "key", key: "subject" }, predicate: ref(join.predicate),
      object: { kind: "entity-key", entityKey: "object" }, stance: "reports", contextKey: null,
      qualifiers: [
        { predicate: ref(["sponge.reference", "source-context"]), value: { kind: "entity", entityId: sourceId, v: 1 } },
        { predicate: ref(["sponge.reference", "at-time"]), value: time },
      ] }],
    evidence: [{ key: "citation", factKey: "relation", source: { kind: "existing", entityId: sourceId },
      bearing: "supports", selector: "record 7", attribution: { kind: "agent-supplied", sourceUri: "https://example.org/depth-fixture" } }],
    vocabularyDependencies: [ref(join.predicate)],
  };
  return { actorId, authority, draft, ref, sourceId, time };
}

describe("identity and bridge joins through proposal compilation", () => {
  for (const join of validJoins) test(`${join.subject[1]} → ${join.predicate[1]} → ${join.object[1]} retains exact types and source context`, async () => {
    const { authority, draft, ref, sourceId, time } = await fixture(join);
    const compiled = await compileSpongeKnowledgeProposalV3(draft, authority);
    expect(compiled).not.toBeNull();
    if (compiled === null) throw new Error("The documented typed join must compile.");
    const records = compiled.bundle.records;
    expect(records.filter(record => record.kind === "statement").map(record => record.value)).toContainEqual(expect.objectContaining({
      subject: compiled.entityIds["subject"], predicate: ref(join.predicate),
      object: { kind: "entity", entityId: compiled.entityIds["object"], v: 1 },
      qualifiers: expect.arrayContaining([
        { predicate: ref(["sponge.reference", "source-context"]), value: { kind: "entity", entityId: sourceId, v: 1 }, v: 1 },
        { predicate: ref(["sponge.reference", "at-time"]), value: time, v: 1 },
      ]),
    }));
    const memberships = records.filter(record => record.kind === "type-membership").map(record => record.value);
    expect(memberships).toHaveLength(2);
    expect(memberships).toContainEqual(expect.objectContaining({ entityId: compiled.entityIds["subject"], concept: ref(join.subject) }));
    expect(memberships).toContainEqual(expect.objectContaining({ entityId: compiled.entityIds["object"], concept: ref(join.object) }));
    expect(records.filter(record => record.kind === "evidence").map(record => record.value)).toEqual([
      expect.objectContaining({ bearing: "supports", disclosure: "private", sourceEntityId: sourceId }),
    ]);
    expect(compiled.sourceAttributions).toEqual([expect.objectContaining({
      kind: "agent-supplied", disclosure: "private", sourceEntityId: sourceId,
      sourceUri: "https://example.org/depth-fixture", selector: "record 7",
    })]);
  });

  for (const join of wrongJoins) test(`rejects ${join.subject[1]} → ${join.predicate[1]} → ${join.object[1]}`, async () => {
    const { authority, draft } = await fixture(join);
    expect(await compileSpongeKnowledgeProposalV3(draft, authority)).toBeNull();
  });

  for (const join of [validJoins[1], validJoins[3], validJoins[5]]) test(`${join.predicate[1]} rejects undeclared and wrongly typed qualifiers`, async () => {
    const { actorId, authority, draft, ref } = await fixture(join);
    const relation = draft.facts[0];
    if (relation === undefined) throw new Error("Missing fixture relation.");
    const undeclared = { ...draft, facts: [{ ...relation, qualifiers: [
      { predicate: ref(["sponge.core", "object"]), value: { kind: "string", value: "undeclared context", v: 1 } },
    ] }] };
    const wrongRange = { ...draft, facts: [{ ...relation, qualifiers: [
      { predicate: ref(["sponge.reference", "source-context"]), value: { kind: "entity", entityId: actorId, v: 1 } },
    ] }] };
    expect(await compileSpongeKnowledgeProposalV3(undeclared, authority)).toBeNull();
    expect(await compileSpongeKnowledgeProposalV3(wrongRange, authority)).toBeNull();
  });
});
