export const toc = [] as const;

export function BuiltOnOhBody() {
  return (
    <>
      <p>Two Hraness products build on Oh, and each keeps its record in a different place. Wordcell keeps your Markdown files as the record and derives a graph from them. Sponge’s hosted library keeps temporary agent notes in an Oh store, apart from the knowledge a person has reviewed. Each product pins its own Oh release and upgrades on its own schedule.</p>
      <h2 id="wordcell-derived-graph">Wordcell answers graph queries with Oh</h2>
      <p><a href="https://wordcell.io">Wordcell</a> is a Markdown knowledge base that gives agents the decisions behind code. It rebuilds a disposable Oh graph from your Markdown to answer named graph queries with source proofs. Markdown and Git stay the record, and Wordcell’s search does not use Oh’s memory retrieval.</p>
      <p><a href="https://wordcell.io/blog/how-wordcell-uses-oh">How Wordcell uses Oh</a> follows a graph answer back to the notes behind it.</p>
      <h2 id="sponge-working-memory">Sponge’s hosted library keeps agent working memory in Oh</h2>
      <p><a href="https://sponge.computer">Sponge</a> runs deep research on your own machine. Its earlier hosted library at sponge.computer keeps its research agents’ working memory in a server-side Oh store, separate from the reviewed knowledge in its product database. Each working session expires 24 hours after it opens. The agent can read the reviewed knowledge but can change only its own notes.</p>
      <p>The hosted library stopped accepting new research on September 12, 2026, so this memory serves only work accepted before that date. <a href="https://sponge.computer/docs/how-sponge-uses-oh">How Sponge uses Oh</a> describes the sessions and what the Memory panel shows.</p>
      <h2 id="choose-the-record-first">Choose the record first</h2>
      <p>Before choosing a memory layer, decide which material must survive and who may change it. An application may need a store for records it owns. A Markdown tool may need a derived index that can always be rebuilt. Temporary agent notes may need an expiry policy and a separate route into reviewed knowledge.</p>
      <p>Oh provides the record and query mechanisms; the application defines those ownership and retention rules. <a href="/blog/introducing-oh">Introducing Oh</a> shows how records, source links, and review fit together.</p>
    </>
  );
}
