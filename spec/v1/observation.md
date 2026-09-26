# Oh observations V1

An Oh observation is one dated, self-contained sentence distilled from a
conversation session, stored as an ordinary Oh `edition` record under the
`oh.observation.v1` application profile. It is derived memory: every
observation depends on the source turn records it cites, and the extraction
that produced it is recorded by one `activity` record, its receipt.
Observations add no record kind, contract manifest entry, ontology assertion,
or search index. Keyword and semantic search retrieve them exactly like any
other record.

## Extraction input

The extraction instruction is frozen text. Its SHA-256 digest is exported as
`OH_OBSERVATION_INSTRUCTION_SHA256_V1` and recorded in every receipt. Changing
one byte of the instruction produces a different instruction with a different
digest. The instruction is versioned and never edited in place. The V1
instruction digest is
`771ec3c8ec60ebbb4c048d6d2bec703f94543b2ba6e027c0165b44fc8db4d838`.

The model input is exactly two messages: the instruction as the system message
and a JSON user message with `sessionDate` and the session’s `turns`, each
carrying an alias `t<n>`, the turn’s `speaker`, and its `text`. Nothing else
reaches the model. In particular, no question, answer, category, or dataset
label is part of the input, so an extraction cannot specialize to an evaluation.
The instruction is corpus-general: it asks for absolute dates resolved from the
session date with the relative expression preserved, verbatim proper nouns and
quantities, explicit speaker attribution, one event per observation, and
`changed from X to Y` phrasing for updates.

A session is one ordered list of current `edition` turn records that share
one `sessionId`, one `date`, and one optional `sessionIndex`. The session
digest covers the date, the session identity, and each turn’s speaker and
text, so the same session content has the same digest under any record keys.

### Session turn records

A turn record’s value has exactly the fields below. A value with any other
key, including a product store’s own annotations, is not a session turn, and
the session parser rejects it. Every string is NFC-normalized, nonempty, and
free of control characters. Every string except `text` is a single line.

| Field | Contract |
| --- | --- |
| `id` | Turn identifier, at most 512 bytes. |
| `sessionId` | Session identifier, at most 512 bytes. |
| `sessionIndex` | Optional; when present, a non-negative safe integer: the session’s position in its corpus. Absent means unknown. |
| `date` | The session date, free-form, at most 256 bytes. |
| `speaker` | The speaker label, at most 64 bytes. |
| `text` | The turn text, at most 512 KiB, line breaks allowed. |

A session contains one through 512 turns. Session turns are ordered as given
and are aliased `t0`, `t1`, … in the prompt in that order.

## Observation value

The value has `format: "oh.observation.v1"` and `v: 1`. Parsers require the
exact fields below and reject unknown fields.

| Field | Contract |
| --- | --- |
| `text` | Nonempty single-line NFC-normalized text without control characters, at most 1 KiB. |
| `speaker` | The exact speaker label of a cited turn, single-line NFC-normalized, at most 64 bytes. |
| `statedAt` | The session date, copied verbatim, single-line NFC-normalized, at most 256 bytes. |
| `eventAt` | `null` or a calendar date `YYYY-MM-DD` the proleptic Gregorian calendar reproduces exactly. |
| `resolvedFrom` | `null` exactly when `eventAt` is `null`; otherwise the expression the date was resolved from, single-line NFC-normalized, at most 256 bytes. |
| `facet` | `null` or a lowercase hyphenated topic token of letters, digits, and hyphens, at most 48 characters. |
| `kind` | One of `fact`, `event`, `plan`, `preference`, `update`. |
| `supersedes` | `null` or the key of the observation this one replaces. |
| `orderingConflict` | Boolean; `true` only when `supersedes` is set. |
| `sources` | One through 16 cited turns, each exactly `key`, `recordSha256`, and `v: 1`, unique by key. |

The complete canonical-JSON value is limited to 8 KiB. A cited source names a
turn record by key and by the record digest that was current when the
observation was extracted. A consumer that finds a different current digest
treats the observation as stale.

## Keys, dependencies, and the receipt

Observation keys are `edition:obs-<sessionSha256>-<nnn>` where `nnn` is the
zero-padded index of the observation in the model response, at most 48 per
session. The record’s `dependencies` list exactly one receipt key
(`activity:observe-…`), every cited source key, and the superseded key when
present, so the graph rejects an observation whose sources do not exist. The
record parser rejects a record that lacks its receipt dependency or names more
than one.

One `activity:observe-<sessionSha256>` record, the receipt, records the
extraction. Its value has `format: "oh.observation-activity.v1"`, `v: 1`, the
model identifier, `instructionSha256`, `promptSha256`, `responseSha256`, the
`observedAt` instant, the session digest and optional session index, the
observation count, the session’s turns as sources (one through 512, ordered and
unique by key), and `candidatesTruncated`. That field lists the keys of this
session’s observations whose supersession lookup reached its candidate limit
(see below), in ascending index order. It is empty when supersession was off or
no lookup was truncated. The receipt depends on every turn of the session.
Extraction is idempotent by session content: when the receipt exists, the
observer is not called and the existing keys and truncation flags are returned.
A rejected response commits nothing.

## Response parser

The parser accepts only a JSON object with the single key `observations`,
optionally wrapped in one Markdown code fence (bare or `json`), removed by a
linear scan so a degenerate fence cannot stall the parser. It rejects, with a
stable reason code, a response over 256 KiB, malformed JSON, a duplicate
object key, nesting deeper than eight levels, more than 48 observations, an
observation with extra or missing fields, and any field outside the limits
above. A non-NFC `text` is rejected with code `text`. An observer that returns
anything other than a string is a caller error. The error is thrown and is
never recorded as a rejection. Source aliases must name turns of the session.
The speaker must be the label of a cited turn. A `resolvedFrom` without an
`eventAt`, or the reverse, is rejected. Identical texts within one response are
rejected. The rejection index names the first
failing observation.

## Supersession

An optional policy links an observation to the latest current observation with
the same `facet` and `speaker`. The candidate set is the keyword search result
restricted to observation keys, at most 100 hits, re-parsed through this
profile. A candidate already superseded by another is skipped. When the
observation being linked is already committed, it and its own successors are
skipped. Its successors are every candidate whose `supersedes` chain leads back
to it. Chains are followed for at most 8,192 links, and a looping chain counts
as leading back. As a result, re-applying the policy to a chain’s predecessor
leaves the chain as it is and never closes a cycle. Observations of one session
with the same facet and speaker chain in response order ahead of the store’s
head. When the policy is applied to a batch of already committed observations,
the batch is processed in session order regardless of the order the caller lists
the keys in, and same-facet, same-speaker records of the batch chain to one
another in that order ahead of the store’s head under the ordinary conflict
rule. The caller’s order never decides chain direction, and a key listed twice
counts once.

Session order is the receipt’s session index, then its instant, then the key.
A missing session index is incomparable: two positions compare by index only
when both carry one, otherwise by instant alone, so an unindexed session is
never treated as earlier than every indexed one. The link records
`orderingConflict: true` when the chosen predecessor sits strictly later in
session order (index when both are known, then instant) than the observation
being linked, or when both statement dates contain a calendar date
(`YYYY-MM-DD` or `YYYY/MM/DD`, with an optional clock time) and the
predecessor’s is later. A statement date without a calendar date takes part
only through session order. On a conflict both dates render. The policy never
chooses which value is correct.

When the lookup returns the full 100 hits, the true chain head may lie
outside the examined set. The link then reports `candidatesTruncated` and the
receipt lists the affected observation keys so a consumer can re-link them or
account for the degradation.

## Reading a supersession chain

`ohObservationSupersessionV1` follows `supersedes` from one observation toward
the oldest record and reports how far it got. It needs only a synchronous `get`,
and it never writes.

It counts recorded links. A restatement that was never linked does not count. A
link comes from the policy above, which matches on facet and speaker over a
candidate lookup of limited size. A fact whose extracted facet changed between
sessions therefore starts a separate chain and reads a lower depth than the
number of times it was stated. `depth` describes the link
graph the store holds.

A per-record revision count cannot see this churn. A revision count reports
rewrites of one key, and this profile records a correction under a different
key. The two counts are related. Applying the supersession policy re-puts a
record when its link changes, so a key linked that way reports one revision. A
key linked during extraction is written once and reports none.

`depth` is the number of links followed, so a first statement reads 0.
`resolved` is true only when the walk ended at a record that supersedes nothing.
Only then does `origin` name the oldest record and `depth` equal the distance to
it. `resolved` says nothing about whether the link graph is complete. A chain
that the lookup never joined also resolves.

`candidateLookup` reports what the walked records’ receipts recorded about the
limited lookup their link was chosen from. It has three values, one for each
case below.

`named` means a receipt named one of the walked records, so its lookup
saturated. The chain may then be short by an unknown amount even though the walk
completed, and `depth` is not a floor on the links that exist.

`unreadable` means a receipt could not be read as one, so nothing is known. A
boolean would have to fold that state into one of the others, and folding it
into the absence of saturation would report a fact the read never established.

`none-recorded` means every walked record’s receipt was readable and named none
of them. The name avoids “complete” on purpose. A receipt covers the lookup
performed when the observation was extracted. Applying the supersession policy
re-links an already committed record against its original receipt and writes no
receipt of its own, so a link the policy chose from a saturated lookup is
recorded nowhere this read can see. `none-recorded` rules out recorded
saturation and nothing further. A facet that changed between sessions leaves no
signal this read can report either.

Each walked record costs one receipt read, memoized per session, so a chain
whose links all come from one session reads one receipt and a chain whose links
come from different sessions reads one per link.

A link is followed only when the record parses as an observation record, so a
record of another kind stored at an observation key is reported as damage
instead of counted. At most 8,192 observation records are read, so the longest
chain that can resolve carries 8,191 links. With one receipt per link, a walk
performs up to 16,384 reads in total.

The count carries no meaning. A long chain may be contested, progressively
refined, or only a subject discussed often, and this profile does not
distinguish those. Whether a depth warrants review is the application’s
decision, as it is for a revision count.
