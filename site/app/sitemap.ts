import { createBlogSitemapPaths, createSitemap } from "@hraness/web-discovery";
import type { MetadataRoute } from "next";

import { articleDiscovery, blogPath, indexableArticles, ohSearchSite } from "./blog/articles";

export const dynamic = "force-static";

// Canonical HTML pages only. Quarantined articles stay out until they pass review.
export default function sitemap(): MetadataRoute.Sitemap {
  return createSitemap(ohSearchSite.origin, [
    { changeFrequency: "monthly", path: "/", priority: 1 },
    { changeFrequency: "monthly", path: "/spec", priority: 0.9 },
    ...createBlogSitemapPaths({ path: blogPath }, indexableArticles.map(articleDiscovery)),
  ]);
}
