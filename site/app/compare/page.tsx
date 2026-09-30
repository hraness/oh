import { MarketingComparison, type MarketingComparisonValue } from "@hraness/design-kit/react/server";
import { marketing } from "../../portfolio-copy";
import { collectionPageJsonLd } from "@hraness/web-discovery";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";

import { ohSearchSite } from "../blog/articles";
import { compareDescription, compareTitle } from "../metadata-copy";
import { compareImageAlt } from "../social";
import {
  benchmarkEvidence,
  ComparePage,
  comparePages,
  CompareSection,
  CompareSources,
  type CompareSource,
  repository,
} from "./compare";

const checkedOn = "September 28, 2026";

const glanceColumns = ["Oh", "Mem0", "Supermemory", "Zep and Graphiti", "Letta", "Claude memory tool"] as const;

// Each cell was read from the product's own page or repository on checkedOn; the sources list below names them.
const glanceRows: readonly Readonly<{ label: string; cells: readonly [MarketingComparisonValue, MarketingComparisonValue, MarketingComparisonValue, MarketingComparisonValue, MarketingComparisonValue, MarketingComparisonValue] }>[] = [
  {
    label: "What it is",
    cells: [
      "Local memory library and CLI",
      "Memory for each app user",
      "Memory API with document connectors",
      "Temporal knowledge graph of facts",
      "Agents that manage their own memory",
      "Claude tool for memory files",
    ],
  },
  {
    label: "License",
    cells: [
      "MIT",
      "Apache-2.0 SDK; hosted Platform",
      "MIT repository; hosted Platform",
      "Graphiti Apache-2.0; Zep hosted",
      "Apache-2.0",
      "Part of the Claude API",
    ],
  },
  {
    label: "How memories get in",
    cells: [
      "Explicit record writes",
      "A model extracts facts from messages",
      "Model extraction; Platform connectors",
      "Model extracts entities and facts",
      "The agent rewrites its own memory blocks",
      "Claude writes files through tool calls",
    ],
  },
  {
    label: "Local storage",
    cells: [
      { status: "yes", label: "SQLite", detail: "libSQL optional" },
      { status: "optional", label: "Self-hosted SDK", detail: "Or hosted Platform" },
      { status: "optional", label: "Self-hosted binary", detail: "Or hosted Platform" },
      { status: "depends", label: "Graphiti graph store", detail: "Zep uses cloud or VPC" },
      { status: "optional", label: "Self-hosted App Server", detail: "Or Letta Cloud" },
      { status: "depends", label: "Your application’s storage", detail: "Claude API calls still required" },
    ],
  },
  {
    label: "Matched run in Oh’s repository",
    cells: [
      "Not applicable",
      "30 questions in the MemEval harness",
      "60-question LongMemEval-S pilot",
      "None",
      "None",
      "None",
    ],
  },
];

const sources: readonly CompareSource[] = [
  { title: "Mem0: Platform vs open source", href: "https://docs.mem0.ai/platform/platform-vs-oss", note: `Checked ${checkedOn}.` },
  { title: "mem0ai/mem0 on GitHub", href: "https://github.com/mem0ai/mem0", note: `Checked ${checkedOn}.` },
  { title: "Supermemory self-hosting", href: "https://supermemory.ai/docs/self-hosting/overview", note: `Checked ${checkedOn}.` },
  { title: "Supermemory connectors", href: "https://supermemory.ai/docs/connectors/overview", note: `Checked ${checkedOn}.` },
  { title: "supermemoryai/supermemory on GitHub", href: "https://github.com/supermemoryai/supermemory", note: `Checked ${checkedOn}.` },
  { title: "getzep/graphiti on GitHub", href: "https://github.com/getzep/graphiti", note: `Checked ${checkedOn}.` },
  { title: "Zep", href: "https://www.getzep.com", note: `Checked ${checkedOn}.` },
  { title: "letta-ai/letta-code on GitHub", href: "https://github.com/letta-ai/letta-code", note: `Checked ${checkedOn}.` },
  { title: "Claude memory tool", href: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool", note: `Checked ${checkedOn}.` },
];

export const metadata: Metadata = {
  title: compareTitle,
  description: compareDescription,
  alternates: { canonical: "/compare" },
  openGraph: {
    title: compareTitle,
    description: compareDescription,
    images: [{
      alt: compareImageAlt,
      height: 630,
      url: "/compare/opengraph-image",
      width: 1200,
    }],
    siteName: "Oh",
    url: "/compare",
  },
  twitter: {
    card: "summary_large_image",
    title: compareTitle,
    description: compareDescription,
    images: [{ alt: compareImageAlt, url: "/compare/opengraph-image" }],
  },
};

export default function CompareIndex() {
  return (
    <ComparePage
      canonical="https://oh.computer/compare"
      eyebrow="Comparisons"
      jsonLd={
        <JsonLdScript
          data={collectionPageJsonLd(ohSearchSite, {
            breadcrumb: [
              { name: marketing.names.name, path: "/" },
              { name: "Comparisons", path: "/compare" },
            ],
            dateModified: "2026-09-28",
            description: compareDescription,
            name: compareTitle,
            path: "/compare",
            items: comparePages.map((page) => ({
              name: page.label,
              url: `https://oh.computer${page.href}`,
            })),
          })}
          id="compare-json-ld"
        />
      }
      lead="Oh keeps an agent’s own records in one local SQLite file, each linked to the records it rests on, with a history you can replay. Pick Mem0 or Supermemory to give each user of a product a memory. Pick Zep or Graphiti to track when each fact was true. Pick Letta to run agents that manage their own memory. Claude’s memory tool needs no extra package if you already call the Claude API. Every claim about another product below is dated and sourced."
      nav={[
        { href: "#at-a-glance", label: "At a glance" },
        ...comparePages.map((page) => ({ href: page.href, label: page.label })),
        { href: "#other-tools", label: "Zep, Letta, and Claude" },
        { href: "#sources", label: "Sources" },
      ]}
      navLabel="Compare"
      title="Compare Oh"
    >
      <CompareSection id="at-a-glance" number="01" title="At a glance">
        <MarketingComparison
          caption={`Six ways to give an agent memory, checked ${checkedOn}.`}
          highlight={0}
          options={glanceColumns.map((name) => ({ name, ...(name === "Oh" ? { mark: "/marks/oh-computer.svg" } : {}) }))}
          rows={glanceRows.map((row) => ({ label: row.label, values: row.cells }))}
          note="Supermemory Platform connectors include Google Drive, Gmail, and Notion. Graphiti supports Neo4j, FalkorDB, and Neptune. See the dated sources below for each product."
        />
      </CompareSection>

      {comparePages.map((page, index) => (
        <CompareSection key={page.href} id={page.href.slice("/compare/".length)} number={`0${index + 2}`} title={page.label}>
          {page.href === "/compare/mem0" ? (
            <p>
              Mem0 is a memory layer for applications: its <code>add</code> call distills messages
              into facts scoped by <code>user_id</code>, so a product can remember each of its end
              users, either on the hosted Platform or through the self-hosted Apache-2.0 SDK. Oh
              keeps an agent’s own working memory instead, with source links on every fact. The page
              reports the one matched run so far: 30 questions in a third-party harness, too few to
              support a claim that either system is better.
            </p>
          ) : (
            <p>
              Supermemory is a hosted memory API: connectors sync Google Drive, Gmail, Notion, and
              more into containers partitioned per user, and usage is metered in credits on paid
              tiers. The page reports the matched 60-question LongMemEval-S pilot, where Supermemory
              scored higher by a margin the pilot could not separate from a tie, and what each
              system does that the other does not.
            </p>
          )}
          <ul className="benchmark-links">
            <li><a href={page.href}>Read {page.label}</a></li>
          </ul>
        </CompareSection>
      ))}

      <CompareSection id="other-tools" number="04" title="Zep, Letta, and Claude’s memory tool">
        <p>
          Graphiti, Zep’s open-source framework, builds a temporal knowledge graph: a model extracts
          entities and facts from each episode, each fact keeps the window when it was true, and
          each traces back to the episode it came from. It runs on Python with a graph database;
          Zep is the managed service. Pick it to ask what was true at a given time. Oh stores what
          you write without a model rewriting it, in one SQLite file, and needs no graph database.
        </p>
        <p>
          Letta, formerly MemGPT, is an agent harness and app server whose agents rewrite their
          own memory blocks as they work. Pick it to run stateful agents on Letta. Oh is a
          library you call from your own agent.
        </p>
        <p>
          Anthropic’s memory tool lets Claude create, read, edit, and delete files under{" "}
          <code>/memories</code>, while your application runs each operation against storage it
          controls. It needs no extra package on the Claude API. The tool defines no schema, source
          links, or digests for those files, and Oh ships no adapter for it.
        </p>
        <p>
          Oh has run no matched benchmark against these three. Oh’s benchmark records quote
          published LoCoMo figures for Zep and Letta and a LongMemEval figure for Zep, from setups
          Oh’s runs do not match.
        </p>
      </CompareSection>

      <CompareSection id="evidence" number="05" title="Where the numbers come from">
        <p>
          Every figure on these pages comes from a checked-in result document in the
          repository’s <code>benchmarks</code> directory or from the other product’s own
          documentation, dated where prices and feature lists can drift. The{" "}
          <a href="/benchmarks">benchmark index</a> lists every published study, and each result
          links its protocol, costs, and limits.
        </p>
        <ul className="benchmark-links">
          <li><a href="/benchmarks">All benchmark results</a></li>
          <li><a href={benchmarkEvidence}>Benchmark evidence</a></li>
          <li><a href={repository}>hraness/oh on GitHub</a></li>
        </ul>
      </CompareSection>

      <CompareSection id="sources" number="06" title="Sources">
        <CompareSources items={sources} />
      </CompareSection>
    </ComparePage>
  );
}
