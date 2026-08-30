import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { sha256Hex } from "../src/canonical.ts";

const root = join(import.meta.dir, "..");

const prohibitedPublicIdentifierSha256 = new Set([
  "46248ac689828800502186d8753cc5717c5c2b47712e8158705a510dc892f00b",
  "763268b8dbdcf327570527acbf826901b855f9bb1921e7d92b3b69a3d69052b6",
  "8bdc3c22e340202bfd1c2dd177012ba9ebc208a7437740eb8a835a225f41bcf2",
  "d71b1bd8a7c2fe43ea18caecde71fa88662f0394ade77253c5df4967b29c855e",
  "91ed2ef15eee7102873d33d852cae9a195eff25e758269de6457723b1d8dc29a",
  "b58a1778c90889520d25f664dd029108a700c3be64aedcdc72b67d283128cefc",
]);

async function relativeFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(relative(directory, path));
    }
  };
  await visit(directory);
  return output.sort();
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (channels[0] as number)
    + 0.7152 * (channels[1] as number)
    + 0.0722 * (channels[2] as number);
}

function contrast(left: string, right: string): number {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

describe("public site surface", () => {
  test("mirrors every canonical specification byte at its public URL", async () => {
    const canonical = join(root, "spec");
    const mirrored = join(root, "site/public/spec");
    const canonicalFiles = await relativeFiles(canonical);
    expect(await relativeFiles(mirrored)).toEqual(canonicalFiles);
    for (const path of canonicalFiles) {
      expect(await readFile(join(mirrored, path))).toEqual(await readFile(join(canonical, path)));
    }
  });

  test("keeps the exact public identity and only supported CLI examples", async () => {
    const page = await readFile(join(root, "site/app/page.tsx"), "utf8");
    const layout = await readFile(join(root, "site/app/layout.tsx"), "utf8");
    expect(page).toContain("<h1 id=\"hero-title\">open-source tools for agentic research</h1>");
    expect(layout).toContain("Oh: open-source tools for agentic research");
    expect(page).toContain("$ oh init --db research.db");
    expect(page).toContain("$ oh contract --db research.db");
    expect(page).toContain("$ oh verify --db research.db");
    expect(page).not.toContain("oh inspect");
    expect(page).not.toContain("oh init research.db");
  });

  test("derives record kinds from the mirrored contract and checks the site in CI", async () => {
    const specification = await readFile(join(root, "site/app/spec/page.tsx"), "utf8");
    const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
    expect(specification).toContain('import contract from "../../public/spec/v1/contract.json"');
    expect(specification).toContain("contract.recordKinds.map");
    expect(specification).toContain("The additive V2 facade");
    expect(workflow).toContain("Require an exact public specification mirror");
    expect(workflow).toContain("working-directory: site");
    expect(workflow).toContain("bun run lint");
    expect(workflow).toContain("bun run build");
  });

  test("keeps small accent text above AA contrast on paper", async () => {
    const css = await readFile(join(root, "site/app/globals.css"), "utf8");
    const accent = css.match(/--accent:\s*(#[a-f0-9]{6})/iu)?.[1];
    const paper = css.match(/--paper:\s*(#[a-f0-9]{6})/iu)?.[1];
    expect(accent).toBeDefined();
    expect(paper).toBeDefined();
    expect(contrast(accent as string, paper as string)).toBeGreaterThanOrEqual(4.5);
  });

  test("contains no private predecessor or filesystem provenance", async () => {
    const paths = [
      "site/app/layout.tsx",
      "site/app/page.tsx",
      "site/app/spec/page.tsx",
      "site/public/spec/v1/migration.md",
      "site/public/spec/manifest.json",
    ];
    const text = (await Promise.all(paths.map(async (path) => await readFile(join(root, path), "utf8")))).join("\n");
    const tokens = new Set(text.toLocaleLowerCase("en-US").match(/[a-z][a-z0-9-]*/gu) ?? []);
    expect([...tokens].some((token) => prohibitedPublicIdentifierSha256.has(sha256Hex(token)))).toBe(false);
    expect(text).not.toMatch(/\/Users\/[^/\s]+|\/private\/tmp\/[^\s)]+/u);
  });
});
