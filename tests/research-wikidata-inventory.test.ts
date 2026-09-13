import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  deriveWikidataInventoryV1, readWikidataInventorySourcesV1, verifyWikidataInventoryV1,
  WIKIDATA_CORPUS_SELECTION_V1, WIKIDATA_INVENTORY_LIMITS_V1, wikidataSourceSha256V1,
  type WikidataInventorySourceV1,
} from "../scripts/capture-wikidata-inventory";
import { deriveWikidataPreservationCoverageV1 } from "../scripts/wikidata-inventory-coverage";
import { knowledgeWikidataDatatypeSupportV2, KNOWLEDGE_WIKIDATA_DATATYPES_V2 } from "../src/research/knowledge-wikidata-import-v2";

const directory = resolve(import.meta.dir, "../spec/research-v1/wikidata/2026-09-13");
const sourcesPromise = readWikidataInventorySourcesV1(directory);
const inventoryPromise = verifyWikidataInventoryV1(directory);

function withBody(source: WikidataInventorySourceV1, value: unknown): WikidataInventorySourceV1 {
  const body = JSON.stringify(value);
  return { ...source, body, bodyBytes: Buffer.byteLength(body), bodySha256: wikidataSourceSha256V1(body) };
}

test("the dated inventory and original public response archive are pinned bytes", async () => {
  expect(wikidataSourceSha256V1(await readFile(resolve(directory, "inventory.json"))))
    .toBe("8ab28e6ac85eb9927615d7cb51d9bddf9a807e8925b5a971f0feb8ae8daf3412");
  expect(wikidataSourceSha256V1(await readFile(resolve(directory, "sources.jsonl.gz"))))
    .toBe("4bfbadee1d0a352e7269feb24b09fa2cf000e25ace9cbaaadb8bcf037a739610");
  const inventory = await inventoryPromise;
  expect(inventory.summary).toMatchObject({ listingPages: 28, listedProperties: 13_904,
    describedProperties: 13_904, omittedProperties: 0, observedDatatypes: 18,
    corpusEntities: 67, capturedConstraintStatements: 716, directClassEdges: 243 });
  expect(inventory.scope).toMatchObject({ traversal: "completed-allpages", temporalConsistency: "capture-window-not-atomic",
    localNormalization: "unassessed", ontologyCoverage: "not-established", constraints: "attributed-source-guidance-with-exceptions" });
  expect(inventory.entities.map((entity) => entity.id).sort()).toEqual(WIKIDATA_CORPUS_SELECTION_V1.map(([id]) => id).sort());
});

test("every inventoried property belongs to one preservation bucket, independently of topic mappings", async () => {
  const inventory = await inventoryPromise;
  const buckets = { "typed-source-value": 0, "opaque-source-value": 0 };
  const sourceHashes = new Set(inventory.sources.filter((source) => source.kind === "property-metadata").map((source) => source.bodySha256));
  expect(new Set(inventory.properties.map((property) => property.id)).size).toBe(13_904);
  for (const property of inventory.properties) {
    buckets[knowledgeWikidataDatatypeSupportV2(property.datatype)]++;
    expect(property.revision).toBeGreaterThan(0);
    expect(sourceHashes.has(property.sourceSha256)).toBe(true);
  }
  expect(buckets).toEqual({ "typed-source-value": 13_904, "opaque-source-value": 0 });
  expect(Object.keys(inventory.summary.datatypeCounts).sort()).toEqual([...KNOWLEDGE_WIKIDATA_DATATYPES_V2].sort());
  expect(knowledgeWikidataDatatypeSupportV2("future-unknown-datatype")).toBe("opaque-source-value");
});

test("all actual corpus statements, nested lexeme statements, GUIDs and foreign identities survive V2", async () => {
  const report = await deriveWikidataPreservationCoverageV1(directory);
  const frozen: unknown = JSON.parse(await readFile(resolve(directory, "preservation-coverage.json"), "utf8"));
  expect(frozen).toEqual(report);
  expect(report.corpusAccounting).toMatchObject({ captures: 67, sourceStatementsIncludingFormsAndSenses: 4656,
    retainedSourceAssertions: 4656, unprojectedStatements: 0, typedSnaks: 11779, opaqueSnaks: 0,
    absenceSnaks: 30, capturesWithOmissions: 0, capturesRequiringRetry: 0, exactRawSourcePreservation: true });
  expect(report.corpusAccounting.observedTypedSnakDatatypes).toHaveLength(14);
  expect(report.corpusAccounting.observedTypedSnakDatatypes).toContain("entity-schema");
  expect(report.meaningCoverage).toBe("not-measured");
  expect(report.localAdmission).toBe("never-granted");
  expect(report.constraintEnforcement).toBe("not-inferred-from-source");
}, 30_000);

test("membership, constraints, exceptional uses and class neighborhoods remain pinned source evidence", async () => {
  const inventory = await inventoryPromise;
  const sources = await sourcesPromise;
  const expected = [
    ["P31", 2544460086, "789d22e92cffde51227efdc235a56c0a73cd07905f78b92d4b3707dcaa57920c"],
    ["P279", 2544822399, "a9bd8764254319bbf8af70a8d55d068c8e06df0408658735e029871627ff375e"],
    ["P361", 2544660587, "4ed5238812e042dcbb8b5c4cd38a80d78945289e760a85554d2d47b8a20dcd4f"],
  ] as const;
  for (const [id, revision, sourceSha256] of expected) {
    expect(inventory.entities.find((entity) => entity.id === id)).toMatchObject({ revision, sourceSha256 });
    expect(sources.find((source) => source.key === `entity-${id}`)?.bodySha256).toBe(sourceSha256);
  }
  const p31 = sources.find((source) => source.key === "entity-P31")!;
  const raw = JSON.parse(p31.body) as { entities: { P31: { claims: { P2302: { qualifiers?: Record<string, unknown[]>; rank: string }[] } } } };
  expect(raw.entities.P31.claims.P2302).toHaveLength(209);
  expect(raw.entities.P31.claims.P2302.some((statement) => statement.qualifiers?.P2303 !== undefined)).toBe(true);
  expect(raw.entities.P31.claims.P2302.some((statement) => statement.rank === "deprecated")).toBe(true);
  expect(new Set(inventory.classEdges.map((edge) => edge.predicate))).toEqual(new Set(["P31", "P279", "P361"]));
  expect(inventory.entities.find((entity) => entity.id === "L1")).toMatchObject({ forms: 2, senses: 1 });
});

test("verification rejects source-byte tampering, missing traversal pages, and incomplete metadata", async () => {
  const sources = await sourcesPromise;
  expect(() => deriveWikidataInventoryV1([{ ...sources[0]!, body: sources[0]!.body + " " }, ...sources.slice(1)]))
    .toThrow("source byte digest mismatch");
  expect(() => deriveWikidataInventoryV1(sources.filter((source) => source.key !== "listing-027")))
    .toThrow("incomplete or inconsistent property traversal");
  expect(() => deriveWikidataInventoryV1(sources.filter((source) => source.key !== "properties-001")))
    .toThrow("incomplete metadata batches");
  const index = sources.findIndex((source) => source.kind === "property-metadata");
  const original = sources[index]!;
  const raw = JSON.parse(original.body) as { entities: Record<string, unknown> };
  delete raw.entities[Object.keys(raw.entities)[0]!];
  const changed = [...sources];
  changed[index] = withBody(original, raw);
  expect(() => deriveWikidataInventoryV1(changed)).toThrow("unexpected keys");
});

test("capture continuation and API endpoints are verified before claiming a complete inventory", async () => {
  const sources = await sourcesPromise;
  const second = sources[1]!;
  expect(() => deriveWikidataInventoryV1([sources[0]!, { ...second, sourceUri: second.sourceUri.replace("apcontinue=", "untrustedcontinue=") }, ...sources.slice(2)]))
    .toThrow("listing traversal discontinuity");
  expect(() => deriveWikidataInventoryV1([{ ...sources[0]!, sourceUri: "https://example.com/w/api.php" }, ...sources.slice(1)]))
    .toThrow("invalid API source");
  const error = withBody(sources[0]!, { error: { code: "maxlag" } });
  expect(() => deriveWikidataInventoryV1([error, ...sources.slice(1)])).toThrow("source API did not complete cleanly");
  expect(() => deriveWikidataInventoryV1([{ ...sources[0]!, bodyBytes: WIKIDATA_INVENTORY_LIMITS_V1.responseBytes + 1 }, ...sources.slice(1)]))
    .toThrow("source byte digest mismatch");
});

test("offline file admission rejects oversized, corrupted and symlinked archives", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "oh-wikidata-inventory-"));
  const path = resolve(scratch, "sources.jsonl.gz");
  try {
    await writeFile(path, "invalid gzip");
    await expect(readWikidataInventorySourcesV1(scratch)).rejects.toThrow();
    await truncate(path, WIKIDATA_INVENTORY_LIMITS_V1.archiveBytes + 1);
    await expect(readWikidataInventorySourcesV1(scratch)).rejects.toThrow("file size out of bounds");
    await rm(path);
    await symlink(resolve(directory, "sources.jsonl.gz"), path);
    await expect(readWikidataInventorySourcesV1(scratch)).rejects.toThrow();
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
