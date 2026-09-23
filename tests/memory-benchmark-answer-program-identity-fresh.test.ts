import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { canonicalSha256 } from "../src/canonical";
import { runRecommendationProgram, type RecommendationProgramInput, type RecommendationProgramResult, type RecommendationSource } from "../scripts/benchmarks/answer-program";
import { inspectRecommendationIdentityV1 } from "../scripts/benchmarks/answer-program-identity";

type Candidate = { candidateId: string; itemId: string; displayTitle: string; field: "title" | "narrator"; value: string; sourceText: string; active: boolean; source: RecommendationSource };
type Output = Pick<RecommendationProgramResult, "status" | "items" | "text">;
type Arm = "exact" | "semantic" | "guarded" | "allUnknown";
type Row = { caseId: string; items: { itemId: string; displayTitle: string; mode: "requested" | "optional" }[]; candidates: Candidate[];
  exactAdmitted: string[]; semanticAdmitted: string[]; guardedAdmitted: string[];
  exactInput: RecommendationProgramInput; semanticInput: RecommendationProgramInput; guardedInput: RecommendationProgramInput; allUnknownInput: RecommendationProgramInput;
  exact: Output; semantic: Output; guarded: Output; allUnknown: Output };
type Gold = { caseId: string; group: string; supportingCandidateIds: string[]; family: string; mechanism: string;
  items: { itemId: string; status: string; title?: string; narrator?: string }[] };
const arms = ["exact", "semantic", "guarded", "allUnknown"] as const;
const eligible = (c: Candidate) => c.active && (c.field !== "title" || c.value === c.displayTitle);
const sourceStatement = (c: Candidate) => `Audiobook ${JSON.stringify(c.displayTitle)}: ${c.field} = ${JSON.stringify(c.value)}.`;

// Recorded source inputs and original gold are separate. The veto below sees
// only source statements and the host's locked requested identity.
test("fresh synthetic replay preserves all source bindings, four program arms and the fixed subtractive veto", () => {
  const path = new URL("../benchmarks/results/memory-answer-program-identity-v7-replay.json", import.meta.url);
  expect(statSync(path).size).toBeLessThanOrEqual(2_097_152);
  const bytes = readFileSync(path), text = bytes.toString("utf8");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("ea1f815b8b998bb3b255e93ce22ffc21ff08811223eb272d581a7f36b7edea50");
  expect(text).not.toMatch(/\/Users\/|\/private\/|Bearer |VERCEL_OIDC_TOKEN|api[_-]?key/i);
  const artifact = JSON.parse(text) as { protocol: string; provenance: Record<string, string>; rows: Row[]; gold: Gold[] };
  expect(artifact.protocol).toBe("oh.benchmark.answer-program-identity-fresh-replay.v7");
  expect(artifact.rows.map(r => r.caseId)).toEqual(Array.from({ length: 20 }, (_, i) => `g${String(i + 1).padStart(2, "0")}`));
  expect(artifact.provenance.manifest).toBe("7213ae6a9dd69719b49773d3efdc583ae2073e9d5e5c3098f8affc2ea73eb735");
  expect(artifact.provenance.audit).toBe("94bafef6071b9861ed6e59a9e098a98d847d865c975478845ff8dfa8ff6a2fdf");
  const sourceCases = artifact.rows.map(r => ({ caseId: r.caseId, snapshot: r.exactInput.snapshot, requests: r.exactInput.requests, items: r.items, candidates: r.candidates }));
  expect(String(canonicalSha256(sourceCases))).toBe(artifact.provenance.source!);
  let candidateCount = 0, eligibleCount = 0, admitted = 0, retained = 0;
  const outputs = artifact.rows.map(row => {
    const input = row.semanticInput, available = row.candidates.filter(eligible);
    candidateCount += row.candidates.length; eligibleCount += available.length;
    expect(row.items.map(({ itemId, mode }) => ({ itemId, mode }))).toEqual([...input.requests]);
    for (const name of arms) {
      expect(row[`${name}Input`].snapshot).toEqual(input.snapshot);
      expect(row[`${name}Input`].requests).toEqual(input.requests);
    }
    const superseded = new Set<string>();
    for (const [index, record] of input.snapshot.records.entries()) {
      const value = record.value as { text: string; sequence: number; supersedes: string[] };
      expect(value.sequence).toBe(index);
      for (const prior of value.supersedes) {
        const priorIndex = input.snapshot.records.findIndex(r => r.key === prior);
        expect(priorIndex).toBeGreaterThanOrEqual(0); expect(priorIndex).toBeLessThan(index); superseded.add(prior);
      }
      const pairs = row.candidates.filter(c => c.source.recordKey === record.key);
      expect(pairs.map(c => c.itemId)).toEqual(row.items.map(i => i.itemId));
      for (const c of pairs) {
        expect(c.sourceText).toBe(value.text); expect(c.source.recordSha256).toBe(record.recordSha256);
        expect(c.sourceText.slice(c.source.start, c.source.end)).toBe(c.value);
        expect(c.displayTitle).toBe(row.items.find(i => i.itemId === c.itemId)!.displayTitle);
      }
    }
    for (const c of row.candidates) expect(c.active).toBe(!superseded.has(c.source.recordKey));
    expect(row.exactAdmitted).toEqual(available.filter(c => c.sourceText === sourceStatement(c)).map(c => c.candidateId));
    for (const name of ["exact", "semantic", "guarded"] as const) {
      const ids = row[`${name}Admitted`], target = row[`${name}Input`];
      expect(new Set(ids).size).toBe(ids.length); expect(target.bindings).toHaveLength(ids.length);
      for (const [i, id] of ids.entries()) {
        const c = available.find(c => c.candidateId === id)!; expect(c).toBeDefined();
        expect(target.bindings[i]).toEqual({ itemId: c.itemId, field: c.field, source: c.source,
          admission: { kind: name === "exact" ? "exact" : "semantic", decisionSha256: target.bindings[i]!.admission.decisionSha256 } });
      }
    }
    // The same captured admissions and decision digests feed both semantic arms.
    // Exact matches are never automatically admitted; unrecognized prose stays.
    const keptIds = row.semanticAdmitted.filter(id => {
      const c = available.find(c => c.candidateId === id)!;
      return inspectRecommendationIdentityV1({ statement: c.sourceText, expected: {
        subject: row.items.find(i => i.itemId === c.itemId)!.displayTitle, field: c.field, value: c.value } }).status !== "exact-mismatch";
    });
    expect(row.guardedAdmitted).toEqual(keptIds);
    const keptBindings = input.bindings.filter((_, i) => keptIds.includes(row.semanticAdmitted[i]!));
    expect(row.guardedInput).toEqual({ ...input, bindings: keptBindings });
    expect(row.allUnknownInput).toEqual({ ...input, bindings: [] });
    admitted += input.bindings.length; retained += keptBindings.length;
    return { caseId: row.caseId, results: Object.fromEntries(arms.map(arm => {
      const result = runRecommendationProgram(row[`${arm}Input`]);
      // Historical implementation digests stay recorded; compare full observable
      // behavior so a compatible future helper can still replay this evidence.
      expect(result.status).toBe("complete"); expect({ status: result.status, items: result.items, text: result.text }).toEqual(row[arm]);
      return [arm, result];
    })) as Record<Arm, RecommendationProgramResult> };
  });
  expect(candidateCount).toBe(76); expect(eligibleCount).toBe(63); expect(admitted).toBe(47); expect(retained).toBe(45);

  // Gold is used only after every admission, veto and output has been replayed.
  // In particular, canonically equivalent Unicode titles remain separate locked
  // identities in this authored fixture; the test does not normalize them.
  // The title mentioned in source prose but absent from the annotated candidate
  // inventory remains unavailable: this is restricted-inventory execution.
  expect(artifact.gold.map(g => g.caseId)).toEqual(artifact.rows.map(r => r.caseId));
  expect(artifact.gold.map(g => g.group)).toEqual([...Array(4).fill("direct"), ...Array(8).fill("paraphrase"), ...Array(8).fill("adversarial")]);
  expect(String(canonicalSha256(artifact.gold))).toBe(artifact.provenance.gold!);
  let unsupportedRemoved = 0, supportedRemoved = 0, semanticCorrectRecommendations = 0, guardedCorrectRecommendations = 0, faithfulConflicts = 0;
  const correctCases: Record<Arm, number> = { exact: 0, semantic: 0, guarded: 0, allUnknown: 0 };
  for (const [i, row] of artifact.rows.entries()) {
    const gold = artifact.gold[i]!, support = new Set(gold.supportingCandidateIds), output = outputs[i]!;
    expect(gold.items.map(g => g.itemId)).toEqual(row.items.map(item => item.itemId));
    for (const id of row.semanticAdmitted.filter(id => !row.guardedAdmitted.includes(id))) {
      if (support.has(id)) supportedRemoved++; else unsupportedRemoved++;
    }
    for (const arm of arms) {
      const result = output.results[arm]; expect(result.items).toHaveLength(gold.items.length);
      const correct = result.items.map((item, index) => { const target = gold.items[index]!;
        const match = item.itemId === target.itemId && item.status === target.status && (item.status !== "recommended"
          || item.fields.title!.value === target.title && item.fields.narrator!.value === target.narrator);
        if (match && item.status === "recommended") {
          if (arm === "semantic") semanticCorrectRecommendations++;
          if (arm === "guarded") guardedCorrectRecommendations++;
        }
        return match;
      });
      if (correct.every(Boolean)) correctCases[arm]++;
    }
    for (const item of output.results.guarded.items) {
      if (item.status === "conflict") {
        faithfulConflicts++;
        const values = new Set(row.candidates.filter(c => c.itemId === item.itemId && c.field === "narrator" && support.has(c.candidateId)).map(c => c.value));
        expect(values.size).toBeGreaterThan(1); expect(item.conflicts).toContain("narrator");
      }
      if (item.status === "recommended") for (const field of ["title", "narrator"] as const) {
        expect(row.candidates.some(c => c.itemId === item.itemId && c.field === field && c.value === item.fields[field]!.value && support.has(c.candidateId))).toBe(true);
      }
    }
  }
  expect(correctCases).toEqual({ exact: 9, semantic: 19, guarded: 20, allUnknown: 5 });
  expect({ unsupportedRemoved, supportedRemoved, semanticCorrectRecommendations, guardedCorrectRecommendations, faithfulConflicts })
    .toEqual({ unsupportedRemoved: 2, supportedRemoved: 0, semanticCorrectRecommendations: 15, guardedCorrectRecommendations: 17, faithfulConflicts: 1 });
  expect(unsupportedRemoved > 0 && supportedRemoved === 0 && guardedCorrectRecommendations >= semanticCorrectRecommendations).toBe(true);
  expect(readFileSync(path)).toEqual(bytes);
});
