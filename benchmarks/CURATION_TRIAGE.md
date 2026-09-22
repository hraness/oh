# Curation triage: which signals predict a bad stored claim

Oh stores claims with citations so a reader can inspect what a claim rests on.
This card reports measurements on the question inspection leaves open: given a
store of model-extracted claims, which signal tells a curator *which* claims to
read? The measurements come from two external corpora, not from LongMemEval or
LoCoMo, and are not a matched arm of any comparison under the
[protocol card](PROTOCOL_CARD.md). They are reported here because they bear on
what a stored claim's confidence field can be trusted to mean.

Source repository and full scripts:
[0thernet/algal-bio](https://github.com/0thernet/algal-bio). Corpora are
OpenGenes lifespan experiments (curator prose with the curator's own structured
fields as key) and CZ CELLxGENE collections (study descriptions with curated
`tissue` and `disease` as key).

## Provenance makes a claim inspectable, not true

Three conditions over identical relational structure, with the supplied table
as the exact answer key so no vocabulary can intervene. `real` uses actual gene
symbols; `opaque` renames every gene to `g0001` and every attribute to `h01`;
`conflict` keeps real symbols but permutes whole attribute rows between genes,
so the table asserts what biology does not.

All three conditions score 44/44 for both models tested. In `conflict`, where
37 entries qualify under the permuted table only and a different 37 under real
biology only, both models returned **37/37 table-only and 0/37 real-only**, with
confident citations, flagging none.

Stripping recognisable names changed nothing, so recall was never load-bearing —
the grounding works. The same result read the other way is the constraint: a
reader handed a stored claim reproduces it completely, including when it is
false, and cites it while doing so. A citation records where a claim came from;
it does not record whether the source was right. Any surface that presents
stored claims to a model inherits its store's curation error at full strength,
and no proof over those claims can observe the error.

A separate condition confirms the boundary is curation and not reasoning: with a
field **omitted** rather than set false, both models placed all 40 affected
items in "cannot be determined" and none in "does not qualify", with the hint
given and withheld alike. Absence is read as unknown. Positive Datalog needs no
such option because it never asserts a negative.

## Signals measured, with intervals

Lift is recall divided by flag rate: the share of errors a signal catches
divided by the share of claims it asks a curator to read. A signal that flags
30% of claims and finds 30% of errors has found nothing a coin could not and
reads 1.00x. Intervals are cluster bootstraps over collections.

| signal | lift, model A | lift, model B | verdict |
| --- | --- | --- | --- |
| inter-model disagreement | 1.88x (1.36–2.45) | 2.38x (1.92–2.95) | beats random review |
| model self-reported confidence, below `high` | 1.21x (0.93–1.53) | 1.03x (0.56–1.49) | undemonstrated |
| model self-reported confidence equal to `low` | 2.02x (1.51–2.66), 26 fires | 1.67x, fires 2 of 300 | beats random for A only |
| lexical support check: asserted class absent from source text | 0.54x (0.25–0.85) | 0.45x (0.16–0.75) | **worse than random** |

Accuracy within each self-reported confidence stratum, the number a published
confidence field usually omits, for model A (tissue/disease): `high` 73%/78%,
`medium` 72%/81%, `low` 15%/77%. `high` and `medium` are indistinguishable, and
only `low` carries information, only on tissue. No interval is computed per
stratum, so that separation is read off the point estimates. Model B marked 91%
of its claims `high` and only 2 of 300 `low`, so its scale conveys almost
nothing and its `low` signal cannot be used at all.

The same test against a third party's published labels agrees. scBaseCount
ships a `single_disease_confidence` field per sample. 15,394 samples are present
in two of its releases and 14,560 are resolvable through its own published
vocabulary; on those, a `high` label did not predict a more stable call (8.8%
revision rate, 6.7–11.4%) than a `low` label (9.7%, 8.5–11.0%), under two
clusterings. Four deterministic features of its own stated reasoning were also
tested on the 9,544 samples carrying a reasoning string: none predicted higher
revision risk, and the one interval clear of 1.0 pointed the other way (0.89x,
0.81–0.99).

**Inter-model disagreement is the only signal that survived on both models**,
and it is corpus-dependent rather than a property of a model. On OpenGenes the
same two models almost never disagreed on a classifiable field value, so the
signal had no room to carry information there and caught nothing; on CELLxGENE
they disagree on 14% of claims and those claims are error-rich. Measure it on
the corpus in hand; do not inherit the number.

## Rules this program should adopt

The cluster bootstrap and the reclustered second interval in the
[analysis plan](ANALYSIS_PLAN.md) already cover most of what these measurements
needed. Three rules are additive.

**Report lift against equal-size random review, never recall alone.** A recall
figure with no flag rate beside it cannot be distinguished from reading more.

**Reject a signal that fires on fewer than ten claims, whatever its interval
says.** A signal firing twice produced a tight interval of 1.43x to 2.00x purely
because the bootstrap kept resampling the same two rows.

**Prefer scoring a system against its own prior output over scoring it against
an external key.** Four comparisons in the source repository scored extraction
against an external key and all four measured the key rather than the system:
`mice` against `mouse`, `deletion` against `knockout`, `transgenic` filed as
gain-of-function, and `ovarian carcinoma` against `malignant ovarian serous
tumor`. The last moved a third party's apparent accuracy by 24 points, of which
roughly 14 came from applying ontology ancestry and roughly 10 from separating
collections curated normal-only, where the curator may never have deposited the
diseased samples. Release-to-release revision needs no key,
so there is nothing to get wrong; its cost is that it bounds error from below
rather than measuring it.

One retracted result is the reason these rules are stated. A passage-support
check was published at 1.75x lift on 60 rows of a gene-sorted corpus, and
recomputes at 1.58x and 1.85x for the two models on that same slice against
0.60x and 0.61x on the full corpus — worse than random — because an
alphabetical prefix of a sorted corpus is not a sample of it, and the prefix
carried a different mix of curator classes
than the corpus. Resampling the full claim pool at n=60 returns 0.60x at every
sample size, so the small n was never the fault.

## Relation to the calibrated selection seam

The [deductive memory seam](DEDUCTIVE_MEMORY.md) recalibrates a retrieval score
and cut held-out ECE from 0.155 to 0.019. These measurements are the argument
for doing that rather than asking the model. A recalibrated score is fitted
against observed outcomes and can be checked; a self-reported `high` was not
distinguishable from `medium` on the corpus measured here, and on a third party's
published field it failed to predict even its own revision. Where a confidence
value is needed, derive it and calibrate it. Where one arrives attached to an
imported claim, treat it as unvalidated metadata until measured on the corpus
it came from.
