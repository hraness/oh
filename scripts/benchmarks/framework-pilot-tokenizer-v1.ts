import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { canonicalJson, isPlainRecord, utf8ByteLength } from "../../src/canonical";
import { packFrameworkPilotContextV1, parseFrameworkPilotContextInputV1 } from "./framework-pilot-context-v1";

export const FRAMEWORK_PILOT_TOKENIZER_V1 = Object.freeze({
  identity: "oh.framework-pilot-o200k-base.v1:4f2d970b650d245e4d6430d05500233bc86d64d7cb75461e80435b2703310e97",
  artifactsSha256: "4f2d970b650d245e4d6430d05500233bc86d64d7cb75461e80435b2703310e97",
  assetSha256: "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d",
  maximumTexts: 21,
  maximumTextBytes: 262_144,
  maximumRequestBytes: 12 * 1024 * 1024,
  maximumResponseBytes: 32_768,
  processTimeoutMs: 30_000,
});
export type FrameworkPilotTokenizerConfigurationV1 = Readonly<{ python: string; artifactsDirectory: string }>;
export type FrameworkPilotTokenRowV1 = Readonly<{ textSha256: string; textBytes: number; tokens: number }>;
export type FrameworkPilotTokenizerProvenanceV1 = Readonly<{
  artifactsSha256: string; workerSha256: string; wheelSha256: string; extensionSha256: string; assetSha256: string;
  pythonExecutable: string; pythonExecutableSha256: string; pythonVersion: string; pythonImplementation: "cpython";
  pythonCacheTag: "cpython-314"; platform: "darwin" | "linux"; architecture: "arm64" | "x86_64";
}>;
export type FrameworkPilotTokenBatchV1 = Readonly<{
  protocol: "oh.framework-pilot-token-batch.v1"; scope: "context-string-only"; specialTokens: "ordinary-text";
  provenance: FrameworkPilotTokenizerProvenanceV1; rows: readonly FrameworkPilotTokenRowV1[];
}>;

function fail(reason: string): never { throw new TypeError(`Framework pilot tokenizer: ${reason}.`); }
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length !== keys.length) fail("unexpected object fields");
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("invalid object property");
    out[key] = descriptor.value;
  }
  return out;
}
function safeInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= maximum;
}
function texts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) fail("invalid texts");
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!safeInteger(length, FRAMEWORK_PILOT_TOKENIZER_V1.maximumTexts) || length < 1
    || Reflect.ownKeys(value).length !== length + 1) fail("invalid text array");
  const result: string[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("invalid text entry");
    const text: unknown = descriptor.value;
    if (typeof text !== "string" || text.length > FRAMEWORK_PILOT_TOKENIZER_V1.maximumTextBytes
      || /\p{Surrogate}/u.test(text) || utf8ByteLength(text) > FRAMEWORK_PILOT_TOKENIZER_V1.maximumTextBytes) fail("invalid text bytes");
    result.push(text);
  }
  return Object.freeze(result);
}

/** An answer-blind, exact-string transport envelope; it grants no execution or model authority. */
export function parseFrameworkPilotTokenBatchInputV1(input: unknown) {
  const value = record(input, ["protocol", "texts"]);
  if (value.protocol !== "oh.framework-pilot-token-batch-input.v1") fail("invalid input protocol");
  const result = Object.freeze({ protocol: "oh.framework-pilot-token-batch-input.v1" as const, texts: texts(value.texts) });
  if (utf8ByteLength(canonicalJson(result)) > FRAMEWORK_PILOT_TOKENIZER_V1.maximumRequestBytes) fail("request byte bound");
  return result;
}

const directory = join(import.meta.dir, "framework-pilot-tokenizer-v1");
const wheelPins = Object.freeze({
  "darwin:arm64": Object.freeze({ wheel: "f2af4a336ea56d6c14f27741a0e1d8294a35dd0b038bcf990d232ebb54eb994b",
    extension: "447f4012e3cb1ef5d0ee8bb2e19e0966caf6b68f0747d94a31da67f860f23a30" }),
  "linux:x86_64": Object.freeze({ wheel: "e3442bbb2f0c588cec876061e37ae67b455b9df9978b003c8fe30e45f2ef5b42",
    extension: "5f84809264618d40909475fff75b514569f9b16ea79038e5849d759e73ab7fa1" }),
});

function response(raw: Uint8Array, expectedTexts: readonly string[], python: string, pythonSha: string, workerSha: string): FrameworkPilotTokenBatchV1 {
  if (raw.byteLength > FRAMEWORK_PILOT_TOKENIZER_V1.maximumResponseBytes) fail("response byte bound");
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { fail("invalid process response"); }
  const value = record(decoded, ["protocol", "scope", "specialTokens", "provenance", "rows"]);
  if (value.protocol !== "oh.framework-pilot-token-batch.v1" || value.scope !== "context-string-only"
    || value.specialTokens !== "ordinary-text") fail("invalid response identity");
  const p = record(value.provenance, ["artifactsSha256", "workerSha256", "wheelSha256", "extensionSha256", "assetSha256",
    "pythonExecutable", "pythonExecutableSha256", "pythonVersion", "pythonImplementation", "pythonCacheTag", "platform", "architecture"]);
  const platformKey = `${String(p.platform)}:${String(p.architecture)}`;
  const pin = wheelPins[platformKey as keyof typeof wheelPins];
  if (!pin || p.artifactsSha256 !== FRAMEWORK_PILOT_TOKENIZER_V1.artifactsSha256
    || p.assetSha256 !== FRAMEWORK_PILOT_TOKENIZER_V1.assetSha256 || p.workerSha256 !== workerSha
    || p.wheelSha256 !== pin.wheel || p.extensionSha256 !== pin.extension || p.pythonExecutable !== python
    || p.pythonExecutableSha256 !== pythonSha || p.pythonImplementation !== "cpython" || p.pythonCacheTag !== "cpython-314"
    || typeof p.pythonVersion !== "string" || !/^3\.14\.[0-9]+$/.test(p.pythonVersion)) fail("tokenizer provenance mismatch");
  if (!Array.isArray(value.rows) || value.rows.length !== expectedTexts.length) fail("response row count mismatch");
  const rows = expectedTexts.map((text, index) => {
    const row = record((value.rows as unknown[])[index], ["textSha256", "textBytes", "tokens"]), bytes = utf8ByteLength(text);
    if (row.textSha256 !== sha(text) || row.textBytes !== bytes || !safeInteger(row.tokens, bytes)
      || (bytes === 0 ? row.tokens !== 0 : row.tokens === 0)) fail("response text or count mismatch");
    return Object.freeze({ textSha256: row.textSha256 as string, textBytes: bytes, tokens: row.tokens });
  });
  return Object.freeze({ protocol: "oh.framework-pilot-token-batch.v1", scope: "context-string-only",
    specialTokens: "ordinary-text", provenance: Object.freeze(p) as FrameworkPilotTokenizerProvenanceV1, rows: Object.freeze(rows) });
}

/** Executes one isolated, bounded local process. No defaults, downloads, API keys or fake counters. */
export function countFrameworkPilotTokenBatchV1(input: unknown, suppliedConfiguration: FrameworkPilotTokenizerConfigurationV1): FrameworkPilotTokenBatchV1 {
  const parsed = parseFrameworkPilotTokenBatchInputV1(input);
  const configuration = record(suppliedConfiguration, ["python", "artifactsDirectory"]);
  for (const path of Object.values(configuration)) {
    if (typeof path !== "string" || !isAbsolute(path) || /[\u0000-\u001f\u007f]/.test(path)
      || utf8ByteLength(path) > 4096) fail("requires bounded absolute local paths");
  }
  const python = realpathSync(configuration.python as string), info = lstatSync(python);
  if (!info.isFile() || info.size < 1 || info.size > 64 * 1024 * 1024) fail("invalid interpreter file");
  const pythonSha = sha(readFileSync(python));
  const worker = join(directory, "worker.py"), workerSha = sha(readFileSync(worker));
  if (sha(readFileSync(join(directory, "artifacts.json"))) !== FRAMEWORK_PILOT_TOKENIZER_V1.artifactsSha256) fail("artifact manifest digest mismatch");
  const scratch = mkdtempSync(join(tmpdir(), "oh-framework-tokenizer-"));
  try {
    const result = spawnSync(python, ["-I", "-S", "-B", worker, realpathSync(configuration.artifactsDirectory as string), scratch], {
      input: canonicalJson(parsed), cwd: scratch, env: { LC_ALL: "C" },
      timeout: FRAMEWORK_PILOT_TOKENIZER_V1.processTimeoutMs, maxBuffer: FRAMEWORK_PILOT_TOKENIZER_V1.maximumResponseBytes,
      killSignal: "SIGKILL",
    });
    if (result.error || result.signal !== null || result.status !== 0 || result.stderr.byteLength !== 0) fail("isolated counter failed");
    return response(result.stdout, parsed.texts, python, pythonSha, workerSha);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Packs complete source blocks with exact o200k_base counts; full request usage is separate. */
export function packFrameworkPilotContextWithTiktokenV1(input: unknown, configuration: FrameworkPilotTokenizerConfigurationV1) {
  const parsed = parseFrameworkPilotContextInputV1(input), prefixes: string[] = [];
  // Walk the existing packer's complete unique prefixes, including empty. This temporary
  // zero-count traversal is never returned or used as a token estimate or qualification.
  packFrameworkPilotContextV1(parsed, { identity: FRAMEWORK_PILOT_TOKENIZER_V1.identity,
    countTokens: context => { prefixes.push(context); return 0; } });
  const batch = countFrameworkPilotTokenBatchV1({ protocol: "oh.framework-pilot-token-batch-input.v1", texts: prefixes }, configuration);
  const counts = new Map(prefixes.map((text, index) => [text, batch.rows[index]!.tokens]));
  const context = packFrameworkPilotContextV1(parsed, { identity: FRAMEWORK_PILOT_TOKENIZER_V1.identity,
    countTokens: text => { const tokens = counts.get(text); if (tokens === undefined) fail("unbound prefix"); return tokens; } });
  return Object.freeze({ protocol: "oh.framework-pilot-tokenized-context.v1" as const, context, tokenization: batch });
}
