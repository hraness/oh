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
import type {
  ArticleDiscovery,
  ArticleParty,
  BlogDiscovery,
  FeedDiscovery,
  OwnedPath,
  SearchSite,
} from "@hraness/web-discovery";
import type { ComponentType } from "react";

import { homeDescription } from "../metadata-copy";
import { articleAdmissions } from "./admissions";
import { BuiltOnOhBody, toc as builtOnOhToc } from "./content/built-on-oh";
import { IntroducingOhBody, toc as introducingOhToc } from "./content/introducing-oh";
import { LongMemEvalUserLogBody, toc as longMemEvalUserLogToc } from "./content/longmemeval-s-user-log";
import { ParityBody, toc as parityToc } from "./content/oh-rust-typescript-parity";

export const blogPath = "/blog" as const;
export const feedPath = "/blog/feed.xml" as const;
export const blogTitle = "Oh blog";
export const blogDescription =
  "Articles from Hraness about how Oh works and how it is tested, from a run on all 500 LongMemEval-S questions to the property tests behind its Rust encoder.";

export const ohSearchSite: SearchSite = {
  description: homeDescription,
  language: "en-US",
  locale: "en_US",
  name: "Oh",
  origin: "https://oh.computer",
  title: "Oh: Agent memory that shows its work.",
};

export const articleAuthor: ArticleAuthor = { kind: "organization", name: "Hraness", href: "https://hraness.com" };
export const articleParty: ArticleParty = { kind: "Organization", name: "Hraness" };

type TocItem = Readonly<{ href: `#${string}`; label: string }>;

export type OhArticle = Readonly<{
  slug: string;
  title: string;
  dek: string;
  eyebrow: string;
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
    dek: "A pipeline that gives GPT-5 mini every user message averaged 93.07% over three runs on the 500 LongMemEval-S questions it was tuned on, against 88.87% for Oh semantic retrieval and 86.13% for BM25.",
    eyebrow: "Benchmark",
    published: "2026-09-26",
    keywords: ["LongMemEval", "agent memory", "long-term memory", "retrieval", "BM25", "semantic search", "GPT-5 mini"],
    toc: longMemEvalUserLogToc,
    Body: LongMemEvalUserLogBody,
    admission: admissionFor("longmemeval-s-user-log"),
  },
  {
    slug: "introducing-oh",
    title: "Introducing Oh",
    dek: "An agent using Oh can write and nominate notes, but only your application’s own code can adopt them into reviewed knowledge, and the host sets each note’s author and timestamp.",
    eyebrow: "Release",
    published: "2026-09-24",
    keywords: ["agent memory", "provenance", "knowledge graphs", "canonical JSON", "TypeScript", "Rust"],
    toc: introducingOhToc,
    Body: IntroducingOhBody,
    admission: admissionFor("introducing-oh"),
  },
  {
    slug: "oh-rust-typescript-parity",
    title: "Oh holds its Rust encoder to the TypeScript reference byte for byte",
    dek: "Oh tests its opt-in Rust encoder against the TypeScript reference on thousands of generated inputs, and checks that an installed copy loads the Rust engine at all.",
    eyebrow: "Technique",
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
    dek: "Two Hraness products use Oh for different jobs: Sponge keeps its hosted agent’s working memory in it, and Wordcell answers graph questions about your Markdown with it.",
    eyebrow: "Integration",
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
      alt: article.title,
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
