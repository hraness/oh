import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { changelogSection, renderReleaseNotes } from "../scripts/release-notes";

const root = resolve(import.meta.dir, "..");
const commitSha = "1".repeat(40);
const tarballSha256 = "a".repeat(64);

function changelog(section: string, heading = "## 1.2.3 - 2026-09-26"): string {
  return `# Changelog\n\nIntro text.\n\n${heading}\n\n${section}\n\n## 1.2.2\n\nOlder summary.\n\n- Older change.\n`;
}

const section = "Oh reads stores faster.\nIt also writes less.\n\n- `oh init` reuses an existing\n  store.\n- Searches stop after 50 results.";

describe("changelog sections", () => {
  test("accepts `## X.Y.Z` and `## vX.Y.Z` headings with an optional date", () => {
    for (const heading of ["## 1.2.3", "## v1.2.3", "## 1.2.3 - 2026-09-26", "## v1.2.3 - 2026-09-26"]) {
      expect(changelogSection(changelog(section, heading), "v1.2.3")).toEqual({
        changes: "- `oh init` reuses an existing store.\n- Searches stop after 50 results.",
        summary: "Oh reads stores faster. It also writes less.",
      });
    }
  });

  test("fails when the section is missing, duplicated, empty, or still unreleased", () => {
    expect(() => changelogSection(changelog(section), "v1.2.4")).toThrow("no section for 1.2.4");
    expect(() => changelogSection(changelog(section, "## 1.2.30"), "v1.2.3")).toThrow("no section");
    expect(() => changelogSection(changelog(section, "## 1.2.3 (Unreleased)"), "v1.2.3")).toThrow("no section");
    expect(() => changelogSection(`${changelog(section)}\n## 1.2.3\n\nAgain.\n\n- Again.\n`, "v1.2.3")).toThrow("more than one section");
    expect(() => changelogSection(changelog(""), "v1.2.3")).toThrow("is empty");
    expect(() => changelogSection(changelog("Unreleased.\n\n- Something."), "v1.2.3")).toThrow("Unreleased");
    expect(() => changelogSection(changelog("Summary only."), "v1.2.3")).toThrow("summary paragraph and a bulleted list");
    expect(() => changelogSection(changelog("- Changes only."), "v1.2.3")).toThrow("summary paragraph and a bulleted list");
    expect(() => changelogSection(changelog("Summary.\n\n- Change.\n\nTrailing text."), "v1.2.3")).toThrow("text after its bulleted list");
    expect(() => changelogSection(changelog("Summary.\n\n### Fixes\n\n- Change."), "v1.2.3")).toThrow("summary paragraph and a bulleted list");
    expect(() => changelogSection(changelog("Summary <!-- hidden -->.\n\n- Change."), "v1.2.3")).toThrow("HTML comments");
    expect(() => changelogSection(changelog(section), "1.2.3")).toThrow("stable semantic-version tag");
    expect(() => changelogSection(changelog(section), "v1.2.3-rc.1")).toThrow("stable semantic-version tag");
  });

  test("the repository changelog has a section for the current package version", async () => {
    const [text, manifest] = await Promise.all([
      readFile(join(root, "CHANGELOG.md"), "utf8"),
      readFile(join(root, "package.json"), "utf8"),
    ]);
    const { version } = JSON.parse(manifest) as { version: string };
    expect(() => changelogSection(text, `v${version}`)).not.toThrow();
  });
});

describe("rendered release notes", () => {
  const notes = renderReleaseNotes({ changelog: changelog(section), commitSha, tag: "v1.2.3", tarballSha256 });

  test("orders summary, Changes, Install, and Verify from the changelog and release record", () => {
    expect(notes.startsWith("Oh reads stores faster. It also writes less.\n\n## Changes\n\n- `oh init` reuses an existing store.\n")).toBe(true);
    const headings = [...notes.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
    expect(headings).toEqual(["Changes", "Install", "Verify"]);
    expect(notes).toContain("bun add --global https://github.com/hraness/oh/releases/download/v1.2.3/hraness-oh-1.2.3.tgz");
    expect(notes).toContain("bun add --global @hraness/oh@1.2.3");
    expect(notes).toContain(`\`${tarballSha256}\``);
    expect(notes).toContain(`https://github.com/hraness/oh/commit/${commitSha}`);
    expect(notes).toContain("https://github.com/hraness/oh/blob/v1.2.3/docs/publishing.md");
    expect(notes).not.toContain("latest");
    expect(notes).not.toContain("Older");
    expect(notes).not.toContain("<!--");
    expect(notes.endsWith("\n")).toBe(true);
  });

  test("requires the exact commit and tarball digest", () => {
    expect(() => renderReleaseNotes({ changelog: changelog(section), commitSha: "main", tag: "v1.2.3", tarballSha256 })).toThrow("source commit");
    expect(() => renderReleaseNotes({ changelog: changelog(section), commitSha, tag: "v1.2.3", tarballSha256: "abc" })).toThrow("SHA-256");
    expect(() => renderReleaseNotes({ changelog: changelog(section), commitSha, tag: "v9.9.9", tarballSha256 })).toThrow("no section");
  });
});
