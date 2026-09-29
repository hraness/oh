/**
 * The film's words. Numbers come from the site's launch facts, so the film,
 * the post and the social kit can never disagree; site/tests/launch.test.ts
 * checks that every beat the post embeds as a clip is an act here.
 */
import { launchFacts } from "../../site/app/launch/facts.ts";
import type { FilmCopy } from "./timeline.ts";

const count = (value: string) => Number(value.replaceAll(",", ""));

export const filmCopy: FilmCopy = {
  name: "Oh",
  promise: "Agent memory that shows its work.",
  url: "oh.computer",
  open: [
    "Your agent tells you something it learned days ago.",
    "Where did that come from?",
  ],
  steps: [
    {
      heading: "Save",
      body: "Your agent saves what it learns as linked records, each tied to its source.",
      focus: "trail",
      target: "node-view",
      highlight: "node-view",
      zoom: 1.2,
    },
    {
      heading: "Trace",
      body: "Follow an answer to its citation, then to the copy of the report it read.",
      focus: "trail",
      target: "node-edition",
      highlight: "node-evidence",
      zoom: 1.3,
    },
    {
      heading: "Check",
      body: "oh verify replays the history and confirms every record still matches.",
      focus: "terminal",
      target: "terminal",
      highlight: "terminal",
      zoom: 1.15,
    },
    {
      heading: "Propose",
      body: "Your agent can suggest a note. Only your app's own code can accept it.",
      focus: "host",
      target: "adopt",
      highlight: "proposal",
      after: "adopted",
      zoom: 1.35,
    },
  ],
  proof: {
    caption: "Rust and TypeScript must write the same bytes before anything moves.",
    items: [
      { value: count(launchFacts.parityDocuments.value), label: "generated documents" },
      { value: count(launchFacts.parityNumbers.value), label: "generated numbers" },
    ],
  },
  limits: {
    heading: "What Oh does not do",
    body: "It checks that records and history are intact, not whether a claim is true.",
  },
  end: { line: "Free and open source. MIT licensed." },
};
