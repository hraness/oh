# Measurement results v1

The `sponge.measurement-results` pack connects reported results to the quantity,
method and context needed to read them. It adds two concepts, `metric-definition`
and `dataset-split`, and fourteen predicates. The pack reuses foundation
measurement records, quantities, unit descriptors, methods and times. A software
measurement and a foundation measurement remain distinct records joined by
`software-result-measurement`.

`createSpongeMeasurementResultsPackV1(previous)` accepts catalog V5. Catalog V6
includes the resulting revision 1 pack. Its eight direct dependencies are core,
reference, foundation, identity/context, software, natural world, research and
finance. It does not depend on the other V6 extensions or the bridge pack.
Every published V1–V5 declaration remains unchanged.

## Read a benchmark score

Starting with one software `run`, follow these exact predicate paths. Names
before a slash identify the `sponge.*` namespace.

| From | Predicate | To |
| --- | --- | --- |
| Run | `software/produces` | Software measurement |
| Software measurement | `measurement-results/software-result-measurement` | Foundation measurement |
| Foundation measurement | `foundation/normalized-quantity` | Score value, unit and stated bounds |
| Foundation measurement | `measurement-results/measurement-model-version` | Exact software model version |
| Foundation measurement | `measurement-results/measurement-metric` | Metric definition |
| Metric definition | `measurement-results/metric-definition-text` | Stated denominator, aggregation, direction and scope |
| Foundation measurement | `measurement-results/measurement-dataset-split` | Dataset split |
| Dataset split | `measurement-results/split-of-dataset-version` | Exact software dataset version |
| Dataset split | `measurement-results/split-selector` | Source-native selector or membership description |
| Run | `software/evaluated-under` | Benchmark protocol |
| Run | `software/uses-configuration` | Runtime configuration |
| Run | `software/uses-dataset` | Dataset version used by the run |
| Foundation measurement | `foundation/measurement-method` | Protocol or measurement procedure |
| Foundation measurement | `foundation/measured-at` | Measurement time |
| Foundation measurement | `measurement-results/measurement-evidence` | Evidence item or bundle |
| Metric definition or dataset split | `measurement-results/definition-evidence` | Evidence item or bundle |

Resolve a bundle with `identity-context/contains-evidence`. For each evidence
item, read `identity-context/evidence-source`, `evidence-excerpt` and `captured-at`.
An exact retained source version can be the evidence source or an explicitly
attributed `foundation/version-context` qualifier. Capture time remains distinct
from measurement time. Facts still carry their own assertion stance, qualifiers
and evidence links; a descriptive evidence relation grants no acceptance.

For example, a synthetic score of `0.75` in the foundation `dimensionless` unit
can mean macro-averaged correctness under an identified metric definition. Its
test split belongs to an exact dataset version, and the measurement points to
the exact model evaluated. The protocol named on the run and the method named
on the measurement must be inspected independently. Neither relation makes
them equal, and a run containing multiple models or splits does not assign
every model or split to every result. Retain conflicts instead of choosing a
value silently. A missing metric, split or version is missing context.

## Read cloud altitude

Follow `natural-world/observes` from an observation to the physical cloud
occurrence, and `measurement-results/observation-has-measurement` to the foundation
measurement. The measurement's `foundation/measurement-of` identifies the
occurrence, `measurement-results/measurement-feature` identifies the measured
feature, and `foundation/normalized-quantity` carries the altitude and exact
unit descriptor. Read `foundation/measured-at`, `foundation/measurement-method`,
`measurement-results/measurement-at-location` and `measurement-evidence` beside
the quantity. `natural-world/observed-at` independently locates the observation.

For example, a synthetic cloud-base altitude of `1200` meters with bounds
`1150`–`1250` needs the observation time, place and method. Retain a stated
reference surface, such as local ground level, with `foundation/scope-context`;
altitude above ground and elevation above sea level are different measurements.
If source coordinates were explicitly normalized, the place may carry
`foundation/normalized-location` with its coordinate reference system. No
coordinate or unit conversion runs as a consequence of these links.

## Read research and backtest results

A study reaches a finding through `research/produces-finding`; a finding reaches
its foundation measurement through `measurement-results/finding-has-measurement`.
A historical backtest reaches its measurement through
`measurement-results/backtest-has-measurement`, its strategy through
`finance/tests-strategy`, and its dataset through `finance/uses-dataset`. Each
measurement can use the same quantity, metric, subject, method, time and evidence
paths described above. Multiple reported measurements remain separate records.

These links do not establish clinical significance, a causal explanation,
investment suitability or future performance. Costs, sampling, uncertainty,
population and other assumptions still need independently attributed context.

## Interpretation and coverage

All relations are descriptive and private until the host admits a reviewed
proposal. Metric definitions and dataset selections have open shapes with
optional properties. Missing context does not become zero, false, an empty
population or evidence of completeness. A valid partial record is not a
complete benchmark result.

Source-native selectors and definitions remain attributed text. This pack does
not execute selectors, verify dataset membership, supply every possible metric
or guarantee disjoint splits. Equal units, metric names or model labels do not
establish comparability. Ranking, aggregation, conversion, statistical
inference and automated scientific or financial conclusions are outside this
pack. Coverage remains partial and does not claim exhaustive Wikidata mappings.
