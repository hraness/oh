import {
  assertArticleAdmissions,
  articleProvenanceFromAdmission,
  isArticleIndexable,
  type ArticleAdmission,
  type ArticleAuthor,
  type ArticleIndexItem,
  type ArticleIsoDate,
  type ArticleSourceItem,
} from "@hraness/design-kit";
import { socialImageAlt, type SocialImagePage } from "@hraness/web-discovery/social-image";
import type {
  ArticleDiscovery,
  ArticleParty,
  BlogDiscovery,
  FeedDiscovery,
  OwnedPath,
  SearchSite,
} from "@hraness/web-discovery";
import type { ComponentType } from "react";

import { homeDescription, homeTitle } from "../metadata-copy";
import { ohSocialSite } from "../social";
import { articleAdmissions } from "./admissions";
import { BuiltOnOhBody, toc as builtOnOhToc } from "./content/built-on-oh";
import { IntroducingOhBody, toc as introducingOhToc } from "./content/introducing-oh";
import { LongMemEvalUserLogBody, toc as longMemEvalUserLogToc } from "./content/longmemeval-s-user-log";
import { ParityBody, toc as parityToc } from "./content/oh-rust-typescript-parity";

export const blogPath = "/blog" as const;
export const feedPath = "/blog/feed.xml" as const;
export const blogName = "Oh blog";
export const blogTitle = `${blogName}: agent memory, research, and engineering`;
export const blogDescription =
  "Hraness on how Oh works and how it is tested, from a run on all 500 LongMemEval-S questions to the property tests behind its Rust encoder.";

export const ohSearchSite: SearchSite = {
  description: homeDescription,
  language: "en-US",
  locale: "en_US",
  name: "Oh",
  origin: "https://oh.computer",
  title: homeTitle,
};

export const articleAuthor: ArticleAuthor = { kind: "organization", name: "Hraness", href: "https://hraness.com" };
export const articleParty: ArticleParty = {
  kind: "Organization",
  name: "Hraness",
  sameAs: ["https://github.com/hraness"],
  url: "https://hraness.com",
};

type TocItem = Readonly<{ href: `#${string}`; label: string }>;

export type OhArticle = Readonly<{
  slug: string;
  title: string;
  /** Search and share metadata may add context to a short editorial headline. */
  metaTitle?: string;
  /** Search summaries can describe the article separately from its visible dek. */
  metaDescription?: string;
  dek: string;
  eyebrow: string;
  /**
   * The share card's copy. The card fits a two-line headline and about two
   * lines of description, so a post whose title or dek runs longer gets a
   * shorter version that keeps the same claim and its conditions.
   */
  card: Readonly<{ headline?: string; description: string }>;
  published: ArticleIsoDate;
  updated: ArticleIsoDate;
  keywords: readonly string[];
  toc: readonly TocItem[];
  Body: ComponentType;
  admission: ArticleAdmission;
}>;

assertArticleAdmissions(articleAdmissions);

function admissionFor(slug: string): ArticleAdmission {
  const href = `${blogPath}/${slug}`;
  const admission = articleAdmissions.find((record) => record.href === href);
  if (admission === undefined) throw new Error(`No admission record for ${href}.`);
  return admission;
}

// Newest first. Every post has an admission record; the record decides indexing.
export const articles: readonly OhArticle[] = [
  {
    slug: "longmemeval-s-user-log",
    title: "When a conversation log can help memory retrieval",
    dek: "A user log plus selected replies scored above retrieval alone in one study. Different budgets and tuned rules shape what that comparison establishes.",
    eyebrow: "Benchmark",
    card: {
      headline: "A full user log plus retrieval",
      description: "How context budgets, speaker roles, and held-out questions shape a memory evaluation.",
    },
    published: "2026-09-26",
    updated: "2026-10-01",
    keywords: ["LongMemEval", "agent memory", "long-term memory", "retrieval", "BM25", "semantic search", "GPT-5 mini"],
    toc: longMemEvalUserLogToc,
    Body: LongMemEvalUserLogBody,
    admission: admissionFor("longmemeval-s-user-log"),
  },
  {
    slug: "introducing-oh",
    title: "Introducing Oh",
    metaTitle: "Introducing Oh: open-source memory for AI agents",
    metaDescription: "Introducing Oh, open-source memory for AI agents: explore its CLI, evidence records, source links, and replayable history with a working example.",
    dek: homeDescription,
    eyebrow: "Announcement",
    card: { description: "Free, open-source memory for AI agents that shows where each fact came from." },
    published: "2026-09-24",
    updated: "2026-10-01",
    keywords: ["Oh", "agent memory", "AI agent memory", "provenance", "open source", "TypeScript"],
    toc: introducingOhToc,
    Body: IntroducingOhBody,
    admission: admissionFor("introducing-oh"),
  },
  {
    slug: "oh-rust-typescript-parity",
    title: "Keeping record fingerprints consistent across languages",
    dek: "Canonical encoding, differential tests, and runtime fallbacks help separate a shared byte format from the evidence that a port follows it.",
    eyebrow: "Technique",
    card: {
      headline: "One record, one byte format",
      description: "Test encoding rules, generator coverage, and fallback behavior across language boundaries.",
    },
    published: "2026-09-24",
    updated: "2026-10-04",
    keywords: [
      "canonical JSON",
      "property-based testing",
      "differential testing",
      "Rust",
      "TypeScript",
      "WebAssembly",
      "agent memory",
    ],
    toc: parityToc,
    Body: ParityBody,
    admission: admissionFor("oh-rust-typescript-parity"),
  },
  {
    slug: "built-on-oh",
    title: "Built on Oh",
    metaTitle: "How Sponge and Wordcell use Oh: memory and graphs",
    dek: "Wordcell’s Markdown graph and the working memory in Sponge’s hosted library show two ways to separate durable records, temporary notes, and derived views.",
    eyebrow: "Integration",
    card: {
      description: "Temporary working notes and a disposable graph illustrate different ownership and retention rules.",
    },
    published: "2026-09-24",
    updated: "2026-10-04",
    keywords: ["oh", "agent memory", "knowledge graphs", "sponge", "wordcell"],
    toc: builtOnOhToc,
    Body: BuiltOnOhBody,
    admission: admissionFor("built-on-oh"),
  },
];

if (articles.length !== articleAdmissions.length) {
  throw new Error("Every admission record needs exactly one article, and every article one record.");
}

export const indexableArticles = articles.filter((article) => isArticleIndexable(article.admission));

export function articlePath(article: Pick<OhArticle, "slug">): OwnedPath {
  return `${blogPath}/${article.slug}`;
}

export function findArticle(slug: string): OhArticle | undefined {
  return articles.find((article) => article.slug === slug);
}

export function articleProvenance(article: OhArticle) {
  return articleProvenanceFromAdmission(article.admission);
}

export function articleSources(article: OhArticle): readonly ArticleSourceItem[] {
  return article.admission.sources.map((source) => ({
    checkedOn: source.checkedOn,
    href: source.url,
    title: source.title,
  }));
}

export function articleIndexItem(article: OhArticle): ArticleIndexItem {
  return {
    dek: article.dek,
    eyebrow: article.eyebrow,
    href: articlePath(article),
    published: article.published,
    title: article.title,
  };
}

function isoTime(date: ArticleIsoDate): string {
  return `${date}T00:00:00.000Z`;
}

/** The share-card copy for one post, rendered by ./[slug]/opengraph-image.tsx. */
export function articleSocialPage(article: Pick<OhArticle, "card" | "eyebrow" | "title">): SocialImagePage {
  return {
    description: article.card.description,
    eyebrow: article.eyebrow,
    headline: article.card.headline ?? article.title,
  };
}

export function articleDiscovery(article: OhArticle): ArticleDiscovery {
  const path = articlePath(article);
  return {
    authors: [articleParty],
    blogPath,
    canonicalPath: path,
    citations: article.admission.sources
      .map((source) => source.url)
      .filter((url): url is `https://${string}` => url.startsWith("https://")),
    description: article.dek,
    image: {
      alt: socialImageAlt(ohSocialSite, articleSocialPage(article)),
      contentType: "image/png",
      height: 630,
      path: `${path}/opengraph-image`,
      width: 1200,
    },
    isAccessibleForFree: true,
    keywords: article.keywords,
    publishedTime: isoTime(article.published),
    modifiedTime: isoTime(article.updated),
    publisher: articleParty,
    section: article.eyebrow,
    title: article.title,
    type: "BlogPosting",
  };
}

export const blogDiscovery: BlogDiscovery = {
  description: blogDescription,
  name: blogName,
  path: blogPath,
  publisher: articleParty,
};

export const feedDiscovery: FeedDiscovery = {
  authors: [articleParty],
  description: blogDescription,
  homePath: blogPath,
  path: feedPath,
  title: blogName,
};
