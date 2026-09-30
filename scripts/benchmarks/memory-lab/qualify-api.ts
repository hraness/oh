/** Fresh provider and released-template checks on invented controls only. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../../../src/canonical";
import { bindBeamReleasedScorerTemplatesV1, stepBeamReleasedScoreV1 } from "../beam-released-scorer-v1";
import { EVOLUTION_READER_CONTRACTS, evolutionAnswerMessages } from "../evolution-reader-contracts";
import { ApiLabTransport, parseApiConfig } from "./api-transport";

const lab = process.env.OH_MEMORY_LAB;
if (!lab) throw new Error("set OH_MEMORY_LAB to the private lab workspace");
const rawProfile = readFileSync(join(lab, "profile.json"), "utf8"), profile = JSON.parse(rawProfile);
const config = parseApiConfig(profile.api);
const rawTemplates = readFileSync(profile.scorerTemplates, "utf8");
const templates = bindBeamReleasedScorerTemplatesV1(JSON.parse(rawTemplates).templates, "released");
const dir = join(lab, "experiments", Bun.argv[2] ?? "000-api-qualification");
if (existsSync(dir)) throw new Error("qualification output exists; preserve it and choose a fresh preregistered run");
const controls = [
  { id: "current-update", category: "knowledge_update" as const, date: "2034-05-04", context: "2034-05-01 USER: I choose amber for my case.\n2034-05-03 USER: I changed my case choice to teal.",
    question: "What colour case do I currently want?", rubric: ["Identify teal as the latest explicitly chosen colour."], negative: "Amber." },
  { id: "historical-update", category: "temporal_reasoning" as const, date: "2034-05-04", context: "2034-05-01 USER: I choose amber for my case.\n2034-05-03 USER: I changed my case choice to teal.",
    question: "What was my case choice as known on May 2, 2034?", rubric: ["Identify amber, the choice before the May 3 change."], negative: "Teal." },
  { id: "unadopted-suggestion", category: "abstention" as const, date: "2034-05-04", context: "2034-05-01 ASSISTANT: You could choose a copper case.\n2034-05-02 USER: I have not chosen a case colour.",
    question: "Which case colour did I choose?", rubric: ["Abstain because no colour was chosen; a suggestion does not establish adoption."], negative: "Copper." },
  { id: "complete-endpoints", category: "information_extraction" as const, date: "2034-05-04", context: "2034-05-01 USER: My fictional rehearsal began at 09:10 and ended at 09:55.",
    question: "When did my rehearsal start and finish, and how long did it last?", rubric: ["Include the 09:10 start, 09:55 finish, and 45-minute duration."], negative: "It lasted 45 minutes." },
];
mkdirSync(dir, { recursive: true, mode: 0o700 });
const save = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const plan = { protocol: "oh.memory-lab-api-invented-controls.v1", controls, maximumCalls: 12, maxMinutes: 60,
  profileSha256: sha256Hex(rawProfile), templatesSha256: sha256Hex(rawTemplates), config,
  inferenceScope: "invented-control-provider-and-released-template-agreement-only", success: "four generated answers score 1 and four negative controls score 0" };
save("plan.json", plan);
save("frozen.json", { planSha256: sha256Hex(JSON.stringify(plan)), adapterSha256: sha256Hex(readFileSync(join(import.meta.dir, "api-transport.ts"))),
  qualificationSha256: sha256Hex(readFileSync(import.meta.path)), budgetSha256: sha256Hex(readFileSync(config.budgetPath)) });
const transport = await ApiLabTransport.open({ config, maxCalls: 12 });
const observations: unknown[] = [];
try {
  for (const control of controls) {
    const user = evolutionAnswerMessages({ question: control.question, questionDate: control.date }, control.context, "task-complete-v10")[1]!;
    const generated = await transport.invoke(config.reader.id, [{ role: "system", content: EVOLUTION_READER_CONTRACTS["task-complete-v10"].instruction }, user]);
    if (generated.result.status !== "completed") throw new Error("invented-control reader failed: " + generated.result.failureReason);
    for (const [kind, answer, expected] of [["generated", generated.result.answer!, 1], ["negative", control.negative, 0]] as const) {
      const input = { category: control.category, question: control.question, rubric: control.rubric, answer, templates };
      const first = stepBeamReleasedScoreV1(input, []);
      if (first.status !== "request") throw new Error("unexpected released scorer control plan");
      const judged = await transport.invoke(config.judge.id, first.request.messages);
      const scored = judged.result.status === "completed" ? stepBeamReleasedScoreV1(input, [judged.result.answer!]) : null;
      const score = scored?.status === "scored" ? scored.result.llm_judge_score : null;
      observations.push({ id: control.id, kind, expected, score, agreement: score === expected, generated, judged });
      console.log(JSON.stringify({ control: control.id, kind, score, agreement: score === expected, ...transport.summary }));
    }
  }
  save("observations.json", observations);
  const pass = observations.length === 8 && observations.every(row => (row as { agreement: boolean }).agreement);
  save("assessment.json", { status: pass ? "pass" : "fail", scope: plan.inferenceScope, planned: 8, observed: observations.length,
    agreement: observations.filter(row => (row as { agreement: boolean }).agreement).length, ...transport.summary, completedAt: new Date().toISOString() });
  if (!pass) process.exitCode = 1;
} catch (error) {
  save("observations.partial.json", observations);
  save("assessment.json", { status: "incomplete", scope: plan.inferenceScope, planned: 8, observed: observations.length,
    error: error instanceof Error ? error.message : "provider failure", ...transport.summary });
  throw error;
} finally { transport.close(); }
