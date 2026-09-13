import { canonicalJson, type JsonValue } from "./document-domain";
import { parseSha256Hex, sha256Text, type Sha256Hex } from "./integrity-domain";
import { freezeKnowledgeDeclaration, knowledgeDeclarativeJson } from "./knowledge-declarative-json";
import { spongeKnowledgeReferenceCatalog } from "./knowledge-reference-catalog";
import { parseKnowledgeValueV1, verifyKnowledgeValueV1, type KnowledgeOntologyResult, type KnowledgeValueV1 } from "./knowledge-ontology-v1";
import { hasExactDataKeys, isPlainRecord } from "./unknown";

export type KnowledgePreservedValuePayloadV1 =
  | Readonly<{ captureSha256: Sha256Hex; kind: "missing-value"; occurrence: string; state: "somevalue" | "novalue"; v: 1 }>
  | Readonly<{ kind: "language-text"; language: string; text: string; v: 1 }>
  | Readonly<{ after: number; before: number; calendarmodel: string; kind: "wikibase-time"; precision: number; serialization: "wikibase-json-v1"; time: string; timezone: number; v: 1 }>
  | Readonly<{ altitude: string | null; globe: string; kind: "globe-coordinate"; latitude: string; longitude: string; precision: string | null; serialization: "wikibase-json-v1"; v: 1 }>;
export type KnowledgePreservedExtensionV1 = Extract<KnowledgeValueV1, { kind: "extension" }>;
const mediaType = "application/vnd.sponge.preserved-value+json";
const canonicalizerIdentity = "sponge.knowledge.preserved-value.canonical-json.v1";
function failure<T>(field: string): KnowledgeOntologyResult<T> { return { ok: false, error: { code: "invalid-input", field } }; }
function success<T>(value: T): KnowledgeOntologyResult<T> { return { ok: true, value: freezeKnowledgeDeclaration(value) }; }

const grandfathered = new Set([
  "art-lojban", "cel-gaulish", "en-gb-oed", "i-ami", "i-bnn", "i-default", "i-enochian", "i-hak", "i-klingon", "i-lux", "i-mingo", "i-navajo", "i-pwn", "i-tao", "i-tay", "i-tsu", "no-bok", "no-nyn", "sgn-be-fr", "sgn-be-nl", "sgn-ch-de", "zh-guoyu", "zh-hakka", "zh-min", "zh-min-nan", "zh-xiang",
]);
/** BCP 47 syntactic profile; spelling is retained, and registry membership or preferred aliases are not inferred. */
export function isKnowledgeLanguageTagV1(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || !/^[A-Za-z0-9-]+$/u.test(value)) return false;
  const lower = value.toLowerCase();
  if (grandfathered.has(lower)) return true;
  const parts = lower.split("-");
  if (parts[0] === "x") return parts.length > 1 && parts.slice(1).every((part) => /^[a-z0-9]{1,8}$/u.test(part));
  const language = parts[0] ?? "";
  if (!/^[a-z]{2,8}$/u.test(language)) return false;
  let index = 1;
  if (language.length <= 3) {
    for (let count = 0; count < 3 && /^[a-z]{3}$/u.test(parts[index] ?? ""); count++) index++;
  }
  if (/^[a-z]{4}$/u.test(parts[index] ?? "")) index++;
  if (/^(?:[a-z]{2}|[0-9]{3})$/u.test(parts[index] ?? "")) index++;
  const variants = new Set<string>();
  while (/^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/u.test(parts[index] ?? "")) {
    const variant = parts[index] as string;
    if (variants.has(variant)) return false;
    variants.add(variant);
    index++;
  }
  const extensions = new Set<string>();
  while (/^[0-9a-wy-z]$/u.test(parts[index] ?? "")) {
    const singleton = parts[index] as string;
    if (extensions.has(singleton)) return false;
    extensions.add(singleton);
    index++;
    const first = index;
    while (/^[a-z0-9]{2,8}$/u.test(parts[index] ?? "")) index++;
    if (first === index) return false;
  }
  if (parts[index] === "x") {
    index++;
    const first = index;
    while (/^[a-z0-9]{1,8}$/u.test(parts[index] ?? "")) index++;
    if (first === index) return false;
  }
  return index === parts.length;
}
function uri(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2_048 && /^https?:\/\/[^\s?#]+(?:[?#][^\s]*)?$/u.test(value);
}
function natural(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function numeric(value: unknown): readonly [bigint, bigint] | null {
  if (typeof value !== "string" || value.length > 512 || !/^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]{1,4})?$/u.test(value)) return null;
  const [mantissa = "", exponentPart = "0"] = value.toLowerCase().split("e");
  const exponent = Number(exponentPart);
  if (Math.abs(exponent) > 1_024) return null;
  const [integer = "0", fraction = ""] = mantissa.split(".");
  const digits = BigInt(`${integer}${fraction}`);
  const scale = fraction.length - exponent;
  return scale >= 0 ? [digits, 10n ** BigInt(scale)] : [digits * 10n ** BigInt(-scale), 1n];
}
function within(value: unknown, minimum: number, maximum: number): value is string {
  const parsed = numeric(value);
  return parsed !== null && parsed[0] >= BigInt(minimum) * parsed[1] && parsed[0] <= BigInt(maximum) * parsed[1];
}
/** Source-preservation payloads deliberately do not normalize BCE numbering, calendars, angle units, or language aliases. */
export function parseKnowledgePreservedValuePayloadV1(value: unknown): KnowledgeOntologyResult<KnowledgePreservedValuePayloadV1> {
  const input = knowledgeDeclarativeJson(value, 60_000);
  if (!isPlainRecord(input) || input["v"] !== 1 || typeof input["kind"] !== "string") return failure("preserved-value");
  switch (input["kind"]) {
    case "missing-value": {
      if (!hasExactDataKeys(input, ["captureSha256", "kind", "occurrence", "state", "v"])) return failure("missing-value");
      const captureSha256 = parseSha256Hex(input["captureSha256"]);
      if (captureSha256 === null || typeof input["occurrence"] !== "string"
        || input["occurrence"].length === 0 || input["occurrence"].length > 4_096
        || (input["state"] !== "somevalue" && input["state"] !== "novalue")) return failure("missing-value");
      return success({ captureSha256, kind: "missing-value", occurrence: input["occurrence"], state: input["state"], v: 1 });
    }
    case "language-text":
      return hasExactDataKeys(input, ["kind", "language", "text", "v"])
        && isKnowledgeLanguageTagV1(input["language"]) && typeof input["text"] === "string" && input["text"].length > 0
        ? success({ kind: "language-text", language: input["language"], text: input["text"], v: 1 }) : failure("language-text");
    case "wikibase-time": {
      if (!hasExactDataKeys(input, ["after", "before", "calendarmodel", "kind", "precision", "serialization", "time", "timezone", "v"])
        || input["serialization"] !== "wikibase-json-v1" || !uri(input["calendarmodel"])
        || !natural(input["before"]) || !natural(input["after"]) || !natural(input["precision"]) || input["precision"] > 14
        || !Number.isSafeInteger(input["timezone"]) || Math.abs(Number(input["timezone"])) > 1_440
        || typeof input["time"] !== "string"
        || !/^[+-][0-9]{4,16}-(?:0[0-9]|1[0-2])-(?:[0-2][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u.test(input["time"])) return failure("wikibase-time");
      const match = /-([0-9]{2})-([0-9]{2})T/u.exec(input["time"]);
      if (match === null || (input["precision"] >= 10 && match[1] === "00") || (input["precision"] >= 11 && match[2] === "00")) return failure("wikibase-time.precision");
      return success({ after: input["after"], before: input["before"], calendarmodel: input["calendarmodel"], kind: "wikibase-time", precision: input["precision"], serialization: "wikibase-json-v1", time: input["time"], timezone: Number(input["timezone"]), v: 1 });
    }
    case "globe-coordinate": {
      if (!hasExactDataKeys(input, ["altitude", "globe", "kind", "latitude", "longitude", "precision", "serialization", "v"])
        || input["serialization"] !== "wikibase-json-v1" || !uri(input["globe"])
        || !within(input["latitude"], -90, 90) || !within(input["longitude"], -180, 180)
        || !(input["altitude"] === null || (typeof input["altitude"] === "string" && numeric(input["altitude"]) !== null))
        || !(input["precision"] === null || within(input["precision"], 0, 360))) return failure("globe-coordinate");
      return success({ altitude: input["altitude"], globe: input["globe"], kind: "globe-coordinate", latitude: input["latitude"], longitude: input["longitude"], precision: input["precision"], serialization: "wikibase-json-v1", v: 1 });
    }
    default: return failure("preserved-value.kind");
  }
}
export async function createKnowledgePreservedValueV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgePreservedExtensionV1>> {
  const parsed = parseKnowledgePreservedValuePayloadV1(value);
  if (!parsed.ok) return parsed;
  const catalog = await spongeKnowledgeReferenceCatalog();
  const schema = catalog.referencePack.schemas.find((item) => item.identity.code === parsed.value.kind);
  if (schema === undefined) return failure("preserved-value.schema");
  const canonicalValue = canonicalJson(parsed.value as unknown as JsonValue);
  return success({ canonicalizerSha256: await sha256Text(canonicalizerIdentity), canonicalValue, kind: "extension", mediaType, schema: schema.ref, v: 1, valueSha256: await sha256Text(canonicalValue) });
}
export async function parseKnowledgePreservedValueV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgePreservedValuePayloadV1>> {
  const input = knowledgeDeclarativeJson(value, 65_536);
  const extension = parseKnowledgeValueV1(input);
  if (!extension.ok || extension.value.kind !== "extension" || !(await verifyKnowledgeValueV1(extension.value)).ok) return failure("preserved-value.extension");
  let payload: unknown;
  try { payload = JSON.parse(extension.value.canonicalValue) as unknown; } catch { return failure("preserved-value.canonicalValue"); }
  const parsed = parseKnowledgePreservedValuePayloadV1(payload);
  if (!parsed.ok) return parsed;
  const expected = await createKnowledgePreservedValueV1(parsed.value);
  if (!expected.ok || canonicalJson(extension.value as unknown as JsonValue) !== canonicalJson(expected.value as unknown as JsonValue)) return failure("preserved-value.codec");
  return parsed;
}
