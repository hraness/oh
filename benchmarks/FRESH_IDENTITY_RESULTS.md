# Fresh semantic-binding identity test

A fixed exact-identity guard removed two mistaken Jev admissions on 20 newly
authored cases, retained all 45 supported admissions, and restored two complete
recommendations. This demonstrates the intended cleanup mechanism on this
finite suite. The entire gain comes from one control that treats canonically
equivalent Unicode title spellings as distinct identifiers. It does not
establish representative memory quality or general superiority over an
ordinary writer.

The experiment combines Jev's semantic judgments with the existing
[source-bound Oh answer program](ANSWER_PROGRAM_SPIKE.md). The program checks
current source digests and quoted spans, joins title and narrator fields, and
returns source witnesses. Its identity guard rejects a semantic admission when
a complete canonical attribution names a different subject, field or value.
Unrecognized prose still depends on the semantic judgment.

## Frozen comparison

The program, semantic prompt, writer prompt, exact matcher and identity guard
were fixed before the new cases were authored. A separate reviewer checked the
case meanings, candidate inventory and expected answers before the final
freeze. The 20 cases contain four canonical controls, eight paraphrase cases
and eight adversarial or boundary cases. They deliberately target attribution;
they are not a random population sample.

All arms share 27 requested items, manually annotated candidate spans, locked
item identities, and supplied source authority and supersession metadata. Of
76 cross-paired candidate proposals, 63 are eligible. There are 45 supported
eligible candidates and 17 items with complete unambiguous recommendations.
The inventory also contains partial evidence and a genuine supported conflict.
Retrieval and automatic field extraction are outside this comparison.
Arms may emit only eligible item/field/value candidates, even when the prose
mentions an omitted field. In `g10`, one requested item deliberately has no
title candidate although its narrator statement names the title. Its expected
missingness measures obedience to the restricted inventory, not inability to
understand the source.

The two semantic arms reuse the same 63 captured Jev decisions. The guarded arm
only removes recognized exact mismatches; it adds neither bindings nor model
calls. Every planned case and the single draw for every distinct request remain
in the result. No post-result confidence threshold or sample expansion was used.

The primary rule required at least one unsupported admission removed, no
supported admissions removed, and no loss of correct complete recommendations.
Every program execution also had to complete without malformed output,
truncation or exhaustion. This rule measures cleanup, not general usefulness
or readiness for production.

## Results

The [audited result](results/memory-answer-program-identity-v7.json) includes all
20 case score rows, group totals, candidate counts, model identities, cost and
evidence digests.
The [synthetic replay](results/memory-answer-program-identity-v7-replay.json)
preserves every source, candidate, expected answer and all four deterministic
program inputs and outcomes. It includes the unchanged Unicode and restricted
inventory cases discussed below. Replaying captured admissions checks execution
consistency; it does not repeat the provider draw or prove semantic correctness.

```sh
bun test tests/memory-benchmark-answer-program-identity-fresh.test.ts
```

| Arm | Correct cases | Correct complete recommendations / 17 | Supported recommended fields |
| --- | ---: | ---: | ---: |
| Ordinary writer | 17/20 | 15/17 | 30/30 |
| Exact matcher + program | 9/20 | 7/17 | 14/14 |
| Jev + program | 19/20 | 15/17 | 30/30 |
| Same Jev decisions + identity guard + program | 20/20 | 17/17 | 34/34 |
| Admit nothing | 5/20 | 0/17 | None emitted |

| Candidate admissions | True positive | False positive | False negative | True negative | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Exact | 14 | 0 | 31 | 18 | 100% | 31.11% |
| Jev | 45 | 2 | 0 | 16 | 95.74% | 100% |
| Guarded Jev | 45 | 0 | 0 | 18 | 100% | 100% |

The frozen cleanup rule passed. Jev recovered 31 supported candidates that the
exact matcher missed. The guard retained those semantic gains, removed both
unsupported admissions and increased correct complete recommendations from
15 to 17. All arms returned well-formed outputs; every program completed.

Both removed admissions occur in `g03`, a canonical control with composed and
decomposed Unicode spellings of the same visible title. The fixture assigns
them different item identifiers and narrator credits, and its exact-string
contract forbids normalization. Jev cross-admits the narrator credits and the
program reports two conflicts; the guard rejects the cross-attributions.
Canonically equivalent spellings can name the same real entity, so this result
is conditional on the fixture's deliberately strict identity policy. It does
not establish that Jev misunderstood ordinary source meaning. The prompts
require exact title identity but do not spell out a Unicode normalization
policy. An application must make that policy explicit. Unicode's
[normalization specification](https://www.unicode.org/reports/tr15/tr15-58.html)
defines canonical equivalence as representing the same abstract characters;
binary inequality alone does not establish distinct real entities.

The improvement therefore supports exact identity enforcement within the
recognized grammar; it does not show that the guard verifies adversarial prose.
Among Jev's 47 admitted candidates, the guard recognized 14 exact matches and
two mismatches. It left 31 unrecognized statements unchanged; all 31 happened
to be supported in this suite.

Both semantic arms and the ordinary writer passed all eight paraphrase cases;
the exact arm passed none. Both semantic arms passed all eight adversarial
cases. The writer passed six. Its recommended fields were all supported: the
case score also measures missingness and conflict decisions, which must not be
reported as an unsupported-field rate. The guarded arm returned one genuine
conflict; the unguarded semantic arm returned that conflict plus two spurious
ones. The admit-nothing control scored five correct cases while returning no
complete recommendations.

These are observed finite counts, with no population confidence claim. The
writer comparison changes the entire answer-construction procedure, so it does
not isolate a Jev effect. The separate
[BEAM compact-repair confirmation](COMPACT_REPAIR_CONFIRMATION.md) still fails
its frozen success rule; this synthetic suite does not amend that result.

## Cost and verification

All 63 Jev calls and 20 writer calls settled. Jev cost $0.001576 and the writer
cost $0.020716, totaling $0.022292. Cumulative campaign exposure is $4.046654 of
the authorized $10, including $0.232768 retained for two uncertain attempts
from an earlier experiment. Those attempts were not retried or erased.

An independent offline audit authenticated the unchanged 396 preceding native
request records, 20 new writer records, all five semantic ledgers, the frozen
source and expected answers, source spans, guard decisions, program outputs,
scores and accounting. It made no provider calls. Jev used the pinned
`jev-1.13.0` version; the writer used a registered Gateway model alias rather
than a verified immutable model snapshot.

Captured median service times were 305 ms per Jev candidate request and
4,266 ms per writer case request. These have different units of work and are
not an end-to-end speed comparison or a measurement of Algal overhead.

## Engineering implication

Use semantic judgments where wording varies, while preserving exact identity
and source constraints in deterministic code. Oh's snapshot, projection and
witness machinery already supplies that execution boundary. The application
still owns source eligibility, candidate generation and the meaning of its
item identifiers. Wordcell's vault-specific policies remain outside the Oh
kernel. In particular, resolve stable entity identifiers and authorized alias
or normalization rules at that boundary; a universal ban on Unicode
normalization would not follow from this experiment.

The earlier Algal compatibility probe already hosted and replayed this fixed
program without a language change. This result does not justify a new language
or unrestricted proof search. The next evidence gap is automatic candidate
construction on real source material: coverage, attribution and final answer
quality must be measured together before any production promotion.
