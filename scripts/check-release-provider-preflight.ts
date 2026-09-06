import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;
function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}

function exactEnvironmentPolicy(environmentValue: unknown, policiesValue: unknown): boolean {
  const environment = record(environmentValue, "npm-release environment readback");
  const deployment = record(
    environment.deployment_branch_policy,
    "npm-release deployment branch policy",
  );
  const policies = record(policiesValue, "npm-release branch-policy readback");
  if (!Array.isArray(environment.protection_rules) || environment.protection_rules.length !== 1) {
    return false;
  }
  const [protection] = environment.protection_rules;
  if (!Array.isArray(policies.branch_policies) || policies.branch_policies.length !== 1) {
    return false;
  }
  const [policy] = policies.branch_policies;
  return environment.name === "npm-release"
    && environment.can_admins_bypass === false
    && deployment.custom_branch_policies === true
    && deployment.protected_branches === false
    && record(protection, "npm-release protection rule").type === "branch_policy"
    && policies.total_count === 1
    && record(policy, "npm-release branch policy").name === "v*"
    && record(policy, "npm-release branch policy").type === "tag";
}

export function assertReleaseProviderPreflight(value: unknown): void {
  const snapshot = record(value, "release provider preflight");
  const repository = record(snapshot.repository, "repository readback");
  if (repository.full_name !== "hraness/oh" || repository.visibility !== "public") {
    throw new Error("Repository readback does not prove public hraness/oh authority.");
  }
  const immutableReleases = record(
    snapshot.immutableReleases,
    "immutable Releases readback",
  );
  if (
    immutableReleases.enabled !== true
    || immutableReleases.enforced_by_owner !== true
  ) {
    throw new Error(
      "Immutable Releases readback does not prove owner-enforced release immutability for hraness/oh.",
    );
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
  if (!exactEnvironmentPolicy(snapshot.environment, snapshot.environmentPolicies)) {
    throw new Error(
      "npm-release environment must disable administrator bypass, require no reviewer, and admit only v* tags.",
    );
  }
}

if (import.meta.main) {
  const [path, extra] = process.argv.slice(2);
  if (path === undefined || extra !== undefined) throw new Error("Usage: check-release-provider-preflight.ts ADMIN_READBACK.json");
  const bytes = await readFile(resolve(path));
  if (bytes.byteLength <= 0 || bytes.byteLength > 1_024 * 1_024) throw new Error("Provider readback file exceeded its bound.");
  assertReleaseProviderPreflight(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
  console.log("Verified immutable Releases, exact no-bypass v* rules, and the tag-only npm-release environment.");
}
