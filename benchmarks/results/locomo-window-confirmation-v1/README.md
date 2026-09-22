# LoCoMo packing receipts

These original, byte-identical receipts let a checkout replay the frozen
conversation packing comparison. They contain identifiers, source-turn ranks,
hashes, byte counts and metrics. Conversation text, questions, gold answers and
provider responses are not included.

| File | Purpose |
| --- | --- |
| [freeze.json](freeze.json) | Policy, source and validation identities fixed before confirmation scoring. |
| [result.json](result.json) | Both policies' ordered turn identities and metrics for all 1,586 confirmation questions. |
| [public-evidence.json](public-evidence.json) | Aggregate evidence recall, uncertainty and qualifications. |
| [Development result](../memory-locomo-window-development-v1.json) | Original policy-selection results from conversations 49 and 50. |

The compact `public-evidence.json` is also published as
[`memory-locomo-window-confirmation-v1.json`](../memory-locomo-window-confirmation-v1.json).
Historical relative cache paths inside the original freeze are provenance
strings. The replay command accepts the public file locations explicitly.

From the repository root, download the pinned 2.8 MB dataset once, then verify:

```sh
bun run bench:memory fetch --dataset locomo
bun run scripts/benchmarks/locomo-window-source.ts verify \
  benchmarks/results/locomo-window-confirmation-v1 \
  benchmarks/results/memory-locomo-window-development-v1.json
```

Verification makes no model calls. It reconstructs all 1,986 historical control
contexts and all 3,172 confirmation contexts, including exact whole-turn order
and bytes. It preserves the original failed admission attempt in provenance.
See the [protocol and completed answer comparison](../../LOCOMO_WINDOW_QA_V1.md)
for denominators, prior dataset exposure and limitations.

These measurements and their analysis were produced by coding agents.
[LoCoMo](https://github.com/snap-research/locomo) is by Maharana et al. The source
dataset at revision `3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376` is distributed
under [CC BY-NC 4.0](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/LICENSE.txt).
The dataset's terms are separate from Oh's software license.
