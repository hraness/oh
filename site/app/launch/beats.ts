import {
  assertLaunchKit,
  buildSocialKit,
  resolveLaunchBeats,
  type LaunchBeat,
  type LaunchKitOptions,
  type LaunchMessaging,
  type LaunchRelease,
  type SocialKit,
} from "@hraness/design-kit/launch";

import { marketing } from "../../portfolio-copy";
import { homeDescription } from "../metadata-copy";
import { LAUNCH_STATUS, launchFacts } from "./facts";

/**
 * The beats of "Introducing Oh". Each one is a short section on the page and
 * one post in the launch threads, so each must read on its own. Numbers are
 * {placeholders} filled from ./facts; the design kit rejects a beat that types
 * a digit. Mockup visuals name a surface and state in ../mockups/trail.tsx;
 * clip visuals name an act of the launch film in video/.
 */
const authoredBeats: readonly LaunchBeat[] = [
  {
    id: "what",
    part: "what",
    headline: "Oh is memory for AI agents that shows where each fact came from",
    post: "Oh is free, open-source memory for AI agents. Your agent saves what it learns as linked records, each tied to its source, so later you can see what it remembered and why.",
    visual: { kind: "mockup", id: "trail-map", state: { focus: "all" } },
    alt: "In this illustration, the question, source, claim, evidence and answer of one review, saved as linked records.",
  },
  {
    id: "trace",
    part: "does",
    headline: "Follow an answer back to the table it came from",
    post: "Say your agent read a trial report on Monday and tells you on Thursday the endpoint was measured at {exampleAnswer}. With Oh you can follow that answer to its citation, then to the exact copy of the report it read.",
    visual: { kind: "mockup", id: "trail-map", state: { focus: "source" } },
    alt: "In this illustration, the answer lights up a path to the citation, the copy of the report that was read, and the report.",
    facts: ["exampleAnswer"],
  },
  {
    id: "ask",
    part: "does",
    headline: "Look up a saved answer from the terminal",
    post: "The oh command finds a saved question by keyword and prints the answer with the records it rests on. It needs no account and no AI model. People get short text; add --json and your own scripts get the same answer as JSON.",
    visual: { kind: "mockup", id: "trail-terminal", state: { run: "search" } },
    alt: "In this illustration, the oh CLI finds a question by keyword and prints the saved answer and the records it depends on.",
  },
  {
    id: "propose",
    part: "does",
    headline: "Your agent can propose, and your app decides",
    post: "An agent using Oh can do {agentMethods} things: remember, look up, explain and propose. It can suggest a note for your reviewed knowledge, but only your app's own code can accept it.",
    visual: { kind: "mockup", id: "agent-host", state: { stage: "nominated" } },
    alt: "In this illustration, an agent proposes a summary for review and says it can't add it itself. The app's queue holds it.",
    facts: ["agentMethods"],
  },
  {
    id: "adopt",
    part: "does",
    headline: "Accepting a note never overwrites one quietly",
    post: "When your app accepts a proposal, new records go in and existing ones stay put. To replace a record, your code names the exact version it is replacing, up to {replacementLimit} at a time. Anything stale fails with nothing written.",
    visual: { kind: "mockup", id: "agent-host", state: { stage: "adopted" } },
    alt: "In this illustration, the app's review queue after its own code adopted the agent's proposed summary.",
    facts: ["replacementLimit"],
  },
  {
    id: "history",
    part: "how",
    headline: "One file on your computer, with a history you can replay",
    post: "By default Oh keeps everything in one SQLite file on your computer. Each accepted change joins a log, and oh verify replays that log to confirm every record still matches its history.",
    visual: { kind: "mockup", id: "trail-terminal", state: { run: "verify" } },
    alt: "In this illustration, the oh CLI saves an answer, then replays the log and reports that every record and change reproduces.",
  },
  {
    id: "who",
    part: "who",
    headline: "Built for developers whose agents get asked why",
    post: "Oh is for developers building agents and research tools where someone will later ask why the system believes something. If you only want to search your own Markdown notes, Oh is more than you need.",
    socialPost: "Oh is for developers building agents and research tools where someone will later ask why the system believes something.",
    visual: { kind: "mockup", id: "trail-map", state: { focus: "claim" } },
    alt: "In this illustration, a claim, the record accepting it, and the evidence behind it, lit as three separate records.",
  },
  {
    id: "rust",
    part: "vision",
    headline: "Keep the record format portable",
    post: "A shared byte format lets different implementations identify the same record. Oh keeps TypeScript as the reference and tests an optional Rust encoder against it, including encoded text, digests, and difficult number formats.",
    visual: { kind: "mockup", id: "proof", state: { view: "parity" } },
    alt: "Illustration of encoder comparisons across documents, digests, and number formats.",
    detailHref: "/blog/oh-rust-typescript-parity",
  },
  {
    id: "limits",
    part: "limits",
    headline: "Know what verification establishes",
    post: "Verification checks that records and their history are intact. Establishing a claim’s truth requires examining its evidence. Sync refuses conflicting copies so the application can resolve them explicitly.",
    visual: { kind: "mockup", id: "proof", state: { view: "limits" } },
    alt: "In this illustration, what oh verify checks (records and their history) next to what it does not (whether a claim is true).",
    detailHref: "/compare",
  },
  {
    id: "status",
    part: "status",
    headline: "Free and open source",
    post: "Oh is MIT licensed with no account needed. Follow the setup guide and run the first example to save a record, inspect its source, and verify its history.",
    socialPost: "{status}. Oh is MIT licensed with no account needed. Follow the setup guide and run the first example to save a record and verify its history.",
    facts: ["status"],
    visual: { kind: "mockup", id: "trail-map", state: { focus: "answer" } },
    alt: "In this illustration, the saved answer and the question it answers, the first two records of the example review.",
  },
];

export const launchBeats: readonly LaunchBeat[] = resolveLaunchBeats(authoredBeats, launchFacts);

export const LAUNCH_POST_URL = "https://oh.computer/blog/introducing-oh";

/** The product's messaging record, from the canonical portfolio copy. */
export const launchMessaging: LaunchMessaging = {
  names: { name: marketing.names.name },
  tagline: marketing.tagline,
  meta: homeDescription,
};

export const launchRelease: LaunchRelease = {
  status: LAUNCH_STATUS,
  tags: ["Developer Tools", "Open Source", "Artificial Intelligence"],
};

/** The release is public on npm and as an immutable GitHub Release. */
export const launchKitOptions: LaunchKitOptions = {
  status: LAUNCH_STATUS,
  publicInstall: true,
  tagline: launchMessaging.tagline,
  canonicalUrl: LAUNCH_POST_URL,
};

export const socialKit: SocialKit = buildSocialKit(launchBeats, launchMessaging, launchRelease, LAUNCH_POST_URL);
assertLaunchKit(launchBeats, socialKit, launchKitOptions);

/** What jungle's product-launch extractor reads to build the social sheet. */
export const launchKitInput = {
  beats: authoredBeats,
  facts: launchFacts,
  messaging: launchMessaging,
  release: launchRelease,
  canonicalUrl: LAUNCH_POST_URL,
  publicInstall: launchKitOptions.publicInstall,
} as const;
