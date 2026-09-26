import type { Metadata } from "next";

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
      lead="Oh is open-source memory for agents: linked records in one local SQLite file, each fact keeping the sources behind it and every change in a history you can replay. These pages compare it with other memory systems, naming a dated source for each outside claim and a checked-in document for each Oh claim."
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
              includes the repository’s one matched run so far, a 30-question observation inside a
              third-party harness that is not a superiority claim.
            </p>
          ) : (
            <p>
              Supermemory is a hosted memory API: connectors sync Google Drive, Gmail, Notion, and
              more into containers partitioned per user, and usage is metered in credits on paid
              tiers. The page reports the repository’s matched 60-question LongMemEval-S pilot,
              where Supermemory scored higher on the headline measure without a statistically clean
              separation, plus what each system does that the other does not.
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
          documentation, dated where prices and feature lists can drift. The homepage charts the
          same studies under <a href="/#benchmarks">Benchmarks</a>, and each result links its
          protocol, costs, and limits.
        </p>
        <ul className="benchmark-links">
          <li><a href={benchmarkEvidence}>Benchmark evidence</a></li>
          <li><a href={repository}>hraness/oh on GitHub</a></li>
        </ul>
      </CompareSection>
    </ComparePage>
  );
}
