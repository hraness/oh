import longMemEval from "../../benchmarks/results/memory-longmemeval-s-500-v1.json";
import pilotResult from "../../benchmarks/results/memory-framework-pilot-v1.json";
import sdkResult from "../../benchmarks/results/memory-sdk-retrieval-qualification-v1.json";
import rerankResult from "../../benchmarks/results/memory-clonemem-rerank-confirm-v1.json";
import locomoAnswers from "../../benchmarks/results/memory-locomo-window-qa-v1.json";
import locomoRecall from "../../benchmarks/results/memory-locomo-window-confirmation-v1.json";
import { BenchmarkChart } from "./benchmark-chart";
import { articlePath, indexableArticles } from "./blog/articles";

const evidence = "https://github.com/hraness/oh/blob/main/benchmarks";
const percent = (value: number) => `${value.toFixed(2)}%`;
const share = (value: number) => percent(value * 100);
const points = (value: number) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}`;
const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(1);

function longMemEvalSystem(id: string) {
  const system = longMemEval.systems.find((entry) => entry.id === id);
  if (!system) throw new Error(`LongMemEval-S system missing: ${id}`);
  return system.percent;
}

/** The margin on the measure the freeze records named as primary: questions correct in two or three runs. */
function longMemEvalFrozenMargin(left: string, right: string) {
  const comparison = longMemEval.comparisons.find((entry) => entry.left === left && entry.right === right);
  if (!comparison) throw new Error(`LongMemEval-S comparison missing: ${left} over ${right}`);
  const { differencePoints, interval95: [lower, upper] } = comparison.correctInTwoOrThreeRuns;
  return { difference: differencePoints.toFixed(1), lower: lower.toFixed(1), upper: upper.toFixed(1) };
}

export const longMemEvalHeading =
  `Oh’s semantic search scored ${percent(longMemEvalSystem("oh-semantic-96k"))} on LongMemEval-S.`;

function pilotArm(arm: string) {
  const row = pilotResult.quality.arms.find((entry) => entry.arm === arm);
  if (!row) throw new Error(`framework pilot arm missing: ${arm}`);
  return row.conservativeSuccessRate.value * 100;
}

export function MemoryBenchmarkComparison() {
  const pipeline = longMemEvalSystem("oh-reading-pipeline");
  const semantic = longMemEvalSystem("oh-semantic-96k");
  const bm25 = longMemEvalSystem("bm25-96k");
  const margin = longMemEvalFrozenMargin("oh-semantic-96k", "bm25-96k");
  const pilot = pilotResult.quality.comparisons.primary;
  const sdk = sdkResult.primary.reader.pairedQuestions;
  const clonemem = rerankResult.pooledReader;
  const locomo = locomoAnswers.scores.reader.comparison;
  const anchors = locomoRecall.summaries["anchors-query-4"];
  const windows = locomoRecall.summaries["vector-window"];
  const post = indexableArticles.find((article) => article.slug === "longmemeval-s-user-log");
  return (
    <div className="memory-benchmark">
      <h3>LongMemEval-S, all 500 questions</h3>
      <p className="benchmark-note">Share of answers judged correct, averaged over three runs. Higher is better.</p>
      <BenchmarkChart label="LongMemEval-S, all 500 questions, share of answers judged correct, zero to one hundred percent" rows={[
        { id: "longmemeval-pipeline", label: "Lab pipeline on Oh and BM25 retrieval", value: pipeline,
          detail: "Every user message plus top-ranked replies within 180,000 bytes, with re-reads chosen by rules" },
        { id: "longmemeval-semantic", label: "Oh semantic retrieval", value: semantic,
          detail: "Up to 100 turns within 96,000 bytes" },
        { id: "longmemeval-bm25", label: "BM25 keyword retrieval", value: bm25,
          detail: "Up to 100 turns within 96,000 bytes" },
      ]} />
      <p>
        Oh semantic retrieval scored {percent(semantic)} and BM25 {percent(bm25)}, and a lab
        pipeline that adds every message the user wrote to the retrieved replies
        scored {percent(pipeline)}. GPT-5 mini answered every question three
        times with each system, and GPT-4o graded the answers with LongMemEval’s own prompts.
        On the measure fixed before the run, questions answered correctly in at least two of
        three runs, Oh’s lead over BM25 is {margin.difference} points with a 95% interval
        from {margin.lower} to {margin.upper}, which does not rule out a tie.
        The pipeline’s instructions and rules, which are not part of the Oh package, were
        written after studying all 500 questions, so its score is in-sample.
      </p>
      <p className="benchmark-note">
        Other memory systems publish LongMemEval-S scores up to 97%. Each chose its own
        answering model, judge, prompts, and configuration, so those scores do not compare
        directly with these.
      </p>
      <ul className="benchmark-links" aria-label="LongMemEval-S results">
        <li><a href={`${evidence}/LONGMEMEVAL_S_500_RESULT_V1.md`}>Full result and limits</a></li>
        <li><a href={`${evidence}/results/memory-longmemeval-s-500-v1.json`}>Numbers as JSON</a></li>
        {post ? <li><a href={articlePath(post)}>How the pipeline works</a></li> : null}
      </ul>

      <h3>Oh and Supermemory on 60 LongMemEval-S questions</h3>
      <p className="benchmark-note">Share of the 60 questions answered correctly, one run. Higher is better.</p>
      <BenchmarkChart label="Oh, Supermemory, and BM25 on 60 LongMemEval-S questions, share answered correctly, zero to one hundred percent" rows={[
        { id: "pilot-supermemory", label: "Supermemory", value: pilotArm("supermemory"),
          detail: "One document per session, hybrid search with reranking" },
        { id: "pilot-oh", label: "Oh default SDK search", value: pilotArm("oh"),
          detail: "Single turns, reranked locally" },
        { id: "pilot-bm25", label: "BM25 keyword retrieval", value: pilotArm("bm25"),
          detail: "Single turns" },
      ]} />
      <p>
        On 60 LongMemEval-S questions, Supermemory answered {percent(pilotArm("supermemory"))} correctly,
        Oh’s default SDK search {percent(pilotArm("oh"))}, and BM25 {percent(pilotArm("bm25"))}.
        GPT-4o answered from at most 20 results per system and graded the answers, and
        Supermemory stored one document per session, as its published method does, while
        Oh and BM25 stored single turns. Sixty questions, all used earlier in Oh’s development,
        cannot separate Oh from Supermemory: the difference is {points(pilot.estimate)} points,
        with a 95% interval from {points(pilot.interval95.lower)} to {points(pilot.interval95.upper)}.
        Three questions each for Oh and BM25 scored zero because their search failed or never ran.
      </p>
      <ul className="benchmark-links" aria-label="Supermemory comparison">
        <li><a href={`${evidence}/FRAMEWORK_PILOT_RESULT_V1.md`}>Full result and limits</a></li>
        <li><a href={`${evidence}/results/memory-framework-pilot-v1.json`}>Numbers as JSON</a></li>
      </ul>

      <details className="benchmark-literature">
        <summary>Results on CloneMem and LoCoMo</summary>
        <p>
          On 146 CloneMem questions, Oh’s default SDK search answered {share(sdk.candidate)} correctly
          against {share(sdk.baseline)} for Oh semantic retrieval alone, with a median of
          {" "}{seconds(sdkResult.primary.native.warmRerankerMs.p50)} seconds of reranking per search on an Apple M5 Max. GPT-4o mini picked an answer from each question’s
          options three times, reading the top 10 results within 96 KiB, and a pick counted only if
          it matched the correct option. The questions come from two personas the project had
          already studied, so the gain may not carry over to new conversations.
        </p>
        <ul className="benchmark-links" aria-label="CloneMem, 146 questions">
          <li><a href={`${evidence}/SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md`}>Full result and limits</a></li>
          <li><a href={`${evidence}/results/memory-sdk-retrieval-qualification-v1.json`}>Numbers as JSON</a></li>
        </ul>
        <p>
          On 861 CloneMem questions from seven personas, an earlier benchmark run of the same
          reranker answered {share(clonemem.candidate)} correctly against {share(clonemem.baseline)} for
          vector retrieval, a gain of {(clonemem.delta * 100).toFixed(2)} points with a 95% interval
          from {(rerankResult.bootstrap.lowerBound95 * 100).toFixed(2)} to {(rerankResult.bootstrap.upperBound95 * 100).toFixed(2)}.
          That run gave the reranker only each candidate’s text, where Oh’s SDK sends the whole
          record with its key and kind. It used the same answering model, scoring, and 96 KiB
          reading limit as the 146-question study. The personas were kept out of tuning but had been
          seen earlier in the project, and two failed attempts were dropped under a retry rule
          added during the study.
        </p>
        <ul className="benchmark-links" aria-label="CloneMem, 861 questions">
          <li><a href={`${evidence}/CLONEMEM_RERANK_CONFIRM_RESULT_V1.md`}>Full result and limits</a></li>
          <li><a href={`${evidence}/results/memory-clonemem-rerank-confirm-v1.json`}>Numbers as JSON</a></li>
        </ul>
        <p>
          On LoCoMo, filling each question’s context with the nearby turns that best match it
          found {share(anchors.turnRecall)} of the marked evidence against {share(windows.turnRecall)} for
          fixed windows across {anchors.annotatedQuestions.toLocaleString("en-US")} questions, yet
          answers scored {share(locomo.candidate)} against {share(locomo.baseline)} on a 300-question
          sample. Both methods built each context from the same top 20 vector matches within
          12,000 bytes, and GPT-4o mini answered each question three times with each method and
          graded the answers. The answer difference, {points(locomo.paired.delta * 100)} points with
          a 95% interval from {points(locomo.paired.lower * 100)} to {points(locomo.paired.upper * 100)},
          does not show either method answering better, and the project had evaluated these
          conversations before.
        </p>
        <ul className="benchmark-links" aria-label="LoCoMo">
          <li><a href={`${evidence}/LOCOMO_WINDOW_QA_V1.md`}>Full result and limits</a></li>
          <li><a href={`${evidence}/results/memory-locomo-window-qa-v1.json`}>Answers as JSON</a></li>
          <li><a href={`${evidence}/results/memory-locomo-window-confirmation-v1.json`}>Evidence recall as JSON</a></li>
        </ul>
      </details>
      <p className="benchmark-note">AI agents ran these studies, and no person or outside group has audited them.</p>
    </div>
  );
}
