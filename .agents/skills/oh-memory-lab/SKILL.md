---
name: oh-memory-lab
description: Hill-climb Oh's memory reader with free Claude-plan (xcb Haiku) screens on an exposed BEAM development set, frozen preregistrations and a separate confirmation pool. Use to run or resume Oh memory improvement experiments; not to make benchmark claims.
---

# Oh memory lab

Run one-mechanism experiments against a champion reader, screen them on the development pool and promote only after a
fresh confirmation. Development scores come from a Haiku reader and a Haiku judge on released BEAM scorer templates;
they guide experiments and are never comparable with the released GPT-4o scorer or published numbers.

Read [the protocol](references/protocol.md) before the first cycle and [the research seeds](references/research-seeds.md)
when choosing a mechanism.

## Workspace

The lab workspace is private and lives outside this repository. Point `OH_MEMORY_LAB` at it:

```text
$OH_MEMORY_LAB/
  profile.json          copy of assets/profile.example.json with real paths and the qualified xcb binary
  champion.json         {"arm": {name, instructionFile, context}, "history": [...]}
  alternatives.json     up to three positive-but-short arms
  NEXT.md               where the next cycle starts
  instructions/         reader instruction files (export registered ones with export-instruction.ts)
  experiments/NNN-slug/ PREREG.md, plan.json, frozen.sha256, run.log, xcb-ledger.jsonl, assessment.json, RESULTS.md
  cache/cells.jsonl     every scored cell, keyed by arm identity; champion cells are reused across experiments
```

## Commands

Run from the repository root with `OH_MEMORY_LAB` set:

```sh
bun scripts/benchmarks/memory-lab/export-instruction.ts task-complete-v10 v10
bun scripts/benchmarks/memory-lab/freeze.ts 004-slug
scripts/benchmarks/memory-lab/queue.sh 004-slug 005-slug   # background; serial on one Claude account
bun scripts/benchmarks/memory-lab/assess.ts 004-slug
bun scripts/benchmarks/memory-lab/status.ts
```

The reader profile `xcb-claude-haiku-lab-reader` takes its system instruction from the experiment; the user message is
byte-identical to the registered contracts, so no question metadata enters the prompt. Do not switch the checkout the
lab imports from while a run is live.

## Guardrails

- Freeze plan, preregistration and instruction bytes before any call; never edit a frozen experiment.
- Sealed holdouts, unused BEAM families and the 10M split stay unread; they are for paid, separately preregistered claims.
- Winners become registered reader contracts through a normal PR before any paid Gateway confirmation.
