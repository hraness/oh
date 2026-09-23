import { canonicalJson, canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { validateFrameworkPilotSourceUnitsV1 } from "./framework-pilot-source-v1";
import { countFrameworkPilotTokenBatchV1, FRAMEWORK_PILOT_TOKENIZER_V1,
  type FrameworkPilotTokenizerConfigurationV1 } from "./framework-pilot-tokenizer-v1";

export const FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1 = Object.freeze({
  candidates: 20, contextTokens: 8_192, candidateJsonBytes: 65_536, candidatesJsonBytes: 262_144,
  referencesPerCandidate: 2_000, providerIdBytes: 128,
});
type Kind = "source-unit" | "provider-generated-memory" | "provider-document-chunk";
type Candidate = Readonly<{ evidenceId: string; kind: Kind; content: string;
  sourceUnitIds: readonly string[]; originalId: string; identitySha256: string }>;
export type FrameworkPilotEvidenceV1 = Readonly<{
  protocol: "oh.framework-pilot-evidence.v1"; sourceSha256: string; bundleSha256: string;
  candidates: readonly Candidate[]; maxContextTokens: number; evidenceSha256: string;
}>;

function fail(reason: string): never { throw new TypeError(`Framework pilot evidence: ${reason}.`); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length !== keys.length) fail("unexpected fields");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !("value" in property)) fail("data fields required");
    result[key] = property.value;
  }
  return result;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) fail("bounded dense array required");
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property?.enumerable || !("value" in property)) fail("array data required");
    return property.value;
  });
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || Buffer.byteLength(value) > maximum || /\p{Surrogate}/u.test(value)) fail("invalid text");
  return value;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function readerBlock(candidate: Candidate): string {
  // The neutral evidence ordinal identifies a returned item, not an original source unit.
  // Source/provenance joins remain in the capture, outside the reader's evidence text.
  return canonicalJson({ evidenceId: candidate.evidenceId, kind: candidate.kind, content: candidate.content });
}

/** Build a typed common evidence envelope. Source content is derived from the validated
 * bundle. Provider text is a caller-supplied provider capture with explicit references;
 * a valid source reference authenticates that reference, never the generated statement.
 * Raw provider response/transport admission remains a separate campaign requirement. */
export function prepareFrameworkPilotEvidenceV1(input: unknown): FrameworkPilotEvidenceV1 {
  const value = exact(input, ["protocol", "source", "splitPlan", "sourceUnits", "candidates", "maxContextTokens"]);
  if (value.protocol !== "oh.framework-pilot-evidence-input.v1" || typeof value.maxContextTokens !== "number"
    || !Number.isSafeInteger(value.maxContextTokens) || value.maxContextTokens < 1
    || value.maxContextTokens > FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.contextTokens) fail("invalid protocol or context budget");
  const bundle = validateFrameworkPilotSourceUnitsV1(value.sourceUnits, value.source, value.splitPlan);
  const units = new Map(bundle.units.map(unit => [unit.unitId, unit]));
  const identities = new Map<string, Candidate>(), candidates: Candidate[] = [];
  for (const raw of array(value.candidates, FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.candidates)) {
    if (!isPlainRecord(raw)) fail("invalid candidate");
    const kindProperty = Object.getOwnPropertyDescriptor(raw, "kind");
    if (!kindProperty?.enumerable || !("value" in kindProperty)) fail("kind data required");
    const kind: unknown = kindProperty.value;
    let content: string, originalId: string, sourceUnitIds: string[];
    if (kind === "source-unit") {
      const row = exact(raw, ["kind", "unitId"]), unit = units.get(text(row.unitId, 16));
      if (unit === undefined) fail("unknown source unit");
      const { unitSha256: _digest, ...sourceContent } = unit;
      originalId = unit.unitId; sourceUnitIds = [unit.unitId]; content = canonicalJson(sourceContent);
    } else if (kind === "provider-generated-memory" || kind === "provider-document-chunk") {
      const row = exact(raw, ["kind", "providerId", "content", "documentReferences"]);
      originalId = text(row.providerId, FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.providerIdBytes);
      if (!/^[A-Za-z0-9_-]+$/.test(originalId)) fail("invalid provider identity");
      content = text(row.content, FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.candidateJsonBytes);
      if (content.length === 0) fail("empty provider evidence");
      const seen = new Set<string>();
      sourceUnitIds = array(row.documentReferences, FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.referencesPerCandidate).map(rawRef => {
        const ref = exact(rawRef, ["sourceUnitId", "sourceUnitSha256"]), unit = units.get(text(ref.sourceUnitId, 16));
        if (unit === undefined || ref.sourceUnitSha256 !== unit.unitSha256 || seen.has(unit.unitId)) fail("invalid provider source reference");
        seen.add(unit.unitId); return unit.unitId;
      });
      if (sourceUnitIds.length === 0) fail("unmapped provider evidence");
    } else fail("invalid evidence kind");
    const key = `${kind === "source-unit" ? "source" : "provider"}:${originalId}`,
      identitySha256 = canonicalSha256({ kind, originalId, content, sourceUnitIds });
    const previous = identities.get(key);
    if (previous !== undefined && previous.identitySha256 !== identitySha256) fail("conflicting evidence identity");
    const candidate: Candidate = previous ?? freeze({ evidenceId: `e${String(identities.size + 1).padStart(4, "0")}`,
      kind, originalId, content, sourceUnitIds, identitySha256 });
    if (Buffer.byteLength(canonicalJson(candidate)) > FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.candidateJsonBytes
      || Buffer.byteLength(readerBlock(candidate)) > FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.candidateJsonBytes) fail("candidate byte bound");
    identities.set(key, candidate); candidates.push(candidate);
  }
  if (Buffer.byteLength(canonicalJson(candidates)) > FRAMEWORK_PILOT_EVIDENCE_LIMITS_V1.candidatesJsonBytes) fail("candidate envelope byte bound");
  const result = { protocol: "oh.framework-pilot-evidence.v1" as const, sourceSha256: bundle.sourceSha256,
    bundleSha256: bundle.bundleSha256, candidates, maxContextTokens: value.maxContextTokens };
  return freeze({ ...result, evidenceSha256: canonicalSha256(result) });
}

/** Count every complete unique prefix with the pinned local tokenizer, then retain
 * a rank-ordered prefix of whole blocks. No source-unit ID is invented for provider text.
 * Counts cover the reader evidence string, not its question, prompt or chat framing. */
export function packFrameworkPilotEvidenceV1(input: unknown, configuration: FrameworkPilotTokenizerConfigurationV1) {
  const evidence = prepareFrameworkPilotEvidenceV1(input), prefixes = [""], seen = new Set<string>();
  let accumulated = "";
  for (const candidate of evidence.candidates) if (!seen.has(candidate.evidenceId)) {
    seen.add(candidate.evidenceId);
    const block = readerBlock(candidate); accumulated = accumulated === "" ? block : `${accumulated}\n${block}`;
    prefixes.push(accumulated);
  }
  const tokenization = countFrameworkPilotTokenBatchV1({ protocol: "oh.framework-pilot-token-batch-input.v1", texts: prefixes }, configuration);
  let prefix = 0, overflow = false, context = "", contextTokens = tokenization.rows[0]!.tokens;
  const firstRanks = new Map<string, number>(), included: { rank: number; evidenceId: string; kind: Kind }[] = [];
  const omitted: { rank: number; evidenceId: string; reason: "duplicate" | "overflow" | "after-overflow"; firstRank: number; attemptedContextTokens: number | null }[] = [];
  for (const [index, candidate] of evidence.candidates.entries()) {
    const rank = index + 1, firstRank = firstRanks.get(candidate.evidenceId);
    if (firstRank !== undefined) {
      omitted.push({ rank, evidenceId: candidate.evidenceId, reason: "duplicate", firstRank, attemptedContextTokens: null }); continue;
    }
    firstRanks.set(candidate.evidenceId, rank); prefix++;
    if (overflow) { omitted.push({ rank, evidenceId: candidate.evidenceId, reason: "after-overflow", firstRank: rank, attemptedContextTokens: null }); continue; }
    const attemptedContextTokens = tokenization.rows[prefix]!.tokens;
    if (attemptedContextTokens > evidence.maxContextTokens) {
      overflow = true; omitted.push({ rank, evidenceId: candidate.evidenceId, reason: "overflow", firstRank: rank, attemptedContextTokens }); continue;
    }
    context = prefixes[prefix]!; contextTokens = attemptedContextTokens;
    included.push({ rank, evidenceId: candidate.evidenceId, kind: candidate.kind });
  }
  return freeze({ protocol: "oh.framework-pilot-evidence-context.v1", evidence,
    rendering: "typed-evidence-json-lines.v1", tokenizerIdentity: FRAMEWORK_PILOT_TOKENIZER_V1.identity,
    tokenCountScope: "context-string-only", context, contextBytes: Buffer.byteLength(context),
    contextSha256: sha256Hex(context), contextTokens, included, omitted, tokenization });
}
