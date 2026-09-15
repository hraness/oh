import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text, type Sha256Hex } from "./integrity-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeWikidataMappingCatalogV2, type KnowledgeWikidataSourceMappingV2 } from "./knowledge-wikidata-mappings-v2";
import { KNOWLEDGE_WIKIDATA_DATATYPES_V2 } from "./knowledge-wikidata-import-v2";

/** Version 3 adds explicit, source-pinned coverage for high-value non-item properties.
 * These entries are preservation-only: they never invent a local predicate or normalize a literal. */
export const KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V3 = "sponge.wikidata-source-mappings.v3";
export type KnowledgeWikidataPreservedPropertyV3 = Readonly<{
  source: Readonly<{
    propertyId: string;
    datatype: (typeof KNOWLEDGE_WIKIDATA_DATATYPES_V2)[number];
    revision: number;
    captureSha256: Sha256Hex;
  }>;
  coverage: "preserved-only";
  target: null;
  observedStatements: number;
  rationale: string;
  v: 3;
}>;
export type KnowledgeWikidataMappingCatalogV3 = Readonly<{
  v: 3;
  mappingVersion: typeof KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V3;
  /** Reviewed item-valued mappings from V2 remain available without mutation. */
  reviewedMappings: readonly KnowledgeWikidataSourceMappingV2[];
  /** High-value literal and temporal properties are addressable with exact source evidence. */
  preservedProperties: readonly KnowledgeWikidataPreservedPropertyV3[];
  catalogSha256: Sha256Hex;
}>;

type PreservedPropertySeed = readonly [
  propertyId: string,
  datatype: KnowledgeWikidataPreservedPropertyV3["source"]["datatype"],
  revision: number,
  captureSha256: string,
  observedStatements: number,
  rationale: string,
];

/**
 * Every entry is pinned to the exact property response in
 * spec/research-v1/wikidata/2026-09-13/preservation-coverage.json. The
 * rationales describe the source datatype only and intentionally avoid local
 * semantic claims (for example, a DOI is not independently validated).
 */
const preservedPropertySeeds: readonly PreservedPropertySeed[] = [
  ["P18", "commonsMedia", 2544849962, "3578a06f58a93fe03365c13796937abf523bbdf201a6b796d65b592a7d721a29", 113, "Wikimedia Commons media value; preserve the source filename and statement evidence without downloading or asserting image identity."],
  ["P625", "globe-coordinate", 2543217378, "da8946438c4a23ac67470d5b16392ad23d1166b961a49a5f68217a11ec953a81", 110, "Source coordinate value with globe, precision and altitude fields; coordinate transformation requires separately attributed CRS evidence."],
  ["P2048", "quantity", 2541797879, "b73d48ce2f566839f8d1ed10a4cfef353af3d8961f45cb9964f0e57f8371a7fd", 53, "Quantity amount and unit URI are preserved exactly; no unit conversion or physical interpretation is inferred."],
  ["P348", "string", 2529955773, "13ffee0dc4e2ba339e221cdead4f59243db1d8de15effdcf000a3ddec51ce9e9", 42, "Software version identifier string; ordering, release status and product identity require independent evidence."],
  ["P356", "external-id", 2534351107, "aea71547eb4b8c3aad1e1d282a25c1c90f0cb330e616826bc4e2007139fad732", 109, "DOI-like external identifier under Wikidata's declared scheme; equality is not independent registration or work identity validation."],
  ["P571", "time", 2544428534, "2a7207cffe85d0bb3bcc7d25d46ed142df9a2546015a9f34060cf7820aabf8cb", 63, "Inception time value retains calendar, precision and bounds; event semantics and normalization remain source-attributed."],
  ["P577", "time", 2541377778, "01a95ac61dff81a5aa5b76991b090c613b680d726a5baea3213cd86fc17a728b", 57, "Publication time value retains calendar, precision and bounds; it does not establish first publication or availability."],
  ["P580", "time", 2542144440, "fe4c2aa2b8bdf4daa3a63ee3d270b6216d0359b14bce7ab52288c3972c645acd", 38, "Start time value retains calendar, precision and bounds; interval interpretation requires the statement's context."],
  ["P582", "time", 2539557394, "8608275b10d9602f80e35b58f0cf1f52091ceccc482dbc6ca863dc43be56f864", 39, "End time value retains calendar, precision and bounds; open-ended and qualifier semantics remain explicit source evidence."],
  ["P747", "wikibase-item", 2538203952, "b380ad582059a3661961d457ad917ce610e279e0e7aa7d296d8d1fdeddf164c6", 31, "Version, edition or translation item value; preserve the union stated by the source without selecting one interpretation or merging identities."],
  ["P155", "wikibase-item", 2541952638, "bd70fbdf99f4fbb397ef2692fe09bf7a1e1f33bd31695aae4cc90ccefe8b0742", 31, "Follows item value; direction is preserved as source data without inferring succession, causality or completeness."],
  ["P156", "wikibase-item", 2542982584, "3356d1767903e4420a4436d5fef7a5f36c0632a4055a5408ae07fcffc62ebe79", 29, "Followed-by item value; direction is preserved as source data without inferring succession, causality or completeness."],
  ["P231", "external-id", 2526658296, "724acc9042783ad276ef7ff80caea2b6d29a614c7d391bff11aa8827df9f655c", 34, "CAS Registry Number external identifier; preserve the supplied scheme value without chemical identity or vendor validation."],
  ["P249", "string", 2468222488, "a368f245fb1c6631514b77e1366bc25b3e825c7233395ec458d28447ec53e516", 35, "Ticker symbol string; exchange, instrument, issuer and current tradability require independent evidence."],
  ["P274", "string", 2501848610, "2a99492143ff904fab9ce407417ca84df4b75a600034678cec2c09675da35625", 22, "Chemical formula string; preserve source notation without parsing or asserting molecular identity."],
  ["P854", "url", 2534299498, "a5a6afa9b3faa8390233ef58e08d3f1e3c8d9735e7db1371b22e33e40eb71caa", 30, "Reference URL string; preserve the cited locator without fetching it or asserting current availability."],
] as const;

let catalogPromise: Promise<KnowledgeWikidataMappingCatalogV3> | undefined;
export function spongeKnowledgeWikidataMappingCatalogV3(): Promise<KnowledgeWikidataMappingCatalogV3> {
  catalogPromise ??= (async () => {
    const v2 = await spongeKnowledgeWikidataMappingCatalogV2();
    const preservedProperties: KnowledgeWikidataPreservedPropertyV3[] = preservedPropertySeeds.map(([propertyId, datatype, revision, captureSha256, observedStatements, rationale]) => ({
      source: { propertyId, datatype, revision, captureSha256: captureSha256 as Sha256Hex },
      coverage: "preserved-only", target: null, observedStatements, rationale, v: 3,
    }));
    const body: Omit<KnowledgeWikidataMappingCatalogV3, "catalogSha256"> = {
      v: 3, mappingVersion: KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V3,
      reviewedMappings: v2.mappings, preservedProperties,
    };
    return freezeKnowledgeDeclaration({ ...body,
      catalogSha256: await sha256Text(canonicalJson(body as unknown as JsonValue)) });
  })();
  return catalogPromise;
}

/** Seeds are intentionally exported for corpus-audit tooling, not runtime mutation. */
export const KNOWLEDGE_WIKIDATA_PRESERVED_PROPERTY_IDS_V3 = Object.freeze(
  preservedPropertySeeds.map(([propertyId]) => propertyId));
