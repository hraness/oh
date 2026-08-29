import { AskAiAboutThis } from "@hraness/ui";
import type { Metadata } from "next";
import contract from "../../public/spec/v1/contract.json";
import manifest from "../../public/spec/manifest.json";

const currentVersion = manifest.versions.find((version) => version.id === manifest.current);
if (currentVersion === undefined) {
  throw new Error("The public specification manifest has no current version.");
}

const specificationTitle = "Oh ontology specification v1";
const specificationDescription =
  "The current, local-first ontology and storage contract behind Oh.";

export const metadata: Metadata = {
  title: specificationTitle,
  description:
    "The versioned contract for Oh records, graph revisions, local SQLite authority, synchronization, and semantic search.",
  alternates: { canonical: "/spec" },
  openGraph: {
    title: specificationTitle,
    description: specificationDescription,
    images: [{
      alt: "open-source tools for agentic research",
      height: 630,
      url: "/og.png",
      width: 1200,
    }],
    url: "/spec",
  },
  twitter: {
    card: "summary_large_image",
    title: specificationTitle,
    description: specificationDescription,
    images: ["/og.png"],
  },
};

const sections = [
  ["contract", "Contract"],
  ["ontology", "Ontology"],
  ["records", "Records"],
  ["sqlite", "SQLite"],
  ["sync", "Sync"],
  ["semantic", "Semantic search"],
  ["versioning", "Versioning"],
] as const;

export default function Specification() {
  return (
    <>
      <a className="skip-link" href="#spec-main">Skip to specification</a>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Oh home">
          <span aria-hidden="true" className="wordmark-mark">oh</span>
          <span className="wordmark-name">Oh</span>
        </a>
        <nav aria-label="Specification navigation">
          <a href="/">Overview</a>
          <a aria-current="page" href="/spec">Specification</a>
          <a href="https://github.com/hraness/oh">GitHub</a>
        </nav>
      </header>

      <main className="spec-shell" id="spec-main">
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
              A deterministic contract for agents that create, connect, query,
              and synchronize research knowledge. Local SQLite is authoritative;
              every network and semantic capability is replaceable.
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
                <div><span>SQLite schema</span><strong>1</strong></div>
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
                source of truth. No cloud credential or endpoint appears in the
                core package.
              </p>
            </div>
          </section>

          <section id="semantic" className="spec-section">
            <div className="spec-number">06</div>
            <div>
              <h2>Semantic search</h2>
              <p>
                Oh selects one pinned local QMD engine and the
                <code>embeddinggemma-300M-Q8_0</code> model. The V1 profile
                publishes its 768-dimensional cosine contract. The concrete
                adapter confines QMD result identities, rejects non-finite
                scores, and rejoins every hit to current SQLite authority.
              </p>
              <p className="callout">
                Semantic data is a derived cache keyed by profile and exact
                record digest. Keyword search stays available without a model,
                and results always rejoin the current authoritative record.
              </p>
            </div>
          </section>

          <section id="versioning" className="spec-section">
            <div className="spec-number">07</div>
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
                <a className="primary-action" href="/spec/manifest.json">Specification manifest</a>
                <a className="text-action" href="https://github.com/hraness/oh/tree/main/spec">Source files ↗</a>
              </div>
            </div>
          </section>
        </article>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://oh.computer/spec" />
    </>
  );
}
