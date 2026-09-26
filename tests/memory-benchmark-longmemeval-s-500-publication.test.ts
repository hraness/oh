import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import result from "../benchmarks/results/memory-longmemeval-s-500-v1.json";
import { EVOLUTION_PROFILES, type EvolutionProfileId } from "../scripts/benchmarks/evolution-model";
import { EVOLUTION_READER_CONTRACTS } from "../scripts/benchmarks/evolution-reader-contracts";
import { canonicalSha256 } from "../src/canonical";

const root = resolve(import.meta.dir, "..");
const resultPath = "benchmarks/results/memory-longmemeval-s-500-v1.json";
const report = readFileSync(resolve(root, result.report), "utf8");
const types = ["knowledge-update", "multi-session", "single-session-assistant", "single-session-preference", "single-session-user", "temporal-reasoning"];
const percent = (correct: number, total: number) => Math.round(correct / total * 10_000) / 100;
const shown = (value: number) => `${value.toFixed(2)}%`;
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const system = (id: string) => result.systems.find(row => row.id === id)!;

describe("LongMemEval-S 500-question public result", () => {
  test("every system's counts add up across runs, types and question groups", () => {
    const questionTypes: Record<string, number> = result.dataset.questionTypes;
    expect(Object.values(questionTypes).reduce((sum, count) => sum + count, 0)).toBe(result.dataset.questions);
    expect(result.systems.map(row => row.id)).toEqual(["oh-reading-pipeline", "first-pass-only", "oh-semantic-96k", "bm25-96k"]);
    for (const row of result.systems) {
      expect(row.answers).toBe(result.dataset.questions * result.runs.repeatsPerQuestion);
      expect(row.correctPerRun.reduce((sum, count) => sum + count, 0)).toBe(row.correctAnswers);
      expect(row.percent).toBe(percent(row.correctAnswers, row.answers));
      expect(row.byType.map(cell => cell.questionType)).toEqual(types);
      expect(row.byType.reduce((sum, cell) => sum + cell.correctAnswers, 0)).toBe(row.correctAnswers);
      expect(row.byType.reduce((sum, cell) => sum + cell.questionsCorrectInTwoOrThreeRuns, 0)).toBe(row.questionsCorrectInTwoOrThreeRuns);
      for (const cell of [...row.byType, row.abstention, row.developmentQuestions, row.otherQuestions]) {
        expect(cell.answers).toBe(cell.questions * 3);
        expect(cell.correctAnswers).toBeLessThanOrEqual(cell.answers);
        expect(cell.percent).toBe(percent(cell.correctAnswers, cell.answers));
      }
      for (const cell of row.byType) expect(cell.questions).toBe(questionTypes[cell.questionType]!);
      expect(row.abstention.questions).toBe(result.dataset.abstentionQuestions);
      expect(row.developmentQuestions.questions + row.otherQuestions.questions).toBe(result.dataset.questions);
      expect(row.developmentQuestions.correctAnswers + row.otherQuestions.correctAnswers).toBe(row.correctAnswers);
      expect(row.typeAveragePercent).toBeCloseTo(row.byType.reduce((sum, cell) => sum + cell.percent, 0) / 6, 2);
    }
  });

  test("the re-read steps connect the first pass to the reported pipeline", () => {
    const [first, ...reReads] = result.stages;
    expect(first!.correctAnswers).toBe(system("first-pass-only").correctAnswers);
    expect(first!.questionsCorrectInTwoOrThreeRuns).toBe(system("first-pass-only").questionsCorrectInTwoOrThreeRuns);
    const last = result.stages.at(-1)!;
    expect(last.correctAnswers).toBe(system("oh-reading-pipeline").correctAnswers);
    expect(last.questionsCorrectInTwoOrThreeRuns).toBe(system("oh-reading-pipeline").questionsCorrectInTwoOrThreeRuns);
    let previous = first!.correctAnswers;
    for (const step of reReads) {
      expect(step.correctAnswers - previous).toBe(step.answersFixed! - step.answersBroken!);
      expect(step.answersReRead!).toBeLessThanOrEqual(step.questionsChosen! * 3);
      previous = step.correctAnswers;
    }
    const reReadCalls = reReads.reduce((sum, step) => sum + step.answersReRead!, 0);
    const pipelineCost = result.cost.systems.find(row => row.system === "oh-reading-pipeline")!;
    expect(reReadCalls).toBe(pipelineCost.reReadCalls!);
    expect(pipelineCost.readerCalls).toBe(1500 + reReadCalls);
    const { answersReReadOnce, answersReReadTwice, answersReReadThreeTimes } = result.reReads;
    expect(answersReReadOnce + answersReReadTwice + answersReReadThreeTimes).toBe(result.reReads.answersReReadAtLeastOnce);
    expect(answersReReadOnce + 2 * answersReReadTwice + 3 * answersReReadThreeTimes).toBe(reReadCalls);
    expect(result.reReads.maximumReReadsPerAnswer).toBeLessThanOrEqual(result.reReads.designMaximumReReadsPerAnswer);
    expect(result.reReads.designMaximumReReadsPerAnswer).toBe(result.reReads.order.length);
  });

  test("paired comparisons match the system totals, and one frozen-measure interval reaches zero", () => {
    for (const comparison of result.comparisons) {
      const left = system(comparison.left), right = system(comparison.right);
      const mean = comparison.meanOfThreeRuns, majority = comparison.correctInTwoOrThreeRuns;
      expect(mean.differencePoints).toBeCloseTo((left.correctAnswers - right.correctAnswers) / 15, 2);
      expect(majority.differencePoints).toBeCloseTo((left.questionsCorrectInTwoOrThreeRuns - right.questionsCorrectInTwoOrThreeRuns) / 5, 2);
      expect(majority.questionsGained - majority.questionsLost).toBe(left.questionsCorrectInTwoOrThreeRuns - right.questionsCorrectInTwoOrThreeRuns);
      expect(mean.questionsWithMoreCorrectRuns + mean.questionsWithFewerCorrectRuns + mean.questionsEqual).toBe(comparison.pairedQuestions);
      expect(majority.questionsGained + majority.questionsLost + majority.questionsEqual).toBe(comparison.pairedQuestions);
      for (const { differencePoints, interval95: [lower, upper] } of [mean, majority]) {
        expect(lower!).toBeLessThanOrEqual(differencePoints);
        expect(upper!).toBeGreaterThanOrEqual(differencePoints);
      }
      expect(mean.interval95[0]!).toBeGreaterThan(0);
      // The report says Oh semantic over BM25 does not rule out a tie on the frozen measure.
      const tie = comparison.left === "oh-semantic-96k" && comparison.right === "bm25-96k";
      if (tie) expect(majority.interval95[0]!).toBeLessThanOrEqual(0);
      else expect(majority.interval95[0]!).toBeGreaterThan(0);
    }
    expect(result.scoring.freezePrimary).toBe(result.scoring.secondary);
    const reReads = result.comparisons.find(row => row.left === "oh-reading-pipeline" && row.right === "first-pass-only")!;
    expect(reReads.correctInTwoOrThreeRuns.questionsLost).toBe(0);
  });

  test("the development record and the confirmation run agree", () => {
    const designs = result.development.fullEvaluations;
    expect(designs.map(row => row.design)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    const champion = designs.find(row => row.design === result.development.champion)!;
    expect(Math.max(...designs.map(row => row.correctPerRun.reduce((sum, count) => sum + count, 0)))).toBe(result.confirmation.developmentRun.correctAnswers);
    expect(champion.correctPerRun).toEqual(result.confirmation.developmentRun.correctPerRun);
    expect(champion.questionsCorrectInTwoOrThreeRuns).toBe(result.confirmation.developmentRun.questionsCorrectInTwoOrThreeRuns);
    expect(result.confirmation.design).toBe(champion.design);
    expect(result.confirmation.confirmationRun.correctAnswers).toBe(system("oh-reading-pipeline").correctAnswers);
    expect(result.confirmation.confirmationRun.percent).toBe(system("oh-reading-pipeline").percent);
    expect(result.confirmation.frozenAt < result.confirmation.semanticRunFrozenAt).toBeTrue();
    expect(result.referenceAnswerScan.findings[1]!.designs!.every(design => !designs[design - 1]!.kept)).toBeTrue();
    for (const value of Object.values(result.confirmation.labSourceSha256)) expect(value).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("published instructions compose to the digests the reader ran", () => {
    const base = EVOLUTION_READER_CONTRACTS["explicit-abstention-composition-v1"];
    expect(result.instructions.base.sha256).toBe(base.instructionSha256);
    expect(result.instructions.base.characters).toBe(base.instruction.length);
    const paragraphs: Record<string, string> = result.instructions.paragraphs;
    for (const step of result.instructions.steps) {
      const instruction = [base.instruction, ...step.paragraphs.map(name => paragraphs[name]!)].join(" ");
      expect<string>(canonicalSha256(instruction)).toBe(step.sha256);
      expect(instruction.length).toBe(step.characters);
      expect(report).toContain(step.sha256);
    }
    for (const text of Object.values(paragraphs)) expect(report).toContain(text);
    expect(paragraphs.calibration).toContain("\"$315\"");
    expect(paragraphs.calibration).not.toContain("$270");
  });

  test("reader and judge profiles are the repository's", () => {
    for (const role of [result.reader, result.judge]) {
      const profile = EVOLUTION_PROFILES[role.profile as EvolutionProfileId];
      expect<string>(canonicalSha256(profile)).toBe(role.profileSha256);
      expect(profile.model).toBe(role.model);
      expect(profile.maxOutputTokens).toBe(role.maxOutputTokens);
      expect(role.snapshotPinned).toBeFalse();
    }
  });

  test("the rules choose what the report says they choose", () => {
    const advice = new RegExp(result.rules.advice.matches, "iu"), notRecall = new RegExp(result.rules.advice.unless, "iu");
    const decline = new RegExp(result.rules.decline.matches, "iu"), recall = new RegExp(result.rules.recall.matches, "iu");
    const chooseAdvice = (question: string) => advice.test(question) && !notRecall.test(question);
    expect(chooseAdvice("Can you suggest a weekend hike near me?")).toBeTrue();
    expect(chooseAdvice("Can you remind me what you suggested for the hike?")).toBeFalse();
    expect(recall.test("Can you remind me what you suggested for the hike?")).toBeTrue();
    expect(decline.test("The supplied conversation does not contain enough information to answer the question.")).toBeTrue();
    expect(base()).toContain("does not contain enough information");
    for (const rule of [result.rules.advice.matches, result.rules.advice.unless, result.rules.decline.matches, result.rules.recall.matches]) {
      expect(report).toContain(rule.replace(/^\\b|\\b$/gu, ""));
    }
    expect(result.questionRuleFit.advice.byType).toEqual({ "single-session-preference": result.questionRuleFit.advice.questionsChosen });
    expect(Object.values(result.questionRuleFit.recall.byType).reduce((sum, count) => sum + count, 0)).toBe(result.questionRuleFit.recall.questionsChosen);
    expect(result.stages.find(step => step.step === "advice")!.questionsChosen).toBe(result.questionRuleFit.advice.questionsChosen);
    expect(result.stages.find(step => step.step === "recall")!.questionsChosen).toBe(result.questionRuleFit.recall.questionsChosen);
  });

  test("the report prints the numbers in this file", () => {
    for (const row of result.systems) {
      expect(report).toContain(`| ${shown(row.percent)} | ${row.questionsCorrectInTwoOrThreeRuns} | ${row.correctPerRun.join(", ")} |`);
    }
    const typeColumns = ["oh-reading-pipeline", "first-pass-only", "oh-semantic-96k", "bm25-96k"].map(system);
    types.forEach((type, index) => {
      const cells = typeColumns.map(row => shown(row.byType[index]!.percent)).join(" | ");
      expect(report).toContain(`| ${result.dataset.questionTypes[type as keyof typeof result.dataset.questionTypes]} | ${cells} |`);
    });
    expect(report).toContain(`| ${result.dataset.abstentionQuestions} | ${typeColumns.map(row => shown(row.abstention.percent)).join(" | ")} |`);
    for (const comparison of result.comparisons) {
      const { differencePoints, interval95: [lower, upper], questionsWithMoreCorrectRuns, questionsWithFewerCorrectRuns } = comparison.meanOfThreeRuns;
      expect(report).toContain(`| +${differencePoints.toFixed(2)} | ${lower!.toFixed(2)} to ${upper!.toFixed(2)} | ${questionsWithMoreCorrectRuns} / ${questionsWithFewerCorrectRuns} |`);
      const majority = comparison.correctInTwoOrThreeRuns;
      expect(report).toContain(`| +${majority.differencePoints.toFixed(1)} | ${majority.interval95[0]!.toFixed(1)} to ${majority.interval95[1]!.toFixed(1)} | ${majority.questionsGained} / ${majority.questionsLost} |`);
    }
    for (const step of result.stages.slice(1)) {
      expect(report).toContain(`| ${step.questionsChosen} | ${step.answersReRead} | ${shown(step.percent)} | ${step.questionsCorrectInTwoOrThreeRuns} | ${step.answersFixed} | ${step.answersBroken} |`);
    }
    for (const design of result.development.fullEvaluations) {
      const mean = shown(percent(design.correctPerRun.reduce((sum, count) => sum + count, 0), 1500));
      expect(report).toContain(`| ${design.design} | ${design.description.charAt(0).toUpperCase()}${design.description.slice(1)} | ${mean} | ${design.questionsCorrectInTwoOrThreeRuns} |${design.kept ? " yes |" : " |"}`);
    }
    const pipelineCost = result.cost.systems.find(row => row.system === "oh-reading-pipeline")!;
    expect(pipelineCost.readerMicros).toBe(pipelineCost.firstPassReaderMicros! + pipelineCost.reReadReaderMicros!);
    for (const row of result.cost.systems) {
      expect(row.readerMicrosPerAnswer).toBe(Math.round(row.readerMicros / 1500));
      expect(report).toContain(`| ${usd(row.readerMicros)} | ${usd(row.judgeMicros)} | $${(row.readerMicrosPerAnswer / 1_000_000).toFixed(4)} |`);
    }
    for (const micros of [pipelineCost.firstPassReaderMicros!, pipelineCost.reReadReaderMicros!, result.cost.studyTotal.micros]) expect(report).toContain(usd(micros));
    expect(result.cost.studyTotal.settledMicros + result.cost.studyTotal.heldMicros).toBe(result.cost.studyTotal.micros);
    expect(Object.values(result.cost.studyTotal.byDay).reduce((sum, micros) => sum + micros, 0)).toBe(result.cost.studyTotal.micros);
    expect(report).toContain(`${system("oh-reading-pipeline").typeAveragePercent.toFixed(2)}%`);
    expect(report).toContain(result.dataset.sha256);
    expect(report).toContain(result.dataset.revision);
  });

  test("publishes aggregates only, and the report's local links resolve", () => {
    const raw = readFileSync(resolve(root, resultPath));
    expect(raw.length).toBeLessThanOrEqual(65_536);
    const text = raw.toString("utf8");
    for (const forbidden of ["question_id", "haystack", "\"answer\":", "\"reference\":", "\"question\":", "VERCEL_OIDC", "Bearer "]) expect(text).not.toContain(forbidden);
    expect(text).not.toMatch(/gpt4_[0-9a-f]{8}|[0-9a-f]{8}_abs/u);
    for (const published of [text, report]) expect(published).not.toMatch(/\/Users\/[^/\s]+|\/private\/tmp\/[^\s)]+/u);
    const targets = [...report.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)].map(match => match[1]!).filter(target => !/^[a-z][a-z0-9+.-]*:/iu.test(target));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(existsSync(resolve(root, dirname(result.report), target))).toBeTrue();
  });
});

function base(): string {
  return EVOLUTION_READER_CONTRACTS["explicit-abstention-composition-v1"].instruction;
}
