import { describe, expect, test } from "bun:test";
import { clipOhOtherTextV1 } from "../scripts/benchmarks/oh-author-log-context";

describe("clipOhOtherTextV1", () => {
  test("leaves text within the bound unchanged", () => {
    expect(clipOhOtherTextV1("short reply", 64)).toBe("short reply");
  });
  test("clips at a word boundary and marks the cut", () => {
    const clipped = clipOhOtherTextV1("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu", 32);
    expect(clipped.endsWith(" …[clipped]")).toBe(true);
    expect(Buffer.byteLength(clipped.replace(" …[clipped]", ""))).toBeLessThanOrEqual(32);
    expect("alpha beta gamma delta epsilon zeta".startsWith(clipped.replace(" …[clipped]", ""))).toBe(true);
  });
  test("never splits a multi-byte character", () => {
    const clipped = clipOhOtherTextV1("é".repeat(100), 65);
    expect(clipped).not.toContain("�");
    expect(clipped.startsWith("é".repeat(32))).toBe(true);
  });
});
