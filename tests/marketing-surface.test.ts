import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseKnowledgeGraphRecordV1 } from "../src/graph.ts";

const root = join(import.meta.dir, "..");
const read = async (path: string): Promise<string> =>
  await readFile(join(root, path), "utf8");

describe("evidence-led product narrative", () => {
  test("moves from result through proof, model, interfaces, boundary, questions, and action", async () => {
    const page = await read("site/app/page.tsx");
    const landmarks = [
      "<ProductHero",
      'id="model"',
      'id="trace"',
      'id="interfaces"',
      'id="install"',
      'id="kernel"',
      'id="questions"',
    ];
    const positions = landmarks.map((landmark) => page.indexOf(landmark));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    // Attribution belongs to the shared network footer rendered by the layout.
    expect(page).not.toContain('id="maker"');
    expect(page).not.toContain("MarketingMaker");
    expect(page).toContain('const heading = "Agent memory that shows its work."');
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

  test("replays the hero CLI proof against a fresh local database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oh-marketing-"));
    const page = await read("site/app/page.tsx");
    const raw = /const proofTranscript = `([\s\S]*?)`;/u.exec(page)?.[1];
    expect(raw).toBeDefined();
    const transcript = raw!.replaceAll("\\\\", "\\");
    const run = async (args: string[]) => {
      const child = Bun.spawn([process.execPath, join(root, "src/cli.ts"), ...args], {
        cwd: directory,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: directory,
          LANG: "en_US.UTF-8", HRANESS_AUDIENCE: "human", HRANESS_SUPPORT: "off", NO_COLOR: "1" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited,
        new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code).toBe(0);
      return stdout + stderr;
    };
    try {
      await run(["init"]);
      for (const [kind, key, dependencies] of [
        ["entity", "entity:trial-report", []],
        ["edition", "edition:trial-report-v1", ["entity:trial-report"]],
        ["statement", "statement:endpoint-12-weeks", []],
        ["assertion", "assertion:endpoint-12-weeks", ["statement:endpoint-12-weeks"]],
      ] as const) {
        await run(["put", "--kind", kind, "--key", key, "--value", "{}",
          ...dependencies.flatMap((key) => ["--depends-on", key])]);
      }
      const blocks = transcript.split("\n\n$ ");
      expect(blocks).toHaveLength(3);
      for (const block of blocks) {
        const logical = block.replaceAll("\\\n", " ").replace(/^\$ /u, "");
        const [command, ...output] = logical.split("\n");
        // The public example has single-quoted JSON and otherwise simple argv.
        const words = command!.match(/'[^']*'|[^\s]+/gu) ?? [];
        expect(words.shift()).toBe("oh");
        const args = words.map((word) => word.startsWith("'") ? word.slice(1, -1) : word);
        expect((await run(args)).trimEnd()).toBe(output.join("\n").trimEnd());
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("keeps CLI, SDK, and Skill examples aligned with the released package", async () => {
    const [page, packageSource, publishedSource, skill] = await Promise.all([
      read("site/app/page.tsx"),
      read("package.json"),
      read("site/published-release.json"),
      read("skills/oh/SKILL.md"),
    ]);
    const packageJson = JSON.parse(packageSource) as Readonly<{
      dependencies?: Readonly<Record<string, string>>;
      engines: Readonly<{ bun: string; node: string }>;
      version: string;
    }>;
    const publishedRelease = JSON.parse(publishedSource) as Readonly<{ version: string }>;

    expect(page).toContain('import publishedRelease from "../published-release.json"');
    expect(page).toContain("const releaseVersion = publishedRelease.version;");
    expect(page).toContain("bun add --global @hraness/oh@${releaseVersion}");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(publishedRelease.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(skill).toContain(`@hraness/oh@${publishedRelease.version}`);
    expect(page).toContain('import { Oh } from "@hraness/oh/sdk"');
    expect(page).toContain("oh contract");
    expect(page).toContain("oh verify --db research.db --space default");
    expect(skill).toContain("oh contract");
    expect(skill).toContain("oh verify --db .oh/oh.sqlite --space default");
    expect(packageJson.engines).toEqual({ bun: ">=1.3.14", node: ">=24" });
    expect(packageJson.dependencies).toBeUndefined();
  });

  test("carries the shared responsive and accessibility contract in product-owned CSS", async () => {
    const css = await read("site/app/globals.css");
    const theme = await read("site/styles/vendor/hraness-paper/paper-theme.css");
    const layout = await read("site/app/layout.tsx");

    expect(css).toContain('@import "@hraness/design-kit/styles.css"');
    expect(css).toContain('overflow-x: clip');
    expect(css).toContain('a:focus-visible {\n  outline: 2px solid var(--hraness-site-accent)');
    expect(css).toContain('@media (pointer: coarse)');
    expect(css).toContain('min-height: 3rem');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@import "../styles/vendor/hraness-paper/paper-theme.css"');
    expect(layout).toContain('data-hraness-theme="paper"');
    expect(theme).toContain('color-scheme: light dark');
    expect(theme).toContain('--background: light-dark(');
    expect(css).toContain('font-family: var(--font-text)');
    expect(css).not.toMatch(/Georgia|Times New Roman/u);
  });
});
