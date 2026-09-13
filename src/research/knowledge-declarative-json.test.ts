import { expect, test } from "bun:test";
import { canonicalJson, parseJsonValue } from "./document-domain";
import { knowledgeDeclarativeJson } from "./knowledge-declarative-json";

test("portable JSON primitives preserve canonical order and retained source strings", () => {
  const source = "e\u0301\r\n";
  expect(knowledgeDeclarativeJson({ source })).toBeUndefined();
  const retained = knowledgeDeclarativeJson({ z: source, a: -0 }, 1_024, { preserveStrings: true });
  expect(retained).toEqual({ a: -0, z: source });
  expect(canonicalJson(retained!)).toBe('{"a":0,"z":"é\\r\\n"}');
  expect(parseJsonValue(JSON.parse('{"z":1,"a":[null,true]}'))).toEqual({ ok: true, value: { a: [null, true], z: 1 } });
});

test("hostile arrays, objects and serialization hooks never execute through the declarative boundary", () => {
  let executed = 0;
  const poison = () => { executed++; throw new Error("Foreign callback executed."); };
  const array: unknown[] = [];
  Object.defineProperty(array, "0", { enumerable: true, get: poison });
  const iterator: unknown[] = [1];
  Object.defineProperty(iterator, Symbol.iterator, { value: poison });
  const object = Object.defineProperty({}, "data", { enumerable: true, get: poison });
  for (const value of [array, iterator, object, { toJSON: poison }, new Date(), new Map(), { constructor: "forged" }]) {
    expect(knowledgeDeclarativeJson(value)).toBeUndefined();
  }
  expect(executed).toBe(0);
  const cycle: Record<string, unknown> = {}; cycle["self"] = cycle;
  expect(knowledgeDeclarativeJson(cycle)).toBeUndefined();
  expect(knowledgeDeclarativeJson({ text: "a".repeat(4_096) }, 64)).toBeUndefined();
  expect(knowledgeDeclarativeJson([[[1]]], 256, { maxDepth: 1 })).toBeUndefined();
  expect(knowledgeDeclarativeJson([1, 2, 3], 256, { maxNodes: 2 })).toBeUndefined();
});


test("raw evidence opt-in preserves JSON keys in null-prototype copies without enabling callbacks", () => {
  const raw: unknown = JSON.parse('{"__proto__":{"polluted":true},"constructor":"retained","prototype":[] }');
  expect(knowledgeDeclarativeJson(raw)).toBeUndefined();
  const copied = knowledgeDeclarativeJson(raw, 1024, { preserveObjectKeys: true });
  expect(copied).toEqual(raw);
  expect(Object.getPrototypeOf(copied)).toBeNull();
  expect(Object.prototype).not.toHaveProperty("polluted");
  let executed = false;
  const hostile = Object.defineProperty({}, "constructor", { enumerable: true, get() { executed = true; return "x"; } });
  expect(knowledgeDeclarativeJson(hostile, 1024, { preserveObjectKeys: true })).toBeUndefined();
  expect(executed).toBe(false);
  const wide = Array(8193).fill(0);
  expect(knowledgeDeclarativeJson(wide)).toBeUndefined();
  expect(knowledgeDeclarativeJson(wide, 100000, { maxArrayItems: 8193 })).toEqual(wide);
});
