import result from "../../benchmarks/results/memory-clonemem-rerank-confirm-v1.json";
import { BenchmarkChart } from "./benchmark-chart";

const evidence = "https://github.com/hraness/oh/blob/main/benchmarks";
const percentage = (value: number) => value * 100;

export function MemoryBenchmarkComparison() {
  return (
    <div className="memory-benchmark">
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
      <details className="benchmark-literature">
        <summary>How does this compare with Letta and Supermemory?</summary>
        <p>Both publish strong memory results. Their reported numbers use different datasets,
          retrieval budgets, and evaluation procedures. They provide context, not a matched
          ranking against Oh.</p>
        <table>
          <caption>Published results · different protocols · checked September 23, 2026</caption>
          <thead><tr><th scope="col">System</th><th scope="col">Reported result</th><th scope="col">Evaluation</th></tr></thead>
          <tbody>
            <tr><th scope="row"><a href="https://www.letta.com/blog/benchmarking-ai-agent-memory/">Letta Filesystem</a></th><td>74.0% accuracy</td><td>LoCoMo · GPT-4o mini agent with file tools</td></tr>
            <tr><th scope="row"><a href="https://supermemory.ai/research/longmembench/">Supermemory</a></th><td>97% reported Recall@20</td><td>LongMemEval-S · 500 questions · aggregation</td></tr>
          </tbody>
        </table>
        <p>Neither has been evaluated in our CloneMem protocol. Oh has not established
          superiority over these frameworks. A head-to-head comparison needs the same
          data, reader, scoring, context budget, and accounting for each system.</p>
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
