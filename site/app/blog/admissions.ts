import type { ArticleAdmission } from "@hraness/design-kit";

// Review records for every article URL on oh.computer. The review was an
// independent, disclosed AI editorial review; `humanReview` stays null until a
// person reviews a post. `assertArticleAdmissions()` checks this list in tests.

const oh = (commit: string, path: string) => `https://github.com/hraness/oh/blob/${commit}/${path}`;
const wordcell = (path: string) =>
  `https://github.com/hraness/wordcell/blob/7b6cb5e0d24a3f627e17f7d1bd699a52ab4c9d10/${path}`;
// Sources were read at this commit unless their link names another.
const ohChecked = "77617b5b04af02e13d27f06923529f3896de9c6d";
const loaderFix = "https://github.com/hraness/oh/pull/194";

const review = {
  reviewer: "Claude Opus 5.5 (claude-opus-5-5) editorial review",
  reviewerType: "ai",
  reviewedOn: "2026-09-26",
} as const;

export const articleAdmissions = [
  {
    href: "/blog/longmemeval-s-user-log",
    lifecycle: "indexable",
    readerJob:
      "Decide whether giving an agent's answering model the user's complete message log alongside retrieval is worth trying, and how far the 93.07% LongMemEval-S score can be trusted.",
    nonObviousAnswer:
      "The user wrote about an eighth of each history, yet in 425 of the 500 questions every marked evidence turn is a user message. One pass over the complete log plus retrieved replies beat Oh semantic retrieval by 2.33 points (0.80 to 3.93), though it also carried extra instructions and twice the bytes. The re-read rules that reach 93.07% act as detectors for this benchmark's question types, so that gain is in-sample. Oh semantic retrieval's own lead over BM25 reaches zero on the pre-run primary measure.",
    originalContribution:
      "Explains the pipeline and its design history from Oh's own three-run study on all 500 questions: per-step fixes and breaks, the six additions that lowered the score, the reference-answer scan, and the frozen from-scratch confirmation, with matched baselines, both scoring measures and per-answer costs.",
    hostFit: "A benchmark of Oh's own retrieval on Oh's site, which separates the lab pipeline from what the package ships.",
    nearestUrls: [
      {
        url: "https://github.com/hraness/oh/blob/main/benchmarks/LONGMEMEVAL_S_500_RESULT_V1.md",
        distinction:
          "The result file is the complete record with every table, instruction and rule; this post is a single reading of the pipeline, its dropped designs, the leak and the limits for someone who has not seen the protocol.",
      },
      {
        url: "https://oh.computer/#benchmarks",
        distinction:
          "The homepage gives the LongMemEval-S result in three sentences; this post explains how the pipeline works, what was dropped, and why the score is in-sample.",
      },
      {
        url: "https://mastra.ai/research/observational-memory",
        distinction:
          "Mastra reports 94.87% from model-written observations with GPT-5 mini, an average of the six question types from its latest run; this post reports a user-log pipeline's mean of three runs against matched baselines, in-sample.",
      },
    ],
    sources: [
      { title: "LongMemEval-S 500-question result", url: oh("main", "benchmarks/LONGMEMEVAL_S_500_RESULT_V1.md"), checkedOn: "2026-09-26" },
      { title: "LongMemEval-S result data", url: oh("main", "benchmarks/results/memory-longmemeval-s-500-v1.json"), checkedOn: "2026-09-26" },
      { title: "Benchmark protocol card", url: oh(ohChecked, "benchmarks/PROTOCOL_CARD.md"), checkedOn: "2026-09-26" },
      { title: "Evolution release results", url: oh(ohChecked, "benchmarks/EVOLUTION_RELEASE_RESULTS.md"), checkedOn: "2026-09-26" },
      { title: "LongMemEval identifier audit", url: oh(ohChecked, "benchmarks/LONGMEMEVAL_IDENTIFIER_AUDIT_V1.md"), checkedOn: "2026-09-26" },
      { title: "Memory framework pilot result", url: oh(ohChecked, "benchmarks/FRAMEWORK_PILOT_RESULT_V1.md"), checkedOn: "2026-09-26" },
      { title: "Memory framework pilot data", url: oh(ohChecked, "benchmarks/results/memory-framework-pilot-v1.json"), checkedOn: "2026-09-26" },
      { title: "LongMemEval judge profile", url: oh(ohChecked, "benchmarks/profiles/longmemeval-judge-v1.json"), checkedOn: "2026-09-26" },
      { title: "Evolution reader contracts", url: oh(ohChecked, "scripts/benchmarks/evolution-reader-contracts.ts"), checkedOn: "2026-09-26" },
      { title: "Oh semantic model profile", url: oh(ohChecked, "src/semantic-model.ts"), checkedOn: "2026-09-26" },
      { title: "Oh published release record", url: oh(ohChecked, "site/published-release.json"), checkedOn: "2026-09-26" },
      { title: "LongMemEval paper (Wu et al., ICLR 2025)", url: "https://arxiv.org/abs/2410.10813", checkedOn: "2026-09-26" },
      {
        title: "LongMemEval cleaned dataset",
        url: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/tree/98d7416c24c778c2fee6e6f3006e7a073259d48f",
        checkedOn: "2026-09-26",
      },
      {
        title: "LongMemEval evaluation script",
        url: "https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f/src/evaluation/evaluate_qa.py",
        checkedOn: "2026-09-26",
      },
      { title: "Supermemory LongMemEval research", url: "https://supermemory.ai/research/longmembench/", checkedOn: "2026-09-26" },
      { title: "Mastra observational memory", url: "https://mastra.ai/research/observational-memory", checkedOn: "2026-09-26" },
      { title: "Benchmarking Honcho", url: "https://plasticlabs.ai/blog/research/Benchmarking-Honcho", checkedOn: "2026-09-26" },
      { title: "Mem0 memory benchmarks", url: "https://github.com/mem0ai/memory-benchmarks", checkedOn: "2026-09-26" },
      { title: "Chronos (Sen et al., 2026)", url: "https://arxiv.org/abs/2603.16862", checkedOn: "2026-09-26" },
      { title: "MemMachine (Wang et al., 2026)", url: "https://arxiv.org/abs/2604.04853", checkedOn: "2026-09-26" },
    ],
    observations: [
      "The confirmation's first pass matched the design run within one answer (1,368 against 1,369 of 1,500), so 14 of the 15 answers lost came from the re-reads, whose net gain fell from 42 answers to 28. The advice step sent byte-identical requests in both runs (all 90 request hashes match), yet 87 of those 90 answers were judged correct in the design run and 83 in the confirmation.",
      "A whole-word check of the composed instructions finds, besides the two listed values, two common expressions that are some questions' entire reference answer: a number word in the user-log paragraph, which the reported first pass and advice step carry, and a two-word time phrase in the dropped counting re-read's instruction. BM25, Oh semantic retrieval and the pipeline answered both number-word questions correctly in all three runs, so that overlap cannot have moved the comparisons.",
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
    reassessOn: "2026-11-07",
    harmIfWrong:
      "A developer could adopt a full user-log design, or rank memory products, on an in-sample score; read Oh's narrow lead over BM25 as certain; or misjudge how Oh compares with Supermemory.",
    refreshTriggers: [
      "A version bump in site/published-release.json",
      "Any change to the result report or JSON",
      "A matched full-500 Supermemory or other framework run",
      "A pinned-snapshot or paper-judge rerun, or drift in a Gateway alias",
      "A test of the rules on unseen questions or on LongMemEval-M",
      "A new or revised published score outside 90.4% to 97%",
      "The lab harness moving into the package or being published",
      "A change to the embedding profile or the BM25 benchmark tools",
    ],
  },
  {
    href: "/blog/introducing-oh",
    lifecycle: "indexable",
    readerJob: "Decide whether Oh fits as the memory layer for an agent or knowledge application, and see how to start.",
    nonObviousAnswer:
      "The agent gets an object that can only remember, query, explain and nominate; only the host application's own code can adopt a nomination into reviewed knowledge, and the host supplies the actor and timestamp on every agent write.",
    originalContribution:
      "Checks the agent and host split against the memory specification and SDK, the parity generator's shape against the test file, and each consumer's pinned Oh release against its own package, which the README does not state together.",
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
      { title: "Oh README", url: oh(ohChecked, "README.md"), checkedOn: "2026-09-26" },
      { title: "Oh memory specification", url: oh(ohChecked, "spec/v1/memory.md"), checkedOn: "2026-09-26" },
      { title: "Oh release record", url: oh(ohChecked, "site/published-release.json"), checkedOn: "2026-09-26" },
      { title: "Oh v0.12.0 GitHub Release", url: "https://github.com/hraness/oh/releases/tag/v0.12.0", checkedOn: "2026-09-26" },
      { title: "Rust foundations plan", url: oh(ohChecked, "plans/rust-foundations.md"), checkedOn: "2026-09-26" },
      { title: "Rust canonical JSON crate", url: oh(ohChecked, "rust/oh-canonical/src/lib.rs"), checkedOn: "2026-09-26" },
      {
        title: "TypeScript and Rust canonical JSON parity tests",
        url: oh(ohChecked, "src/canonical-rust-parity.test.ts"),
        checkedOn: "2026-09-26",
      },
      { title: "Wordcell graph queries over Oh", url: wordcell("docs/graph-authority.md"), checkedOn: "2026-09-26" },
      { title: "Wordcell dependency on a pinned Oh release", url: wordcell("package.json"), checkedOn: "2026-09-26" },
      { title: "How Sponge uses Oh for agent working memory", url: "https://sponge.computer/docs/how-sponge-uses-oh", checkedOn: "2026-09-26" },
      { title: "Hraness portfolio registry", url: "https://hraness.com/portfolio.json", checkedOn: "2026-09-26" },
    ],
    observations: [
      "The memory specification never requires a person to review: nominate records no review and adoption follows whatever host code decides, so 'reviewed knowledge' names the store host code adopts into rather than a promise that a person read it.",
      "Sponge pins Oh v0.10.8 and Wordcell v0.12.0, the live portfolio registry on 2026-09-26 registers neither product's relation to Oh, and Sponge's hosted agent finishes only work accepted before 2026-09-12, so the consumer paragraph rests on facts outside Oh's repository.",
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
    reassessOn: "2026-11-07",
    harmIfWrong:
      "A developer could assume a person reviewed everything in the reviewed store, or trust the Rust parity or a consumer's use of Oh further than the code supports, and build a memory layer on a wrong assumption.",
    refreshTriggers: [
      "Version bump in site/published-release.json",
      "Change to the agent and host memory interface in spec/v1/memory.md or the SDK",
      "Change to the parity test sample counts or generator shape",
      "A Sponge or Wordcell relation to Oh registered, changed, or removed, or a design-kit bump that changes the Oh, Sponge, or Wordcell one-liners",
      "Change to either consumer's use of Oh, its pinned Oh version, or Sponge's hosted agent status",
      "Change to README runtime requirements (Bun, Node, libSQL), first-run commands, or the framework comparison statement",
    ],
  },
  {
    href: "/blog/oh-rust-typescript-parity",
    lifecycle: "indexable",
    readerJob:
      "Decide whether a digest from Oh's opt-in Rust encoder can be trusted to match the TypeScript reference, and learn how to test a second implementation against a reference.",
    nonObviousAnswer:
      "Parity rests on sampled inputs plus a check that the Rust engine loaded, and that check covers only where it runs: from the source tree it passed while installed copies fell back to the reference, which matching digests could not reveal. Every generated string is printable ASCII, so UTF-16 key order rests on one fixed edge case.",
    originalContribution:
      "Reads the parity suite, the Rust crate and number formatter, the published package, and Wordcell's wrapper and tests side by side, and states what each checks and what it leaves unchecked.",
    hostFit: "A product-specific technique post about Oh's own record format on Oh's site.",
    nearestUrls: [
      {
        url: "https://oh.computer/blog/introducing-oh",
        distinction: "The introduction mentions the two encoders in one section; this post explains the parity method and its limits.",
      },
      {
        url: "https://hraness.com/reference/local-first-software/content-addressed-documents",
        distinction: "The hraness.com reference explains why digests need canonical bytes in browser apps; this post shows how Oh keeps two encoders producing the same bytes.",
      },
    ],
    sources: [
      {
        title: "TypeScript and Rust canonical JSON parity tests",
        url: oh(ohChecked, "src/canonical-rust-parity.test.ts"),
        checkedOn: "2026-09-26",
      },
      { title: "Rust canonical JSON crate and its unit tests", url: oh(ohChecked, "rust/oh-canonical/src/lib.rs"), checkedOn: "2026-09-26" },
      { title: "Rust ECMAScript number formatter", url: oh(ohChecked, "rust/oh-canonical/src/js_number.rs"), checkedOn: "2026-09-26" },
      { title: "TypeScript canonical JSON reference", url: oh(ohChecked, "src/canonical.ts"), checkedOn: "2026-09-26" },
      { title: "Opt-in Rust loader with TypeScript fallback", url: oh(ohChecked, "src/canonical-rust.ts"), checkedOn: "2026-09-26" },
      { title: "Oh package exports", url: oh(ohChecked, "package.json"), checkedOn: "2026-09-26" },
      { title: "Oh v0.12.0 GitHub Release", url: "https://github.com/hraness/oh/releases/tag/v0.12.0", checkedOn: "2026-09-26" },
      {
        title: "Packaged loader fix, installed-package check, and UTF-16 key-order edge case",
        url: loaderFix,
        checkedOn: "2026-09-26",
      },
      { title: "Rust foundations plan", url: oh(ohChecked, "plans/rust-foundations.md"), checkedOn: "2026-09-26" },
      { title: "Wordcell parity tests against @hraness/oh", url: wordcell("src/oh/canonical-rust.test.ts"), checkedOn: "2026-09-26" },
      { title: "Wordcell Rust engine wrapper", url: wordcell("src/oh/canonical-rust.ts"), checkedOn: "2026-09-26" },
      { title: "Wordcell adoption digest with TypeScript fallback", url: wordcell("src/oh-adoption.ts"), checkedOn: "2026-09-26" },
    ],
    observations: [
      "Installed from the v0.12.0 release tarball, loadCanonicalRustTextEngine() reported typescript because dist/canonical-rust.js looked in ../rust-artifacts/ while the files ship in dist/rust-artifacts/, and dist/projection-rust.js repeated the path; the repository suite passed its rust-wasm assertion only because the source tree has rust/oh-canonical-wasm/pkg. The fix loads from the packaged folder and adds a check on the packed package that fails on a fallback.",
      "Before the fix no test in Oh's parity suite, the Rust crate, or Wordcell's suite put two keys whose UTF-16 and code-point orders differ into one object; fast-check 4's default string unit keeps every generated string printable ASCII, and Wordcell's generated checks can fail only on a SHA-256 difference because its wrapper returns null on any text mismatch.",
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
    reassessOn: "2026-11-07",
    harmIfWrong:
      "A developer could believe an installed copy runs Rust when it runs the reference, or treat sampled parity as proof and mix digests from the two encoders where a single-byte difference breaks history verification.",
    refreshTriggers: [
      "Version bump in site/published-release.json, especially the first release with the loader fix (then name the releases that fell back)",
      "Change to the parity suite's run counts, generators, or edge cases",
      "Change to canonical JSON rules in either encoder",
      "Change to the Rust number formatter or its ryu-js dependency",
      "Oh's store adopting the Rust encoder, or the canonical-rust export changing",
      "Wordcell changing its pinned Oh version, parity tests, or runtime guard, or its relation to Oh being registered or changed",
    ],
  },
  {
    href: "/blog/built-on-oh",
    // Stays out of search until the Sponge and Wordcell relations with Oh are registered with
    // detail sentences and each entry renders from its relation.
    lifecycle: "quarantined",
    readerJob: "Find out which products use Oh, what each uses it for, and whether my own project needs Oh or Wordcell.",
    nonObviousAnswer:
      "The two uses sit at opposite ends: Sponge's Oh store is the record for its hosted agent's working notes and expires 24 hours after each session opens, while Wordcell keeps no record in Oh and rebuilds a disposable graph from Markdown to answer a query.",
    originalContribution: "Contrasts the two consumers' use of Oh from their own sources and pins, including what each keeps as its record.",
    hostFit: "The provider index for Oh on Oh's own site, but neither entry has the registered relation a hub entry must come from.",
    nearestUrls: [
      {
        url: "https://oh.computer/blog/introducing-oh",
        distinction: "The introduction describes Oh; this page only indexes the products that use it.",
      },
      {
        url: "https://sponge.computer/docs/how-sponge-uses-oh",
        distinction: "Sponge's post explains its working memory in detail; this page gives one line per product.",
      },
    ],
    sources: [
      { title: "Oh README: who builds on Oh", url: oh(ohChecked, "README.md"), checkedOn: "2026-09-26" },
      { title: "Oh release record", url: oh(ohChecked, "site/published-release.json"), checkedOn: "2026-09-26" },
      { title: "Wordcell dependency on a pinned Oh release", url: wordcell("package.json"), checkedOn: "2026-09-26" },
      { title: "Wordcell graph queries over Oh", url: wordcell("docs/graph-authority.md"), checkedOn: "2026-09-26" },
      { title: "How Sponge uses Oh for agent working memory", url: "https://sponge.computer/docs/how-sponge-uses-oh", checkedOn: "2026-09-26" },
      { title: "Hraness portfolio registry", url: "https://hraness.com/portfolio.json", checkedOn: "2026-09-26" },
    ],
    observations: [
      "The live portfolio registry lists 78 relations on 2026-09-26 and none connects Sponge or Wordcell to Oh, so neither entry can render from a registered relation yet.",
      "Sponge retired new hosted chat, report jobs, and hosted research on 2026-09-12, so its Oh working memory serves only runs accepted before then, each expiring 24 hours after its session opens; Sponge pins Oh v0.10.8 and Wordcell pins v0.12.0.",
    ],
    scores: {
      readerUtility: 1,
      originalEvidence: 1,
      factualConfidence: 2,
      hostFit: 1,
      voiceIntegrity: 2,
      maintenanceValue: 1,
    },
    owner: "hraness/oh maintainers",
    drafting: "ai-from-source",
    review,
    humanReview: null,
    reassessOn: "2026-11-07",
    harmIfWrong:
      "A reader could pick Oh or Wordcell for the wrong job, expect Sponge's hosted agent to accept new work, or expect a consumer to share Oh's release schedule.",
    refreshTriggers: [
      "Version bump in site/published-release.json",
      "A relation with Oh added, removed, or given a new detail sentence in the portfolio facts",
      "Sponge or Wordcell changing how or where it uses Oh, its pinned Oh version, or Sponge's hosted agent status",
      "A consumer post going live, leaving quarantine, or being archived",
      "Rename of Oh, Sponge, or Wordcell",
    ],
  },
] as const satisfies readonly ArticleAdmission[];
