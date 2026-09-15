import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import type { SpongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import {
  createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgePredicateRevisionV1, type KnowledgeSchemaRevisionV1, type KnowledgeValueKindV1,
  type KnowledgeValueRangeV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid monetary-values pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function title(code: string): string { return code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" "); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}
function valueRange(kind: KnowledgeValueKindV1): KnowledgeValueRangeV1 {
  return { kind: "value-kinds", valueKinds: [kind], v: 1 };
}
function enumRange(values: readonly string[]): KnowledgeValueRangeV1 {
  return { kind: "enum", values: values.map(value => ({ kind: "string", value, v: 1 })), v: 1 };
}

/** Adds exact monetary values and dated listing quotes without revising offer-associated bridge prices. */
export async function createSpongeMonetaryValuesPackV1(previous: SpongeKnowledgeDomainCatalogV5): Promise<KnowledgeVocabularyPackManifestV1> {
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge monetary values and quotes"),
    namespace: "sponge.monetary-values", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const schemas: KnowledgeSchemaRevisionV1[] = [];
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const candidates = packId === vocabulary.namespace ? schemas : previous.packs.find(pack => pack.packId === packId)?.schemas;
    const found = candidates?.find(schema => schema.identity.code === code);
    if (found === undefined) throw new Error(`Missing monetary schema ${packId}/${code}.`);
    return found.ref;
  };
  const local = (code: string) => ref(vocabulary.namespace, code);
  const entityRange = (...refs: readonly KnowledgeSchemaRefV1[]): KnowledgeValueRangeV1 => ({ concepts: sortedRefs(refs), kind: "entity-concepts", v: 1 });
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(title(code)), previousRevisionSha256: null, reviewDecisionSha256: null,
    vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  for (const [code, broader, definition] of [
    ["currency", "concept", "An explicitly identified monetary denomination or currency under a source-supported identity. It is not a physical unit, exchange-rate rule or assertion of identifier equivalence."],
    ["financial-quote", "information-resource", "One attributed market quote for an identified financial listing, with quote kind, observation time, monetary value and denominator stated independently. It is distinct from an offer price or an execution."],
    ["monetary-value", "information-resource", "A monetary value record whose exact decimal amount and identified currency are stated separately. Missing fields remain unknown; this record does not establish a price, valuation conclusion or conversion."],
    ["quotation-basis", "information-resource", "The stated quantity and identified item or package underlying a price or quote. A retained package description does not establish independently measured contents or authorize unit-price arithmetic."],
  ] as const) {
    schemas.push(required(await createKnowledgeSchemaRevisionV1({
      ...base(code, definition), broader: [ref("sponge.core", broader)], kind: "concept",
    })));
  }
  const qualifiers = sortedRefs([...previous.referencePack.schemas, ...previous.foundationPack.schemas]
    .filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map(schema => schema.ref));
  const price = ref("sponge.bridge-relations", "price");
  const definitions: readonly (readonly [string, string, KnowledgeSchemaRefV1, KnowledgeValueRangeV1])[] = [
    ["basis-description", "The source-stated, language-tagged package or denominator description. It does not assert composition, purity or normalized package equivalence.", local("quotation-basis"), valueRange("text")],
    ["basis-item", "The identified product or financial instrument whose quantity forms the quotation basis. It does not merge products, listings or instruments.", local("quotation-basis"), entityRange(ref("sponge.substances", "product"), ref("sponge.finance", "instrument"))],
    ["basis-quantity", "The stated denominator quantity under an exact unit descriptor. Counted items require a separately identified basis item or package description; no unit conversion or price arithmetic runs implicitly.", local("quotation-basis"), valueRange("quantity")],
    ["monetary-amount", "The exact canonical decimal amount, without floating-point rounding, currency inference or display formatting. Negative amounts are preserved when explicitly reported.", local("monetary-value"), valueRange("decimal")],
    ["monetary-currency", "The explicitly identified currency or monetary denomination of this amount; a symbol or matching number alone does not establish currency identity.", local("monetary-value"), entityRange(local("currency"))],
    ["price-basis", "The stated package or quantity basis for this offer-associated price. It does not establish purchasability or equivalent unit pricing.", price, entityRange(local("quotation-basis"))],
    ["price-has-monetary-value", "The monetary value stated by this offer-associated price record. A dated financial quote remains a separate record type.", price, entityRange(local("monetary-value"))],
    ["price-tax-treatment", "The explicitly reported tax treatment for this price in its source and jurisdiction context. Absence means unknown; mixed, exempt and not-applicable are positive source claims requiring their own detail.", price, enumRange(["excluded", "exempt", "included", "mixed", "not-applicable"])],
    ["price-valid-during", "The source-stated effective interval of this offer price. Missing validity remains unknown; an open endpoint must be explicitly supported rather than inferred from a missing date.", price, valueRange("interval")],
    ["quote-at-time", "The source-stated market observation time for this quote, retaining its declared calendar, precision and uncertainty. Capture time remains separate.", local("financial-quote"), valueRange("time")],
    ["quote-basis", "The stated instrument quantity or denominator underlying this financial quote. It does not establish execution size, liquidity or a unit-price conversion.", local("financial-quote"), entityRange(local("quotation-basis"))],
    ["quote-for-listing", "The specific listing to which this quote applies. An instrument, issuer or venue alone does not identify the listing.", local("financial-quote"), entityRange(ref("sponge.finance", "listing"))],
    ["quote-has-monetary-value", "The monetary value reported by this financial quote, independent of any offer-associated bridge price or executed transaction.", local("financial-quote"), entityRange(local("monetary-value"))],
    ["quote-kind", "The explicitly reported kind of this market quote. The bounded kinds do not equate bid, ask, last trade, indicative value, midpoint or settlement; unsupported source kinds must be preserved separately.", local("financial-quote"), enumRange(["ask", "bid", "indicative", "last", "mid", "settlement"])],
  ];
  const predicates: KnowledgePredicateRevisionV1[] = [];
  for (const [code, definition, domain, range] of definitions) {
    const schema = required(await createKnowledgeSchemaRevisionV1({
      ...base(code, definition), kind: "predicate", domainConcepts: [domain], inversePredicate: null, qualifierPredicates: qualifiers, range,
    }));
    if (schema.kind !== "predicate") throw new Error(`Expected monetary predicate ${code}.`);
    predicates.push(schema);
  }
  schemas.push(...predicates);
  schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1);
  const shapes = [];
  for (const code of ["financial-quote", "monetary-value", "quotation-basis"]) {
    const subject = local(code);
    const rules = predicates.filter(predicate => predicate.domainConcepts.some(domain => canonical(domain) === canonical(subject)))
      .map(predicate => ({ allowedDisclosures: ["private"] as const, cardinality: { maximum: null, minimum: 0, v: 1 as const },
        predicate: predicate.ref, purpose: "private-research", range: predicate.range, requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const }))
      .sort((a, b) => canonical(a.predicate) < canonical(b.predicate) ? -1 : 1);
    shapes.push(required(await createKnowledgeExecutableShapeV1({ appliesToConcepts: [subject], closed: false, extends: [],
      maximumInheritanceDepth: 1, rules, shape: subject, v: 1 })));
  }
  const predicate = (code: string) => local(code);
  const sourcePredicates = [ref("sponge.reference", "source-context"), ref("sponge.foundation", "version-context"), ref("sponge.foundation", "retrieved-at")];
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256,
    dependencies: [knowledgeVocabularyPackPinV1(previous.bridgeRelationsPack)], display: core.display,
    examples: [
      { description: "Synthetic exact decimal amount, separate from its required comparison context and identified currency.", id: "exact-amount", object: { kind: "decimal", value: "125.75", v: 1 }, predicate: predicate("monetary-amount"), subjectConcept: local("monetary-value"), v: 1 },
      { description: "Synthetic dated financial bid kind; the listing, time, value, basis and source remain independently stated.", id: "financial-bid", object: { kind: "string", value: "bid", v: 1 }, predicate: predicate("quote-kind"), subjectConcept: local("financial-quote"), v: 1 },
    ],
    migrationNotes: "Additive monetary values and dated financial quotes. Existing offer-associated bridge price and all V1–V5 declarations remain unchanged. Missing amount, currency, tax, validity and quote context remain unknown. No conversion, current availability, supplier trust, execution or investment suitability is inferred. The bridge dependency resolves all twenty V5 packs; host installation and proposal review remain required.",
    packId: vocabulary.namespace, previousManifestSha256: null,
    queries: [
      { description: "Which listing, instrument, venue, kind, observation time, exact amount, currency and denominator does the retained source version report for this financial quote?", id: "dated-financial-quote", predicates: sortedRefs([...sourcePredicates, ref("sponge.finance", "lists-instrument"), ref("sponge.bridge-relations", "listing-at-venue"), ...["quote-for-listing", "quote-kind", "quote-at-time", "quote-has-monetary-value", "monetary-amount", "monetary-currency", "quote-basis", "basis-item", "basis-quantity", "basis-description"].map(predicate)]), v: 1 },
      { description: "Which seller, product, exact amount, currency, package basis, validity and tax treatment does the retained source version state for this offer?", id: "offer-price-context", predicates: sortedRefs([...sourcePredicates, ref("sponge.substances", "offered-by"), ref("sponge.bridge-relations", "offer-for-product"), ref("sponge.bridge-relations", "offer-has-price"), ...["price-has-monetary-value", "monetary-amount", "monetary-currency", "price-basis", "basis-item", "basis-quantity", "basis-description", "price-valid-during", "price-tax-treatment"].map(predicate)]), v: 1 },
    ],
    revision: 1, schemas, shapes, sources: [{ contentSha256: "00450658ba1df9d00beeb6041db4adfdf798c055359593eb7111e4d9344908db", license: "MIT", revision: "2026-09-15", uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/monetary-values-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
