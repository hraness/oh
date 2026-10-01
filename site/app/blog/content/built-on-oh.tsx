export const toc = [] as const;

export function BuiltOnOhBody() {
  return (
    <>
      <p>A memory library can hold an application’s records or build a view over records that live elsewhere. Two Hraness integrations illustrate the difference: Sponge uses Oh for temporary agent working notes, while Wordcell derives a graph from Markdown files.</p>
      <h2 id="sponge-working-memory">Sponge: temporary working memory</h2>
      <p><a href="https://sponge.computer">Sponge</a> uses a separate server-side Oh store for its retained hosted-agent work. That store expires by default 24 hours after the session opens. The agent can propose a record for review; the host application controls whether it becomes reviewed knowledge.</p>
      <p>Sponge does not accept new hosted-agent work. The integration illustrates a storage boundary: temporary notes can be removed without giving the agent authority to promote them into a lasting record.</p>
      <h2 id="wordcell-derived-graph">Wordcell: a graph derived from Markdown</h2>
      <p><a href="https://wordcell.io">Wordcell</a> keeps Markdown files as the record. It builds an Oh graph to answer named queries about links and relationships, with source proofs that point back to the notes. A default query builds that graph in memory and discards it afterward.</p>
      <p><code>wordcell graph rebuild</code> writes a disposable local cache. Deleting the cache removes a way to query the notes, not the notes themselves. Wordcell’s text search is separate from Oh’s memory retrieval.</p>
      <h2 id="choose-the-record-first">Choose the record first</h2>
      <p>Before choosing a memory layer, decide which material must survive and who may change it. An application may need a store for records it owns. A Markdown tool may need a derived index that can always be rebuilt. Temporary agent notes may need an expiry policy and a separate route into reviewed knowledge.</p>
      <p>Oh provides the record and query mechanisms; the application defines those ownership and retention rules. <a href="/blog/introducing-oh">Introducing Oh</a> shows how the records, source links, and review boundary fit together.</p>
    </>
  );
}
