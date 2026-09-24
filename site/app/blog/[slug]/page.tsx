import {
  ArticleRelatedProducts,
  ArticleSources,
  MarketingArticle,
} from "@hraness/design-kit/react/server";
import { relatedFor } from "@hraness/design-kit/portfolio";
import {
  articleJsonLd,
  createArticleMetadata,
  INDEXABLE_ROBOTS,
  NOINDEX_ROBOTS,
} from "@hraness/web-discovery";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OhContentFooter } from "../../site-footer";
import { isArticleIndexable } from "@hraness/design-kit";
import {
  articleAuthor,
  articleDiscovery,
  articleProvenance,
  articles,
  articleSources,
  findArticle,
  ohSearchSite,
} from "../articles";
import { BlogHeader } from "../blog-header";

export const dynamicParams = false;

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const article = findArticle((await params).slug);
  if (article === undefined) return {};
  return {
    ...createArticleMetadata(ohSearchSite, articleDiscovery(article)),
    // Quarantined posts stay readable but out of search results.
    robots: isArticleIndexable(article.admission) ? INDEXABLE_ROBOTS : NOINDEX_ROBOTS,
  };
}

// Sibling products come only from registered relations with a reviewed sentence.
const relatedProducts = relatedFor("oh-computer");

export default async function ArticlePage({ params }: Readonly<{ params: Params }>) {
  const article = findArticle((await params).slug);
  if (article === undefined) notFound();
  const { Body } = article;
  const sources = articleSources(article);
  return (
    <>
      <a className="skip-link" href="#blog-main">Skip to article</a>
      <BlogHeader current="post" />
      <main className="blog-shell" id="blog-main" tabIndex={-1}>
        <JsonLdScript data={articleJsonLd(ohSearchSite, articleDiscovery(article))} id="article-json-ld" />
        <MarketingArticle
          after={
            <>
              <ArticleSources sources={sources} />
              {relatedProducts.length === 0 ? null : <ArticleRelatedProducts items={relatedProducts} />}
            </>
          }
          author={articleAuthor}
          dek={article.dek}
          eyebrow={article.eyebrow}
          heading={article.title}
          provenance={articleProvenance(article)}
          published={article.published}
          toc={article.toc}
        >
          <Body />
        </MarketingArticle>
      </main>
      <OhContentFooter />
    </>
  );
}
