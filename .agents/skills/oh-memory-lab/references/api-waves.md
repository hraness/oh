# Concurrent API requests

`ApiLabWaveTransport` sends a finite group of up to four independent requests at
once. One process holds the shared spending-ledger lock for the whole run. Before
the first send in each group, it writes every request, timeout policy and cost
reservation to disk and synchronizes them. Each request then receives one durable
send permit. A permit can cause at most one local fetch invocation.

Use this API only in an experiment that explicitly selects its versioned plan,
replay and accounting records. Keep the user's combined dollar, call and time
limits in the ordinary shared API budget. A concurrency limit is not spending
authorization or a provider throughput guarantee. Tests use invented responses;
provider quality and throughput need separate qualification for the experiment.

## Freeze the job plan

Write an `oh.memory-lab-api-wave-plan.v1` file in a private directory and retain its
absolute path, exact byte count and SHA256 as a file pin. Pass that pin to
`ApiLabWaveTransport.open`. Put the plan outside the fresh, empty run directory.

The plan has these fields:

| Field | Meaning |
| --- | --- |
| `protocol` | `oh.memory-lab-api-wave-plan.v1` |
| `runId` | Unique experiment identity, up to 100 characters |
| `policySha256` | SHA256 of the experiment's frozen parser, settings and source policy |
| `concurrency` | Integer from 1 through 4 |
| `requestTimeoutMs` | `600000` |
| `jobs` | Ordered array of 1 through 1,000 jobs |

Each job has `id`, `profileId`, `requestSha256`, `maximumReservationMicros`,
`maximumRequestBytes` and `dependencies`. Profile IDs must select the reader or
judge declared in the ordinary API configuration. IDs are unique; dependencies are
unique preceding job IDs, at most 16 per job. The order therefore cannot contain a
cycle.

For a prepared independent request, use `prepareApiRequest` to freeze its request
SHA256 and reserve its full upper cost estimate. A dependent request may set
`requestSha256` to `null` and freeze a positive cost and request-byte ceiling
instead. The exact prepared dependent request must fit both ceilings before it is
reserved. The experiment must derive its content from the verified parent outputs;
the transport checks parent file identities and completion, not the meaning of the
derived prompt. `policySha256` identifies the caller's policy; it does not attest
that an arbitrary callback implements that policy.

A Gemini binding can select `outputFormat: "json"` as described in
[Direct API setup](api-setup.md). Freeze that option before calling
`prepareApiRequest`: its 38 added body bytes affect each job's request-byte ceiling,
reservation and request hash. Those request captures use
`oh.memory-lab-api-json.v1`, and replay requires the matching configured binding.
The wave plan, journal, lock and accounting protocols keep their own versions.

Plan JSON is limited to 1 MiB, 20,000 nodes and depth 12. Duplicate keys, invalid
Unicode, extra fields and malformed file pins fail. The ordinary model context
and output-token limits also apply to each prepared request.

## Open, dispatch and rotate

Import the executor from `scripts/benchmarks/memory-lab/api-wave.ts`. Open it with
`{config, plan, journalPath, concurrency, requestTimeoutMs: 600000}`. `journalPath`
is an absolute path in an empty private run directory. Existing run files prevent
opening, including after an interruption. Tests can inject `fetcher`, `now` and
`onBoundary`; experiments must separately freeze and review such injections.

Call `invokeWave` with the next ready jobs in plan order, up to the selected
concurrency. Each submission is `{jobId, messages, dependencyReceipts}`. Supply
the exact ordered checkpoint pins returned for its declared parents. An
independent job supplies an empty array. A parent must have a completed native
reply and a verified checkpoint before its child is ready.

The returned members retain plan order even when responses finish in another
order. Each checkpoint binds its job and attempt UUID to the request, send permit,
response, result, parent checkpoints, and reservation and settlement offsets in
the ledger. Identical request bodies for different jobs receive separate attempt
UUIDs. Replay associates events by UUID; it does not assume adjacent ledger lines
or completion order.

Only one wave can run at a time. A session allows at most five waves and has a
60-minute deadline, also limited by the budget and pricing deadlines. The executor
reserves ten minutes for each remaining session wave. Sessions conservatively
allow the smaller of five and the number of remaining jobs. Each request must
still fit its full ten-minute timeout immediately before sending.

After a successful group has drained, call `rotateSession()` on the same live
object to begin another session. Rotation preserves the ledger lock and run
journal and rechecks the entire remaining plan against the cumulative budget.
Another process cannot reopen the run. Call `close()` when finished; it refuses
while any sibling is still running. Successful close requires every declared job
to have completed.

## Stop and inspect

A transport, parser, filesystem or authority failure stops new dispatch. The
executor waits for all already dispatched siblings before returning from the
wave. Successful siblings keep their captures and accounting, while unknown
outcomes retain their entire reservations. There are no retries or resumed runs.
At most three siblings can already be running when a failure is first observed.

After closing the transport, use
`verifyApiWaveRun({config, plan, journalPath})` from `api-wave-replay.ts`. This
read-only operation requires both the native and recovery locks to be absent. It
checks the frozen inventory, journal chain, captures and ledger associations.
Missing jobs keep the run incomplete. A captured response or accounting repair
does not turn a stopped trial into a successful experiment. Native completed
replies also do not establish semantic correctness or paid invoice amounts.

The journal allows at most 12,000 records, 64 KiB per record and 16 MiB total.
Checkpoint files are limited to 16 KiB. Request captures remain bounded by the
native request limit, and responses retain the ordinary 1 MiB bound.

## Close interrupted accounting

Use `prepareApiWaveClosureEvidence` from `api-wave-recovery.ts` to produce read-only
review material for every sibling of a stopped owner. It includes the owner, plan,
journal and budget pins, the ledger prefix and the complete attempt inventory.
Preserve that evidence before independent review.

The reviewed `oh.memory-lab-api-wave-closure-authority.v1` file contains
`approved: true`, `reviewId`, `owner`, `plan`, `journal`, `budget`, `ledgerPrefix`,
`members`, `plannedJobs` and a pinned `writerExit` file. Copy the evidence fields
exactly. The writer-exit record uses
`oh.memory-lab-api-wave-writer-exit.v1` and binds `ownerId`, `ownerSha256`,
`journalSha256` and the ordered `attemptIds`. It also records
`evidenceBasis: "reviewed-supervisor-attestation"`, `supervisor`, a positive
`sessionId`, `completionId`, `exitCode`, canonical UTC `observedExitedAt`,
`localInvocations: "all-exited"` and `runResumable: false`.

Pass `{config, authority}` to `closeUnknownApiWaveBatch`. It acquires a native lock
only when both ownership-lock paths are absent. An occupied lock, including a
dangling symlink, blocks closure. The function never removes or replaces another
owner's lock. A supervisor attestation records the reviewer's observation of local
process exit; it is not proof of provider cancellation.

The closure writes its batch receipt before appending any missing accounting
events. Valid captured result or rejection files can establish an exact missing
charge. Every other reserved attempt retains its full amount with provider outcome
and usage unknown. A saved HTTP response without a validated native result or
rejection is labeled `captured-unvalidated`; a missing response is labeled
`absent`. Both retain the full reservation, and closure does not turn the saved
response into an accepted result. An attempt never reserved is recorded without a charge. All
closure actions state that they accept no result, authorize no retry and leave the
trial stopped. Repeating the same reviewed closure writes only missing events;
partial or conflicting evidence blocks it. `verifyUnknownApiWaveBatch` performs
the corresponding read-only check, including after later fully settled ledger
growth. An unreviewed outstanding reservation blocks verification and closure.

Batch authority and receipt files are limited to 1 MiB each. Writer-exit evidence
is limited to 64 KiB. Single-attempt serial accounting helpers keep their separate
formats and cannot stand in for a wave's sibling inventory.
