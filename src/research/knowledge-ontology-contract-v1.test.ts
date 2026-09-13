import { expect, test } from "bun:test";
import { canonicalJson, type JsonValue } from "./document-domain";
import { parseSha256Hex, sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeDomainCatalog } from "./knowledge-domain-catalog";
import { createKnowledgePreservedValueV1 } from "./knowledge-value-codecs-v1";
import { parseKnowledgeGraphRecordV1 } from "./knowledge-ontology-contract-v1";

function pinned(value: string) {
  const digest = parseSha256Hex(value);
  if (digest === null) throw new Error("Invalid golden digest.");
  return digest;
}

// Golden digests from the authored prototype before the MIT manifest extraction.
// These pin serialized records and preimages, rather than local source paths.
test("extraction retains every canonical schema, vocabulary, shape and historical core policy byte", async () => {
  const core = await spongeCoreKnowledgeCatalogV1();
  const catalog = await spongeKnowledgeDomainCatalog();
  expect(await sha256Text(canonicalJson(core as unknown as JsonValue))).toBe(pinned("d4d7a6b97969d7e68a5cd74f0c877b4f168d5e98c279a1932b51a72f9023bc0d"));
  expect(core.vocabulary.revisionSha256).toBe(pinned("ad9881b73f5d42a0bfc31f93556dc6240af55f5137b627bcf45c4fc7e4f6254a"));
  expect(core.rightsPolicySha256).toBe(pinned("469f24b3ce9baba315644f726338f5b4518967c2754958abe4611eae624d6a5e"));
  expect(core.vocabularySetSha256).toBe(pinned("6ebcc3884f42fad2a189dc52b0e1d28c8e9220a1f83e46e0d8fc3fa2f763758f"));
  expect(core.canonicalizerSha256).toBe(pinned("6b8bdfa9cd5259bcd663980e091535656e072b6b9bd45007f4b5322d89e89ba7"));
  expect(catalog.corePack.manifestSha256).toBe(pinned("81386249973bdc1dd0f2bb24b7be0ce3a06d3e95942568d0e5ff40b2ccb9d9c6"));
  expect(await sha256Text(canonicalJson(catalog.schemas as unknown as JsonValue))).toBe(pinned("e63920368f3f7f498a546566f53359f683ff3a3cefd6edea329bc9bd6110011a"));
  expect(await sha256Text(canonicalJson(catalog.vocabularies as unknown as JsonValue))).toBe(pinned("0340397d20ca35c280b7fae8688687bb238b77495a4f12e21fd61c485fc92039"));
  expect(await sha256Text(canonicalJson(catalog.packs.flatMap(pack => pack.shapes) as unknown as JsonValue))).toBe(pinned("6b475b16cad2791cf282af1681124fb8fd6160cd8c2865b2398910dc394e6afa"));
  for (const pack of catalog.packs) {
    expect((await parseKnowledgeGraphRecordV1("vocabulary", pack.vocabulary)).ok).toBe(true);
    for (const schema of pack.schemas) expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
  }
});

test("source-preserving codec bytes stay identical across extraction", async () => {
  const fixtures = [
    { value: { captureSha256: "a".repeat(64), kind: "missing-value", occurrence: "Q1$1/main", state: "somevalue", v: 1 }, sha256: "903673e5a45beed381b43ba5c9cf05632b165c78117dbc8c2e0b6d1635ea23ee" },
    { value: { kind: "language-text", language: "zh-Hant-TW-x-source", text: "馬", v: 1 }, sha256: "88e28d1c76b708ddfbf698027c967c1320ee6894fe2045c42942adbe7ad9f1b7" },
    { value: { after: 0, before: 1, calendarmodel: "http://www.wikidata.org/entity/Q1985727", kind: "wikibase-time", precision: 8, serialization: "wikibase-json-v1", time: "-0044-00-00T00:00:00Z", timezone: 0, v: 1 }, sha256: "4ba259769d3142655c58f4061cb7f516e3ba61d4d43091a43617900ca3a2606a" },
    { value: { altitude: null, globe: "http://www.wikidata.org/entity/Q111", kind: "globe-coordinate", latitude: "+12.5000", longitude: "-30.000", precision: "0.010", serialization: "wikibase-json-v1", v: 1 }, sha256: "54eb6905b46e83dea92c88ead32fba6d441d975beda03a0063b7342eafe59062" },
  ];
  for (const fixture of fixtures) {
    const result = await createKnowledgePreservedValueV1(fixture.value);
    if (!result.ok) throw new Error("Invalid codec fixture.");
    expect(await sha256Text(canonicalJson(result.value as unknown as JsonValue))).toBe(pinned(fixture.sha256));
  }
});

test("MIT licensing creates initial manifest pins without rewriting canonical records", async () => {
  const catalog = await spongeKnowledgeDomainCatalog();
  expect(catalog.lock.lockSha256).not.toBe(pinned("3b7bc1d1c1354f0a08e316f8da93e6f904341e403af179d60abc5c6be5146acb"));
  for (const pack of catalog.packs.filter(pack => pack.packId !== "sponge.core")) {
    expect(pack.revision).toBe(1);
    expect(pack.previousManifestSha256).toBeNull();
    expect(pack.sources.length).toBeGreaterThan(0);
    expect(pack.sources.every(source => source.license === "MIT")).toBe(true);
  }
});
