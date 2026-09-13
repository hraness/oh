import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text, type Sha256Hex } from "./integrity-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV2 } from "./knowledge-domain-catalog-v2";
import type { KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import { isJsonRecord } from "./unknown";
import {
  boundedKnowledgeWikidataPreviewJsonV2, createKnowledgeWikidataImportPreviewV2, type KnowledgeWikidataImportResultV2,
  type KnowledgeWikidataSourceAssertionV2,
} from "./knowledge-wikidata-import-v2";

export const KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V1 = "sponge.wikidata-source-mappings.v1";
export type KnowledgeWikidataSourceMappingV1 = Readonly<{
  source: Readonly<{ propertyId: string; datatype: "wikibase-item"; revision: number; captureSha256: Sha256Hex }>;
  target: KnowledgeSchemaRefV1;
  relation: "source-attribution";
  localMembershipInference: false;
  identityMerge: false;
  v: 1;
}>;
export type KnowledgeWikidataMappingCatalogV1 = Readonly<{
  v: 1; mappingVersion: typeof KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V1;
  mappings: readonly KnowledgeWikidataSourceMappingV1[];
  catalogSha256: Sha256Hex;
}>;
/** Exact full property responses in spec/research-v1/wikidata/2026-09-13/sources.jsonl.gz.
 * These mappings preserve source assertions; none means local type membership or equivalence. */
const reviewedProperties = [
  ["P31", 2544460086, "789d22e92cffde51227efdc235a56c0a73cd07905f78b92d4b3707dcaa57920c", "source-asserted-instance-of"],
  ["P279", 2544822399, "a9bd8764254319bbf8af70a8d55d068c8e06df0408658735e029871627ff375e", "source-asserted-subclass-of"],
  ["P361", 2544660587, "4ed5238812e042dcbb8b5c4cd38a80d78945289e760a85554d2d47b8a20dcd4f", "source-asserted-part-of"],
] as const;
let catalogPromise: Promise<KnowledgeWikidataMappingCatalogV1> | undefined;
export function spongeKnowledgeWikidataMappingCatalogV1(): Promise<KnowledgeWikidataMappingCatalogV1> {
  catalogPromise ??= (async () => {
    const catalog = await spongeKnowledgeDomainCatalogV2();
    const mappings: KnowledgeWikidataSourceMappingV1[] = reviewedProperties.map(([propertyId, revision, captureSha256, code]) => {
      const predicate = catalog.foundationPack.schemas.find(schema => schema.kind === "predicate" && schema.identity.code === code);
      if (predicate === undefined) throw new Error("Missing source-attribution predicate.");
      return { source: { propertyId, datatype: "wikibase-item", revision, captureSha256: captureSha256 as Sha256Hex },
        target: predicate.ref, relation: "source-attribution", localMembershipInference: false, identityMerge: false, v: 1 };
    });
    const body: Omit<KnowledgeWikidataMappingCatalogV1, "catalogSha256"> = { v: 1, mappingVersion: KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V1, mappings };
    return freezeKnowledgeDeclaration({ ...body, catalogSha256: await sha256Text(canonicalJson(body as unknown as JsonValue)) });
  })();
  return catalogPromise;
}

export type KnowledgeWikidataMappedSourceCandidateV1 = Readonly<{
  source: KnowledgeWikidataSourceAssertionV2;
  mapping: KnowledgeWikidataSourceMappingV1;
  object: Readonly<{ entityId: string; uri: string }>;
  status: "requires-local-identity-and-proposal-review";
  normalization: "none";
  eligibleForAdmission: false;
}>;
export type KnowledgeWikidataMappingPreviewV1 = Readonly<{
  v: 1; sourcePreviewSha256: Sha256Hex; mappingCatalogSha256: Sha256Hex;
  candidates: readonly KnowledgeWikidataMappedSourceCandidateV1[];
  gaps: readonly Readonly<{ source: KnowledgeWikidataSourceAssertionV2;
    reason: "property-not-mapped" | "source-value-not-an-item" }>[];
  /** Counts describe retained main statements only. Source omission and coverage ledgers remain authoritative. */
  scope: "retained-main-statements";
  previewSha256: Sha256Hex;
}>;

/** Rebuilds the bounded source preview; caller labels cannot install mappings or create authority. */
export async function createKnowledgeWikidataMappingPreviewV1(input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataMappingPreviewV1>> {
  const source = await createKnowledgeWikidataImportPreviewV2(input);
  if (!source.ok) return source;
  const catalog = await spongeKnowledgeWikidataMappingCatalogV1();
  const candidates: KnowledgeWikidataMappedSourceCandidateV1[] = [];
  const gaps: KnowledgeWikidataMappingPreviewV1["gaps"][number][] = [];
  for (const assertion of source.value.sourceAssertions) {
    const mapping = catalog.mappings.find(item => item.source.propertyId === assertion.predicate.propertyId);
    if (mapping === undefined) { gaps.push({ source: assertion, reason: "property-not-mapped" }); continue; }
    const raw = assertion.rawStatement;
    const main = isJsonRecord(raw) && isJsonRecord(raw["mainsnak"]) ? raw["mainsnak"] : null;
    const preserved = source.value.mappingCandidates.find(candidate => candidate.captureSha256 === assertion.captureSha256
      && candidate.selector.kind === "statement" && candidate.selector.statementId === assertion.selector.statementId
      && candidate.selector.entityId === assertion.selector.entityId
      && candidate.selector.propertyId === assertion.selector.propertyId
      && candidate.selector.statementIndex === assertion.selector.statementIndex
      && candidate.selector.location.kind === "main");
    const data = main !== null && isJsonRecord(main["datavalue"]) ? main["datavalue"] : null;
    const value = data !== null && isJsonRecord(data["value"]) ? data["value"] : null;
    const id = value === null ? undefined : value["id"] ?? (typeof value["numeric-id"] === "number" ? `Q${value["numeric-id"]}` : undefined);
    if (preserved?.value.kind !== "typed-source-value" || preserved.value.datatype !== mapping.source.datatype
      || typeof id !== "string" || !/^Q[1-9][0-9]*$/u.test(id)) {
      gaps.push({ source: assertion, reason: "source-value-not-an-item" }); continue;
    }
    candidates.push({ source: assertion, mapping, object: { entityId: id, uri: `http://www.wikidata.org/entity/${id}` },
      status: "requires-local-identity-and-proposal-review", normalization: "none", eligibleForAdmission: false });
  }
  const body = { v: 1 as const, sourcePreviewSha256: source.value.previewSha256,
    mappingCatalogSha256: catalog.catalogSha256, candidates, gaps, scope: "retained-main-statements" as const };
  if (boundedKnowledgeWikidataPreviewJsonV2({ ...body, previewSha256: "0".repeat(64) }) === undefined) {
    return { ok: false, error: { code: "input-bound", field: "mapping-preview", retryable: false } };
  }
  return { ok: true, value: freezeKnowledgeDeclaration({ ...body,
    previewSha256: await sha256Text(canonicalJson(body as unknown as JsonValue)) }) };
}

/** Verify transported candidates by rebuilding both pinned mappings and source selectors. */
export async function verifyKnowledgeWikidataMappingPreviewV1(foreign: unknown, input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataMappingPreviewV1>> {
  const rebuilt = await createKnowledgeWikidataMappingPreviewV1(input);
  if (!rebuilt.ok) return rebuilt;
  const parsed = boundedKnowledgeWikidataPreviewJsonV2(foreign);
  if (parsed === undefined || canonicalJson(parsed) !== canonicalJson(rebuilt.value as unknown as JsonValue)) {
    return { ok: false, error: { code: "integrity-mismatch", field: "mapping-preview", retryable: false } };
  }
  return rebuilt;
}
