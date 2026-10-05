import { marketing } from "../../portfolio-copy";
import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { DesignPaletteMenuButton } from "@hraness/design-kit/react";
import { AskAiAboutThis } from "@hraness/ui";
import type { Metadata } from "next";

import { docsPage, docsPages, type DocsPath } from "./catalog";
import { docsHtml } from "./docs.generated";
import { docsImageAlt } from "../social";

const repository = "https://github.com/hraness/oh";

export function docsMetadata(path: DocsPath): Metadata {
  const page = docsPage(path);
  const image = { alt: docsImageAlt(path), height: 630, url: `${path}/opengraph-image`, width: 1200 };
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      title: page.title,
      description: page.description,
      images: [image],
      siteName: marketing.names.name,
      url: path,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [{ alt: image.alt, url: image.url }],
    },
  };
}

function DocsHeader() {
  return (
    <MarketingSiteHeader
      trailing={<DesignPaletteMenuButton />}
      action={{ href: "/#install", label: "Install Oh" }}
      ariaLabel="Documentation navigation"
      brand={marketing.names.name}
      brandMark="/marks/oh-computer.svg"
      brandLabel={`${marketing.names.name} home`}
      className="spec-header"
      links={[
        { href: "/", label: "Overview" },
        { current: true, href: "/docs", label: "Docs" },
        { href: "/blog", label: "Blog" },
        { href: "/benchmarks", label: "Benchmarks" },
        { href: "/compare", label: "Compare" },
        { href: "/spec", label: "Specification" },
        { href: repository, label: "GitHub" },
      ]}
    />
  );
}

/** A documentation page rendered from repository Markdown by scripts/sync-docs.ts. */
export function DocsPage({ path }: Readonly<{ path: DocsPath }>) {
  const page = docsPage(path);
  const rendered = docsHtml[path];
  const others = docsPages.filter((candidate) => candidate.path !== path);
  return (
    <>
      <a className="skip-link" href="#docs-main">Skip to documentation</a>
      <DocsHeader />
      <main className="docs-shell" id="docs-main" tabIndex={-1}>
        <article
          aria-labelledby="docs-title"
          className="plain-site plain-publication plain-publication--embedded plain-publication__article"
          data-toc="aside"
        >
          <header className="plain-publication__article-header">
            <p className="plain-publication__eyebrow">Documentation</p>
            <h1 id="docs-title">{page.heading}</h1>
            <p className="plain-publication__article-dek">{page.dek}</p>
          </header>
          <div className="plain-publication__article-layout">
            <nav aria-labelledby="docs-contents" className="plain-publication__toc">
              <p id="docs-contents">On this page</p>
              <ol>
                {rendered.toc.map((item) => <li key={item.href}><a href={item.href}>{item.label}</a></li>)}
              </ol>
            </nav>
            <div className="plain-publication__article-body" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          </div>
          <footer className="plain-publication__article-footer">
            <ul className="docs-footer-links">
              {others.map((other) => <li key={other.path}><a href={other.path}>{other.heading}</a></li>)}
              <li><a href={`${repository}/blob/main/${page.source}`}>Read this page’s source on GitHub</a></li>
            </ul>
          </footer>
        </article>
        <AskAiAboutThis className="ask-ai" url={`https://oh.computer${path}`} />
      </main>
    </>
  );
}
