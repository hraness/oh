import { canonicalJson, type JsonValue } from "./document-domain";
import { utf8ByteLength } from "./integrity-domain";
import { hasExactDataKeys, isPlainRecord } from "./unknown";

/** Copy bounded JSON data without invoking accessors or user-defined serialization. */
export function knowledgeDeclarativeJson(value: unknown, maximumBytes = 2_097_152,
  options: Readonly<{ preserveStrings?: boolean; maxDepth?: number; maxNodes?: number;
    /** Raw JSON evidence may contain these keys. Copies always have a null prototype. Default remains strict. */
    preserveObjectKeys?: boolean; maxArrayItems?: number }> = {},
): JsonValue | undefined {
  let nodes = 0;
  let bytes = 0;
  function reserve(count: number): boolean { bytes += count; return bytes <= maximumBytes; }
  function copy(item: unknown, depth: number): JsonValue | undefined {
    if (++nodes > (options.maxNodes ?? 100_000) || depth > (options.maxDepth ?? 24)) return undefined;
    if (item === null || typeof item === "boolean") return reserve(item === null ? 4 : item ? 4 : 5) ? item : undefined;
    if (typeof item === "string") {
      return item.length <= maximumBytes && reserve(utf8ByteLength(JSON.stringify(item))) && (options.preserveStrings === true
        || item.normalize("NFC") === item && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(item))
        ? item : undefined;
    }
    if (typeof item === "number") return Number.isFinite(item) && reserve(String(item).length) ? item : undefined;
    if (Array.isArray(item)) {
      if (item.length > (options.maxArrayItems ?? 8_192) || Reflect.ownKeys(item).length !== item.length + 1
        || !reserve(2 + Math.max(0, item.length - 1))) return undefined;
      const result: JsonValue[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
        const child = copy(descriptor.value, depth + 1);
        if (child === undefined) return undefined;
        result.push(child);
      }
      return result;
    }
    if (!isPlainRecord(item)) return undefined;
    const keys = Object.keys(item);
    if (!hasExactDataKeys(item, keys) || !reserve(2 + Math.max(0, keys.length - 1))) return undefined;
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys) {
      if (options.preserveObjectKeys !== true && (key === "__proto__" || key === "constructor" || key === "prototype")
        || key.length > maximumBytes || !reserve(utf8ByteLength(JSON.stringify(key)) + 1)) return undefined;
      const child = copy(item[key], depth + 1);
      if (child === undefined) return undefined;
      result[key] = child;
    }
    return result;
  }
  try {
    const result = copy(value, 0);
    return result !== undefined && utf8ByteLength(canonicalJson(result)) <= maximumBytes ? result : undefined;
  } catch {
    return undefined;
  }
}

export function freezeKnowledgeDeclaration<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeKnowledgeDeclaration(child);
    Object.freeze(value);
  }
  return value;
}
