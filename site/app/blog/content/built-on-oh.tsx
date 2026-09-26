// Converted from the reviewed draft. Keep the prose; edit facts only with a new review.
// Sponge and Wordcell stay unlinked until the portfolio registers their relations
// to Oh; then render each entry from its relation detail.
import publishedRelease from "../../../published-release.json";
import { homeDescription } from "../../metadata-copy";

export const toc = [] as const;

export function BuiltOnOhBody() {
  const releaseVersion = publishedRelease.version;
  return (
    <>
      <p>Two Hraness products use <a href="/">Oh</a>: Sponge and Wordcell. Each entry below says what the product uses Oh for.</p>
      <p>{homeDescription} An agent’s working memory lives in a separate store that the host can purge, and only the host application’s own code can adopt a record from it into the reviewed store. {`Latest release: v${releaseVersion}.`}</p>
      <h2 id="products-that-use-oh">Products that use Oh</h2>
      <p><strong>Sponge.</strong> Sponge keeps its hosted agent’s working notes in a separate server-side Oh store that expires 24 hours after each session opens; the hosted agent finishes only work Sponge accepted before 2026-09-12.</p>
      <p><strong>Wordcell.</strong> Wordcell rebuilds a disposable Oh graph from your Markdown to answer named graph queries with source proofs; Markdown and Git stay the record, and search does not use Oh’s memory retrieval.</p>
      <h2 id="oh-or-wordcell-for-your-project">Oh or Wordcell for your project</h2>
      <p>Sponge runs Oh on its server as its agent’s working memory, and that store is the record for those working notes. Wordcell keeps no record in Oh. A default query builds a graph in memory from your notes and discards it, <code>{"wordcell graph rebuild"}</code> writes a disposable local cache, and your Markdown stays the only record. Oh’s README draws the line the same way: use Oh to build an application’s memory layer, and use Wordcell to maintain and query a Markdown knowledge base.</p>
      <h2 id="how-each-product-upgrades-oh">How each product upgrades Oh</h2>
      <p>Each product depends on a published Oh release, pins its own version, and upgrades when it chooses, so Sponge and Wordcell can run different Oh versions at the same time. When a product starts or stops using Oh, or changes what it uses Oh for, its entry here changes with it.</p>
      <p>For what Oh itself does, read <a href="/blog/introducing-oh">Introducing Oh</a>.</p>
    </>
  );
}
