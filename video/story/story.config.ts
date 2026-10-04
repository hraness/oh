/**
 * Oh's launch film: an agent's remembered answer with no source behind it, the
 * reveal, the README's example review traced from answer to evidence, the CLI
 * commands, what stays on your machine, and an end card that asks your agent
 * to install Oh. Records come from site/app/mockups/fixtures.ts; numbers and
 * status from site/app/launch/facts.ts.
 */
import { join } from "node:path";

import { launchFacts, LAUNCH_STATUS } from "../../site/app/launch/facts.ts";
import { researchTrail } from "../../site/app/mockups/fixtures.ts";
import { defineStory } from "./story.ts";
import palette from "./palette.json" with { type: "json" };

const repo = join(import.meta.dir, "../..");
const record = (key: string) => {
  const found = researchTrail.find((item) => item.key === key);
  if (!found) throw new Error(`Fixture has no ${key}`);
  return found.value as Record<string, string>;
};
const question = record("inquiry:primary-endpoint").question!;
const claim = record("statement:endpoint-12-weeks").text!;
const evidence = record("evidence:table-2");
const edition = record("edition:trial-report-v1");
const source = record("entity:trial-report").title!;

export default () => defineStory({
  id: "oh",
  brand: {
    wordmark: "Oh",
    mark: join(repo, "site/public/marks/oh-computer.svg"),
    markAspect: 702 / 696,
    // Read with site-palette.ts from https://oh.computer in dark mode; see palette.json.
    palette: { values: palette.palette },
    designKit: join(repo, "site/node_modules/@hraness/design-kit"),
  },
  acts: [
    { kind: "chat", headline: "Your agent remembers an answer but not where it came from.", accents: ["where"], exchanges: [
      { you: question, agent: `${launchFacts.exampleAnswer.value}, I think. I can't point you to the source.` },
    ] },
    { kind: "reveal", tagline: "Agent memory that shows its work." },
    {
      kind: "merge", headline: "Oh saves each answer with the evidence behind it.", accents: ["evidence"],
      sources: [
        { app: source, glyph: "R", color: "#83a598", lines: [edition.captured!, "The copy that was read"] },
        { app: "Evidence", glyph: "E", color: "#b8bb26", lines: [`${evidence.locator}, ${evidence.relationship}`, "the claim"] },
        { app: "Claim", glyph: "C", color: "#fabd2f", lines: [claim] },
      ],
      result: {
        title: launchFacts.exampleAnswer.value, subtitle: question, avatar: "✓",
        rows: [
          { label: "Claim", value: `${record("assertion:endpoint-12-weeks").stance}`, from: ["Claim"] },
          { label: "Evidence", value: `${source}, ${evidence.locator}`, from: ["Evidence"] },
          { label: "Read from", value: `${source}, ${edition.captured}`, from: [source] },
        ],
        footnote: `${launchFacts.trailRecords.value} linked records, from the README's example review`,
      },
    },
    {
      // The README's first task; the verify fields are from its --json output.
      kind: "terminal", headline: "Every change is logged, and oh verify replays the log to check it.", accents: ["replays"],
      title: "oh",
      lines: [
        { cmd: `oh put --kind entity --key entity:ada-lovelace --value '{"name":"Ada Lovelace","role":"mathematician"}'` },
        { out: "✓ Saved entity:ada-lovelace (generation 1).", tone: "ok" },
        { cmd: "oh verify" },
        { out: "operations 1 · records 1 · SQLite integrity ok", tone: "ok" },
      ],
    },
    {
      kind: "cards", headline: "It all stays in one file on your machine.", accents: ["one", "file"],
      items: [
        { tag: "Local", title: "Records and their history in one SQLite file" },
        { tag: "No account", title: "No account or hosted model needed" },
        { tag: "For agents", title: `A CLI, a TypeScript SDK and an Agent Skill` },
      ],
    },
  ],
  end: {
    lead: "Ask your agent:", prompt: "Install Oh from oh.computer",
    terms: `Free and MIT licensed · ${LAUNCH_STATUS}`, url: "oh.computer",
  },
  sampleLabel: "Example",
  formats: ["wide", "square", "portrait"],
});
