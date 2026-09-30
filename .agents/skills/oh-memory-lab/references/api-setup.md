# Direct API setup

Use this route only with explicit user-selected credentials and a combined dollar,
call and time limit. Keep the lab outside the repository and its cache directory
private (mode 0700). Copy `assets/profile.api.example.json` and resolve every input
path after checking the handoff's hashes and exposure record. Keep protected inputs
closed. An absent handoff permits qualification on invented controls only.

The initial configuration uses Gemini 3.8 Flash as reader and Grok 4.7 with low
reasoning effort as judge. Gemini uses low thinking. Both have a fixed output
limit; thinking tokens count toward the cost estimate and output limit. This is a
development treatment with an independent provider judge, not the released GPT-4o
evaluation. Model names may resolve to changing weights; retain reported identity
and qualification date. Requalify after changing model or settings.

Keep keys in `VERTEX_API_KEY` (or `GEMINI_API_KEY`) and `XAI_API_KEY`; profiles and
request captures contain no key values. The native transport calls the selected
provider directly with no fallback, tools or automatic retries.
The xAI route uses `/v1/responses` with `max_output_tokens`, which bounds both
visible and reasoning tokens. Its usage may report those token counts separately;
charge both and check the total. Do not substitute Chat Completions' visible-only
token cap for this bound ([official schema](https://docs.x.ai/openapi.json)).

Create `budget.json` with the user's actual limits, for example:

```json
{
  "protocol": "oh.memory-lab-api-budget.v1",
  "maxUsd": 5,
  "maxCalls": 80,
  "expiresAt": "REPLACE_WITH_AN_EXPLICIT_UTC_DEADLINE",
  "ledgerPath": "/absolute/private/lab/cache/api-ledger.jsonl"
}
```

Qualification, readers and judges all use this one ledger. A lock serializes
campaign access. Each request is reserved and synced before dispatch. Usage includes
thinking tokens and ignores cache/free-tier discounts. Charge the larger of the
token-rate estimate and a provider-reported cost when available; this ledger is
conservative accounting, with the raw provider receipts retained separately. Unknown outcomes
retain their complete reservation and stop work. Inspect and reconcile the saved
request/response before further work; never remove an active lock or replay an
uncertain call. Each invocation also has a 60-minute ceiling.
An acknowledged pre-generation request rejection stops the run and keeps the full
reservation charged, with billing explicitly unverified. Repair the request in a
fresh preregistered experiment; do not treat the rejection as successful inference.

Rates checked on 2026-09-30: Gemini 3.8 Flash $0.75 input / $3.75 output per million
tokens through 2026-12-31 ([pricing](https://ai.google.dev/gemini-api/docs/pricing));
Grok 4.7 $2 input / $6 output per million tokens
([models](https://docs.x.ai/developers/models)), doubled for inputs above 200K tokens.
The adapter refuses work after these Gemini rates expire; update and verify rates
before any later campaign.

Freeze an API experiment with the ordinary `freeze.ts` command. Its digest includes
the profile, budget, both instructions, champion record, dataset, context files,
scorer templates and transport source. API cache identities include those input and
model settings. Leave subscription V1 plans unchanged. Use fresh output directories
and compute the complete reader/judge call matrix before dispatch.
