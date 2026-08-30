import { describe, expect, test } from "bun:test";
import { mayPerformFirstNpmPublication } from "../scripts/release-attempt-policy";

describe("npm release attempt policy", () => {
  test("allows any positive attempt to first-publish the same reviewed artifact", () => {
    expect(mayPerformFirstNpmPublication("1", false)).toBe(true);
    expect(mayPerformFirstNpmPublication("2", false)).toBe(true);
    expect(mayPerformFirstNpmPublication("12", false)).toBe(true);
  });
  test("allows later attempts to verify an already exact immutable version", () => {
    expect(mayPerformFirstNpmPublication("2", true)).toBe(true);
  });
});
