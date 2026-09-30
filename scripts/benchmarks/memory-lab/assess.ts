// Paired challenger − champion on an experiment's planned questions, with a family (conversation) bootstrap and the
// protocol's frozen decision rule. Writes assessment.json next to the plan. Missing cells are reported, never imputed.
import { readFileSync, writeFileSync } from "node:fs";
import { LAB, type Plan, armKey, cellScore, champion, frozenExperiment, planQuestions, profile, readCells } from "./common";

const id = Bun.argv[2]!, dir = `${LAB}/experiments/${id}`;
const plan = JSON.parse(readFileSync(`${dir}/plan.json`, "utf8")) as Plan;
if (profile.transport === "direct-api" && readFileSync(`${dir}/frozen.sha256`, "utf8").trim()
  !== frozenExperiment(plan, readFileSync(`${dir}/PREREG.md`, "utf8"))) throw new Error("frozen paid experiment changed before assessment");
const champ = champion().arm, cKey = armKey(champ), xKey = armKey(plan.challenger), rep = plan.replicate ?? 0;
const cells = readCells();
const lookup = (key: string, r: number, q: string) => cells.filter(c => c.armKey === key && c.rep === r && c.questionId === q).at(-1);
const questions = planQuestions(plan);
const rows = questions.map(q => {
  const a = lookup(cKey, 0, q.id), b = lookup(xKey, rep, q.id);
  return { id: q.id, family: q.corpusId, category: q.category.replace(/^beam:/u, ""), champion: a && cellScore(a), challenger: b && cellScore(b), ran: !!a && !!b };
});
const pairs = rows.filter(r => r.champion !== undefined && r.challenger !== undefined) as { id: string; family: string; category: string; champion: number; challenger: number }[];
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN;
let seed = 0x5eed; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
function summarize(ps: typeof pairs) {
  if (ps.length === 0) return null;
  const fam = [...new Set(ps.map(p => p.family))], d = new Map(fam.map(f => [f, mean(ps.filter(p => p.family === f).map(p => p.challenger - p.champion))]));
  const boots = Array.from({ length: 10000 }, () => mean(fam.map(() => d.get(fam[Math.floor(rnd() * fam.length)]!)!))).sort((a, b) => a - b);
  const r = (x: number) => +x.toFixed(3);
  return { n: ps.length, families: fam.length, champion: r(mean(ps.map(p => p.champion))), challenger: r(mean(ps.map(p => p.challenger))),
    delta: r(mean([...d.values()])), ci95: [r(boots[249]!), r(boots[9749]!)], pPositive: r(boots.filter(x => x > 0).length / boots.length),
    up: ps.filter(p => p.challenger > p.champion).length, down: ps.filter(p => p.challenger < p.champion).length,
    meanAbsDiff: r(mean(ps.map(p => Math.abs(p.challenger - p.champion)))) };
}
const targets = summarize(pairs.filter(p => plan.targets.categories.includes(p.category)));
const guard = summarize(pairs.filter(p => plan.guard.categories.includes(p.category)));
const complete = rows.every(r => r.ran) && (profile.transport !== "direct-api" || pairs.length === rows.length);
// Frozen decision rules (PROTOCOL.md). Screens earn a confirmation; only a confirmation promotes.
let decision: string;
if (!complete) decision = "INCOMPLETE";
else if (targets === null) decision = "NO-DATA";
else if (plan.pool === "screen") {
  const guardOk = guard === null || guard.delta >= -0.03;
  decision = targets.delta >= 0.03 && targets.pPositive >= 0.9 && guardOk ? "SCREEN-PASS"
    : targets.delta > 0 && targets.pPositive >= 0.75 && guardOk ? "KEEP-AS-ALTERNATIVE" : "REJECT";
} else {
  decision = targets.ci95[0]! > 0 && (guard === null || guard.ci95[0]! > -0.05) ? "PROMOTE" : "NOT-CONFIRMED";
}
if (complete && plan.id.includes("aa-")) decision = "NOISE-MEASURED";
const out = { experiment: plan.id, pool: plan.pool, champion: { name: champ.name, key: cKey }, challenger: { name: plan.challenger.name, key: xKey, rep },
  planned: rows.length, ran: rows.filter(r => r.ran).length, missing: rows.filter(r => r.ran && (r.champion === undefined || r.challenger === undefined)).map(r => r.id),
  targets, guard, perCategory: Object.fromEntries([...new Set(pairs.map(p => p.category))].sort().map(c => [c, summarize(pairs.filter(p => p.category === c))])),
  decision, assessedAt: new Date().toISOString() };
writeFileSync(`${dir}/assessment.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
