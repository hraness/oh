import { breadcrumbJsonLd } from "@hraness/web-discovery";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";

import memEval from "../../../../benchmarks/results/memory-evolution-memeval-102-v1.json";
import { ohSearchSite } from "../../blog/articles";
import { compareMem0Description, compareMem0ImageAlt, compareMem0Title } from "../../metadata-copy";
import { benchmarkEvidence, ComparePage, CompareSection, CompareSources, repository } from "../compare";

export const metadata: Metadata = {
  title: compareMem0Title,
  description: compareMem0Description,
  alternates: { canonical: "/compare/mem0" },
  openGraph: {
    title: compareMem0Title,
    description: compareMem0Description,
    images: [{
      alt: compareMem0ImageAlt,
      height: 630,
      url: "/compare/mem0/opengraph-image",
      width: 1200,
    }],
    url: "/compare/mem0",
  },
  twitter: {
    card: "summary_large_image",
    title: compareMem0Title,
    description: compareMem0Description,
    images: [{ alt: compareMem0ImageAlt, url: "/compare/mem0/opengraph-image" }],
  },
};

const mem0Docs = "https://docs.mem0.ai";
const checkedOn = "September 26, 2026";

const nav = [
  { href: "#different-jobs", label: "Different jobs" },
  { href: "#platform-open-source", label: "Platform and open source" },
  { href: "#matched-run", label: "The matched run" },
  { href: "#oh-records", label: "What Oh keeps" },
  { href: "#choosing", label: "Choosing" },
  { href: "#limits", label: "Limits" },
  { href: "#sources", label: "Sources" },
] as const;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function memEvalSystem(name: string, reader?: string) {
  const system = memEval.systems.find((entry) =>
    entry.system === name && (reader === undefined || ("reader" in entry && entry.reader === reader)));
  if (!system) throw new Error(`MemEval system missing: ${name} ${reader ?? ""}`);
  return system;
}

const mem0Arm = memEvalSystem("mem0");
const matched = "matchedOhOnSameQuestions" in mem0Arm ? mem0Arm.matchedOhOnSameQuestions : undefined;
const mem0Questions = "questions" in mem0Arm ? mem0Arm.questions : undefined;
if (!matched || typeof mem0Questions !== "number") {
  throw new Error("The MemEval result has no matched Oh rows for mem0.");
}
const mem0Correct = Math.round(mem0Arm.accuracy * mem0Questions);
const oh41Mini = memEvalSystem("oh", "openai/gpt-4.1-mini");
const oh41 = memEvalSystem("oh", "openai/gpt-4.1");
const matchedMini = matched["openai/gpt-4.1-mini"];
const matchedFull = matched["openai/gpt-4.1"];
const matchedPercent = (entry: Readonly<{ correct: number; of: number }>) =>
  percent(entry.correct / entry.of);

const sources = [
  {
    title: "Mem0 documentation: Platform vs Open Source",
    href: `${mem0Docs}/platform/platform-vs-oss`,
    note: `Feature split and provider counts checked ${checkedOn}.`,
  },
  {
    title: "Mem0 documentation: Platform overview",
    href: `${mem0Docs}/platform/overview`,
    note: `Managed-service description checked ${checkedOn}.`,
  },
  {
    title: "mem0ai/mem0 on GitHub",
    href: "https://github.com/mem0ai/mem0",
    note: `Apache-2.0 license checked ${checkedOn}.`,
  },
  {
    title: "Mem0 research and published scores",
    href: "https://mem0.ai/research",
    note: `Published LongMemEval and LoCoMo figures checked ${checkedOn}.`,
  },
  {
    title: "ProsusAI MemEval on GitHub",
    href: "https://github.com/ProsusAI/MemEval",
    note: `The third-party harness used for the matched run, at commit 807ae6d, checked ${checkedOn}.`,
  },
  {
    title: "Oh benchmark release results",
    href: `${benchmarkEvidence}/EVOLUTION_RELEASE_RESULTS.md`,
    note: "The matched 30-question run, its protocol differences, and its stated limits.",
  },
  {
    title: "MemEval run data as JSON",
    href: `${benchmarkEvidence}/results/memory-evolution-memeval-102-v1.json`,
    note: "The checked-in numbers behind the matched run.",
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
  {
    title: "Oh license",
    href: `${repository}/blob/main/LICENSE`,
    note: "MIT.",
  },
] as const;

export default function CompareMem0() {
  return (
    <ComparePage
      canonical="https://oh.computer/compare/mem0"
      eyebrow="Comparison"
      jsonLd={
        <JsonLdScript
          data={breadcrumbJsonLd(ohSearchSite.origin, [
            { name: "Oh", path: "/" },
            { name: "Comparisons", path: "/compare" },
            { name: "Oh vs Mem0", path: "/compare/mem0" },
          ])}
          id="compare-mem0-json-ld"
        />
      }
      lead="Mem0 gives an application a memory for each of its users: messages go in, distilled facts come back. Oh keeps an agent’s own working memory in a local SQLite file, where each fact stays linked to the records it came from. The two overlap on the word “memory” more than on the job."
      nav={nav}
      navLabel="Oh vs Mem0"
      title="Oh vs Mem0"
    >
      <CompareSection id="different-jobs" number="01" title="Different products, different jobs">
        <p>
          Mem0 is a memory layer for AI applications. Its core calls are <code>add</code>, which
          extracts facts from the messages you send, and <code>search</code>, which returns the
          memories that match a query. Memories are scoped by <code>user_id</code>,{" "}
          <code>agent_id</code>, and <code>run_id</code>, so a product can keep each end user’s memory
          separate. Mem0 ships in two forms: the hosted Platform, and an open-source SDK released
          under Apache-2.0 that you run on your own stack.
        </p>
        <p>
          Oh is memory for the agent’s own work rather than for its users. You or your agent write
          records with <code>oh put</code> and read them with <code>oh get</code>; a record’s
          dependencies link it to the records it rests on, so a brief can be traced back to the
          passage or table behind each claim. One local SQLite file holds the records, the
          append-only log of every change, and a keyword index, and <code>oh verify</code> replays
          the log and recomputes every digest. Oh is MIT licensed, needs no account, and has no
          hosted service.
        </p>
      </CompareSection>

      <CompareSection id="platform-open-source" number="02" title="Where Mem0 Platform ends and open source begins">
        <p>
          Both forms share the same extraction and retrieval loop and the same per-user scoping.
          The Platform runs the vector store, LLM, and embedder for you and adds capabilities the
          open-source SDK does not have: graph memory, memory decay, temporal reasoning, and Dream
          background consolidation, plus webhooks, memory export, custom categories, batch updates
          and deletes, organizations and projects, and the dashboard at app.mem0.ai. Passing the
          OSS SDK a <code>decay</code> or temporal parameter raises a “not supported” error, per
          the documentation.
        </p>
        <p>
          The open-source SDK instead runs on infrastructure you provision. Its documentation
          counted 25 vector stores, 18 LLM providers, and 11 embedders at that page’s writing, so
          you choose and pay for each piece yourself. Self-hosting keeps the data on your systems
          and removes usage billing; the Platform-only ranking features stay on the Platform.
        </p>
        <p className="benchmark-note">
          Feature split and provider counts from Mem0’s “Platform vs Open Source” documentation,
          checked {checkedOn}.
        </p>
      </CompareSection>

      <CompareSection id="matched-run" number="03" title="The one matched run so far">
        <p>
          In September 2026 this repository ran both systems through{" "}
          <a href="https://github.com/ProsusAI/MemEval">ProsusAI’s MemEval</a>, a third-party
          harness, on its stratified 102-question LongMemEval-S sample. MemEval drops
          the question date, answers with a 50-token cap, and re-ingests the history per question,
          a protocol that lowers every system’s score relative to the studies on the{" "}
          <a href="/#benchmarks">homepage</a>.
        </p>
        <div className="compare-table-wrap">
          <table className="compare-table">
            <caption>
              MemEval on its 102-question LongMemEval-S sample, judged by the harness’s LongMemEval
              prompts on a GPT-4o alias. Mem0 ran the first 30 questions.
            </caption>
            <thead>
              <tr>
                <th scope="col">System</th>
                <th scope="col">Reader</th>
                <th scope="col">Correct</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Mem0 open source 1.0.3</td>
                <td>gpt-4.1-mini</td>
                <td>{percent(mem0Arm.accuracy)} ({mem0Correct}/{mem0Questions})</td>
              </tr>
              <tr>
                <td>Oh semantic, same 30 questions</td>
                <td>gpt-4.1-mini</td>
                <td>{matchedPercent(matchedMini)} ({matchedMini.correct}/{matchedMini.of})</td>
              </tr>
              <tr>
                <td>Oh semantic, same 30 questions</td>
                <td>gpt-4.1</td>
                <td>{matchedPercent(matchedFull)} ({matchedFull.correct}/{matchedFull.of})</td>
              </tr>
              <tr>
                <td>Oh semantic, all 102 questions</td>
                <td>gpt-4.1-mini</td>
                <td>{percent(oh41Mini.accuracy)}</td>
              </tr>
              <tr>
                <td>Oh semantic, all 102 questions</td>
                <td>gpt-4.1</td>
                <td>{percent(oh41.accuracy)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          With the same reader on the same 30 questions, Oh answered {matchedMini.correct}
          {" "}to Mem0’s {mem0Correct}. Mem0’s run spent about 9.0 million tokens across{" "}
          {mem0Arm.tokens.calls.toLocaleString("en-US")} calls, most of them extraction, against
          about 0.55 million for Oh on the same questions. The result document is direct about the
          bound: thirty questions cannot support a precise margin, so this is a matched observation,
          not a superiority claim. Mem0’s ingestion took about twelve minutes per question, which is
          what kept the run at 30.
        </p>
        <p>
          Mem0 publishes higher figures from its own protocol, 94.4 on LongMemEval and 92.5 on
          LoCoMo at mem0.ai/research, with a different reader, judge, and ingestion path. Those
          scores do not compare directly with a matched run.
        </p>
        <ul className="benchmark-links" aria-label="Matched run evidence">
          <li><a href={`${benchmarkEvidence}/EVOLUTION_RELEASE_RESULTS.md`}>Full result and limits</a></li>
          <li><a href={`${benchmarkEvidence}/results/memory-evolution-memeval-102-v1.json`}>Numbers as JSON</a></li>
        </ul>
      </CompareSection>

      <CompareSection id="oh-records" number="04" title="What Oh keeps that a distilled memory drops">
        <p>
          Mem0’s <code>add</code> asks a model to distill messages into facts; what it stores is the
          extraction. Oh stores the record you write, unchanged. The claim, the stance taken on it,
          and the evidence for it live in separate linked records, each carrying a SHA-256 digest of
          its canonical bytes. Revising a fact appends a new operation instead of editing history,
          and the log replays under <code>oh verify</code>.
        </p>
        <p>
          That shape suits an agent’s working memory, where “what is this answer resting on” must
          have an answer, more than it suits per-user personalization inside a product. Oh has no{" "}
          <code>user_id</code> model; its nearest analogue is the named space inside a database, and
          multi-tenant rules are the application’s job. Semantic search is optional and runs on a
          local model by default, keyword search needs no model at all, and sync to a libSQL
          database you control exchanges operations, never database pages.
        </p>
      </CompareSection>

      <CompareSection id="choosing" number="05" title="Choosing between them">
        <ul className="sequence">
          <li><span>Choose Mem0 Platform</span> when a product needs per-end-user memory and you want the vector store, models, webhooks, and retention tooling managed for you.</li>
          <li><span>Choose Mem0 open source</span> for the same memory model on your own infrastructure, with the providers you pick.</li>
          <li><span>Choose Oh</span> when the memory belongs to your agent’s own work: facts that keep their sources, a history that replays, and no service to sign up for.</li>
        </ul>
      </CompareSection>

      <CompareSection id="limits" number="06" title="Limits of this comparison">
        <ul className="sequence">
          <li><span>Dated claims</span> Mem0’s feature split, provider counts, and published scores come from its own documentation and research page, checked {checkedOn}, and can change.</li>
          <li><span>One bounded study</span> The matched run covers 30 previously exposed questions under a harness that lowers every score, run by agents and not audited by any person or outside group.</li>
          <li><span>Different protocols</span> Mem0’s published figures and Oh’s benchmark figures use different readers, judges, and ingestion paths; this page reports them as published claims, not matched results.</li>
          <li><span>Oh’s gaps</span> Oh has no dashboard, no hosted service, and no per-end-user scoping API; it also runs no extraction step, so the records an agent writes are exactly what it stores.</li>
        </ul>
      </CompareSection>

      <CompareSection id="sources" number="07" title="Sources">
        <CompareSources items={sources} />
      </CompareSection>
    </ComparePage>
  );
}
