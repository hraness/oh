// Write a registered reader contract's instruction bytes into instructions/<name>.txt in the lab workspace.
import { writeFileSync } from "node:fs";
import { EVOLUTION_READER_CONTRACTS } from "../evolution-reader-contracts";
import { LAB } from "./common";
const [contract, name] = Bun.argv.slice(2);
const entry = (EVOLUTION_READER_CONTRACTS as Record<string, { instruction: string } | undefined>)[contract ?? ""];
if (!entry || !name) throw new Error("usage: export-instruction.ts <registered contract id> <name>");
writeFileSync(`${LAB}/instructions/${name}.txt`, entry.instruction, { flag: "wx" });
