import { AskAiAboutThis } from "@hraness/ui";

import citationRecord from "../public/examples/evidence-table-2.json";
import contract from "../public/spec/v1/contract.json";
import manifest from "../public/spec/manifest.json";

const currentVersion = manifest.versions.find((version) => version.id === manifest.current) ??
  (() => {
    throw new Error("The public specification manifest has no current version.");
  })();

const researchObjects = [
  {
    index: "01",
    label: "Question",
    kind: "inquiry",
    body: "Keep the question and its investigation trail as a durable object instead of leaving it in a prompt transcript.",
  },
  {
    index: "02",
    label: "Source",
    kind: "entity",
    body: "Give a paper, dataset, person, or system a stable identity that survives changing titles, files, and URLs.",
  },
  {
    index: "03",
    label: "Capture",
    kind: "edition",
    body: "Bind a bounded source edition or extract to the profile your application registers, with its dependencies intact.",
  },
  {
    index: "04",
    label: "Claim",
    kind: "statement",
    body: "Store the proposition separately from who accepts it, where it applies, and what evidence bears on it.",
  },
  {
    index: "05",
    label: "Citation",
    kind: "evidence",
    body: "Record how a located passage, table, or observation supports, contradicts, or otherwise bears on an assertion.",
  },
  {
    index: "06",
    label: "Artifact",
    kind: "view",
    body: "Produce a review brief, answer, or other derived view whose input records remain addressable and inspectable.",
  },
] as const;

const traceNodes = [
  ["Question", "inquiry:primary-endpoint"],
  ["Source", "entity:trial-report"],
  ["Capture", "edition:trial-report-v1"],
  ["Claim", "statement:endpoint-12-weeks"],
  ["Stance", "assertion:endpoint-12-weeks"],
  ["Citation", "evidence:table-2"],
  ["Artifact", "view:review-brief"],
] as const;

const principles = [
  {
    index: "01",
    title: "Local by default",
    body: "Your contract, records, operation log, and keyword index live in a SQLite file you control. Semantic caches are rebuildable views; hosted inference and network sync remain explicit adapters.",
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

const questions = [
  {
    question: "Does Oh upload my research?",
    answer: "Not in the local path. The CLI, local SDK, authoritative records, operation log, and keyword index use the SQLite file you choose. Remote libSQL sync and hosted semantic caching happen only through adapters and credentials supplied by the host application.",
  },
  {
    question: "Does a passing verification mean a claim is true?",
    answer: "No. Verification checks canonical records and operation-chain integrity. Keyword and semantic scores are retrieval evidence. Truth, review, and acceptance remain explicit research decisions represented by the graph around a claim.",
  },
  {
    question: "What happens when two writers diverge?",
    answer: "Generation compare-and-swap rejects a stale local write. Sync settles fast-forward histories only; divergent histories fail closed so an application can preserve both logs and ask for a deliberate reconciliation.",
  },
  {
    question: "Where can I run it?",
    answer: "The CLI, local SDK, and SQLite authority require Bun 1.3.14 or newer. The runtime-neutral store contracts and direct libSQL authority also support Node 24 serverless runtimes.",
  },
] as const;

export default function Home() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      codeRepository: "https://github.com/hraness/oh",
      description: "open-source tools for agentic research",
      license: "https://opensource.org/license/mit",
      name: "Oh",
      programmingLanguage: "TypeScript",
      runtimePlatform: "Bun",
      url: "https://oh.computer",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: questions.map(({ answer, question }) => ({
        "@type": "Question",
        acceptedAnswer: { "@type": "Answer", text: answer },
        name: question,
      })),
    },
  ];

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
          <a href="#model">Model</a>
          <a href="#trace">Trace</a>
          <a href="/spec">Specification</a>
          <a className="nav-action" href="https://github.com/hraness/oh#install-and-first-run">
            Install
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">A local research graph your agents can inspect</p>
            <h1 id="hero-title">open-source tools for agentic research</h1>
            <p className="hero-lede">
              Give agents a local path from a research question to an artifact
              with inspectable sources, claims, citations, dependencies, and
              a verifiable operation history.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="https://github.com/hraness/oh#install-and-first-run">
                Install and start
              </a>
              <a className="text-action" href="#trace">
                Inspect the trace <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="hero-constraint">
              <strong>Starts local.</strong> Bun 1.3.14+, no account, no model,
              and no remote database. Semantic search and network sync remain
              optional adapters.
            </p>
          </div>
          <figure className="contract-card" aria-label="Verified local Oh first run">
            <figcaption className="contract-topline">
              <span>{currentVersion.contractId}</span>
              <span className="status"><i aria-hidden="true" /> {currentVersion.status}</span>
            </figcaption>
            <pre><code>{`$ bun add --global @hraness/oh@0.4.0

$ oh init --db research.db
$ oh contract --db research.db
$ oh verify --db research.db
{"head":{"generation":0,"graphRevisionSha256":null,"operationSha256":null,"recordsSha256":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","sequence":0,"v":1},"operations":0,"records":0,"sqliteIntegrity":"ok","v":1}`}</code></pre>
            <p>Fresh database · canonical JSON · init and verify stay local</p>
          </figure>
        </section>

        <section className="proof-strip" aria-label="Runtime-backed facts">
          <div><strong>1</strong><span>SQLite authority</span><small>local runtime</small></div>
          <div><strong>{contract.recordKinds.length}</strong><span>Record kinds</span><small>V1 contract</small></div>
          <div><strong>SHA-256</strong><span>Content + operations</span><small>canonical bytes</small></div>
          <div><strong>0</strong><span>Accounts required</span><small>local path</small></div>
        </section>

        <section className="narrative-section object-model" id="model" aria-labelledby="model-title">
          <div className="section-heading">
            <div>
              <p className="section-number">01 / Research model</p>
              <p className="eyebrow">The objects you can inspect</p>
            </div>
            <div>
              <h2 id="model-title">From a question to a research artifact.</h2>
              <p className="section-intro">
                Oh supplies a versioned graph envelope and a small ontology
                kernel. A research application can map the work people already
                recognize onto explicit records without hiding meaning in a
                database convention.
              </p>
            </div>
          </div>
          <div className="object-grid">
            {researchObjects.map((object) => (
              <article key={object.label}>
                <div className="object-topline">
                  <span>{object.index}</span>
                  <code>{object.kind}</code>
                </div>
                <h3>{object.label}</h3>
                <p>{object.body}</p>
              </article>
            ))}
          </div>
          <p className="model-note">
            Oh also keeps an attributable <code>assertion</code> between a claim
            and the evidence that bears on it. Product vocabularies can refine
            this profile through versioned schemas and codecs; they do not
            change the V1 graph envelope.
          </p>
        </section>

        <section className="trace-section" id="trace" aria-labelledby="trace-title">
          <div className="trace-heading">
            <div>
              <p className="section-number">02 / Inspectable trace</p>
              <p className="eyebrow">One illustrative review</p>
            </div>
            <div>
              <h2 id="trace-title">Keep every recorded handoff addressable.</h2>
              <p>
                The keys below show one possible review profile. At the citation
                step, the record names its claim stance and captured source
                edition as dependencies. The digest binds the complete record.
              </p>
            </div>
          </div>
          <div className="trace-grid">
            <ol className="trace-path" aria-label="Example research trace">
              {traceNodes.map(([label, key]) => (
                <li key={key}>
                  <span>{label}</span>
                  <code>{key}</code>
                </li>
              ))}
            </ol>
            <figure className="proof-frame">
              <figcaption>
                <span>CLI read · canonical JSON</span>
                <a href="/examples/evidence-table-2.json">Open record</a>
              </figcaption>
              <pre><code>{`$ oh get evidence:table-2 --db research.db
${JSON.stringify(citationRecord, null, 2)}`}</code></pre>
              <p>
                Illustrative V1 record, not a claim about a real study. Its
                digest is checked against the public record schema in CI.
              </p>
            </figure>
          </div>
        </section>

        <section className="narrative-section interfaces" id="interfaces" aria-labelledby="interfaces-title">
          <div className="section-heading">
            <div>
              <p className="section-number">03 / Interfaces</p>
              <p className="eyebrow">One graph, three surfaces</p>
            </div>
            <div>
              <h2 id="interfaces-title">Use the interface your work already has.</h2>
              <p className="section-intro">
                The CLI, TypeScript SDK, and packaged Agent Skill operate the
                same records and contract. There is no separate agent-only
                authority behind the convenient surface.
              </p>
            </div>
          </div>
          <div className="interface-grid">
            <article>
              <div className="interface-label"><span>01</span><strong>CLI</strong></div>
              <p>Inspect one exact record in a selected local database and space.</p>
              <pre><code>{`$ oh get evidence:table-2 \\
  --db research.db \\
  --space default`}</code></pre>
              <a href="https://github.com/hraness/oh#install-and-first-run">Run the first task →</a>
            </article>
            <article>
              <div className="interface-label"><span>02</span><strong>TypeScript SDK</strong></div>
              <p>Read the same record through the local <code>Oh</code> facade.</p>
              <pre><code>{`import { Oh } from "@hraness/oh/sdk";

const oh = Oh.open({ databasePath: "research.db" });
try {
  const citation = oh.get("evidence:table-2");
  console.log(citation?.recordSha256);
} finally {
  await oh.close();
}`}</code></pre>
              <a href="https://github.com/hraness/oh#use-the-sdk">Read the SDK guide →</a>
            </article>
            <article>
              <div className="interface-label"><span>03</span><strong>Agent Skill</strong></div>
              <p>Teach a coding agent to check the contract and replay before it reads.</p>
              <pre><code>{`oh contract
oh verify --db research.db --space default
oh get evidence:table-2 \\
  --db research.db --space default`}</code></pre>
              <a href="https://github.com/hraness/oh/blob/main/skills/oh/SKILL.md">Inspect the packaged skill →</a>
            </article>
          </div>
        </section>

        <section className="principles" id="principles" aria-labelledby="principles-title">
          <div className="section-heading">
            <div>
              <p className="section-number">04 / Working model</p>
              <p className="eyebrow">The kernel</p>
            </div>
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

        <section className="boundary-section" id="boundary" aria-labelledby="boundary-title">
          <div className="boundary-intro">
            <p className="section-number">05 / Operating boundary</p>
            <h2 id="boundary-title">Local authority. Explicit adapters. No truth theater.</h2>
            <p>
              Oh makes integrity and provenance mechanics inspectable. It does
              not turn a retrieval score, a valid digest, or an agent&apos;s output
              into an accepted research claim.
            </p>
          </div>
          <div className="boundary-grid">
            <article>
              <span>Stays local</span>
              <h3>Authority</h3>
              <ul>
                <li>SQLite records and operation log</li>
                <li>Keyword index and replay verification</li>
                <li>Database path and space selected by the host</li>
              </ul>
            </article>
            <article>
              <span>Opt in</span>
              <h3>Adapters</h3>
              <ul>
                <li>Local semantic search through the optional QMD peer</li>
                <li>Hosted embedding cache through an explicit profile</li>
                <li>Remote libSQL or Turso synchronization</li>
              </ul>
            </article>
            <article>
              <span>Not delegated</span>
              <h3>Judgment</h3>
              <ul>
                <li>Whether a research claim is true</li>
                <li>How divergent histories should be reconciled</li>
                <li>Whether working knowledge becomes canonical</li>
              </ul>
            </article>
          </div>
          <div className="compatibility-line">
            <span><strong>Bun ≥1.3.14</strong> CLI, local SDK, SQLite</span>
            <span><strong>Node 24</strong> runtime-neutral store, direct libSQL</span>
            <span><strong>No required runtime dependencies</strong> base package</span>
          </div>
        </section>

        <section className="narrative-section questions" id="questions" aria-labelledby="questions-title">
          <div className="section-heading">
            <div>
              <p className="section-number">06 / Questions</p>
              <p className="eyebrow">Before you install</p>
            </div>
            <h2 id="questions-title">The careful-reader answers.</h2>
          </div>
          <div className="question-list">
            {questions.map(({ answer, question }, index) => (
              <details key={question}>
                <summary><span>{String(index + 1).padStart(2, "0")}</span>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="product-cta" aria-labelledby="cta-title">
          <div>
            <p className="eyebrow">Start with one local graph</p>
            <h2 id="cta-title">Ask one question. Keep the evidence.</h2>
            <p>Bun 1.3.14+ · MIT licensed · no account required for local use</p>
          </div>
          <div className="cta-actions">
            <a className="primary-action" href="https://github.com/hraness/oh#install-and-first-run">
              Install @hraness/oh
            </a>
            <a className="text-action" href="/spec">Read the V1 specification →</a>
          </div>
        </section>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://oh.computer" />

      <footer>
        <p>Oh is open source for researchers and the agents working beside them.</p>
        <div>
          <a href="/spec">Ontology v1</a>
          <a href="https://github.com/hraness/oh">hraness/oh</a>
          <a href="https://hraness.com/projects">Hraness projects</a>
        </div>
      </footer>
    </>
  );
}
