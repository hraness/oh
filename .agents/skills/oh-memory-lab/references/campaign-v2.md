# Direct-API campaigns (v2)

Use `bun run bench:memory-campaign --help` for a finite campaign. A private workspace
contains `campaign.json`, immutable run plans, stage intents and captured replies.
The existing API transport owns dispatch, credentials and the shared spending
ledger. Frozen v1 pilots keep their original files and interpretation. The API
budget version is separate: an explicit [v2 API budget](api-setup.md) can cover
multiple campaigns, while each campaign keeps its 1,000-call allocation limit.

## Prepare and run

1. Freeze an explicit combined dollar/call/deadline authority. If the user increases
   a budget, create a new authority pointing at the same ledger, including prior
   charges. Never edit an authority pinned by an earlier pilot or reset its ledger.
2. Prepare exposed development inputs as separate hashed files with question,
   question date, context, rubric and `controlAnswer: null`. Register whole
   conversation families in disjoint `screen` and `confirmation` pools. Invented
   controls use separate clusters and explicit expected scores. Gold is projected
   only into the judge request. Protected datasets stay closed.
3. `source-pins` records the execution import closure and package/lockfile bytes.
   `init WORKSPACE FILE` accepts `{config, baseline: {id, instruction}}`. The exact
   schema is `CampaignConfig` in `campaign-contract-v2.ts`. Set `evidenceMode` to
   `live`; synthetic evidence is permanently marked and cannot become a live win.
4. `propose WORKSPACE FILE` queues one mechanism with its immutable instruction,
   parent revision/key, author, hypothesis, research evidence and disconfirming
   test. Keep up to three mechanism-diverse active candidates. After three failed
   quality experiments, propose a new exploratory mechanism.
5. `plan`, `review`, `run`, `assess`, then `advance` process invented grader controls,
   identical-treatment A/A, candidate screens and fresh confirmations, in order.
   Each launch review names an independent reviewer and the exact plan digest.
   A screen cannot change the champion. Failed and incomplete plans retain their
   full planned denominator and spending.

Run `status WORKSPACE` to recover the next action. `run` resumes captured stages
without dispatching them again. A missing or uncertain native outcome stops work;
reconcile it instead of retrying. `recover-locks` releases only this campaign's
provably dead owner after every native effect is settled. Never remove live locks.
`assess` verifies retained provider responses offline and cannot accept injected
live observations. Do not change pinned source while a campaign is active.

## Analysis and resource limits

Both arms execute contemporaneously in alternating order. Qualification needs at
least two positive and two negative grader controls, followed by A/A with distinct
calls and a preregistered variation ceiling. Screens need at least three independent
target and guard clusters. The exact sign test operates on cluster differences;
criteria within a question do not increase sample size.
The sign test concerns positive versus negative cluster differences after ties
are excluded. Its result alone does not establish a population mean improvement.

Confirmation attempt k spends alpha `0.05 / 2^k` and permanently allocates unused
development clusters. Target and guard each need at least
`max(6, ceil(-log2(alpha)))` clusters. This is an attainability floor, not a power
calculation; record a sample-size rationale and retain ties. Confirmation preserves
the screened category family, requires the minimum mean target effect and sign-test
threshold, and checks both the observed mean guard and an exact lower confidence
bound for the **cluster median** guard. This is not mean noninferiority or evidence
for a public comparison. Decisions use unrounded values.

Every plan includes all reader calls and its maximum judge calls. Campaign plan
allocations cannot exceed the frozen call cap; every API reservation also checks
remaining dollars, calls and expiry. All proposals using models must go through
that same authority. Offline human/agent-authored proposals make no extra provider
calls. Serial dispatch lets parallel research workers propose without competing
for the ledger or changing an active baseline.

Retain the original baseline and every promotion. Two confirmed gains are an
empirical milestone only after actual live runs; also preregister a fresh direct
comparison with the original baseline before claiming accumulated improvement.
The [public-result threshold](protocol.md#public-result-updates) still applies.
