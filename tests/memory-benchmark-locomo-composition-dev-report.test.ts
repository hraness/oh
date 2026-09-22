import { expect, test } from "bun:test";
import { canonicalJson, sha256Hex } from "../src/canonical";
import { LOCOMO_COMPOSITION_DEV_ARMS } from "../scripts/benchmarks/locomo-composition-dev";
import { assertLocomoCompositionDevRunBinding, summarizeLocomoCompositionDevCells,
  type LocomoCompositionDevCell } from "../scripts/benchmarks/locomo-composition-dev-report";

function matrix(): LocomoCompositionDevCell[] {
  return ["conv-49", "conv-50"].flatMap((groupId, groupIndex) => {
    const categories = (groupIndex ? [14, 18, 4, 44] : [13, 21, 8, 38])
      .flatMap((count, category) => Array<string>(count).fill(`locomo:${category + 1}`));
    return categories.flatMap((category, index) => LOCOMO_COMPOSITION_DEV_ARMS.flatMap(armId =>
      [0, 1, 2].map((repeat): LocomoCompositionDevCell => {
        const correct = armId === "vector-window-composition" && index < 20 && repeat < 2;
        return { questionId: `PRIVATE_${groupId}_${index}`, groupId, category, armId, repeat,
          score: correct ? 1 : 0, disposition: correct ? "correct" : "wrong" };
      })));
  });
}

test("complete fixed matrix reports integer paired counts, three attempts, temporal gate and every category", () => {
  const summary = summarizeLocomoCompositionDevCells(matrix());
  expect(summary).toMatchObject({ questions: 160, logicalCases: 960, matrixComplete: true,
    primary: { candidateCorrect: 80, baselineCorrect: 0, delta: 1 / 6, wins: 40, losses: 0, ties: 120 },
    readerFailureCases: 0, judgeOnlyFailureCases: 0 });
  expect(summary.arms.map(row => row.cases)).toEqual([480, 480]);
  expect(summary.byConversation.map(row => row.primary.delta)).toEqual([1 / 6, 1 / 6]);
  expect(summary.byCategory.map(row => row.questions)).toEqual([27, 39, 12, 82]);
  expect(summary.byCategory[1]!).toMatchObject({ role: "prespecified-temporal-gate",
    contrast: { candidateCorrect: 26, baselineCorrect: 0, delta: 26 / 117 } });
  expect(summary.byCategory[1]!.arms.map(row => row.cases)).toEqual([117, 117]);
  expect(summary.byRepeat.map(row => row.arms[1]!.correct)).toEqual([40, 40, 0]);
  expect(summary.decision).toMatchObject({ advanceToSeparateConfirmation: true,
    confirmedImprovement: false, externalFrameworkSuperiority: false });
  expect(canonicalJson(summary)).not.toContain("PRIVATE_");
});

test("reader and judge failures stay zero in complete denominators and veto advancement", () => {
  for (const disposition of ["reader-failure", "judge-input-bound", "judge-failure"] as const) {
    const cells = matrix(); cells[0] = { ...cells[0]!, disposition, score: 0 };
    const summary = summarizeLocomoCompositionDevCells(cells);
    expect(summary.arms.map(row => row.cases)).toEqual([480, 480]);
    expect(summary.primary.delta).toBe(1 / 6);
    expect(summary.readerFailureCases).toBe(disposition === "reader-failure" ? 1 : 0);
    expect(summary.judgeOnlyFailureCases).toBe(disposition === "reader-failure" ? 0 : 1);
    expect(summary.decision.advanceToSeparateConfirmation).toBeFalse();
  }
});

test("report refuses incomplete, duplicate, changed-group/category and inconsistent score cells", () => {
  expect(() => summarizeLocomoCompositionDevCells(matrix().slice(1))).toThrow("complete");
  const duplicate = matrix(); duplicate[0] = duplicate[1]!;
  expect(() => summarizeLocomoCompositionDevCells(duplicate)).toThrow("identity");
  for (const update of [{ category: "locomo:5" }, { category: "locomo:2" }, { groupId: "conv-50" },
    { repeat: 3 }, { score: 1 as const }, { disposition: "unresolved" as never }]) {
    const cells = matrix(); cells[0] = { ...cells[0]!, ...update };
    expect(() => summarizeLocomoCompositionDevCells(cells)).toThrow();
  }
  expect(() => summarizeLocomoCompositionDevCells(matrix().map(row => ({ ...row, category: "locomo:1" })))).toThrow("temporal");
});

test("authenticated report must still match original admitted source, scorer, plan and each pinned role", () => {
  const pin = (name: string) => ({ path: `/fixture/${name}`, sha256: sha256Hex(name) });
  const roles = { sourcePin: pin("source"), scorerPin: pin("scorer"), planPin: pin("plan"), campaignPin: pin("campaign") };
  const admitted = { source: { original: "source" }, scorer: { original: "scorer" }, plan: { original: "plan" } };
  const prepared = { ...admitted, ...roles }, native = { ...admitted, launch: roles };
  expect(() => assertLocomoCompositionDevRunBinding(prepared, native)).not.toThrow();
  for (const role of ["source", "scorer", "plan"] as const) {
    expect(() => assertLocomoCompositionDevRunBinding(prepared, { ...native, [role]: { changed: true } })).toThrow("original");
  }
  for (const role of ["sourcePin", "scorerPin", "planPin", "campaignPin"] as const) {
    expect(() => assertLocomoCompositionDevRunBinding(prepared, { ...native, launch: { ...roles, [role]: pin("replacement") } })).toThrow("role");
  }
});
