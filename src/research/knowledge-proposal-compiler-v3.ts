import { canonicalJson, type JsonValue } from "./document-domain";
import { parseCanonicalInstantV1, parseSha256Hex, sha256Text, utf8ByteLength, type Sha256Hex } from "./integrity-domain";
import { knowledgeDeclarativeJson, freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import {
  createKnowledgeIdentityOperationV1, createKnowledgeTypeMembershipV1, parseKnowledgeSchemaRevisionV1,
  type KnowledgeSchemaRevisionV1, type KnowledgePredicateRevisionV1, type KnowledgeValueRangeV1,
} from "./knowledge-ontology-contract-v1";
import {
  createKnowledgeActivityV1, createKnowledgeAssertionV1, createKnowledgeContextV1,
  createKnowledgeEvidenceLinkV1, createKnowledgeStatementV1,
  parseKnowledgeEntityId, parseKnowledgeEntityV1, parseKnowledgeAssertionId, parseKnowledgeEvidenceId,
  parseKnowledgeSchemaRefV1, verifyKnowledgeValueV1,
  type KnowledgeEntityId, type KnowledgeEntityV1, type KnowledgeSchemaRefV1, type KnowledgeValueV1,
  type KnowledgeDimensionV1, type KnowledgeAssertionV1, type KnowledgeContextV1,
} from "./knowledge-ontology-v1";
import { parseSpongeKnowledgeProposalBundleV2, type SpongeKnowledgeProposalBundleV2 } from "./knowledge-proposal-v2";
import { parseSpongeKnowledgeProposalDraftV3,
  type SpongeKnowledgeEntityReferenceV3, type SpongeKnowledgeProposalValueV3,
  type SpongeKnowledgeProposalDimensionV3,
} from "./knowledge-proposal-v3";
import type { SpongeKnowledgeSemanticRecordInputV2 } from "./record-input";

export type SpongeKnowledgeExistingEntityV3 = Readonly<{
  entity: KnowledgeEntityV1; concepts: readonly KnowledgeSchemaRefV1[];
}>;
/** Trusted, authorized inputs supplied by the operation boundary, never the draft body. */
export type SpongeKnowledgeProposalCompilerAuthorityV3 = Readonly<{
  externalOperationReceiptSha256: string; authorEntityId: string; authoringPolicySha256: string;
  occurredAt: string; spaceId: string; schemas: readonly KnowledgeSchemaRevisionV1[];
  existingEntities: ReadonlyMap<string, SpongeKnowledgeExistingEntityV3>;
}>;
export type SpongeCompiledKnowledgeProposalV3 = Readonly<{
  v: 3; bundle: SpongeKnowledgeProposalBundleV2; draftSha256: Sha256Hex;
  externalOperationReceiptSha256: Sha256Hex;
  entityIds: Readonly<Record<string, KnowledgeEntityId>>;
  sourceAttributions: readonly Readonly<{
    evidenceSha256: Sha256Hex; kind: "agent-supplied"; sourceEntityId: KnowledgeEntityId;
    sourceUri: string | null; selector: string | null; disclosure: "private";
  }>[];
  /** Reference candidates are not store writes or evidence that a vocabulary is installed. */
  schemaCandidates: readonly Readonly<{ status: "unreviewed"; schema: KnowledgeSchemaRevisionV1 }>[];
}>;

function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function required<T>(result: Readonly<{ ok: boolean; value?: T }>): T {
  if (!result.ok || result.value === undefined) throw new Error("Invalid external proposal dependency.");
  return result.value;
}
function compareDecimal(a: string, b: string): number {
  const parts = (value: string) => {
    const [integer = "0", fraction = ""] = value.replace(/^-/, "").split(".");
    return { negative: value.startsWith("-"), integer, fraction };
  };
  const left = parts(a); const right = parts(b);
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const integer = (value: ReturnType<typeof parts>) => BigInt(`${value.integer}${value.fraction.padEnd(scale, "0")}`)
    * (value.negative ? -1n : 1n);
  const x = integer(left); const y = integer(right);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Full-fidelity draft compilation creates proposed/private records and never authorizes admission. */
export async function compileSpongeKnowledgeProposalV3(
  foreign: unknown,
  authority: SpongeKnowledgeProposalCompilerAuthorityV3,
): Promise<SpongeCompiledKnowledgeProposalV3 | null> {
  const draft = parseSpongeKnowledgeProposalDraftV3(foreign);
  const authorEntityId = parseKnowledgeEntityId(authority.authorEntityId);
  const policySha256 = parseSha256Hex(authority.authoringPolicySha256);
  const receipt = parseSha256Hex(authority.externalOperationReceiptSha256);
  const occurredAt = parseCanonicalInstantV1(authority.occurredAt);
  if (draft === null || authorEntityId === null || policySha256 === null || receipt === null || occurredAt === null
    || !/^[A-Za-z0-9][A-Za-z0-9._:/@#~-]{7,159}$/u.test(authority.spaceId)
    || authority.schemas.length > 1_024 || authority.existingEntities.size > 1_024) return null;
  try {
    const schemas = new Map<string, KnowledgeSchemaRevisionV1>();
    for (const foreignSchema of authority.schemas) {
      const copied = knowledgeDeclarativeJson(foreignSchema);
      const schema = required(await parseKnowledgeSchemaRevisionV1(copied));
      const id = canonical(schema.ref);
      if (schemas.has(id)) return null;
      schemas.set(id, schema);
    }
    function schema(ref: KnowledgeSchemaRefV1, kind?: KnowledgeSchemaRevisionV1["kind"]): KnowledgeSchemaRevisionV1 {
      const found = schemas.get(canonical(ref));
      if (found === undefined || kind !== undefined && found.kind !== kind) throw new Error("Unknown exact schema reference.");
      return found;
    }
    const existing = new Map<string, SpongeKnowledgeExistingEntityV3>();
    for (const [id, item] of authority.existingEntities) {
      const entity = required(parseKnowledgeEntityV1(knowledgeDeclarativeJson(item.entity)));
      if (entity.entityId !== id || entity.state !== "active" || entity.redirectEntityId !== null || item.concepts.length > 64) return null;
      const concepts = item.concepts.map((item) => required(parseKnowledgeSchemaRefV1(knowledgeDeclarativeJson(item))));
      for (const concept of concepts) schema(concept, "concept");
      if (new Set(concepts.map(canonical)).size !== concepts.length) return null;
      existing.set(id, { entity, concepts });
    }
    if (!existing.has(authorEntityId)) return null;
    const draftSha256 = await sha256Text(canonical({ domain: "sponge.external-knowledge-draft.v3", draft, v: 3 }));
    const operation = { externalOperationReceiptSha256: receipt, draftSha256, spaceId: authority.spaceId, v: 3 };
    const digestId = async (prefix: "kent" | "kast" | "kevd", kind: string, key: string) =>
      `${prefix}_${(await sha256Text(canonical({ ...operation, domain: `sponge.external-proposal.${kind}.v3`, key }))).slice(0, 24)}`;
    const callerPrefix = `external.${receipt.slice(0, 24)}.${draftSha256.slice(0, 16)}`;
    const core = await spongeCoreKnowledgeCatalogV1();
    const identifierPredicate = core.predicates.find((item) => item.identity.code === "identifier");
    if (identifierPredicate === undefined) return null;
    schema(identifierPredicate.ref, "predicate");
    const provenance = required(await createKnowledgeContextV1({ scenario: "actual", dimensions: [
      { predicate: identifierPredicate.ref, value: { kind: "uri", uri: `urn:sponge:external-operation:sha256:${receipt}`, v: 1 }, v: 1 },
      { predicate: identifierPredicate.ref, value: { kind: "uri", uri: `urn:sponge:external-draft:sha256:${draftSha256}`, v: 1 }, v: 1 },
    ], v: 1 }));
    const actor = { kind: "entity" as const, entityId: authorEntityId, v: 1 as const };
    const activity = required(await createKnowledgeActivityV1({ actor, kind: "model-proposal", occurredAt,
      inputSha256s: [provenance.contextSha256], outputSha256s: [], policySha256, tool: null, v: 1 }));
    const records: SpongeKnowledgeSemanticRecordInputV2[] = [
      { kind: "context", callerRecordKey: `${callerPrefix}.provenance`, value: provenance },
      { kind: "activity", callerRecordKey: `${callerPrefix}.activity`, value: activity },
    ];
    const entityIds = new Map<string, KnowledgeEntityId>();
    const entityConcepts = new Map<string, readonly KnowledgeSchemaRefV1[]>([...existing].map(([id, item]) => [id, item.concepts]));
    for (const item of draft.entities) {
      if (item.kind === "existing") {
        if (!existing.has(item.entityId)) return null;
        entityIds.set(item.key, item.entityId);
        continue;
      }
      for (const concept of item.concepts) schema(concept, "concept");
      const entityId = parseKnowledgeEntityId(await digestId("kent", "entity", item.key));
      if (entityId === null || existing.has(entityId)) return null;
      const operationId = `identity.external.${(await sha256Text(canonical({ ...operation, entityId }))).slice(0, 32)}`;
      const entity: KnowledgeEntityV1 = { entityId, identityOperationId: operationId,
        identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
      const identity = required(await createKnowledgeIdentityOperationV1({ activitySha256: activity.activitySha256,
        assignments: [], kind: "create", occurredAt, operationId, postimageEntities: [entity], preimageEntities: [], v: 1 }));
      records.push({ kind: "entity", value: entity }, { kind: "identity-operation", value: identity });
      entityIds.set(item.key, entityId);
      entityConcepts.set(entityId, item.concepts);
    }
    function resolve(reference: SpongeKnowledgeEntityReferenceV3): KnowledgeEntityId {
      const id = reference.kind === "key" ? entityIds.get(reference.key) : existing.get(reference.entityId)?.entity.entityId;
      if (id === undefined) throw new Error("Unauthorized existing entity reference.");
      return id;
    }
    function hasConcept(entityId: KnowledgeEntityId, expected: KnowledgeSchemaRefV1): boolean {
      const pending = [...(entityConcepts.get(entityId) ?? [])];
      const visited = new Set<string>();
      while (pending.length > 0) {
        if (visited.size > 256) throw new Error("Concept closure bound reached.");
        const current = pending.pop() as KnowledgeSchemaRefV1;
        const key = canonical(current);
        if (key === canonical(expected)) return true;
        if (visited.has(key)) continue;
        visited.add(key);
        const concept = schema(current, "concept");
        if (concept.kind === "concept") pending.push(...concept.broader);
      }
      return false;
    }
    function resolveValue(value: SpongeKnowledgeProposalValueV3): KnowledgeValueV1 {
      if (value.kind === "entity-key") return { kind: "entity", v: 1, entityId: resolve({ kind: "key", key: value.entityKey }) };
      if (value.kind === "entity") {
        if (!existing.has(value.entityId)) throw new Error("Unauthorized literal entity reference.");
        return value;
      }
      if (value.kind === "list" || value.kind === "set") {
        const values = value.values.map(resolveValue);
        if (value.kind === "set") values.sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
        return { kind: value.kind, values, v: 1 };
      }
      if (value.kind === "media" && !existing.has(value.sourceEntityId)) throw new Error("Unauthorized media source.");
      if (value.kind === "quantity") schema(value.unit, "unit");
      if (value.kind === "time" || value.kind === "recurrence") schema(value.calendar, "concept");
      if (value.kind === "geometry") schema(value.crs, "concept");
      if (value.kind === "identifier") schema(value.scheme, "concept");
      if (value.kind === "extension") schema(value.schema);
      if (value.kind === "interval") {
        if (value.start !== null) resolveValue(value.start);
        if (value.end !== null) resolveValue(value.end);
      }
      if (value.kind === "recurrence" && value.startsAt !== null) resolveValue(value.startsAt);
      return value;
    }
    function rangeAccepts(value: KnowledgeValueV1, range: KnowledgeValueRangeV1): boolean {
      switch (range.kind) {
        case "any": return true;
        case "value-kinds": return range.valueKinds.includes(value.kind);
        case "entity-concepts": return value.kind === "entity" && range.concepts.some((concept) => hasConcept(value.entityId, concept));
        case "text": return value.kind === "text" && utf8ByteLength(value.text) <= range.maximumBytes
          && (range.languages === null || range.languages.includes(value.language));
        case "enum": return range.values.some((candidate) => canonical(candidate) === canonical(value));
        case "numeric": {
          const numeric = value.kind === "integer" || value.kind === "decimal" || value.kind === "quantity" ? value.value : null;
          return numeric !== null && (range.unit === null || value.kind === "quantity" && canonical(value.unit) === canonical(range.unit))
            && (range.lowerBound === null || compareDecimal(numeric, range.lowerBound) >= 0)
            && (range.upperBound === null || compareDecimal(numeric, range.upperBound) <= 0);
        }
      }
    }
    function predicate(ref: KnowledgeSchemaRefV1): KnowledgePredicateRevisionV1 {
      const found = schema(ref, "predicate");
      if (found.kind !== "predicate") throw new Error("Invalid predicate.");
      return found;
    }
    async function dimension(item: SpongeKnowledgeProposalDimensionV3): Promise<KnowledgeDimensionV1> {
      const relation = predicate(item.predicate);
      const value = resolveValue(item.value);
      if (!rangeAccepts(value, relation.range) || !(await verifyKnowledgeValueV1(value)).ok) throw new Error("Invalid dimension value.");
      return { predicate: relation.ref, value, v: 1 };
    }
    const contexts = new Map<string, KnowledgeContextV1>();
    for (const item of draft.contexts) {
      const context = required(await createKnowledgeContextV1({ scenario: item.scenario,
        dimensions: await Promise.all(item.dimensions.map(dimension)), v: 1 }));
      contexts.set(item.key, context);
      records.push({ kind: "context", callerRecordKey: `${callerPrefix}.context.${item.key}`, value: context });
    }
    async function fact(input: Readonly<{ key: string; predicate: KnowledgeSchemaRefV1;
      subject: KnowledgeEntityId; object: KnowledgeValueV1; qualifiers: readonly SpongeKnowledgeProposalDimensionV3[];
      context: KnowledgeContextV1 | null; stance: KnowledgeAssertionV1["stance"] }>): Promise<KnowledgeAssertionV1> {
      const relation = predicate(input.predicate);
      if (!rangeAccepts(input.object, relation.range)
        || relation.domainConcepts.length > 0 && !relation.domainConcepts.some((concept) => hasConcept(input.subject, concept))) {
        throw new Error("Predicate domain or range mismatch.");
      }
      if (input.qualifiers.some((item) => !relation.qualifierPredicates.some((allowed) => canonical(allowed) === canonical(item.predicate)))) {
        throw new Error("Undeclared qualifier predicate.");
      }
      const statement = required(await createKnowledgeStatementV1({ subject: input.subject, predicate: relation.ref,
        object: input.object, qualifiers: await Promise.all(input.qualifiers.map(dimension)), v: 1 }));
      const assertionId = parseKnowledgeAssertionId(await digestId("kast", "assertion", input.key));
      if (assertionId === null) throw new Error("Invalid assertion identity.");
      const assertion = required(await createKnowledgeAssertionV1({ acceptedPurposes: [], assertionId, assertor: actor,
        confidence: null, contextSha256: input.context?.contextSha256 ?? null,
        provenanceActivitySha256: activity.activitySha256, reviewActivitySha256: null, stance: input.stance,
        state: "proposed", statementSha256: statement.statementSha256, v: 1 }));
      records.push({ kind: "statement", callerRecordKey: `${callerPrefix}.fact.${input.key}`, value: statement },
        { kind: "assertion", value: assertion });
      return assertion;
    }
    const namePredicate = core.predicates.find((item) => item.identity.code === "name");
    if (namePredicate === undefined) return null;
    for (const item of draft.entities) {
      if (item.kind !== "new") continue;
      const subject = resolve({ kind: "key", key: item.key });
      const name = await fact({ key: `name.${item.key}`, subject, predicate: namePredicate.ref,
        object: { kind: "text", language: item.name.language, text: item.name.text, v: 1 },
        qualifiers: [], context: null, stance: "reports" });
      for (const concept of item.concepts) {
        const membership = required(await createKnowledgeTypeMembershipV1({ entityId: subject, concept,
          assertionSha256: name.assertionSha256, contextSha256: null, validDuring: null, v: 1 }));
        records.push({ kind: "type-membership", callerRecordKey: `${callerPrefix}.membership.${item.key}.${concept.schemaSha256.slice(0, 16)}`,
          value: membership });
      }
    }
    const assertions = new Map<string, KnowledgeAssertionV1>();
    for (const item of draft.facts) {
      assertions.set(item.key, await fact({ key: `draft.${item.key}`, predicate: item.predicate,
        subject: resolve(item.subject), object: resolveValue(item.object), qualifiers: item.qualifiers,
        context: item.contextKey === null ? null : contexts.get(item.contextKey) ?? null, stance: item.stance }));
    }
    const sourceAttributions: SpongeCompiledKnowledgeProposalV3["sourceAttributions"][number][] = [];
    for (const item of draft.evidence) {
      const assertion = assertions.get(item.factKey);
      const evidenceId = parseKnowledgeEvidenceId(await digestId("kevd", "evidence", item.key));
      if (assertion === undefined || evidenceId === null) return null;
      const sourceEntityId = resolve(item.source);
      const selector = canonical({ kind: "agent-supplied-source-attribution", sourceUri: item.attribution.sourceUri,
        selector: item.selector, v: 3 });
      const evidence = required(await createKnowledgeEvidenceLinkV1({ assertionSha256: assertion.assertionSha256,
        bearing: item.bearing, disclosure: "private", evidenceId, observationSha256: null,
        provenanceActivitySha256: activity.activitySha256, selector, sourceEntityId, v: 1 }));
      records.push({ kind: "evidence", value: evidence });
      sourceAttributions.push({ evidenceSha256: evidence.evidenceSha256, kind: "agent-supplied", sourceEntityId,
        sourceUri: item.attribution.sourceUri, selector: item.selector, disclosure: "private" });
    }
    const schemaCandidates = draft.vocabularyDependencies.map((ref) => ({ status: "unreviewed" as const, schema: schema(ref) }));
    if (records.length > 256) return null;
    const bundle = await parseSpongeKnowledgeProposalBundleV2({ records, v: 2 });
    if (bundle === null) return null;
    return freezeKnowledgeDeclaration({ v: 3, bundle, draftSha256, externalOperationReceiptSha256: receipt,
      entityIds: Object.fromEntries(entityIds), sourceAttributions, schemaCandidates });
  } catch {
    return null;
  }
}
