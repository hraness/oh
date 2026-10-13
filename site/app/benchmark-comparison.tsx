import longMemEval from "../../benchmarks/results/memory-longmemeval-s-500-v1.json";
import { articlePath, indexableArticles } from "./blog/articles";

const evidence = "https://github.com/hraness/oh/blob/main/benchmarks";
const percent = (value: number) => `${value.toFixed(2)}%`;

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

/** The LongMemEval-S numbers as a metric strip, with the three sentences STYLE.md asks for. */
export function MemoryBenchmarkComparison() {
  const pipeline = longMemEvalSystem("oh-reading-pipeline");
  const semantic = longMemEvalSystem("oh-semantic-96k");
  const bm25 = longMemEvalSystem("bm25-96k");
  const margin = longMemEvalFrozenMargin("oh-semantic-96k", "bm25-96k");
  const post = indexableArticles.find((article) => article.slug === "longmemeval-s-user-log");
  const metrics = [
    { id: "longmemeval-semantic", label: "Oh semantic retrieval", value: semantic },
    { id: "longmemeval-bm25", label: "BM25 keyword retrieval", value: bm25 },
    { id: "longmemeval-pipeline", label: "Lab pipeline on Oh and BM25", value: pipeline },
  ] as const;
  return (
    <div className="memory-benchmark">
      <dl className="oh-metrics" aria-label="LongMemEval-S, all 500 questions, share of answers judged correct">
        {metrics.map((metric) => (
          <div className="oh-metric" id={metric.id} key={metric.id}>
            <dt className="oh-metric__label">{metric.label}</dt>
            <dd className="oh-metric__value">{percent(metric.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="benchmark-meta">LongMemEval-S, cleaned revision 98d7416 · 500 questions · three runs · Completed 2026-09-26</p>
      <p className="benchmark-note">
        GPT-5 mini answered every question three times and GPT-4o graded. Oh’s lead over BM25 is {margin.difference} points
        with a 95% interval from {margin.lower} to {margin.upper}; the pipeline is not part of the Oh package and is in-sample.
      </p>
      <ul className="benchmark-links" aria-label="LongMemEval-S results">
        <li><a href={`${evidence}/LONGMEMEVAL_S_500_RESULT_V1.md`}>Full result and limits</a></li>
        <li><a href={`${evidence}/results/memory-longmemeval-s-500-v1.json`}>Numbers as JSON</a></li>
        {post ? <li><a href={articlePath(post)}>How the pipeline works</a></li> : null}
      </ul>
      <p className="record-link"><a href="/benchmarks">CloneMem, LoCoMo, and every protocol</a></p>
    </div>
  );
}
