/**
 * The documentation pages on oh.computer and the repository files they are
 * rendered from. `scripts/sync-docs.ts` reads this list, renders the named
 * Markdown into `docs.generated.ts`, and `tests/docs.test.ts` fails when the
 * committed output differs from the current sources.
 */
export interface DocsReadmeSection {
  /** The exact `##` heading in README.md. */
  readonly heading: string;
  /** A short anchor kept beside the heading's own fragment. */
  readonly alias?: string;
}

export interface DocsPageEntry {
  readonly path: "/docs" | "/docs/sdk";
  readonly title: string;
  readonly heading: string;
  readonly dek: string;
  readonly description: string;
  readonly cardHeadline: string;
  readonly cardDescription: string;
  readonly source: "README.md" | "docs/sdk.md";
  /** README sections in page order. Absent for a page rendered from a whole file. */
  readonly sections?: readonly DocsReadmeSection[];
}

export const docsPages = [
  {
    path: "/docs",
    title: "Install Oh and store your first record: CLI, SDK, and coding agents",
    heading: "Get started with Oh",
    dek: "Install the CLI, store and verify one record, choose a store and space, fix first-run errors, call the TypeScript SDK, and give Oh to a coding agent.",
    description:
      "Install Oh, store and verify a first record, choose a store and space, fix first-run errors, call the TypeScript SDK, and set up the Oh skill for coding agents.",
    cardHeadline: "Get started with Oh",
    cardDescription: "Install the CLI, store a first record, call the SDK, and give Oh to an agent.",
    source: "README.md",
    sections: [
      { heading: "Install and first run" },
      { heading: "Choose the store and space" },
      { heading: "Troubleshooting the first run", alias: "troubleshooting" },
      { heading: "How Oh behaves" },
      { heading: "Use the SDK" },
      { heading: "Give Oh to a coding agent", alias: "agents" },
      { heading: "Limits" },
    ],
  },
  {
    path: "/docs/sdk",
    title: "Call Oh from TypeScript: SDK methods, batch writes, and errors",
    heading: "Call Oh from TypeScript",
    dek: "Open a space, write records under a head you have checked, batch changes, close cleanly, and tell each Oh error apart.",
    description:
      "Open an Oh space from TypeScript, write records under a checked head, batch several changes, close cleanly, tell each Oh error apart, and pick an entry point.",
    cardHeadline: "Call Oh from TypeScript",
    cardDescription: "SDK methods, batch writes, error classes, and every entry point.",
    source: "docs/sdk.md",
  },
] as const satisfies readonly DocsPageEntry[];

export type DocsPath = (typeof docsPages)[number]["path"];

export function docsPage(path: DocsPath): (typeof docsPages)[number] {
  const page = docsPages.find((candidate) => candidate.path === path);
  if (page === undefined) throw new Error(`No documentation page at ${path}.`);
  return page;
}
