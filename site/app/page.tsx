import { marketing, marketingHeading, portfolio, product } from "../portfolio-copy";
import {
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
import { AskAiAboutThis } from "@hraness/ui";
import { websiteJsonLd } from "@hraness/web-discovery";

import { DesignPaletteMenuButton, PlatformBadges, PlatformInstall } from "@hraness/design-kit/react";

import publishedRelease from "../published-release.json";
import { MemoryBenchmarkComparison, longMemEvalHeading } from "./benchmark-comparison";
import { ohSearchSite } from "./blog/articles";
import { homeDescription } from "./metadata-copy";
import { CodeBlock, Terminal, Transcript } from "./code-block";
import { AgentHostSplit } from "./mockups/trail";
import { TrailSteps } from "./mockups/trail-steps";

const releaseVersion = publishedRelease.version;
const installCommand = `bun add --global @hraness/oh@${releaseVersion}`;
const bunNote = "Requires Bun 1.3.14+";
// The release workflow installs this exact package and runs `oh` on each platform.
const installPlatforms = [
  { id: "macos", command: installCommand, shell: "Terminal", note: `Apple silicon and Intel · ${bunNote}` },
  { id: "linux", command: installCommand, shell: "Terminal", note: `x86_64 and ARM64 · ${bunNote}` },
  { id: "windows", command: installCommand, shell: "PowerShell", note: `x86_64 · ${bunNote}` },
] as const;
const repository = "https://github.com/hraness/oh";
// hraness.com publishes the Organization node this @id names.
const hranessOrganizationId = "https://hraness.com/#organization";
const wordcell = product("kb");
// The Wordcell section links a sibling product, so it needs a registered relation.
if (!portfolio.relations.some(item => item.source === wordcell.id && item.target === portfolio.productId && item.kind === "runtime")) {
  throw new Error("The portfolio registry has no runtime relation between Oh and Wordcell.");
}

const eyebrow = marketing.category;
const heading = marketing.hero.heading;
const lead =
  marketing.hero.summary;
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

const researchObjects = [
  {
    label: marketingHeading("home-object-question"),
    kind: "inquiry",
    summary: "Save what you are trying to find out, along with the investigation that follows.",
  },
  {
    label: marketingHeading("home-object-source"),
    kind: "entity",
    summary: "Identify the paper, dataset, person, or system you are researching, even if its title or URL changes.",
  },
  {
    label: marketingHeading("home-object-capture"),
    kind: "edition",
    summary: "Record the edition or extract you read, separate from the source as it looks today.",
  },
  {
    label: marketingHeading("home-object-claim"),
    kind: "statement",
    summary: "Write down the claim itself, and keep who accepts it and the evidence for it in separate records.",
  },
  {
    label: marketingHeading("home-object-citation"),
    kind: "evidence",
    summary: "Point to a passage, table, or observation, and record how it bears on a stance toward a claim, such as support or contradiction.",
  },
  {
    label: marketingHeading("home-object-artifact"),
    kind: "view",
    summary: "Build a brief or answer that keeps links to the records it draws on.",
  },
] as const;

const trust = [
  {
    label: marketingHeading("home-trust-local"),
    detail: "Your records, the log of every change, and the keyword index live in a SQLite file you choose. Semantic search caches are derived from the records and can be rebuilt.",
  },
  {
    label: marketingHeading("home-trust-remote"),
    detail: "Hosted embeddings, network sync, and a remote libSQL database are used only when you configure them. Sync sends operations, never search vectors.",
  },
] as const;

/** Answers mark literal values with backticks: code on the page, plain text in the JSON-LD. */
const questions = [
  {
    question: "What is stored, and where?",
    answer: "One SQLite file holds your records and their digests, the append-only log of every change, a keyword index built from the records, and the specification version the file follows. Oh uses `.oh/oh.sqlite` and the `default` space unless you name another path or space. Semantic caches and remote copies exist only where you configure them.",
  },
  {
    question: "Is semantic search required?",
    answer: "No. The CLI uses keyword search without a model. The SDK can add local semantic search through QMD, or hosted embeddings from Cloudflare Workers AI. Hosted embeddings send record text to Cloudflare. Oh drops results whose records have changed or been removed since indexing.",
  },
  {
    question: "Does a passing verification mean a claim is true?",
    answer: "No. A passing verification means the records and their history are intact: replaying the log reproduced every digest. Search scores measure relevance, not truth. Whether a claim holds is recorded separately, in assertions and review decisions linked to their evidence.",
  },

  {
    question: "Where can I run it?",
    answer: "The CLI, the local SDK, and the SQLite store need Bun 1.3.14 or newer. The runtime-neutral store interfaces and the direct libSQL adapter also run on Node 24, including in serverless functions.",
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
  { href: "#model", label: marketing.hero.secondaryAction },
  { href: "/benchmarks", label: "Benchmarks" },
  { href: "/compare", label: "Compare" },
  { href: "/blog", label: "Blog" },
  { href: "/spec", label: "Specification" },
  { href: repository, label: "GitHub" },
] as const;

export default function Home() {
  const structuredData = [
    { ...websiteJsonLd(ohSearchSite), publisher: { "@id": hranessOrganizationId } },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      "@id": "https://oh.computer/#software",
      codeRepository: repository,
      description: homeDescription,
      license: "https://opensource.org/license/mit",
      name: marketing.names.name,
      programmingLanguage: "TypeScript",
      publisher: {
        "@type": "Organization",
        "@id": hranessOrganizationId,
        name: "Hraness",
        url: "https://hraness.com",
      },
      runtimePlatform: "Bun",
      url: "https://oh.computer",
      version: releaseVersion,
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
        action={{ href: "#hero-install", label: marketing.hero.primaryAction }}
        brand={marketing.names.name}
        brandMark="/marks/oh-computer.svg"
        brandLabel={`${marketing.names.name} home`}
        links={navigation}
        trailing={<DesignPaletteMenuButton />}
      />

      <main id="main" tabIndex={-1}>
        <MarketingPage className="product-landscape">
          <ProductHero
            actions={[
              { emphasis: "secondary", href: "#install", label: "First run" },
              { emphasis: "secondary", href: "#model", label: marketing.hero.secondaryAction },
            ]}
            align="start"
            backdrop={false}
            boundary={boundary}
            className="oh-hero"
            eyebrow={eyebrow}
            frame={(
              <MarketingProofFrame
                className="oh-proof"
                title="Save and read a citation"
              >
                <Transcript label="Saving and reading a citation with the oh CLI, using a fictional trial report" text={proofTranscript} />
              </MarketingProofFrame>
            )}
            heading={heading}
            headingId="hero-title"
            install={<PlatformInstall id="hero-install" platforms={installPlatforms} />}
            name=""
            summary={lead}
          />

          <MarketingSection
            heading={marketingHeading("model-title")}
            headingId="model-title"
            id="model"
            label="How it works"
            summary="Save questions, sources, claims, and citations as separate linked records. Your agent can revise a claim while keeping the source it read and the history of how it got there."
          >
            <dl className="oh-rows">
              {researchObjects.map((object) => (
                <div key={object.kind}>
                  <dt>{object.label} <code>{object.kind}</code></dt>
                  <dd>{object.summary}</dd>
                </div>
              ))}
            </dl>
            <p>Each write joins a history you can replay. Keyword search finds saved records without a model; your application can add semantic search when it needs to find related ideas.</p>
            <p className="record-link"><a href="/spec#ontology">Explore the record types and format</a></p>
          </MarketingSection>

          <MarketingSection
            heading={marketingHeading("trace-title")}
            headingId="trace-title"
            id="trace"
            label="From answer to source"
            summary="In the example above, the citation points to table 2 in a saved edition of a trial report and records that it supports a claim. An application can follow those links to show what an answer rests on."
          >
            <TrailSteps />
            <p>Oh checks that records and their history remain intact. It does not decide whether a claim is true.</p>
            <p className="record-link"><a href="/examples/evidence-table-2.json">Open the example citation</a></p>
          </MarketingSection>

          <MarketingSection
            heading="Your agent proposes. Your app decides."
            headingId="review-title"
            id="review"
            label="Working notes and reviewed knowledge"
            summary="An agent can remember, look up, explain and propose. Only your application's own code can add a proposal to reviewed knowledge."
          >
            <AgentHostSplit stage="nominated" />
            <p className="record-link"><a href="/blog/introducing-oh">Read the launch post</a></p>
          </MarketingSection>

          <MarketingInterfaceGrid
            heading={marketingHeading("interfaces-title")}
            headingId="interfaces-title"
            id="interfaces"
            interfaces={[
              {
                label: marketingHeading("home-interface-cli"),
                summary: "Read one record from the local database and space you select.",
                example: (
                  <>
                    <Terminal code={`oh get evidence:table-2 \\
  --db research.db \\
  --space default`} />
                    <p className="interface-link"><a href="#install">Run the first task</a></p>
                  </>
                ),
              },
              {
                label: marketingHeading("home-interface-sdk"),
                summary: "Open the database in your own code and read the same record.",
                example: (
                  <>
                    <CodeBlock code={`import { Oh } from "@hraness/oh/sdk";

const oh = Oh.open({ databasePath: "research.db" });
try {
  const citation = oh.get("evidence:table-2");
  console.log(citation?.recordSha256);
} finally {
  await oh.close();
}`} />
                    <p className="interface-link"><a href="https://github.com/hraness/oh#use-the-sdk">Read the SDK guide</a></p>
                  </>
                ),
              },
              {
                label: marketingHeading("home-interface-skill"),
                summary: "Teach a coding agent to check the specification version and replay the log before it reads.",
                example: (
                  <>
                    <Terminal code={`oh contract
oh verify --db research.db --space default
oh get evidence:table-2 \\
  --db research.db --space default`} />
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
            <p><a href={wordcell.canonicalUrl}>{wordcell.name}</a> keeps notes in Markdown and uses Oh to follow their links. Choose it when you want a knowledge base to use today; choose Oh when you are building memory into your own application.</p>
            <p>Wordcell’s search has separate evaluations. Oh’s memory scores do not measure that search.</p>
          </MarketingSection>

          <MarketingInstallPanel
            eyebrow="Install"
            heading={marketingHeading("install-title")}
            headingId="install-title"
            id="install"
            note={<p className="install-note">{`Latest release: v${releaseVersion}`}</p>}
          >
            <PlatformBadges platforms={["macos", "linux", "windows"]} />
            <Terminal code={`oh init
oh put --kind entity --key entity:ada-lovelace \\
  --value '{"name":"Ada Lovelace","role":"mathematician"}'
oh get entity:ada-lovelace
oh search "mathematician"
oh verify`} />
            <p className="install-note">
              The CLI needs Bun 1.3.14 or newer. The first task creates one entity, reads it back, finds it
              with keyword search, and verifies the log. Oh writes to <code>.oh/oh.sqlite</code> and
              the <code>default</code> space unless you pass <code>--db</code> or <code>--space</code>.{" "}
              <a href="https://github.com/hraness/oh#install-and-first-run">Read the full first run on GitHub</a>.
            </p>

          </MarketingInstallPanel>

          <MarketingTrustBoundary
            heading={marketingHeading("kernel-title")}
            headingId="kernel-title"
            id="kernel"
            items={trust}
            label="Control"
            summary="Start with a local SQLite file, without an account. Connect remote services only when your application needs them."
          />

          <MarketingQuestionList
            heading={marketingHeading("questions-title")}
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
    </div>
  );
}
