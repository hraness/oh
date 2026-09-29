/**
 * The example research trail every Oh mockup, the launch post and the launch
 * film draw from. A fictional review of a fictional trial report: seven
 * records saved with the real `oh` CLI, and the exact output the CLI prints.
 *
 * tests/launch-mockups.test.ts saves `researchTrail` into a fresh database with the
 * CLI and fails when any output below differs from what the CLI prints, so
 * the illustrations never show a command or a line Oh does not produce.
 */

export type TrailRecord = Readonly<{
  kind: string;
  key: string;
  value: Readonly<Record<string, string>>;
  dependsOn: readonly string[];
  /** Plain name for the record's role in the trail. */
  role: string;
}>;

/** In the order they are saved; each record depends only on records above it. */
export const researchTrail: readonly TrailRecord[] = [
  {
    kind: "entity",
    key: "entity:trial-report",
    value: { title: "Trial report" },
    dependsOn: [],
    role: "The source",
  },
  {
    kind: "edition",
    key: "edition:trial-report-v1",
    value: { captured: "version 1", source: "entity:trial-report" },
    dependsOn: ["entity:trial-report"],
    role: "The copy that was read",
  },
  {
    kind: "statement",
    key: "statement:endpoint-12-weeks",
    value: { text: "The primary endpoint was measured at 12 weeks." },
    dependsOn: [],
    role: "The claim",
  },
  {
    kind: "assertion",
    key: "assertion:endpoint-12-weeks",
    value: { stance: "accepted", statement: "statement:endpoint-12-weeks" },
    dependsOn: ["statement:endpoint-12-weeks"],
    role: "Accepting the claim",
  },
  {
    kind: "evidence",
    key: "evidence:table-2",
    value: { source: "entity:trial-report", locator: "table 2", relationship: "supports" },
    dependsOn: ["edition:trial-report-v1", "assertion:endpoint-12-weeks"],
    role: "The evidence",
  },
  {
    kind: "inquiry",
    key: "inquiry:primary-endpoint",
    value: { question: "When was the primary endpoint measured?" },
    dependsOn: [],
    role: "The question",
  },
  {
    kind: "view",
    key: "view:review-brief",
    value: { answer: "12 weeks", title: "Review brief" },
    dependsOn: ["inquiry:primary-endpoint", "evidence:table-2"],
    role: "The answer",
  },
];

export type TrailKey = (typeof researchTrail)[number]["key"];

export function trailRecord(key: string): TrailRecord {
  const record = researchTrail.find((entry) => entry.key === key);
  if (record === undefined) throw new RangeError(`No trail record ${key}.`);
  return record;
}

/** The arguments that save one trail record, exactly as the CLI takes them. */
export function putArgs(record: TrailRecord): readonly string[] {
  return [
    "put", "--kind", record.kind, "--key", record.key,
    ...record.dependsOn.flatMap((key) => ["--depends-on", key]),
    "--value", JSON.stringify(record.value),
  ];
}

/** How a command reads at a prompt: JSON values in single quotes, one flag pair per line. */
export function displayCommand(args: readonly string[]): string {
  const quoted = args.map((arg) => (/^[\w:./-]+$/u.test(arg) ? arg : `'${arg}'`));
  const [verb, ...rest] = quoted;
  const parts: string[] = [`oh ${verb ?? ""}`];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg.startsWith("--") && index + 1 < rest.length && !rest[index + 1]!.startsWith("--")) {
      parts.push(`${arg} ${rest[index + 1]!}`);
      index += 1;
    } else parts.push(arg);
  }
  // Short commands stay on one line; long puts break per flag, as in the README.
  const single = parts.join(" ");
  return single.length <= 44 ? single : parts.join(" \\\n    ");
}

export type CommandRun = Readonly<{
  args: readonly string[];
  /** Lines the CLI prints, stdout then stderr, with the trailing newline removed. */
  output: readonly string[];
}>;

/**
 * Runs in this order once the records above the evidence are saved.
 * Generations count every save: the evidence is the fifth, the question the
 * sixth and the answer the seventh, matching the homepage hero transcript.
 */
export const trailRuns = {
  saveEvidence: {
    args: putArgs(trailRecord("evidence:table-2")),
    output: ["✓ Saved evidence:table-2 (generation 5).", "Next: oh get evidence:table-2"],
  },
  saveQuestion: {
    args: putArgs(trailRecord("inquiry:primary-endpoint")),
    output: ["✓ Saved inquiry:primary-endpoint (generation 6).", "Next: oh get inquiry:primary-endpoint"],
  },
  saveAnswer: {
    args: putArgs(trailRecord("view:review-brief")),
    output: ["✓ Saved view:review-brief (generation 7).", "Next: oh get view:review-brief"],
  },
  search: {
    args: ["search", "primary endpoint"],
    output: [
      "1.  inquiry:primary-endpoint     inquiry",
      "2.  statement:endpoint-12-weeks  statement",
      "3.  assertion:endpoint-12-weeks  assertion",
    ],
  },
  getAnswer: {
    args: ["get", "view:review-brief"],
    output: [
      "view:review-brief (view)",
      "{",
      '  "answer": "12 weeks",',
      '  "title": "Review brief"',
      "}",
      "Depends on: evidence:table-2, inquiry:primary-endpoint",
    ],
  },
  getEvidence: {
    args: ["get", "evidence:table-2"],
    output: [
      "evidence:table-2 (evidence)",
      "{",
      '  "locator": "table 2",',
      '  "relationship": "supports",',
      '  "source": "entity:trial-report"',
      "}",
      "Depends on: assertion:endpoint-12-weeks, edition:trial-report-v1",
    ],
  },
  verify: {
    args: ["verify"],
    output: ["✓ Store checked: 7 records and 7 changes replay to the same state (generation 7)."],
  },
} as const satisfies Record<string, CommandRun>;

export type TrailRunId = keyof typeof trailRuns;
