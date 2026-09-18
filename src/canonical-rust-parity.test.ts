import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { canonicalJson, canonicalSha256 } from "./canonical";
import { loadCanonicalRustTextEngine } from "./canonical-rust";

async function engine() {
  return loadCanonicalRustTextEngine();
}

function jsonTextArbitrary(): fc.Arbitrary<string> {
  return fc.record({
    a: fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 5 }),
    b: fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.oneof(fc.string(), fc.boolean(), fc.constant(null))),
    c: fc.record({ nested: fc.boolean() }),
  }).map((value) => JSON.stringify(value));
}

describe("canonical-rust text engine parity", () => {
  test("loads the Rust WASM implementation", async () => {
    expect((await engine()).implementation).toBe("rust-wasm");
  });

  test("canonicalJson matches the TypeScript reference on generated JSON text", async () => {
    const rust = await engine();
    fc.assert(
      fc.property(jsonTextArbitrary(), (text) => {
        const value = JSON.parse(text);
        const expected = canonicalJson(value);
        const actual = rust.canonicalJson(text);
        expect(actual).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  test("canonicalSha256 matches the TypeScript reference on generated JSON text", async () => {
    const rust = await engine();
    fc.assert(
      fc.property(jsonTextArbitrary(), (text) => {
        const value = JSON.parse(text);
        const expected = canonicalSha256(value);
        const actual = rust.canonicalSha256(text);
        expect(actual).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  test("finite f64 formatting matches ECMAScript", async () => {
    const rust = await engine();
    fc.assert(
      fc.property(
        fc.double({ noDefaultInfinity: true, noNaN: true }).filter((value) => !Object.is(value, -0)),
        (value) => {
          const text = JSON.stringify(value);
          expect(rust.canonicalJson(text)).toBe(text);
        },
      ),
      { numRuns: 20_000 },
    );
  });

  test("edge cases match the TypeScript reference", async () => {
    const rust = await engine();
    const cases = [
      "{}",
      "[]",
      "null",
      "true",
      "false",
      "1",
      "1.5",
      "1e30",
      "1e-7",
      "0.000001",
      '"hello"',
      '"\\n\\t\\\\\\\""',
      '"\\ud83d\\ude00"',
      '{"b":1,"a":2}',
      '{"B":1,"A":2,"a":3}',
      '{"x":[{"y":1}]}',
      '{"a":null,"b":true,"c":false,"d":"str","e":1,"f":1.5,"g":[1,2,3]}',
    ];
    for (const text of cases) {
      const value = JSON.parse(text);
      expect(rust.canonicalJson(text)).toBe(canonicalJson(value));
      expect(rust.canonicalSha256(text)).toBe(canonicalSha256(value));
    }
  });

  test("rejects negative zero", async () => {
    const rust = await engine();
    expect(() => rust.canonicalJson("-0")).toThrow();
    expect(() => rust.canonicalJson("-0.0")).toThrow();
  });
});
