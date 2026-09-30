---
name: oh-memory-lab
description: Improve Oh's memory reader with subscription or explicitly budgeted Gemini/xAI development experiments, frozen preregistrations and separate confirmation. Update public results only after a notable, statistically supported comparison.
---

# Oh memory lab

Run one-mechanism experiments against a champion reader, screen them on the development pool and promote only after a
fresh confirmation. Use the configured reader and judge on released BEAM scorer templates. Development scores guide
experiments; comparisons with published numbers require a separately qualified, matched evaluation.

Read [the protocol](references/protocol.md) before the first cycle and [the research seeds](references/research-seeds.md)
when choosing a mechanism.

## Workspace

The lab workspace is private and lives outside this repository. Point `OH_MEMORY_LAB` at it:

```text
$OH_MEMORY_LAB/
  profile.json          subscription or direct-API profile with verified local input paths
  budget.json           explicit combined API dollar/call/time limits, when using direct APIs
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
bun scripts/benchmarks/memory-lab/qualify-api.ts  # invented controls; direct-API setup only
```

The reader profile `xcb-claude-haiku-lab-reader` takes its system instruction from the experiment; the user message is
byte-identical to the registered contracts, so no question metadata enters the prompt. Do not switch the checkout the
lab imports from while a run is live.

For Gemini/xAI, read [the API setup](references/api-setup.md). Use the user's explicit combined spending cap,
one shared ledger for qualification/readers/judges, fixed model settings and fresh qualification. Keep credentials in
environment variables. Resolve development inputs and exposure evidence before dispatch; missing inputs never authorize
opening a sealed set. Do not reuse subscription cells in an API experiment.

## Publish notable results

When fresh confirmation meets a preregistered notable-result threshold and establishes statistically supported
superiority or noninferiority to an explicitly named, relevant external comparison target, update `README.md`,
the marketing site in `site/`, and the relevant `docs/` and `benchmarks/` pages in the same reviewed
change. Require a preregistered effect threshold or noninferiority margin, a sample-size rationale, fresh confirmation,
matched comparison conditions, appropriate uncertainty/multiple-comparison analysis, retained failures and independent
review. State the model, sample, date, protocol and main limit beside the result, and link the reproducible evidence.
Follow `STYLE.md`'s benchmark-results rule. Local baseline improvements, routine screen gains, a small pilot or a champion promotion alone do not
trigger marketing updates. Keep those results in the lab notebook until this evidence threshold is met.

## Guardrails

- Freeze plan, preregistration and instruction bytes before any call; never edit a frozen experiment.
- Sealed holdouts, unused BEAM families and the 10M split stay unread; they are for paid, separately preregistered claims.
- Winners become registered reader contracts through a normal PR before any paid Gateway confirmation.
