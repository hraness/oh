import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { FrameworkPilotJsonBytesV1, type FrameworkPilotJsonSpanV1 } from "./framework-pilot-json-bytes-v1";
import { parseFrameworkPilotSourceV1, type FrameworkPilotSourceV1 } from "./framework-pilot-source-v1";

export const FRAMEWORK_PILOT_LONGMEMEVAL_PIN_V1 = Object.freeze({
  dataset: "longmemeval-s", revision: "98d7416c24c778c2fee6e6f3006e7a073259d48f",
  bytes: 277_383_467, sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442", rows: 500,
  selectionBytes: 61_898, selectionSha256: "b82c45d61455f0b0e172bce6b12922c27e4a05d3fba6b4d11ffbb33bd139d233",
  selectedRows: 60,
});
export const FRAMEWORK_PILOT_LONGMEMEVAL_LIMITS_V1 = Object.freeze({
  maximumCases: 60, maximumRows: 500, maximumSourceOutputBytes: 128 * 1024 * 1024,
  maximumPrivateOutputBytes: 16 * 1024 * 1024,
});
const questionTypes = new Set(["knowledge-update", "multi-session", "single-session-assistant",
  "single-session-preference", "single-session-user", "temporal-reasoning"]);
type SafeCase = Readonly<{ caseId: string; source: FrameworkPilotSourceV1; sourceSha256: string;
  query: Readonly<{ queryId: "q0001"; text: string; questionDate: string }>; querySha256: string }>;
type PrivateCase = Readonly<{ caseId: string; originalQuestionId: string; questionType: string; sourceRowIndex: number;
  sourceSha256: string; querySha256: string;
  sessionAliases: readonly Readonly<{ originalSessionId: string; sessionId: string }>[];
  history: Readonly<{ sessions: number; turns: number; rawContentUtf8Bytes: number; answerBlindHistoryDigest: string }> }>;
export type FrameworkPilotLongMemEvalSourceV1 = Readonly<{
  protocol: "oh.framework-pilot-longmemeval-source.v1"; datasetSha256: string; datasetBytes: number; datasetRows: number;
  selectionQuestionIdsSha256: string; datasetProvenance: "not-established-by-projection";
  sourceCompleteness: "complete-for-selected-raw-history-fields";
  decodedValueCounts: Readonly<Record<string, number>>; cases: readonly SafeCase[];
}>;
export type FrameworkPilotLongMemEvalPrivateMapV1 = Readonly<{
  protocol: "oh.framework-pilot-longmemeval-private-map.v1"; datasetSha256: string;
  selectionQuestionIdsSha256: string; rows: readonly PrivateCase[];
}>;
export type FrameworkPilotLongMemEvalProjectionV1 = Readonly<{
  source: FrameworkPilotLongMemEvalSourceV1; privateMap: FrameworkPilotLongMemEvalPrivateMapV1;
}>;

function fail(reason: string): never { throw new TypeError(`Framework pilot LongMemEval: ${reason}.`); }
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(input) || Reflect.ownKeys(input).length !== keys.length
    || Reflect.ownKeys(input).some(key => typeof key !== "string" || !keys.includes(key))) fail("unexpected fields");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("data fields required");
    result[key] = descriptor.value;
  }
  return result;
}
function boundedText(input: unknown, maximum: number, empty = false): string {
  if (typeof input !== "string" || input.length > maximum || Buffer.byteLength(input) > maximum
    || /\p{Surrogate}/u.test(input) || !empty && input.length === 0) fail("invalid bounded text");
  return input;
}
function selection(input: unknown): readonly string[] {
  const value = exact(input, ["protocol", "questionIds"]);
  if (value.protocol !== "oh.framework-pilot-longmemeval-selection.v1" || !Array.isArray(value.questionIds)
    || value.questionIds.length < 1 || value.questionIds.length > FRAMEWORK_PILOT_LONGMEMEVAL_LIMITS_V1.maximumCases
    || Reflect.ownKeys(value.questionIds).length !== value.questionIds.length + 1) fail("invalid bounded selection");
  const ids: string[] = [];
  for (let index = 0; index < value.questionIds.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value.questionIds, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("dense selection data required");
    ids.push(boundedText(descriptor.value, 512));
  }
  if (new Set(ids).size !== ids.length) fail("duplicate selected question ID");
  return Object.freeze(ids);
}

/** Projects only explicit raw source/query fields. It does not load Corpus or
 * decode answer, answer_session_ids, has_answer, or other excluded value strings.
 * Whole-input lexical validation precedes selected-value decoding. The two
 * returned envelopes are separate artifacts: never serialize the wrapper as a
 * model-visible payload. Official identity requires the fixed-pin file boundary. */
export function projectFrameworkPilotLongMemEvalV1(bytes: Uint8Array, selectionInput: unknown): FrameworkPilotLongMemEvalProjectionV1 {
  const selected = selection(selectionInput), selectedSet = new Set(selected), scanner = new FrameworkPilotJsonBytesV1(bytes);
  const rowSpans = scanner.arrayItems(scanner.root, FRAMEWORK_PILOT_LONGMEMEVAL_LIMITS_V1.maximumRows);
  if (rowSpans.length === 0) fail("source requires rows");
  const counts: Record<string, number> = Object.create(null);
  function field(fields: ReadonlyMap<string, FrameworkPilotJsonSpanV1>, key: string): FrameworkPilotJsonSpanV1 {
    const span = fields.get(key);
    if (span === undefined) fail("required raw field missing");
    return span;
  }
  function text(fields: ReadonlyMap<string, FrameworkPilotJsonSpanV1>, key: string, maximum: number, category = key, empty = false): string {
    const value = boundedText(scanner.text(field(fields, key), maximum), maximum, empty);
    counts[category] = (counts[category] ?? 0) + 1; return value;
  }
  function scalar(span: FrameworkPilotJsonSpanV1, category: string, maximum: number, empty = false): string {
    const value = boundedText(scanner.text(span, maximum), maximum, empty);
    counts[category] = (counts[category] ?? 0) + 1; return value;
  }
  const seen = new Set<string>();
  const chosen = new Map<string, { fields: ReadonlyMap<string, FrameworkPilotJsonSpanV1>; type: string; rowIndex: number }>();
  for (const [rowIndex, span] of rowSpans.entries()) {
    const fields = scanner.objectFields(span), id = text(fields, "question_id", 512), type = text(fields, "question_type", 64);
    if (seen.has(id) || !questionTypes.has(type)) fail("duplicate row ID or unknown question type");
    seen.add(id);
    if (selectedSet.has(id)) chosen.set(id, { fields, type, rowIndex });
  }
  if (chosen.size !== selected.length) fail("selected source membership is incomplete");
  const cases: SafeCase[] = [], joins: PrivateCase[] = [];
  let outputBytes = 65_536, privateBytes = 65_536;
  for (const [caseIndex, originalQuestionId] of selected.entries()) {
    const { fields, type, rowIndex } = chosen.get(originalQuestionId)!;
    const dates = scanner.arrayItems(field(fields, "haystack_dates"), 1_000)
      .map(span => scalar(span, "haystack_dates", 256, true));
    const originalIds = scanner.arrayItems(field(fields, "haystack_session_ids"), 1_000)
      .map(span => scalar(span, "haystack_session_ids", 512));
    const sessions = scanner.arrayItems(field(fields, "haystack_sessions"), 1_000);
    if (sessions.length === 0 || sessions.length !== dates.length || sessions.length !== originalIds.length) fail("misaligned history occurrences");
    const aliases = new Map<string, string>();
    let turnCount = 0, rawContentUtf8Bytes = 0, scalarBytes = 0;
    const sourceSessions: FrameworkPilotSourceV1["sessions"][number][] = [];
    for (const [sessionIndex, session] of sessions.entries()) {
      const originalId = originalIds[sessionIndex]!, date = dates[sessionIndex]!;
      if (!aliases.has(originalId)) aliases.set(originalId, `s${String(aliases.size + 1).padStart(4, "0")}`);
      const turns: { role: string; text: string }[] = [];
      scalarBytes += Buffer.byteLength(date);
      for (const turnSpan of scanner.arrayItems(session, 8_192)) {
        if (++turnCount > 8_192) fail("total source turn bound exceeded");
        const turn = scanner.objectFields(turnSpan), role = text(turn, "role", 512, "haystack_sessions.role");
        const content = text(turn, "content", 524_288, "haystack_sessions.content", true);
        rawContentUtf8Bytes += Buffer.byteLength(content); scalarBytes += Buffer.byteLength(role) + Buffer.byteLength(content);
        if (scalarBytes > 32 * 1024 * 1024) fail("source scalar byte bound exceeded");
        turns.push({ role, text: content });
      }
      sourceSessions.push({ sessionId: aliases.get(originalId)!, sessionIndex, date, turns });
    }
    const source = parseFrameworkPilotSourceV1({ protocol: "oh.framework-pilot-source.v1", sessions: sourceSessions });
    const query = { queryId: "q0001" as const, text: text(fields, "question", 16_384),
      questionDate: text(fields, "question_date", 256, "question_date", true) };
    const sourceSha256 = canonicalSha256(source), querySha256 = canonicalSha256(query);
    const fingerprint = createHash("sha256").update("oh.capacity.answer-blind-history.v1\0");
    for (const [index, session] of source.sessions.entries()) {
      const rendered = canonicalJson({ sessionId: originalIds[index]!, date: session.date,
        turns: session.turns.map(turn => ({ role: turn.role, content: turn.text })) });
      const encoded = Buffer.from(rendered), length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(encoded.length));
      fingerprint.update(length); fingerprint.update(encoded);
    }
    const caseId = `c${String(caseIndex + 1).padStart(4, "0")}`;
    const safeCase: SafeCase = { caseId, source, sourceSha256, query, querySha256 };
    const privateCase: PrivateCase = { caseId, originalQuestionId, questionType: type, sourceRowIndex: rowIndex,
      sourceSha256, querySha256, sessionAliases: [...aliases].map(([originalSessionId, sessionId]) => ({ originalSessionId, sessionId })),
      history: { sessions: sessions.length, turns: turnCount, rawContentUtf8Bytes, answerBlindHistoryDigest: fingerprint.digest("hex") } };
    outputBytes += Buffer.byteLength(canonicalJson(safeCase)) + 1; privateBytes += Buffer.byteLength(canonicalJson(privateCase)) + 1;
    if (outputBytes > FRAMEWORK_PILOT_LONGMEMEVAL_LIMITS_V1.maximumSourceOutputBytes
      || privateBytes > FRAMEWORK_PILOT_LONGMEMEVAL_LIMITS_V1.maximumPrivateOutputBytes) fail("projection output byte bound exceeded");
    cases.push(safeCase); joins.push(privateCase);
  }
  const selectionQuestionIdsSha256 = canonicalSha256(selected);
  return immutable({ source: { protocol: "oh.framework-pilot-longmemeval-source.v1", datasetSha256: scanner.sha256,
    datasetBytes: scanner.bytes, datasetRows: rowSpans.length, selectionQuestionIdsSha256,
    datasetProvenance: "not-established-by-projection", sourceCompleteness: "complete-for-selected-raw-history-fields",
    decodedValueCounts: counts, cases }, privateMap: { protocol: "oh.framework-pilot-longmemeval-private-map.v1",
      datasetSha256: scanner.sha256, selectionQuestionIdsSha256, rows: joins } });
}

function localPath(input: unknown): string {
  const path = boundedText(input, 4_096);
  if (!isAbsolute(path) || resolve(path) !== path || path.includes("\0")) fail("canonical absolute local path required");
  return path;
}
type FileIdentity = Readonly<{ dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }>;
function identity(value: FileIdentity): string { return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":"); }
async function unchanged(path: string, expected: string): Promise<void> {
  const current = await lstat(path, { bigint: true });
  if (!current.isFile() || current.isSymbolicLink() || identity(current) !== expected || await realpath(path) !== path) fail("pinned file identity changed");
}
async function readPinned(path: string, bytes: number, sha256: string): Promise<{ raw: Buffer; identity: string }> {
  if (await realpath(path) !== path) fail("pinned file symlink or path mismatch");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size !== BigInt(bytes)) fail("pinned file type or size mismatch");
    const raw = Buffer.allocUnsafe(bytes + 1);
    let count = 0;
    while (count < raw.length) {
      const read = (await file.read(raw, count, Math.min(1_048_576, raw.length - count), count)).bytesRead;
      if (read === 0) break;
      count += read;
    }
    if (count !== bytes || sha256Hex(raw.subarray(0, count)) !== sha256) fail("pinned file digest or byte count mismatch");
    const expected = identity(before);
    if (identity(await file.stat({ bigint: true })) !== expected) fail("pinned file changed during read");
    await unchanged(path, expected);
    return { raw: raw.subarray(0, count), identity: expected };
  } finally { await file.close(); }
}

type ArtifactPin = Readonly<{ name: string; bytes: number; sha256: string }>;
export type FrameworkPilotLongMemEvalAdmissionV1 = Readonly<{
  protocol: "oh.framework-pilot-longmemeval-admission.v1";
  datasetRevision: string; datasetSha256: string; datasetBytes: number; datasetRows: number;
  selectionManifestSha256: string; selectionManifestBytes: number; historiesReconciled: number;
  sourceFilesUnchanged: true; goldAndLabelValuesDecoded: false;
  artifacts: readonly ArtifactPin[];
}>;

/** Existing local bytes only. Pins are immutable and cannot be supplied by callers.
 * The exact 60-row manifest order is retained; no selection policy is recomputed.
 * Output is create-only in a new private directory: model-safe source projections
 * and original-ID evaluator joins are physically separate. No archive/local path
 * enters those payloads or the receipt. Failures preserve partial output; never
 * overwrite or recursively delete an existing caller directory on retry. */
export async function writePinnedFrameworkPilotLongMemEvalV1(input: Readonly<{
  datasetPath: string; selectionManifestPath: string; outputDirectory: string;
}>): Promise<FrameworkPilotLongMemEvalAdmissionV1> {
  const values = exact(input, ["datasetPath", "selectionManifestPath", "outputDirectory"]);
  const datasetPath = localPath(values.datasetPath), selectionManifestPath = localPath(values.selectionManifestPath), outputDirectory = localPath(values.outputDirectory);
  const pin = FRAMEWORK_PILOT_LONGMEMEVAL_PIN_V1;
  if (await realpath(dirname(outputDirectory)) !== dirname(outputDirectory)) fail("output parent must be canonical and existing");
  try { await lstat(outputDirectory); fail("output directory already exists"); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  // Authenticate the small selection before allocating the much larger source.
  const manifestFile = await readPinned(selectionManifestPath, pin.selectionBytes, pin.selectionSha256);
  const manifest: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.raw));
  if (!isPlainRecord(manifest) || manifest.protocol !== "oh.cross-framework-pilot-selection-preview.v1"
    || manifest.datasetSha256 !== pin.sha256 || !Array.isArray(manifest.rows) || manifest.rows.length !== pin.selectedRows) fail("fixed selection manifest schema mismatch");
  const selected = manifest.rows.map(row => {
    if (!isPlainRecord(row)) fail("invalid fixed selection row");
    return boundedText(row.questionId, 512);
  });
  const datasetFile = await readPinned(datasetPath, pin.bytes, pin.sha256);
  const projected = projectFrameworkPilotLongMemEvalV1(datasetFile.raw,
    { protocol: "oh.framework-pilot-longmemeval-selection.v1", questionIds: selected });
  if (projected.source.datasetRows !== pin.rows || projected.source.datasetSha256 !== pin.sha256) fail("fixed source row or digest mismatch");
  for (const [index, row] of projected.privateMap.rows.entries()) {
    const expected = manifest.rows[index];
    if (!isPlainRecord(expected) || !isPlainRecord(expected.history) || row.originalQuestionId !== expected.questionId
      || row.questionType !== expected.questionType || row.history.sessions !== expected.history.sessions
      || row.history.turns !== expected.history.turns || row.history.rawContentUtf8Bytes !== expected.history.rawContentUtf8Bytes
      || row.history.answerBlindHistoryDigest !== expected.history.answerBlindHistoryDigest) fail("fixed preflight history reconciliation failed");
  }
  await unchanged(datasetPath, datasetFile.identity); await unchanged(selectionManifestPath, manifestFile.identity);
  const artifacts = [
    { name: "source/projection.json", bytes: Buffer.from(canonicalJson(projected.source) + "\n") },
    { name: "private/evaluator-map.json", bytes: Buffer.from(canonicalJson(projected.privateMap) + "\n") },
  ];
  const pins: ArtifactPin[] = artifacts.map(artifact => ({ name: artifact.name, bytes: artifact.bytes.length, sha256: sha256Hex(artifact.bytes) }));
  const receipt: FrameworkPilotLongMemEvalAdmissionV1 = immutable({ protocol: "oh.framework-pilot-longmemeval-admission.v1",
    datasetRevision: pin.revision, datasetSha256: pin.sha256, datasetBytes: pin.bytes, datasetRows: pin.rows,
    selectionManifestSha256: pin.selectionSha256, selectionManifestBytes: pin.selectionBytes, historiesReconciled: pin.selectedRows,
    sourceFilesUnchanged: true, goldAndLabelValuesDecoded: false, artifacts: pins });
  await mkdir(outputDirectory, { mode: 0o700 });
  async function write(name: string, bytes: Buffer): Promise<void> {
    const file = await open(join(outputDirectory, name), "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  }
  await write("intent.json", Buffer.from(canonicalJson({ protocol: "oh.framework-pilot-longmemeval-output-intent.v1", artifacts: pins }) + "\n"));
  await mkdir(join(outputDirectory, "source"), { mode: 0o700 }); await mkdir(join(outputDirectory, "private"), { mode: 0o700 });
  for (const artifact of artifacts) await write(artifact.name, artifact.bytes);
  await unchanged(datasetPath, datasetFile.identity); await unchanged(selectionManifestPath, manifestFile.identity);
  await write("receipt.json", Buffer.from(canonicalJson(receipt) + "\n"));
  return receipt;
}
