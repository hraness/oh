import { describe, expect, test } from "bun:test";

import { canonicalJson, canonicalSha256, parseCanonicalJson, sha256Hex } from "./canonical";

describe("canonical JSON", () => {
  test("sorts object keys recursively and hashes exact bytes", () => {
    const left = { z: [{ b: 2, a: 1 }], a: "é" };
    const right = { a: "é", z: [{ a: 1, b: 2 }] };
    expect(canonicalJson(left)).toBe('{"a":"é","z":[{"a":1,"b":2}]}');
    expect(canonicalJson(right)).toBe(canonicalJson(left));
    expect(canonicalSha256(right)).toBe(canonicalSha256(left));
    expect(canonicalSha256(left)).toBe(sha256Hex(canonicalJson(left)));
  });

  test("rejects ambiguous and non-JSON values", () => {
    expect(() => canonicalJson(-0)).toThrow("negative zero");
    expect(() => canonicalJson(Number.NaN)).toThrow("finite");
    expect(() => canonicalJson({ value: undefined })).toThrow("cannot encode");
    expect(() => canonicalJson("\ud800")).toThrow("unpaired surrogate");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("cycle");
    expect(() => canonicalJson(Array(1))).toThrow("holes");
    const symbolObject = { value: 1, [Symbol("hidden")]: 2 };
    expect(() => canonicalJson(symbolObject)).toThrow("symbol property");
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => 1 });
    expect(() => canonicalJson(accessor)).toThrow("data property");
  });

  test("accepts only byte-canonical JSON", () => {
    expect(parseCanonicalJson('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
    expect(() => parseCanonicalJson('{ "a": 1 }')).toThrow("not canonical");
    expect(() => parseCanonicalJson('{"b":2,"a":1}')).toThrow("not canonical");
  });

  test("is invariant to insertion order across generated objects", () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const keys = Array.from({ length: 12 }, (_, index) => `k${(seed * 17 + index * 31) % 97}`);
      const first: Record<string, number> = {};
      const second: Record<string, number> = {};
      keys.forEach((key, index) => { first[key] = index; });
      [...keys].reverse().forEach((key) => { second[key] = first[key] as number; });
      expect(canonicalJson(first)).toBe(canonicalJson(second));
    }
  });
});
