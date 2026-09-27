import { canonicalSha256, isPlainRecord } from "../../src/canonical";
import { parseBeamSupermemorySearchV1, prepareBeamSupermemorySessionsV1 } from "./beam-supermemory";
import { FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1, packFrameworkPilotEvidenceV1,
  prepareFrameworkPilotEvidenceV1 } from "./framework-pilot-evidence-v1";
import { FRAMEWORK_PILOT_SPLIT_PLAN_V1, parseFrameworkPilotSourceV1, validateFrameworkPilotSourceUnitsV1,
  type FrameworkPilotSourceUnitV1 } from "./framework-pilot-source-v1";
import type { FrameworkPilotTokenizerConfigurationV1 } from "./framework-pilot-tokenizer-v1";

export const BEAM_SUPERMEMORY_CONTEXT_INPUT_V1 = "oh.beam-supermemory-context-input.v1" as const;
function need(value: unknown, reason: string): asserts value { if (!value) throw new TypeError(`BEAM Supermemory context: ${reason}.`); }
function object(input: unknown, fields: readonly string[]): Record<string, unknown> {
  need(isPlainRecord(input) && Reflect.ownKeys(input).length === fields.length, "exact input fields required");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    need(descriptor?.enumerable && "value" in descriptor, "enumerable data fields required"); result[key] = descriptor.value;
  }
  return result;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Session references establish documentary association, never which individual
 * turn supports a generated statement. Keep that distinction outside reader text. */
export function prepareBeamSupermemoryContextInputV1(input: unknown) {
  const row = object(input, ["protocol", "sessionInput", "splitPlan", "sourceUnits", "accepted", "observations", "response", "maxContextTokens"]);
  need(row.protocol === BEAM_SUPERMEMORY_CONTEXT_INPUT_V1, "input protocol");
  need(typeof row.maxContextTokens === "number" && Number.isSafeInteger(row.maxContextTokens)
    && row.maxContextTokens >= 1 && row.maxContextTokens <= FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.contextTokens, "context token budget");
  const sessionInput = object(row.sessionInput, ["protocol", "target", "namespace", "source", "documentDates", "dreaming"]);
  // Rebuild both plans from the same source. A rehashed caller-written session
  // plan or unit bundle cannot substitute different content or occurrences.
  const source = parseFrameworkPilotSourceV1(sessionInput.source);
  const plan = prepareBeamSupermemorySessionsV1({ ...sessionInput, source });
  const sourceUnits = validateFrameworkPilotSourceUnitsV1(row.sourceUnits, source, row.splitPlan);
  need(plan.sourceSha256 === sourceUnits.sourceSha256, "source binding mismatch");
  const originalEvidence = parseBeamSupermemorySearchV1(plan, row.accepted, row.observations, row.response);

  const byOccurrence = new Map<number, FrameworkPilotSourceUnitV1[]>();
  const turns: { turnId: string; spans: { startByte: number; endByte: number }[] }[] = [];
  for (const unit of sourceUnits.units) {
    const units = byOccurrence.get(unit.sessionIndex) ?? [];
    units.push(unit); byOccurrence.set(unit.sessionIndex, units);
    let turn = turns[turns.length - 1];
    if (turn?.turnId !== unit.turnId) { turn = { turnId: unit.turnId, spans: [] }; turns.push(turn); }
    turn.spans.push({ startByte: unit.startByte, endByte: unit.endByte });
  }
  const splitPlan = { protocol: FRAMEWORK_PILOT_SPLIT_PLAN_V1, sourceSha256: sourceUnits.sourceSha256, turns };
  const documents = new Map(plan.documents.map(document => [document.metadata.sourceUnitId, document]));
  const provenance = originalEvidence.evidence.map(evidence => {
    let count = 0;
    const references = evidence.documentReferences.map(reference => {
      const document = documents.get(reference.sourceUnitId);
      need(document && document.metadata.sourceUnitSha256 === reference.sourceUnitSha256, "session reference binding mismatch");
      const sessionIndex = document.metadata.sourceSessionIndex, sessionId = document.metadata.sourceSessionId;
      const units = byOccurrence.get(sessionIndex);
      need(units && units.length > 0 && units.every(unit => unit.sessionId === sessionId), "referenced session has no complete unit mapping");
      count += units.length;
      need(count <= FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.referencesPerCandidate, "expanded reference limit");
      return { ...reference, sessionId, sessionIndex,
        units: units.map(unit => ({ sourceUnitId: unit.unitId, sourceUnitSha256: unit.unitSha256 })) };
    });
    return { rank: evidence.rank, providerId: evidence.providerId,
      referenceScope: "session-document" as const, sourceTextAuthenticated: false as const, references };
  });
  const candidates = originalEvidence.evidence.map((evidence, index) => {
    // Provider reference order remains in provenance. The common join follows
    // source occurrence/turn/part order, without changing provider result rank.
    const documentReferences = [...provenance[index]!.references].sort((a, b) => a.sessionIndex - b.sessionIndex).flatMap(reference => reference.units);
    need(new Set(documentReferences.map(reference => reference.sourceUnitId)).size === documentReferences.length, "duplicate expanded reference");
    return { kind: evidence.kind, providerId: evidence.providerId, content: evidence.content, documentReferences };
  });
  const commonEvidenceInput = { protocol: "oh.framework-pilot-evidence-input.v1" as const,
    source, splitPlan, sourceUnits, candidates, maxContextTokens: row.maxContextTokens };
  // Validate every candidate, including any suffix the packer would omit,
  // before the caller can open a tokenizer process.
  const commonEvidence = prepareFrameworkPilotEvidenceV1(commonEvidenceInput);
  const payload = { protocol: "oh.beam-supermemory-context-bridge.v1" as const, planSha256: plan.planSha256,
    sourceSha256: sourceUnits.sourceSha256, bundleSha256: sourceUnits.bundleSha256,
    referenceScope: "session-document" as const, sourceTextAuthenticated: false as const,
    originalEvidence, provenance, commonEvidenceInput, commonEvidence };
  return freeze({ ...payload, bridgeSha256: canonicalSha256(payload) });
}

/** The existing shared packer owns token counting, whole-block clipping and
 * neutral reader rendering. This wrapper performs no provider I/O. */
export function packBeamSupermemoryEvidenceV1(input: unknown, tokenizer: FrameworkPilotTokenizerConfigurationV1) {
  const bridge = prepareBeamSupermemoryContextInputV1(input);
  return freeze({ bridge, context: packFrameworkPilotEvidenceV1(bridge.commonEvidenceInput, tokenizer) });
}
