"use client";

import { StepThrough, type ThroughStep } from "@hraness/design-kit/mockups/client";

import { trailRecord, type TrailRunId } from "./fixtures";
import { TrailMap, TrailTerminal, type TrailFocus } from "./trail";

type Step = Readonly<{ id: string; label: string; hint: string; focus: TrailFocus; runs: readonly TrailRunId[]; describe: string }>;

/** Ask, trace and check: the homepage walk through the example review. */
export const TRAIL_STEPS: readonly Step[] = [
  {
    id: "ask",
    label: "Ask",
    hint: `Read the saved review brief: ${trailRecord("view:review-brief").value.answer ?? ""}.`,
    focus: "answer",
    runs: ["getAnswer"],
    describe: "Illustration: the oh CLI opens the saved review brief, its answer, and the records it depends on.",
  },
  {
    id: "trace",
    label: "Trace",
    hint: "The table 2 citation points at the copy of the report the agent read.",
    focus: "source",
    runs: ["getEvidence"],
    describe: "Illustration: the oh CLI opens the table 2 citation, with links to the claim and the saved copy of the report.",
  },
  {
    id: "check",
    label: "Check",
    hint: "oh verify replays every change and confirms the history still matches the records.",
    focus: "all",
    runs: ["verify"],
    describe: "Illustration: the oh CLI replays the log and reports that every record and change reproduces the same state.",
  },
];

export function TrailSteps() {
  const steps: ThroughStep[] = TRAIL_STEPS.map((step) => ({
    id: step.id,
    label: step.label,
    hint: step.hint,
    render: () => (
      <div className="oh-steps-stage">
        <TrailMap
          displaySummaries={{
            "inquiry:primary-endpoint": "When was the endpoint measured?",
            "statement:endpoint-12-weeks": `Measured at ${trailRecord("view:review-brief").value.answer ?? ""}`,
          }}
          focus={step.focus}
        />
        <TrailTerminal density="presentation" describe={step.describe} runs={step.runs} />
      </div>
    ),
  }));
  return (
    <StepThrough
      fit="fill"
      label="From answer to source"
      steps={steps}
    />
  );
}
