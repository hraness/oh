// Converted from the reviewed draft. Keep the prose; edit facts only with a new review.
import publishedRelease from "../../../published-release.json";

const resultHref = "https://github.com/hraness/oh/blob/main/benchmarks/LONGMEMEVAL_S_500_RESULT_V1.md";

export const toc = [
  { href: "#the-user-wrote-an-eighth-of-the-text", label: "The user wrote an eighth of the text" },
  { href: "#every-user-message-dated-and-in-order", label: "Every user message, dated and in order" },
  { href: "#rules-choose-answers-for-a-second-read", label: "Rules choose answers for a second read" },
  { href: "#six-additions-lowered-the-score", label: "Six additions lowered the score" },
  { href: "#a-reference-answer-in-the-instructions", label: "A reference answer in the instructions" },
  { href: "#the-rules-fit-this-benchmarks-question-types", label: "The rules fit this benchmark’s question types" },
  { href: "#what-ships-in-oh-and-what-the-study-cost", label: "What ships in Oh, and what the study cost" },
] as const;

export function LongMemEvalUserLogBody() {
  const releaseVersion = publishedRelease.version;
  return (
    <>
      <p>LongMemEval is a benchmark for the long-term memory of chat assistants, published by Di Wu and colleagues at ICLR 2025. Its S variant has 500 questions. Each comes with its own chat history between a user and an assistant, about 48 sessions and 490 KB of text on average, and asks about something said along the way. Some questions need one detail from one session. Others require counting across sessions, noticing that a fact changed, working out when something happened, or recognizing that the history never says.</p>
      <p>On all 500 questions, a pipeline built around the user’s own messages answered 93.07% correctly, averaged over three runs. It gives the answering model, GPT-5 mini, every message the user wrote, plus the assistant replies that retrieval ranks highest. With the same answering model and the same judge, GPT-4o grading with LongMemEval’s own prompts, Oh semantic retrieval alone scored 88.87% and BM25 keyword retrieval 86.13%. On questions answered correctly in at least two of three runs, the measure fixed before the runs, Oh semantic retrieval leads BM25 by 2.8 points with a 95% interval from 0.0 to 5.6, which does not rule out a tie. The pipeline’s instructions and rules were written after studying all 500 questions, so its score is in-sample: no question was held back to test them.</p>
      <figure>
        <table>
          <thead>
            <tr>
              <th scope="col">Memory</th>
              <th scope="col">Mean of three runs</th>
              <th scope="col">Questions correct in two or three runs</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">The pipeline</th>
              <td>93.07%</td>
              <td>474</td>
            </tr>
            <tr>
              <th scope="row">The pipeline’s first pass</th>
              <td>91.20%</td>
              <td>458</td>
            </tr>
            <tr>
              <th scope="row">Oh semantic retrieval</th>
              <td>88.87%</td>
              <td>445</td>
            </tr>
            <tr>
              <th scope="row">BM25 retrieval</th>
              <td>86.13%</td>
              <td>431</td>
            </tr>
          </tbody>
        </table>
        <figcaption>All 500 LongMemEval-S questions, three runs each, with GPT-5 mini answering and GPT-4o judging.</figcaption>
      </figure>
      <h2 id="the-user-wrote-an-eighth-of-the-text">The user wrote an eighth of the text</h2>
      <p>The assistant’s replies make up 87% of the text in LongMemEval-S histories. The user’s side averages about 245 messages and 61.5 KB per history, and it holds most of the answers. The benchmark marks the turns that contain each question’s evidence. In 425 of the 500 questions every marked turn is a user message, and in 51 every marked turn is the assistant’s.</p>
      <p>The two baselines rank the history’s turns against the question and keep up to 100 of the best matches, within 96,000 bytes. That works when one message holds the answer: on questions about a single detail the user mentioned, BM25 scored 97.62%, against the pipeline’s 96.67%. On questions that need several sessions, BM25 scored 74.94% and the pipeline 86.72%. The pipeline keeps retrieval for the assistant’s replies and gives the model every user message instead.</p>
      <h2 id="every-user-message-dated-and-in-order">Every user message, dated and in order</h2>
      <p>For each question the pipeline builds one memory text of up to 180,000 bytes. It opens with the question date. Then comes the complete log of the user’s messages, verbatim, grouped by session in date order, each session headed by its date and its distance from the question. Relative dates are resolved: after a message that says “last weekend”, a line gives the calendar dates, computed from the session date by a small set of rules with no model involved. With its headings and date lines the log averages 75 KB, and the largest is 131 KB.</p>
      <p>The rest of the budget goes to the assistant. BM25 and Oh semantic retrieval each rank the history’s turns for the question, and reciprocal rank fusion merges the two rankings. User messages are dropped from the merged list, since the log already holds them, and replies go in until they reach 96,000 bytes or the memory reaches its limit. About 50 fit.</p>
      <p>In 94 of the 500 histories every session is dated the same day, so the session dates say nothing about when things happened. For those histories the memory’s header says so and tells the model to date events from what the messages themselves say.</p>
      <p>A single pass over this memory, about twice the size of the baselines’ and read with three instruction paragraphs they did not have, scored 91.20%. That is 5.07 points above BM25, with a 95% interval of 2.80 to 7.40 points, and 2.33 points above Oh semantic retrieval, with an interval of 0.80 to 3.93. On questions correct in two or three runs, its leads are 5.4 points (2.6 to 8.2) and 2.6 points (0.6 to 4.6).</p>
      <h2 id="rules-choose-answers-for-a-second-read">Rules choose answers for a second read</h2>
      <p>After the first pass, rules pick some answers for a second read by GPT-5 mini, and the new answer replaces the old one. A rule sees only the question text or the current answer, never the question type or the reference answer. There are four steps, in this order:</p>
      <ul>
        <li><strong>Advice.</strong> A question that asks for suggestions, recommendations, tips, or an opinion, and does not ask what was said before, is read again over the same memory. The added instruction says never to decline, and to build the suggestions on what the user owns, has done, plans, and dislikes.</li>
        <li><strong>Two decline checks.</strong> An answer that says the memory lacks the information is read again against whole sessions: user and assistant messages verbatim, up to 100,000 bytes with each message cut at 12,000 characters, chosen first by the dates the question mentions, then by the question’s content words, then by retrieval rank. The instruction asks the model to check the question’s premise against what was said. The check runs twice.</li>
        <li><strong>Recall.</strong> A question about what the assistant said, suggested, or created earlier is read against whole sessions, with an instruction to reproduce the assistant’s own content.</li>
      </ul>
      <p>Over three runs, 378 of the 1,500 answers got a second read, and the mean rose from 91.20% to 93.07%. Advice did the most. It chose 30 questions, turned 24 wrong answers right, and broke four, and preference questions, which ask for advice fitted to what the user has said about themselves, went from 70.00% after the first pass to 92.22% at the end. The two decline checks fixed 17 answers and broke 12. Recall chose 56 questions and fixed three answers without breaking any; the first pass had already answered questions about what the assistant said in a single session correctly 95.24% of the time.</p>
      <h2 id="six-additions-lowered-the-score">Six additions lowered the score</h2>
      <p>The study ran 15 designs on all 500 questions and 10 more only on the 100 development questions. Six of the 15 added a step to a design that was kept, scored below it, and were dropped.</p>
      <p>A counting re-read asked the model to list every instance, with its date, before giving a total; it moved the mean from 93.67% to 93.47%. An arbiter, for questions whose three runs disagreed, was shown the earlier answers and asked which was correct, or for the right answer if none was; it took the mean to 90.87%. Two re-reads for questions about how things stand now lowered it by 0.60 and 0.20 points. The first of them used the same whole-session view and instruction as the decline checks.</p>
      <p>The other two used notes written by a model. A counting ledger, built by a model for the counting questions whose runs disagreed, took the count of questions correct in two or three runs from 476 to 437 when it replaced the memory, and the mean from 94.07% to 87.07%. Appended to the user log instead, it took that count to 474. On the development questions, two versions of notes that GPT-5 nano extracted from the user’s messages had already scored 90 and 91 of 100, against 94 for the messages themselves, counting questions correct in two or three runs.</p>
      <h2 id="a-reference-answer-in-the-instructions">A reference answer in the instructions</h2>
      <p>After the last design run, every instruction and rule was checked against the reference answers, which only the judge is supposed to see. Two specific values turned up. The paragraph that tells the model to report a computed result as a direct value gave a dollar amount as its example, and that amount is the reference answer to one development question. The confirmation run replaced it with “$315”, which matches no reference answer, and that question was answered correctly in all three runs with either example. The other value, a place name, appeared only in an instruction used by four designs, all dropped: three that ran on all 500 questions and one that ran only on the development questions. Answers made of common words were not counted: a number word that answers two questions appears in the user-log paragraph as ordinary prose, and BM25, Oh semantic retrieval and the pipeline answered both questions correctly in every run.</p>
      <p>The best of the 15 designs scored 94.07%, and as the best of 15 its score carried some luck. On 2026-09-26 the design was frozen and run again from scratch on all 500 questions, with new calls to both models for every step. Two things changed: the example, and the first decline check, which in the design runs had used an earlier whole-session view without the content-word step. A record written before the run started committed to reporting whatever it scored and named questions correct in at least two of three runs as the primary measure. It scored 474 on that measure, against 476 in the design run, and a mean of 93.07% over three runs, against 94.07%. That run is the result reported here.</p>
      <h2 id="the-rules-fit-this-benchmarks-question-types">The rules fit this benchmark’s question types</h2>
      <p>The advice and recall rules see only the question text, but they were written after reading all 500 questions, and here they work as question-type detectors. The advice rule picks exactly the 30 single-session preference questions and no others. The recall rule picks 55 of the 56 single-session assistant questions, plus one temporal-reasoning question. The answer-format paragraph’s own example paraphrases a development question. How these rules would fire on other conversations has not been measured.</p>
      <p>The design also depends on the user log fitting. In LongMemEval-S it never exceeded 131 KB, so it always fit in the 180,000-byte memory. A history with 10 times as many sessions would need a different design or a much larger budget, and none has been tested. No run gave GPT-5 mini the entire history as its memory. In an earlier Oh study recorded on 2026-09-10, with GPT-5 nano answering once per question, the entire history scored 355 of 500, below BM25 at 378 and Oh semantic retrieval at 379. That study kept the dataset’s original session identifiers in the model’s context; an audit found answer-label wording in a sample of them, and the effect on those scores was not measured.</p>
      <p>Both models were called through Vercel AI Gateway aliases, which can change behind the same name, and the paper’s judge is the pinned <code>{"gpt-4o-2024-08-06"}</code>, so the setup follows the paper’s without reproducing it. Other memory systems report headline LongMemEval-S scores from 90.4% to 97%. Their memory designs and prompts differ from this pipeline’s, and several used a different answering model or judge, so those figures and this one do not rank against each other. Mastra’s 94.87%, from one run with GPT-5 mini answering and GPT-4o judging, averages the six question types; on that measure the pipeline scored 93.69%. The pipeline’s own three runs scored 459, 469, and 468 of 500, so one run can differ from another by two points. No other memory framework has a usable run under this setup. Supermemory was run twice, on 125 of the questions and then on all 500, and both runs were discarded: the harness stored each turn as its own document, searched before Supermemory had finished generating memories, and kept only results holding a whole stored turn. In a separate 60-question pilot completed on 2026-09-24, with GPT-4o answering once from each system’s top 20 results, Supermemory scored 75.00% and Oh’s default SDK search 71.67%, a difference that pilot could not separate. AI agents ran the study, and no person or outside group has audited it.</p>
      <h2 id="what-ships-in-oh-and-what-the-study-cost">What ships in Oh, and what the study cost</h2>
      <p>Oh semantic retrieval is the package’s semantic search: EmbeddingGemma embeddings through the optional local QMD runtime, over each history stored one turn at a time. The BM25 baseline is SQLite FTS5 ranking from the benchmark tools in Oh’s repository. The log builder, the date rules, the re-read rules, and the instructions ran in a private lab harness and are not part of the package. Latest release: v{releaseVersion}.</p>
      <p>The <a href={resultHref}>full result</a> prints the added instructions and the three re-read rules verbatim, links the base instruction, and gives the protocol and a file of aggregate numbers behind each table.</p>
      <p>The first pass sends GPT-5 mini about 41,000 input tokens per answer, about twice what the retrieval baselines send. Per answer, the pipeline’s calls to GPT-5 mini cost $0.0108, against $0.0051 for BM25 and $0.0049 for Oh semantic retrieval. Every model call made for the study, discarded runs included, cost $121.83.</p>
    </>
  );
}
