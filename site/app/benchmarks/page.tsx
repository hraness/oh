import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { DesignPaletteMenuButton } from "@hraness/design-kit/react";
import { AskAiAboutThis } from "@hraness/ui";
import { collectionPageJsonLd } from "@hraness/web-discovery";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";

import clonememRerank from "../../../benchmarks/results/memory-clonemem-rerank-confirm-v1.json";
import frameworkPilot from "../../../benchmarks/results/memory-framework-pilot-v1.json";
import locomoSealed from "../../../benchmarks/results/memory-evolution-locomo-sealed-1540-v1.json";
import locomoWindowAnswers from "../../../benchmarks/results/memory-locomo-window-qa-v1.json";
import locomoWindowRecall from "../../../benchmarks/results/memory-locomo-window-confirmation-v1.json";
import longMemEval from "../../../benchmarks/results/memory-longmemeval-s-500-v1.json";
import memEval from "../../../benchmarks/results/memory-evolution-memeval-102-v1.json";
import releaseFullContext from "../../../benchmarks/results/memory-evolution-full-context-500-v1.json";
import releaseMini from "../../../benchmarks/results/memory-evolution-full-release-500-mini-v1.json";
import releaseNano from "../../../benchmarks/results/memory-evolution-full-release-500-v1.json";
import sdkQualification from "../../../benchmarks/results/memory-sdk-retrieval-qualification-v1.json";
import { ohSearchSite } from "../blog/articles";
import { benchmarksDescription, benchmarksImageAlt, benchmarksTitle } from "../metadata-copy";

export const metadata: Metadata = {
  title: benchmarksTitle,
  description: benchmarksDescription,
  alternates: { canonical: "/benchmarks" },
  openGraph: {
    title: benchmarksTitle,
    description: benchmarksDescription,
    images: [{
      alt: benchmarksImageAlt,
      height: 630,
      url: "/benchmarks/opengraph-image",
      width: 1200,
    }],
    siteName: "Oh",
    url: "/benchmarks",
  },
  twitter: {
    card: "summary_large_image",
    title: benchmarksTitle,
    description: benchmarksDescription,
    images: [{ alt: benchmarksImageAlt, url: "/benchmarks/opengraph-image" }],
  },
};

const evidence = "https://github.com/hraness/oh/blob/main/benchmarks";

const percent = (value: number) => `${value.toFixed(2)}%`;
const share = (value: number) => percent(value * 100);
const tenth = (value: number) => `${(value * 100).toFixed(1)}%`;
const points = (value: number) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}`;

function longMemEvalSystem(id: string) {
  const system = longMemEval.systems.find((entry) => entry.id === id);
  if (!system) throw new Error(`LongMemEval-S system missing: ${id}`);
  return system.percent;
}

type EvolutionArm = Readonly<{
  variantId: string;
  reader: string;
  metrics: readonly Readonly<{
    metric: string;
    overall: Readonly<{ cases: number; mean: number }>;
  }>[];
}>;

function evolutionArm(record: { arms: readonly EvolutionArm[] }, variantId: string, reader: string) {
  const arm = record.arms.find((entry) => entry.variantId === variantId && entry.reader === reader);
  const metric = arm?.metrics.find((entry) => entry.metric.startsWith("judge"));
  if (!arm || !metric) throw new Error(`Evolution arm missing: ${variantId} with ${reader}`);
  return metric.overall.mean;
}

function pilotArm(arm: string) {
  const row = frameworkPilot.quality.arms.find((entry) => entry.arm === arm);
  if (!row) throw new Error(`Framework pilot arm missing: ${arm}`);
  return row.conservativeSuccessRate.value;
}

function memEvalAccuracy(reader: string) {
  const row = memEval.systems.find((entry) => entry.system === "oh" && entry.reader === reader);
  if (!row || !("accuracy" in row) || typeof row.accuracy !== "number") {
    throw new Error(`MemEval row missing: ${reader}`);
  }
  return row.accuracy;
}

const memEvalMem0 = (() => {
  const row = memEval.systems.find((entry) => entry.system === "mem0");
  if (!row || !("matchedOhOnSameQuestions" in row)) {
    throw new Error("MemEval Mem0 row missing.");
  }
  const matched = row.matchedOhOnSameQuestions?.["openai/gpt-4.1-mini"];
  if (!matched) throw new Error("MemEval matched-30 row missing.");
  return { mem0: row.accuracy, ohMatched: matched.correct / matched.of };
})();

const frozenMargin = (() => {
  const comparison = longMemEval.comparisons.find(
    (entry) => entry.left === "oh-semantic-96k" && entry.right === "bm25-96k",
  );
  if (!comparison) throw new Error("LongMemEval-S comparison missing: oh-semantic-96k over bm25-96k");
  return comparison.correctInTwoOrThreeRuns;
})();

const pilotPrimary = frameworkPilot.quality.comparisons.primary;
const pilotSecondary = frameworkPilot.quality.comparisons.secondary;
const sdk = sdkQualification.primary.reader;
const sdkInterval = sdk.descriptiveUncertainty;
const rerank = clonememRerank.pooledReader;
const rerankInterval = clonememRerank.bootstrap;
const locomoWindow = locomoWindowAnswers.scores.reader.comparison;
const locomoRecallAnchors = locomoWindowRecall.summaries["anchors-query-4"];
const locomoRecallWindows = locomoWindowRecall.summaries["vector-window"];

const sections = [
  ["longmemeval-s-500", "LongMemEval-S, three runs"],
  ["framework-pilot", "Supermemory pilot"],
  ["clonemem-sdk", "CloneMem SDK search"],
  ["clonemem-rerank", "CloneMem reranker"],
  ["locomo-window", "LoCoMo packing"],
  ["locomo-sealed", "LoCoMo, 1,540 questions"],
  ["longmemeval-single", "LongMemEval-S, single runs"],
  ["memeval", "The MemEval harness"],
  ["history", "Every study"],
] as const;

export default function Benchmarks() {
  return (
    <>
      <a className="skip-link" href="#benchmarks-main">Skip to benchmark results</a>
      <MarketingSiteHeader
        trailing={<DesignPaletteMenuButton />}
        action={{ href: "/#install", label: "Install Oh" }}
        ariaLabel="Benchmark navigation"
        brand="Oh"
        brandMark="/marks/oh-computer.svg"
        brandLabel="Oh home"
        className="spec-header"
        links={[
          { href: "/", label: "Overview" },
          { href: "/blog", label: "Blog" },
          { current: true, href: "/benchmarks", label: "Benchmarks" },
          { href: "/compare", label: "Compare" },
          { href: "/spec", label: "Specification" },
          { href: "https://github.com/hraness/oh", label: "GitHub" },
        ]}
      />

      <main className="spec-shell" id="benchmarks-main" tabIndex={-1}>
        <JsonLdScript
          data={collectionPageJsonLd(ohSearchSite, {
            breadcrumb: [
              { name: "Oh", path: "/" },
              { name: "Benchmarks", path: "/benchmarks" },
            ],
            dateModified: "2026-09-26",
            description: benchmarksDescription,
            name: benchmarksTitle,
            path: "/benchmarks",
            items: [
              { name: "LongMemEval-S, all 500 questions", url: `${evidence}/LONGMEMEVAL_S_500_RESULT_V1.md` },
              { name: "Matched framework pilot", url: `${evidence}/FRAMEWORK_PILOT_RESULT_V1.md` },
              { name: "SDK retrieval qualification", url: `${evidence}/SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md` },
              { name: "Local reranker confirmation", url: `${evidence}/CLONEMEM_RERANK_CONFIRM_RESULT_V1.md` },
              { name: "LoCoMo window packing", url: `${evidence}/LOCOMO_WINDOW_QA_V1.md` },
              { name: "Full-release comparison results", url: `${evidence}/EVOLUTION_RELEASE_RESULTS.md` },
            ]},
          )}
          id="benchmarks-json-ld"
        />

        <aside className="spec-nav" aria-label="On this page">
          <p>Benchmark results</p>
          {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </aside>

        <article className="spec-document">
          <header className="spec-intro">
            <div>
              <p className="eyebrow">Benchmark index</p>
              <h1>Benchmark results</h1>
            </div>
            <p>
              Oh’s memory is tested on LongMemEval-S, LoCoMo, and CloneMem, and
              the repository publishes each study’s protocol, cost, and
              limits. This page lists every completed
              comparison with its headline scores and date. Scores are the share of questions an answering model
              answered correctly from the memory each system prepared. AI
              agents ran these studies, and no person or outside group has
              audited them.
            </p>
          </header>

          <section id="longmemeval-s-500" className="spec-section">
            <div className="spec-number">01</div>
            <div>
              <h2>LongMemEval-S: all 500 questions, three runs</h2>
              <p className="benchmark-meta">LongMemEval-S, cleaned revision 98d7416 · 500 questions · Completed 2026-09-26</p>
              <table className="benchmark-table">
                <caption>Share of answers judged correct, mean of three runs.</caption>
                <thead>
                  <tr><th scope="col">System</th><th scope="col">Score</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Oh reading pipeline</th><td>{percent(longMemEvalSystem("oh-reading-pipeline"))}</td></tr>
                  <tr><th scope="row">First pass only</th><td>{percent(longMemEvalSystem("first-pass-only"))}</td></tr>
                  <tr><th scope="row">Oh semantic retrieval</th><td>{percent(longMemEvalSystem("oh-semantic-96k"))}</td></tr>
                  <tr><th scope="row">BM25 retrieval</th><td>{percent(longMemEvalSystem("bm25-96k"))}</td></tr>
                </tbody>
              </table>
              <p>
                GPT-5 mini answered each question three times from each system’s
                memory, and GPT-4o graded the answers with LongMemEval’s own
                prompts. The pipeline reads every message the user wrote plus
                the assistant replies retrieval ranks highest, within 180,000
                bytes; the two retrieval arms keep their top 100 turns within
                96,000 bytes. The pipeline’s log builder, date rules, and
                re-read rules are not part of the Oh package, and they were
                written after studying all 500 questions, so its score is
                in-sample. On the measure fixed before the run, questions
                answered correctly in at least two of three runs, Oh semantic
                retrieval leads BM25 by {frozenMargin.differencePoints.toFixed(1)} points
                with a 95% interval from {frozenMargin.interval95[0].toFixed(1)} to
                {" "}{frozenMargin.interval95[1].toFixed(1)}, which does not rule
                out a tie.
              </p>
              <ul className="benchmark-links" aria-label="LongMemEval-S 500-question result">
                <li><a href={`${evidence}/LONGMEMEVAL_S_500_RESULT_V1.md`}>Full result and limits</a></li>
                <li><a href={`${evidence}/results/memory-longmemeval-s-500-v1.json`}>Numbers as JSON</a></li>
                <li><a href="/blog/longmemeval-s-user-log">How the pipeline works</a></li>
              </ul>
            </div>
          </section>

          <section id="framework-pilot" className="spec-section">
            <div className="spec-number">02</div>
            <div>
              <h2>Oh, Supermemory, and BM25 on 60 LongMemEval-S questions</h2>
              <p className="benchmark-meta">LongMemEval-S · 60 previously exposed questions, one run · Completed 2026-09-24</p>
              <table className="benchmark-table">
                <caption>Share of the 60 questions answered correctly.</caption>
                <thead>
                  <tr><th scope="col">System</th><th scope="col">Score</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Supermemory</th><td>{share(pilotArm("supermemory"))}</td></tr>
                  <tr><th scope="row">Oh default SDK search</th><td>{share(pilotArm("oh"))}</td></tr>
                  <tr><th scope="row">BM25 keyword retrieval</th><td>{share(pilotArm("bm25"))}</td></tr>
                </tbody>
              </table>
              <p>
                All three systems received the same histories, the same single
                query per question, at most 20 returned results, and the same
                GPT-4o reader and judge. Supermemory stored one document per
                session, as its published method does; Oh and BM25 stored
                single turns. The result separates no pair: Oh minus
                Supermemory is {points(pilotPrimary.estimate)} points with a 95%
                interval of {points(pilotPrimary.interval95.lower)} to
                {" "}{points(pilotPrimary.interval95.upper)}, and Oh minus BM25
                is {points(pilotSecondary.estimate)} points
                ({points(pilotSecondary.interval95.lower)} to
                {" "}{points(pilotSecondary.interval95.upper)}).
              </p>
              <ul className="benchmark-links" aria-label="Framework pilot result">
                <li><a href={`${evidence}/FRAMEWORK_PILOT_RESULT_V1.md`}>Full result and limits</a></li>
                <li><a href={`${evidence}/results/memory-framework-pilot-v1.json`}>Numbers as JSON</a></li>
              </ul>
            </div>
          </section>

          <section id="clonemem-sdk" className="spec-section">
            <div className="spec-number">03</div>
            <div>
              <h2>CloneMem: the default SDK search</h2>
              <p className="benchmark-meta">CloneMem, revision 753d8a9 · 146 questions, three reader attempts each · Completed 2026-09-23</p>
              <table className="benchmark-table">
                <caption>Share of answers matching the correct option.</caption>
                <thead>
                  <tr><th scope="col">System</th><th scope="col">Score</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Oh default SDK search, local reranker</th><td>{share(sdk.pairedQuestions.candidate)}</td></tr>
                  <tr><th scope="row">Oh semantic retrieval</th><td>{share(sdk.pairedQuestions.baseline)}</td></tr>
                </tbody>
              </table>
              <p>
                GPT-4o mini picked an answer from each question’s options three
                times, reading the top 10 results within 96 KiB; a pick counted
                when it matched the correct option. The tested system is the
                {" "}<code>Oh.search</code> route the package ships, with the local
                reranker, and the control is the same store’s semantic search. The gain
                is {points(sdk.pairedQuestions.delta * 100)} points with a 95%
                bootstrap interval of {points(sdkInterval.lower95 * 100)} to
                {" "}{points(sdkInterval.upper95 * 100)}. Both personas improved,
                but the questions come from two personas already used in
                development, and no other memory framework ran.
              </p>
              <ul className="benchmark-links" aria-label="CloneMem SDK qualification result">
                <li><a href={`${evidence}/SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md`}>Full result and limits</a></li>
                <li><a href={`${evidence}/results/memory-sdk-retrieval-qualification-v1.json`}>Numbers as JSON</a></li>
              </ul>
            </div>
          </section>

          <section id="clonemem-rerank" className="spec-section">
            <div className="spec-number">04</div>
            <div>
              <h2>CloneMem: the local reranker on reserved personas</h2>
              <p className="benchmark-meta">CloneMem, revision 753d8a9 · 861 questions, three reader attempts each · Completed 2026-09-23</p>
              <table className="benchmark-table">
                <caption>Share of answers matching the correct option.</caption>
                <thead>
                  <tr><th scope="col">System</th><th scope="col">Score</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Local reranker over the lexical-semantic union</th><td>{share(rerank.candidate)}</td></tr>
                  <tr><th scope="row">Vector retrieval</th><td>{share(rerank.baseline)}</td></tr>
                </tbody>
              </table>
              <p>
                A pinned local Qwen3 reranker reordered the union of lexical and
                semantic candidates, returning the top 10 under the same
                answering model, scoring, and reading limit as the SDK study.
                The gain is {points(rerank.delta * 100)} points with a 95%
                persona-cluster interval of {points(rerankInterval.lowerBound95 * 100)} to
                {" "}{points(rerankInterval.upperBound95 * 100)}. The seven
                personas were held back from development but had earlier project
                exposure, and a retry rule was added after two failed campaign
                attempts. The reranker ships in Oh as the opt-in
                {" "}<code>mode: &quot;rerank&quot;</code>.
              </p>
              <ul className="benchmark-links" aria-label="CloneMem reranker confirmation result">
                <li><a href={`${evidence}/CLONEMEM_RERANK_CONFIRM_RESULT_V1.md`}>Full result and limits</a></li>
                <li><a href={`${evidence}/results/memory-clonemem-rerank-confirm-v1.json`}>Numbers as JSON</a></li>
              </ul>
            </div>
          </section>

          <section id="locomo-window" className="spec-section">
            <div className="spec-number">05</div>
            <div>
              <h2>LoCoMo: packing context with matched turns did not improve accuracy</h2>
              <p className="benchmark-meta">LoCoMo · 300 questions, three reader attempts each · 2026-09-22 · Failed its rule</p>
              <table className="benchmark-table">
                <caption>Share of answers judged correct.</caption>
                <thead>
                  <tr><th scope="col">System</th><th scope="col">Score</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Fixed windows</th><td>{share(locomoWindow.baseline)}</td></tr>
                  <tr><th scope="row">Query-aware packing</th><td>{share(locomoWindow.candidate)}</td></tr>
                </tbody>
              </table>
              <p>
                Filling each question’s context with the nearby turns that best
                match it raised evidence-turn recall from {share(locomoRecallWindows.turnRecall)} to
                {" "}{share(locomoRecallAnchors.turnRecall)} across
                {" "}{locomoRecallAnchors.questions.toLocaleString("en-US")} questions,
                but judged accuracy fell on the 300-question sample: the
                difference is {points(locomoWindow.paired.delta * 100)} points
                with a 95% interval of {points(locomoWindow.paired.lower * 100)} to
                {" "}{points(locomoWindow.paired.upper * 100)}. GPT-4o mini
                answered three times per method from the same top 20 vector
                matches within 12,000 bytes. The variant stayed an experimental
                adapter and did not change Oh’s default search.
              </p>
              <ul className="benchmark-links" aria-label="LoCoMo window packing result">
                <li><a href={`${evidence}/LOCOMO_WINDOW_QA_V1.md`}>Full result and limits</a></li>
                <li><a href={`${evidence}/results/memory-locomo-window-qa-v1.json`}>Answers as JSON</a></li>
                <li><a href={`${evidence}/results/memory-locomo-window-confirmation-v1.json`}>Evidence recall as JSON</a></li>
              </ul>
            </div>
          </section>

          <section id="locomo-sealed" className="spec-section">
            <div className="spec-number">06</div>
            <div>
              <h2>LoCoMo: all 1,540 scored questions</h2>
              <p className="benchmark-meta">LoCoMo, revision 3eb6f2c · 1,540 questions from all ten conversations · Recorded 2026-09-10</p>
              <table className="benchmark-table">
                <caption>Share of answers judged correct, one run each.</caption>
                <thead>
                  <tr><th scope="col">System, 24 KB</th><th scope="col">GPT-5 mini</th><th scope="col">GPT-5 nano</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Oh semantic</th>
                    <td>{tenth(evolutionArm(locomoSealed, "semantic-24k", "gpt5-mini-calibration-only-v1-reader"))}</td>
                    <td>{tenth(evolutionArm(locomoSealed, "semantic-24k", "gpt5-nano-calibration-only-v1-reader"))}</td>
                  </tr>
                  <tr>
                    <th scope="row">BM25 window</th>
                    <td>{tenth(evolutionArm(locomoSealed, "window-24k", "gpt5-mini-calibration-only-v1-reader"))}</td>
                    <td>{tenth(evolutionArm(locomoSealed, "window-24k", "gpt5-nano-calibration-only-v1-reader"))}</td>
                  </tr>
                </tbody>
              </table>
              <p>
                The study, its question list, and its scope were sealed by
                digest before the first reader call. It covers the four scored
                categories and excludes the 446 adversarial questions; a
                gpt-4o-mini judge graded each answer once, and all 11,065 calls
                completed for $11.82. Paired on the same questions, Oh semantic
                beat BM25 window 126 to 83 with mini and 169 to 124 with nano.
                Every conversation had been exposed to earlier studies, and the
                record gives no confidence interval.
              </p>
              <ul className="benchmark-links" aria-label="LoCoMo sealed comparison">
                <li><a href={`${evidence}/EVOLUTION_RELEASE_RESULTS.md#matched-descriptive-comparison-on-locomo`}>Full result and limits</a></li>
                <li><a href={`${evidence}/results/memory-evolution-locomo-sealed-1540-v1.json`}>Numbers as JSON</a></li>
              </ul>
            </div>
          </section>

          <section id="longmemeval-single" className="spec-section">
            <div className="spec-number">07</div>
            <div>
              <h2>LongMemEval-S: single-run comparisons</h2>
              <p className="benchmark-meta">LongMemEval-S, legacy identifiers · 500 questions, one run each · Recorded 2026-09-10</p>
              <table className="benchmark-table">
                <caption>Share of answers judged correct.</caption>
                <thead>
                  <tr><th scope="col">System, 96 KB</th><th scope="col">GPT-5 nano</th><th scope="col">GPT-5 mini</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Oh semantic</th>
                    <td>{tenth(evolutionArm(releaseNano, "semantic-96k", "gpt5-nano-explicit-abstention-composition-v1-reader"))}</td>
                    <td>{tenth(evolutionArm(releaseMini, "semantic-96k", "gpt5-mini-explicit-abstention-composition-v1-reader"))}</td>
                  </tr>
                  <tr>
                    <th scope="row">BM25 window</th>
                    <td>{tenth(evolutionArm(releaseNano, "window-96k", "gpt5-nano-explicit-abstention-composition-v1-reader"))}</td>
                    <td>{tenth(evolutionArm(releaseMini, "window-96k", "gpt5-mini-explicit-abstention-composition-v1-reader"))}</td>
                  </tr>
                  <tr>
                    <th scope="row">Full history</th>
                    <td>{tenth(evolutionArm(releaseFullContext, "full-history", "gpt5-nano-explicit-abstention-composition-v1-reader"))}</td>
                    <td>not run</td>
                  </tr>
                </tbody>
              </table>
              <p>
                Each reader answered all 500 questions once over the same frozen
                contexts: the top 100 turns within 96,000 bytes. With GPT-5
                nano, full history trailed both retrieval arms and cost about
                five times as much per answer. These runs kept the dataset’s
                original session identifiers, and an
                {" "}<a href={`${evidence}/LONGMEMEVAL_IDENTIFIER_AUDIT_V1.md`}>audit
                later found</a> they can carry answer-label wording, with an
                unmeasured effect on scores. Later studies replace the
                identifiers; these numbers stand as historical measurements.
              </p>
              <ul className="benchmark-links" aria-label="LongMemEval-S single-run results">
                <li><a href={`${evidence}/EVOLUTION_RELEASE_RESULTS.md`}>Full result and limits</a></li>
                <li><a href={`${evidence}/results/memory-evolution-full-release-500-v1.json`}>Nano numbers as JSON</a></li>
                <li><a href={`${evidence}/results/memory-evolution-full-release-500-mini-v1.json`}>Mini numbers as JSON</a></li>
              </ul>
            </div>
          </section>

          <section id="memeval" className="spec-section">
            <div className="spec-number">08</div>
            <div>
              <h2>LongMemEval-S under the MemEval harness</h2>
              <p className="benchmark-meta">ProsusAI MemEval · 102-question LongMemEval-S sample · 2026-09-10</p>
              <table className="benchmark-table">
                <caption>Judge accuracy under the harness’s own protocol.</caption>
                <thead>
                  <tr><th scope="col">System</th><th scope="col">Reader</th><th scope="col">Score</th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Oh semantic, 96 KB</th><td>gpt-4.1</td><td>{tenth(memEvalAccuracy("openai/gpt-4.1"))}</td></tr>
                  <tr><th scope="row">Oh semantic, 96 KB</th><td>gpt-4.1-mini</td><td>{tenth(memEvalAccuracy("openai/gpt-4.1-mini"))}</td></tr>
                </tbody>
              </table>
              <p>
                MemEval is a third-party harness whose protocol lowers every
                system’s score here: it drops the question date, uses a short
                generic answer prompt, and caps answers at 50 tokens. On the
                first 30 questions of the same sample, its Mem0 open-source
                adapter scored {tenth(memEvalMem0.mem0)} against Oh’s
                {" "}{tenth(memEvalMem0.ohMatched)} with the same reader; 30
                questions support no precise margin. The run needed three
                local harness patches, which the record lists.
              </p>
              <ul className="benchmark-links" aria-label="MemEval harness result">
                <li><a href={`${evidence}/EVOLUTION_RELEASE_RESULTS.md#under-a-third-party-harness`}>Full result and limits</a></li>
                <li><a href={`${evidence}/results/memory-evolution-memeval-102-v1.json`}>Numbers as JSON</a></li>
              </ul>
            </div>
          </section>

          <section id="history" className="spec-section">
            <div className="spec-number">09</div>
            <div>
              <h2>The repository lists every study, including the failed ones</h2>
              <p>
                The repository’s benchmark README lists every study, including
                the ones that failed their pre-set rules and the ones a later
                document replaced, and gives the dataset pins and commands
                needed to reproduce the measurements. No study measures an
                agent writing or updating its own memory during work, or
                resuming a task from memory.
              </p>
              <div className="spec-actions">
                <a className="hraness-marketing-action" data-emphasis="primary" href={`${evidence}/README.md#evaluation-history`}>Evaluation history</a>
                <a className="hraness-marketing-action" data-emphasis="secondary" href={`${evidence}/README.md#comparisons-that-did-not-pass`}>Studies that did not pass</a>
              </div>
            </div>
          </section>
        </article>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://oh.computer/benchmarks" />
    </>
  );
}
