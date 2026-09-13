import { describe, expect, test } from "bun:test";

import { canonicalJson } from "./document-domain";
import { parseSha256Hex, sha256Text, type Sha256Hex } from "./integrity-domain";
import {
  createKnowledgeActivityV1,
  createKnowledgeAssertionV1,
  createKnowledgeContextV1,
  createKnowledgeEvidenceLinkV1,
  createKnowledgeEditionReleaseV1,
  createKnowledgeEditionV1,
  createKnowledgeHumanReviewReceiptV1,
  createKnowledgeInquiryV1,
  createKnowledgeShapeV1,
  createKnowledgeStatementV1,
  createKnowledgeSynthesisCandidateV1,
  createKnowledgeViewSpecV1,
  parseKnowledgeActivityV1,
  parseKnowledgeAssertionId,
  parseKnowledgeAssertionV1,
  parseKnowledgeContextV1,
  parseKnowledgeEditionId,
  parseKnowledgeEntityId,
  parseKnowledgeEntityV1,
  parseKnowledgeEvidenceId,
  parseKnowledgeEvidenceLinkV1,
  parseKnowledgeEditionReleaseV1,
  parseKnowledgeEditionV1,
  parseKnowledgeHumanReviewReceiptV1,
  parseKnowledgeInquiryId,
  parseKnowledgeInquiryV1,
  parseKnowledgeShapeV1,
  parseKnowledgeStatementV1,
  parseKnowledgeSynthesisCandidateV1,
  parseKnowledgeValueV1,
  parseKnowledgeViewSpecV1,
  verifyKnowledgeValueV1,
  type KnowledgeDimensionV1,
  type KnowledgeEntityId,
  type KnowledgeSchemaRefV1,
  type KnowledgeValueV1,
} from "./knowledge-ontology-v1";

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Expected a valid fixture value.");
  return value;
}

function digest(fill: string): Sha256Hex {
  return required(parseSha256Hex(fill.repeat(64)));
}

function entity(fill: string): KnowledgeEntityId {
  return required(parseKnowledgeEntityId(`kent_${fill.repeat(24)}`));
}

function schema(
  code: string,
  fill = "a",
  namespace = "sponge.knowledge",
): KnowledgeSchemaRefV1 {
  return { code, namespace, revision: 1, schemaSha256: digest(fill), v: 1 };
}

function dimension(
  code: string,
  value: KnowledgeValueV1,
  fill = "b",
): KnowledgeDimensionV1 {
  return { predicate: schema(code, fill), v: 1, value };
}

describe("knowledge ontology identity and canonical semantics", () => {
  test("keeps identity opaque and requires coherent lifecycle state", () => {
    const entityId = entity("a");
    expect(parseKnowledgeEntityV1({
      entityId,
      identityOperationId: "identity.bootstrap",
      identityRevision: 1,
      redirectEntityId: null,
      state: "active",
      v: 1,
    })).toEqual({
      ok: true,
      value: {
        entityId,
        identityOperationId: "identity.bootstrap",
        identityRevision: 1,
        redirectEntityId: null,
        state: "active",
        v: 1,
      },
    });
    expect(parseKnowledgeEntityV1({
      entityId,
      identityOperationId: "identity.redirect",
      identityRevision: 1,
      redirectEntityId: entity("c"),
      state: "active",
      v: 1,
    })).toMatchObject({ error: { field: "entity" }, ok: false });
  });

  test("canonicalizes qualifier and context order into stable hashes", async () => {
    const temporal = dimension("valid-time", {
      calendar: schema("gregorian-calendar", "9"),
      certainty: "exact",
      earliest: null,
      kind: "time",
      latest: null,
      precision: "year",
      timezone: null,
      v: 1,
      value: "1789",
    }, "c");
    const jurisdiction = dimension("jurisdiction", {
      entityId: entity("j"), kind: "entity", v: 1,
    }, "d");
    const first = await createKnowledgeStatementV1({
      object: { entityId: entity("e"), kind: "entity", v: 1 },
      predicate: schema("instance-of", "e"),
      qualifiers: [temporal, jurisdiction],
      subject: entity("f"),
      v: 1,
    });
    const second = await createKnowledgeStatementV1({
      object: { entityId: entity("e"), kind: "entity", v: 1 },
      predicate: schema("instance-of", "e"),
      qualifiers: [jurisdiction, temporal],
      subject: entity("f"),
      v: 1,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.statementSha256).toBe(second.value.statementSha256);
    expect(first.value.qualifiers).toEqual(second.value.qualifiers);
    expect(await parseKnowledgeStatementV1(first.value)).toEqual(first);

    const contextA = await createKnowledgeContextV1({
      dimensions: [temporal, jurisdiction], scenario: "actual", v: 1,
    });
    const contextB = await createKnowledgeContextV1({
      dimensions: [jurisdiction, temporal], scenario: "actual", v: 1,
    });
    expect(contextA.ok && contextB.ok).toBe(true);
    if (!contextA.ok || !contextB.ok) return;
    expect(contextA.value.contextSha256).toBe(contextB.value.contextSha256);
    expect(await parseKnowledgeContextV1(contextA.value)).toEqual(contextA);

    const duplicate = await createKnowledgeStatementV1({
      object: first.value.object,
      predicate: first.value.predicate,
      qualifiers: [temporal, temporal],
      subject: first.value.subject,
      v: 1,
    });
    expect(duplicate).toMatchObject({
      error: { code: "noncanonical-input", field: "qualifiers" }, ok: false,
    });
  });

  test("rejects arbitrary payloads and verifies schema-addressed extensions", async () => {
    expect(parseKnowledgeValueV1({ kind: "json", v: 1, value: {} }))
      .toMatchObject({ error: { field: "value" }, ok: false });
    const canonicalValue = canonicalJson({ mode: "domain-specific", rank: 3 });
    const extension = {
      canonicalizerSha256: digest("e"),
      canonicalValue,
      kind: "extension" as const,
      mediaType: "application/json",
      schema: schema("domain-value", "f"),
      v: 1 as const,
      valueSha256: await sha256Text(canonicalValue),
    };
    expect(await verifyKnowledgeValueV1(extension)).toEqual({ ok: true, value: extension });
    expect(await verifyKnowledgeValueV1({ ...extension, valueSha256: digest("0") }))
      .toMatchObject({ error: { code: "digest-mismatch" }, ok: false });
    expect(parseKnowledgeValueV1({
      kind: "decimal", v: 1, value: "1.2300",
    })).toMatchObject({ error: { field: "value" }, ok: false });
    expect(parseKnowledgeValueV1({
      kind: "decimal", v: 1, value: "-0.25",
    })).toMatchObject({ ok: true });
  });
});

describe("knowledge authority, evidence, and provenance", () => {
  test("keeps model output proposed while allowing purpose-bound human review", async () => {
    const statementSha256 = digest("1");
    const modelAssertionId = required(parseKnowledgeAssertionId(`kast_${"m".repeat(24)}`));
    const model = {
      kind: "model" as const,
      model: schema("atlas-model", "2"),
      receiptSha256: digest("3"),
      v: 1 as const,
    };
    const proposed = await createKnowledgeAssertionV1({
      acceptedPurposes: [],
      assertionId: modelAssertionId,
      assertor: model,
      confidence: null,
      contextSha256: null,
      provenanceActivitySha256: digest("4"),
      reviewActivitySha256: null,
      stance: "supports",
      state: "proposed",
      statementSha256,
      v: 1,
    });
    expect(proposed.ok).toBe(true);
    const promotedModel = await createKnowledgeAssertionV1({
      acceptedPurposes: ["public-encyclopedia"],
      assertionId: modelAssertionId,
      assertor: model,
      confidence: null,
      contextSha256: null,
      provenanceActivitySha256: digest("4"),
      reviewActivitySha256: digest("5"),
      stance: "supports",
      state: "accepted-for-purpose",
      statementSha256,
      v: 1,
    });
    expect(promotedModel).toMatchObject({
      error: { code: "authority-violation", field: "assertor" }, ok: false,
    });

    const reviewed = await createKnowledgeAssertionV1({
      acceptedPurposes: ["public-encyclopedia"],
      assertionId: required(parseKnowledgeAssertionId(`kast_${"h".repeat(24)}`)),
      assertor: { entityId: entity("h"), kind: "entity", v: 1 },
      confidence: schema("reviewed-confidence", "6"),
      contextSha256: null,
      provenanceActivitySha256: digest("7"),
      reviewActivitySha256: digest("8"),
      stance: "supports",
      state: "accepted-for-purpose",
      statementSha256,
      v: 1,
    });
    expect(reviewed.ok).toBe(true);
    if (reviewed.ok) expect(await parseKnowledgeAssertionV1(reviewed.value)).toEqual(reviewed);
  });

  test("requires attributable evidence and content-addressed provenance", async () => {
    const activity = await createKnowledgeActivityV1({
      actor: { entityId: entity("a"), kind: "entity", v: 1 },
      inputSha256s: [digest("1")],
      kind: "human-review",
      occurredAt: "2026-08-16T12:00:00.000Z",
      outputSha256s: [digest("2")],
      policySha256: digest("3"),
      tool: null,
      v: 1,
    });
    expect(activity.ok).toBe(true);
    if (activity.ok) expect(await parseKnowledgeActivityV1(activity.value)).toEqual(activity);

    const baseEvidence = {
      assertionSha256: digest("4"),
      bearing: "corroborates" as const,
      disclosure: "public" as const,
      evidenceId: required(parseKnowledgeEvidenceId(`kevd_${"e".repeat(24)}`)),
      observationSha256: null,
      provenanceActivitySha256: digest("5"),
      selector: "p. 42",
      sourceEntityId: entity("s"),
      v: 1 as const,
    };
    const evidence = await createKnowledgeEvidenceLinkV1(baseEvidence);
    expect(evidence.ok).toBe(true);
    if (evidence.ok) {
      expect(await parseKnowledgeEvidenceLinkV1(evidence.value)).toEqual(evidence);
      expect(await parseKnowledgeEvidenceLinkV1({
        ...evidence.value,
        rightsDecisionSha256: digest("6"),
      })).toMatchObject({ error: { field: "evidence" }, ok: false });
    }
    expect(await createKnowledgeEvidenceLinkV1({
      ...baseEvidence, observationSha256: null, sourceEntityId: null,
    })).toMatchObject({ error: { field: "evidence" }, ok: false });
  });
});

describe("curiosity-led views and immutable editions", () => {
  test("binds an inquiry, view policy, and reviewed synthesis edition", async () => {
    const inquiry = await createKnowledgeInquiryV1({
      answerForm: "explanation",
      authorEntityId: entity("a"),
      contextSha256: null,
      createdAt: "2026-08-16T12:00:00.000Z",
      inquiryId: required(parseKnowledgeInquiryId(`kinq_${"q".repeat(24)}`)),
      language: "en",
      parentInquiryIds: [],
      privacy: "public",
      question: "How do ideas become durable public knowledge?",
      status: "open",
      v: 1,
    });
    expect(inquiry.ok).toBe(true);
    if (!inquiry.ok) return;
    expect(await parseKnowledgeInquiryV1(inquiry.value)).toEqual(inquiry);
    expect(inquiry.value.parentEditionId).toBeNull();
    // Records written before `parentEditionId` existed omit the key and keep their digest.
    const legacy = Object.fromEntries(Object.entries(inquiry.value)
      .filter(([key]) => key !== "parentEditionId"));
    expect(await parseKnowledgeInquiryV1(legacy)).toEqual(inquiry);
    const parentEditionId = required(parseKnowledgeEditionId(`kedn_${"p".repeat(24)}`));
    const legacyInput = Object.fromEntries(Object.entries(legacy)
      .filter(([key]) => key !== "inquirySha256")) as Omit<typeof inquiry.value,
      "inquirySha256" | "parentEditionId">;
    const followUp = await createKnowledgeInquiryV1({
      ...legacyInput, inquiryId: required(parseKnowledgeInquiryId(`kinq_${"r".repeat(24)}`)),
      parentEditionId,
    });
    expect(followUp.ok).toBe(true);
    if (!followUp.ok) return;
    expect(followUp.value.parentEditionId).toBe(parentEditionId);
    expect(followUp.value.inquirySha256).not.toBe(inquiry.value.inquirySha256);
    expect(await parseKnowledgeInquiryV1(followUp.value)).toEqual(followUp);
    expect(await parseKnowledgeInquiryV1({ ...followUp.value, parentEditionId: "kedn_x" }))
      .toMatchObject({ ok: false });

    const shape = await createKnowledgeShapeV1({
      allowedPredicates: [schema("has-evidence", "a")],
      extends: [],
      requiredEvidenceBearings: ["supports"],
      requiredPredicates: [schema("has-evidence", "a")],
      shape: schema("public-explanation-shape", "b"),
      v: 1,
    });
    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    expect(await parseKnowledgeShapeV1(shape.value)).toEqual(shape);

    const view = await createKnowledgeViewSpecV1({
      audience: "general-reader",
      budgets: { bytes: 64_000, depth: 6, sources: 48 },
      excludedContextSha256s: [],
      includedContextSha256s: [],
      language: "en",
      policySha256s: {
        dispute: digest("1"), evidence: digest("2"), rights: digest("3"),
        traversal: digest("4"),
      },
      root: { inquiryId: inquiry.value.inquiryId, kind: "inquiry" },
      shapes: [shape.value.shape],
      v: 1,
      viewForm: "explanation",
      vocabularies: [schema("kernel-vocabulary", "c")],
    });
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(await parseKnowledgeViewSpecV1(view.value)).toEqual(view);

    const candidate = await createKnowledgeSynthesisCandidateV1({
      assertionSha256s: [digest("5")],
      canonicalOutputSha256: digest("6"),
      editionId: required(parseKnowledgeEditionId(`kedn_${"e".repeat(24)}`)),
      evidenceSha256s: [digest("7")],
      generationReceiptSha256: digest("8"),
      identityReceiptSha256: digest("b"),
      inputGraphRevisionSha256: digest("9"),
      passages: [{
        authorship: "model",
        supportStatementSha256s: [digest("c")],
        text: "A reviewed synthesis remains linked to the statements that support it.",
        v: 1,
      }],
      purpose: "public-encyclopedia",
      rightsReceiptSha256: digest("d"),
      statementSha256s: [digest("c")],
      unresolvedStatementSha256s: [],
      v: 1,
      viewSpecSha256: view.value.viewSpecSha256,
    });
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(await parseKnowledgeSynthesisCandidateV1(candidate.value)).toEqual(candidate);
    expect(await parseKnowledgeSynthesisCandidateV1({
      ...candidate.value, canonicalOutputSha256: digest("f"),
    })).toMatchObject({ error: { code: "digest-mismatch" }, ok: false });
    const humanPassages = candidate.value.passages.map((passage) => ({
      ...passage, authorship: "human" as const,
    }));
    const { candidateSha256, ...candidateInput } = candidate.value;
    expect(candidateSha256).toHaveLength(64);
    expect(await createKnowledgeSynthesisCandidateV1({
      ...candidateInput,
      generationReceiptSha256: digest("8"),
      passages: humanPassages,
    })).toMatchObject({ error: { field: "candidate" }, ok: false });
    expect((await createKnowledgeSynthesisCandidateV1({
      assertionSha256s: candidate.value.assertionSha256s,
      canonicalOutputSha256: candidate.value.canonicalOutputSha256,
      editionId: candidate.value.editionId,
      evidenceSha256s: candidate.value.evidenceSha256s,
      generationReceiptSha256: null,
      identityReceiptSha256: candidate.value.identityReceiptSha256,
      inputGraphRevisionSha256: candidate.value.inputGraphRevisionSha256,
      passages: humanPassages,
      purpose: "public-encyclopedia",
      rightsReceiptSha256: candidate.value.rightsReceiptSha256,
      statementSha256s: candidate.value.statementSha256s,
      unresolvedStatementSha256s: candidate.value.unresolvedStatementSha256s,
      v: 1,
      viewSpecSha256: candidate.value.viewSpecSha256,
    })).ok).toBe(true);
    expect(await createKnowledgeSynthesisCandidateV1({
      assertionSha256s: candidate.value.assertionSha256s,
      canonicalOutputSha256: candidate.value.canonicalOutputSha256,
      editionId: candidate.value.editionId,
      evidenceSha256s: candidate.value.evidenceSha256s,
      generationReceiptSha256: null,
      identityReceiptSha256: candidate.value.identityReceiptSha256,
      inputGraphRevisionSha256: candidate.value.inputGraphRevisionSha256,
      passages: candidate.value.passages,
      purpose: "public-encyclopedia",
      rightsReceiptSha256: candidate.value.rightsReceiptSha256,
      statementSha256s: candidate.value.statementSha256s,
      unresolvedStatementSha256s: candidate.value.unresolvedStatementSha256s,
      v: 1,
      viewSpecSha256: candidate.value.viewSpecSha256,
    })).toMatchObject({ error: { field: "candidate" }, ok: false });

    const review = await createKnowledgeHumanReviewReceiptV1({
      candidateSha256: candidate.value.candidateSha256,
      decisionSha256: digest("a"),
      outcome: "accept",
      policySha256: digest("1"),
      purpose: "public-encyclopedia",
      reviewedAt: "2026-08-16T12:30:00.000Z",
      reviewerEntityId: entity("a"),
      v: 1,
    });
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(await parseKnowledgeHumanReviewReceiptV1(review.value)).toEqual(review);
    const edition = await createKnowledgeEditionV1({
      candidateSha256: candidate.value.candidateSha256,
      dependencyManifestSha256: digest("2"),
      editionId: candidate.value.editionId,
      humanReviewReceiptSha256: review.value.receiptSha256,
      inputGraphRevisionSha256: candidate.value.inputGraphRevisionSha256,
      purpose: "public-encyclopedia",
      reviewDecisionSha256: review.value.decisionSha256,
      v: 1,
    });
    expect(edition.ok).toBe(true);
    if (!edition.ok) return;
    expect(await parseKnowledgeEditionV1(edition.value)).toEqual(edition);
    const release = await createKnowledgeEditionReleaseV1({
      authorityAckReceiptSha256: digest("3"),
      candidateSha256: candidate.value.candidateSha256,
      completionReceiptSha256: digest("4"),
      dependencyManifestSha256: edition.value.dependencyManifestSha256,
      editionId: edition.value.editionId,
      editionSha256: edition.value.editionSha256,
      humanReviewReceiptSha256: edition.value.humanReviewReceiptSha256,
      inputGraphRevisionSha256: edition.value.inputGraphRevisionSha256,
      operationId: "edition.release.operation",
      outputGraphRevisionSha256: digest("e"),
      publishedAt: "2026-08-16T12:31:00.000Z",
      purpose: "public-encyclopedia",
      v: 1,
    });
    expect(release.ok).toBe(true);
    if (release.ok) expect(await parseKnowledgeEditionReleaseV1(release.value)).toEqual(release);
  });
});
