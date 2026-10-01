const resultHref = "https://github.com/hraness/oh/blob/main/benchmarks/LONGMEMEVAL_S_500_RESULT_V1.md";

export const toc = [
  { href: "#what-the-comparison-measured", label: "What the comparison measured" },
  { href: "#preserve-speaker-and-time", label: "Preserve speaker and time" },
  { href: "#evaluate-the-extra-pass", label: "Evaluate the extra pass" },
  { href: "#compare-complete-pipelines", label: "Compare complete pipelines" },
  { href: "#test-on-unseen-questions", label: "Test on unseen questions" },
] as const;

export function LongMemEvalUserLogBody() {
  return (
    <>
      <p>Retrieval helps an assistant find relevant passages in a long conversation. It can also leave out information a question needs: several small decisions spread across sessions, a fact that changed, or a preference mentioned indirectly. When one part of the history is compact enough to fit, keeping that part in full is another design worth testing.</p>
      <p>An Oh study explored this choice on LongMemEval-S, a benchmark for conversational memory. A pipeline that kept every user message scored above two retrieval baselines in the reported runs. It also used more context, different instructions, and rules developed against the same questions. The useful lesson is how to compare those choices without attributing the whole improvement to one mechanism.</p>
      <h2 id="what-the-comparison-measured">What the comparison measured</h2>
      <p>LongMemEval, published by Di Wu and colleagues at ICLR 2025, asks questions about earlier conversations. Its S variant has 500 questions, each with its own history. Tasks include recalling a detail, combining sessions, noticing an update, reasoning about dates, and recognizing missing information.</p>
      <p>In the study’s September 26, 2026 confirmation run, GPT-5 mini answered and GPT-4o graded with the benchmark’s judge prompts. The pipeline included every user message and retrieved selected assistant replies. Each setup ran three times.</p>
      <figure>
        <table>
          <thead><tr><th scope="col">Memory setup</th><th scope="col">Mean accuracy</th><th scope="col">Questions correct in at least two runs</th></tr></thead>
          <tbody>
            <tr><th scope="row">User log with selected re-reads</th><td>93.07%</td><td>474</td></tr>
            <tr><th scope="row">User log, first pass</th><td>91.20%</td><td>458</td></tr>
            <tr><th scope="row">Oh semantic retrieval</th><td>88.87%</td><td>445</td></tr>
            <tr><th scope="row">BM25 keyword retrieval</th><td>86.13%</td><td>431</td></tr>
          </tbody>
        </table>
        <figcaption>All 500 LongMemEval-S questions, three runs per setup. The user-log rules were developed after inspecting all 500 questions; these are in-sample results.</figcaption>
      </figure>
      <p>The study fixed the count of questions correct in at least two runs as its primary measure. On that measure, Oh semantic retrieval led BM25 by 2.8 percentage points, with a 95% interval from 0.0 to 5.6 points. That comparison does not rule out a tie.</p>
      <h2 id="preserve-speaker-and-time">Preserve speaker and time</h2>
      <p>The user wrote about one eighth of the text in these histories. For 425 of the 500 questions, every turn marked as evidence was a user message. Keeping the user’s side therefore preserved much of the relevant material at a fraction of the size of the entire conversation. Assistant replies still mattered: 51 questions had evidence exclusively in those replies.</p>
      <p>The pipeline grouped user messages by session and date, then used the remaining space for retrieved assistant replies. Its dated user log averaged 75 KB and never exceeded 131 KB, inside a 180,000-byte memory budget. The retrieval baselines had a 96,000-byte budget.</p>
      <p>Speaker and time are useful structure. A preference expressed by the user differs from a suggestion made by the assistant. An earlier plan differs from its replacement. Preserve those distinctions when selecting passages or writing summaries, and check that a larger history still fits the chosen budget.</p>
      <h2 id="evaluate-the-extra-pass">Evaluate the extra pass</h2>
      <p>The pipeline used rules to send selected answers back to the model with another view or instruction. Across three runs, 378 of 1,500 answers received a re-read, and mean accuracy rose from 91.20% to 93.07%.</p>
      <p>Individual rules had different effects. The two checks for answers that declined to respond fixed 17 answers and broke 12. Other candidate additions, including some counting and arbitration steps, lowered the score. Evaluate an extra model call by the errors it corrects and introduces, along with its latency and cost.</p>
      <h2 id="compare-complete-pipelines">Compare complete pipelines</h2>
      <p>The user-log setup changed context selection, context budget, instructions, and re-reading rules together. Its higher score supports that combined setup on these questions. It does not isolate the effect of replacing retrieval with a full user log. An experiment that holds the other choices fixed would answer that narrower question.</p>
      <p>The first pass sent about 41,000 input tokens per answer, roughly twice the retrieval baselines. At the study’s recorded prices, answering-model calls averaged $0.0108 per answer for the complete pipeline, compared with $0.0051 for BM25 and $0.0049 for Oh semantic retrieval. These are historical measurements of this workload.</p>
      <p>Oh’s public semantic search uses the optional local QMD runtime. The user-log and re-read pipeline is separate from that search API. Scores from other memory systems use different prompts, readers, judges, or aggregation methods; their headline numbers do not form a controlled ranking against this study.</p>
      <h2 id="test-on-unseen-questions">Test on unseen questions</h2>
      <p>The rules were written after all 500 questions had been examined. Some closely matched the benchmark’s question categories. A fresh run with new model calls measures variation in that setup, but does not turn familiar questions into held-out evaluation.</p>
      <p>The study also found a reference-answer value in an instruction example. The confirmation run replaced it and recorded the correction. The <a href={resultHref}>full report</a> preserves the development history, prompts, comparisons, contamination checks, and uncertainty behind the results. AI agents ran the study; it has no independent human audit.</p>
      <p>For a new memory system, choose development and test conversations before tuning. Keep reference answers out of the context builder, compare equal budgets where the mechanism is the question, and retain failures as well as improvements. Include histories longer than the proposed full-log budget and questions whose answers are absent. Those tests reveal whether the design serves the intended conversations.</p>
    </>
  );
}
