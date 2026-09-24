import type { ArticleAdmission } from "@hraness/design-kit";

// Review records for every article URL on oh.computer. The review was an
// independent, disclosed AI editorial review; `humanReview` stays null until a
// person reviews a post. `assertArticleAdmissions()` checks this list in tests.

const oh = (commit: string, path: string) => `https://github.com/hraness/oh/blob/${commit}/${path}`;
const wordcell = (path: string) =>
  `https://github.com/hraness/wordcell/blob/7b6cb5e0d24a3f627e17f7d1bd699a52ab4c9d10/${path}`;
const ohReviewed = "73da154e7d16d6d3883b85110eaad30381df7a54";
const ohCurrent = "da5f8bcb86af35ba2f97e8c1ad4e0f7ff865b3b7";

const review = {
  reviewer: "Claude Opus 5.5 (claude-opus-5-5) editorial review",
  reviewerType: "ai",
  reviewedOn: "2026-09-24",
} as const;

export const articleAdmissions = [
  {
    href: "/blog/introducing-oh",
    lifecycle: "indexable",
    readerJob: "Decide whether Oh fits as the memory layer for an agent or knowledge application, and see how to start.",
    nonObviousAnswer:
      "Oh gives the agent and the host application two different objects: the agent can only remember, query, explain and nominate, and only host code can adopt a nomination into reviewed knowledge, with the actor and timestamp supplied by the host.",
    originalContribution:
      "Checks the agent and host split, the parity generator's shape, and each consumer's pinned release against the source, which the README does not state together.",
    hostFit: "The product introduction for Oh on Oh's own site.",
    nearestUrls: [
      {
        url: "https://oh.computer/",
        distinction: "The homepage lists features and install steps; this post explains why Oh exists, who it is for, and its limits.",
      },
      {
        url: "https://github.com/hraness/oh#readme",
        distinction: "The README is the task reference; this post is a single reading for someone deciding whether to use Oh.",
      },
    ],
    sources: [
      { title: "Oh README", url: oh(ohReviewed, "README.md"), checkedOn: "2026-09-24" },
      { title: "Oh memory specification", url: oh(ohReviewed, "spec/v1/memory.md"), checkedOn: "2026-09-24" },
      { title: "Oh release record", url: oh(ohReviewed, "site/published-release.json"), checkedOn: "2026-09-24" },
      { title: "Oh v0.12.0 GitHub Release", url: "https://github.com/hraness/oh/releases/tag/v0.12.0", checkedOn: "2026-09-24" },
      { title: "Rust foundations plan", url: oh(ohReviewed, "plans/rust-foundations.md"), checkedOn: "2026-09-24" },
      { title: "Rust canonical JSON crate", url: oh(ohReviewed, "rust/oh-canonical/src/lib.rs"), checkedOn: "2026-09-24" },
      {
        title: "TypeScript and Rust canonical JSON parity tests",
        url: oh(ohReviewed, "src/canonical-rust-parity.test.ts"),
        checkedOn: "2026-09-24",
      },
      { title: "Wordcell graph queries over Oh", url: wordcell("docs/graph-authority.md"), checkedOn: "2026-09-24" },
    ],
    observations: [
      "The Rust parity tests draw all 2,000 generated documents from one fixed-shape fast-check generator plus hand-written edge cases, so byte-for-byte agreement is sampled, not proven; the README alone does not say this.",
      "The two products that build on Oh pin different Oh releases, and Wordcell's search never calls Oh's memory retrieval, so each product uses a different part of Oh.",
    ],
    scores: {
      readerUtility: 2,
      originalEvidence: 1,
      factualConfidence: 2,
      hostFit: 2,
      voiceIntegrity: 2,
      maintenanceValue: 1,
    },
    owner: "hraness/oh maintainers",
    drafting: "ai-from-source",
    review,
    humanReview: null,
    reassessOn: "2026-11-05",
    harmIfWrong:
      "A developer could trust the agent and host split or the Rust parity further than the code supports and build a memory layer on a wrong assumption.",
    refreshTriggers: [
      "Version bump in site/published-release.json",
      "Change to the agent and host memory interface in spec/v1/memory.md or the SDK",
      "Change to the parity test sample counts or generator shape",
      "Change to either consumer's use of Oh or its pinned Oh version",
      "Change to README runtime requirements (Bun, Node, libSQL) or first-run commands",
      "A published retrieval benchmark that changes the README comparison statement",
    ],
  },
  {
    href: "/blog/oh-rust-typescript-parity",
    lifecycle: "indexable",
    readerJob:
      "Decide whether a digest from Oh's opt-in Rust encoder can be trusted to match the TypeScript reference, and learn how to test a second implementation against a reference.",
    nonObviousAnswer:
      "Parity rests on generated inputs plus a check that the Rust engine loaded at all; the hard cases are UTF-16 key order and JavaScript number spelling, and Wordcell's runtime guard compares text, so its digests still depend on the parity tests.",
    originalContribution:
      "Reads the parity suite, the Rust number formatter, and Wordcell's wrapper side by side and states what each one checks and what it leaves unchecked.",
    hostFit: "A product-specific technique post about Oh's own record format.",
    nearestUrls: [
      {
        url: "https://oh.computer/blog/introducing-oh",
        distinction: "The introduction mentions the two encoders in one section; this post explains the parity method and its limits.",
      },
      {
        url: "https://hraness.com/reference/correctness/two-implementations-one-spec",
        distinction: "The hraness.com lesson teaches the general technique; this post shows it inside Oh.",
      },
    ],
    sources: [
      {
        title: "TypeScript and Rust canonical JSON parity tests",
        url: oh(ohReviewed, "src/canonical-rust-parity.test.ts"),
        checkedOn: "2026-09-24",
      },
      { title: "Rust canonical JSON crate and its unit tests", url: oh(ohReviewed, "rust/oh-canonical/src/lib.rs"), checkedOn: "2026-09-24" },
      { title: "Rust ECMAScript number formatter", url: oh(ohReviewed, "rust/oh-canonical/src/js_number.rs"), checkedOn: "2026-09-24" },
      { title: "TypeScript canonical JSON reference", url: oh(ohReviewed, "src/canonical.ts"), checkedOn: "2026-09-24" },
      { title: "Opt-in Rust loader with TypeScript fallback", url: oh(ohReviewed, "src/canonical-rust.ts"), checkedOn: "2026-09-24" },
      { title: "Rust foundations plan", url: oh(ohReviewed, "plans/rust-foundations.md"), checkedOn: "2026-09-24" },
      { title: "Wordcell parity tests against @hraness/oh", url: wordcell("src/oh/canonical-rust.test.ts"), checkedOn: "2026-09-24" },
      { title: "Wordcell Rust engine wrapper", url: wordcell("src/oh/canonical-rust.ts"), checkedOn: "2026-09-24" },
      { title: "Wordcell adoption digest with TypeScript fallback", url: wordcell("src/oh-adoption.ts"), checkedOn: "2026-09-24" },
    ],
    observations: [
      "The suite asserts that the Rust engine loaded before it compares outputs, so a missing WebAssembly module cannot turn the parity test into a comparison of the reference with itself.",
      "Wordcell's generated text check skips inputs where its wrapper already returned nothing on a text mismatch, so that check mostly confirms the guard; the digest check and fixed edge cases carry the comparison.",
    ],
    scores: {
      readerUtility: 2,
      originalEvidence: 2,
      factualConfidence: 2,
      hostFit: 2,
      voiceIntegrity: 2,
      maintenanceValue: 1,
    },
    owner: "hraness/oh maintainers",
    drafting: "ai-from-source",
    review,
    humanReview: null,
    reassessOn: "2026-11-05",
    harmIfWrong:
      "A developer could treat sampled parity as proof and mix digests from the two encoders where a single-byte difference breaks history verification.",
    refreshTriggers: [
      "Version bump in site/published-release.json",
      "Change to the parity suite's run counts, generators, or edge cases",
      "Change to canonical JSON rules in either encoder",
      "Change to the Rust number formatter or its ryu-js dependency",
      "Oh's store adopting the Rust encoder, or the canonical-rust export changing",
      "Wordcell changing its pinned Oh version, parity tests, or runtime guard",
    ],
  },
  {
    href: "/blog/built-on-oh",
    // Stays out of search until both relations are registered in the portfolio
    // facts with their reviewed sentences and the linked consumer posts are live.
    lifecycle: "quarantined",
    readerJob: "Find out which products use Oh, what each uses it for, and whether my own project needs Oh or Wordcell.",
    nonObviousAnswer:
      "The two uses sit at opposite ends: Sponge's Oh store is the record for its agent's session notes and expires with the session, while Wordcell keeps no record in Oh at all and rebuilds a throwaway graph from Markdown to answer a query.",
    originalContribution: "Contrasts the two consumers' use of Oh from their source, including what each keeps as its record.",
    hostFit: "The provider index for Oh on Oh's own site.",
    nearestUrls: [
      {
        url: "https://oh.computer/blog/introducing-oh",
        distinction: "The introduction describes Oh; this page only indexes the products that use it.",
      },
    ],
    sources: [
      { title: "Oh README: who builds on Oh", url: oh(ohCurrent, "README.md"), checkedOn: "2026-09-24" },
      { title: "Oh release record", url: oh(ohCurrent, "site/published-release.json"), checkedOn: "2026-09-24" },
      { title: "Wordcell dependency on a pinned Oh release", url: wordcell("package.json"), checkedOn: "2026-09-24" },
      { title: "Wordcell graph queries over Oh", url: wordcell("docs/graph-authority.md"), checkedOn: "2026-09-24" },
    ],
    observations: [
      "Sponge's default chat turns use Oh working memory, while staged research working memory stays off by default.",
      "Wordcell's explicit graph rebuild writes a disposable local cache, so it does write to Oh, but never as its record.",
    ],
    scores: {
      readerUtility: 1,
      originalEvidence: 1,
      factualConfidence: 2,
      hostFit: 2,
      voiceIntegrity: 2,
      maintenanceValue: 1,
    },
    owner: "hraness/oh maintainers",
    drafting: "ai-from-source",
    review,
    humanReview: null,
    reassessOn: "2026-11-05",
    harmIfWrong: "A reader could pick Oh or Wordcell for the wrong job, or expect a consumer to share Oh's release schedule.",
    refreshTriggers: [
      "Version bump in site/published-release.json",
      "A relation with Oh added, removed, or given a new sentence in the portfolio facts",
      "Sponge or Wordcell changing how or where it uses Oh",
      "A consumer post going live or being archived",
      "Rename of Oh, Sponge, or Wordcell",
    ],
  },
] as const satisfies readonly ArticleAdmission[];
