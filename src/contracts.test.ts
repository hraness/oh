import { describe, expect, test } from "bun:test";

import { canonicalJson, type JsonObject, type Sha256Hex } from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { createKnowledgeGraphRecordV1, createKnowledgeGraphRevisionV1,
  graphRevisionSha256V1, OH_GRAPH_LIMITS_V1, parseKnowledgeGraphRecordV1,
  parseKnowledgeGraphRevisionV1, reduceKnowledgeGraphRevisionsV1 } from "./graph";
import { createKnowledgeActivityV1, createKnowledgeAssertionV1, createKnowledgeContextV1,
  createKnowledgeEvidenceLinkV1, createKnowledgeInquiryV1, createKnowledgeStatementV1,
  parseKnowledgeAssertionV1, parseKnowledgeEntityV1, parseKnowledgeEvidenceLinkV1,
  parseKnowledgeStatementV1, type KnowledgeAssertionId, type KnowledgeEntityId,
  type KnowledgeEvidenceId, type KnowledgeInquiryId,
  type KnowledgeSchemaRefV1 } from "./ontology";
import { createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  knowledgeSchemaRefV1, parseKnowledgeSchemaRevisionV1, verifyKnowledgeSchemaEvolutionV1 } from "./schema";

const digest = "a".repeat(64) as Sha256Hex;
const entityId = `kent_${"1".repeat(24)}` as KnowledgeEntityId;
const authorId = `kent_${"2".repeat(24)}` as KnowledgeEntityId;
const schemaRef: KnowledgeSchemaRefV1 = { code: "name", namespace: "oh.core", revision: 1,
  schemaSha256: digest, v: 1 };

describe("ontology contracts", () => {
  test("creates content-addressed contexts, statements, and inquiries", () => {
    const context = createKnowledgeContextV1({ dimensions: [], scenario: "actual", v: 1 });
    expect(context.ok).toBe(true);
    const statement = createKnowledgeStatementV1({ object: { kind: "text", language: "en", text: "Ada", v: 1 },
      predicate: schemaRef, qualifiers: [], subject: entityId, v: 1 });
    expect(statement.ok).toBe(true);
    if (!statement.ok) return;
    expect(parseKnowledgeStatementV1(statement.value)).toEqual({ ok: true, value: statement.value });
    expect(parseKnowledgeStatementV1({ ...statement.value, subject: authorId })).toMatchObject({ ok: false });
    const inquiry = createKnowledgeInquiryV1({ answerForm: "narrative", authorEntityId: authorId,
      contextSha256: context.ok ? context.value.contextSha256 : null,
      createdAt: "2026-08-27T12:00:00.000Z", inquiryId: `kinq_${"3".repeat(24)}` as KnowledgeInquiryId,
      language: "en", parentInquiryIds: [], privacy: "public", question: "What changed?",
      status: "open", v: 1 });
    expect(inquiry.ok).toBe(true);
  });

  test("requires canonical set ordering", () => {
    const statement = createKnowledgeStatementV1({ object: { kind: "set", v: 1, values: [
      { kind: "string", v: 1, value: "z" }, { kind: "string", v: 1, value: "a" },
    ] }, predicate: schemaRef, qualifiers: [], subject: entityId, v: 1 });
    expect(statement).toMatchObject({ ok: false });
    expect(createKnowledgeStatementV1({ object: { canonicalizerSha256: digest,
      canonicalValue: "canonical extension bytes", kind: "extension", mediaType: "application/json",
      schema: schemaRef, v: 1, valueSha256: digest }, predicate: schemaRef, qualifiers: [],
      subject: entityId, v: 1 })).toMatchObject({ ok: false, error: { code: "digest-mismatch" } });
  });

  test("preserves entity, activity, assertion, and evidence authority laws", () => {
    expect(parseKnowledgeEntityV1({ entityId, identityOperationId: "identity.create",
      identityRevision: 1, redirectEntityId: null, state: "active", v: 1 })).toMatchObject({ ok: true });
    expect(parseKnowledgeEntityV1({ entityId, identityOperationId: "identity.redirect",
      identityRevision: 2, redirectEntityId: null, state: "redirected", v: 1 })).toMatchObject({ ok: false });
    const activity = createKnowledgeActivityV1({ actor: { entityId: authorId, kind: "entity", v: 1 },
      inputSha256s: [], kind: "human-entry", occurredAt: "2026-08-27T12:00:00.000Z",
      outputSha256s: [], policySha256: digest, tool: null, v: 1 });
    expect(activity.ok).toBe(true);
    const assertion = createKnowledgeAssertionV1({ acceptedPurposes: [],
      assertionId: `kast_${"4".repeat(24)}` as KnowledgeAssertionId,
      assertor: { kind: "model", model: schemaRef, receiptSha256: digest, v: 1 }, confidence: null,
      contextSha256: null, provenanceActivitySha256: activity.ok ? activity.value.activitySha256 : digest,
      reviewActivitySha256: null, stance: "reports", state: "proposed", statementSha256: digest, v: 1 });
    expect(assertion.ok).toBe(true);
    if (!assertion.ok) return;
    expect(parseKnowledgeAssertionV1(assertion.value)).toEqual({ ok: true, value: assertion.value });
    const { assertionSha256: _assertionSha256, ...assertionInput } = assertion.value;
    expect(createKnowledgeAssertionV1({ ...assertionInput, acceptedPurposes: ["publication"],
      state: "accepted-for-purpose" })).toMatchObject({ ok: false });
    const evidence = createKnowledgeEvidenceLinkV1({ assertionSha256: assertion.value.assertionSha256,
      bearing: "supports", disclosure: "public", evidenceId: `kevd_${"5".repeat(24)}` as KnowledgeEvidenceId,
      observationSha256: digest, provenanceActivitySha256: activity.ok ? activity.value.activitySha256 : digest,
      selector: "paragraph:1", sourceEntityId: null, v: 1 });
    expect(evidence.ok).toBe(true);
    if (evidence.ok) {
      expect(parseKnowledgeEvidenceLinkV1({ ...evidence.value, bearing: "contradicts" })).toMatchObject({ ok: false });
    }
  });
});

describe("schema evolution", () => {
  const localized = [{ language: "en", text: "Name", v: 1 as const }];
  const revision = (revision: number, body: JsonObject, prior: Sha256Hex | null, compatibility: "additive" | "breaking") =>
    createKnowledgeSchemaRevisionV1({ body, code: "person", compatibility, description: localized,
      kind: "concept", labels: localized, namespace: "oh.core", previousSchemaSha256: prior, revision, v: 1 });

  test("chains revisions and rejects a false additive claim", () => {
    const first = revision(1, { required: ["name"] }, null, "additive");
    const second = revision(2, { optional: ["url"], required: ["name"] }, first.schemaSha256, "additive");
    expect(parseKnowledgeSchemaRevisionV1(first)).toEqual(first);
    expect(verifyKnowledgeSchemaEvolutionV1(first, second)).toEqual({ ok: true });
    const falseAdditive = revision(2, { required: [] }, first.schemaSha256, "additive");
    expect(verifyKnowledgeSchemaEvolutionV1(first, falseAdditive)).toEqual({ ok: false, reason: "false-additive-claim" });
  });

  test("builds ordered vocabulary manifests", () => {
    const first = revision(1, { type: "object" }, null, "additive");
    const ref = knowledgeSchemaRefV1(first);
    const vocabulary = createKnowledgeVocabularyRevisionV1({ namespace: "oh.core", revision: 1,
      schemaRefs: [ref], v: 1 });
    expect(vocabulary.schemaRefs).toEqual([ref]);
  });
});

describe("graph contracts", () => {
  test("addresses records and deterministically reduces revisions", () => {
    const entity = createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:ada", kind: "entity",
      v: 1, value: { entityId } });
    const statement = createKnowledgeGraphRecordV1({ dependencies: [entity.key], key: "statement:ada-name",
      kind: "statement", v: 1, value: { text: "Ada" } });
    expect(parseKnowledgeGraphRecordV1(entity)).toEqual(entity);
    const hidden = { ...entity } as Record<PropertyKey, unknown>;
    Object.defineProperty(hidden, "hidden", { value: true });
    const symbolic = { ...entity } as Record<PropertyKey, unknown>;
    symbolic[Symbol("hidden")] = true;
    let accessorReads = 0;
    const accessor = { ...entity } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessor, "recordSha256", {
      enumerable: true,
      get() { accessorReads += 1; throw new Error("must not execute"); },
    });
    expect(parseKnowledgeGraphRecordV1(hidden)).toBeNull();
    expect(parseKnowledgeGraphRecordV1(symbolic)).toBeNull();
    expect(parseKnowledgeGraphRecordV1(accessor)).toBeNull();
    expect(accessorReads).toBe(0);
    const first = createKnowledgeGraphRevisionV1({ changes: [
      { kind: "put", record: statement, v: 1 }, { kind: "put", record: entity, v: 1 },
    ], operationId: "op_first", parent: null });
    expect(parseKnowledgeGraphRevisionV1(first)).toEqual(first);
    expect(first.graphRevisionSha256).toBe(graphRevisionSha256V1({ changes: first.changes,
      operationId: first.operationId, parentGraphRevisionSha256: first.parentGraphRevisionSha256,
      recordsSha256: first.recordsSha256, revision: first.revision }));
    expect(first.recordRefs.find((ref) => ref.key === statement.key)?.dependencies).toEqual([entity.key]);
    expect(() => createKnowledgeGraphRevisionV1({ changes: [{ key: entity.key, kind: "tombstone",
      priorSha256: entity.recordSha256, v: 1 }], operationId: "op_bad_delete", parent: first }))
      .toThrow("Missing graph dependency");
    const updatedStatement = createKnowledgeGraphRecordV1({ dependencies: [entity.key], key: statement.key,
      kind: "statement", v: 1, value: { text: "Ada Lovelace" } });
    const second = createKnowledgeGraphRevisionV1({ changes: [{ kind: "put", record: updatedStatement, v: 1 }],
      operationId: "op_second", parent: first });
    expect(reduceKnowledgeGraphRevisionsV1([second, first])?.graphRevisionSha256).toBe(second.graphRevisionSha256);
    expect(reduceKnowledgeGraphRevisionsV1([{ ...second, recordsSha256: digest }])).toBeNull();
  });

  test("rejects snapshots beyond the V1 record ceiling before parsing their contents", () => {
    expect(parseKnowledgeGraphRevisionV1({
      changes: [], graphRevisionSha256: digest, operationId: "op_oversized",
      parentGraphRevisionSha256: null,
      recordRefs: Array.from({ length: OH_GRAPH_LIMITS_V1.recordsPerSnapshot + 1 }),
      recordsSha256: digest, revision: 1, v: 1,
    })).toBeNull();
  });

  test("manifest pins every wire-level contract input", () => {
    expect(OH_CONTRACT_MANIFEST_V1.contractId).toBe("oh.ontology.v1");
    expect(OH_CONTRACT_MANIFEST_V1.recordKinds).toContain("statement");
    expect(canonicalJson(OH_CONTRACT_MANIFEST_V1)).toContain(OH_CONTRACT_MANIFEST_V1.contractSha256);
  });
});
