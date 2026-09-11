# Answer audit development experiment

Status: prepared for a new, separately budgeted development experiment on
2026-09-11. No result is implied by this plan.

Oh's best recorded LongMemEval-S mini result is 449/500, compared with 427/500
for matched BM25. That single run does not establish a broader benchmark lead.
On the authenticated development set, 13 of the 14 questions with at least one
calibration-reader error already contain every annotated evidence turn. The
latest calibration reader scored 278/300 across three repeats; its retrospective
95/100 judge-majority score is an analysis statistic, not a deployable voting
method. The next experiment tests whether a second reader pass can use that
evidence more accurately.

## Intervention and controls

The candidate audits one authenticated calibration-only mini draft against the
same question, question date and complete retrieved memory. It checks event and
entity identity, applicable preferences, updates, dates, arithmetic and the
evidence's uncertainty, then returns one concise final answer. It may retain or
revise the draft. No memory text is rewritten, dropped or expanded in this
experiment. Gold references, correctness labels and benchmark categories never
enter either reader request.

The control is the exact prior first-response draft and its authenticated judge
result from the same indexed repeat. This is a paired replay development pilot;
it is not a fresh simultaneous control comparison. The three repeats remain
separate candidate runs. No best-response selection, semantic voting, retries or
question-specific rules are permitted. Prior draft-generation and grading costs
must be reported even though they are not newly incurred.

Use all 100 questions in the original admitted development manifest, with all
three indexed repeats. A missing or failed prior draft stays a fixed failure in
the 300-case denominator. The complete source, scorer, provenance, previous
scores, code, policy, request plan and campaign receive content pins before any
dispatch. The source projection and scorer are separate private artifacts.
The canary uses the first two questions in that pinned source order, with all
three repeats. It checks response completion, bounds and accounting, not answer
correctness. The full matrix reuses those captures. Restarting an interrupted
phase may recover captured first responses; it cannot redispatch an unknown
reservation, retry a failed response or change a frozen phase plan.

## Spending and grading

The new campaign has a hard additional limit of $20 and at most 600 physical
calls: up to 300 mini audit readers and 300 native-rubric Gateway GPT-4o judges.
The judge is a separate grading role; only mini is used as an answer reader.
Use the previously selected project OIDC authority and the native shared
reservation/capture ledger. Prepare the complete conservative reservation bound
before launch and require it to fit the cap. Keep previous campaign accounting
and limits intact. New calls stop on an unresolved transport, routing or response
envelope failure; already admitted calls drain. No automatic retries follow.

An audit answer must be nonblank, at most 2,048 UTF-8 bytes and at most 4,096
bytes after JSON string escaping, excluding enclosing quotes. A response outside
these limits is a scored failure; it is never truncated to fit. Every changed
answer uses the original native-rubric-16 judge and original gold. An exactly
unchanged answer carries forward its authenticated original judge decision,
avoiding a second grade of identical bytes. Report this reuse explicitly.
Provider aliases remain distinct from verified snapshots. Ambiguous references
stay in the denominator with the original grading; no score corrections or
gold-specific answer rules are allowed.

## Decision and reporting

Report all repeat scores, the mean, retrospective majority scores, paired
wins/losses/ties, temporal and abstention slices, fixed failures, changed-answer
and judge-reuse counts, service time, newly incurred cost and total pipeline
cost including reused work. Publish only aggregate results and provenance hashes.

The original development reader promotion gate remains: at least three
additional majority-correct questions, at most two majority regressions, and no
temporal regression. Also require no abstention regression, no unresolved new
requests and all 300 planned cells accounted for. A passing pilot earns a new
frozen transfer-comparison proposal. It does not itself qualify a full-set or
fresh holdout claim, nor authorize a larger spend or reuse an exhausted run slot.

LongMemEval and LoCoMo have already been evaluated. Further runs on them must
retain their exposure qualifications. A benchmark-lead claim requires a matched
external baseline, an appropriate frozen evaluation and the declared statistical
gate; the existing descriptive results do not meet that claim.
