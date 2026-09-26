import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { publicPackageName, publicRepository, releaseArchiveName } from "./release-policy";

const STABLE_TAG = /^v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/u;
const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAXIMUM_CHANGELOG_BYTES = 1_024 * 1_024;
const MAXIMUM_SECTION_BYTES = 16 * 1_024;
export const MAXIMUM_RELEASE_NOTES_BYTES = 32 * 1_024;
const VERIFY_GUIDE_PATH = "docs/publishing.md";

export type ChangelogSection = Readonly<{
  changes: string;
  summary: string;
}>;

function stableVersion(tag: string): string {
  const match = STABLE_TAG.exec(tag);
  if (match === null) throw new Error(`Release tag ${tag} is not one stable semantic-version tag.`);
  return match[1] as string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Returns the summary and bulleted changes from the `## X.Y.Z` or `## vX.Y.Z`
 * section of CHANGELOG.md, with an optional ` - YYYY-MM-DD` date. Fails when
 * the section is missing, duplicated, empty, still says Unreleased, or lacks a
 * summary paragraph followed by a bulleted list.
 */
export function changelogSection(changelog: string, tag: string): ChangelogSection {
  const version = stableVersion(tag);
  if (Buffer.byteLength(changelog, "utf8") > MAXIMUM_CHANGELOG_BYTES) {
    throw new Error("CHANGELOG.md is outside its byte bound.");
  }
  const text = changelog.replace(/\r\n/gu, "\n");
  const lines = text.split("\n");
  const heading = new RegExp(`^## v?${escapeRegExp(version)}(?: - [0-9]{4}-[0-9]{2}-[0-9]{2})?$`, "u");
  const starts = lines.flatMap((line, index) => heading.test(line) ? [index] : []);
  if (starts.length === 0) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  if (starts.length > 1) throw new Error(`CHANGELOG.md has more than one section for ${version}.`);
  const start = starts[0] as number;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2} /u.test(lines[index] as string)) {
      end = index;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").trim();
  if (body.length === 0) throw new Error(`CHANGELOG.md section ${version} is empty.`);
  if (/\bunreleased\b/iu.test(body)) throw new Error(`CHANGELOG.md section ${version} still says Unreleased.`);
  if (Buffer.byteLength(body, "utf8") > MAXIMUM_SECTION_BYTES) {
    throw new Error(`CHANGELOG.md section ${version} is outside its byte bound.`);
  }
  if (body.includes("<!--") || body.includes("-->")) {
    throw new Error(`CHANGELOG.md section ${version} must not contain HTML comments.`);
  }
  const bodyLines = body.split("\n");
  const firstBullet = bodyLines.findIndex((line) => line.startsWith("- "));
  if (firstBullet <= 0) {
    throw new Error(`CHANGELOG.md section ${version} needs a summary paragraph and a bulleted list of changes.`);
  }
  const summary = bodyLines.slice(0, firstBullet).join("\n").trim();
  const changes = bodyLines.slice(firstBullet).join("\n").trim();
  if (summary.length === 0 || /^#/mu.test(summary) || /^#/mu.test(changes)) {
    throw new Error(`CHANGELOG.md section ${version} needs a summary paragraph and a bulleted list of changes.`);
  }
  for (const line of changes.split("\n")) {
    if (line.length > 0 && !line.startsWith("- ") && !line.startsWith("  ")) {
      throw new Error(`CHANGELOG.md section ${version} has text after its bulleted list.`);
    }
  }
  return Object.freeze({ changes: unwrapBullets(changes), summary: unwrapParagraphs(summary) });
}

// GitHub renders a single newline in release notes as a line break, so the
// hard-wrapped changelog text is joined into one line per paragraph or bullet.
function unwrapParagraphs(text: string): string {
  return text.split(/\n{2,}/u).map((paragraph) => paragraph.split("\n").map((line) => line.trim()).join(" ")).join("\n\n");
}

function unwrapBullets(text: string): string {
  const bullets: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith("- ")) bullets.push(line.trimEnd());
    else bullets[bullets.length - 1] = `${bullets[bullets.length - 1] as string} ${line.trim()}`;
  }
  return bullets.join("\n");
}

export type ReleaseNotesInput = Readonly<{
  changelog: string;
  commitSha: string;
  tag: string;
  tarballSha256: string;
}>;

/**
 * Renders the visible part of the release page: the changelog summary and
 * changes, then Install and Verify generated from the release record. The
 * identity record follows these notes as the final bytes of the body.
 */
export function renderReleaseNotes(input: ReleaseNotesInput): string {
  const version = stableVersion(input.tag);
  if (!SHA.test(input.commitSha)) throw new Error("Release notes require the exact source commit.");
  if (!SHA256.test(input.tarballSha256)) throw new Error("Release notes require the exact tarball SHA-256.");
  const section = changelogSection(input.changelog, input.tag);
  const archive = releaseArchiveName(version);
  const download = `https://github.com/${publicRepository}/releases/download/${input.tag}`;
  const notes = [
    section.summary,
    "",
    "## Changes",
    "",
    section.changes,
    "",
    "## Install",
    "",
    "Install this version from the file attached to this release. Oh needs Bun 1.3.14 or newer.",
    "",
    "```sh",
    `bun add --global ${download}/${archive}`,
    "```",
    "",
    "The same bytes are on npm:",
    "",
    "```sh",
    `bun add --global ${publicPackageName}@${version}`,
    "```",
    "",
    "## Verify",
    "",
    `\`SHA256SUMS\`, attached to this release, lists the SHA-256 of \`${archive}\`: \`${input.tarballSha256}\`. Check a download with:`,
    "",
    "```sh",
    "shasum -a 256 -c SHA256SUMS",
    "```",
    "",
    `Built from commit [\`${input.commitSha}\`](https://github.com/${publicRepository}/commit/${input.commitSha}). The [publishing guide](https://github.com/${publicRepository}/blob/${input.tag}/${VERIFY_GUIDE_PATH}) describes how the release workflow builds, checks, and publishes these files with npm provenance.`,
    "",
  ].join("\n");
  if (Buffer.byteLength(notes, "utf8") > MAXIMUM_RELEASE_NOTES_BYTES) {
    throw new Error("Rendered release notes are outside their byte bound.");
  }
  return notes;
}

export function readChangelog(root = resolve(import.meta.dir, "..")): string {
  return readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
}

if (import.meta.main) {
  const [command, tag, extra] = process.argv.slice(2);
  if (command !== "check" || tag === undefined || extra !== undefined) {
    throw new Error("Usage: release-notes.ts check TAG");
  }
  changelogSection(readChangelog(), tag);
  console.log(`CHANGELOG.md has a release section for ${tag}.`);
}
