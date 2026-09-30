// Freeze an experiment before any model call: hash of plan.json, PREREG.md and the challenger instruction bytes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { LAB, type Plan, instruction, planQuestions, sha } from "./common";
const dir = `${LAB}/experiments/${Bun.argv[2]}`;
if (existsSync(`${dir}/frozen.sha256`)) throw new Error("already frozen; make a new experiment instead of editing this one");
const plan = JSON.parse(readFileSync(`${dir}/plan.json`, "utf8")) as Plan;
const digest = sha(readFileSync(`${dir}/plan.json`, "utf8") + readFileSync(`${dir}/PREREG.md`, "utf8") + instruction(plan.challenger));
writeFileSync(`${dir}/frozen.sha256`, digest + "\n", { flag: "wx" });
console.log(JSON.stringify({ frozen: digest, questions: planQuestions(plan).length }));
