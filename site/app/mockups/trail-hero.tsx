import { trailRecord } from "./fixtures";
import { TrailMap, TrailTerminal } from "./trail";

/** The hero proof: the review brief's record cards beside the CLI reading the citation under them. */
export function TrailHero() {
  return (
    <div className="oh-trail-stage">
      <TrailMap
        displaySummaries={{
          "inquiry:primary-endpoint": "When was the endpoint measured?",
          "statement:endpoint-12-weeks": `Measured at ${trailRecord("view:review-brief").value.answer ?? ""}`,
        }}
        focus="source"
      />
      <TrailTerminal
        describe="Illustration: the oh CLI opens the table 2 citation with links to the claim and the saved copy of the report, then replays the log and reports that every record and change reproduces the same state."
        runs={["getEvidence", "verify"]}
      />
    </div>
  );
}
