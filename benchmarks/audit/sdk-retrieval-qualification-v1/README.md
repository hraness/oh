# SDK qualification arithmetic audit

These are exact copies of the independent Python auditor and synthetic fixture
prepared before answer outcomes were opened for the September 23, 2026 SDK
qualification. They use only the Python standard library and make no network,
provider or native-model calls.

The exact auditor retains the two fixed **public CloneMem dataset identifiers**
used to select this study. They already appear in Oh's
[public source profile](../../profiles/clonemem-source-v1.json) and the upstream
[CloneMemBench release tree](https://github.com/AvatarMemory/CloneMemBench/tree/753d8a97fd78f4ee25af398a0f0c8d981a6be304/data/releases).
They are source-selection metadata, not private run data. Aggregate reports use
`persona-01` and `persona-02` and do not publish these IDs alongside observations.
CloneMemBench is attributed to AvatarMemory at revision
`753d8a97fd78f4ee25af398a0f0c8d981a6be304`; the existing
[Apache-2.0 license copy](../../profiles/CLONEMEM_LICENSE) is retained.

| File | SHA-256 |
| --- | --- |
| `audit-sdk-qualification.py` | `b0771458cff8fe681578f5b3ea52adca6b051334471df33c11bcdd09edc8c8d3` |
| `test-audit-sdk-qualification.py` | `b88ffad01f4ca7ec490c901b5ac8e168d46421ab5e234fcce1ac1124e7788ef6` |

From this directory, run the synthetic checks without any benchmark data:

```sh
python3 audit-sdk-qualification.py --self-test
python3 test-audit-sdk-qualification.py
```

The fixture creates and removes its own temporary files. It checks a complete
876-cell matrix, exact answer and recall arithmetic, unresolved responses scored
as zero, a retained 2 MiB response-bound failure, native-initialization disclosure,
and rejection of mismatched pins or invented prior exposure. All fixture content
and provider responses are synthetic; these checks are not benchmark results.

Auditing an actual run requires its private evidence bundle, in the original
absolute filesystem layout recorded by its pins. The auditor intentionally does
not rewrite paths or migrate evidence. This repository publishes aggregate results
and audit code, not the private source-text, answer, gold-key or provider-response
bundle. The public files alone therefore do not reproduce the recorded native
ledger audit. Data redistribution and licensing are a separate decision.

An authorized holder of that bundle can run:

```sh
python3 audit-sdk-qualification.py \
  --manifest ABSOLUTE_MANIFEST_JSON \
  --manifest-sha256 MANIFEST_SHA256 \
  --output ABSOLUTE_NEW_REPORT_JSON
```

The private manifest uses protocol
`oh.sdk-retrieval-independent-audit-input.v1`. It contains `preparedPin`,
`launchPin`, `resultPin`, `databasePin`, `taskBudgetPin` and `dispatchOutcomePin`,
each with an absolute `path` and SHA-256 `sha256`. The task-budget pin references
the reviewed task-allocation receipt. Optional `priorAdditionalExposureMicros`
must agree with the authenticated dispatch accounting. Output must be a new file.

All native and provider children must first be collected and both reader
campaigns closed. The auditor opens SQLite in read-only immutable mode, requires
no active lock or journal files, and checks the database digest before and after.
It independently reconciles requests, raw response hashes, answer/status parsing,
costs, every planned logical cell, original trace rendering and default SDK ranks
from captured native scores. It also authenticates the explicit pre-paid Metal
initialization interpretation and its source-review pin before opening scores.

The result remains a development qualification on two previously exposed
personas. Its optional paired-question bootstrap interval is descriptive and
conditional on those personas, with no population-level confidence claim. One
handled Metal capability-probe error was disclosed separately from reranker
execution and cleanup failures; literal zero-error-log admission would fail.
Neither the synthetic tests nor this audit establish superiority over another
memory framework. See the [qualification protocol](../../SDK_RETRIEVAL_QUALIFICATION_V1.md)
and [result](../../SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md) for the complete scope.
