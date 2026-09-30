#!/bin/zsh
# Run frozen experiments in order, assessing each. Usage: OH_MEMORY_LAB=... queue.sh 002-aa-noise 003-...
here=${0:A:h}
cd "${OH_MEMORY_LAB:?set OH_MEMORY_LAB}"
for e in "$@"; do
  bun "$here/run.ts" "$e" >> "experiments/$e/run.log" 2>&1 && bun "$here/assess.ts" "$e" > "experiments/$e/assess.log" 2>&1
  echo "$e $(python3 -c "import json;print(json.load(open('experiments/$e/assessment.json'))['decision'])" 2>/dev/null || echo run-failed)"
done
