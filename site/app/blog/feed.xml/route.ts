import { ATOM_FEED_CONTENT_TYPE, createAtomFeed, createFeedEntry } from "@hraness/web-discovery";

import { articleDiscovery, feedDiscovery, indexableArticles, ohSearchSite } from "../articles";

export const dynamic = "force-static";

// Only indexable posts enter the feed; quarantined posts stay out of discovery.
export function GET() {
  const entries = indexableArticles.map((article) => createFeedEntry(articleDiscovery(article)));
  return new Response(createAtomFeed(ohSearchSite, feedDiscovery, entries), {
    headers: { "content-type": ATOM_FEED_CONTENT_TYPE },
  });
}
