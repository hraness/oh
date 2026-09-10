import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeMem0ExperimentDateBinding, startMem0Worker, validateMem0SelectedCorpus, type createMem0RpcDispatcher } from "../scripts/benchmarks/mem0-parent";

test("experiment date binds one valid calendar date in an explicit versioned descriptor", () => {
  for (const date of ["0001-01-01", "2000-02-29", "2024-02-29", "2026-09-09", "9999-12-31"]) {
    const binding = makeMem0ExperimentDateBinding(date), { bindingSha256, ...payload } = binding;
    expect(binding).toMatchObject({ protocol: "oh.memory.mem0-experiment-date.v1", experimentDate: date,
      seam: "mem0.memory.main.generate_additive_extraction_prompt", explicitDates: "preserved" });
    expect(bindingSha256).toBe(canonicalSha256(payload)); expect(Object.isFrozen(binding)).toBe(true);
  }
  for (const date of [undefined, null, 20260909, "", "0000-01-01", "1900-02-29", "2026-02-29", "2026-02-30", "2026-13-01", "2026-01-00", "2026-9-9", "2026-09-09Z", "2026-09-09\n", "２０２６-09-09"])
    expect(() => makeMem0ExperimentDateBinding(date)).toThrow("valid YYYY-MM-DD");
});

function fixtureCorpus() {
  const turns = [{ turnId: sha256Hex("part"), sourceTurnId: sha256Hex("turn"), sourceTurnSha256: sha256Hex("alpha"), sessionId: sha256Hex("session"), date: "2024-01-01", role: "user", text: "alpha", utf8Start: 0, utf8End: 5, sourceUtf8Bytes: 5 }];
  const chunks = [{ chunkId: sha256Hex("chunk"), sourceSha256: canonicalSha256(turns), turns }];
  return validateMem0SelectedCorpus({ protocol: "oh.memory.mem0-selected-corpus.v1", dataset: "longmemeval-s", partition: "development", corpusId: sha256Hex("corpus"), corpusSha256: canonicalSha256(chunks.map(({ chunkId, sourceSha256 }) => ({ chunkId, sourceSha256 }))), chunks, sourceReceiptSha256: sha256Hex("receipt") });
}

test("worker clock is explicitly conveyed while the unset environment and returned shape stay unchanged", async () => {
  const corpus = fixtureCorpus(), ambient = process.env.MEM0_EXPERIMENT_DATE;
  process.env.MEM0_EXPERIMENT_DATE = "1980-01-01";
  try {
    for (const experimentDate of [undefined, "2026-09-09"]) {
      let closed = false;
      const dispatcher = { derivation: { corpusSha256: corpus.corpusSha256, namespace: sha256Hex("namespace") }, embeddingDimensions: 3, maximumCallTimeoutMs: 1000,
        abort() {}, async close() { closed = true; } } as unknown as ReturnType<typeof createMem0RpcDispatcher>;
      const code = `const rl=require('node:readline').createInterface({input:process.stdin}); rl.on('line',line=>{const c=JSON.parse(line);console.log(JSON.stringify({kind:'result',id:c.id,ok:true,result:{experimentDate:process.env.MEM0_EXPERIMENT_DATE??null}}));if(c.kind==='close')rl.close();});`;
      const worker = await startMem0Worker({ command: [process.execPath, "-e", code], workerDirectory: "/tmp", mem0Directory: "/tmp", dispatcher, corpus,
        ...(experimentDate === undefined ? {} : { experimentDate }) });
      try {
        expect(await worker.prepare()).toEqual({ experimentDate: experimentDate ?? null });
        expect(Object.hasOwn(worker, "experimentDateBinding")).toBe(experimentDate !== undefined);
        if (experimentDate !== undefined) expect(worker.experimentDateBinding).toEqual(makeMem0ExperimentDateBinding(experimentDate));
      } finally { await worker.close(); }
      expect(closed).toBe(true);
    }
  } finally { if (ambient === undefined) delete process.env.MEM0_EXPERIMENT_DATE; else process.env.MEM0_EXPERIMENT_DATE = ambient; }
}, 5000);

test("Python prompt seam binds only absent dates and rejects incompatible SDK signatures", () => {
  // Load only the pure definitions, keeping this portable test independent of
  // the optional Mem0 installation and its import-time telemetry.
  const script = `import ast, inspect, re
from datetime import date
from functools import wraps
from typing import Any, Optional
from pathlib import Path
source=Path('scripts/benchmarks/mem0-bridge/mem0_bridge_worker.py').read_text()
tree=ast.parse(source)
names={'BridgeError','_experiment_date','_bind_experiment_date'}
selected=[node for node in tree.body if isinstance(node,(ast.ClassDef,ast.FunctionDef)) and node.name in names]
assert len(selected)==3
exec(compile(ast.Module(body=selected,type_ignores=[]),'worker-date-seam','exec'))
today='2026-09-09'
def original(source, *, current_date=None, timestamp=None):
    current_date=today if current_date is None else current_date
    return source,current_date,current_date if timestamp is None else timestamp
assert _bind_experiment_date(original,None) is original
bound=_bind_experiment_date(original,'2026-09-09')
before=bound('synthetic')
today='2026-09-10'
assert original('synthetic')==('synthetic','2026-09-10','2026-09-10')
assert bound('synthetic')==before==('synthetic','2026-09-09','2026-09-09')
assert bound('synthetic',current_date='2024-02-29')==('synthetic','2024-02-29','2024-02-29')
assert bound('synthetic',timestamp='2020-01-02')==('synthetic','2026-09-09','2020-01-02')
assert bound('synthetic',current_date='2024-02-29',timestamp='2020-01-02')==('synthetic','2024-02-29','2020-01-02')
assert bound('synthetic',current_date=None,timestamp=None)==before
for value in ['0001-01-01','2000-02-29','2024-02-29','2026-09-09','9999-12-31']:
    assert _experiment_date(value)==value
for value in ['',0,False,'0000-01-01','1900-02-29','2026-02-29','2026-02-30','2026-13-01','2026-01-00','2026-9-9','2026-09-09Z','2026-09-09\\n','２０２６-09-09']:
    try: _experiment_date(value)
    except BridgeError: pass
    else: raise AssertionError('invalid date admitted')
for fn in [lambda source:source,lambda source,current_date=None,timestamp=None:source,lambda source,*,current_date='today',timestamp=None:source]:
    try: _bind_experiment_date(fn,'2026-09-09')
    except BridgeError: pass
    else: raise AssertionError('incompatible seam admitted')
print('prompt seam passed')`;
  const result = Bun.spawnSync(["python3", "-B", "-c", script], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe", timeout: 10_000,
    env: { PATH: process.env.PATH ?? "" } });
  expect(result.exitCode).toBe(0); expect(result.stderr.toString()).toBe(""); expect(result.stdout.toString().trim()).toBe("prompt seam passed");
});
