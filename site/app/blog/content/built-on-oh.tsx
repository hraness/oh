// Converted from the reviewed draft. Keep the prose; edit facts only with a new review.
import publishedRelease from "../../../published-release.json";

export const toc = [] as const;

export function BuiltOnOhBody() {
  const releaseVersion = publishedRelease.version;
  return (
    <>
      <p>Two Hraness products use <a href="/">Oh</a>: Sponge and Wordcell. Each entry below gives the product&apos;s one-sentence description of what it uses Oh for and links to the longer post on that product&apos;s site.</p>
      <p>Oh is an open-source memory framework for agents. It stores each fact with its source and records every accepted change so it can be inspected. An agent&apos;s working memory stays in a separate store that can be purged, until the host application&apos;s own code adopts a record into the reviewed store. {`Latest release: v${releaseVersion}.`}</p>
      <h2 id="products-that-use-oh">Products that use Oh</h2>
      <p><strong><a href="https://sponge.computer">Sponge</a>.</strong> Sponge keeps its hosted agent&apos;s working memory in a server-side Oh store that expires with the session, separate from the product data in Sponge&apos;s own databases. Read <a href="https://sponge.computer/docs/how-sponge-uses-oh">how Sponge uses Oh</a>.</p>
      <p><strong><a href="https://wordcell.io">Wordcell</a>.</strong> Wordcell rebuilds a disposable Oh graph from your Markdown to answer named graph queries with source proofs; Markdown and Git stay the record, and search does not use Oh&apos;s memory retrieval. Read <a href="https://wordcell.io/blog/how-wordcell-uses-oh">how Wordcell uses Oh</a>.</p>
      <h2 id="oh-or-wordcell-for-your-project">Oh or Wordcell for your project</h2>
      <p>Sponge runs Oh on its server as its agent&apos;s working memory, and that store is the record for those working notes. Wordcell keeps no record in Oh. A default query builds a graph in memory from your notes and discards it, <code>{"wordcell graph rebuild"}</code> writes a disposable local cache, and your Markdown stays the only record. Oh&apos;s README draws the line the same way: use Oh to build an application&apos;s memory layer, and use Wordcell to maintain and query a Markdown knowledge base.</p>
      <h2 id="how-a-product-gets-listed">How a product gets listed</h2>
      <p>A product appears here when the Hraness portfolio registry records its relation to Oh with a one-sentence description. Each listed product depends on a published Oh release, pins its own version, and upgrades when it chooses, so Sponge and Wordcell can run different Oh versions at the same time. When a product starts or stops using Oh, or changes what it uses Oh for, its entry changes with it.</p>
      <p>For what Oh itself does, read <a href="/blog/introducing-oh">Introducing Oh</a>.</p>
    </>
  );
}
