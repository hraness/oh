import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { makeEvolutionExperimentContextPlan } from "../scripts/benchmarks/evolution-plan";
import { loadMem0SelectedCorpusFromFullHistoryContext, validateMem0SelectedCorpus } from "../scripts/benchmarks/mem0-parent";
import { parseMem0QualificationArgs, prepareMem0OneCorpusQualification } from "../scripts/benchmarks/mem0-qualification";
const h = (v: string) => sha256Hex(v);
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "mem0-qualification-test-")));
  const dataset: Dataset = { corpora: [{ id: "synthetic-source", groupId: "synthetic-group", turns: [
    { id: "s:0", sessionId: "s", sessionIndex: 0, date: "2024-01-01", speaker: "user", text: "日本語 🌟 ".repeat(700) },
    { id: "s:1", sessionId: "s", sessionIndex: 0, date: "2024-01-02", speaker: "assistant", text: "Second source." },
  ] }], questions: [{ id: "synthetic-question", corpusId: "synthetic-source", category: "synthetic", question: "Which source?", questionDate: "2024-01-03", answer: "synthetic test answer", unanswerable: false, evidenceTurnIds: ["s:0"], evidenceSessionIds: ["s"] }] };
  const selected = projectEvolutionRunnerInput(dataset), variants = [{ id: "full-history", system: "full-history" }] as const;
  const pin = async (name: string, value: unknown) => { const path = join(directory, name), bytes = Buffer.from(JSON.stringify(value)); await writeFile(path, bytes, { mode: 0o600 }); return { path, sha256: sha256Hex(bytes) }; };
  const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: DATASETS["longmemeval-s"].revision, sourceSha256: DATASETS["longmemeval-s"].sha256, groups: [{ groupId: "synthetic-group", partition: "development", exposure: "development", evidence: "Synthetic test fixture." }] });
  const manifestPin = await pin("manifest.json", manifest);
  const built = await makeEvolutionExperimentContextPlan({ dataset: selected, variants, manifestSha256: manifestPin.sha256, retrievalSourceSha256: h("synthetic-runtime") });
  const plan = built.plan, source = { protocol: "oh.memory.selected-source-corpora.v1-private", inputSha256: canonicalSha256(selected), corpora: selected.corpora.map(c => ({ id: c.id, groupId: c.id, turns: c.turns })) };
  const config = { protocol: "oh.memory.evolution-run.v3", dataset: "longmemeval-s", datasetPin: { path: join(directory, "RAW-DATASET-MUST-NOT-BE-OPENED"), sha256: DATASETS["longmemeval-s"].sha256 }, manifestPin,
    campaignPin: { path: join(directory, "CAMPAIGN-MUST-NOT-BE-OPENED"), sha256: h("campaign") }, limit: 1, seed: 17, variants, readers: ["gpt5-nano-reader"], judge: "gpt4o-gateway-judge", directory: join(directory, "unused-run"), storeDirectory: join(directory, "unused-store"), concurrency: 1 };
  const args = { config: await pin("config.json", config), contextPlan: await pin("context.json", plan), sourceCorpora: await pin("source.json", source), questionId: selected.questions[0]!.id, output: join(directory, "receipt.json") };
  return { directory, dataset, selected, manifest, plan, source, config, args, pin };
}
test("one-corpus preparation authenticates source membership without opening raw dataset or campaign", async () => {
  const f = await fixture(); try {
    const receipt = await prepareMem0OneCorpusQualification(f.args);
    expect(receipt).toMatchObject({ status: "prepared-no-dispatch", physicalCalls: 0, sourceReceiptSha256: f.args.contextPlan.sha256 });
    const parts = receipt.corpus.chunks.flatMap(chunk => chunk.turns);
    expect(new Set(parts.map(part => part.sourceTurnId)).size).toBe(2);
    expect(parts.filter(part => part.sourceTurnId === h("turn:s:0")).map(part => part.text).join("")).toBe(f.dataset.corpora[0]!.turns[0]!.text);
    expect(receipt.corpus.chunks.every(chunk => chunk.turns.reduce((sum, part) => sum + Buffer.byteLength(`[${part.date}] ${part.text}`), 0) <= 4096)).toBe(true);
    expect(validateMem0SelectedCorpus(receipt.corpus)).toEqual(receipt.corpus);
    expect(JSON.parse(await readFile(f.args.output, "utf8"))).toMatchObject({ receiptSha256: receipt.receiptSha256, physicalCalls: 0 });
    await expect(prepareMem0OneCorpusQualification(f.args)).rejects.toThrow("EEXIST");
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test("qualification rejects source drift, closed membership, and config/plan mismatch", async () => {
  const f = await fixture(); try {
    const changedSource: any = structuredClone(f.source); changedSource.corpora[0].turns[0].text += "changed";
    await expect(prepareMem0OneCorpusQualification({ ...f.args, sourceCorpora: await f.pin("bad-source.json", changedSource) })).rejects.toThrow("source projection");
    const closed = structuredClone(f.manifest); (closed.questions[0] as any).partition = "closed";
    const manifestPin = await f.pin("closed-manifest.json", closed), config = await f.pin("closed-config.json", { ...f.config, manifestPin });
    const { planSha256: _old, ...payload } = { ...f.plan, manifestSha256: manifestPin.sha256 };
    const contextPlan = await f.pin("closed-plan.json", { ...payload, planSha256: canonicalSha256(payload) });
    await expect(prepareMem0OneCorpusQualification({ ...f.args, config, contextPlan })).rejects.toThrow("Coverage");
    await expect(prepareMem0OneCorpusQualification({ ...f.args, config: await f.pin("bad-config.json", { ...f.config, variants: [{ id: "other", system: "full-history" }] }) })).rejects.toThrow("configuration");
    const foreign = `q-${h("foreign")}`; await expect(prepareMem0OneCorpusQualification({ ...f.args, questionId: foreign })).rejects.toThrow("not selected");
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test("qualification requires exact pins and a complete full-history case", async () => {
  const f = await fixture(); try {
    const changed: any = structuredClone(f.plan); changed.cases[0].result.omittedForBudget = 1;
    expect(() => loadMem0SelectedCorpusFromFullHistoryContext({ contextPlan: changed, questionId: f.args.questionId, sourceReceiptSha256: h("pinned") })).toThrow("unqualified");
    const good = ["--config", f.args.config.path, "--config-sha256", f.args.config.sha256, "--context-plan", f.args.contextPlan.path, "--context-plan-sha256", f.args.contextPlan.sha256, "--source-corpora", f.args.sourceCorpora.path, "--source-corpora-sha256", f.args.sourceCorpora.sha256, "--question-id", f.args.questionId, "--output", f.args.output];
    expect(parseMem0QualificationArgs(good)).toEqual(f.args); good[14] = "--unknown"; expect(() => parseMem0QualificationArgs(good)).toThrow("unknown");
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
