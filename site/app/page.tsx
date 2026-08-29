import { AskAiAboutThis } from "@hraness/ui";

import manifest from "../public/spec/manifest.json";

const currentVersion = manifest.versions.find((version) => version.id === manifest.current) ??
  (() => {
    throw new Error("The public specification manifest has no current version.");
  })();

const principles = [
  {
    index: "01",
    title: "Local by default",
    body: "Your contract, records, operation log, and keyword index live in a SQLite file you control. Semantic state is a rebuildable local cache; network sync remains an explicit adapter.",
  },
  {
    index: "02",
    title: "Deterministic contracts",
    body: "Canonical bytes, content-addressed records, append-only operations, and generation checks make every graph mutation inspectable and replayable.",
  },
  {
    index: "03",
    title: "Built for agents",
    body: "A small SDK, an honest CLI, and a self-contained skill let coding agents inspect, write, verify, search, and synchronize the same graph.",
  },
] as const;

export default function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    codeRepository: "https://github.com/hraness/oh",
    description: "open-source tools for agentic research",
    license: "https://opensource.org/license/mit",
    name: "Oh",
    programmingLanguage: "TypeScript",
    runtimePlatform: "Bun",
    url: "https://oh.computer",
  };

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        type="application/ld+json"
      />
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Oh home">
          <span aria-hidden="true" className="wordmark-mark">oh</span>
          <span className="wordmark-name">Oh</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#principles">Principles</a>
          <a href="/spec">Specification</a>
          <a href="https://github.com/hraness/oh">GitHub</a>
        </nav>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Ontology infrastructure, without the platform tax</p>
            <h1 id="hero-title">open-source tools for agentic research</h1>
            <p className="hero-lede">
              Oh is a local-first ontology kernel for agents that need durable
              knowledge, verifiable operation history, and a clean path from one SQLite
              file to synchronized research systems.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="https://github.com/hraness/oh#install-and-first-run">
                Install and start
              </a>
              <a className="text-action" href="/spec">
                Read the specification <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <div className="contract-card" aria-label="Oh contract summary">
            <div className="contract-topline">
              <span>{currentVersion.contractId}</span>
              <span className="status"><i aria-hidden="true" /> {currentVersion.status}</span>
            </div>
            <pre><code>{`# local SQLite authority
$ oh init --db research.db

# pinned public contract
$ oh contract --db research.db

# replay integrity
$ oh verify --db research.db`}</code></pre>
          </div>
        </section>

        <section className="proof-strip" aria-label="Core properties">
          <span>SQLite authority</span>
          <span>Content addressed</span>
          <span>Offline semantic search</span>
          <span>Turso-compatible sync</span>
        </section>

        <section className="principles" id="principles" aria-labelledby="principles-title">
          <div className="section-heading">
            <p className="eyebrow">The kernel</p>
            <h2 id="principles-title">Small enough to trust.<br />Complete enough to build on.</h2>
          </div>
          <div className="principle-grid">
            {principles.map((principle) => (
              <article key={principle.index}>
                <span className="principle-index">{principle.index}</span>
                <h3>{principle.title}</h3>
                <p>{principle.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://oh.computer" />

      <footer>
        <p>Oh is open source for researchers and the agents working beside them.</p>
        <div>
          <a href="/spec">Ontology v1</a>
          <a href="https://github.com/hraness/oh">hraness/oh</a>
        </div>
      </footer>
    </>
  );
}
