import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../src/canonical.ts";
import { parseKnowledgeGraphRecordV1 } from "../src/graph.ts";
import { Oh } from "../src/sdk.ts";

const root = join(import.meta.dir, "..");
const read = async (path: string): Promise<string> =>
  await readFile(join(root, path), "utf8");

describe("evidence-led product narrative", () => {
  test("moves from result through proof, model, interfaces, boundary, questions, and action", async () => {
    const page = await read("site/app/page.tsx");
    const landmarks = [
      'className="hero"',
      'className="proof-strip"',
      'id="model"',
      'id="trace"',
      'id="interfaces"',
      'id="boundary"',
      'id="questions"',
      'className="product-cta"',
    ];
    const positions = landmarks.map((landmark) => page.indexOf(landmark));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(page).toContain("A local research graph your agents can inspect");
    expect(page).toContain("Fresh database · canonical JSON · init and verify stay local");
    expect(page).toContain('"@type": "FAQPage"');
  });

  test("keeps the homepage and README on the same research object model", async () => {
    const [page, readme] = await Promise.all([
      read("site/app/page.tsx"),
      read("README.md"),
    ]);
    const objectModel = [
      ["Question", "inquiry"],
      ["Source", "entity"],
      ["Capture", "edition"],
      ["Claim", "statement"],
      ["Citation", "evidence"],
      ["Artifact", "view"],
    ] as const;

    for (const [label, kind] of objectModel) {
      expect(page).toContain(`label: "${label}"`);
      expect(page).toContain(`kind: "${kind}"`);
      expect(readme).toContain(`| ${label} | \`${kind}\``);
    }
    expect(page).toContain("an attributable <code>assertion</code>");
    expect(readme).toContain("An attributable `assertion`");
    expect(readme).toContain("https://oh.computer/#trace");
  });

  test("ships an exact schema-valid citation record as the inspectable trace", async () => {
    const source = JSON.parse(await read("site/public/examples/evidence-table-2.json")) as unknown;
    const parsed = parseKnowledgeGraphRecordV1(source);

    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(source);
    expect(parsed?.key).toBe("evidence:table-2");
    expect(parsed?.dependencies).toEqual([
      "assertion:endpoint-12-weeks",
      "edition:trial-report-v1",
    ]);
    expect(parsed?.recordSha256).toBe(
      "e19a2a8e0d951c8332c95bd11d07213bf2d99ccd6a46e1c7d2eb30487c86d9e4",
    );
  });

  test("shows the exact fresh-database verification output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oh-marketing-"));
    const page = await read("site/app/page.tsx");
    const oh = Oh.open({ databasePath: join(directory, "research.db") });
    try {
      expect(page).toContain(canonicalJson(oh.verify()));
    } finally {
      await oh.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("keeps CLI, SDK, and Skill examples aligned with the released package", async () => {
    const [page, packageSource, skill] = await Promise.all([
      read("site/app/page.tsx"),
      read("package.json"),
      read("skills/oh/SKILL.md"),
    ]);
    const packageJson = JSON.parse(packageSource) as Readonly<{
      dependencies?: Readonly<Record<string, string>>;
      engines: Readonly<{ bun: string; node: string }>;
      version: string;
    }>;

    expect(page).toContain(`bun add --global @hraness/oh@${packageJson.version}`);
    expect(page).toContain('import { Oh } from "@hraness/oh/sdk"');
    expect(page).toContain("oh contract");
    expect(page).toContain("oh verify --db research.db --space default");
    expect(skill).toContain("oh contract");
    expect(skill).toContain("oh verify --db .oh/oh.sqlite --space default");
    expect(packageJson.engines).toEqual({ bun: ">=1.3.14", node: ">=24" });
    expect(packageJson.dependencies).toBeUndefined();
    expect(page).toContain("No required runtime dependencies");
  });

  test("carries the shared responsive and accessibility contract in product-owned CSS", async () => {
    const css = await read("site/app/globals.css");

    expect(css).toContain('overflow-x: clip');
    expect(css).toContain('a:focus-visible { outline: 3px solid var(--accent)');
    expect(css).toContain('@media (pointer: coarse)');
    expect(css).toContain('min-height: 48px');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('font-family: var(--font-text)');
    expect(css).toContain('font-family: Georgia, "Times New Roman", serif');
  });
});
