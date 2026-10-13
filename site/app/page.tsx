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
import { FounderNote } from "./founder-note";
import { homeDescription } from "./metadata-copy";
import { CodeBlock, Terminal, Transcript } from "./code-block";
import { AgentHostSplit } from "./mockups/trail";
import { TrailHero } from "./mockups/trail-hero";

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

// The author's own description of Oh, from the portfolio registry.
const founderNote = marketing.blurb.text;

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
    summary: "What you are trying to find out.",
  },
  {
    label: marketingHeading("home-object-source"),
    kind: "entity",
    summary: "The paper, dataset, person, or system itself.",
  },
  {
    label: marketingHeading("home-object-capture"),
    kind: "edition",
    summary: "The edition or extract that was read.",
  },
  {
    label: marketingHeading("home-object-claim"),
    kind: "statement",
    summary: "The claim, apart from who accepts it.",
  },
  {
    label: marketingHeading("home-object-citation"),
    kind: "evidence",
    summary: "A passage or table and how it bears on a claim.",
  },
  {
    label: marketingHeading("home-object-artifact"),
    kind: "view",
    summary: "A brief or answer that links to its records.",
  },
] as const;

const trust = [
  {
    label: marketingHeading("home-trust-local"),
    detail: "Your records, the log of every change, and the keyword index live in a SQLite file you choose.",
  },
  {
    label: marketingHeading("home-trust-remote"),
    detail: "Hosted embeddings, sync, and remote libSQL run only when you configure them.",
  },
] as const;

/** Answers mark literal values with backticks: code on the page, plain text in the JSON-LD. */
const questions = [
  {
    question: "What is stored, and where?",
    answer: "One SQLite file holds your records, the log of every change, and a keyword index. The default is `.oh/oh.sqlite`.",
  },
  {
    question: "Is semantic search required?",
    answer: "No. The CLI uses keyword search. The SDK can add local semantic search through QMD or hosted Cloudflare Workers AI embeddings.",
  },
  {
    question: "Does a passing verification mean a claim is true?",
    answer: "No. It means replaying the log reproduced every record. Whether a claim holds lives in assertions linked to evidence.",
  },
  {
    question: "Where can I run it?",
    answer: "The CLI and local SDK need Bun 1.3.14 or newer. The libSQL adapter also runs on Node 24, including serverless functions.",
  },
  {
    question: `How does ${wordcell.name} relate to Oh?`,
    answer: `${wordcell.name} is a Markdown knowledge base built on Oh. Use Oh to build memory into your own application.`,
    link: { href: wordcell.canonicalUrl, label: `Visit ${wordcell.name}` },
  },
] as const;

const answerText = (answer: string): string => answer.replaceAll("`", "");

function AnswerBody({ answer, link }: Readonly<{ answer: string; link?: Readonly<{ href: string; label: string }> }>) {
  return (
    <p>
      {answer.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}
      {link ? <> <a href={link.href}>{link.label}</a>.</> : null}
    </p>
  );
}

const navigation = [
  { href: "#model", label: marketing.hero.secondaryAction },
  { href: "/docs", label: "Docs" },
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
        <MarketingPage landscape="page">
          <ProductHero
            actions={[
              { emphasis: "primary", href: "#install", label: "Run the first task" },
              { emphasis: "secondary", href: "#model", label: marketing.hero.secondaryAction },
            ]}
            align="start"
            backdrop={false}
            boundary={boundary}
            className="oh-hero"
            eyebrow={eyebrow}
            frame={<TrailHero />}
            heading={heading}
            headingId="hero-title"
            install={<PlatformInstall id="hero-install" platforms={installPlatforms} />}
            name=""
            summary={lead}
          />

          <FounderNote
            emoji={marketing.blurb.emoji}
            paragraphs={[founderNote]}
            action={{ label: `${marketing.blurb.cta.label}:`, href: marketing.blurb.cta.url }}
          />

          <MarketingSection
            heading={marketingHeading("model-title")}
            headingId="model-title"
            id="model"
            label="Six record kinds"
            summary="Everything an agent remembers is one of six record kinds, and each record names the records it depends on."
          >
            <dl className="oh-rows oh-records">
              {researchObjects.map((object) => (
                <div key={object.kind}>
                  <dt>{object.label} <code>{object.kind}</code></dt>
                  <dd>{object.summary}</dd>
                </div>
              ))}
            </dl>
            <p className="record-link"><a href="/spec#ontology">Read the record types and format</a></p>
          </MarketingSection>

          <MarketingSection
            heading={marketingHeading("trace-title")}
            headingId="trace-title"
            id="trace"
            label="Citation round trip"
            summary="Each write joins a history you can replay: save a citation, read it back with its records, and check the store."
          >
            <MarketingProofFrame className="oh-proof" title="Save and read a citation">
              <Transcript label="Saving and reading a citation with the oh CLI, using a fictional trial report" text={proofTranscript} />
            </MarketingProofFrame>
            <p className="record-link"><a href="/examples/evidence-table-2.json">Open the example citation</a></p>
          </MarketingSection>

          <MarketingSection
            heading="Your agent proposes. Your app decides."
            headingId="review-title"
            id="review"
            label="Working notes, reviewed knowledge"
            summary="An agent can remember, look up, explain, and propose; only your application’s code adds a proposal to reviewed knowledge."
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
                summary: "Read one record from the file you choose.",
                example: (
                  <Terminal code={`oh get evidence:table-2 \\
  --db research.db \\
  --space default`} />
                ),
                link: { href: "#install", label: "Run the first task" },
              },
              {
                label: marketingHeading("home-interface-sdk"),
                summary: "Open the same file from your code.",
                example: (
                  <CodeBlock code={`import { Oh } from "@hraness/oh/sdk";

const oh = Oh.open({
  databasePath: "research.db",
});
oh.get("evidence:table-2");
await oh.close();`} />
                ),
                link: { href: "https://github.com/hraness/oh#use-the-sdk", label: "Read the SDK guide" },
              },
              {
                label: marketingHeading("home-interface-skill"),
                summary: "An agent checks the contract and the log before reading.",
                example: (
                  <Terminal code={`oh contract
oh verify --db research.db --space default
oh get evidence:table-2 \\
  --db research.db --space default`} />
                ),
                link: { href: `${repository}/blob/main/skills/oh/SKILL.md`, label: "Read the Agent Skill" },
              },
            ]}
            label="CLI, SDK, skill"
            summary="The CLI, the TypeScript SDK, and the packaged Agent Skill read and write the same SQLite file."
          />

          <MarketingSection
            heading={longMemEvalHeading}
            headingId="benchmarks-title"
            id="benchmarks"
            label="LongMemEval-S"
            summary="One model answers the same questions from each system’s memory, and every answer is graded the same way."
          >
            <MemoryBenchmarkComparison />
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
              The first task saves an entity, reads it back, searches for it, and verifies the log.{" "}
              <a href="https://github.com/hraness/oh#install-and-first-run">Read the full first run on GitHub</a>.
            </p>
          </MarketingInstallPanel>

          <MarketingTrustBoundary
            heading={marketingHeading("kernel-title")}
            headingId="kernel-title"
            id="kernel"
            items={trust}
            label="Control"
            summary="Start with a local SQLite file and no account; connect remote services only when you need them."
          />

          <MarketingQuestionList
            heading={marketingHeading("questions-title")}
            headingId="questions-title"
            id="questions"
            label="Questions"
            questions={questions.map(({ answer, question, ...rest }) => ({
              answer: <AnswerBody answer={answer} link={"link" in rest ? rest.link : undefined} />,
              question,
            }))}
          />
        </MarketingPage>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://oh.computer" />
    </div>
  );
}
