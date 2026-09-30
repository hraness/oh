// Lab status: champion, experiments with decisions, cache size and whether a run is live.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { LAB, armKey, champion, readCells } from "./common";
const champ = champion();
console.log(`champion: ${champ.arm.name} (${armKey(champ.arm)})`);
for (const id of readdirSync(`${LAB}/experiments`).sort()) {
  const d = `${LAB}/experiments/${id}`, a = existsSync(`${d}/assessment.json`) ? JSON.parse(readFileSync(`${d}/assessment.json`, "utf8")) : null;
  const ledger = existsSync(`${d}/xcb-ledger.jsonl`) ? statSync(`${d}/xcb-ledger.jsonl`) : null;
  console.log(`${id}: ${a ? `${a.decision} targets ${JSON.stringify(a.targets && { delta: a.targets.delta, ci95: a.targets.ci95, n: a.targets.n })}` : "not assessed"}`
    + (ledger ? ` · ledger updated ${Math.round((Date.now() - ledger.mtimeMs) / 60000)} min ago` : ""));
}
console.log(`cached cells: ${readCells().length}`);
