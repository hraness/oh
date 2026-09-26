import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { DesignPaletteMenuButton } from "@hraness/design-kit/react";
import { AskAiAboutThis } from "@hraness/ui";
import type { Metadata } from "next";
import contract from "../../public/spec/v1/contract.json";
import manifest from "../../public/spec/manifest.json";
import { specificationDescription, specificationImageAlt, specificationTitle } from "../metadata-copy";
import { OhContentFooter } from "../site-footer";

const currentVersion = manifest.versions.find((version) => version.id === manifest.current) ??
  (() => {
    throw new Error("The public specification manifest has no current version.");
  })();

const sentenceCase = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

export const metadata: Metadata = {
  title: specificationTitle,
  description: specificationDescription,
  alternates: { canonical: "/spec" },
  openGraph: {
    title: specificationTitle,
    description: specificationDescription,
    images: [{
      alt: specificationImageAlt,
      height: 630,
      url: "/spec/opengraph-image",
      width: 1200,
    }],
    url: "/spec",
  },
  twitter: {
    card: "summary_large_image",
    title: specificationTitle,
    description: specificationDescription,
    images: [{ alt: specificationImageAlt, url: "/spec/opengraph-image" }],
  },
};

const sections = [
  ["contract", "Contract"],
  ["ontology", "Ontology"],
  ["records", "Records"],
  ["sqlite", "SQLite"],
  ["sync", "Sync"],
  ["semantic", "Semantic search"],
  ["projection", "Derived projection"],
  ["memory", "Composite memory"],
  ["versioning", "Versioning"],
] as const;

export default function Specification() {
  return (
    <>
      <a className="skip-link" href="#spec-main">Skip to specification</a>
      <MarketingSiteHeader
        trailing={<DesignPaletteMenuButton />}
        action={{ href: "/#install", label: "Install Oh" }}
        ariaLabel="Specification navigation"
        brand="Oh"
        brandMark="/marks/oh-computer.svg"
        brandLabel="Oh home"
        className="spec-header"
        links={[
          { href: "/", label: "Overview" },
          { href: "/blog", label: "Blog" },
          { current: true, href: "/spec", label: "Specification" },
          { href: "https://github.com/hraness/oh", label: "GitHub" },
        ]}
      />

      <main className="spec-shell" id="spec-main" tabIndex={-1}>
        <aside className="spec-nav" aria-label="On this page">
          <p>Ontology v1</p>
          {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </aside>

        <article className="spec-document">
          <header className="spec-intro">
            <div>
              <p className="eyebrow">
                {sentenceCase(currentVersion.status)} specification · ontology {contract.ontologyVersion}
              </p>
              <h1>Oh ontology<br />specification</h1>
            </div>
            <p>
              This specification defines the records, storage, and sync
              protocol that independent Oh implementations need to work
              together, down to the bytes each digest covers. Records,
              operations, and the contract each carry a SHA-256 digest of their
              canonical JSON, an encoding that gives each value exactly one
              byte sequence. By default the local SQLite database is the
              source of truth; network sync and semantic search are optional
              and replaceable.
            </p>
          </header>

          <section id="contract" className="spec-section">
            <div className="spec-number">01</div>
            <div>
              <h2>Contract</h2>
              <p>
                Version 1 is identified by <code>{contract.contractId}</code>. Its
                contract manifest is a small JSON file that fixes the ontology
                version, the graph format, and the schema format and lists every
                record kind. It also carries a SHA-256 digest of its other
                fields, so two implementations can confirm they follow the same
                contract. The SQLite schema and the sync protocol carry versions
                of their own.
              </p>
              <div className="fact-grid">
                <div><span>Ontology</span><strong>{contract.ontologyVersion}</strong></div>
                <div><span>Graph format</span><strong>{contract.graphFormatVersion}</strong></div>
                <div><span>Schema format</span><strong>{contract.schemaFormatVersion}</strong></div>
                <div><span>SQLite schema</span><strong>2</strong></div>
                <div><span>Sync protocol</span><strong>oh.sync.v1</strong></div>
                <div><span>Hash</span><strong>SHA-256</strong></div>
              </div>
            </div>
          </section>

          <section id="ontology" className="spec-section">
            <div className="spec-number">02</div>
            <div>
              <h2>Ontology</h2>
              <p>
                The ontology separates identity (entities), propositions
                (statements), stances (assertions), evidence, context, inquiry,
                and projections, which are views computed from the graph rather
                than stored in it. A proposition is kept apart from anyone’s
                stance on it, evidence from the assertion it bears on, and
                authored knowledge from any view derived from it. A conforming
                implementation rejects malformed or noncanonical input. A
                record’s value can be any canonical JSON, and a registered codec
                can hold one record kind to a stricter format.
              </p>
              <ul className="kind-grid" aria-label="Graph record kinds">
                {contract.recordKinds.map((kind) => <li key={kind}>{kind}</li>)}
              </ul>
            </div>
          </section>

          <section id="records" className="spec-section">
            <div className="spec-number">03</div>
            <div>
              <h2>Records and revisions</h2>
              <p>
                A record has one stable key, one kind from the fixed list, an
                ordered list of unique dependencies, a JSON value, and a SHA-256
                digest of those fields and the format version in canonical JSON.
                A revision applies an ordered, nonempty set of puts and
                tombstones (writes and deletions) to one parent. The resulting
                record references and their combined digest are part of the
                revision’s identity. An operation, one entry in the log, wraps a
                revision with the writer’s ID, the contract ID, a timestamp, the
                space it belongs to, a sequence number, and the digest of the
                operation before it.
              </p>
              <pre className="spec-code"><code>{`{
  "dependencies": ["entity:flywire"],
  "key": "statement:connectome-scope",
  "kind": "statement",
  "recordSha256": "<64 lowercase hex>",
  "v": 1,
  "value": { "...": "canonical JSON" }
}`}</code></pre>
              <p className="callout">
                Canonical JSON sorts object keys by UTF-16 code units, preserves
                array order, writes no insignificant whitespace, rejects
                non-finite numbers and other unsupported values, and never
                normalizes user strings implicitly.
              </p>
            </div>
          </section>

          <section id="sqlite" className="spec-section">
            <div className="spec-number">04</div>
            <div>
              <h2>Local SQLite storage</h2>
              <p>
                One <code>BEGIN IMMEDIATE</code> transaction appends the operation,
                applies records and dependencies, advances the generation and
                graph head, updates the full-text index, and adds the sync outbox
                row. Every commit names the head it expects, meaning the
                generation and the digest of the latest operation, and fails
                without changing anything if another write moved the head first
                (compare-and-swap). The SDK and CLI fill in the current head when
                the caller names none.
              </p>
              <ol className="sequence">
                <li><span>Validate</span> the contract, parent, dependencies, and canonical bytes.</li>
                <li><span>Append</span> one immutable operation and its ordered changes.</li>
                <li><span>Advance</span> the space generation and graph revision atomically.</li>
                <li><span>Update</span> the rebuildable full-text index; semantic indexing runs as a separate call.</li>
              </ol>
            </div>
          </section>

          <section id="sync" className="spec-section">
            <div className="spec-number">05</div>
            <div>
              <h2>Operation-level sync</h2>
              <p>
                Sync exchanges immutable operations, never database pages, row
                snapshots, or search indexes. Peers first compare their complete
                contract manifests, and a mismatch fails before any operation is
                exchanged. Each round then compares the two heads and sends one
                bundle toward the side that is behind, until the heads match. A
                bundle is a contiguous run of at most 1,000 operations and 64 MiB
                plus 4 KiB; by default a round carries up to 100 operations, and
                sync runs at most 100 rounds. Receiving a bundle that is already
                in the log changes nothing. Every imported operation must extend the local head; a
                chain that does not is a sync conflict, and a failure partway
                through a bundle keeps none of it. There is no last-write-wins
                merge: divergent histories stay intact until the application
                merges them.
              </p>
              <p>
                A transport implements four methods: handshake, head, pull, and
                push. The included libSQL adapter, which also works with Turso,
                stores only contract manifests and the operation log, and your
                application supplies the client, credentials, endpoint, access
                rules, retries, and backups. With this adapter, the local store
                stays the source of truth. A separate promise-based store can
                instead keep the records themselves in libSQL, without importing
                Bun’s SQLite module.
              </p>
            </div>
          </section>

          <section id="semantic" className="spec-section">
            <div className="spec-number">06</div>
            <div>
              <h2>Semantic search</h2>
              <p>
                Oh publishes two embedding profiles for the EmbeddingGemma
                model: a local QMD <code>embeddinggemma-300M-Q8_0</code> profile
                pinned to an exact engine release and model file, and an
                optional Cloudflare Workers AI profile, pinned by a published
                digest, with a direct libSQL cache. Both produce 768-dimensional
                vectors compared by cosine similarity, but Oh does not treat
                vectors from the two profiles as interchangeable. A third
                profile searches precomputed OpenAI
                {" "}<code>text-embedding-3-small</code> vectors (1,536 dimensions)
                that the application supplies. Before returning a hit, Oh checks
                it against the digest of the record’s current version.
              </p>
              <p className="callout">
                Vector caches are derived from the records and can be rebuilt.
                Version 2 of the hosted cache keys each vector by the digests of
                the profile, the renderer that turns a record into text, and the
                exact text embedded, plus an isolation digest that the host (the
                application that embeds Oh) supplies or Oh derives from the ID
                of the record set. Vectors are reused only within one isolation,
                so purging one record set never deletes vectors another still
                uses. The isolation digest never changes the text sent to the
                provider, and it is not encryption. Keyword search works without
                a model, and a failure at the hosted provider does not affect
                exact graph reads, writes, or Datalog queries.
              </p>
            </div>
          </section>

          <section id="projection" className="spec-section">
            <div className="spec-number">07</div>
            <div>
              <h2>Derived projection</h2>
              <p>
                A projection runs positive Datalog rules, including recursive
                ones, over facts extracted from one exact graph snapshot. Its
                input digest binds that snapshot, the fact pack’s ID and
                revision, the digest of the code that extracted the facts, and
                the facts themselves. Rules may not use negation, aggregation,
                arithmetic, function symbols, or callbacks. Rules,
                queries, inputs, and results are identified by digests of their
                canonical bytes. Hard limits cap tuples, rounds, joins, total
                work, and proof trees, and a caller may lower the limits on
                derived tuples, rounds, proofs, and total work.
              </p>
              <p className="callout">
                A projection row is derived output. It never becomes an
                assertion, a review decision, or operation history by itself;
                an application that wants to keep a conclusion must create and
                review new records through its ordinary write path.
              </p>
            </div>
          </section>

          <section id="memory" className="spec-section">
            <div className="spec-number">08</div>
            <div>
              <h2>Composite agent memory</h2>
              <p>
                Composite memory gives an agent one interface over two Oh
                stores. The agent writes to a working store, which the host can
                purge. Every query also reads a canonical store that only host
                code can change, pinned at a head the host selects. The agent
                runs only the named query programs the host registers. Those
                programs run over facts tagged with the store each came from,
                plus facts that mark keys where the two stores agree or
                conflict, so neither store silently overrides the other. For a
                result row, <code>explain</code> returns a size-limited proof
                that traces it to its store, its record, and the fact pack or
                extractor that produced each fact. The agent object exposes no
                store location and no way to write to the canonical store.
              </p>
              <p>
                The V2 query interface lets the host name the query variables an
                agent may fill with primitive JSON values, and returns results
                in pages of at most 256 rows. Each continuation cursor is
                authenticated and stops working if either store’s head, the
                program, the parameters, or the complete result changes. A host
                that rebuilds the interface or routes cursors to another replica
                must supply the same secret key for those cursors to
                authenticate. When the host moves the canonical pin to a newer
                head, an explanation issued earlier still refers to its original
                result, and explanations from before and after the move share
                one store, capped at 256 entries and 64 MiB.
              </p>
              <p className="callout">
                An agent proposes records for the canonical store by nominating
                them together with every record they depend on. Only host code
                can adopt a nomination. Adoption re-exports the records from the
                working store, requires them to match the proposal byte for
                byte, and adds the records the canonical store lacks in one
                compare-and-swap operation. If the canonical store holds a
                different version of a record, adoption fails unless trusted
                host code names that record’s key and the exact prior digest
                it reviewed; a stale or missing replacement claim blocks the
                whole write. Adoption also fails if the canonical snapshot would
                exceed 8,192 records or 32 MiB. After the commit, adoption pins
                the store’s current head; if another write landed first, it
                pins that later head only after checking that it still holds
                every adopted record, so the pin never moves backward. A
                derived result never enters the canonical store on its own.
              </p>
              <p>
                The stable memory-page format stores one Markdown page in an
                ordinary <code>edition</code> record, not a new database,
                ontology, or search index. The page value is at most 768 KiB
                and lists up to 128 sources, each with its URL, title, the time
                the host read it, and a digest of the bytes it read. Its
                provenance entry has kind <code>host-attested</code>, meaning
                the host vouches for the page: the entry names the host’s actor
                and the time it vouched, plus the digest of a supporting
                document the host keeps. The codec checks that the digest is
                well formed but does not fetch that document, verify a
                signature, or decide whether the actor was authorized. A page’s
                canonical <code>.oh.md</code> file is a self-contained copy of
                that one record for moving it between systems, while an
                ordinary Oh bundle carries operations and their records. Memory
                pages hold no vectors, scores, embedding model, or search
                configuration.
              </p>
            </div>
          </section>

          <section id="versioning" className="spec-section">
            <div className="spec-number">09</div>
            <div>
              <h2>Versioning and evolution</h2>
              <p>
                The contract, graph format, schema format, SQLite layout, sync
                protocol, and embedding profiles each carry a version of their
                own, separate from the package’s release number. Oh refuses a
                contract, record, sync, or embedding profile version it does not
                know, and it refuses a database where a released migration was
                applied with different bytes. Any change to serialized keys,
                accepted values, ordering, digest inputs, record kinds, limits,
                migration SQL, or protocol meaning needs a new version; the
                bytes behind existing digests and applied migrations are never
                edited in place.
              </p>
              <div className="spec-actions">
                <a className="hraness-marketing-action" data-emphasis="primary" href="/spec/manifest.json">Specification index (JSON)</a>
                <a className="hraness-marketing-action" data-emphasis="secondary" href="https://github.com/hraness/oh/tree/main/spec">Source files</a>
              </div>
            </div>
          </section>
        </article>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://oh.computer/spec" />
      <OhContentFooter />
    </>
  );
}
