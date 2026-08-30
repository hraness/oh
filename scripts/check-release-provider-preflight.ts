import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;
function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}

export function assertReleaseProviderPreflight(value: unknown): void {
  const snapshot = record(value, "release provider preflight");
  const repository = record(snapshot.repository, "repository readback");
  if (repository.full_name !== "hraness/oh" || repository.visibility !== "public" || repository.immutable_releases !== true) {
    throw new Error("Repository readback does not prove public immutable Releases for hraness/oh.");
  }
  if (!Array.isArray(snapshot.rulesets) || snapshot.rulesets.length > 100) throw new Error("Ruleset readback is not bounded.");
  const matches = snapshot.rulesets.filter((item) => {
    const ruleset = record(item, "ruleset readback");
    const conditions = record(ruleset.conditions, "ruleset conditions");
    const refs = record(conditions.ref_name, "ruleset ref condition");
    return ruleset.name === "Immutable version tags"
      && ruleset.target === "tag"
      && ruleset.enforcement === "active"
      && ruleset.current_user_can_bypass === "never"
      && Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length === 0
      && Array.isArray(refs.include) && refs.include.length === 1 && refs.include[0] === "refs/tags/v*"
      && Array.isArray(refs.exclude) && refs.exclude.length === 0
      && Array.isArray(ruleset.rules)
      && ruleset.rules.length === 2
      && [...ruleset.rules].map((rule) => record(rule, "ruleset rule").type).sort().join(",") === "deletion,update";
  });
  if (matches.length !== 1) throw new Error("No single exact active no-bypass immutable version-tag ruleset was proven.");
}

if (import.meta.main) {
  const [path, extra] = process.argv.slice(2);
  if (path === undefined || extra !== undefined) throw new Error("Usage: check-release-provider-preflight.ts ADMIN_READBACK.json");
  const bytes = await readFile(resolve(path));
  if (bytes.byteLength <= 0 || bytes.byteLength > 1_024 * 1_024) throw new Error("Provider readback file exceeded its bound.");
  assertReleaseProviderPreflight(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
  console.log("Verified immutable Releases and exact no-bypass v* update/delete rules.");
}
