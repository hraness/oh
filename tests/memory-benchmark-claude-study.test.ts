import { expect, test } from "bun:test";
import { executeClaudeJobs, type ClaudeJobHooks } from "../scripts/benchmarks/claude-study";
import { claudeRequestSha256, CLAUDE_SUBSCRIPTION_PROFILE, type ClaudeInvocation, type ClaudeRequest } from "../scripts/benchmarks/claude-subscription";
import type { ClaudeStudyLookup } from "../scripts/benchmarks/claude-study-store";
const request: ClaudeRequest = { model: "claude-opus-5", effort: "low", prompt: "Synthetic prompt", systemPrompt: "Synthetic system", maximumOutputTokens: 16, timeoutMs: 1000 };
const requestSha256 = claudeRequestSha256(request);
const jobs = ["a", "b", "c"].map(key => ({ key, requestSha256, request }));
const invocation: ClaudeInvocation = { protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256,
  status: "completed", exitCode: 0, timedOut: false, outputBoundExceeded: false,
  stdout: {bytes:1,sha256:"0".repeat(64)},stderr:{bytes:0,sha256:"1".repeat(64)},completion:null };
function setup(prior: Record<string, ClaudeStudyLookup> = {}) {
  const events: string[] = [];
  const hooks: ClaudeJobHooks = {
    store: {
      lookup: async key => { events.push(`lookup:${key}`); return prior[key] ?? {state:"missing"}; },
      begin: async key => { events.push(`begin:${key}`); return {stdoutPath:`/${key}`,stderrPath:`/${key}.err`}; },
      complete: async key => { events.push(`persist:${key}`); },
    },
    invoke: async paths => { events.push(`invoke:${paths.stdoutPath}`); return invocation; },
    capacity: async job => { events.push(`capacity:${job.key}`); },
    admission: () => true,
    progress: () => {},
  };
  const complete = (job: typeof jobs[number]) => { events.push(`semantic:${job.key}`); return job.key; };
  return {hooks,events,complete};
}
test("checkpoints transport and billing evidence before interpreting any answer", async () => {
  const s=setup();
  const result=await executeClaudeJobs(jobs,s.complete,s.hooks);
  expect(result).toEqual({status:"completed",rows:["a","b","c"],cached:0,invoked:3});
  expect(s.events.slice(0,6)).toEqual(["lookup:a","begin:a","invoke:/a","persist:a","capacity:a","semantic:a"]);
});
test("budget pause still replays cached work without a new invocation", async () => {
  const s=setup({a:{state:"completed",invocation}});
  const result=await executeClaudeJobs(jobs,s.complete,{...s.hooks,admission:()=>false});
  expect(result).toEqual({status:"paused",rows:["a"],cached:1,invoked:0});
  expect(s.events).toEqual(["lookup:a","capacity:a","semantic:a","lookup:b"]);
});
test("a saved success with absent capacity proof never becomes an accepted cached answer", async () => {
  const s=setup({a:{state:"completed",invocation}});
  await expect(executeClaudeJobs(jobs,s.complete,{...s.hooks,capacity:async()=>{throw new Error("synthetic capacity failure");}})).rejects.toThrow();
  expect(s.events).toEqual(["lookup:a"]);
});
test("incomplete evidence blocks redispatch and all later jobs", async () => {
  for (const prior of [{state:"incomplete",reason:"pending"}, {state:"incomplete",reason:"transport",invocation}] as const) {
    const s=setup({a:prior});
    await expect(executeClaudeJobs(jobs,s.complete,s.hooks)).rejects.toThrow();
    expect(s.events).toEqual(["lookup:a"]);
  }
});
test("semantic failure retains the original completion without retrying or starting a later job", async () => {
  const s=setup();
  await expect(executeClaudeJobs(jobs,()=>{throw new Error("invalid JSON");},s.hooks)).rejects.toThrow("invalid JSON");
  expect(s.events).toEqual(["lookup:a","begin:a","invoke:/a","persist:a","capacity:a"]);
});
test("transport custody failure does not invent a result or dispatch a second request", async () => {
  const s=setup();
  await expect(executeClaudeJobs(jobs,s.complete,{...s.hooks,invoke:async()=>{throw new Error("capture failure");}})).rejects.toThrow("capture failure");
  expect(s.events).toEqual(["lookup:a","begin:a"]);
});
test("persistence failure prevents semantic interpretation and the next admission", async () => {
  const s=setup();
  await expect(executeClaudeJobs(jobs,s.complete,{...s.hooks,store:{...s.hooks.store,complete:async()=>{throw new Error("disk full");}}})).rejects.toThrow("disk full");
  expect(s.events).toEqual(["lookup:a","begin:a","invoke:/a"]);
});

test("capacity headroom pause closes a successful batch before the next new admission", async () => {
  const s=setup();let paused=false;
  const result=await executeClaudeJobs(jobs,s.complete,{...s.hooks,admission:()=>!paused,capacity:async(_job,_invocation,cached)=>{expect(cached).toBe(false);paused=true;}});
  expect(result).toEqual({status:"paused",rows:["a"],cached:0,invoked:1});
  expect(s.events).toEqual(["lookup:a","begin:a","invoke:/a","persist:a","semantic:a","lookup:b"]);
});
