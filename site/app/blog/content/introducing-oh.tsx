// Converted from the reviewed draft. Keep the prose; edit facts only with a new review.
// The draft's links to the consumer posts wait until those posts are live.
import publishedRelease from "../../../published-release.json";

export const toc = [
  { href: "#a-memory-you-can-question-later", label: "A memory you can question later" },
  { href: "#who-oh-is-for", label: "Who Oh is for" },
  { href: "#what-oh-does-today", label: "What Oh does today" },
  { href: "#shared-parts-for-other-hraness-products", label: "Shared parts for other Hraness products" },
  { href: "#limits-of-the-current-release", label: "Limits of the current release" },
] as const;

export function IntroducingOhBody() {
  const releaseVersion = publishedRelease.version;
  return (
    <>
      <p>Oh is an open-source memory store for agents. It keeps each fact as a record with its sources attached and writes every accepted change to a log you can replay. The notes an agent writes while it works stay apart from the knowledge a person has reviewed, so when an agent tells you something wrong, you can see what it stored, where that came from, and whether anyone checked it.</p>
      <h2 id="a-memory-you-can-question-later">A memory you can question later</h2>
      <p>Picture a research assistant that reads a trial report on Monday and tells a colleague on Thursday that the study&apos;s primary endpoint was measured at 12 weeks. If the memory is a pile of text chunks in a vector index, the best you can do is search for similar text and hope the right chunk comes back. You can&apos;t see which report the claim came from, which table supported it, or whether the agent wrote it before or after someone corrected the source.</p>
      <p>Oh stores that same work as linked records. The question, the source, the captured edition of the source, the claim, the evidence that bears on it, and the brief that came out of it are separate records, each with a stable key and a digest of its content. The README walks through this chain:</p>
      <pre data-language="text"><code>{"inquiry:primary-endpoint\n  → entity:trial-report\n  → edition:trial-report-v1\n  → statement:endpoint-12-weeks\n  → assertion:endpoint-12-weeks\n  → evidence:table-2\n  → view:review-brief"}</code></pre>
      <p>Months later you can follow that path back from the brief to the table it rests on. A claim and the act of accepting it are separate records, so &quot;the report says 12 weeks&quot; and &quot;our reviewer accepted that&quot; can be checked one at a time.</p>
      <h2 id="who-oh-is-for">Who Oh is for</h2>
      <p>Oh is for developers building an agent or a knowledge application who need memory that the agent can write to and that people can audit afterwards. It fits research tools, assistants that run over long sessions, and any product where someone will eventually ask &quot;why does the system believe this?&quot;</p>
      <p>If what you want is a Markdown notebook that you query, use <a href="https://wordcell.io">Wordcell</a> instead. Oh&apos;s own README draws that line: use Oh to build an application&apos;s memory layer, and Wordcell to maintain and query a Markdown knowledge base.</p>
      <h2 id="what-oh-does-today">What Oh does today</h2>
      <p>Oh ships as a TypeScript SDK, a command-line tool called <code>{"oh"}</code>, and an Agent Skill, all sharing one versioned record format. By default, records and their history live in a single local SQLite file, and a libSQL store is available for server runtimes. The first run needs no account, no hosted model, and no remote database. Search indexes are built from the records, and you can delete and rebuild them at any time.</p>
      <p>The first run from the README creates one record, reads it back, finds it by keyword, and checks the log:</p>
      <pre data-language="sh"><code>{"oh init\noh put \\\n  --kind entity \\\n  --key entity:ada-lovelace \\\n  --json '{\"name\":\"Ada Lovelace\",\"role\":\"mathematician\"}'\noh get entity:ada-lovelace\noh search \"mathematician\" --mode keyword\noh verify"}</code></pre>
      <p>Every command except help and <code>{"oh version"}</code> prints JSON in Oh&apos;s canonical form, described below. <code>{"oh verify"}</code> replays the operation log and confirms that each step&apos;s digest still matches. When two writers race, the later write fails with a conflict error instead of overwriting the earlier one. Oh&apos;s documentation advises reading the new state, reconciling, and submitting again.</p>
      <p>Install instructions and the checksum for the current release are in the <a href="https://github.com/hraness/oh#install-and-first-run">README</a>.</p>
      <h3 id="working-notes-and-reviewed-knowledge-stay-apart">Working notes and reviewed knowledge stay apart</h3>
      <p>The memory part of the SDK takes two stores. A working store holds what the agent writes as it goes, and a hosting application can purge it. A second store holds reviewed knowledge, pinned at a known point in its history. The SDK hands your application two separate objects:</p>
      <ul>
        <li>The agent&apos;s object has four methods: <code>{"remember"}</code>, <code>{"query"}</code>, <code>{"explain"}</code>, and <code>{"nominate"}</code>. It cannot write to the reviewed store, choose a database, or purge anything.</li>
        <li>The host&apos;s object, which your trusted code keeps, is the only part of this interface that can move working records into reviewed knowledge. Oh&apos;s memory specification requires that a model-facing adapter receive only the agent&apos;s object.</li>
      </ul>
      <p>When the agent believes something should become reviewed knowledge, it nominates it. Your code, after whatever review you run, adopts the nomination:</p>
      <pre data-language="ts"><code>{"// The agent proposes; it cannot commit to reviewed memory itself.\nconst nomination = await memory.agent.nominate({\n  nominationId: \"knowledge-review\",\n  roots: [\"edition:reviewed-summary\"],\n  v: 1,\n});\n\n// Trusted host code adopts it after review.\nawait memory.host.adoptNomination({\n  expectedCanonicalHead: reviewedHead,\n  nomination,\n  v: 1,\n});"}</code></pre>
      <p>Adoption inserts records that are new and fails if a key already holds different content, unless your code names the exact prior version it means to replace. The agent&apos;s writes carry an actor and a timestamp that the host supplies. The agent&apos;s object doesn&apos;t accept an actor or timestamp from the caller, and the host clock never moves backwards, so a model can&apos;t claim to be someone else or backdate a note.</p>
      <h3 id="two-implementations-of-one-format">Two implementations of one format</h3>
      <p>Oh&apos;s records use one encoding, canonical JSON: object keys are sorted in a fixed order and each number prints one way. A record&apos;s digest is the SHA-256 of its canonical bytes. If two programs encode the same record differently by a single byte, the digests differ and the history no longer verifies.</p>
      <p>Oh has a TypeScript reference encoder and a Rust encoder compiled to WebAssembly. The Rust crate is written to produce output byte for byte identical to the TypeScript reference for every plain JSON value the reference accepts. The property the tests check is short:</p>
      <pre data-language="ts"><code>{"// Checked on each generated JSON text:\nrust.canonicalJson(text) === canonicalJson(JSON.parse(text));\nrust.canonicalSha256(text) === canonicalSha256(JSON.parse(text));\n\n// Keys sort; both engines agree on the bytes.\ncanonicalJson({ b: 1, a: 2 }); // '{\"a\":2,\"b\":1}'\n\n// Negative zero is refused by both.\nrust.canonicalJson(\"-0\"); // throws"}</code></pre>
      <p>The parity suite checks this on generated inputs: 1,000 generated documents for the encoding, 1,000 for the digest, and 20,000 generated finite floating-point numbers to check that Rust formats numbers exactly as JavaScript does. The generated documents share one fixed shape (short integer arrays, small string-keyed maps, and a nested flag), and a list of hand-written edge cases covers empty values, escapes, surrogate pairs, and key order. These are samples, so they show agreement on the inputs tested and do not prove it for every possible input. The TypeScript version stays the reference. The Rust engine is optional, and the base package still has no required runtime dependencies. The companion post on <a href="/blog/oh-rust-typescript-parity">keeping the TypeScript and Rust encoders identical</a> goes through the method.</p>
      <h2 id="shared-parts-for-other-hraness-products">Shared parts for other Hraness products</h2>
      <p>Oh keeps records and operations in one SQLite file you control. Every accepted change can be inspected through digests and replay, and search and derived answers are treated as views that never become the record. Oh&apos;s README calls this the design every Hraness project shares.</p>
      <p>The Rust foundations plan extends that. It builds the canonical encoding, a strict archive reader, and a rule engine for graph queries in Rust so other Hraness products can reuse them, with WebAssembly as the default and native bindings as an opt-in. The TypeScript implementations stay authoritative until each Rust replacement proves byte-exact parity. Two products already build on Oh, each pinning its own release:</p>
      <ul>
        <li><a href="https://sponge.computer">Sponge</a> keeps its hosted agent&apos;s working memory in a server-side Oh store that expires with the session, separate from the product data in Sponge&apos;s own databases.</li>
        <li><a href="https://wordcell.io">Wordcell</a> rebuilds a disposable Oh graph from your Markdown to answer named graph queries with source proofs. Markdown and Git stay the record, and search does not use Oh&apos;s memory retrieval.</li>
      </ul>
      <p>The <a href="/blog/built-on-oh">list of products built on Oh</a> collects these.</p>
      <h2 id="limits-of-the-current-release">Limits of the current release</h2>
      <p>Oh does not claim to retrieve better than other memory frameworks. Its README states that superiority over Letta, Supermemory, and other frameworks has not been established.</p>
      <p>Sync accepts only histories that extend each other. When two copies diverge, sync stops and reports the divergence without merging. Graph answers derived by rules come with proofs, and the store never adopts them as records on its own. The CLI and local SQLite store need Bun 1.3.14 or newer; the libSQL store also runs on Node 24 serverless runtimes. The optional research vocabularies map selected Wikidata properties, not all of Wikidata.</p>
      <p>Oh is MIT-licensed and free, with no account required. Latest release: v{releaseVersion}.</p>
    </>
  );
}
