import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import { createSpongeMonetaryValuesPackV1 } from "./knowledge-monetary-values";
import { parseKnowledgeGraphRecordV1 } from "./knowledge-ontology-contract-v1";
import { parseKnowledgeEntityId, parseKnowledgeStatementV1, type KnowledgeSchemaRefV1, type KnowledgeStatementV1, type KnowledgeValueV1 } from "./knowledge-ontology-v1";
import { compileSpongeKnowledgeProposalV3, type SpongeCompiledKnowledgeProposalV3, type SpongeKnowledgeProposalCompilerAuthorityV3 } from "./knowledge-proposal-compiler-v3";
import type { SpongeKnowledgeProposalDraftV3, SpongeKnowledgeProposalValueV3 } from "./knowledge-proposal-v3";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

const namespace = "sponge.monetary-values";
const previousPromise = spongeKnowledgeDomainCatalogV5();
const packPromise = previousPromise.then(createSpongeMonetaryValuesPackV1);

async function fixture(mode: "offer" | "quote") {
  const [previous, pack, core] = await Promise.all([previousPromise, packPromise, spongeCoreKnowledgeCatalogV1()]);
  const schemas = [...previous.schemas, ...pack.schemas];
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const found = schemas.find(schema => schema.identity.namespace === packId && schema.identity.code === code);
    if (found === undefined) throw new Error(`Missing fixture schema ${packId}/${code}.`);
    return found.ref;
  };
  const local = (code: string) => ref(namespace, code);
  const time = (value: string): KnowledgeValueV1 => ({ kind: "time", value, calendar: ref("sponge.reference", "gregorian-calendar"),
    certainty: "exact", earliest: null, latest: null, precision: "day", timezone: null, v: 1 });
  const quantity = (value: string, unit: string): KnowledgeValueV1 => ({ kind: "quantity", value, lowerBound: null,
    upperBound: null, uncertainty: null, unit: ref("sponge.foundation", unit), v: 1 });
  const entities: SpongeKnowledgeProposalDraftV3["entities"][number][] = [];
  const addEntity = (key: string, packId: string, code: string) => entities.push({ kind: "new", key, concepts: [ref(packId, code)], name: { language: "en", text: `Synthetic ${key}` } });
  for (const [key, packId, code] of [
    ["money", namespace, "monetary-value"], ["currency", namespace, "currency"], ["basis", namespace, "quotation-basis"],
    ["source", "sponge.core", "source"], ["version", "sponge.core", "source"],
  ]) addEntity(key!, packId!, code!);
  const facts: SpongeKnowledgeProposalDraftV3["facts"][number][] = [];
  const fact = (key: string, subject: string, code: string, object: SpongeKnowledgeProposalValueV3, packId = namespace) => {
    facts.push({ key: `fact.${key}`, subject: { kind: "key", key: subject }, predicate: ref(packId, code), object,
      qualifiers: packId === namespace ? [
        { predicate: ref("sponge.reference", "source-context"), value: { kind: "entity-key", entityKey: "source" } },
        { predicate: ref("sponge.foundation", "version-context"), value: { kind: "entity-key", entityKey: "version" } },
        { predicate: ref("sponge.foundation", "retrieved-at"), value: time("2026-09-15") },
      ] : [], contextKey: null, stance: "reports" });
  };
  const entity = (key: string): SpongeKnowledgeProposalValueV3 => ({ kind: "entity-key", entityKey: key });
  fact("amount", "money", "monetary-amount", { kind: "decimal", value: mode === "offer" ? "125.75" : "98.125", v: 1 });
  fact("currency", "money", "monetary-currency", entity("currency"));
  if (mode === "offer") {
    for (const [key, packId, code] of [
      ["offer", "sponge.substances", "offer"], ["price", "sponge.bridge-relations", "price"],
      ["product", "sponge.substances", "product"], ["seller", "sponge.core", "organization"],
    ]) addEntity(key!, packId!, code!);
    fact("seller", "offer", "offered-by", entity("seller"), "sponge.substances");
    fact("product", "offer", "offer-for-product", entity("product"), "sponge.bridge-relations");
    fact("price", "offer", "offer-has-price", entity("price"), "sponge.bridge-relations");
    fact("value", "price", "price-has-monetary-value", entity("money"));
    fact("basis", "price", "price-basis", entity("basis"));
    fact("basis-item", "basis", "basis-item", entity("product"));
    fact("basis-quantity", "basis", "basis-quantity", quantity("10", "milligram"));
    fact("basis-description", "basis", "basis-description", { kind: "text", language: "en", text: "one vial containing 10 mg", v: 1 });
    const start = time("2026-09-15");
    const end = time("2026-09-20");
    if (start.kind !== "time" || end.kind !== "time") throw new Error("Expected fixture time.");
    fact("validity", "price", "price-valid-during", { kind: "interval", start, end, v: 1 });
    fact("tax", "price", "price-tax-treatment", { kind: "string", value: "excluded", v: 1 });
  } else {
    addEntity("quote", namespace, "financial-quote");
    addEntity("listing", "sponge.finance", "listing");
    addEntity("instrument", "sponge.finance", "instrument");
    fact("listing", "quote", "quote-for-listing", entity("listing"));
    fact("kind", "quote", "quote-kind", { kind: "string", value: "bid", v: 1 });
    fact("time", "quote", "quote-at-time", time("2026-09-14"));
    fact("value", "quote", "quote-has-monetary-value", entity("money"));
    fact("basis", "quote", "quote-basis", entity("basis"));
    fact("basis-item", "basis", "basis-item", entity("instrument"));
    fact("basis-quantity", "basis", "basis-quantity", quantity("1", "count"));
    fact("basis-description", "basis", "basis-description", { kind: "text", language: "en", text: "one instrument unit", v: 1 });
    fact("instrument", "listing", "lists-instrument", entity("instrument"), "sponge.finance");
  }
  const draft: SpongeKnowledgeProposalDraftV3 = { v: 3, entities, facts, contexts: [], vocabularyDependencies: [],
    evidence: [{ key: "amount-evidence", factKey: "fact.amount", source: { kind: "key", key: "source" }, bearing: "supports",
      selector: mode === "offer" ? "price table, row 3" : "quotes.csv, row 7, bid", attribution: { kind: "agent-supplied", sourceUri: "https://example.org/retained-price-source" } }],
  };
  const authorEntityId = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const authority: SpongeKnowledgeProposalCompilerAuthorityV3 = {
    authorEntityId, authoringPolicySha256: core.rightsPolicySha256,
    externalOperationReceiptSha256: await sha256Text(`monetary-values-${mode}`), occurredAt: "2026-09-15T00:00:00.000Z",
    spaceId: "space.monetary-values", schemas, existingEntities: new Map([[authorEntityId, {
      entity: { entityId: authorEntityId, identityOperationId: "identity.fixture", identityRevision: 1, redirectEntityId: null, state: "active", v: 1 },
      concepts: [ref("sponge.core", "entity")],
    }]]),
  };
  return { previous, pack, draft, authority, ref, local, time, quantity };
}

async function statements(result: SpongeCompiledKnowledgeProposalV3 | null): Promise<KnowledgeStatementV1[]> {
  expect(result).not.toBeNull();
  if (result === null) throw new Error("Expected compiled monetary example.");
  const output: KnowledgeStatementV1[] = [];
  for (const record of result.bundle.records.filter(record => record.kind === "statement")) {
    const parsed = await parseKnowledgeStatementV1(record.value);
    if (!parsed.ok) throw new Error("Invalid compiled statement.");
    output.push(parsed.value);
  }
  return output;
}

describe("monetary values and quotes v1", () => {
  test("source guide, machine discovery, typed schemas and transitive dependency closure agree", async () => {
    const [previous, pack] = await Promise.all([previousPromise, packPromise]);
    const discovery = JSON.parse(await readFile(new URL("../../spec/research-v1/monetary-values-v1.json", import.meta.url), "utf8"));
    const guide = await readFile(new URL("../../spec/research-v1/monetary-values-v1.md", import.meta.url), "utf8");
    expect(discovery.catalog.factory).toBe("spongeKnowledgeDomainCatalogV6");
    expect(discovery.builder).toBe("createSpongeMonetaryValuesPackV1");
    expect(discovery.catalog.additionalPack).toBe(pack.packId);
    expect(discovery.catalog.additionalPackRevision).toBe(pack.revision);
    expect(pack.schemas.filter(schema => schema.kind === "concept").map(schema => schema.identity.code)).toEqual(discovery.concepts);
    expect(pack.schemas.filter(schema => schema.kind === "predicate").map(schema => schema.identity.code)).toEqual(discovery.relations);
    expect(pack.schemas).toHaveLength(18);
    expect(pack.sources[0]?.contentSha256).toBe(await sha256Text(guide));
    expect(pack.dependencies.map(pin => pin.packId)).toEqual(discovery.directDependencies);
    expect(pack.dependencies).toEqual([knowledgeVocabularyPackPinV1(previous.bridgeRelationsPack)]);
    const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: [...previous.packs, pack], roots: [knowledgeVocabularyPackPinV1(pack)] });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("Expected monetary dependency closure.");
    expect(resolved.value.lock.packs).toHaveLength(21);
    expect(resolved.value.lock.packs.filter(pin => pin.packId !== pack.packId)).toEqual([...previous.lock.packs]);
    const missing = await resolveKnowledgeVocabularyPacksV1({ manifests: [pack], roots: [knowledgeVocabularyPackPinV1(pack)] });
    expect(missing.ok).toBe(false);
    expect(await createSpongeMonetaryValuesPackV1(previous)).toEqual(pack);
    for (const schema of pack.schemas) expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
    for (const shape of pack.shapes) {
      expect((await parseKnowledgeGraphRecordV1("shape", shape)).ok).toBe(true);
      expect(shape.closed).toBe(false);
      expect(shape.rules.every(rule => rule.cardinality.minimum === 0)).toBe(true);
    }
  });

  test.each(["offer", "quote"] as const)("compiler preserves the complete %s query path and its source/version qualifiers", async mode => {
    const { draft, authority, ref, local, pack } = await fixture(mode);
    const query = pack.queries.find(query => query.id === (mode === "offer" ? "offer-price-context" : "dated-financial-quote"));
    expect(query).toBeDefined();
    const queryRefs = new Set(query?.predicates.map(predicate => canonicalJson(predicate as unknown as JsonValue)));
    for (const fact of draft.facts) for (const predicate of [fact.predicate, ...fact.qualifiers.map(qualifier => qualifier.predicate)]) {
      expect(queryRefs.has(canonicalJson(predicate as unknown as JsonValue))).toBe(true);
    }
    const compiled = await compileSpongeKnowledgeProposalV3(draft, authority);
    const graph = await statements(compiled);
    if (compiled === null) throw new Error("Expected compiled monetary path.");
    const value = (subject: string, predicate: KnowledgeSchemaRefV1) => graph.find(statement => statement.subject === compiled.entityIds[subject]
      && canonicalJson(statement.predicate as unknown as JsonValue) === canonicalJson(predicate as unknown as JsonValue))?.object;
    const edge = (subject: string, predicate: KnowledgeSchemaRefV1, object: string) => expect(value(subject, predicate))
      .toEqual({ kind: "entity", entityId: compiled.entityIds[object]!, v: 1 });
    if (mode === "offer") {
      edge("offer", ref("sponge.substances", "offered-by"), "seller");
      edge("offer", ref("sponge.bridge-relations", "offer-for-product"), "product");
      edge("offer", ref("sponge.bridge-relations", "offer-has-price"), "price");
      edge("price", local("price-has-monetary-value"), "money");
      edge("price", local("price-basis"), "basis");
      expect(value("price", local("price-valid-during"))).toMatchObject({ kind: "interval", start: { value: "2026-09-15" }, end: { value: "2026-09-20" } });
      expect(value("price", local("price-tax-treatment"))).toEqual({ kind: "string", value: "excluded", v: 1 });
    } else {
      edge("quote", local("quote-for-listing"), "listing");
      edge("listing", ref("sponge.finance", "lists-instrument"), "instrument");
      edge("quote", local("quote-has-monetary-value"), "money");
      edge("quote", local("quote-basis"), "basis");
      expect(value("quote", local("quote-kind"))).toEqual({ kind: "string", value: "bid", v: 1 });
      expect(value("quote", local("quote-at-time"))).toMatchObject({ kind: "time", value: "2026-09-14" });
      expect(graph.some(statement => statement.predicate.namespace === "sponge.bridge-relations")).toBe(false);
    }
    edge("money", local("monetary-currency"), "currency");
    edge("basis", local("basis-item"), mode === "offer" ? "product" : "instrument");
    expect(value("money", local("monetary-amount"))).toEqual({ kind: "decimal", value: mode === "offer" ? "125.75" : "98.125", v: 1 });
    expect(value("basis", local("basis-quantity"))).toMatchObject({ kind: "quantity", value: mode === "offer" ? "10" : "1",
      unit: { namespace: "sponge.foundation", code: mode === "offer" ? "milligram" : "count" } });
    expect(value("basis", local("basis-description"))).toMatchObject({ kind: "text", text: mode === "offer" ? "one vial containing 10 mg" : "one instrument unit" });
    for (const statement of graph.filter(statement => statement.predicate.namespace === namespace)) {
      expect(statement.qualifiers).toEqual(expect.arrayContaining([
        { predicate: ref("sponge.reference", "source-context"), value: { kind: "entity", entityId: compiled.entityIds.source, v: 1 }, v: 1 },
        { predicate: ref("sponge.foundation", "version-context"), value: { kind: "entity", entityId: compiled.entityIds.version, v: 1 }, v: 1 },
        expect.objectContaining({ predicate: ref("sponge.foundation", "retrieved-at"), value: expect.objectContaining({ value: "2026-09-15" }) }),
      ]));
    }
    expect(compiled.sourceAttributions[0]).toMatchObject({ kind: "agent-supplied", sourceUri: "https://example.org/retained-price-source",
      selector: mode === "offer" ? "price table, row 3" : "quotes.csv, row 7, bid" });
  });

  test("every new predicate rejects a wrong subject and a wrong value or target", async () => {
    const seen = new Set<string>();
    for (const mode of ["offer", "quote"] as const) {
      const { draft, authority } = await fixture(mode);
      for (const fact of draft.facts.filter(fact => fact.predicate.namespace === namespace && !seen.has(fact.predicate.code))) {
        seen.add(fact.predicate.code);
        const minimal = { ...draft, facts: [fact], evidence: [] };
        expect(await compileSpongeKnowledgeProposalV3(minimal, authority)).not.toBeNull();
        expect(await compileSpongeKnowledgeProposalV3({ ...minimal, facts: [{ ...fact, subject: { kind: "key", key: "source" } }] }, authority)).toBeNull();
        const wrongObject: SpongeKnowledgeProposalValueV3 = fact.object.kind === "entity-key"
          ? { kind: "entity-key", entityKey: "source" } : { kind: "boolean", value: false, v: 1 };
        expect(await compileSpongeKnowledgeProposalV3({ ...minimal, facts: [{ ...fact, object: wrongObject }] }, authority)).toBeNull();
      }
    }
    expect(seen.size).toBe(14);
  });

  test("exact large and negative amounts survive while numeric coercion and undeclared enum values fail", async () => {
    const { draft, authority } = await fixture("offer");
    const amount = draft.facts.find(fact => fact.key === "fact.amount")!;
    for (const exact of ["9007199254740993.000000000000000001", "-12.125"]) {
      const output = await statements(await compileSpongeKnowledgeProposalV3({ ...draft, facts: [{ ...amount, object: { kind: "decimal", value: exact, v: 1 } }], evidence: [] }, authority));
      expect(output).toContainEqual(expect.objectContaining({ predicate: amount.predicate, object: { kind: "decimal", value: exact, v: 1 } }));
    }
    for (const object of [{ kind: "decimal", value: 125.75, v: 1 }, { kind: "decimal", value: "1.2575e2", v: 1 },
      { kind: "decimal", value: "125.750", v: 1 }, { kind: "integer", value: "125", v: 1 }]) {
      expect(await compileSpongeKnowledgeProposalV3({ ...draft, facts: [{ ...amount, object }], evidence: [] }, authority)).toBeNull();
    }
    for (const mode of ["offer", "quote"] as const) {
      const scoped = await fixture(mode);
      const fact = scoped.draft.facts.find(item => item.key === (mode === "offer" ? "fact.tax" : "fact.kind"))!;
      expect(await compileSpongeKnowledgeProposalV3({ ...scoped.draft, facts: [{ ...fact, object: { kind: "string", value: "unknown", v: 1 } }], evidence: [] }, scoped.authority)).toBeNull();
    }
  });

  test("absent validity and tax remain absent, and quotes cannot take the offer-price path", async () => {
    const { draft, authority } = await fixture("offer");
    const output = await statements(await compileSpongeKnowledgeProposalV3({ ...draft, facts: draft.facts.filter(fact => !["fact.validity", "fact.tax"].includes(fact.key)) }, authority));
    expect(output.some(statement => ["price-valid-during", "price-tax-treatment"].includes(statement.predicate.code))).toBe(false);
    const quote = await fixture("quote");
    const value = quote.draft.facts.find(fact => fact.key === "fact.value")!;
    expect(await compileSpongeKnowledgeProposalV3({ ...quote.draft, facts: [{ ...value, predicate: quote.local("price-has-monetary-value") }], evidence: [] }, quote.authority)).toBeNull();
    const quoteListing = quote.draft.facts.find(fact => fact.key === "fact.listing")!;
    expect(await compileSpongeKnowledgeProposalV3({ ...quote.draft, facts: [{ ...quoteListing, object: { kind: "entity-key", entityKey: "instrument" } }], evidence: [] }, quote.authority)).toBeNull();
  });
});
