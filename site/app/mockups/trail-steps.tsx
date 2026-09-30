"use client";

import { StepThrough, type ThroughStep } from "@hraness/design-kit/mockups/client";

import { trailRecord } from "./fixtures";
import { TrailMap, TrailTerminal, TERMINAL_STATES, type TrailFocus } from "./trail";

type Step = Readonly<{ id: string; label: string; hint: string; focus: TrailFocus; runs: keyof typeof TERMINAL_STATES; describe: string }>;

/** Ask, trace and check: the homepage walk through the example review. */
export const TRAIL_STEPS: readonly Step[] = [
  {
    id: "ask",
    label: "Ask",
    hint: `Keyword search finds the question, and the review brief answers it: ${trailRecord("view:review-brief").value.answer ?? ""}.`,
    focus: "answer",
    runs: "search",
    describe: "Illustration: the oh CLI finds the saved question and prints the review brief that answers it.",
  },
  {
    id: "trace",
    label: "Trace",
    hint: "The brief depends on the table 2 citation, which points at the copy of the report the agent read.",
    focus: "source",
    runs: "trace",
    describe: "Illustration: the oh CLI prints the review brief and the table 2 citation it depends on.",
  },
  {
    id: "check",
    label: "Check",
    hint: "oh verify replays every change and confirms the history still matches the records.",
    focus: "all",
    runs: "verify",
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
        <TrailMap focus={step.focus} />
        <TrailTerminal describe={step.describe} runs={TERMINAL_STATES[step.runs]} />
      </div>
    ),
  }));
  return (
    <StepThrough
      caption="Illustration of an example review of a fictional trial report. The commands and output are what the oh CLI prints for these records."
      label="From answer to source"
      minWidth={620}
      steps={steps}
    />
  );
}
