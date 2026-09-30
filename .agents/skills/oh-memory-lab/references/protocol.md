# Oh memory lab protocol (v1, 2026-09-30)

Modelled on the Sponge research-improvement lab. The goal is a champion that is **measurably and repeatedly** better,
confirmed on fresh questions, before any money is spent on a claim.

## Signal and data
- Reader and judge: Claude Haiku through xcb on the operator's Claude plan (`xcb-claude-haiku-lab-reader`, `xcb-claude-haiku-beam-judge`),
  released BEAM scorer templates. Development signal only. Not comparable with the released GPT-4o scorer or published numbers.
- Dev pool: the exposed Phase 2 BEAM 1M set (35 conversations x 10 categories x 2 questions).
  `screen` = question index 0, `confirm` = question index 1. Plans take the first N conversations, so screens nest.
- Never used: sealed-500k, sealed-run, the unused 500K conversations and the 10M split. They are for paid claims only.
- No question metadata in prompts. Only the system instruction (and later the context source) varies between arms;
  the user message is byte-identical to the registered contracts.

## One cycle
1. **Recover:** read NEXT.md, champion.json, the last experiment's assessment.json and `bun scripts/benchmarks/memory-lab/status.ts`.
2. **Pick one mechanism:** two exploitation experiments per exploration; after three non-improving trials, switch
   mechanism family. Keep up to three alternatives (`alternatives.json`) that were positive but short of the bar.
3. **Investigate:** read losses offline (cached answers in cache/cells.jsonl vs gold), and published methods
   ([research seeds](research-seeds.md)). Mechanisms, never question-specific phrasing or gold text.
4. **Preregister:** experiments/NNN-slug/{PREREG.md, plan.json, instruction file} then `bun scripts/benchmarks/memory-lab/freeze.ts NNN-slug`.
   PREREG states hypothesis, mechanism, predicted effect, targets, guard and call cap. Frozen files never change.
5. **Run:** `scripts/benchmarks/memory-lab/queue.sh NNN-slug` (background). Champion cells are cached and reused; only missing cells run.
   One Claude account means one call at a time (~80 s per cell). Default cap 1,000 xcb calls per experiment.
6. **Assess:** `bun scripts/benchmarks/memory-lab/assess.ts NNN-slug`, then write RESULTS.md (numbers, what moved, failure reading).
7. **Record:** update NEXT.md, champion.json on PROMOTE, alternatives.json on KEEP-AS-ALTERNATIVE, memory.

## Decision rules (frozen; changing them needs a protocol version bump)
Paired challenger minus champion per question, averaged per conversation, 10,000-draw conversation bootstrap.
- **Screen** (pool screen): SCREEN-PASS if target delta >= +0.03, P(delta > 0) >= 0.90 and guard delta >= -0.03.
  KEEP-AS-ALTERNATIVE if delta > 0, P >= 0.75 and guard ok. Otherwise REJECT.
- **Confirm** (pool confirm, fresh questions, run only after SCREEN-PASS): PROMOTE if the target 95% lower bound > 0
  and the guard 95% lower bound > -0.05. Otherwise NOT-CONFIRMED.
- Reader failures are missing (reported); reader truncation scores 0. An incomplete experiment is not assessed.
- The A/A noise run (champion vs itself, replicate 1) calibrates: if A/A would pass a screen, tighten the screen rule
  in protocol v2 before trusting any screen.

## "Definitely hill climbing"
At least two consecutive PROMOTEs, each confirmed on fresh confirm-pool questions, and a champion that beats the
starting champion (v10) on the confirm pool. Then, outside the lab: register the winner as a reader contract (PR),
and run a paid gpt5-mini + GPT-4o check paired against the existing v10 Phase 2 outcomes. Any public claim after that
needs a new preregistered run on never-used questions.
