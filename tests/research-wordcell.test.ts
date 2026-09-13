import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { canonicalJson, canonicalSha256, type JsonValue } from "../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../src/graph";
import { createOhSqliteStoreAuthorityV1 } from "../src/sqlite/port";
import { OH_WORKING_STORE_PROFILE_V1, verifyOhDependencyClosureAgainstV1 } from "../src/store";
import { spongeCoreKnowledgeCatalogV1 } from "../src/research/knowledge-core-v1";
import { compileSpongeKnowledgeProposalV3 } from "../src/research/knowledge-proposal-compiler-v3";
import { parseKnowledgeEntityId } from "../src/research/knowledge-ontology-v1";
import { parseKnowledgeGraphRecordV1 } from "../src/research/knowledge-ontology-contract-v1";
import { sha256Text } from "../src/research/integrity-domain";
import { prepareOhResearchPacketV1, verifyOhResearchPacketV1 } from "../src/research/research-packet";
import { commitOhResearchPacketV1, exportOhResearchPacketV1, restoreOhResearchPacketV1,
  verifyOhResearchExportV1 } from "../src/research/research-store";

type Source = { path: string; content: string };
type Fact = { relation: string; tuple: (string | number)[] };
type NoteRecord = { key: string; id: string; path: string; documentId: string | null;
  contentSha256: string; facts: Fact[] };
type Fixture = {
  producer: { commit: string; version: string; sourceSha256: string };
  mapping: { authority: string; selectedFact: Fact };
  root: string;
  sources: Source[];
  snapshot: { schemaVersion: 1; vaultIdentity: string; revision: string; catalogNoteId: string;
    sourceDigests: { path: string; contentSha256: string }[]; records: NoteRecord[]; factCount: number };
  sourceEnvelopes: ReturnType<typeof createKnowledgeGraphRecordV1>[];
};
const fixture = JSON.parse(await readFile(new URL("./fixtures/wordcell-research-v1.json", import.meta.url), "utf8")) as Fixture;
const pinnedRevision = "1740a779ca4d302a2948ecb7c899a356cafacc994b9c76b2e0ce1a80b785d83a";
const instant = "2026-09-13T00:00:00.000Z";
const json = (value: unknown) => canonicalJson(value as JsonValue);

/** Fixture admission is intentionally pinned to a selected authored snapshot, not a general Wordcell importer. */
async function selectedSource(capture: Fixture) {
  const { revision, factCount, ...identity } = capture.snapshot;
  if (revision !== pinnedRevision || canonicalSha256(identity as unknown as JsonValue) !== pinnedRevision) {
    throw new Error("The selected Markdown snapshot changed.");
  }
  if (factCount !== capture.snapshot.records.reduce((total, record) => total + record.facts.length, 0)) {
    throw new Error("Invalid source fact count.");
  }
  for (const { path, contentSha256 } of capture.snapshot.sourceDigests) {
    const source = capture.sources.find((candidate) => candidate.path === path);
    if (source === undefined || await sha256Text(source.content) !== contentSha256) throw new Error("Source bytes changed.");
  }
  const selected = capture.snapshot.records.find((record) => record.id === "notes/cloud-report");
  const envelope = capture.sourceEnvelopes.find((record) => record.key === selected?.key);
  if (selected === undefined || envelope === undefined || !selected.facts.some((fact) => json(fact) === json(capture.mapping.selectedFact))
    || json(envelope) !== json(createKnowledgeGraphRecordV1({ key: selected.key, kind: "edition", dependencies: [],
      v: 1, value: selected as unknown as JsonValue }))) throw new Error("Foreign source evidence.");
  return { selected, envelope };
}

async function compileFixture() {
  const { selected, envelope } = await selectedSource(fixture);
  const core = await spongeCoreKnowledgeCatalogV1();
  const concept = (code: string) => core.concepts.find((value) => value.identity.code === code)!.ref;
  const predicate = (code: string) => core.predicates.find((value) => value.identity.code === code)!.ref;
  const author = parseKnowledgeEntityId(`kent_${"a".repeat(24)}`)!;
  const entity = { entityId: author, identityOperationId: "identity.synthetic-author", identityRevision: 1,
    redirectEntityId: null, state: "active" as const, v: 1 as const };
  const sourceUri = "kb://synthetic/research/cloud-report";
  const locator = `notes/cloud-report.md#L${fixture.mapping.selectedFact.tuple[3]}`;
  const provenanceUris = [
    `urn:wordcell:snapshot:${fixture.snapshot.revision}`,
    `urn:wordcell:source:${selected.contentSha256}`,
    `urn:oh:record:${envelope.recordSha256}`,
  ];
  const compiled = await compileSpongeKnowledgeProposalV3({
    v: 3,
    entities: [
      { key: "report", kind: "new", concepts: [concept("information-resource")], name: { language: "en", text: "Cloud report" } },
      { key: "atlas", kind: "new", concepts: [concept("information-resource")], name: { language: "en", text: "Cloud atlas" } },
    ],
    facts: [{ key: "authored-citation", subject: { kind: "key", key: "report" }, predicate: predicate("cites"),
      object: { kind: "entity-key", entityKey: "atlas" }, qualifiers: [], contextKey: "source", stance: "reports" }],
    contexts: [{ key: "source", scenario: "actual", dimensions: provenanceUris.map((uri) => ({
      predicate: predicate("identifier"), value: { kind: "uri", uri, v: 1 },
    })) }],
    evidence: [{ key: "authored-line", factKey: "authored-citation", source: { kind: "key", key: "report" },
      bearing: "supports", selector: locator, attribution: { kind: "agent-supplied", sourceUri } }],
    vocabularyDependencies: [],
  }, {
    authorEntityId: author, authoringPolicySha256: core.rightsPolicySha256, occurredAt: instant,
    externalOperationReceiptSha256: canonicalSha256({ profile: "synthetic.wordcell-selection.v1", sourceUri,
      snapshotRevision: fixture.snapshot.revision, sourceRecordSha256: envelope.recordSha256, fact: fixture.mapping.selectedFact } as JsonValue),
    spaceId: "local.wordcell.research",
    schemas: core.schemas,
    existingEntities: new Map([[author, { entity, concepts: [concept("agent")] }]]),
  });
  if (compiled === null) throw new Error("The selected authored relation did not compile.");
  const packet = await prepareOhResearchPacketV1({ records: [
    { kind: "vocabulary", value: core.vocabulary },
    ...core.schemas.map((value) => ({ kind: "schema", value })),
    { kind: "entity", value: entity },
    ...compiled.bundle.records,
  ] });
  return { compiled, packet, provenanceUris, locator, cites: predicate("cites") };
}

function store(realmId: string) {
  return createOhSqliteStoreAuthorityV1({ path: ":memory:", profile: OH_WORKING_STORE_PROFILE_V1,
    realmId, spaceId: "wordcell-research" }).store;
}

describe("pinned Wordcell source snapshot and optional research profile", () => {
  test("retains actual producer bytes, source facts and distinct Oh envelope identities", async () => {
    expect(fixture.producer).toMatchObject({ commit: "16a5fae9ae7af39a9b697006add5d39c9fae122f", version: "0.21.1" });
    expect(fixture.mapping.authority).toBe("unasserted");
    const { selected, envelope } = await selectedSource(fixture);
    expect(selected.facts).toContainEqual({ relation: "wordcell.relation", tuple: ["notes/cloud-report", "notes/cloud-atlas", "cites", 6] });
    expect(fixture.snapshot.records).toHaveLength(2);
    expect(fixture.snapshot.factCount).toBe(4);
    expect(envelope.recordSha256).not.toBe(selected.contentSha256);
    expect(fixture.sourceEnvelopes.every((value) => value.kind === "edition" && value.dependencies.length === 0)).toBe(true);
    // Wordcell's edition is a source-fact projection, not a research edition with review authority.
    expect((await parseKnowledgeGraphRecordV1("edition", envelope.value)).ok).toBe(false);
  });

  test("round-trips an unaccepted source-linked proposal through two independent SQLite authorities", async () => {
    const sourceBytes = json(fixture.sources);
    const { compiled, packet, provenanceUris, locator, cites } = await compileFixture();
    const source = store("synthetic.wordcell-source");
    const target = store("synthetic.research-consumer");
    try {
      expect(packet.authority).toBe("unasserted");
      expect(compiled.bundle.records.some((record) => record.kind === "rights-decision" || record.kind === "review-decision")).toBe(false);
      const assertions = compiled.bundle.records.filter((record) => record.kind === "assertion");
      for (const record of assertions) expect(record.value).toMatchObject({ state: "proposed", acceptedPurposes: [], reviewActivitySha256: null });
      const citation = compiled.bundle.records.find((record) => record.kind === "statement"
        && json((record.value as { predicate: unknown }).predicate) === json(cites));
      expect(citation?.value).toMatchObject({ subject: compiled.entityIds["report"], object: {
        kind: "entity", entityId: compiled.entityIds["atlas"], v: 1,
      } });
      const content = json(compiled.bundle.records);
      for (const uri of provenanceUris) expect(content).toContain(uri);
      expect(compiled.sourceAttributions).toEqual([expect.objectContaining({ kind: "agent-supplied", disclosure: "private", selector: locator })]);
      await commitOhResearchPacketV1({ store: source, packet, actorId: "synthetic.wordcell-host",
        expectedHead: await source.head(), operationId: "wordcell.fixture.propose", instant });
      const exported = await exportOhResearchPacketV1({ store: source, roots: packet.records.map((record) => record.key) });
      expect(await verifyOhResearchExportV1(JSON.parse(json(exported)))).not.toBeNull();
      expect(exported.packet).toEqual(packet);
      // Closure verification authenticates the expected source binding/head, not acceptance or permission.
      expect(verifyOhDependencyClosureAgainstV1(exported.closure, { binding: source.binding, head: await source.head() }).ok).toBe(true);
      expect(verifyOhDependencyClosureAgainstV1(exported.closure, { binding: target.binding, head: await target.head() }).ok).toBe(false);
      await restoreOhResearchPacketV1({ store: target, exported, actorId: "synthetic.receiving-host",
        expectedHead: await target.head(), operationId: "wordcell.fixture.import", instant });
      const imported = await exportOhResearchPacketV1({ store: target, roots: packet.records.map((record) => record.key) });
      expect(imported.packet).toEqual(packet);
      expect(imported.closure.binding.bindingSha256).not.toBe(exported.closure.binding.bindingSha256);
      expect(imported.closure.head.operationSha256).not.toBe(exported.closure.head.operationSha256);
      expect(json(fixture.sources)).toBe(sourceBytes);
    } finally { await source.close(); await target.close(); }
  });

  test("rejects changed Markdown, a changed snapshot and a substituted source envelope before mapping", async () => {
    const changedBytes = structuredClone(fixture);
    changedBytes.sources.find((source) => source.path === "notes/cloud-report.md")!.content += "A later edit.\n";
    await expect(selectedSource(changedBytes)).rejects.toThrow("Source bytes changed");
    const changedSnapshot = structuredClone(fixture);
    changedSnapshot.snapshot.records[0]!.facts[0]!.tuple[0] = "foreign-note";
    await expect(selectedSource(changedSnapshot)).rejects.toThrow("selected Markdown snapshot changed");
    const foreignProof = structuredClone(fixture);
    const source = foreignProof.sourceEnvelopes.find((record) => (record.value as { id: string }).id === "notes/cloud-report")!;
    Reflect.set(source, "recordSha256", "0".repeat(64));
    await expect(selectedSource(foreignProof)).rejects.toThrow("Foreign source evidence");
  });

  test("does not admit a serialized packet with forged provenance bytes or missing schema dependencies", async () => {
    const { packet } = await compileFixture();
    const forged = JSON.parse(json(packet)) as { records: { kind: string; value: { source: { value: { dimensions: unknown[] } } } }[] };
    forged.records.find((record) => record.kind === "context")!.value.source.value.dimensions = [];
    expect(await verifyOhResearchPacketV1(forged)).toBeNull();
    const missing = JSON.parse(json(packet)) as { records: { kind: string }[] };
    missing.records = missing.records.filter((record) => record.kind !== "schema");
    expect(await verifyOhResearchPacketV1(missing)).toBeNull();
  });
});
