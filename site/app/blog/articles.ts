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
export const blogTitle = "Oh blog";
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
  dek: string;
  eyebrow: string;
  /**
   * The share card's copy. The card fits a two-line headline and about two
   * lines of description, so a post whose title or dek runs longer gets a
   * shorter version that keeps the same claim and its conditions.
   */
  card: Readonly<{ headline?: string; description: string }>;
  published: ArticleIsoDate;
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
    title: "Reading every user message beat retrieval alone on LongMemEval-S",
    dek: "Giving GPT-5 mini every user message averaged 93.07% on the 500 LongMemEval-S questions it was tuned on, against 88.87% for Oh semantic retrieval.",
    eyebrow: "Benchmark",
    card: {
      headline: "Every user message beat retrieval alone",
      description: "93.07% against 88.87% for Oh semantic retrieval, with GPT-5 mini, on the 500 questions it was tuned on.",
    },
    published: "2026-09-26",
    keywords: ["LongMemEval", "agent memory", "long-term memory", "retrieval", "BM25", "semantic search", "GPT-5 mini"],
    toc: longMemEvalUserLogToc,
    Body: LongMemEvalUserLogBody,
    admission: admissionFor("longmemeval-s-user-log"),
  },
  {
    slug: "introducing-oh",
    title: "Introducing Oh",
    dek: "Oh is open-source memory for agents: an agent can write and nominate notes, but only your application’s code can adopt them into reviewed knowledge.",
    eyebrow: "Release",
    card: { description: "An agent can write and nominate notes, but only your application’s code can adopt them." },
    published: "2026-09-24",
    keywords: ["agent memory", "provenance", "knowledge graphs", "canonical JSON", "TypeScript", "Rust"],
    toc: introducingOhToc,
    Body: IntroducingOhBody,
    admission: admissionFor("introducing-oh"),
  },
  {
    slug: "oh-rust-typescript-parity",
    title: "Oh tests its Rust encoder byte for byte against TypeScript",
    dek: "Oh tests its opt-in Rust encoder against the TypeScript reference on thousands of generated inputs, and checks that installed copies load it.",
    eyebrow: "Technique",
    card: {
      headline: "Rust and TypeScript, byte for byte",
      description: "Generated documents, digests, and 20,000 numbers must match the TypeScript reference exactly.",
    },
    published: "2026-09-24",
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
    dek: "Sponge keeps its hosted agent’s working memory in Oh, and Wordcell uses Oh to answer graph questions about your Markdown notes.",
    eyebrow: "Integration",
    card: {
      description: "Sponge keeps its hosted agent’s working memory in Oh. Wordcell uses it to answer graph questions about notes.",
    },
    published: "2026-09-24",
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
    publisher: articleParty,
    section: article.eyebrow,
    title: article.title,
    type: "BlogPosting",
  };
}

export const blogDiscovery: BlogDiscovery = {
  description: blogDescription,
  name: blogTitle,
  path: blogPath,
  publisher: articleParty,
};

export const feedDiscovery: FeedDiscovery = {
  authors: [articleParty],
  description: blogDescription,
  homePath: blogPath,
  path: feedPath,
  title: blogTitle,
};
