import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson } from "../src/research/document-domain";
import {
  createKnowledgeWikidataImportPreviewV2, knowledgeWikidataDatatypeSupportV2,
  KNOWLEDGE_WIKIDATA_DATATYPES_V2, KNOWLEDGE_WIKIDATA_IMPORTER_V2,
  type KnowledgeWikidataImportInputV2,
} from "../src/research/knowledge-wikidata-import-v2";
import {
  readWikidataInventorySourcesV1, verifyWikidataInventoryV1, wikidataSourceSha256V1,
} from "./capture-wikidata-inventory";

function sourceEntities(body: string, id: string): Record<string, unknown>[] {
  const root = JSON.parse(body) as { entities: Record<string, Record<string, unknown>> };
  const entity = root.entities[id]!;
  return [entity, ...((entity.forms as Record<string, unknown>[] | undefined) ?? []),
    ...((entity.senses as Record<string, unknown>[] | undefined) ?? [])];
}

/** Measured preservation coverage over pinned bytes. Topic or meaning coverage is not inferred. */
export async function deriveWikidataPreservationCoverageV1(directory: string) {
  const inventory = await verifyWikidataInventoryV1(directory);
  const sources = await readWikidataInventorySourcesV1(directory);
  const corpus = [];
  const observedSnakDatatypes = new Set<string>();
  let typedProperties = 0;
  let opaqueProperties = 0;
  for (const property of inventory.properties) {
    const bucket = knowledgeWikidataDatatypeSupportV2(property.datatype);
    if (bucket === "typed-source-value") typedProperties++;
    else if (bucket === "opaque-source-value") opaqueProperties++;
    else throw new Error(`${property.id}: no preservation bucket`);
  }
  for (const source of sources.filter((item) => item.kind === "entity")) {
    const id = source.key.slice("entity-".length);
    const input: KnowledgeWikidataImportInputV2 = {
      v: 2, properties: "all-present", mappingVersion: "frozen-inventory-preservation.v1",
      captures: [{ requestedId: id, resolvedId: id, sourceUri: source.sourceUri,
        capturedAt: source.capturedAt, body: source.body, redirects: [], coverage: { kind: "complete-entity" } }],
    };
    const result = await createKnowledgeWikidataImportPreviewV2(input);
    if (!result.ok) throw new Error(`${id}: V2 importer rejected frozen source: ${JSON.stringify(result.error)}`);
    const preview = result.value;
    const rawEntities = sourceEntities(source.body, id);
    const rawStatements = rawEntities.flatMap((entity) => Object.values((entity.claims ?? {}) as Record<string, unknown[]>).flat());
    const observed = preview.coverage.reduce((sum, group) => sum + group.observedStatements, 0);
    const retained = preview.coverage.reduce((sum, group) => sum + group.retainedStatements, 0);
    if (observed !== rawStatements.length || retained !== preview.sourceAssertions.length) throw new Error(`${id}: statement accounting differs`);
    if (preview.sources.length !== 1 || preview.sources[0]!.body !== source.body
      || preview.sources[0]!.captureSha256 !== source.bodySha256 || preview.sources[0]!.sourceBytes !== source.bodyBytes) {
      throw new Error(`${id}: exact source bytes were not preserved`);
    }
    let typedSnaks = 0;
    let unsupportedSnaks = 0;
    let absenceSnaks = 0;
    for (const record of preview.records) {
      if (record.kind !== "snak") continue;
      if (record.value.kind === "typed-source-value") { typedSnaks++; observedSnakDatatypes.add(record.value.datatype); }
      else if (record.value.kind === "unsupported") unsupportedSnaks++;
      else absenceSnaks++;
    }
    for (const assertion of preview.sourceAssertions) {
      const entity = rawEntities.find((item) => item.id === assertion.selector.entityId)!;
      const group = (entity.claims as Record<string, unknown[]>)[assertion.selector.propertyId]!;
      if (canonicalJson(assertion.rawStatement) !== canonicalJson(group[assertion.selector.statementIndex] as Parameters<typeof canonicalJson>[0])
        || assertion.subject.uri !== `http://www.wikidata.org/entity/${assertion.selector.entityId}`
        || assertion.predicate.uri !== `http://www.wikidata.org/entity/${assertion.selector.propertyId}`
        || assertion.captureSha256 !== source.bodySha256 || assertion.eligibleForAdmission !== false) {
        throw new Error(`${id}: source assertion identity or raw statement differs`);
      }
    }
    if (preview.mappingCandidates.some((candidate) => candidate.normalization !== "none" || candidate.eligibleForAdmission !== false)
      || preview.coverage.some((group) => group.definitiveAnswer !== false)) throw new Error(`${id}: source preservation acquired authority`);
    corpus.push({ id, revision: preview.sources[0]!.revision, sourceSha256: source.bodySha256,
      observedStatements: observed, retainedSourceAssertions: retained, unprojectedStatements: observed - retained,
      rawBytesPreserved: true, sourceIdentityPreserved: true,
      typedSnaks, opaqueSnaks: unsupportedSnaks, absenceSnaks,
      omissions: preview.omissions, retryRequired: preview.cursor !== null });
  }
  return {
    v: 1 as const, kind: "oh.wikidata.preservation-coverage.v1" as const,
    inventorySha256: wikidataSourceSha256V1(await readFile(resolve(directory, "inventory.json"))),
    importer: KNOWLEDGE_WIKIDATA_IMPORTER_V2,
    supportedDatatypes: [...KNOWLEDGE_WIKIDATA_DATATYPES_V2],
    propertyAccounting: { describedProperties: inventory.properties.length, typedSourceValue: typedProperties,
      opaqueSourceValue: opaqueProperties, unclassified: inventory.properties.length - typedProperties - opaqueProperties,
      datatypeCounts: inventory.summary.datatypeCounts },
    corpusAccounting: { captures: corpus.length,
      sourceStatementsIncludingFormsAndSenses: corpus.reduce((n, row) => n + row.observedStatements, 0),
      retainedSourceAssertions: corpus.reduce((n, row) => n + row.retainedSourceAssertions, 0),
      unprojectedStatements: corpus.reduce((n, row) => n + row.unprojectedStatements, 0),
      typedSnaks: corpus.reduce((n, row) => n + row.typedSnaks, 0),
      opaqueSnaks: corpus.reduce((n, row) => n + row.opaqueSnaks, 0),
      absenceSnaks: corpus.reduce((n, row) => n + row.absenceSnaks, 0),
      observedTypedSnakDatatypes: [...observedSnakDatatypes].sort(),
      capturesWithOmissions: corpus.filter((row) => row.omissions.length > 0).length,
      capturesRequiringRetry: corpus.filter((row) => row.retryRequired).length,
      exactRawSourcePreservation: true },
    meaningCoverage: "not-measured" as const, localAdmission: "never-granted" as const,
    constraintEnforcement: "not-inferred-from-source" as const, corpus,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === "--help") {
      console.log("Usage: bun scripts/wikidata-inventory-coverage.ts --write DIRECTORY | --verify DIRECTORY\nBoth modes are offline. Write regenerates preservation-coverage.json from verified source bytes and the current importer.");
    } else if (args.length === 2 && (args[0] === "--write" || args[0] === "--verify")) {
      const directory = resolve(args[1]!);
      const report = await deriveWikidataPreservationCoverageV1(directory);
      const path = resolve(directory, "preservation-coverage.json");
      if (args[0] === "--write") await writeFile(path, JSON.stringify(report, null, 2) + "\n");
      else {
        const info = await stat(path);
        if (!info.isFile() || info.size > 1024 * 1024) throw new Error("coverage report size out of bounds");
        if (JSON.stringify(JSON.parse(await readFile(path, "utf8")) as unknown) !== JSON.stringify(report)) throw new Error("preservation coverage differs from current implementation and pinned sources");
      }
      console.log(JSON.stringify({ propertyAccounting: report.propertyAccounting, corpusAccounting: report.corpusAccounting }));
    } else throw new Error("invalid arguments; use --help");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "coverage failed");
    process.exitCode = 1;
  }
}
