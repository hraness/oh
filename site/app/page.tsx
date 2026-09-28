import {
  MarketingFlow,
  MarketingInstallPanel,
  MarketingInterfaceGrid,
  MarketingPage,
  MarketingProofFrame,
  MarketingQuestionList,
  MarketingSection,
  MarketingSiteHeader,
  MarketingTrustBoundary,
  ProductHero,
} from "@hraness/design-kit/react/server";
import { product, relatedFor } from "@hraness/design-kit/portfolio";
import { AskAiAboutThis } from "@hraness/ui";

import { DesignPaletteMenuButton } from "@hraness/design-kit/react";

import publishedRelease from "../published-release.json";
import { MemoryBenchmarkComparison, longMemEvalHeading } from "./benchmark-comparison";
import { homeDescription } from "./metadata-copy";
import { OhContentFooter } from "./site-footer";
import citationRecord from "../public/examples/evidence-table-2.json";
import contract from "../public/spec/v1/contract.json";
import manifest from "../public/spec/manifest.json";

const currentVersion = manifest.versions.find((version) => version.id === manifest.current) ??
  (() => {
    throw new Error("The public specification manifest has no current version.");
  })();

const releaseVersion = publishedRelease.version;
const repository = "https://github.com/hraness/oh";
const wordcell = product("kb");
// The Wordcell section links a sibling product, so it needs a registered relation.
if (!relatedFor(wordcell.id, { kinds: ["runtime"] }).some((item) => item.name === "Oh")) {
  throw new Error("The portfolio registry has no runtime relation between Oh and Wordcell.");
}

const eyebrow = "Agent memory framework";
const heading = "Agent memory that shows its work.";
const lead =
  "Oh is an open-source memory framework for developers building agents. Your agent saves what it learns as linked records in a SQLite file, so later you can trace an answer back to the passage or table behind it.";
const boundary =
  `Free and MIT licensed · Bun 1.3.14 or newer · No account needed · v${releaseVersion}`;

/**
 * Terminal output from the oh CLI after the citation's source, edition, claim,
 * and stance were saved. tests/marketing-surface.test.ts replays these commands
 * against the CLI source and requires every output line to appear here.
 */
const proofTranscript = `$ oh put --kind evidence --key evidence:table-2 \\
    --depends-on edition:trial-report-v1 \\
    --depends-on assertion:endpoint-12-weeks \\
    --value '{"source":"entity:trial-report","locator":"table 2","relationship":"supports"}'
✓ Saved evidence:table-2 (generation 5).
Next: oh get evidence:table-2

$ oh get evidence:table-2
evidence:table-2 (evidence)
{
  "locator": "table 2",
  "relationship": "supports",
  "source": "entity:trial-report"
}
Depends on: assertion:endpoint-12-weeks, edition:trial-report-v1

$ oh verify
✓ Store checked: 5 records and 5 changes replay to the same state (generation 5).`;

/** Commands and their continuation lines take the accent; output stays plain. */
function Transcript({ label, text }: Readonly<{ label: string; text: string }>) {
  const lines = text.split("\n");
  return (
    <pre aria-label={label} className="oh-terminal" tabIndex={0}><code>{lines.map((line, index) => {
      const command = line.startsWith("$ ") || (index > 0 && lines[index - 1].endsWith("\\"));
      return (
        <span className={command ? "oh-terminal__command" : undefined} key={index}>
          {line}{"\n"}
        </span>
      );
    })}</code></pre>
  );
}

const researchObjects = [
  {
    label: "Question",
    kind: "inquiry",
    summary: "Save what you are trying to find out, along with the investigation that follows.",
  },
  {
    label: "Source",
    kind: "entity",
    summary: "Identify the paper, dataset, person, or system you are researching, even if its title or URL changes.",
  },
  {
    label: "Capture",
    kind: "edition",
    summary: "Record the edition or extract you read, separate from the source as it looks today.",
  },
  {
    label: "Claim",
    kind: "statement",
    summary: "Write down the claim itself, and keep who accepts it and the evidence for it in separate records.",
  },
  {
    label: "Citation",
    kind: "evidence",
    summary: "Point to a passage, table, or observation, and record how it bears on a stance toward a claim, such as support or contradiction.",
  },
  {
    label: "Artifact",
    kind: "view",
    summary: "Build a brief or answer that keeps links to the records it draws on.",
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
    detail: "Your records, the log of every change, and the keyword index live in a SQLite file you choose. Semantic search caches are derived from the records and can be rebuilt.",
  },
  {
    label: "Remote services are opt-in",
    detail: "Hosted embeddings, network sync, and a remote libSQL database are used only when you configure them. Sync sends operations, never search vectors.",
  },
  {
    label: "A history you can replay",
    detail: "Every write appends an operation to the log. The verify command replays the log from an empty graph and confirms it reproduces every digest and stored record.",
  },
  {
    label: "Agents work within your permissions",
    detail: "The Agent Skill teaches a coding agent to read, write, search, verify, and sync through the same CLI and SDK you use. It grants the agent no extra permissions and tells it never to pick a database, space, or sync destination on its own.",
  },
] as const;

/** Answers mark literal values with backticks: code on the page, plain text in the JSON-LD. */
const questions = [
  {
    question: "Do I need an account?",
    answer: "No. The CLI and the local SDK work on a SQLite file you choose, with no sign-in, hosted model, or remote database. A hosted service you connect, such as an embedding or sync provider, may need an account of its own.",
  },
  {
    question: "What is stored, and where?",
    answer: "One SQLite file holds your records and their digests, the append-only log of every change, a keyword index built from the records, and the specification version the file follows. Oh uses `.oh/oh.sqlite` and the `default` space unless you name another path or space. Semantic caches and remote copies exist only where you configure them.",
  },
  {
    question: "Is semantic search required?",
    answer: "No. Keyword search needs no model, and it is the only search the CLI runs, because the CLI configures no semantic backend. In the SDK, configuring a semantic backend makes hybrid search the default, and adding a local reranker makes reranking the default. Local models run through the optional QMD package. Hosted embeddings come from Cloudflare Workers AI through the separate `@hraness/oh/semantic-cloud` entry point, which sends record text to Cloudflare and caches the vectors in libSQL. Oh drops any result whose record has changed or been removed since it was indexed.",
  },
  {
    question: "Does a passing verification mean a claim is true?",
    answer: "No. A passing verification means the records and their history are intact: replaying the log reproduced every digest. Search scores measure relevance, not truth. Whether a claim holds is recorded separately, in assertions and review decisions linked to their evidence.",
  },
  {
    question: "What happens when two writers diverge?",
    answer: "Oh reports a conflict and overwrites nothing. A write can name the generation it was based on (`--expected-generation` in the CLI), and Oh rejects it if another write landed first. Sync accepts only a history that extends yours; when two histories have diverged, it stops with a conflict error instead of letting the last write win, so your application can keep both logs and reconcile them.",
  },
  {
    question: "What does it cost?",
    answer: "Oh itself is free and MIT licensed, published on npm as `@hraness/oh`. Local search runs on your own hardware, and a hosted provider you connect bills you under its own plan. The package has no required runtime dependencies.",
  },
  {
    question: "Where can I run it?",
    answer: "The CLI, the local SDK, and the SQLite store need Bun 1.3.14 or newer. The runtime-neutral store interfaces and the direct libSQL adapter also run on Node 24, including in serverless functions.",
  },
  {
    question: "Who made it?",
    answer: "Oh is made by Hraness, which builds tools for agents and humans. Its source code and releases are on GitHub.",
  },
] as const;

const answerText = (answer: string): string => answer.replaceAll("`", "");

function AnswerBody({ answer }: Readonly<{ answer: string }>) {
  return (
    <p>
      {answer.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}
    </p>
  );
}

const navigation = [
  { href: "#model", label: "How it works" },
  { href: "/benchmarks", label: "Benchmarks" },
  { href: "/compare", label: "Compare" },
  { href: "/blog", label: "Blog" },
  { href: "/spec", label: "Specification" },
  { href: repository, label: "GitHub" },
] as const;

export default function Home() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      codeRepository: repository,
      description: homeDescription,
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
        acceptedAnswer: { "@type": "Answer", text: answerText(answer) },
        name: question,
      })),
    },
  ];

  return (
    <div className="oh-home" data-hraness-material="lantern" data-hraness-marketing-preset="editorial" data-hraness-pattern="none">
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        type="application/ld+json"
      />
      <a className="skip-link" href="#main">Skip to content</a>
      <MarketingSiteHeader
        action={{ href: "#install", label: "Install Oh" }}
        brand="Oh"
        brandMark="/marks/oh-computer.svg"
        brandLabel="Oh home"
        links={navigation}
        trailing={<DesignPaletteMenuButton />}
      />

      <main id="main" tabIndex={-1}>
        <MarketingPage>
          <ProductHero
            actions={[
              { href: "#install", label: "Install Oh" },
              { emphasis: "secondary", href: "#model", label: "See the memory model" },
            ]}
            align="start"
            backdrop={false}
            boundary={boundary}
            className="oh-hero"
            eyebrow={eyebrow}
            frame={(
              <figure className="oh-proof">
                <Transcript label="Saving and reading a citation with the oh CLI" text={proofTranscript} />
                <figcaption>
                  The citation from an example review of a fictional trial report. The record names
                  what it rests on, and <code>oh verify</code> replays every change to check the store.
                  Add <code>--json</code> for canonical JSON.
                </figcaption>
              </figure>
            )}
            heading={heading}
            headingId="hero-title"
            name=""
            summary={lead}
          />

          <MarketingSection
            heading="Each part of your research gets its own record."
            headingId="model-title"
            id="model"
            label="How it works"
            layout="split"
            summary="Oh keeps the question, the source, and the claim in separate linked records, so revising one leaves the others intact. An assertion records a stance on a claim; citations link that stance to its evidence."
          >
            <dl className="oh-rows">
              {researchObjects.map((object) => (
                <div key={object.kind}>
                  <dt>{object.label} <code>{object.kind}</code></dt>
                  <dd>{object.summary}</dd>
                </div>
              ))}
            </dl>
            <p className="record-link">
              The v1 specification defines {contract.recordKinds.length} record kinds, and Oh rejects any
              other. <a href="/spec#ontology">See every record kind</a>
            </p>
          </MarketingSection>

          <MarketingSection
            heading="Trace a brief back to the table it rests on."
            headingId="trace-title"
            id="trace"
            label="Trace"
            layout="split"
            summary="Follow one example review from its question to the finished brief. Each key names a record you can open from the CLI, and the log keeps every change in the order it happened."
          >
            <MarketingFlow ariaLabel="Example research trace" steps={traceSteps} />
            <MarketingProofFrame
              caption="The citation from the terminal above, indented for reading. With --json the CLI prints the same record on one line."
              credit={`${currentVersion.contractId} · ${currentVersion.status}`}
            >
              <pre className="transcript" tabIndex={0}><code>{`$ oh get evidence:table-2 --json
${JSON.stringify(citationRecord, null, 2)}`}</code></pre>
            </MarketingProofFrame>
            <p className="record-link">
              <a href="/examples/evidence-table-2.json">Open the record</a>
            </p>
          </MarketingSection>

          <MarketingInterfaceGrid
            heading="Work with the same records from a terminal, TypeScript, or an agent."
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
                summary: "Open the database in your own code and read the same record.",
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
                summary: "Teach a coding agent to check the specification version and replay the log before it reads.",
                example: (
                  <>
                    <pre tabIndex={0}><code>{`oh contract
oh verify --db research.db --space default
oh get evidence:table-2 \\
  --db research.db --space default`}</code></pre>
                    <p className="interface-link"><a href={`${repository}/blob/main/skills/oh/SKILL.md`}>Read the Agent Skill</a></p>
                  </>
                ),
              },
            ]}
            label="Interfaces"
            summary="The CLI and the TypeScript SDK read and write the same SQLite file. The packaged Agent Skill has a coding agent run the commands you would run yourself, so its changes land in the log you verify."
          />

          <MarketingSection
            heading={longMemEvalHeading}
            headingId="benchmarks-title"
            id="benchmarks"
            label="Benchmarks"
            layout="split"
            summary="In each comparison, one model answers the same questions from each system’s memory, and every answer is scored the same way. Each result links to its protocol, costs, and limits."
          >
            <MemoryBenchmarkComparison />
          </MarketingSection>

          <MarketingSection
            heading={`${wordcell.name} uses Oh to query the graph of your Markdown notes.`}
            headingId="wordcell-title"
            id="wordcell"
            label="Built on Oh"
            layout="split"
            summary={`Use Oh to build memory into an application. Use ${wordcell.name} to work with a knowledge base made of Markdown files.`}
          >
            <p>Oh provides records, search, and query results that carry the path back
              to their sources. The application built on it decides what counts as a
              memory, when one may be written, and who can use it.</p>
            <p><a href={wordcell.canonicalUrl}>{wordcell.name}</a> is a {wordcell.oneLiner}.
              Your Markdown files stay authoritative, and {wordcell.name} derives an Oh
              graph from them to answer queries with a path back to each note.
              Rebuilding or deleting that graph never changes a note.</p>
            <p>{wordcell.name}’s search is its own pipeline with its own evaluations
              and does not use Oh’s memory retrieval, so the Oh scores above do not
              carry over to it.</p>
            <ul className="benchmark-links">
              <li><a href={`${wordcell.canonicalUrl}/developers`}>Build with {wordcell.name}</a></li>
              <li><a href={`${repository}/blob/main/docs/wordcell.md`}>Read how {wordcell.name} uses Oh</a></li>
            </ul>
          </MarketingSection>

          <MarketingInstallPanel
            eyebrow="Install"
            heading="Install and start with a local database."
            headingId="install-title"
            id="install"
            note={<p className="install-note">{`Latest release: v${releaseVersion}`}</p>}
          >
            <pre className="install-command" tabIndex={0}><code>{`bun add --global @hraness/oh@${releaseVersion}
oh --help`}</code></pre>
            <pre className="install-command" tabIndex={0}><code>{`oh init
oh put --kind entity --key entity:ada-lovelace \\
  --value '{"name":"Ada Lovelace","role":"mathematician"}'
oh get entity:ada-lovelace
oh search "mathematician"
oh verify`}</code></pre>
            <p className="install-note">
              The CLI needs Bun 1.3.14 or newer. The first task creates one entity, reads it back, finds it
              with keyword search, and verifies the log. Oh writes to <code>.oh/oh.sqlite</code> and
              the <code>default</code> space unless you pass <code>--db</code> or <code>--space</code>.{" "}
              <a href="https://github.com/hraness/oh#install-and-first-run">Read the full first run on GitHub</a>.
            </p>
            <p className="install-note">
              The <a href={publishedRelease.verificationRun}>release run</a> for this version installed the
              package on Linux and macOS and ran the CLI before publishing the same bytes to npm and GitHub
              Releases.
            </p>
          </MarketingInstallPanel>

          <MarketingTrustBoundary
            heading="Oh keeps research local by default and never decides what is true."
            headingId="kernel-title"
            id="kernel"
            items={trust}
            label="Control"
            summary="A search score, a valid digest, or an agent’s output never becomes an accepted claim on its own. Acceptance is a separate record that your application or a reviewer writes."
          />

          <MarketingQuestionList
            heading="What to know before you install."
            headingId="questions-title"
            id="questions"
            label="Questions"
            questions={questions.map(({ answer, question }) => ({
              answer: <AnswerBody answer={answer} />,
              question,
            }))}
          />
        </MarketingPage>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://oh.computer" />

      <OhContentFooter />
    </div>
  );
}
