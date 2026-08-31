import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

import { canonicalSha256, sha256Hex } from "../src/canonical.ts";
import { OH_CONTRACT_MANIFEST_V1 } from "../src/contract.ts";
import { OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 } from "../src/graph.ts";
import {
  OH_CONTRACT_ID_V1,
  OH_KNOWLEDGE_KERNEL_CONCEPTS_V1,
  OH_KNOWLEDGE_LIMITS_V1,
  OH_ONTOLOGY_VERSION_V1,
} from "../src/ontology.ts";
import { OH_EMBEDDING_PROFILE_V1 } from "../src/semantic.ts";
import {
  OH_CLOUDFLARE_EMBEDDING_PROFILE_V1,
  OH_SEMANTIC_RENDERER_V1,
} from "../src/cloudflare-embedding.ts";

const root = resolve(import.meta.dir, "..");
const tagline = "open-source tools for agentic research";

const markdownFiles = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "docs/publishing.md",
  "spec/README.md",
  "spec/v1/canonical-json.md",
  "spec/v1/ontology.md",
  "spec/v1/schema-evolution.md",
  "spec/v1/graph.md",
  "spec/v1/storage.md",
  "spec/v1/store.md",
  "spec/v1/sync.md",
  "spec/v1/embedding.md",
  "spec/v1/semantic-cloud.md",
  "spec/v1/projection.md",
  "spec/v1/memory.md",
  "spec/v1/memory-page.md",
  "spec/v1/migration.md",
  "skills/oh/SKILL.md",
] as const;

const schemaFiles = [
  "spec/v1/contract.schema.json",
  "spec/v1/record.schema.json",
  "spec/v1/schema-revision.schema.json",
  "spec/v1/operation.schema.json",
  "spec/v1/sync-bundle.schema.json",
  "spec/v1/projection-rule-pack.schema.json",
  "spec/v1/projection-query.schema.json",
  "spec/v1/projection-identity.schema.json",
  "spec/v1/projection-result.schema.json",
  "spec/v1/memory-page.schema.json",
] as const;

const publicSourceEntries = [
  ".gitignore",
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "bun.lock",
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "tsconfig.scripts.json",
  ".github",
  "docs",
  "dist",
  "scripts",
  "spec",
  "skills/oh",
  "src",
  "tests",
] as const;

const privateProvenancePatterns = [
  ["absolute macOS user path", /\/Users\/[^/\s]+/u],
  ["task-local temporary path", /\/private\/tmp\/[^\s)]+/u],
] as const;

// One-way hashes let the public tree reject unpublished identifiers without
// reproducing those identifiers in source or test output.
const prohibitedPublicIdentifierSha256 = new Set([
  "46248ac689828800502186d8753cc5717c5c2b47712e8158705a510dc892f00b",
  "763268b8dbdcf327570527acbf826901b855f9bb1921e7d92b3b69a3d69052b6",
  "8bdc3c22e340202bfd1c2dd177012ba9ebc208a7437740eb8a835a225f41bcf2",
  "d71b1bd8a7c2fe43ea18caecde71fa88662f0394ade77253c5df4967b29c855e",
  "91ed2ef15eee7102873d33d852cae9a195eff25e758269de6457723b1d8dc29a",
  "b58a1778c90889520d25f664dd029108a700c3be64aedcdc72b67d283128cefc",
]);

const sensitiveLiteralPatterns = [
  ["private key", /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u],
  ["GitHub access token", /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u],
  ["OpenAI-style secret", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u],
  ["Slack access token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u],
] as const;

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, path), "utf8")) as Record<string, unknown>;
}

function localMarkdownTargets(markdown: string): readonly string[] {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)]
    .map((match) => (match[1] ?? "").trim().replace(/^<|>$/gu, ""))
    .filter((target) => target.length > 0
      && !target.startsWith("#")
      && !/^[a-z][a-z0-9+.-]*:/iu.test(target));
}

function collectLocalJsonReferences(value: unknown, output: string[] = []): readonly string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLocalJsonReferences(item, output);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string" && item.startsWith(".")) output.push(item);
      else collectLocalJsonReferences(item, output);
    }
  }
  return output;
}

function collectStringLeaves(value: unknown, output: string[] = []): readonly string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, output);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectStringLeaves(item, output);
  }
  return output;
}

async function collectPublicTextFiles(): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(path: string): Promise<void> {
    const information = await stat(path);
    if (information.isDirectory()) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isDirectory() || entry.isFile()) await visit(join(path, entry.name));
      }
      return;
    }
    if (information.isFile()
      && (["", ".js", ".json", ".lock", ".map", ".md", ".ts", ".yaml", ".yml"].includes(extname(path)))) {
      files.push(path);
    }
  }
  for (const entry of publicSourceEntries) await visit(join(root, entry));
  return files.sort();
}

describe("public identity and documentation", () => {
  test("pins the exact public identity", async () => {
    const [readme, packageJson, sitePackageJson, skill, cli] = await Promise.all([
      readFile(join(root, "README.md"), "utf8"),
      json("package.json"),
      json("site/package.json"),
      readFile(join(root, "skills/oh/SKILL.md"), "utf8"),
      readFile(join(root, "src/cli.ts"), "utf8"),
    ]);
    expect(readme.startsWith(`# ${tagline}\n`)).toBe(true);
    expect(packageJson.name).toBe("@hraness/oh");
    expect(packageJson.version).toBe("0.3.1");
    expect(sitePackageJson.version).toBe("0.3.1");
    expect(cli).toContain('OH_PACKAGE_VERSION = "0.3.1"');
    expect(packageJson.description).toBe(tagline);
    expect(packageJson.homepage).toBe("https://oh.computer");
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.private).toBe(false);
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      provenance: true,
      registry: "https://registry.npmjs.org",
    });
    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines).toEqual({ bun: ">=1.3.14", node: ">=24" });
    expect(packageJson.repository).toEqual({ type: "git", url: "git+https://github.com/hraness/oh.git" });
    expect(packageJson.bugs).toEqual({ url: "https://github.com/hraness/oh/issues" });
    expect(readme).toContain("bun add --global @hraness/oh@0.3.1");
    expect(readme).toContain('"@hraness/oh": "0.3.1"');
    expect(readme).toContain("releases/download/v0.3.1/hraness-oh-0.3.1.tgz");
    expect(readme).not.toContain("github:hraness/oh#");
    expect(skill).toContain("`@hraness/oh@0.3.1`");
    expect(skill).toContain("immutable GitHub Release `v0.3.1`");
    expect(skill).toMatch(/^---\nname: oh\ndescription: .+\n---\n/u);
    expect(skill).not.toMatch(/TODO|TBD|example skill/iu);
  });

  test("keeps every local Markdown link resolvable", async () => {
    for (const path of markdownFiles) {
      const markdown = await readFile(join(root, path), "utf8");
      for (const target of localMarkdownTargets(markdown)) {
        const withoutFragment = target.split("#", 1)[0] as string;
        const resolved = resolve(dirname(join(root, path)), decodeURIComponent(withoutFragment));
        expect(resolved.startsWith(`${root}/`)).toBe(true);
        expect((await stat(resolved)).isFile() || (await stat(resolved)).isDirectory()).toBe(true);
      }
    }
  });

  test("keeps canonical public sources free of private provenance and credential literals", async () => {
    for (const path of await collectPublicTextFiles()) {
      const source = await readFile(path, "utf8");
      const violations = [...privateProvenancePatterns, ...sensitiveLiteralPatterns]
        .filter(([, pattern]) => pattern.test(source))
        .map(([label]) => label);
      const tokens = new Set(source.toLocaleLowerCase("en-US").match(/[a-z][a-z0-9-]*/gu) ?? []);
      if ([...tokens].some((token) => prohibitedPublicIdentifierSha256.has(sha256Hex(token)))) {
        violations.push("unpublished identifier");
      }
      expect({ path: relative(root, path), violations }).toEqual({ path: relative(root, path), violations: [] });
    }
  });

  test("does not claim unshipped migration artifacts or procedures", async () => {
    const migration = await readFile(join(root, "spec/v1/migration.md"), "utf8");
    expect(migration).not.toMatch(/\bfixtures?\b|shadow[- ]reads?|compatibility (?:entrypoint|module)/iu);
  });

  test("documents only commands exposed by CLI help", async () => {
    const process_ = Bun.spawn([process.execPath, join(root, "src/cli.ts"), "--help"], {
      cwd: root,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      process_.exited,
      new Response(process_.stdout).text(),
      new Response(process_.stderr).text(),
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    for (const command of [
      "oh init",
      "oh put",
      "oh get",
      "oh list",
      "oh log",
      "oh search",
      "oh tombstone",
      "oh verify",
      "oh sync export",
      "oh sync import",
      "oh contract",
      "oh version",
    ]) expect(stdout).toContain(command);
  });
});

describe("versioned public contract", () => {
  test("publishes the exact runtime contract and digest", async () => {
    const contract = await json("spec/v1/contract.json");
    expect(contract).toEqual(OH_CONTRACT_MANIFEST_V1);
    const { contractSha256, ...payload } = contract;
    expect(contractSha256).toBe(canonicalSha256(payload));

    const manifest = await json("spec/manifest.json");
    expect(manifest.current).toBe("v1");
    expect(manifest.homepage).toBe("https://oh.computer");
    const version = (manifest.versions as readonly Record<string, unknown>[])[0];
    expect(version).toMatchObject({ contractId: OH_CONTRACT_ID_V1,
      contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256, id: "v1", status: "current", v: 1 });
  });

  test("resolves every asset claimed by the discovery manifest", async () => {
    const manifestPath = join(root, "spec/manifest.json");
    const manifest = await json("spec/manifest.json");
    const version = (manifest.versions as readonly Record<string, unknown>[])[0] as Record<string, unknown>;
    const claims = [version.contract, version.embeddingProfile, version.ontology, version.specification,
      ...collectStringLeaves(version.memory),
      ...collectStringLeaves(version.projection), ...collectStringLeaves(version.semanticCloud),
      ...(Array.isArray(version.schemas) ? version.schemas : [])];
    expect(claims.length).toBeGreaterThan(4);
    for (const claim of claims) {
      expect(typeof claim).toBe("string");
      if (typeof claim !== "string") continue;
      expect(claim.startsWith("./")).toBe(true);
      const target = resolve(dirname(manifestPath), claim);
      expect(target.startsWith(`${join(root, "spec")}/`)).toBe(true);
      expect((await stat(target)).isFile()).toBe(true);
    }
  });

  test("backs every documented package entrypoint with an export", async () => {
    const packageJson = await json("package.json");
    const exports = packageJson.exports as Record<string, unknown>;
    const claims = new Set<string>();
    for (const path of markdownFiles) {
      const markdown = await readFile(join(root, path), "utf8");
      for (const match of markdown.matchAll(/@hraness\/oh(?:\/[a-z0-9-]+)*/gu)) claims.add(match[0]);
    }
    expect(claims.size).toBeGreaterThan(1);
    for (const claim of claims) {
      const suffix = claim.slice("@hraness/oh".length);
      const exportName = suffix.length === 0 ? "." : `.${suffix}`;
      expect(Object.hasOwn(exports, exportName)).toBe(true);
    }
  });

  test("publishes the intended package inventory with live entrypoints", async () => {
    const packageJson = await json("package.json");
    expect(packageJson.files).toEqual(["dist", "src", "spec", "skills", "README.md", "LICENSE"]);
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.bin).toEqual({ oh: "./dist/cli.js" });

    const exports = packageJson.exports as Record<string, unknown>;
    expect(Object.keys(exports).sort()).toEqual([
      ".",
      "./experimental/memory",
      "./experimental/projection-suss",
      "./libsql",
      "./memory-page",
      "./package.json",
      "./projection",
      "./sdk",
      "./semantic",
      "./semantic-cloud",
      "./sqlite",
      "./store",
      "./sync",
    ]);

    const inventory = packageJson.files as readonly string[];
    for (const entry of inventory) expect(await stat(join(root, entry))).toBeDefined();

    const targets = [packageJson.main, packageJson.types,
      ...collectStringLeaves(packageJson.bin), ...collectStringLeaves(exports)];
    for (const target of targets) {
      expect(typeof target).toBe("string");
      if (typeof target !== "string") continue;
      expect(target.startsWith("./")).toBe(true);
      const resolved = resolve(root, target);
      expect(resolved.startsWith(`${root}/`)).toBe(true);
      expect((await stat(resolved)).isFile()).toBe(true);
    }

    const peers = packageJson.peerDependencies as Record<string, string>;
    const peerMetadata = packageJson.peerDependenciesMeta as Record<string, Readonly<{ optional?: boolean }>>;
    expect(peers).toEqual({ "@libsql/client": ">=0.17.4 <1", "@suss/datalog": "0.20.0",
      "@tobilu/qmd": "2.5.3" });
    expect(Object.keys(peers).every((name) => peerMetadata[name]?.optional === true)).toBe(true);
  });

  test("publishes the exact ontology and embedding profiles", async () => {
    const ontology = await json("spec/v1/ontology.json");
    expect(ontology.contractId).toBe(OH_CONTRACT_ID_V1);
    expect(ontology.ontologyVersion).toBe(OH_ONTOLOGY_VERSION_V1);
    expect(ontology.kernelConcepts).toEqual(OH_KNOWLEDGE_KERNEL_CONCEPTS_V1);
    expect(ontology.limits).toEqual(OH_KNOWLEDGE_LIMITS_V1);
    expect(await json("spec/v1/embedding-profile.json")).toEqual(OH_EMBEDDING_PROFILE_V1);
    expect(await json("spec/v1/cloudflare-embedding-profile.json"))
      .toEqual(OH_CLOUDFLARE_EMBEDDING_PROFILE_V1);
    expect(await json("spec/v1/cloudflare-embedding-renderer.json"))
      .toEqual(OH_SEMANTIC_RENDERER_V1);
  });

  test("discovers the complete projection exchange surface", async () => {
    const manifest = await json("spec/manifest.json");
    const version = (manifest.versions as readonly Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(version.projection).toEqual({
      identitySchema: "./v1/projection-identity.schema.json",
      querySchema: "./v1/projection-query.schema.json",
      resultSchema: "./v1/projection-result.schema.json",
      rulePackSchema: "./v1/projection-rule-pack.schema.json",
      specification: "./v1/projection.md",
    });

    const identity = await json("spec/v1/projection-identity.schema.json");
    const identityProperties = identity.properties as Record<string, unknown>;
    expect(Object.keys(identityProperties).sort()).toEqual([
      "contractSha256", "datasetSha256", "engineSha256", "evaluationSha256", "projectionSha256",
      "querySha256", "rulePackSha256", "semantics", "snapshotSha256", "v",
    ]);

    const result = await json("spec/v1/projection-result.schema.json");
    const definitions = result.$defs as Record<string, Record<string, unknown>>;
    const evaluation = definitions.evaluation?.properties as Record<string, unknown>;
    const row = definitions.row?.properties as Record<string, unknown>;
    const stats = definitions.stats?.properties as Record<string, unknown>;
    expect(Object.keys(evaluation).sort()).toEqual([
      "maximumDerivedTuples", "maximumProofDepth", "maximumProofNodes", "maximumResultBytes",
      "maximumRounds", "maximumTotalProofNodes", "maximumWorkUnits", "v",
    ]);
    expect(Object.keys(row).sort()).toEqual(["proofs", "proofsTruncated", "supportCount", "v", "values"]);
    expect(Object.keys(stats).sort()).toEqual([
      "baseFacts", "derivedFacts", "proofNodes", "proofsTruncated", "queryMatches", "relations",
      "rounds", "truncated", "truncationReasons", "v", "workUnits",
    ]);
  });

  test("discovers the hosted semantic cache as a derived profile", async () => {
    const manifest = await json("spec/manifest.json");
    const version = (manifest.versions as readonly Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(version.semanticCloud).toEqual({
      profile: "./v1/cloudflare-embedding-profile.json",
      renderer: "./v1/cloudflare-embedding-renderer.json",
      specification: "./v1/semantic-cloud.md",
    });
    const specification = await readFile(join(root, "spec/v1/semantic-cloud.md"), "utf8");
    expect(specification).toContain("not an Oh graph authority");
    expect(specification).toContain("stores no title, source content, query, page body, record JSON");
    expect(specification).toContain("permanent authority purge tombstones");
    expect(specification).toContain("MUST NOT weaken exact graph or Datalog operations");
  });

  test("discovers the experimental composite memory boundary", async () => {
    const manifest = await json("spec/manifest.json");
    const version = (manifest.versions as readonly Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(version.memory).toEqual({
      pageSchema: "./v1/memory-page.schema.json",
      pageSpecification: "./v1/memory-page.md",
      specification: "./v1/memory.md",
    });
    const memory = await readFile(join(root, "spec/v1/memory.md"), "utf8");
    expect(memory).toContain("One kernel, two authorities");
    expect(memory).toContain("createOhMemoryAgentV2");
    expect(memory).toContain("authenticated bearer cursor, not knowledge authority");
    expect(memory).toContain("`resultSha256` commits that deterministic");
    expect(memory).toContain("It does not sync the working operation chain");
    const page = await readFile(join(root, "spec/v1/memory-page.md"), "utf8");
    expect(page).toContain("self-contained transport for one memory-page record");
    expect(page).toContain("contain no vectors, embedding model, provider, score");
  });

  test("keeps every JSON Schema parseable, versioned, and locally closed", async () => {
    for (const path of schemaFiles) {
      const schema = await json(path);
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.$id).toBe(`https://oh.computer/${path}`);
      for (const reference of collectLocalJsonReferences(schema)) {
        const target = reference.split("#", 1)[0] as string;
        expect((await stat(resolve(dirname(join(root, path)), target))).isFile()).toBe(true);
      }
    }
  });

  test("keeps schema record kinds equal to the runtime set", async () => {
    const contractSchema = await json("spec/v1/contract.schema.json");
    const properties = contractSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.recordKinds?.const).toEqual(OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1);

    const recordSchema = await json("spec/v1/record.schema.json");
    const recordProperties = recordSchema.properties as Record<string, Record<string, unknown>>;
    expect(recordProperties.kind?.enum).toEqual(OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1);
  });
});

describe("repository policy", () => {
  test("orders source tests before build-dependent site runtime tests", async () => {
    const packageJson = await json("package.json");
    const sitePackageJson = await json("site/package.json");
    const scripts = packageJson.scripts as Record<string, string>;
    const siteScripts = sitePackageJson.scripts as Record<string, string>;
    expect(scripts.check).toContain("bun run test");
    expect(scripts.check).toContain("bun run test:node");
    expect(scripts.test).toBe("bun test ./src ./tests ./site/tests/source.test.ts");
    expect(scripts.test).not.toContain("runtime.test.ts");
    expect(siteScripts.postbuild).toBe("bun test ./tests/runtime.test.ts");
  });

  test("pins workflow actions to immutable commits", async () => {
    for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
      const workflow = await readFile(join(root, path), "utf8");
      const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map((match) => match[1] as string);
      expect(uses.length).toBeGreaterThan(0);
      expect(uses.every((value) => /@[a-f0-9]{40}$/u.test(value))).toBe(true);
    }
  });

  test("publishes one exact OIDC-provenance artifact set through immutable releases", async () => {
    const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
    const packageBuild = workflow.indexOf("npm pack --ignore-scripts --pack-destination artifacts .");
    const exactInstall = workflow.indexOf("package-smoke.ts artifacts/*.tgz");
    const npmPublish = workflow.indexOf("publish-npm-release.ts artifacts/*.tgz");
    const githubPublish = workflow.indexOf("publish-github-release.ts");
    const admission = workflow.indexOf("check-public-release.ts");
    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("matrix:\n        os: [ubuntu-24.04, macos-14]");
    expect(workflow).toContain("release-artifact-checksum.ts write");
    expect(workflow).toContain("release-artifact-checksum.ts check");
    expect(workflow).toContain("git cat-file -t \"$REQUESTED_TAG\"");
    expect(workflow).toContain("Release tag commit is not a reviewed ancestor of current $DEFAULT_BRANCH");
    expect(packageBuild).toBeGreaterThan(0);
    expect(exactInstall).toBeGreaterThan(packageBuild);
    expect(npmPublish).toBeGreaterThan(exactInstall);
    expect(npmPublish).toBeGreaterThan(githubPublish);
    expect(admission).toBeGreaterThan(githubPublish);
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./u);
    expect(workflow.match(/^\s+contents: write$/gmu)).toHaveLength(1);
    expect(workflow.match(/^\s+id-token: write$/gmu)).toHaveLength(1);
  });

  test("keeps the public root guide to its two required sections", async () => {
    const guide = await readFile(join(root, "AGENTS.md"), "utf8");
    expect([...guide.matchAll(/^# .+$/gmu)].map((match) => match[0])).toEqual([
      "# Contents",
      "# Guidelines",
    ]);
  });
});
