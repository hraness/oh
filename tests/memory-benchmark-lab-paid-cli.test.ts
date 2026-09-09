import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, summarizeLabPaidScores } from "../scripts/benchmarks/lab-paid";
import type { LabPaidScoredCase } from "../scripts/benchmarks/lab-paid-plan";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256 } from "../scripts/benchmarks/gateway-study-transport-v6";

const digest = "a".repeat(64);
function row(questionId: string, groupId: string, variant: string, correct: 0 | 1, failed = false): LabPaidScoredCase {
  const identity = { ordinal: 0, questionId, corpusId: groupId, groupId, category: "synthetic", system: "bm25-window" as const,
    variant, readerJobKey: digest, readerRequestSha256: digest, readerResponseSha256: digest };
  return failed ? { ...identity, kind: "reader-failure", status: "terminal-reader-failure", policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256,
    reason: "output-token-limit", correct: 0, decisionSource: "reader-failure-policy" }
    : { ...identity, kind: "model", status: "completed", correct, decisionSource: "model", jobKey: digest,
      requestSha256: digest, ownerOrdinal: 0 };
}
const cases: readonly LabPaidScoredCase[] = [
  row("q1", "family-a", "baseline", 1), row("q1", "family-a", "candidate", 1),
  row("q2", "family-a", "baseline", 1), row("q2", "family-a", "candidate", 0, true),
  row("q3", "family-b", "baseline", 0), row("q3", "family-b", "candidate", 0),
];

describe("paid lab complete reporting and CLI admission", () => {
  test("terminal failures remain in complete paired accuracy and family bootstrap", () => {
    const result = summarizeLabPaidScores(cases, ["baseline", "candidate"]);
    expect(result.byVariant.baseline).toEqual({ questions: 3, correct: 2, accuracy: 2 / 3, readerFailures: 0 });
    expect(result.byVariant.candidate).toEqual({ questions: 3, correct: 1, accuracy: 1 / 3, readerFailures: 1 });
    expect(result.pairedDevelopmentBootstrap.candidate!.delta).toBe(-1 / 3);
    expect(result.pairedDevelopmentBootstrap.candidate!.clusters).toBe(2);
    expect(result.independentGroups).toBe(2);
  });
  test("incomplete, duplicated, foreign and mismatched-group matrices cannot produce scores", () => {
    expect(() => summarizeLabPaidScores(cases.slice(1), ["baseline", "candidate"])).toThrow("incomplete");
    expect(() => summarizeLabPaidScores([...cases.slice(1), cases[1]!], ["baseline", "candidate"])).toThrow("duplicate");
    expect(() => summarizeLabPaidScores(cases, ["baseline", "other"])).toThrow("incomplete");
    expect(() => summarizeLabPaidScores(cases.map((c, i) => i === 1 ? { ...c, groupId: "other" } : c), ["baseline", "candidate"])).toThrow("group drift");
    expect(() => summarizeLabPaidScores([], ["baseline", "candidate"])).toThrow("nonempty");
  });
  test("a single independent group produces no bootstrap interval", () => {
    expect(summarizeLabPaidScores(cases.slice(0, 4), ["baseline", "candidate"]).pairedDevelopmentBootstrap.candidate).toBeNull();
  });
  test("directories and dangling symlinks occupy every report path before admission", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oh-paid-cli-custody-"));
    try {
      let index = 0;
      for (const kind of ["directory", "dangling-link"]) for (const suffix of ["", ".started.json", ".judges.json"]) {
        const output = join(directory, `${index++}.json`), entry = output + suffix;
        if (kind === "directory") await mkdir(entry); else await symlink(join(directory, "missing"), entry);
        await expect(main(["run", "--output", output])).rejects.toThrow("output already occupied");
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test("run requires explicit paid admission and cannot silently accept preparation flags", async () => {
    const output = join(tmpdir(), `oh-paid-cli-preflight-${process.pid}-${Date.now()}.json`);
    await expect(main(["run", "--output", output])).rejects.toThrow("explicit --paid");
    await expect(main(["run", "--dataset", "locomo", "--output", output])).rejects.toThrow("does not apply");
    await expect(main(["prepare", "--paid", "--output", output])).rejects.toThrow("does not apply");
    await expect(main(["prepare", "--output", output])).rejects.toThrow("pinned budget input");
    expect(await Bun.file(output).exists()).toBe(false);
    expect(await Bun.file(output + ".started.json").exists()).toBe(false);
  });
});
