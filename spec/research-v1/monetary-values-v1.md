# Monetary values and quotes v1

The `sponge.monetary-values` pack connects a seller's offer price or a dated
financial quote to an exact decimal amount and an explicitly identified
currency. A monetary value is a record of that pair. Its currency is an entity
under a named, source-supported identity, rather than a physical unit or an
exchange-rate rule. Amounts use the existing canonical decimal string format;
floating-point numbers, scientific notation and display formatting do not
enter that value. Original formatting belongs in the retained source.

`createSpongeMonetaryValuesPackV1(previous)` accepts catalog V5. Catalog V6 adds
this pack alongside the independent measurement and content occurrence packs.
The pack has four concepts and fourteen predicates:

| Subject | Predicate | Object |
| --- | --- | --- |
| Bridge price | `price-has-monetary-value` | Monetary value |
| Monetary value | `monetary-amount` | Decimal |
| Monetary value | `monetary-currency` | Currency |
| Bridge price | `price-basis` | Quotation basis |
| Quotation basis | `basis-quantity` | Quantity with an exact unit reference |
| Quotation basis | `basis-item` | Product or financial instrument |
| Quotation basis | `basis-description` | Language-tagged package or denominator description |
| Bridge price | `price-valid-during` | Interval with explicit calendar and precision |
| Bridge price | `price-tax-treatment` | Included, excluded, exempt, mixed or not applicable |
| Financial quote | `quote-for-listing` | Financial listing |
| Financial quote | `quote-kind` | Ask, bid, indicative, last, mid or settlement |
| Financial quote | `quote-at-time` | Time with explicit calendar and precision |
| Financial quote | `quote-has-monetary-value` | Monetary value |
| Financial quote | `quote-basis` | Quotation basis |

The four concepts are `monetary-value`, `currency`, `quotation-basis` and
`financial-quote`. The existing bridge `price` keeps its offer-associated
meaning. A listing's bid is a financial quote, and does not become an offer
price through a shared number, currency or label.

## Follow an offer price

Start at the substance-domain `offer`. Follow its existing `offered-by` link to
the seller, `offer-for-product` to the product and `offer-has-price` to a bridge
price. From that price, follow `price-has-monetary-value` to the monetary value,
then read `monetary-amount` and `monetary-currency`. A source might state
`125.75` in its identified US dollar currency for one vial containing 10 mg.
Follow `price-basis` to a quotation basis whose `basis-quantity` is 10 in the
foundation milligram unit, `basis-item` identifies the product and
`basis-description` retains “one vial containing 10 mg”. This describes the
priced package; it does not assert an independently measured content or purity.

Read `price-valid-during` only when the source states the effective interval.
Omitting it leaves validity unknown. An explicitly open endpoint in an interval
is a source assertion and must not be manufactured from a missing date. The
same rule applies to `price-tax-treatment`: omission means unknown, whereas
`exempt` or `not-applicable` is an attributed positive claim. Mixed tax treatment
needs separately retained detail. This pack does not compute taxes, split a
package into unit prices, or establish current availability or supplier trust.

## Follow a listing quote

A financial quote identifies its listing through `quote-for-listing`, its
source-stated kind through `quote-kind`, and its market observation time through
`quote-at-time`. Follow `quote-has-monetary-value` to the same amount/currency
model and `quote-basis` to the quoted denominator. For example, a dated `bid` of
`98.125` in an identified currency can be for one identified instrument unit.
The count unit and `basis-item` record which unit was counted. The existing
listing's `lists-instrument` and `listing-at-venue` relations retain the
instrument and venue identities. A bid is not a last trade, execution, order,
valuation conclusion or investment recommendation. The six quote kinds are a
bounded vocabulary; preserve unsupported source kinds without forcing a match.

## Preserve attribution and missing context

Every new predicate admits the existing reference qualifiers and the foundation
source, retrieval and version qualifiers. A `source-context` points to the
retained source, `version-context` identifies its exact retained version, and
`retrieved-at` records capture time separately from market or effective time.
Attach evidence with its source locator to the individual claims. The examples
are synthetic representations, not factual offers or market data.

These are open descriptions. Compiler acceptance validates declared types and
values; it does not require an incomplete source to invent an amount, currency,
basis, tax treatment, quote kind or date. A complete comparison must request and
assess the necessary context. Multiple source-scoped claims may coexist.
Currency identity, conversion, denomination history, fees, market depth,
corporate actions and purchasing or investment suitability remain outside this
pack. No Wikidata mapping or external identifier equivalence is added.

The direct dependency is the exact V5 `sponge.bridge-relations` manifest. Its
existing transitive closure contains all twenty V5 packs, including the core,
reference, foundation, finance and substances schemas reused here. Installing
this extension therefore resolves twenty dependencies, even though its direct
dependency list has one entry. Every published V1–V5 declaration remains
unchanged. Installation and proposal review retain their existing host policy.
