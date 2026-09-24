import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { DesignPaletteMenuButton } from "@hraness/design-kit/react";
import { AskAiAboutThis } from "@hraness/ui";
import type { Metadata } from "next";
import contract from "../../public/spec/v1/contract.json";
import manifest from "../../public/spec/manifest.json";
import { specificationDescription, specificationTitle } from "../metadata-copy";
import { OhContentFooter } from "../site-footer";

const currentVersion = manifest.versions.find((version) => version.id === manifest.current) ??
  (() => {
    throw new Error("The public specification manifest has no current version.");
  })();

export const metadata: Metadata = {
  title: specificationTitle,
  description: specificationDescription,
  alternates: { canonical: "/spec" },
  openGraph: {
    title: specificationTitle,
    description: specificationDescription,
    images: [{
      alt: specificationTitle,
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
    images: ["/spec/opengraph-image"],
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
                {currentVersion.status} specification · {contract.ontologyVersion}
              </p>
              <h1>Oh ontology<br />specification</h1>
            </div>
            <p>
              This specification defines the records, storage, and sync
              protocol that independent Oh implementations need to
              interoperate, down to the canonical bytes. By default the local
              SQLite database is the source of truth, and network sync and
              semantic search are optional and replaceable.
            </p>
          </header>

          <section id="contract" className="spec-section">
            <div className="spec-number">01</div>
            <div>
              <h2>Contract</h2>
              <p>
                Version 1 is identified by <code>{contract.contractId}</code>. Its
                manifest pins ontology, graph, and schema versions together with
                the complete record-kind vocabulary and a SHA-256 digest of the
                canonical manifest bytes.
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
                The kernel separates identity, propositions, stances, evidence,
                context, inquiry, and projection. Graph envelopes and typed
                contract records enter through strict parsers from
                <code>unknown</code>. Application values remain canonical JSON
                unless a consumer selects a registered codec.
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
                A record has one stable key, a closed kind, ordered unique
                dependencies, a JSON value, and a digest over its canonical
                preimage. A revision applies a nonempty ordered set of puts and
                tombstones against one parent. The resulting record references
                and their aggregate digest are part of the revision identity.
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
                array order, rejects non-finite numbers and unsupported values,
                and never normalizes user strings implicitly.
              </p>
            </div>
          </section>

          <section id="sqlite" className="spec-section">
            <div className="spec-number">04</div>
            <div>
              <h2>Local SQLite authority</h2>
              <p>
                One <code>BEGIN IMMEDIATE</code> transaction appends the operation,
                applies records and dependencies, advances the generation and
                graph head, updates full-text materialization, and adds the sync
                outbox row. Generation compare-and-swap prevents silent forks.
              </p>
              <ol className="sequence">
                <li><span>Validate</span> contract, parent, dependencies, and canonical bytes.</li>
                <li><span>Append</span> one immutable operation and its ordered changes.</li>
                <li><span>Advance</span> the space generation and graph revision atomically.</li>
                <li><span>Project</span> the replaceable FTS index; semantic indexing is an explicit follow-up.</li>
              </ol>
            </div>
          </section>

          <section id="sync" className="spec-section">
            <div className="spec-number">05</div>
            <div>
              <h2>Operation-level sync</h2>
              <p>
                Sync exchanges bounded immutable operations, not database pages.
                Peers first compare contract manifests, then pull or push one
                contiguous sequence. Duplicate operations replay idempotently;
                stale heads and unknown contracts fail closed with explicit
                conflict errors.
              </p>
              <p>
                The transport port is HTTP-friendly and compatible with a
                libSQL/Turso implementation, while the local store remains the
                source of truth. A separate promise-based adapter can instead
                use libSQL as the direct authority without importing Bun SQLite.
              </p>
            </div>
          </section>

          <section id="semantic" className="spec-section">
            <div className="spec-number">06</div>
            <div>
              <h2>Semantic search</h2>
              <p>
                Oh publishes two separately digest-bound EmbeddingGemma views:
                a local QMD <code>embeddinggemma-300M-Q8_0</code> profile, and
                an optional Cloudflare Workers AI profile with a direct libSQL
                cache. Both use 768-dimensional cosine vectors, but their
                outputs are not assumed interchangeable. Every hit rejoins the
                exact current authoritative record digest.
              </p>
              <p className="callout">
                Semantic V2 data is a rebuildable cache. Its entries are keyed
                by embedding profile and exact renderer, an isolation digest the
                host controls, the cache generation, and the record digest. The
                isolation digest limits which vectors are reused or purged
                together and never changes the text sent to the provider.
                Keyword search works without a model, and a hosted failure never
                weakens exact graph or Datalog operations.
              </p>
            </div>
          </section>

          <section id="projection" className="spec-section">
            <div className="spec-number">07</div>
            <div>
              <h2>Derived projection</h2>
              <p>
                Typed positive rules derive recursive views from one exact
                graph head and content-addressed fact pack. Rule, query, input,
                and result identities use canonical bytes, while explicit work
                limits bound tuples, rounds, joins, and proof trees.
              </p>
              <p className="callout">
                Projection rows always remain derived cache output. They do not
                become assertions, review decisions, or operation history until
                an application submits new records through its authority path.
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
                purge, and reads a canonical store pinned at one head the host
                selects. The agent runs only the named query programs the host
                registers. Those programs see each fact tagged with the store it
                came from, conflicts between the two stores, the fact pack or
                extractor digest behind each fact, and size-limited proofs. The
                agent object exposes no store location and no way to write to
                the canonical store.
              </p>
              <p>
                The V2 query interface lets the host name the query variables an
                agent may fill with primitive JSON values, and returns results
                in pages of at most 256 rows. Each continuation cursor is
                authenticated and stops working if either store’s head, the
                program, the parameters, or the complete result changes. A host
                that rebuilds the interface or routes cursors to another replica
                supplies the same private key, so its cursors still
                authenticate. When the host advances the canonical pin,
                explanations keep one shared cache, capped at 256 entries and 64
                MiB, and one set of clock checks.
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
                the new head only if it is still the store’s current head, so
                a replayed request cannot pin an older one. A derived result
                never enters the canonical store on its own.
              </p>
              <p>
                The stable memory-page profile carries bounded Markdown,
                explicit source observations, and host-attested provenance in
                an ordinary <code>edition</code> record. Its canonical
                <code>.oh.md</code> form is one self-contained record transport,
                not a second authority or embedding format.
              </p>
            </div>
          </section>

          <section id="versioning" className="spec-section">
            <div className="spec-number">09</div>
            <div>
              <h2>Versioning and evolution</h2>
              <p>
                Package releases use semantic versions. Wire, graph, schema,
                SQLite, sync, and semantic profiles carry independent closed
                versions. A breaking byte or meaning change creates a new
                version; existing immutable preimages and migrations are never
                edited in place.
              </p>
              <div className="spec-actions">
                <a className="hraness-marketing-action" data-emphasis="primary" href="/spec/manifest.json">Specification manifest</a>
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
