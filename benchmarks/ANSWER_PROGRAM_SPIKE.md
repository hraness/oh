# Source-bound answer program

This benchmark helper tests a narrow way to combine semantic judgments with
Oh's exact projection evaluator. A matcher proposes that a source span gives
an item's title or narrator. Oh checks the current source record and exact
quoted bytes, then joins admitted fields and renders the result. The join is
deterministic; the semantic attribution remains a premise supplied by the host.

The helper is experimental and has no production export or default activation.
Run its network-free checks with:

```sh
bun test tests/memory-benchmark-answer-program.test.ts
```

## What the program enforces

`scripts/benchmarks/answer-program.ts` accepts a complete Oh projection snapshot,
typed item requests, and admitted bindings. Each binding includes the record
key and digest, JSON pointer, UTF-16 span, quote digest, admission kind, and
decision digest. A field value is reconstructed from that span; the caller
cannot supply a separate value for rendering.

The program uses actual Oh facts, one positive rule joining title and narrator,
and two projection queries. Citations are reconstructed from the returned
witness leaves. It rejects stale sources, invalid spans, malformed inputs and
duplicate bindings. Distinct admitted values for a field produce a conflict.
Incomplete optional items are omitted; specifically requested items retain
available fields and name what is unknown in the supplied evidence.

Input is capped at 256 KiB, 256 records, 32 requests and 128 bindings. Field
values are capped at 256 bytes. Each projection evaluation has explicit work,
tuple, round, proof and result limits. Truncation or exhaustion suppresses all
factual rendering and never becomes a conclusion that evidence is absent.
The complete returned result is also capped at 256 KiB; exceeding that cap
drops the retained proofs and reports exhaustion.
The result records the input, implementation, snapshot, dataset and rule-pack
digests. Reproducible experiments must also pin the implementation dependencies
and the producer of semantic admissions.

## Controlled semantic comparison

The development probe uses 20 authored cases: eight direct controls, six
paraphrase controls and six adversarial controls. All arms receive the same
manually annotated candidate inventory, locked item identities and host-supplied
supersession information. This measures candidate admission and answer
construction, not retrieval, field extraction or representative memory quality.

The ordinary writer reads the eligible candidates and returns a fixed JSON
schema. The exact program accepts only a byte-exact canonical attribution
sentence. The Jev program asks whether each same candidate is supported,
contradicted or uncertain, then admits only selected supported decisions.
Both program arms use identical joins and rendering. An admits-nothing control
checks that withholding every field does not count as useful answering.

Candidate precision and recall measure the semantic judgments separately from
whole-case outcomes and complete-item coverage. A correct incomplete outcome
compares status only; candidate scores still assess the partial bindings.
The shared writer schema exposes fields only for complete recommendations, so
cross-arm emitted-field precision uses those fields. A valid proof does not
increase the measured confidence of an admitted semantic premise.

The inventory restriction is material. One case supplies only a narrator
candidate even though its source sentence mentions the title. An unrestricted
reader could recover that title. Unknown is correct only for this restricted
task. No fixture expects conflicting supported values; focused program tests
cover conflict handling separately.

## Observed development results

The [complete result](results/memory-answer-program-v5.json) records all 20
cases, including failures. The [replay inputs](results/memory-answer-program-v5-replay.json)
preserve the exact and Jev program inputs, expected outputs and authored gold.

| Arm | Correct cases | Correct recommendations / 18 available | Supported recommended fields |
| --- | ---: | ---: | ---: |
| Ordinary writer | 15/20 | 18/18 | 36/36 |
| Exact matching + program | 13/20 | 11/18 | 22/22 |
| Jev matching + program | 18/20 | 17/18 | 35/36 |
| Admit nothing | 6/20 | 0/18 | No fields emitted |

Jev admitted all 44 supported candidates and two unsupported candidates:
100% candidate recall and 95.65% precision. Exact matching admitted 36 supported
candidates and no unsupported candidates. Both Jev and the ordinary writer
passed all six paraphrase cases; exact matching passed none.

The whole-case score needs qualification. The writer's five errors all labeled
an incomplete specifically requested item as omitted instead of unknown. Its
recommended content was correct. The deterministic program handles that status
choice, but Jev's two false admissions introduced content errors: confusing
titles distinguished by a minus sign produced a narrator conflict in `f07`,
and overlooking a percent sign produced an unsupported recommendation in `f19`.
Source integrity and a valid join did not prevent either mistaken attribution.

This supports semantic admission as a way to recover paraphrases and code as
a way to enforce the answer contract. It does **not** establish that Jev produces
better factual answers than the ordinary writer. Identity checks need stronger
host enforcement and independent cases before promotion. The frozen run used
the selected supported choice without a confidence threshold; none was tuned
after observing the two errors.

The 63 Jev calls cost $0.001570; 20 writer calls cost $0.023064, for $0.024634
incremental exposure. Every call settled. Captured median service times were
279 ms per Jev request and 6,662 ms per writer request. Each Jev request judges
one candidate, while a writer request handles a whole case, so these are not
comparable end-to-end latencies. Cumulative campaign exposure was $2.997355,
including $0.232768 still reserved for two uncertain attempts from an earlier
experiment.

## Where Algal and Wordcell fit

A separate offline compatibility probe ran this pure function through an
ordinary two-cell Algal manifest and replayed its receipt with the existing
TypeScript runtime. Direct and hosted outputs matched, and a forged output
failed replay. No language extension was needed for this host integration.

An intentionally wrong semantic admission also replayed successfully. Replay
establishes execution consistency conditional on the admitted inputs; it does
not establish source meaning, authority, entity identity or real-world truth.
The compatibility probe does not establish native-runtime parity, process
isolation or end-to-end performance.

Wordcell remains responsible for its authoritative Markdown, source eligibility
and application-specific instruction policy. Oh supplies the reusable snapshot,
projection and witness machinery. This benchmark keeps recommendation policy
outside the kernel. Search over alternative programs is a later experiment:
the first comparison fixes the program so that changes in semantic admission
can be measured separately.
