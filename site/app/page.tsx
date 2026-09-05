import {
  MarketingCallToAction,
  MarketingFlow,
  MarketingInstallPanel,
  MarketingInterfaceGrid,
  MarketingMaker,
  MarketingPage,
  MarketingPrimitives,
  MarketingProofFrame,
  MarketingQuestionList,
  MarketingSection,
  MarketingSiteHeader,
  MarketingStatStrip,
  MarketingTrustBoundary,
  ProductHero,
} from "@hraness/design-kit/react/server";
import { AskAiAboutThis } from "@hraness/ui";

import ohPackage from "../../package.json";
import citationRecord from "../public/examples/evidence-table-2.json";
import contract from "../public/spec/v1/contract.json";
import manifest from "../public/spec/manifest.json";

const currentVersion = manifest.versions.find((version) => version.id === manifest.current) ??
  (() => {
    throw new Error("The public specification manifest has no current version.");
  })();

const releaseVersion = ohPackage.version;
const capturedOn = "September 5, 2026";
const repository = "https://github.com/hraness/oh";

const heading = "A research graph your agents can inspect";
const lead =
  "Oh gives your agents a local path from a question to a cited artifact: sources, claims, citations, and a verifiable history of every change, in one SQLite file on your machine.";
const example =
  "Ask your agent to file the trial report as a source, record its 12-week endpoint as a claim, cite table 2, and verify the graph before it drafts the brief.";
const footnote =
  `Free and MIT licensed. Bun 1.3.14 or newer, no account, no hosted model. Current release v${releaseVersion}.`;

/** The verified first run, captured from the current CLI. Output is canonical JSON. */
const firstRunTranscript = `$ bun add --global @hraness/oh@${releaseVersion}

$ oh init --db research.db
{"head":{"generation":0,"graphRevisionSha256":null,"operationSha256":null,"recordsSha256":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","sequence":0,"v":1},"spaceId":"default","v":1}

$ oh verify --db research.db
{"head":{"generation":0,"graphRevisionSha256":null,"operationSha256":null,"recordsSha256":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","sequence":0,"v":1},"operations":0,"records":0,"sqliteIntegrity":"ok","v":1}`;

const stats = [
  {
    label: "Local database",
    value: "1",
    detail: "One SQLite file holds the records, the operation log, and the keyword index.",
  },
  {
    label: "Record kinds",
    value: String(contract.recordKinds.length),
    detail: "A closed vocabulary in the v1 contract.",
  },
  {
    label: "Digests",
    value: "SHA-256",
    detail: "Content and operations are hashed over canonical bytes.",
  },
  {
    label: "Accounts required",
    value: "0",
    detail: "No sign-in, hosted model, or remote database for local use.",
  },
] as const;

const researchObjects = [
  {
    label: "Question",
    kind: "inquiry",
    summary: "Keep the question and its investigation trail as a durable object instead of leaving it in a prompt transcript.",
  },
  {
    label: "Source",
    kind: "entity",
    summary: "Give a paper, dataset, person, or system a stable identity that survives changing titles, files, and URLs.",
  },
  {
    label: "Capture",
    kind: "edition",
    summary: "Pin one edition or extract of a source to the profile your application registers, with its dependencies intact.",
  },
  {
    label: "Claim",
    kind: "statement",
    summary: "Store the proposition separately from who accepts it, where it applies, and what evidence bears on it.",
  },
  {
    label: "Citation",
    kind: "evidence",
    summary: "Record how a located passage, table, or observation supports, contradicts, or otherwise bears on an assertion.",
  },
  {
    label: "Artifact",
    kind: "view",
    summary: "Produce a review brief, answer, or other derived view whose input records stay addressable.",
  },
] as const;

const traceSteps = [
  { label: "Question", code: "inquiry:primary-endpoint" },
  { label: "Source", code: "entity:trial-report" },
  { label: "Capture", code: "edition:trial-report-v1" },
  { label: "Claim", code: "statement:endpoint-12-weeks" },
  { label: "Stance", code: "assertion:endpoint-12-weeks" },
  { label: "Citation", code: "evidence:table-2" },
  { label: "Artifact", code: "view:review-brief" },
] as const;

const trust = [
  {
    label: "Local by default",
    detail: "Your contract, records, operation log, and keyword index live in a SQLite file you control. Semantic caches are rebuildable views; hosted inference and network sync remain explicit adapters.",
  },
  {
    label: "Deterministic contracts",
    detail: "Canonical bytes, content-addressed records, append-only operations, and generation checks make every graph mutation inspectable and replayable. Verification checks the chain, not the truth of a claim.",
  },
  {
    label: "Built for agents",
    detail: "A small SDK, an honest CLI, and a self-contained skill let coding agents inspect, write, verify, search, and synchronize the same graph. The skill cannot widen your authorization or choose a database, space, or sync destination for you.",
  },
] as const;

const questions = [
  {
    question: "Do I need an account?",
    answer: "No. The CLI, local SDK, records, operation log, and keyword index use the SQLite file you choose. Nothing asks you to sign in, and the local path involves no hosted model and no remote database.",
  },
  {
    question: "What is stored, and where?",
    answer: "One SQLite file holds the contract manifest, content-addressed records, the append-only operation log, and the derived keyword index. Oh writes to .oh/oh.sqlite and the default space unless you choose another path or space. Semantic caches and remote copies exist only where you configure them.",
  },
  {
    question: "Is semantic search required?",
    answer: "No. Keyword search works without a model. Local semantic search uses the optional QMD peer dependency with a pinned EmbeddingGemma profile, and a hosted embedding cache through Cloudflare Workers AI and libSQL is a separate, explicit profile. Both are rebuildable views joined back to the current record digest.",
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
    question: "What does it cost?",
    answer: "Nothing. Oh is MIT licensed and published on npm as @hraness/oh. The base package has no required runtime dependencies; the optional peers for local semantic search, libSQL, and Datalog projection install only when you use them.",
  },
  {
    question: "Where can I run it?",
    answer: "The CLI, local SDK, and SQLite store require Bun 1.3.14 or newer. The runtime-neutral store contracts and the direct libSQL adapter also support Node 24 serverless runtimes.",
  },
  {
    question: "Who made it?",
    answer: "Ben Guo, a musician and builder, formerly a founder and engineering leader at companies including Venmo and Stripe, now building from Puerto Rico. Oh is published by Hraness under the MIT license.",
  },
] as const;

const navigation = [
  { href: "#model", label: "Model" },
  { href: "#trace", label: "Trace" },
  { href: "#interfaces", label: "Interfaces" },
  { href: "#questions", label: "Questions" },
  { href: "/spec", label: "Specification" },
  { href: repository, label: "GitHub" },
] as const;

function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="brand-mark">
      <circle cx="12" cy="12" r="12" fill="currentColor" />
      <circle cx="7.7" cy="13.2" r="3" fill="none" stroke="var(--background)" strokeWidth="2.1" />
      <path
        d="M12.8 6.7v9.5m0-3.2c.1-2.2 1.3-3.5 3-3.5 1.8 0 2.8 1.2 2.8 3.3v3.4"
        fill="none"
        stroke="var(--background)"
        strokeLinecap="round"
        strokeWidth="2.1"
      />
    </svg>
  );
}

export default function Home() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      codeRepository: repository,
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
      <MarketingSiteHeader
        action={{ href: "#install", label: "Install Oh" }}
        brand={<><BrandMark />Oh</>}
        brandLabel="Oh home"
        links={navigation}
      />

      <main id="main">
        <MarketingPage>
          <ProductHero
            actions={[
              { href: "#install", label: "Install Oh" },
              { href: "#trace", label: "See the trace" },
            ]}
            boundary={footnote}
            example={example}
            eyebrow="Open-source tools for agentic research"
            frame={(
              <MarketingProofFrame
                caption="A fresh database: init and verify stay local and print canonical JSON."
                credit={`${currentVersion.contractId} · ${currentVersion.status} · @hraness/oh ${releaseVersion} · captured ${capturedOn}`}
                title="oh · first run"
              >
                <pre className="transcript" tabIndex={0}><code>{firstRunTranscript}</code></pre>
              </MarketingProofFrame>
            )}
            heading={heading}
            headingId="hero-title"
            name="Oh"
            summary={lead}
          />

          <MarketingStatStrip
            ariaLabel="Runtime-backed facts"
            source={`Counted from the ${currentVersion.contractId} contract manifest and the @hraness/oh ${releaseVersion} runtime on ${capturedOn}.`}
            stats={stats}
          />

          <MarketingPrimitives
            heading="From a question to a research artifact."
            headingId="model-title"
            id="model"
            items={researchObjects.map((object) => ({
              label: object.label,
              summary: object.summary,
              example: (
                <p className="record-kind">
                  Record kind <code>{object.kind}</code>
                </p>
              ),
            }))}
            label="The research model"
            summary="Oh supplies a versioned graph envelope and a small ontology kernel, so a research application can map the work people already recognize onto explicit records. An attributable assertion sits between a claim and the evidence that bears on it, and product vocabularies refine the profile through versioned schemas without changing the v1 envelope."
          />

          <MarketingSection
            heading="Every step of a review keeps its own record."
            headingId="trace-title"
            id="trace"
            label="One review, traced"
            layout="split"
            summary="The keys below trace one possible review profile. At the citation step, the record names its claim stance and captured source edition as dependencies, and the digest binds the complete record. The append-only log behind it gives you a verifiable operation history."
          >
            <MarketingFlow ariaLabel="Example research trace" steps={traceSteps} />
            <MarketingProofFrame
              caption="An illustrative v1 record, not a claim about a real study. Its digest is checked against the public record schema in CI."
              credit="Canonical JSON from the CLI"
              title="oh get evidence:table-2"
            >
              <pre className="transcript" tabIndex={0}><code>{`$ oh get evidence:table-2 --db research.db
${JSON.stringify(citationRecord, null, 2)}`}</code></pre>
            </MarketingProofFrame>
            <p className="record-link">
              <a href="/examples/evidence-table-2.json">Open the record</a>
            </p>
          </MarketingSection>

          <MarketingInterfaceGrid
            heading="Use the interface your work already has."
            headingId="interfaces-title"
            id="interfaces"
            interfaces={[
              {
                label: "CLI",
                summary: "Read one record from the local database and space you select.",
                example: (
                  <>
                    <pre tabIndex={0}><code>{`$ oh get evidence:table-2 \\
  --db research.db \\
  --space default`}</code></pre>
                    <p className="interface-link"><a href="#install">Run the first task</a></p>
                  </>
                ),
              },
              {
                label: "TypeScript SDK",
                summary: "Read the same record through the local Oh facade.",
                example: (
                  <>
                    <pre tabIndex={0}><code>{`import { Oh } from "@hraness/oh/sdk";

const oh = Oh.open({ databasePath: "research.db" });
try {
  const citation = oh.get("evidence:table-2");
  console.log(citation?.recordSha256);
} finally {
  await oh.close();
}`}</code></pre>
                    <p className="interface-link"><a href="https://github.com/hraness/oh#use-the-sdk">Read the SDK guide</a></p>
                  </>
                ),
              },
              {
                label: "Agent Skill",
                summary: "Teach a coding agent to check the contract and replay before it reads.",
                example: (
                  <>
                    <pre tabIndex={0}><code>{`oh contract
oh verify --db research.db --space default
oh get evidence:table-2 \\
  --db research.db --space default`}</code></pre>
                    <p className="interface-link"><a href={`${repository}/blob/main/skills/oh/SKILL.md`}>Inspect the packaged skill</a></p>
                  </>
                ),
              },
            ]}
            label="Interfaces"
            summary="The CLI, TypeScript SDK, and packaged Agent Skill operate the same records and contract. There is no separate agent-only path behind the convenient one."
          />

          <MarketingTrustBoundary
            heading="Small enough to trust. Complete enough to build on."
            headingId="kernel-title"
            id="kernel"
            items={trust}
            label="The kernel"
            summary="Oh makes integrity and provenance mechanics inspectable. It does not turn a retrieval score, a valid digest, or an agent's output into an accepted research claim."
          />

          <MarketingInstallPanel
            eyebrow={`Current release · v${releaseVersion}`}
            heading="Install and start locally."
            headingId="install-title"
            id="install"
          >
            <pre className="install-command" tabIndex={0}><code>{`bun add --global @hraness/oh@${releaseVersion}
oh --help`}</code></pre>
            <pre className="install-command" tabIndex={0}><code>{`oh init
oh put --kind entity --key entity:ada-lovelace \\
  --json '{"name":"Ada Lovelace","role":"mathematician"}'
oh get entity:ada-lovelace
oh search "mathematician" --mode keyword
oh verify`}</code></pre>
            <p className="install-note">
              Needs Bun 1.3.14 or newer. The first task creates one entity, reads it back, finds it
              through the keyword index, and verifies the operation chain. Oh writes to{" "}
              <code>.oh/oh.sqlite</code> and the <code>default</code> space unless you choose another.{" "}
              <a href="https://github.com/hraness/oh#install-and-first-run">Read the full first run on GitHub</a>.
            </p>
          </MarketingInstallPanel>

          <MarketingQuestionList
            heading="Before you install."
            headingId="questions-title"
            id="questions"
            label="Questions"
            questions={questions.map(({ answer, question }) => ({
              answer: <p>{answer}</p>,
              question,
            }))}
          />

          <MarketingMaker
            heading="Built by Ben Guo"
            headingId="maker-title"
            id="maker"
            label="The maker"
            links={[
              { href: "https://hraness.com", label: "hraness.com" },
              { href: "https://x.com/hraness", label: "@hraness" },
              { href: repository, label: "GitHub" },
            ]}
          >
            <p>
              Oh is built by Ben Guo, a musician and builder, formerly a founder and engineering
              leader at companies including Venmo and Stripe, now building from Puerto Rico. Oh is
              his open-source kernel for research done with agents, published by Hraness under the
              MIT license.
            </p>
          </MarketingMaker>

          <MarketingCallToAction
            actions={[
              { href: "#install", label: "Install Oh" },
              { href: "/spec", label: "Read the v1 specification" },
            ]}
            footnote={footnote}
            heading="Ask one question. Keep the evidence."
            headingId="cta-title"
            summary="Install the CLI, create one local database, and let your agent write records you can open later."
          />
        </MarketingPage>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://oh.computer" />

      <footer className="site-footer">
        <p>Oh is open source for researchers and the agents working beside them.</p>
        <nav aria-label="Project links">
          <a href="/spec">Ontology v1</a>
          <a href={repository}>hraness/oh</a>
          <a href="https://hraness.com/projects">Hraness projects</a>
        </nav>
      </footer>
    </>
  );
}
