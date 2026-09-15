import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "./document-domain";
import { parseSha256Hex, sha256Text } from "./integrity-domain";
import { createSpongeContentOccurrencesPackV1 } from "./knowledge-content-occurrences";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import { createKnowledgeRightsDecisionV1, createKnowledgeTypeMembershipV1, evaluateKnowledgeShapeV1, parseKnowledgeGraphRecordV1 } from "./knowledge-ontology-contract-v1";
import { createKnowledgeAssertionV1, parseKnowledgeEntityId, type KnowledgeEntityV1, type KnowledgeOntologyResult, type KnowledgeSchemaRefV1, type KnowledgeStatementV1 } from "./knowledge-ontology-v1";
import { compileSpongeKnowledgeProposalV3, type SpongeKnowledgeProposalCompilerAuthorityV3 } from "./knowledge-proposal-compiler-v3";
import type { SpongeKnowledgeProposalDraftV3, SpongeKnowledgeProposalValueV3 } from "./knowledge-proposal-v3";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

const namespace = "sponge.content-occurrences";
type Fact = SpongeKnowledgeProposalDraftV3["facts"][number];
const entityValue = (entityKey: string) => ({ kind: "entity-key", entityKey }) as const;
const stringValue = (value: string) => ({ kind: "string", value, v: 1 }) as const;
function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid test record: ${result.error.field}:${result.error.code}.`);
  return result.value;
}

async function fixture() {
  const previous = await spongeKnowledgeDomainCatalogV5();
  const pack = await createSpongeContentOccurrencesPackV1(previous);
  const core = await spongeCoreKnowledgeCatalogV1();
  const schemas = [...previous.schemas, ...pack.schemas];
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const found = schemas.find(schema => schema.identity.namespace === packId && schema.identity.code === code);
    if (found === undefined) throw new Error(`Missing fixture schema ${packId}/${code}.`);
    return found.ref;
  };
  const actorId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const retentionId = parseKnowledgeEntityId(`kent_${"b".repeat(24)}`)!;
  const entity = (entityId: typeof actorId): KnowledgeEntityV1 => ({ entityId, identityOperationId: "identity.fixture", identityRevision: 1, redirectEntityId: null, state: "active", v: 1 });
  const authority: SpongeKnowledgeProposalCompilerAuthorityV3 = {
    authorEntityId: actorId, authoringPolicySha256: core.rightsPolicySha256,
    externalOperationReceiptSha256: await sha256Text("synthetic occurrence operation"),
    occurredAt: "2026-09-15T00:00:00.000Z", spaceId: "space.occurrences", schemas,
    existingEntities: new Map([
      [actorId, { entity: entity(actorId), concepts: [ref("sponge.core", "agent")] }],
      [retentionId, { entity: entity(retentionId), concepts: [ref("sponge.core", "source")] }],
    ]),
  };
  const newEntity = (key: string, packId: string, code: string, name = key, language = "en") => ({
    key, kind: "new", concepts: [ref(packId, code)], name: { language, text: name },
  }) as const;
  const fact = (key: string, subject: string, packId: string, code: string, object: SpongeKnowledgeProposalValueV3,
    qualifiers: Fact["qualifiers"] = []): Fact => ({ key: `fact.${key}`, subject: { kind: "key", key: subject },
    predicate: ref(packId, code), object, qualifiers, contextKey: null, stance: "reports" });
  const sourceQualifier = (source: string): Fact["qualifiers"] => [{ predicate: ref("sponge.reference", "source-context"), value: entityValue(source) }];
  const versionQualifier = (version: string): Fact["qualifiers"] => [{ predicate: ref("sponge.foundation", "version-context"), value: entityValue(version) }];
  const locatorQualifier = (value: string): Fact["qualifiers"] => [{ predicate: ref(namespace, "source-native-locator"), value: stringValue(value) }];
  const media = async (bytes: string, mediaType = "text/plain") => ({ kind: "media", mediaType, sourceEntityId: retentionId, sourceSha256: await sha256Text(bytes), v: 1 }) as const;
  const draft = (entities: SpongeKnowledgeProposalDraftV3["entities"], facts: readonly Fact[], evidence: SpongeKnowledgeProposalDraftV3["evidence"] = []): SpongeKnowledgeProposalDraftV3 => ({
    v: 3, entities: [...entities, { key: "retention", kind: "existing", entityId: retentionId }], facts,
    evidence: evidence.map(item => ({ ...item, factKey: `fact.${item.factKey}` })), contexts: [], vocabularyDependencies: pack.schemas.map(schema => schema.ref),
  });
  return { previous, pack, ref, authority, newEntity, fact, sourceQualifier, versionQualifier, locatorQualifier, media, draft, retentionId };
}

function statements(result: NonNullable<Awaited<ReturnType<typeof compileSpongeKnowledgeProposalV3>>>): KnowledgeStatementV1[] {
  return result.bundle.records.filter(record => record.kind === "statement").map(record => record.value as KnowledgeStatementV1);
}
function outgoing(rows: readonly KnowledgeStatementV1[], subject: string, code: string): KnowledgeStatementV1[] {
  return rows.filter(row => row.subject === subject && row.predicate.code === code);
}
function expectQueryCoverage(query: readonly KnowledgeSchemaRefV1[], facts: readonly Fact[]) {
  const declared = new Set(query.map(ref => canonicalJson(ref as unknown as JsonValue)));
  for (const fact of facts) for (const ref of [fact.predicate, ...fact.qualifiers.map(qualifier => qualifier.predicate)]) {
    expect(declared.has(canonicalJson(ref as unknown as JsonValue))).toBe(true);
  }
}

describe("content occurrences V1", () => {
  test("declares only the five needed V5 dependencies and preserves prior digests", async () => {
    const { previous, pack } = await fixture();
    const before = canonicalJson(previous as unknown as JsonValue);
    expect(pack.schemas.filter(schema => schema.kind === "concept")).toHaveLength(1);
    expect(pack.schemas.filter(schema => schema.kind === "predicate")).toHaveLength(8);
    expect(pack.dependencies.map(pin => pin.packId)).toEqual(["sponge.core", "sponge.culture", "sponge.foundation", "sponge.language", "sponge.reference"]);
    for (const pin of pack.dependencies) expect(pin).toEqual(knowledgeVocabularyPackPinV1(previous.packs.find(item => item.packId === pin.packId)!));
    const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: [...previous.packs, pack], roots: [knowledgeVocabularyPackPinV1(pack)] });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value.lock.packs.map(pin => pin.packId)).toEqual([namespace, "sponge.core", "sponge.culture", "sponge.foundation", "sponge.language", "sponge.reference"]);
    expect(canonicalJson(previous as unknown as JsonValue)).toBe(before);
    expect(String(previous.lock.lockSha256)).toBe("ad2f239537cd14021102a12c7e870c1a27fb695e4a51c123f6a7d28bbca0a2bd");
    expect((await createSpongeContentOccurrencesPackV1(previous)).manifestSha256).toBe(pack.manifestSha256);
    expect(Object.isFrozen(pack)).toBe(true);
    expect((await parseKnowledgeGraphRecordV1("vocabulary", pack.vocabulary)).ok).toBe(true);
    for (const schema of pack.schemas) expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
    for (const shape of pack.shapes) expect((await parseKnowledgeGraphRecordV1("shape", shape)).ok).toBe(true);
  });

  test("machine discovery, guide digest and version completeness shape agree", async () => {
    const { pack } = await fixture();
    const guide = await readFile(new URL("../../spec/research-v1/content-occurrences-v1.md", import.meta.url), "utf8");
    const discovery = JSON.parse(await readFile(new URL("../../spec/research-v1/content-occurrences-v1.json", import.meta.url), "utf8"));
    expect(discovery.catalog).toEqual({ factory: "spongeKnowledgeDomainCatalogV6", additionalPack: namespace, additionalPackRevision: 1 });
    expect(discovery.builder).toBe("createSpongeContentOccurrencesPackV1");
    expect(pack.sources[0]?.contentSha256).toBe(await sha256Text(guide));
    expect(pack.schemas.filter(schema => schema.kind === "concept").map(schema => schema.identity.code)).toEqual(discovery.concepts);
    expect(pack.schemas.filter(schema => schema.kind === "predicate").map(schema => schema.identity.code)).toEqual(discovery.relations);
    expect(pack.dependencies.map(pin => pin.packId)).toEqual(discovery.directDependencies);
    expect(pack.shapes[0]?.closed).toBe(false);
    expect(pack.shapes[0]?.rules.map(rule => [rule.predicate.code, rule.cardinality.minimum, rule.cardinality.maximum])).toEqual([
      ["content-version-of", 1, 1], ["retained-content", 1, 1],
    ]);
  });

  test("compiles multilingual horse phrases with separate senses, source qualifiers and exact retained versions", async () => {
    const f = await fixture();
    const entries = [
      { key: "en", name: "dark horse", language: "en", body: "A dark horse surprised the field.", selector: "plain-text:utf8-byte-range:[2,12)", sense: "An unexpected contender in this synthetic passage" },
      { key: "es", name: "caballo de batalla", language: "es", body: "El caballo de batalla sigue siendo útil.", selector: "plain-text:utf8-byte-range:[3,21)", sense: "Un recurso recurrente en este pasaje sintético" },
    ];
    const entities: SpongeKnowledgeProposalDraftV3["entities"][number][] = [];
    const facts: Fact[] = [];
    const mediaByKey = new Map<string, Awaited<ReturnType<typeof f.media>>>();
    for (const item of entries) {
      entities.push(f.newEntity(`occurrence.${item.key}`, "sponge.language", "text-occurrence", item.name, item.language),
        f.newEntity(`form.${item.key}`, "sponge.language", "form", item.name, item.language),
        f.newEntity(`sense.${item.key}`, "sponge.language", "sense", item.sense, item.language),
        f.newEntity(`language.${item.key}`, "sponge.reference", "language-system", item.language),
        f.newEntity(`document.${item.key}`, "sponge.core", "source"), f.newEntity(`version.${item.key}`, namespace, "retained-content-version"));
      const media = await f.media(item.body);
      mediaByKey.set(item.key, media);
      const scoped = [...f.sourceQualifier("retention"), ...f.versionQualifier(`version.${item.key}`)];
      facts.push(f.fact(`form.${item.key}`, `occurrence.${item.key}`, namespace, "text-realizes-form", entityValue(`form.${item.key}`), scoped),
        f.fact(`sense.${item.key}`, `occurrence.${item.key}`, namespace, "text-expresses-sense", entityValue(`sense.${item.key}`), scoped),
        f.fact(`textlanguage.${item.key}`, `occurrence.${item.key}`, namespace, "text-in-language-system", entityValue(`language.${item.key}`), scoped),
        f.fact(`formlanguage.${item.key}`, `form.${item.key}`, namespace, "form-in-language-system", entityValue(`language.${item.key}`), scoped),
        f.fact(`location.${item.key}`, `occurrence.${item.key}`, namespace, "occurrence-in-version", entityValue(`version.${item.key}`), [...scoped, ...f.locatorQualifier(item.selector)]),
        f.fact(`container.${item.key}`, `version.${item.key}`, namespace, "content-version-of", entityValue(`document.${item.key}`)),
        f.fact(`bytes.${item.key}`, `version.${item.key}`, namespace, "retained-content", media));
      const begin = Number(item.selector.match(/\[(\d+),/)?.[1]);
      const end = Number(item.selector.match(/,(\d+)\)/)?.[1]);
      expect(new TextDecoder().decode(new TextEncoder().encode(item.body).slice(begin, end))).toBe(item.name);
    }
    entities.push(f.newEntity("version.en.later", namespace, "retained-content-version"));
    facts.push(f.fact("later.container", "version.en.later", namespace, "content-version-of", entityValue("document.en")),
      f.fact("later.bytes", "version.en.later", namespace, "retained-content", await f.media("The field changed completely.")));
    expectQueryCoverage(f.pack.queries[0]!.predicates, facts);
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts, [{
      key: "sense.evidence", factKey: "sense.en", source: { kind: "key", key: "version.en" }, bearing: "supports",
      selector: entries[0]!.selector, attribution: { kind: "agent-supplied", sourceUri: "https://example.org/horse-phrases" },
    }]), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    for (const item of entries) {
      const senseId = result.entityIds[`sense.${item.key}`]!;
      const matches = rows.filter(row => row.predicate.code === "text-expresses-sense" && row.object.kind === "entity" && row.object.entityId === senseId);
      expect(matches).toHaveLength(1);
      const occurrence = result.entityIds[`occurrence.${item.key}`]!;
      expect(matches[0]?.subject).toBe(occurrence);
      expect(matches[0]?.qualifiers).toEqual(expect.arrayContaining([
        expect.objectContaining({ predicate: f.ref("sponge.reference", "source-context"), value: { kind: "entity", entityId: f.retentionId, v: 1 } }),
        expect.objectContaining({ predicate: f.ref("sponge.foundation", "version-context"), value: { kind: "entity", entityId: result.entityIds[`version.${item.key}`]!, v: 1 } }),
      ]));
      const form = outgoing(rows, occurrence, "text-realizes-form")[0]?.object;
      expect(form).toEqual({ kind: "entity", entityId: result.entityIds[`form.${item.key}`]!, v: 1 });
      if (form?.kind !== "entity") throw new Error("Missing compiled form.");
      expect(outgoing(rows, form.entityId, "form-in-language-system")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds[`language.${item.key}`]!, v: 1 });
      const locations = outgoing(rows, occurrence, "occurrence-in-version");
      expect(locations).toHaveLength(1);
      expect(locations[0]?.qualifiers).toContainEqual({ predicate: f.ref(namespace, "source-native-locator"), value: stringValue(item.selector), v: 1 });
      const version = locations[0]?.object;
      if (version?.kind !== "entity") throw new Error("Missing compiled version.");
      expect(outgoing(rows, version.entityId, "retained-content")[0]?.object).toEqual(mediaByKey.get(item.key));
      expect(outgoing(rows, version.entityId, "content-version-of")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds[`document.${item.key}`]!, v: 1 });
    }
    expect(result.entityIds["version.en"]!).not.toBe(result.entityIds["version.en.later"]!);
    expect(outgoing(rows, result.entityIds["occurrence.en"]!, "occurrence-in-version")[0]?.object).not.toEqual({ kind: "entity", entityId: result.entityIds["version.en.later"]!, v: 1 });
    expect(result.bundle.records.find(record => record.kind === "evidence")?.value).toMatchObject({ observationSha256: null, sourceEntityId: result.entityIds["version.en"]! });
    expect(result.sourceAttributions[0]).toMatchObject({ kind: "agent-supplied", selector: entries[0]!.selector });
  });

  test("locates an attributed brand horse allusion and depiction in separate article and image versions", async () => {
    const f = await fixture();
    const entities = [f.newEntity("brand", "sponge.organizations", "brand", "Synthetic Horse Brand"),
      f.newEntity("motif", "sponge.culture", "motif", "Horse motif"), f.newEntity("curator", "sponge.core", "person"),
      f.newEntity("article", "sponge.editorial", "article"), f.newEntity("image", "sponge.core", "artifact"),
      f.newEntity("reference", "sponge.culture", "reference-occurrence"), f.newEntity("depiction", "sponge.culture", "depiction"),
      f.newEntity("version.article", namespace, "retained-content-version"), f.newEntity("version.image", namespace, "retained-content-version")];
    const articleBytes = await f.media("The curator interprets this synthetic brand's illustration as a horse allusion.");
    const imageBytes = await f.media('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="20">horse</text></svg>', "image/svg+xml");
    const facts = [f.fact("brand.context", "article", "sponge.core", "about", entityValue("brand")),
      f.fact("curator.attribution", "article", "sponge.core", "authored-by", entityValue("curator")),
      f.fact("allusion", "reference", "sponge.culture", "alludes-to", entityValue("motif"), f.sourceQualifier("version.article")),
      f.fact("depicted", "depiction", "sponge.culture", "depicts", entityValue("motif"), f.sourceQualifier("version.image")),
      f.fact("reference.location", "reference", namespace, "occurrence-in-version", entityValue("version.article"), f.locatorQualifier("plain-text:sentence:1")),
      f.fact("depiction.location", "depiction", namespace, "occurrence-in-version", entityValue("version.image"), f.locatorQualifier("svg:viewBox-units:rect:[0,0,100,100]")),
      f.fact("article.container", "version.article", namespace, "content-version-of", entityValue("article")),
      f.fact("image.container", "version.image", namespace, "content-version-of", entityValue("image")),
      f.fact("article.bytes", "version.article", namespace, "retained-content", articleBytes),
      f.fact("image.bytes", "version.image", namespace, "retained-content", imageBytes),
      f.fact("article.image", "article", "sponge.core", "cites", entityValue("version.image"))];
    expectQueryCoverage(f.pack.queries[0]!.predicates, facts);
    const result = await compileSpongeKnowledgeProposalV3(f.draft(entities, facts, [{ key: "allusion.evidence", factKey: "allusion",
      source: { kind: "key", key: "version.article" }, bearing: "supports", selector: "plain-text:sentence:1",
      attribution: { kind: "agent-supplied", sourceUri: "https://example.org/brand-article" } }]), f.authority);
    expect(result).not.toBeNull();
    if (result === null) return;
    const rows = statements(result);
    expect(outgoing(rows, result.entityIds["article"]!, "about")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["brand"]!, v: 1 });
    expect(outgoing(rows, result.entityIds["article"]!, "authored-by")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["curator"]!, v: 1 });
    for (const [occurrence, version, container, predicate, media] of [
      ["reference", "version.article", "article", "alludes-to", articleBytes],
      ["depiction", "version.image", "image", "depicts", imageBytes],
    ] as const) {
      expect(outgoing(rows, result.entityIds[occurrence]!, predicate)[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds["motif"]!, v: 1 });
      expect(outgoing(rows, result.entityIds[occurrence]!, "occurrence-in-version")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds[version]!, v: 1 });
      expect(outgoing(rows, result.entityIds[version]!, "retained-content")[0]?.object).toEqual(media);
      expect(outgoing(rows, result.entityIds[version]!, "content-version-of")[0]?.object).toEqual({ kind: "entity", entityId: result.entityIds[container]!, v: 1 });
    }
    expect(outgoing(rows, result.entityIds["depiction"]!, "alludes-to")).toHaveLength(0);
    expect(result.bundle.records.find(record => record.kind === "evidence")?.value).toMatchObject({ sourceEntityId: result.entityIds["version.article"]!, observationSha256: null });
    expect(result.sourceAttributions[0]).toMatchObject({ kind: "agent-supplied", selector: "plain-text:sentence:1" });
  });

  test("compiler rejects wrong domains, wrong target concepts, unbound locator qualifiers and forged retained bytes", async () => {
    const f = await fixture();
    const entities = [f.newEntity("text", "sponge.language", "text-occurrence"), f.newEntity("form", "sponge.language", "form"),
      f.newEntity("sense", "sponge.language", "sense"), f.newEntity("language", "sponge.reference", "language-system"),
      f.newEntity("version", namespace, "retained-content-version"), f.newEntity("article", "sponge.editorial", "article"),
      f.newEntity("person", "sponge.core", "person")];
    const valid = [
      f.fact("form", "text", namespace, "text-realizes-form", entityValue("form")),
      f.fact("sense", "text", namespace, "text-expresses-sense", entityValue("sense")),
      f.fact("language", "text", namespace, "text-in-language-system", entityValue("language")),
      f.fact("formlanguage", "form", namespace, "form-in-language-system", entityValue("language")),
      f.fact("location", "text", namespace, "occurrence-in-version", entityValue("version"), f.locatorQualifier("page:1")),
      f.fact("container", "version", namespace, "content-version-of", entityValue("article")),
      f.fact("bytes", "version", namespace, "retained-content", await f.media("synthetic bytes")),
      f.fact("locator", "text", namespace, "source-native-locator", stringValue("unpaired:page:1")),
    ];
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, valid), f.authority)).not.toBeNull();
    for (const row of valid) {
      expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...row, subject: { kind: "key", key: "person" } }]), f.authority)).toBeNull();
      const wrongObject = row.predicate.code === "retained-content" ? { kind: "uri", uri: "https://example.org/current", v: 1 } as const
        : row.predicate.code === "source-native-locator" ? { kind: "integer", value: "1", v: 1 } as const : entityValue("person");
      expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...row, object: wrongObject }]), f.authority)).toBeNull();
    }
    const substitutions: readonly [number, SpongeKnowledgeProposalValueV3][] = [
      [0, entityValue("sense")], [1, entityValue("form")], [2, entityValue("form")],
      [3, entityValue("sense")], [4, entityValue("article")],
    ];
    for (const [index, object] of substitutions) expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[index]!, object }]), f.authority)).toBeNull();
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[0]!, qualifiers: f.locatorQualifier("page:1") }]), f.authority)).toBeNull();
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[4]!, qualifiers: [{ predicate: f.ref(namespace, "source-native-locator"), value: { kind: "integer", value: "1", v: 1 } }] }]), f.authority)).toBeNull();
    const badDigest = { ...valid[6]!, object: { ...(await f.media("bytes")), sourceSha256: "not-a-digest" } };
    expect(await compileSpongeKnowledgeProposalV3({ ...f.draft(entities, []), facts: [badDigest] }, f.authority)).toBeNull();
    const unauthorizedMedia = { ...(await f.media("bytes")), sourceEntityId: parseKnowledgeEntityId(`kent_${"c".repeat(24)}`)! };
    expect(await compileSpongeKnowledgeProposalV3(f.draft(entities, [{ ...valid[6]!, object: unauthorizedMedia }]), f.authority)).toBeNull();
  });

  test("reviewed version completeness requires one retained payload and containing identity without rejecting article subtypes", async () => {
    const f = await fixture();
    const compiled = await compileSpongeKnowledgeProposalV3(f.draft([
      f.newEntity("version", namespace, "retained-content-version"), f.newEntity("article", "sponge.editorial", "article"),
    ], [f.fact("container", "version", namespace, "content-version-of", entityValue("article")),
      f.fact("bytes", "version", namespace, "retained-content", await f.media("retained article bytes")),
      f.fact("extra.bytes", "version", namespace, "retained-content", await f.media("different retained bytes"))]), f.authority);
    if (compiled === null) throw new Error("Expected compilable version completeness fixture.");
    const proposed = await Promise.all(compiled.bundle.records.filter(record => record.kind === "assertion")
      .map(async record => required(await parseKnowledgeGraphRecordV1("assertion", record.value)).value));
    // Synthetic review fixtures do not exercise or grant any host admission authority.
    const assertions = await Promise.all(proposed.map(async assertion => {
      const { assertionSha256: _digest, ...input } = assertion;
      return required(await createKnowledgeAssertionV1({ ...input, acceptedPurposes: ["private-research"],
        state: "accepted-for-purpose", reviewActivitySha256: await sha256Text("synthetic occurrence reviewer activity") }));
    }));
    const memberships = await Promise.all(compiled.bundle.records.filter(record => record.kind === "type-membership").map(async record => {
      const { membershipSha256: _digest, ...input } = required(await parseKnowledgeGraphRecordV1("type-membership", record.value)).value;
      const index = proposed.findIndex(assertion => assertion.assertionSha256 === input.assertionSha256);
      return required(await createKnowledgeTypeMembershipV1({ ...input, assertionSha256: assertions[index]!.assertionSha256 }));
    }));
    const rows = statements(compiled);
    const rightsDecisions = await Promise.all(rows.map(statement => createKnowledgeRightsDecisionV1({
      actorEntityId: parseKnowledgeEntityId(f.authority.authorEntityId)!, allowedDisclosures: ["private"], decidedAt: f.authority.occurredAt,
      policySha256: parseSha256Hex(f.authority.authoringPolicySha256)!, purposes: ["private-research"], subjectSha256: statement.statementSha256, v: 1,
    }).then(required)));
    const input = { assertions, disclosure: "private" as const, entityId: compiled.entityIds["version"]!, evidence: [],
      memberships, purpose: "private-research", rightsDecisions, rootShape: f.pack.shapes[0]!.shape, shapes: f.pack.shapes };
    const duplicatePayload = outgoing(rows, input.entityId, "retained-content")[1]!;
    const onePayload = rows.filter(row => row.statementSha256 !== duplicatePayload.statementSha256);
    expect((await evaluateKnowledgeShapeV1({ ...input, statements: onePayload })).passed).toBe(true);
    const missing = await evaluateKnowledgeShapeV1({ ...input, statements: rows.filter(row => row.predicate.code !== "retained-content") });
    expect(missing.passed).toBe(false);
    expect(missing.violations).toContainEqual(expect.objectContaining({ code: "cardinality-minimum", predicate: f.ref(namespace, "retained-content") }));
    const conflicting = await evaluateKnowledgeShapeV1({ ...input, statements: rows });
    expect(conflicting.passed).toBe(false);
    expect(conflicting.violations).toContainEqual(expect.objectContaining({ code: "cardinality-maximum", predicate: f.ref(namespace, "retained-content") }));
  });
});
