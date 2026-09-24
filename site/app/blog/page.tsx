import { ArticleIndex } from "@hraness/design-kit/react/server";
import { blogJsonLd } from "@hraness/web-discovery";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";

import { OhContentFooter } from "../site-footer";
import {
  articleDiscovery,
  articleIndexItem,
  blogDescription,
  blogDiscovery,
  blogPath,
  blogTitle,
  feedPath,
  indexableArticles,
  ohSearchSite,
} from "./articles";
import { BlogHeader } from "./blog-header";

export const metadata: Metadata = {
  title: blogTitle,
  description: blogDescription,
  alternates: {
    canonical: blogPath,
    types: { "application/atom+xml": [{ title: blogTitle, url: feedPath }] },
  },
  openGraph: {
    title: blogTitle,
    description: blogDescription,
    type: "website",
    url: blogPath,
  },
  twitter: {
    card: "summary_large_image",
    title: blogTitle,
    description: blogDescription,
  },
};

export default function BlogIndex() {
  return (
    <>
      <a className="skip-link" href="#blog-main">Skip to articles</a>
      <BlogHeader current="index" />
      <main className="blog-shell" id="blog-main" tabIndex={-1}>
        <JsonLdScript
          data={blogJsonLd(ohSearchSite, blogDiscovery, indexableArticles.map(articleDiscovery))}
          id="blog-json-ld"
        />
        <ArticleIndex
          heading="Blog"
          headingId="blog-title"
          headingLevel={1}
          items={indexableArticles.map(articleIndexItem)}
          summary={blogDescription}
        />
        <p className="blog-feed-link"><a href={feedPath}>Atom feed</a></p>
      </main>
      <OhContentFooter />
    </>
  );
}
