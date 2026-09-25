import result from "../../benchmarks/results/memory-clonemem-rerank-confirm-v1.json";
import sdkResult from "../../benchmarks/results/memory-sdk-retrieval-qualification-v1.json";
import pilotResult from "../../benchmarks/results/memory-framework-pilot-v1.json";
import { BenchmarkChart } from "./benchmark-chart";

const evidence = "https://github.com/hraness/oh/blob/main/benchmarks";
const percentage = (value: number) => value * 100;
const signed = (value: number) => `${value < 0 ? "\u2212" : "+"}${Math.abs(value).toFixed(1)}`;
const pilotArm = (arm: string) => {
  const row = pilotResult.quality.arms.find(entry => entry.arm === arm);
  if (!row) throw new Error(`framework pilot arm missing: ${arm}`);
  return row;
};

export function MemoryBenchmarkComparison() {
  const primary = sdkResult.primary.reader.pairedQuestions;
  const secondary = sdkResult.secondary.reader.pairedQuestions;
  const recall = sdkResult.primary.retrieval.pairedQuestions;
  const pilot = pilotResult.quality.comparisons;
  return (
    <div className="memory-benchmark">
      <h3>LongMemEval · matched framework pilot</h3>
      <p className="benchmark-note">Same 60 questions, evidence budget, reader, and judge for each system. Higher is better.</p>
      <BenchmarkChart label="LongMemEval framework pilot, conservative success rate, zero to one hundred percent" rows={[
        { id: "pilot-oh", label: "Oh default retrieval", value: percentage(pilotArm("oh").conservativeSuccessRate.value) },
        { id: "pilot-supermemory", label: "Supermemory (session documents)", value: percentage(pilotArm("supermemory").conservativeSuccessRate.value) },
        { id: "pilot-bm25", label: "BM25 baseline", value: percentage(pilotArm("bm25").conservativeSuccessRate.value) },
      ]} />
      <p className="benchmark-delta">
        <strong>{signed(pilot.primary.estimate)} percentage points versus Supermemory</strong>
        <span>95% paired bootstrap interval: {signed(pilot.primary.interval95.lower)} to {signed(pilot.primary.interval95.upper)} points, resampled within question types.</span>
      </p>
      <dl className="benchmark-method">
        <div><dt>Population</dt><dd>60 previously exposed LongMemEval-S questions · 10 per question type · one attempt per cell</dd></div>
        <div><dt>Reader and judge</dt><dd>GPT-4o via Gateway, unpinned alias · 512 answer tokens · frozen LongMemEval rubric · gold opened after the reader closed</dd></div>
        <div><dt>Retrieval</dt><dd>Top 20 for every arm · Supermemory hybrid search with reranking over session documents · Oh and BM25 over turn-level units</dd></div>
        <div><dt>Context</dt><dd>Shared typed evidence renderer · 8,192-token ceiling · no shortened source text</dd></div>
      </dl>
      <p className="benchmark-note">
        Agent-run development pilot, September 24, 2026. Conservative success counts a failed or
        unattempted stage as zero successes; every planned cell stays in the denominator.
        Supermemory received one document per session, following its published method, while
        the local arms indexed turns. The interval describes resampling within this sample,
        not an unseen population. No system is claimed state of the art.
      </p>
      <ul className="benchmark-links" aria-label="Framework pilot evidence">
        <li><a href={`${evidence}/FRAMEWORK_PILOT_RESULT_V1.md`}>Pilot results and limits</a></li>
        <li><a href={`${evidence}/results/memory-framework-pilot-v1.json`}>Machine-readable results</a></li>
        <li><a href={`${evidence}/FRAMEWORK_PILOT_EVIDENCE_V1.md`}>Protocol and question selection</a></li>
      </ul>
      <h3>CloneMem · default SDK answer accuracy</h3>
      <p className="benchmark-note">Same questions, reader, prompt, and context ceiling. Higher is better.</p>
      <BenchmarkChart label="CloneMem default SDK answer accuracy, matched comparison, zero to one hundred percent" rows={[
        { id: "sdk-rerank", label: "Oh default + local reranker", value: percentage(primary.candidate) },
        { id: "sdk-semantic", label: "Oh semantic retrieval", value: percentage(primary.baseline) },
      ]} />
      <p className="benchmark-delta">
        <strong>+{percentage(primary.delta).toFixed(2)} percentage points</strong>
        <span>Both personas improved. The configured SDK route passed the specified numerical development gate.</span>
      </p>
      <dl className="benchmark-method">
        <div><dt>Population</dt><dd>146 questions · two previously exposed personas · three repeats per arm</dd></div>
        <div><dt>Reader</dt><dd>GPT-4o mini via Gateway · exact option-ID scoring · no judge</dd></div>
        <div><dt>Retrieval</dt><dd>Actual default SDK route and record rendering · local Qwen3 reranker · top 10</dd></div>
        <div><dt>Context</dt><dd>Whole original traces · 96 KiB ceiling · no truncated source text</dd></div>
        <div><dt>Evidence recall</dt><dd>{percentage(recall.baseline).toFixed(2)}% → {percentage(recall.candidate).toFixed(2)}% recall@10</dd></div>
        <div><dt>Local timing</dt><dd>{(sdkResult.primary.native.warmRerankerMs.p95 / 1000).toFixed(2)} s warm reranker p95 · Apple M5 Max · excludes semantic inference</dd></div>
      </dl>
      <p className="benchmark-note">
        Agent-run development check, September 23, 2026. All 876 reader cases completed.
        Semantic rankings replay authenticated earlier inference; local reranker scores
        are fresh. These are two exposed personas, not a pristine holdout or a population
        confidence claim. The model alias did not identify an immutable snapshot.
        The run used a documented exception for one handled Metal startup diagnostic;
        it had no reranker execution or cleanup failures.
      </p>
      <ul className="benchmark-links" aria-label="SDK benchmark evidence">
        <li><a href={`${evidence}/SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md`}>SDK results and limitations</a></li>
        <li><a href={`${evidence}/results/memory-sdk-retrieval-qualification-v1.json`}>Machine-readable results</a></li>
        <li><a href={`${evidence}/audit/sdk-retrieval-qualification-v1/README.md`}>Audit code and reproduction limits</a></li>
      </ul>
      <details className="benchmark-literature">
        <summary>Separate comparison with ordinary hybrid retrieval</summary>
        <p>In a second paired comparison, the default scored {percentage(secondary.candidate).toFixed(2)}%
          {" "}against {percentage(secondary.baseline).toFixed(2)}% for ordinary hybrid retrieval:
          {" "}+{percentage(secondary.delta).toFixed(2)} points. It used fresh reader responses
          on the same 146 questions. This descriptive result is separate from the primary
          sample. The routes also differ in lexical query normalization, so it is not
          an isolated test of the reranker.</p>
      </details>
      <details className="benchmark-literature">
      <summary>Larger earlier study: 861 questions</summary>
      <h3>CloneMem · answer accuracy</h3>
      <p className="benchmark-note">Same questions, reader, prompt, and context ceiling. Higher is better.</p>
      <BenchmarkChart label="CloneMem answer accuracy, matched comparison, zero to one hundred percent" rows={[
        { id: "oh-rerank", label: "Oh retrieval + local reranker", value: percentage(result.pooledReader.candidate) },
        { id: "vector", label: "Vector retrieval", value: percentage(result.pooledReader.baseline) },
      ]} />
      <p className="benchmark-delta">
        <strong>+{percentage(result.pooledReader.delta).toFixed(2)} percentage points</strong>
        <span>95% persona-cluster interval: +{percentage(result.bootstrap.lowerBound95).toFixed(2)} to +{percentage(result.bootstrap.upperBound95).toFixed(2)} points.</span>
      </p>
      <dl className="benchmark-method">
        <div><dt>Population</dt><dd>861 questions · seven personas · three repeats per arm</dd></div>
        <div><dt>Reader</dt><dd>GPT-4o mini via Gateway · exact option-ID scoring</dd></div>
        <div><dt>Retrieval</dt><dd>Lexical + vector candidates, then local Qwen3 reranking · top 10</dd></div>
        <div><dt>Context</dt><dd>Whole traces · 96 KiB ceiling · 22.1% fewer bytes on average</dd></div>
      </dl>
      <p className="benchmark-note">
        Agent-run study, September 23, 2026. These personas were reserved from the immediate
        development screen but had prior project exposure. The model alias did not identify
        an immutable snapshot. Two failed campaign attempts were excluded under a retry
        rule added during execution; their responses and costs are retained in the report.
        An independent sensitivity audit retained a positive gain even when missing
        responses were assigned against the candidate. This measures the benchmark
        retrieval procedure, not every SDK integration.
      </p>
      <ul className="benchmark-links" aria-label="CloneMem benchmark evidence">
        <li><a href={`${evidence}/CLONEMEM_RERANK_CONFIRM_RESULT_V1.md`}>Results and limitations</a></li>
        <li><a href={`${evidence}/results/memory-clonemem-rerank-confirm-v1.json`}>Machine-readable results</a></li>
        <li><a href={`${evidence}/CLONEMEM_RERANK_CONFIRM_AUDIT_V2.md`}>Independent audit and methods</a></li>
      </ul>
      </details>
      <details className="benchmark-literature">
        <summary>How does this compare with Letta and Supermemory?</summary>
        <p>Their published results use different datasets,
          retrieval budgets, and evaluation procedures. They provide context, not a matched
          ranking against Oh.</p>
        <table>
          <caption>Published results · different protocols · checked September 23, 2026</caption>
          <thead><tr><th scope="col">System</th><th scope="col">Reported result</th><th scope="col">Evaluation</th></tr></thead>
          <tbody>
            <tr><th scope="row"><a href="https://www.letta.com/blog/benchmarking-ai-agent-memory/">Letta filesystem agent (2025)</a></th><td>74.0% accuracy</td><td>LoCoMo · GPT-4o mini with file tools · adversarial category excluded</td></tr>
            <tr><th scope="row"><a href="https://supermemory.ai/research/longmembench/">Supermemory</a></th><td>97% reported overall</td><td>LongMemEval-S · 500 questions · labeled Recall@20 with aggregation and answer evaluation</td></tr>
          </tbody>
        </table>
        <p>Letta has not been evaluated in our protocols. Supermemory appears in the
          matched pilot above under our protocol, not under its own. That pilot does not
          establish superiority over either framework: it is one configuration on 60
          previously exposed questions. A general claim needs more data, more
          configurations, and the same reader, scoring, context budget, and accounting
          for each system.</p>
      </details>
      <details className="benchmark-literature">
        <summary>Earlier results, including approaches that did not improve answers</summary>
        <p>On LoCoMo, query-aware packing recovered 90.08% of annotated evidence versus
          88.93% for vector windows, but answer accuracy was 77.33% versus 78.11%:
          no established answer improvement. Retrieval recall and answer quality are
          separate measurements.</p>
        <p><a href={`${evidence}/LOCOMO_WINDOW_QA_V1.md`}>LoCoMo protocol and results</a> ·{" "}
          <a href={`${evidence}/CLONEMEM_TRANSFER_V1.md`}>CloneMem hybrid comparison</a> ·{" "}
          <a href={`${evidence}/CLONEMEM_KEYWORD_DEV_RESULT_V1.md`}>Keyword development screen</a></p>
      </details>
    </div>
  );
}
