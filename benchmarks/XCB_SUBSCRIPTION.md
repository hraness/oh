# Subscription screening through xcb

`scripts/benchmarks/xcb-subscription.ts` sends benchmark reader and judge prompts through `xcb --json generate`. Calls run on your own AI subscription accounts instead of the paid Vercel AI Gateway. Use it for cheap development screens with small models. Its scores cannot be compared with the released scorer or with Gateway runs.

## When to use it

- Use it to screen a development idea on a few hundred questions before you spend Gateway budget.
- Don't use it for a released result, a confirmation, a sealed holdout, or any number you compare with a Gateway run. A different model, prompt wrapper and transport change the scores.
- It is for personal use only, on accounts you own. Each call uses your plan's allowance, and plan usage limits apply. When an account reports it is busy or out of capacity, the run slows down or stops. It does not fall back to paid calls.

## Profiles

| Profile | Model | Replaces |
| --- | --- | --- |
| `xcb-claude-haiku-task-complete-v10` | `claude/haiku` | the `gpt5-mini-task-complete-long-deadline-v10-reader` reader |
| `xcb-claude-haiku-beam-judge` | `claude/haiku` | the three BEAM judge profiles (extraction, equivalence, nugget) |

The Gateway profiles are unchanged and remain the default. Subscription profiles live in their own catalog, `XCB_SUBSCRIPTION_PROFILES`. Each one carries `comparability.releasedScorerComparable: false`, and every result repeats that label under `identity`. The reader profile accepts only the exact task-complete v10 system instruction.

xcb takes one prompt string. A single user message is sent as-is. A system and user pair is sent as `<system>…</system>` followed by `<user>…</user>`.

## Select the transport in a driver

`transport.invoke` returns the same `{ request, result, counted }` shape as the Gateway call in `score.ts`, so a driver switches on the profile id:

```ts
import { XcbSubscriptionTransport, isXcbSubscriptionProfileId } from "./xcb-subscription";

const xcb = await XcbSubscriptionTransport.open({
  ledgerPath: "/absolute/path/to/run/xcb-ledger.jsonl",
  profiles: ["xcb-claude-haiku-task-complete-v10", "xcb-claude-haiku-beam-judge"],
  maxCalls: 400,
});
const call = (profile, messages) => isXcbSubscriptionProfileId(profile)
  ? xcb.invoke(profile, messages)
  : gatewayCall(profile, messages);
```

- `bin` defaults to `XCB_BIN`, then `xcb` on `PATH`.
- `open` reads `xcb --json generate --capabilities`. It uses only accounts that report `available: true` with a recorded qualification, and it fails when no account serves a requested profile. Pass `accounts` to restrict the pool.
- Run at most `xcb.concurrency` workers. Each account runs one call at a time, and accounts take turns.
- `maxCalls` caps xcb processes per run, retries included. Reaching it stops the run.
- Check `xcb.halted` between questions. It is set when a run must stop.

## Failures

| xcb code | What happens |
| --- | --- |
| `busy`, `deadline`, `provider_error`, `unavailable` | Retried on the next free account, with backoff from 2 s doubling to 60 s, up to 6 attempts. Then the call fails. |
| `output_limit` | A reader result becomes `truncated` with `output-token-limit`. It is never retried. |
| `invalid_request` | The call fails immediately. |
| `custody_unproven`, `cancelled`, unreadable output, or no exit after the deadline | The run stops and the account is held. Check xcb before starting again. |

The transport never force-kills xcb. When a call outlasts its deadline by two minutes, it sends one polite stop and waits.

## Ledger and resume

Every attempt appends one line to the ledger, with owner-only permissions. A line records the request hash, profile, account id, model, runtime digest, prompt hash and size, output size, latency, status and code. A completed line also stores the answer text. The ledger holds no credentials, and xcb's error output is discarded.

Reopening a run with the same ledger replays completed answers, truncations and local rejections without new calls. Only unanswered requests are sent again.

## Live smoke

With a qualified account, one call checks the route:

```sh
bun -e 'import { XcbSubscriptionTransport } from "./scripts/benchmarks/xcb-subscription";
const t = await XcbSubscriptionTransport.open({ ledgerPath: "/tmp/xcb-smoke.jsonl", profiles: ["xcb-claude-haiku-beam-judge"], maxCalls: 1 });
console.log((await t.invoke("xcb-claude-haiku-beam-judge", [{ role: "user", content: "Reply with OK." }])).result);'
```

`tests/memory-benchmark-xcb-subscription.test.ts` covers the same paths against a stub xcb.
