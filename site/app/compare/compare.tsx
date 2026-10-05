import { marketing } from "../../portfolio-copy";
import { DesignPaletteMenuButton } from "@hraness/design-kit/react";
import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { AskAiAboutThis } from "@hraness/ui";
import type { ReactNode } from "react";


export const repository = "https://github.com/hraness/oh";
/** Checked-in benchmark evidence: result documents and the JSON behind each number. */
export const benchmarkEvidence = `${repository}/blob/main/benchmarks`;

/** The comparison routes, in the order the header, index, and footer list them. */
export const comparePages = [
  { href: "/compare/mem0", label: "Oh vs Mem0" },
  { href: "/compare/supermemory", label: "Oh vs Supermemory" },
] as const;

export function CompareHeader() {
  return (
    <MarketingSiteHeader
      trailing={<DesignPaletteMenuButton />}
      action={{ href: "/#install", label: "Install Oh" }}
      ariaLabel="Comparison navigation"
      brand={marketing.names.name}
      brandMark="/marks/oh-computer.svg"
      brandLabel={`${marketing.names.name} home`}
      className="spec-header"
      links={[
        { href: "/", label: "Overview" },
        { href: "/docs", label: "Docs" },
        { href: "/blog", label: "Blog" },
        { href: "/benchmarks", label: "Benchmarks" },
        { current: true, href: "/compare", label: "Compare" },
        { href: "/spec", label: "Specification" },
        { href: repository, label: "GitHub" },
      ]}
    />
  );
}

export function ComparePage({ canonical, children, eyebrow, jsonLd, lead, nav, navLabel, title }: Readonly<{
  canonical: `https://oh.computer${string}`;
  children: ReactNode;
  eyebrow: string;
  jsonLd?: ReactNode;
  lead: ReactNode;
  nav: readonly Readonly<{ href: string; label: string }>[];
  navLabel: string;
  title: string;
}>) {
  return (
    <>
      <a className="skip-link" href="#compare-main">Skip to comparison</a>
      <CompareHeader />
      <main className="spec-shell" id="compare-main" tabIndex={-1} data-hraness-landscape="page">
        {jsonLd}
        <aside className="spec-nav" aria-label="On this page">
          <p>{navLabel}</p>
          {nav.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </aside>
        <article className="spec-document compare-document">
          <header className="spec-intro">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
            </div>
            <p>{lead}</p>
          </header>
          {children}
        </article>
      </main>
      <AskAiAboutThis className="ask-ai" url={canonical} />
    </>
  );
}

export function CompareSection({ children, id, number, title }: Readonly<{
  children: ReactNode;
  id: string;
  number: string;
  title: string;
}>) {
  return (
    <section className="spec-section" id={id}>
      <div className="spec-number">{number}</div>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

/** A claim's evidence: external pages carry the date they were read; repository files are versioned by Git. */
export type CompareSource = Readonly<{ href: string; note: string; title: string }>;

export function CompareSources({ items }: Readonly<{ items: readonly CompareSource[] }>) {
  return (
    <ul className="compare-sources">
      {items.map((source) => (
        <li key={source.href}>
          <a href={source.href}>{source.title}</a> <span>{source.note}</span>
        </li>
      ))}
    </ul>
  );
}
