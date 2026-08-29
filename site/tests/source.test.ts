import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const site = join(import.meta.dir, "..");
const read = async (path: string): Promise<string> =>
  await readFile(join(site, path), "utf8");

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

const prohibitedPublicIdentifierSha256 = new Set([
  "46248ac689828800502186d8753cc5717c5c2b47712e8158705a510dc892f00b",
  "763268b8dbdcf327570527acbf826901b855f9bb1921e7d92b3b69a3d69052b6",
  "8bdc3c22e340202bfd1c2dd177012ba9ebc208a7437740eb8a835a225f41bcf2",
  "d71b1bd8a7c2fe43ea18caecde71fa88662f0394ade77253c5df4967b29c855e",
  "91ed2ef15eee7102873d33d852cae9a195eff25e758269de6457723b1d8dc29a",
  "b58a1778c90889520d25f664dd029108a700c3be64aedcdc72b67d283128cefc",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("Oh site source contract", () => {
  test("renders the shared Ask AI links for both canonical pages", async () => {
    const [packageJson, home, specification, redirect] = await Promise.all([
      read("package.json"),
      read("app/page.tsx"),
      read("app/spec/page.tsx"),
      read("app/spec/v1/page.tsx"),
    ]);

    expect(packageJson).toContain(
      '"@hraness/ui": "github:hraness/ui#v0.4.10"',
    );
    expect(home).toContain('import { AskAiAboutThis } from "@hraness/ui"');
    expect(home).toContain(
      '<AskAiAboutThis className="ask-ai" url="https://oh.computer" />',
    );
    expect(specification).toContain('import { AskAiAboutThis } from "@hraness/ui"');
    expect(specification).toContain(
      '<AskAiAboutThis className="ask-ai" url="https://oh.computer/spec" />',
    );
    expect(redirect).not.toContain("AskAiAboutThis");
  });

  test("uses Nebula Sans for ordinary text while preserving serif and monospace roles", async () => {
    const [packageJson, globals] = await Promise.all([
      read("package.json"),
      read("app/globals.css"),
    ]);

    expect(packageJson).toContain(
      '"@hraness/design-kit": "github:hraness/design-kit#v0.2.1"',
    );
    expect(globals).toContain('@import "@hraness/design-kit/fonts.css"');
    expect(globals).toContain('--font-text: "Nebula Sans"');
    expect(globals).toContain("font-family: var(--font-text)");
    expect(globals).toContain('font-family: Georgia, "Times New Roman", serif');
    expect(globals).toContain("font-family: ui-monospace, SFMono-Regular, Menlo, monospace");
  });

  test("publishes one canonical specification page without redirecting links", async () => {
    const [home, specification, redirect, sitemap] = await Promise.all([
      read("app/page.tsx"),
      read("app/spec/page.tsx"),
      read("app/spec/v1/page.tsx"),
      read("public/sitemap.xml"),
    ]);

    expect(home).not.toContain('href="/spec/"');
    expect(specification).not.toContain('href="/spec/"');
    expect(specification).toContain('alternates: { canonical: "/spec" }');
    expect(specification).toContain('url: "/spec"');
    expect(redirect).toContain('permanentRedirect("/spec")');
    expect(sitemap).toContain("<loc>https://oh.computer/spec</loc>");
    expect(sitemap).not.toContain("https://oh.computer/spec/");
    expect(sitemap).not.toContain("https://oh.computer/spec/v1");
  });

  test("keeps page-specific social metadata and the Oh icon explicit", async () => {
    const [layout, specification, favicon] = await Promise.all([
      read("app/layout.tsx"),
      read("app/spec/page.tsx"),
      read("public/favicon.svg"),
    ]);

    expect(layout).toContain('url: "/favicon.svg"');
    expect(specification).toContain("twitter: {");
    expect(specification).toContain("title: specificationTitle");
    expect(specification).toContain("description: specificationDescription");
    expect(specification).toContain('images: ["/og.png"]');
    expect(favicon).toContain('fill="#b43a1d"');
    expect(favicon).toContain('stroke="#fff"');
    expect(favicon).not.toMatch(/#(?:0c79d8|2e9eff|68c4ff)/iu);
  });

  test("states only runtime-backed integrity and storage guarantees", async () => {
    const [home, layout, specification] = await Promise.all([
      read("app/page.tsx"),
      read("app/layout.tsx"),
      read("app/spec/page.tsx"),
    ]);
    const publicCopy = `${home}\n${layout}\n${specification}`;

    expect(publicCopy).not.toMatch(
      /every agent action|exact provenance|return typed conflicts|stable specification/iu,
    );
    expect(home).toContain("keyword index live in a SQLite file");
    expect(home).toContain("Semantic state is a rebuildable local cache");
    expect(home).toContain("every graph mutation inspectable and replayable");
    expect(home).toContain("verifiable operation history");
    expect(specification).toContain("fail closed with explicit");
    expect(specification).toContain("conflict errors");
  });

  test("leads developers to the verified first task before reference depth", async () => {
    const home = await read("app/page.tsx");

    expect(home).toContain(
      'href="https://github.com/hraness/oh#install-and-first-run"',
    );
    expect(home).toContain("Install and start");
    expect(home).toContain('className="text-action" href="/spec"');
  });

  test("derives public contract identity, version, and status from mirrored data", async () => {
    const [home, specification] = await Promise.all([
      read("app/page.tsx"),
      read("app/spec/page.tsx"),
    ]);

    expect(home).toContain('import manifest from "../public/spec/manifest.json"');
    expect(home).toContain("currentVersion.contractId");
    expect(home).toContain("currentVersion.status");
    expect(specification).toContain(
      'import manifest from "../../public/spec/manifest.json"',
    );
    expect(specification).toContain("currentVersion.status");
    expect(specification).toContain("contract.ontologyVersion");
  });

  test("contains no private paths or unpublished identifiers and uses the Vercel Next.js boundary", async () => {
    const publicPaths = [
      "app/layout.tsx",
      "app/page.tsx",
      "app/spec/page.tsx",
      "public/spec/v1/migration.md",
    ];
    const providerBoundaryPaths = [
      ".gitignore",
      "bun.lock",
      "next.config.ts",
      "package.json",
      "postcss.config.mjs",
      "tsconfig.json",
      "vercel.json",
    ];
    const repositoryIgnoreFile = Bun.file(join(site, "..", ".gitignore"));
    const [packageJsonSource, vercelConfigSource, repositoryIgnore, ...publicSources] =
      await Promise.all([
      read("package.json"),
      read("vercel.json"),
      repositoryIgnoreFile.exists().then(async (exists) => exists
        ? await repositoryIgnoreFile.text()
        : ""),
      ...publicPaths.map(read),
    ]);
    const packageJson = record(JSON.parse(packageJsonSource) as unknown, "package.json");
    const scripts = record(packageJson.scripts, "package.json scripts");
    const vercelConfig = JSON.parse(vercelConfigSource) as unknown;
    const providerBoundary = (await Promise.all(providerBoundaryPaths.map(read))).join("\n");
    const publicSource = [packageJsonSource, vercelConfigSource, ...publicSources].join("\n");
    const tokens = new Set(
      publicSource.toLocaleLowerCase("en-US").match(/[a-z][a-z0-9-]*/gu) ?? [],
    );

    expect(packageJson.name).toBe("oh-site");
    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines).toEqual({ node: "24.x" });
    expect(scripts).toEqual({
      build: "next build --webpack",
      dev: "next dev --webpack",
      lint: "eslint . --ignore-pattern .next",
      postbuild: "bun test ./tests/runtime.test.ts",
      prebuild: "bun run test",
      start: "next start",
      test: "bun test ./tests/source.test.ts",
      typecheck: "tsc --noEmit",
    });
    expect(vercelConfig).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      buildCommand: "bun run build",
      framework: "nextjs",
      installCommand: "bun install --frozen-lockfile --ignore-scripts",
    });
    expect(`${repositoryIgnore}\n${providerBoundary}`).not.toMatch(
      /(?:^|[\/])\.vinext(?:[\/]|$)|site\/dist\/|@openai\/sites|cloudflare|wrangler|hosting\.json|\bvinext\b/imu,
    );
    expect(await Bun.file(join(site, ".openai/hosting.json")).exists()).toBe(false);
    expect(await Bun.file(join(site, "vite.config.ts")).exists()).toBe(false);
    expect(publicSource).not.toMatch(/\/Users\/[^/\s]+|\/private\/tmp\/[^\s)]+/iu);
    expect([...tokens].filter((token) => prohibitedPublicIdentifierSha256.has(sha256(token))))
      .toEqual([]);
  });
});
