import type { Metadata } from "next";

import pilotResult from "../../../../benchmarks/results/memory-framework-pilot-v1.json";
import { BenchmarkChart } from "../../benchmark-chart";
import { compareSupermemoryDescription, compareSupermemoryImageAlt, compareSupermemoryTitle } from "../../metadata-copy";
import { benchmarkEvidence, ComparePage, CompareSection, CompareSources, repository } from "../compare";

export const metadata: Metadata = {
  title: compareSupermemoryTitle,
  description: compareSupermemoryDescription,
  alternates: { canonical: "/compare/supermemory" },
  openGraph: {
    title: compareSupermemoryTitle,
    description: compareSupermemoryDescription,
    images: [{
      alt: compareSupermemoryImageAlt,
      height: 630,
      url: "/compare/supermemory/opengraph-image",
      width: 1200,
    }],
    url: "/compare/supermemory",
  },
  twitter: {
    card: "summary_large_image",
    title: compareSupermemoryTitle,
    description: compareSupermemoryDescription,
    images: [{ alt: compareSupermemoryImageAlt, url: "/compare/supermemory/opengraph-image" }],
  },
};

const supermemoryDocs = "https://supermemory.ai/docs";
const checkedOn = "September 26, 2026";

const nav = [
  { href: "#head-to-head", label: "Head to head" },
  { href: "#hosted", label: "What Supermemory runs" },
  { href: "#local", label: "What Oh keeps local" },
  { href: "#choosing", label: "Choosing" },
  { href: "#limits", label: "Limits" },
  { href: "#sources", label: "Sources" },
] as const;

const percent = (value: number) => `${value.toFixed(2)}%`;
const points = (value: number) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}`;

function pilotArm(arm: string) {
  const row = pilotResult.quality.arms.find((entry) => entry.arm === arm);
  if (!row) throw new Error(`framework pilot arm missing: ${arm}`);
  return row;
}

const oh = pilotArm("oh");
const supermemory = pilotArm("supermemory");
const bm25 = pilotArm("bm25");
const primary = pilotResult.quality.comparisons.primary;

const questionTypes = supermemory.byType.map((row) => row.questionType);
const correctFor = (arm: (typeof pilotResult.quality.arms)[number], type: string) =>
  arm.byType.find((row) => row.questionType === type)?.correct ??
  (() => { throw new Error(`Pilot cell missing: ${arm.arm} ${type}`); })();

const sources = [
  {
    title: "Memory framework pilot result",
    href: `${benchmarkEvidence}/FRAMEWORK_PILOT_RESULT_V1.md`,
    note: "The matched run’s protocol, costs, failure cells, and limits.",
  },
  {
    title: "Pilot data as JSON",
    href: `${benchmarkEvidence}/results/memory-framework-pilot-v1.json`,
    note: "The checked-in numbers behind every figure on this page.",
  },
  {
    title: "Supermemory pricing",
    href: "https://supermemory.ai/pricing",
    note: `Plans and credit terms checked ${checkedOn}.`,
  },
  {
    title: "Supermemory connectors",
    href: `${supermemoryDocs}/connectors/overview`,
    note: `Connector list and sync behavior checked ${checkedOn}.`,
  },
  {
    title: "Supermemory container tags",
    href: `${supermemoryDocs}/concepts/container-tags`,
    note: `Per-tag isolation and scoped keys checked ${checkedOn}.`,
  },
  {
    title: "Supermemory self-hosting",
    href: `${supermemoryDocs}/self-hosting/overview`,
    note: `The local binary and what stays Platform-only, checked ${checkedOn}.`,
  },
  {
    title: "Oh README",
    href: `${repository}/blob/main/README.md`,
    note: "Install, CLI commands, and what Oh stores.",
  },
  {
    title: "Oh ontology specification",
    href: "/spec",
    note: "Records, digests, the operation log, and memory composition.",
  },
] as const;

export default function CompareSupermemory() {
  return (
    <ComparePage
      canonical="https://oh.computer/compare/supermemory"
      eyebrow="Comparison"
      lead="Supermemory is a hosted memory API for products: connectors sync documents into containers partitioned per user, and calls draw down monthly credits. Oh is MIT-licensed memory for an agent’s own work in one local SQLite file. The two ran the same 60 benchmark questions here, and Supermemory scored higher on the headline measure without a statistically clean separation."
      nav={nav}
      navLabel="Oh vs Supermemory"
      title="Oh vs Supermemory"
    >
      <CompareSection id="head-to-head" number="01" title="Head to head on LongMemEval-S">
        <p>
          On September 24, 2026, this repository ran a matched pilot: the same 60 LongMemEval-S
          questions went to Supermemory, Oh’s default SDK search, and a BM25 control, each limited
          to 20 results, answered by the same GPT-4o reader and graded by the same GPT-4o judge
          under LongMemEval’s own prompts.
        </p>
        <BenchmarkChart
          label="Oh, Supermemory, and BM25 on 60 LongMemEval-S questions, share answered correctly, zero to one hundred percent"
          rows={[
            { id: "pilot-supermemory", label: "Supermemory", value: supermemory.conservativeSuccessRate.value * 100,
              detail: "One document per session, hybrid search with reranking" },
            { id: "pilot-oh", label: "Oh default SDK search", value: oh.conservativeSuccessRate.value * 100,
              detail: "Single turns, reranked locally" },
            { id: "pilot-bm25", label: "BM25 keyword retrieval", value: bm25.conservativeSuccessRate.value * 100,
              detail: "Single turns" },
          ]}
        />
        <p>
          On the conservative measure, which counts a failed or unrun cell as zero, Supermemory
          answered {percent(supermemory.conservativeSuccessRate.value * 100)} correctly, Oh{" "}
          {percent(oh.conservativeSuccessRate.value * 100)}, and BM25{" "}
          {percent(bm25.conservativeSuccessRate.value * 100)}. On the comparison fixed before the
          run, the Oh − Supermemory difference is {points(primary.estimate)} points with a 95%
          interval from {points(primary.interval95.lower)} to {points(primary.interval95.upper)}:
          60 questions, all used earlier in Oh’s development, cannot separate them.
        </p>
        <div className="compare-table-wrap">
          <table className="compare-table">
            <caption>Correct answers per question type, 10 questions each.</caption>
            <thead>
              <tr>
                <th scope="col">Question type</th>
                <th scope="col">Oh</th>
                <th scope="col">Supermemory</th>
                <th scope="col">BM25</th>
              </tr>
            </thead>
            <tbody>
              {questionTypes.map((type) => (
                <tr key={type}>
                  <td><code>{type}</code></td>
                  <td>{correctFor(oh, type)}</td>
                  <td>{correctFor(supermemory, type)}</td>
                  <td>{correctFor(bm25, type)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Supermemory’s edge concentrated in <code>knowledge-update</code>, where it answered nine
          of ten to Oh’s five and where two of Oh’s three ungraded cells also sit. Oh led on{" "}
          <code>single-session-preference</code> (five to four) and{" "}
          <code>single-session-user</code> (nine to eight); the other three types were ties.
          Supermemory completed all 60 cases; Oh and BM25 completed 57 each after two retrieval
          failures and one cell left unrun.
        </p>
        <p>
          The arms differed by design. Supermemory stored one document per session, its published
          LongMemBench method, and searched with one fixed profile (hybrid mode, top 20, rerank
          on); Oh and BM25 stored single turns. Supermemory’s search answered in a median of about
          one second as a hosted API call, while Oh’s median was 12.5 seconds including local
          reranker inference on the benchmark machine, a development measurement rather than a
          hosted-service comparison. On the ingestion side, Supermemory’s asynchronous pipeline
          took a median 61.5 minutes to readiness per case, up to 141 minutes, while Oh indexed
          each case in a disposable local store. The Supermemory side spent about $43 of Pro-plan
          credits across the runs, and the shared reader and judge cost $2.28.
        </p>
        <ul className="benchmark-links" aria-label="Pilot evidence">
          <li><a href={`${benchmarkEvidence}/FRAMEWORK_PILOT_RESULT_V1.md`}>Full result and limits</a></li>
          <li><a href={`${benchmarkEvidence}/results/memory-framework-pilot-v1.json`}>Numbers as JSON</a></li>
        </ul>
      </CompareSection>

      <CompareSection id="hosted" number="02" title="What Supermemory runs for you">
        <p>
          Supermemory hosts the memory store, the ingestion pipeline, and the retrieval stack.
          Container tags partition memories by user, project, or any string you choose: each tag
          maps to its own vector namespace, and API keys can be scoped to specific tags, so a
          customer’s agent cannot read another tenant’s data. Connectors sync Google Drive, Gmail,
          Notion, OneDrive, GitHub, Granola, and crawled web pages into the same memory space on
          webhooks or a schedule.
        </p>
        <p>
          Pricing is metered in SM tokens at the same rates on every plan, billed monthly with
          credits that refresh each month, checked {checkedOn}: a free tier with $5 of credits,
          Pro at $19 a month with $20, Max at $100 with $130 and the Gmail connector, and Scale at
          $399 with $600 plus the S3 and web crawler connectors, unlimited seats, SOC 2 and HIPAA
          compliance, and a self-hosted deployment option. Enterprise is custom.
        </p>
        <p>
          A self-hosted build exists. Supermemory local is a free, open-source single binary that
          speaks the same API and runs on your own model key, or fully offline on a local model.
          Its documentation keeps connectors, the MCP server, and the platform’s tuned extraction
          models on the hosted platform.
        </p>
      </CompareSection>

      <CompareSection id="local" number="03" title="What Oh keeps local">
        <p>
          Oh writes each record to a SQLite file on your machine: <code>oh put</code> stores a
          record, <code>oh get</code> reads it back, <code>oh search</code> finds it, and{" "}
          <code>oh verify</code> replays the append-only log of every change and recomputes each
          record’s SHA-256 digest. There is no account, no credits meter, and no hosted Oh
          service; Oh is MIT licensed and free.
        </p>
        <p>
          Each record carries dependency links to the records it rests on, so a fact traces back
          to the edition, passage, or table it was read from instead of arriving as bare memory
          text. Keyword search needs no model; semantic search is optional and runs on a local
          model by default, with a hosted Cloudflare profile you can configure. Operation-level
          sync to a libSQL database you control is likewise opt-in, and it sends operations rather
          than database pages.
        </p>
      </CompareSection>

      <CompareSection id="choosing" number="04" title="Choosing between them">
        <ul className="sequence">
          <li><span>Supermemory</span> when your product needs per-end-user memory with managed ingestion, connectors, scoped keys, and someone else running the retrieval stack, at metered prices.</li>
          <li><span>Oh</span> when the memory is your agent’s own working knowledge: local by default, every fact linked to its sources, and no account or per-call cost.</li>
        </ul>
        <p>
          The pilot did not separate them on answer quality, so if memory quality for your
          workload decides the choice, run both on your own questions. The pilot’s contract,
          adapters, and cost ledger are checked into the repository.
        </p>
      </CompareSection>

      <CompareSection id="limits" number="05" title="Limits of this evidence">
        <ul className="sequence">
          <li><span>60 exposed questions</span> The sample is previously exposed development questions, run once; the interval describes resampling within this sample only.</li>
          <li><span>Unpinned models</span> The GPT-4o reader and judge ran as gateway aliases, so a returned model name does not identify an immutable snapshot.</li>
          <li><span>Uneven granularity</span> Supermemory indexed session documents while Oh and BM25 indexed turns; the run is not a claim about Supermemory’s defaults, its best configuration, or its published Recall@20 result.</li>
          <li><span>Asymmetric latency</span> Oh’s search time includes local reranker inference on the benchmark machine, and Supermemory’s readiness wait reflects its asynchronous pipeline under a 16-case concurrent load; neither is a like-for-like hosted comparison.</li>
          <li><span>Agent-run</span> AI agents ran this study, and no person or outside group has audited it.</li>
          <li><span>Dated claims</span> Supermemory’s pricing, connector list, and self-hosting notes come from its own pages, checked {checkedOn}, and can change.</li>
        </ul>
      </CompareSection>

      <CompareSection id="sources" number="06" title="Sources">
        <CompareSources items={sources} />
      </CompareSection>
    </ComparePage>
  );
}
