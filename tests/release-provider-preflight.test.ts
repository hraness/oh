import { describe, expect, test } from "bun:test";
import { assertReleaseProviderPreflight } from "../scripts/check-release-provider-preflight";

function snapshot(overrides: Record<string, unknown> = {}): unknown {
  return {
    repository: { full_name: "hraness/oh", immutable_releases: true, visibility: "public" },
    rulesets: [{
      bypass_actors: [], conditions: { ref_name: { exclude: [], include: ["refs/tags/v*"] } },
      current_user_can_bypass: "never", enforcement: "active", name: "Immutable version tags",
      rules: [{ type: "update" }, { type: "deletion" }], target: "tag",
    }],
    ...overrides,
  };
}

describe("release provider preflight", () => {
  test("admits one exact immutable no-bypass policy", () => expect(() => assertReleaseProviderPreflight(snapshot())).not.toThrow());
  test("rejects mutable releases and bypasses", () => {
    expect(() => assertReleaseProviderPreflight(snapshot({ repository: { full_name: "hraness/oh", immutable_releases: false, visibility: "public" } }))).toThrow("immutable");
    const bypass = snapshot() as { rulesets: Array<Record<string, unknown>> };
    bypass.rulesets[0]!.bypass_actors = [{ actor_id: 1 }];
    expect(() => assertReleaseProviderPreflight(bypass)).toThrow("no-bypass");
  });
});
