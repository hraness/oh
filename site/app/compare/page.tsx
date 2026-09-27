import { collectionPageJsonLd } from "@hraness/web-discovery";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";

import { ohSearchSite } from "../blog/articles";
import { compareDescription, compareImageAlt, compareTitle } from "../metadata-copy";
import { benchmarkEvidence, ComparePage, comparePages, CompareSection, repository } from "./compare";

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
              { name: "Oh", path: "/" },
              { name: "Comparisons", path: "/compare" },
            ],
            dateModified: "2026-09-26",
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
      lead="Oh is open-source memory for an agent’s own work: each fact is a record linked to its sources, kept in a local SQLite file with a history you can replay. Mem0 and Supermemory give a product memory for each of its end users instead. Each page says who should pick which, reports the matched run Oh’s repository has against that product, and dates and sources every claim about it."
      nav={comparePages.map((page) => ({ href: page.href, label: page.label }))}
      navLabel="Compare"
      title="Compare Oh"
    >
      {comparePages.map((page, index) => (
        <CompareSection key={page.href} id={page.href.slice("/compare/".length)} number={`0${index + 1}`} title={page.label}>
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

      <CompareSection id="evidence" number="03" title="Where the numbers come from">
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
    </ComparePage>
  );
}
