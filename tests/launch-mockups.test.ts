import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchFacts } from "../site/app/launch/facts.ts";
import { putArgs, researchTrail, trailRuns } from "../site/app/mockups/fixtures.ts";

const root = join(import.meta.dir, "..");

describe("launch mockup fixtures", () => {
  test("replay against a fresh database with the CLI and print exactly what the mockups show", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oh-launch-"));
    const run = async (args: readonly string[]) => {
      const child = Bun.spawn([process.execPath, join(root, "src/cli.ts"), ...args], {
        cwd: directory,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: directory,
          LANG: "en_US.UTF-8", HRANESS_AUDIENCE: "human", HRANESS_SUPPORT: "off", NO_COLOR: "1" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited,
        new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code).toBe(0);
      return (stdout + stderr).trimEnd();
    };
    try {
      await run(["init"]);
      const shown = new Set<string>([trailRuns.saveEvidence.args, trailRuns.saveQuestion.args, trailRuns.saveAnswer.args].map((args) => args.join("\u0000")));
      for (const record of researchTrail) {
        const args = putArgs(record);
        if (shown.has(args.join("\u0000"))) continue;
        await run(args);
      }
      for (const [id, entry] of Object.entries(trailRuns)) {
        const printed = await run(entry.args);
        expect({ id, printed }).toEqual({ id, printed: entry.output.join("\n") });
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("save every record after the records it depends on", () => {
    const seen = new Set<string>();
    for (const record of researchTrail) {
      for (const dependency of record.dependsOn) expect(seen.has(dependency)).toBe(true);
      expect(record.key.startsWith(`${record.kind}:`)).toBe(true);
      seen.add(record.key);
    }
    expect(seen.size).toBe(7);
  });
});

describe("launch facts", () => {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const numRuns = [...read("src/canonical-rust-parity.test.ts").matchAll(/numRuns: ([\d_]+)/g)].map((match) => Number(match[1]?.replaceAll("_", "")));
  const count = (value: string) => Number(value.replaceAll(",", ""));

  test("parity counts match the parity suite", () => {
    expect(numRuns).toEqual([count(launchFacts.parityDocuments.value), count(launchFacts.parityDocuments.value), count(launchFacts.parityNumbers.value)]);
  });

  test("the agent's methods match the memory specification", () => {
    expect(read("spec/v1/memory.md")).toContain(`The agent has only ${launchFacts.agentMethods.value} methods: \`remember\`, \`query\`, \`explain\`, and\n\`nominate\`.`);
  });

  test("the replacement limit matches the working-memory guide", () => {
    expect(read("docs/working-memory.md").replace(/\s+/g, " ")).toContain(`A list holds at most ${launchFacts.replacementLimit.value}`);
  });

  test("the Bun floor matches package.json and the example answer matches the fixture", () => {
    const pkg = JSON.parse(read("package.json")) as { engines: { bun: string } };
    expect(pkg.engines.bun).toBe(`>=${launchFacts.bunVersion.value}`);
    expect(launchFacts.exampleAnswer.value).toBe("12 weeks");
    expect(launchFacts.trailRecords.value).toBe(String(researchTrail.length));
  });

  test("the status comes from the published release record", () => {
    const release = JSON.parse(read("site/published-release.json")) as { version: string };
    expect(launchFacts.status.value).toBe(`Latest release: v${release.version}`);
  });
});
