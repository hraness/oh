import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text, type Sha256Hex } from "./integrity-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV3 } from "./knowledge-domain-catalog-v3";
import { reviewedSourceRelations } from "./knowledge-source-relations";
import { isJsonRecord } from "./unknown";
import { boundedKnowledgeWikidataPreviewJsonV2, createKnowledgeWikidataImportPreviewV2,
  type KnowledgeWikidataImportResultV2, type KnowledgeWikidataSourceAssertionV2 } from "./knowledge-wikidata-import-v2";
import { spongeKnowledgeWikidataMappingCatalogV1, type KnowledgeWikidataSourceMappingV1 } from "./knowledge-wikidata-mappings-v1";

export const KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V2 = "sponge.wikidata-source-mappings.v2";
export type KnowledgeWikidataSourceMappingV2 = Omit<KnowledgeWikidataSourceMappingV1, "v"> & Readonly<{ v: 2 }>;
export type KnowledgeWikidataMappingCatalogV2 = Readonly<{
  v: 2; mappingVersion: typeof KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V2;
  mappings: readonly KnowledgeWikidataSourceMappingV2[]; catalogSha256: Sha256Hex;
}>;
let catalogPromise: Promise<KnowledgeWikidataMappingCatalogV2> | undefined;
/** A new mapping version preserves the three historical target refs and adds twelve reviewed relationships. */
export function spongeKnowledgeWikidataMappingCatalogV2(): Promise<KnowledgeWikidataMappingCatalogV2> {
  catalogPromise ??= (async () => {
    const [legacy, catalog] = await Promise.all([spongeKnowledgeWikidataMappingCatalogV1(), spongeKnowledgeDomainCatalogV3()]);
    const mappings: KnowledgeWikidataSourceMappingV2[] = legacy.mappings.map(mapping => ({ ...mapping, v: 2 }));
    for (const [propertyId, revision, captureSha256, suffix] of reviewedSourceRelations) {
      const predicate = catalog.sourceRelationsPack.schemas.find(schema => schema.kind === "predicate"
        && schema.identity.code === `source-asserted-${suffix}`);
      if (predicate === undefined) throw new Error("Missing reviewed source relationship.");
      mappings.push({ source: { propertyId, datatype: "wikibase-item", revision, captureSha256: captureSha256 as Sha256Hex },
        target: predicate.ref, relation: "source-attribution", localMembershipInference: false, identityMerge: false, v: 2 });
    }
    const body: Omit<KnowledgeWikidataMappingCatalogV2, "catalogSha256"> = { v: 2, mappingVersion: KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V2, mappings };
    return freezeKnowledgeDeclaration({ ...body, catalogSha256: await sha256Text(canonicalJson(body as unknown as JsonValue)) });
  })();
  return catalogPromise;
}
export type KnowledgeWikidataMappedSourceCandidateV2 = Readonly<{
  source: KnowledgeWikidataSourceAssertionV2;
  mapping: KnowledgeWikidataSourceMappingV2;
  object: Readonly<{ entityId: string; uri: string }>;
  status: "requires-local-identity-and-proposal-review";
  normalization: "none";
  eligibleForAdmission: false;
}>;
export type KnowledgeWikidataMappingPreviewV2 = Readonly<{
  v: 2; sourcePreviewSha256: Sha256Hex; mappingCatalogSha256: Sha256Hex;
  candidates: readonly KnowledgeWikidataMappedSourceCandidateV2[];
  gaps: readonly Readonly<{ source: KnowledgeWikidataSourceAssertionV2;
    reason: "property-not-mapped" | "source-value-not-an-item" }>[];
  /** Only retained main statements are counted; source coverage and omission ledgers remain authoritative. */
  scope: "retained-main-statements"; previewSha256: Sha256Hex;
}>;
function occurrenceKey(capture: string, entity: string, property: string, statement: string | null, index: number): string {
  return JSON.stringify([capture, entity, property, statement, index]);
}
/** Source constraints, caller labels, ranks and prose cannot install mappings or grant admission. */
export async function createKnowledgeWikidataMappingPreviewV2(input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataMappingPreviewV2>> {
  const source = await createKnowledgeWikidataImportPreviewV2(input);
  if (!source.ok) return source;
  const catalog = await spongeKnowledgeWikidataMappingCatalogV2();
  const mappings = new Map(catalog.mappings.map(mapping => [mapping.source.propertyId, mapping]));
  // A complete occurrence key prevents duplicate GUIDs in different properties or captures from lending a valid type.
  const mainValues = new Map(source.value.mappingCandidates.flatMap(candidate => {
    const selector = candidate.selector;
    return selector.kind === "statement" && selector.location.kind === "main"
      ? [[occurrenceKey(candidate.captureSha256, selector.entityId, selector.propertyId, selector.statementId, selector.statementIndex), candidate.value] as const] : [];
  }));
  const candidates: KnowledgeWikidataMappedSourceCandidateV2[] = [];
  const gaps: KnowledgeWikidataMappingPreviewV2["gaps"][number][] = [];
  for (const assertion of source.value.sourceAssertions) {
    const mapping = mappings.get(assertion.predicate.propertyId);
    if (mapping === undefined) { gaps.push({ source: assertion, reason: "property-not-mapped" }); continue; }
    const { selector } = assertion;
    const preserved = mainValues.get(occurrenceKey(assertion.captureSha256, selector.entityId, selector.propertyId, selector.statementId, selector.statementIndex));
    const raw = assertion.rawStatement;
    const main = isJsonRecord(raw) && isJsonRecord(raw["mainsnak"]) ? raw["mainsnak"] : null;
    const data = main !== null && isJsonRecord(main["datavalue"]) ? main["datavalue"] : null;
    const value = data !== null && isJsonRecord(data["value"]) ? data["value"] : null;
    const id = value === null ? undefined : value["id"] ?? (typeof value["numeric-id"] === "number" ? `Q${value["numeric-id"]}` : undefined);
    if (preserved?.kind !== "typed-source-value" || preserved.datatype !== mapping.source.datatype
      || typeof id !== "string" || !/^Q[1-9][0-9]*$/u.test(id)) {
      gaps.push({ source: assertion, reason: "source-value-not-an-item" }); continue;
    }
    candidates.push({ source: assertion, mapping, object: { entityId: id, uri: `http://www.wikidata.org/entity/${id}` },
      status: "requires-local-identity-and-proposal-review", normalization: "none", eligibleForAdmission: false });
  }
  const body = { v: 2 as const, sourcePreviewSha256: source.value.previewSha256, mappingCatalogSha256: catalog.catalogSha256,
    candidates, gaps, scope: "retained-main-statements" as const };
  if (boundedKnowledgeWikidataPreviewJsonV2({ ...body, previewSha256: "0".repeat(64) }) === undefined) {
    return { ok: false, error: { code: "input-bound", field: "mapping-preview", retryable: false } };
  }
  return { ok: true, value: freezeKnowledgeDeclaration({ ...body, previewSha256: await sha256Text(canonicalJson(body as unknown as JsonValue)) }) };
}
/** Rebuilds source selectors and exact pinned mappings before accepting transported preview bytes. */
export async function verifyKnowledgeWikidataMappingPreviewV2(foreign: unknown, input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataMappingPreviewV2>> {
  const rebuilt = await createKnowledgeWikidataMappingPreviewV2(input);
  if (!rebuilt.ok) return rebuilt;
  const parsed = boundedKnowledgeWikidataPreviewJsonV2(foreign);
  if (parsed === undefined || canonicalJson(parsed) !== canonicalJson(rebuilt.value as unknown as JsonValue)) {
    return { ok: false, error: { code: "integrity-mismatch", field: "mapping-preview", retryable: false } };
  }
  return rebuilt;
}
