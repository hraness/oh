import { createBlogSitemapPaths, createSitemap } from "@hraness/web-discovery";
import type { MetadataRoute } from "next";

import { articleDiscovery, blogPath, indexableArticles, ohSearchSite } from "./blog/articles";

export const dynamic = "force-static";

// Canonical HTML pages only. Quarantined articles stay out until they pass review.
export default function sitemap(): MetadataRoute.Sitemap {
  return createSitemap(ohSearchSite.origin, [
    { changeFrequency: "monthly", path: "/", priority: 1 },
    { changeFrequency: "monthly", path: "/docs", priority: 0.9 },
    { changeFrequency: "monthly", path: "/docs/sdk", priority: 0.8 },
    { changeFrequency: "monthly", path: "/benchmarks", priority: 0.8 },
    { changeFrequency: "monthly", path: "/compare", priority: 0.8 },
    { changeFrequency: "monthly", path: "/compare/mem0", priority: 0.8 },
    { changeFrequency: "monthly", path: "/compare/supermemory", priority: 0.8 },
    { changeFrequency: "monthly", path: "/spec", priority: 0.9 },
    ...createBlogSitemapPaths({ path: blogPath }, indexableArticles.map(articleDiscovery)),
  ]);
}
