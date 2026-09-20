// Benchmark-only recommendation program. Admission is a recorded premise, not
// a semantic proof. The host owns entity identity, authority and supersession.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex,
  type Sha256Hex } from "../../src/canonical";
import { parseKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import {
  createOhProjectionDatasetV1, createOhProjectionFactV1, createOhProjectionLiteralV1,
  createOhProjectionQueryV1, createOhProjectionRulePackV1, createOhProjectionRuleV1,
  createOhProjectionSnapshotV1, evaluateOhProjectionV1, ohProjectionConstantV1,
  ohProjectionVariableV1, type OhProjectionEvaluationOptionsV1, type OhProjectionProofV1,
  type OhProjectionResultV1,
} from "../../src/projection-public";

export const ANSWER_PROGRAM_LIMITS = Object.freeze({ inputBytes: 262_144, records: 256,
  requests: 32, bindings: 128, valueBytes: 256, queryRows: 512,
  maximumWorkUnits: 100_000, maximumDerivedTuples: 512, maximumRounds: 8,
  maximumProofDepth: 8, maximumProofNodes: 32, maximumTotalProofNodes: 4096,
  maximumResultBytes: 262_144 });

export function answerProgramTextSha256(text: string): Sha256Hex {
  return createHash("sha256").update(text, "utf8").digest("hex") as Sha256Hex;
}

// Captures the exact loaded benchmark module, rather than calling a policy hash
// an implementation digest. The pure runner below performs no I/O. A campaign
// must additionally pin its dependency closure and semantic-admission producer.
export const ANSWER_PROGRAM_IMPLEMENTATION_SHA256 = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url))).digest("hex") as Sha256Hex;

export type RecommendationSource = Readonly<{ recordKey: string; recordSha256: Sha256Hex;
  textPointer: string; start: number; end: number; quoteSha256: Sha256Hex }>;
export type RecommendationBinding = Readonly<{ itemId: string; field: "title" | "narrator";
  source: RecommendationSource;
  admission: Readonly<{ kind: "exact" | "semantic"; decisionSha256: Sha256Hex }> }>;
export type RecommendationRequest = Readonly<{ itemId: string; mode: "optional" | "requested" }>;
export type RecommendationProgramInput = Readonly<{
  snapshot: Parameters<typeof createOhProjectionSnapshotV1>[0];
  requests: readonly RecommendationRequest[];
  bindings: readonly RecommendationBinding[];
  limits?: OhProjectionEvaluationOptionsV1 & Readonly<{ queryRows?: number }>;
}>;
export type RecommendationCitation = RecommendationSource & Readonly<{
  bindingSha256: Sha256Hex; admission: RecommendationBinding["admission"] }>;
export type RecommendationField = Readonly<{ value: string; citations: readonly RecommendationCitation[] }>;
export type RecommendationItem = Readonly<{ itemId: string; mode: RecommendationRequest["mode"];
  status: "recommended" | "omitted-incomplete" | "unknown" | "conflict";
  fields: Readonly<{ title: RecommendationField | null; narrator: RecommendationField | null }>;
  missing: readonly ("title" | "narrator")[]; conflicts: readonly ("title" | "narrator")[] }>;
export type RecommendationProgramResult = Readonly<{
  contract: "oh.benchmark.recommendation-program.v1"; authority: "derived";
  status: "complete" | "truncated" | "exhausted";
  inputSha256: Sha256Hex; implementationSha256: Sha256Hex; snapshotSha256: Sha256Hex;
  datasetSha256: Sha256Hex; rulePackSha256: Sha256Hex;
  projections: readonly OhProjectionResultV1[];
  items: readonly RecommendationItem[]; text: string; reasons: readonly string[];
}>;

function invalid(message: string): never { throw new TypeError(`Answer program: ${message}`); }
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) invalid(`invalid ${label} keys`);
  return value;
}
function hash(value: unknown, label: string): Sha256Hex {
  return parseSha256Hex(value) ?? invalid(`invalid ${label} digest`);
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(value)) {
    invalid("invalid item identifier");
  }
  return value;
}
function list(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(`invalid ${label} count`);
  return value;
}

// Bound foreign objects before canonicalization. Reject accessors, exotic
// objects and cycles; detach after canonical JSON has checked scalar Unicode.
function detachedInput(value: unknown): unknown {
  let bytes = 0; let nodes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (++nodes > 10_000 || depth > 24) invalid("input structure bound");
    if (typeof item === "string") bytes += Buffer.byteLength(item);
    else if (item !== null && typeof item === "object") {
      if ((!Array.isArray(item) && !isPlainRecord(item)) || ancestors.has(item)) invalid("non-JSON input");
      ancestors.add(item);
      const keys = Reflect.ownKeys(item);
      if (keys.length > 10_000) invalid("input property bound");
      for (const key of keys) {
        if (typeof key !== "string") invalid("symbol input key");
        if (Array.isArray(item) && key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || descriptor.get || descriptor.set) invalid("input accessor or hidden property");
        bytes += Buffer.byteLength(key) + 4;
        visit(descriptor.value, depth + 1);
      }
      ancestors.delete(item);
    } else bytes += 16;
    if (bytes > ANSWER_PROGRAM_LIMITS.inputBytes) invalid("input byte bound");
  }
  visit(value, 0);
  const json = canonicalJson(value);
  if (Buffer.byteLength(json) > ANSWER_PROGRAM_LIMITS.inputBytes) invalid("input byte bound");
  return JSON.parse(json) as unknown;
}

function resolveText(source: RecommendationSource, current: KnowledgeGraphRecordV1): string {
  if (source.recordSha256 !== current.recordSha256) invalid("stale source record");
  if (!source.textPointer.startsWith("/value/") || source.textPointer.length > 512) invalid("invalid text pointer");
  const parts = source.textPointer.slice(1).split("/");
  if (parts.length > 8 || parts.some((part) => /~(?![01])/u.test(part))) invalid("invalid text pointer");
  let value: unknown = current;
  for (const raw of parts) {
    const key = raw.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)
      || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/u.test(key))) invalid("unresolved text pointer");
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== "string" || !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end)
    || source.start < 0 || source.end <= source.start || source.end > value.length) invalid("invalid quote span");
  const quote = value.slice(source.start, source.end);
  canonicalJson(quote); // Also rejects a span splitting a surrogate pair.
  if (!quote.trim() || /[\u0000-\u001f\u007f]/u.test(quote)
    || Buffer.byteLength(quote) > ANSWER_PROGRAM_LIMITS.valueBytes) invalid("invalid field value");
  if (answerProgramTextSha256(quote) !== source.quoteSha256) invalid("quote digest mismatch");
  return quote;
}

export function recommendationBindingSha256(binding: RecommendationBinding): Sha256Hex {
  return canonicalSha256(binding);
}

function parseInput(value: unknown) {
  const detached = detachedInput(value);
  if (!isPlainRecord(detached)) invalid("input must be an object");
  const input = record(detached, ["snapshot", "requests", "bindings", ...(Object.hasOwn(detached, "limits") ? ["limits"] : [])], "input");
  const rawSnapshot = record(input.snapshot, ["spaceId", "head", "records"], "snapshot");
  record(rawSnapshot.head, ["generation", "graphRevisionSha256", "operationSha256", "recordsSha256", "sequence"], "snapshot head");
  const records = list(rawSnapshot.records, ANSWER_PROGRAM_LIMITS.records, "record").map((raw) =>
    parseKnowledgeGraphRecordV1(raw) ?? invalid("invalid graph record"));
  const snapshot = createOhProjectionSnapshotV1({ records, spaceId: rawSnapshot.spaceId as string,
    head: rawSnapshot.head as RecommendationProgramInput["snapshot"]["head"] });
  const byKey = new Map(records.map((item) => [item.key, item]));
  const requests: RecommendationRequest[] = list(input.requests, ANSWER_PROGRAM_LIMITS.requests, "request").map((raw) => {
    const item = record(raw, ["itemId", "mode"], "request");
    if (item.mode !== "optional" && item.mode !== "requested") invalid("invalid request mode");
    return { itemId: identifier(item.itemId), mode: item.mode };
  });
  if (requests.length === 0 || new Set(requests.map((item) => item.itemId)).size !== requests.length) invalid("empty or duplicate requests");
  const requested = new Set(requests.map((item) => item.itemId));
  const bindings = list(input.bindings, ANSWER_PROGRAM_LIMITS.bindings, "binding").map((raw) => {
    const item = record(raw, ["itemId", "field", "source", "admission"], "binding");
    const itemId = identifier(item.itemId);
    if (!requested.has(itemId) || (item.field !== "title" && item.field !== "narrator")) invalid("invalid binding target");
    const rawSource = record(item.source, ["recordKey", "recordSha256", "textPointer", "start", "end", "quoteSha256"], "source");
    const current = typeof rawSource.recordKey === "string" ? byKey.get(rawSource.recordKey) : undefined;
    if (!current || typeof rawSource.textPointer !== "string") invalid("source absent from snapshot");
    const source: RecommendationSource = { recordKey: current.key, recordSha256: hash(rawSource.recordSha256, "record"),
      textPointer: rawSource.textPointer, start: rawSource.start as number, end: rawSource.end as number,
      quoteSha256: hash(rawSource.quoteSha256, "quote") };
    const admission = record(item.admission, ["kind", "decisionSha256"], "admission");
    if (admission.kind !== "exact" && admission.kind !== "semantic") invalid("invalid admission kind");
    const binding: RecommendationBinding = { itemId, field: item.field, source,
      admission: { kind: admission.kind, decisionSha256: hash(admission.decisionSha256, "decision") } };
    return { binding, bindingSha256: recommendationBindingSha256(binding), value: resolveText(source, current) };
  });
  if (new Set(bindings.map((item) => item.bindingSha256)).size !== bindings.length) invalid("duplicate binding");
  const limits: Record<string, number> = {};
  const supported = ["queryRows", "maximumWorkUnits", "maximumDerivedTuples", "maximumRounds", "maximumProofDepth",
    "maximumProofNodes", "maximumTotalProofNodes", "maximumResultBytes"] as const;
  const supplied = input.limits ?? {};
  if (!isPlainRecord(supplied) || Object.keys(supplied).some((key) => !supported.includes(key as typeof supported[number]))) invalid("invalid limits");
  for (const key of supported) {
    const maximum = ANSWER_PROGRAM_LIMITS[key];
    const n = supplied[key] ?? maximum;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < (key === "maximumResultBytes" ? 65536 : 1) || n > maximum) invalid(`invalid ${key}`);
    limits[key] = n;
  }
  return { snapshot, requests, bindings, limits, inputSha256: canonicalSha256(detached) };
}

const v = ohProjectionVariableV1;
const c = ohProjectionConstantV1;
const literal = (relation: string, ...terms: Parameters<typeof createOhProjectionLiteralV1>[0]["terms"]) =>
  createOhProjectionLiteralV1({ relation, terms });
const rulePack = createOhProjectionRulePackV1({ rulePackId: "benchmark.recommendation", rulePackRevision: 1,
  rules: [createOhProjectionRuleV1({ ruleId: "recommendation.complete",
    body: [literal("answer.field", v("item"), c("title"), v("title"), v("title-binding")),
      literal("answer.field", v("item"), c("narrator"), v("narrator"), v("narrator-binding"))],
    head: literal("answer.complete", v("item"), v("title"), v("narrator"), v("title-binding"), v("narrator-binding")) })] });

function leaves(proof: OhProjectionProofV1): Extract<OhProjectionProofV1, { kind: "fact" }>[] {
  if (proof.kind === "truncated" || (proof.kind === "derived" && proof.premisesTruncated)) invalid("incomplete witness");
  return proof.kind === "fact" ? [proof] : proof.premises.flatMap(leaves);
}
function quoted(text: string): string {
  return JSON.stringify(text).replace(/[<>`*_[\]\\]/gu, (character) => `\\${character}`);
}
function render(items: readonly RecommendationItem[]): string {
  // Source labels are generated from the witness; no caller-authored citation text.
  const fieldText = (field: RecommendationField) => `${quoted(field.value)} ${field.citations.map((cite) =>
    `[${cite.recordKey}#${cite.recordSha256};path=${encodeURIComponent(cite.textPointer)}:${cite.start}-${cite.end};quote=${cite.quoteSha256}]`).join(" ")}`;
  const lines = items.flatMap((item) => {
    if (item.status === "omitted-incomplete") return [];
    if (item.status === "conflict") return [`- Item ${quoted(item.itemId)}: conflicting ${item.conflicts.join(" and ")} evidence; no recommendation.`];
    if (item.status === "unknown") return [`- Item ${quoted(item.itemId)}: ${item.fields.title ? `title ${fieldText(item.fields.title)}; ` : ""}${item.fields.narrator ? `narrator ${fieldText(item.fields.narrator)}; ` : ""}${item.missing.join(" and ")} unknown in the supplied evidence.`];
    return [`- Title: ${fieldText(item.fields.title!)}; narrator: ${fieldText(item.fields.narrator!)}.`];
  });
  return lines.join("\n") || "No complete optional recommendation is supported by the supplied evidence.";
}

export function runRecommendationProgram(value: unknown): RecommendationProgramResult {
  const input = parseInput(value);
  const facts = input.bindings.map(({ binding, bindingSha256, value }) => createOhProjectionFactV1({
    relation: "answer.field", tuple: [binding.itemId, binding.field, value, bindingSha256],
    sources: [{ key: binding.source.recordKey, recordSha256: binding.source.recordSha256, v: 1 }] }));
  const dataset = createOhProjectionDatasetV1({ extractorSha256: ANSWER_PROGRAM_IMPLEMENTATION_SHA256,
    factPackId: "benchmark.recommendation.spans", factPackRevision: 1, facts, snapshot: input.snapshot });
  const base = { contract: "oh.benchmark.recommendation-program.v1" as const, authority: "derived" as const,
    inputSha256: input.inputSha256, implementationSha256: ANSWER_PROGRAM_IMPLEMENTATION_SHA256,
    snapshotSha256: input.snapshot.snapshotSha256, datasetSha256: dataset.datasetSha256, rulePackSha256: rulePack.rulePackSha256 };
  // The same byte ceiling bounds each projection and the full returned envelope.
  // Drop retained proofs as well as items when the composite cannot fit.
  function bounded(result: RecommendationProgramResult): RecommendationProgramResult {
    if (Buffer.byteLength(canonicalJson(result)) <= input.limits.maximumResultBytes!) return result;
    return { ...base, status: "exhausted", projections: [], items: [],
      text: "Evaluation exhausted its composite result bound; no recommendation or absence conclusion is available.",
      reasons: ["composite-result-bytes"] };
  }
  const { queryRows, ...options } = input.limits;
  const queries = [createOhProjectionQueryV1({ queryId: "answer.fields", limit: queryRows!,
    find: ["item", "field", "value", "binding"], where: [literal("answer.field", v("item"), v("field"), v("value"), v("binding"))] }),
  createOhProjectionQueryV1({ queryId: "answer.recommendations", limit: queryRows!,
    find: ["item", "title", "narrator", "title-binding", "narrator-binding"],
    where: [literal("answer.complete", v("item"), v("title"), v("narrator"), v("title-binding"), v("narrator-binding"))] })];
  const projections: OhProjectionResultV1[] = [];
  try {
    for (const query of queries) {
      const result = evaluateOhProjectionV1({ dataset, options, query, rulePack, snapshot: input.snapshot });
      projections.push(result);
      if (result.stats.truncated || result.stats.proofsTruncated) return bounded({ ...base, status: "truncated", projections,
        items: [], text: "Evaluation incomplete; no recommendation or absence conclusion is available.",
        reasons: [...result.stats.truncationReasons, ...(result.stats.proofsTruncated ? ["proofs-truncated"] : [])] });
    }
  } catch (error) {
    if (!(error instanceof RangeError) || !/^Projection (?:exceeds|join exceeds|result exceeds)/u.test(error.message)) throw error;
    return bounded({ ...base, status: "exhausted", projections, items: [],
      text: "Evaluation exhausted its bound; no recommendation or absence conclusion is available.", reasons: [error.message] });
  }
  const byBinding = new Map(input.bindings.map((item) => [item.bindingSha256, item]));
  function citation(proof: OhProjectionProofV1): RecommendationCitation {
    if (proof.kind !== "fact" || proof.relation !== "answer.field") invalid("unexpected witness leaf");
    const admitted = byBinding.get(proof.tuple[3] as Sha256Hex);
    if (!admitted || canonicalJson(proof.tuple) !== canonicalJson([admitted.binding.itemId, admitted.binding.field,
      admitted.value, admitted.bindingSha256]) || proof.sources.length !== 1
      || proof.sources[0]!.key !== admitted.binding.source.recordKey
      || proof.sources[0]!.recordSha256 !== admitted.binding.source.recordSha256) invalid("witness does not reconstruct an admitted span");
    return { ...admitted.binding.source, bindingSha256: admitted.bindingSha256, admission: admitted.binding.admission };
  }
  const fields = new Map<string, Map<string, Map<string, RecommendationCitation[]>>>();
  for (const row of projections[0]!.rows) {
    for (const leaf of row.proofs.flatMap(leaves)) {
      const cite = citation(leaf);
      const [item, field, value] = leaf.tuple as [string, string, string];
      let itemFields = fields.get(item); if (!itemFields) fields.set(item, itemFields = new Map());
      let values = itemFields.get(field); if (!values) itemFields.set(field, values = new Map());
      const citations = values.get(value) ?? []; citations.push(cite); values.set(value, citations);
    }
  }
  const complete = new Map<string, OhProjectionResultV1["rows"][number][]>();
  for (const row of projections[1]!.rows) {
    row.proofs.flatMap(leaves).forEach(citation);
    const item = row.values[0] as string;
    complete.set(item, [...(complete.get(item) ?? []), row]);
  }
  const items: RecommendationItem[] = input.requests.map((request) => {
    const available = fields.get(request.itemId);
    const missing = (["title", "narrator"] as const).filter((field) => !available?.get(field)?.size);
    const conflicts = (["title", "narrator"] as const).filter((field) => (available?.get(field)?.size ?? 0) > 1);
    const one = (field: string): RecommendationField | null => {
      const values = available?.get(field);
      if (values?.size !== 1) return null;
      const [value, citations] = [...values][0]!;
      return { value, citations: citations.sort((a, b) => a.bindingSha256 < b.bindingSha256 ? -1 : a.bindingSha256 > b.bindingSha256 ? 1 : 0) };
    };
    const status = conflicts.length ? "conflict" : missing.length
      ? request.mode === "optional" ? "omitted-incomplete" : "unknown" : "recommended";
    if (status === "recommended" && !complete.has(request.itemId)) invalid("complete fields lack a relational recommendation witness");
    return { ...request, status, fields: { title: one("title"), narrator: one("narrator") }, missing, conflicts };
  });
  return bounded({ ...base, status: "complete", projections, items, text: render(items), reasons: [] });
}
