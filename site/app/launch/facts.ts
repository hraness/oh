import type { LaunchFacts, LaunchStatus } from "@hraness/design-kit/launch";

import publishedRelease from "../../published-release.json";
import { researchTrail } from "../mockups/fixtures";

/**
 * Every number the launch post, its social kit and its film captions use,
 * each typed once with the record it comes from. tests/launch-mockups.test.ts
 * reads those records and fails when a value here drifts from them.
 */
export const LAUNCH_STATUS = `Latest release: v${publishedRelease.version}` as LaunchStatus;

export const launchFacts = {
  trailRecords: {
    value: String(researchTrail.length),
    source: "site/app/mockups/fixtures.ts researchTrail, the README's example review, replayed against the CLI by tests/launch-mockups.test.ts",
  },
  exampleAnswer: {
    value: researchTrail.find((record) => record.key === "view:review-brief")?.value.answer ?? "",
    source: "site/app/mockups/fixtures.ts view:review-brief, the answer the example review saves",
  },
  agentMethods: {
    value: "four",
    source: "spec/v1/memory.md and src/memory-core.ts OhMemoryAgentV2: remember, query, explain and nominate (site/app/mockups/trail.tsx AGENT_METHODS)",
  },
  replacementLimit: {
    value: "128",
    source: "docs/working-memory.md, Adopt a nomination: a list holds at most 128 replacements",
  },
  parityNumbers: {
    value: "20,000",
    source: "src/canonical-rust-parity.test.ts numRuns: 20_000 generated finite numbers formatted by both encoders",
  },
  parityDocuments: {
    value: "1,000",
    source: "src/canonical-rust-parity.test.ts numRuns: 1000 generated documents, for the encoding and again for the digest",
  },
  bunVersion: {
    value: "1.3.14",
    source: "package.json engines.bun >=1.3.14 and the README install section",
  },
  status: {
    value: LAUNCH_STATUS,
    source: "site/published-release.json version, the verified public release the README installs",
  },
} as const satisfies LaunchFacts;

export type LaunchFactKey = keyof typeof launchFacts;
