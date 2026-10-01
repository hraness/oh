/**
 * Oh's product mockups: the research trail as linked records, the oh CLI
 * reading and checking it, and the split between what an agent may do and
 * what only the application's own code may do.
 *
 * Server-safe plain React built on @hraness/design-kit/mockups, so the site,
 * the launch post and the launch film (video/) render the same components.
 * Every key, value and command line comes from ./fixtures, which
 * tests/launch-mockups.test.ts replays against the real CLI.
 */
import { AgentSession, MacWindow, MockupGlyph, SampleText, TerminalFrame, type AgentTurn, type MockupTheme, type TerminalLine } from "@hraness/design-kit/mockups";

import { launchFacts } from "../launch/facts";
import { displayCommand, researchTrail, trailRuns, type TrailRecord, type TrailRunId } from "./fixtures";

/* ------------------------------------------------------------------ */
/* Trail map                                                           */
/* ------------------------------------------------------------------ */

/** Which part of the trail a map lights up. */
export type TrailFocus = "all" | "answer" | "source" | "claim";

/** The path from the answer back to the report it rests on. */
const SOURCE_PATH = ["view:review-brief", "evidence:table-2", "edition:trial-report-v1", "entity:trial-report"] as const;

export const TRAIL_FOCUS: Readonly<Record<TrailFocus, readonly string[]>> = {
  all: researchTrail.map((record) => record.key),
  answer: ["view:review-brief", "inquiry:primary-endpoint"],
  source: SOURCE_PATH,
  claim: ["evidence:table-2", "assertion:endpoint-12-weeks", "statement:endpoint-12-weeks"],
};

/**
 * Where each record sits: the answer-to-source path runs down the first
 * column, and the question and the claim sit beside the records that use them.
 */
const PLACES: Readonly<Record<string, Readonly<{ column: 1 | 2; row: 1 | 2 | 3 | 4 }>>> = {
  "view:review-brief": { column: 1, row: 1 },
  "inquiry:primary-endpoint": { column: 2, row: 1 },
  "evidence:table-2": { column: 1, row: 2 },
  "assertion:endpoint-12-weeks": { column: 2, row: 2 },
  "edition:trial-report-v1": { column: 1, row: 3 },
  "statement:endpoint-12-weeks": { column: 2, row: 3 },
  "entity:trial-report": { column: 1, row: 4 },
};

/** The one value line a card shows. */
function summary(record: TrailRecord): string {
  const value = record.value;
  return value.answer ?? value.question ?? value.locator ?? value.stance ?? value.captured ?? value.text ?? value.title ?? "";
}

function TrailCard({ lit, record }: Readonly<{ record: TrailRecord; lit: boolean }>) {
  const place = PLACES[record.key];
  if (place === undefined) throw new RangeError(`No place for ${record.key}.`);
  const edges = record.dependsOn.map((key) => {
    const to = PLACES[key];
    if (to === undefined) throw new RangeError(`No place for ${key}.`);
    return to.column === place.column ? "down" : "across";
  });
  return (
    <li
      className="oh-trail-card"
      data-film={`node-${record.kind}`}
      data-lit={lit ? "" : undefined}
      data-link-across={edges.includes("across") ? "" : undefined}
      data-link-down={edges.includes("down") ? "" : undefined}
      style={{ gridColumn: place.column, gridRow: place.row }}
    >
      <span className="oh-trail-role">{record.role}</span>
      <span className="oh-trail-key"><SampleText>{record.key}</SampleText></span>
      <span className="oh-trail-value"><SampleText>{summary(record)}</SampleText></span>
    </li>
  );
}

/**
 * The seven records of the example review, laid out as the trail an answer
 * rests on. `focus` lights the records one question is about.
 */
export function TrailMap({
  describe,
  focus = "all",
  theme,
  title = "Review brief · research.db",
}: Readonly<{ focus?: TrailFocus; describe?: string; theme?: MockupTheme; title?: string }>) {
  const lit = new Set(TRAIL_FOCUS[focus]);
  return (
    <MacWindow
      className="oh-mockup oh-trail"
      describe={describe ?? "Illustration: seven linked records. The review brief answers a question and links to the table 2 citation, which links to the copy of the trial report that was read and to the accepted claim."}
      theme={theme}
      title={title}
      toolbar={<MockupGlyph name="search" size={14} />}
    >
      <ol className="oh-trail-grid" data-focus={focus} data-film="trail">
        {researchTrail.map((record) => <TrailCard key={record.key} lit={lit.has(record.key)} record={record} />)}
      </ol>
    </MacWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

/** The terminal lines for a run of fixture commands, each tagged with its run id for a film or step-through. */
export function trailLines(runs: readonly TrailRunId[]): TerminalLine[] {
  return runs.flatMap((id) => {
    const run = trailRuns[id];
    const command = displayCommand(run.args).split("\n");
    return [
      // A continuation line has no prompt of its own.
      ...command.map((text, index) => (index === 0
        ? { kind: "input" as const, text, beat: id }
        : { kind: "output" as const, text, beat: id })),
      ...run.output.map((text) => ({
        kind: "output" as const,
        text,
        beat: id,
        ...(text.startsWith("✓") ? { tone: "ok" as const } : text.startsWith("Next:") || text.startsWith("Depends on:") ? { tone: "muted" as const } : {}),
      })),
    ];
  });
}

/** The oh CLI running fixture commands against the example database. */
export function TrailTerminal({
  density,
  describe,
  runs,
  theme,
}: Readonly<{ runs: readonly TrailRunId[]; describe: string; theme?: MockupTheme; density?: "presentation" }>) {
  return (
    <div className="oh-mockup oh-mock-terminal" data-film="terminal">
      <TerminalFrame density={density} describe={describe} lines={trailLines(runs)} theme={theme} title="research: oh" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agent and host                                                      */
/* ------------------------------------------------------------------ */

/** How far the agent-and-host example has gone. */
export type ReviewStage = "nominated" | "adopted";

/** The record the agent proposes, from the working-memory guide. */
export const NOMINATED_ROOT = "edition:reviewed-summary";
export const NOMINATION_ROUTE = "knowledge-review";

/** The four methods the agent's object has, in the order the memory guide lists them. */
export const AGENT_METHODS = ["remember", "query", "explain", "nominate"] as const;

const agentTurns: readonly AgentTurn[] = [
  { role: "user", text: "Keep what table 2 says, and put it up for review." },
  { role: "tool", tool: "memory.agent.remember", text: `Saved ${NOMINATED_ROOT} to working memory`, status: "ok" },
  { role: "tool", tool: "memory.agent.nominate", text: `Proposed ${NOMINATED_ROOT} on the ${NOMINATION_ROUTE} route`, status: "ok" },
  { role: "agent", text: "I proposed the summary. I can’t add it to reviewed knowledge myself; your app decides." },
];

/**
 * The agent's session beside the host application's review queue. The agent
 * can only propose; the host's code adopts.
 */
export function AgentHostSplit({ stage = "nominated", theme }: Readonly<{ stage?: ReviewStage; theme?: MockupTheme }>) {
  const adopted = stage === "adopted";
  return (
    <div className="oh-mockup oh-split" data-stage={stage}>
      <div className="oh-split-agent" data-film="agent">
        <AgentSession
          agent="generic-cli"
          describe="Illustration: a coding agent saves a summary to working memory and proposes it for review. It says it cannot add it to reviewed knowledge itself."
          theme={theme}
          title="Agent · working memory"
          turns={agentTurns}
        />
      </div>
      <div className="oh-split-host" data-film="host">
        <MacWindow
          describe={adopted
            ? "Illustration: the application's review queue. Code the application owns adopted the proposed summary into reviewed knowledge."
            : "Illustration: the application's review queue holds the agent's proposal, waiting for code the application owns to adopt it."}
          theme={theme}
          title="Your app · reviewed knowledge"
        >
          <div className="oh-review">
            <p className="oh-review-label">Agent can call</p>
            <ul className="oh-review-methods">
              {AGENT_METHODS.map((method) => <li key={method}><code>{method}</code></li>)}
            </ul>
            <p className="oh-review-label">Waiting for review</p>
            <div className="oh-review-item" data-film="proposal" data-state={stage}>
              <span className="oh-trail-key"><SampleText>{NOMINATED_ROOT}</SampleText></span>
              <span className="oh-review-route"><SampleText>{`Route: ${NOMINATION_ROUTE}`}</SampleText></span>
              <span className="oh-review-status" data-film="adopt">
                {adopted ? <><MockupGlyph name="check" size={13} /> Adopted by your code</> : "Only your code can adopt"}
              </span>
            </div>
            <p className="oh-review-code"><code>memory.host.adoptNomination(…)</code></p>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Proof panels                                                        */
/* ------------------------------------------------------------------ */

export type ProofView = "parity" | "limits";

/** The parity suite's counts, from the launch facts the tests pin to src/canonical-rust-parity.test.ts. */
const PARITY_ROWS = [
  { value: launchFacts.parityDocuments.value, label: "generated documents, same bytes" },
  { value: launchFacts.parityDocuments.value, label: "generated documents, same digest" },
  { value: launchFacts.parityNumbers.value, label: "generated numbers, same text" },
] as const;

/** What oh verify establishes, and what it does not, from the README's limits. */
const CHECKS = [
  { checked: true, text: "Every record still matches its digest" },
  { checked: true, text: "The log replays to the same state" },
  { checked: false, text: "Whether a claim is true" },
  { checked: false, text: "Whether retrieval beats other memory tools" },
] as const;

/** A code-built panel for the two beats a terminal cannot show on its own. */
export function ProofPanel({ view, theme }: Readonly<{ view: ProofView; theme?: MockupTheme }>) {
  if (view === "parity") {
    return (
      <MacWindow
        className="oh-mockup oh-proof"
        describe="Illustration: the Rust encoder's parity test. Generated documents and numbers must encode to the same bytes and digests as the TypeScript reference."
        theme={theme}
        title="canonical-rust-parity.test.ts"
      >
        <div className="oh-proof-body" data-view="parity">
          <p className="oh-proof-pair"><span>TypeScript reference</span><span aria-hidden="true">=</span><span>Rust, compiled to WebAssembly</span></p>
          <ul className="oh-proof-rows">
            {PARITY_ROWS.map((row) => (
              <li key={row.label}><strong>{row.value}</strong><span>{row.label}</span><MockupGlyph name="check" size={14} /></li>
            ))}
          </ul>
        </div>
      </MacWindow>
    );
  }
  return (
    <MacWindow
      className="oh-mockup oh-proof"
      describe="Illustration: what oh verify checks, records and their history, beside what it does not check, whether a claim is true or whether retrieval beats other tools."
      theme={theme}
      title="What oh verify checks"
    >
      <div className="oh-proof-body" data-view="limits">
        <ul className="oh-proof-rows">
          {CHECKS.map((row) => (
            <li data-checked={row.checked ? "" : undefined} key={row.text}>
              <span className="oh-proof-mark">{row.checked ? "Checked" : "Not checked"}</span>
              <span>{row.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </MacWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/** Every surface a launch beat can name, with the states it takes. */
export const OH_SURFACES = {
  "trail-map": { states: ["all", "answer", "source", "claim"] },
  "trail-terminal": { states: ["search", "trace", "verify"] },
  "agent-host": { states: ["nominated", "adopted"] },
  proof: { states: ["parity", "limits"] },
} as const;
export type OhSurfaceId = keyof typeof OH_SURFACES;

/** Terminal runs for each terminal state. */
export const TERMINAL_STATES: Readonly<Record<(typeof OH_SURFACES)["trail-terminal"]["states"][number], readonly TrailRunId[]>> = {
  search: ["search", "getAnswer"],
  trace: ["getAnswer", "getEvidence"],
  verify: ["saveAnswer", "verify"],
};

const TERMINAL_DESCRIPTIONS: Readonly<Record<keyof typeof TERMINAL_STATES, string>> = {
  search: "Illustration: the oh CLI finds the question by keyword, then prints the review brief, its answer, and the two records it depends on.",
  trace: "Illustration: the oh CLI prints the review brief, then the table 2 citation it depends on, with the copy of the report and the accepted claim behind it.",
  verify: "Illustration: the oh CLI saves the review brief, then replays the log and reports that every record and change reproduces the same state.",
};

function isState<S extends string>(states: readonly S[], value: string | undefined): value is S {
  return value !== undefined && (states as readonly string[]).includes(value);
}

/** Renders one registered surface in one state; throws on anything unregistered. */
export function OhSurface({ id, state, theme }: Readonly<{ id: string; state?: string; theme?: MockupTheme }>) {
  switch (id) {
    case "trail-map": {
      const focus = isState(OH_SURFACES["trail-map"].states, state) ? state : "all";
      return <TrailMap focus={focus} theme={theme} />;
    }
    case "trail-terminal": {
      if (!isState(OH_SURFACES["trail-terminal"].states, state)) throw new RangeError(`trail-terminal has no state ${String(state)}.`);
      return <TrailTerminal describe={TERMINAL_DESCRIPTIONS[state]} runs={TERMINAL_STATES[state]} theme={theme} />;
    }
    case "agent-host": {
      const stage = isState(OH_SURFACES["agent-host"].states, state) ? state : "nominated";
      return <AgentHostSplit stage={stage} theme={theme} />;
    }
    case "proof": {
      if (!isState(OH_SURFACES.proof.states, state)) throw new RangeError(`proof has no state ${String(state)}.`);
      return <ProofPanel theme={theme} view={state} />;
    }
    default:
      throw new RangeError(`No Oh surface ${id}.`);
  }
}
