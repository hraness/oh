# Oh observations V1

An Oh observation is one dated, self-contained sentence distilled from a
conversation session, stored as an ordinary Oh `edition` record under the
`oh.observation.v1` application profile. It is derived memory: every
observation depends on the source turn records it cites, and the extraction
that produced it is receipted by one `activity` record. Observations add no
record kind, contract manifest entry, ontology assertion, or search index.
They are retrievable through the existing keyword and semantic lanes exactly
like any other record.

## Extraction input

The extraction instruction is frozen text. Its SHA-256 digest is exported as
`OH_OBSERVATION_INSTRUCTION_SHA256_V1` and recorded in every receipt. Changing
one byte of the instruction is a new instruction with a new digest; it is
versioned, never edited in place. The V1 instruction digest is
`771ec3c8ec60ebbb4c048d6d2bec703f94543b2ba6e027c0165b44fc8db4d838`.

The model input is exactly two messages: the instruction as the system message
and a JSON user message with `sessionDate` and the session's `turns`, each
carrying an alias `t<n>`, the turn's `speaker`, and its `text`. Nothing else
reaches the model. In particular, no question, answer, category, or dataset
label is part of the input, so an extraction cannot specialize to an evaluation.
The instruction is corpus-general: it asks for absolute dates resolved from the
session date with the relative expression preserved, verbatim proper nouns and
quantities, explicit speaker attribution, one event per observation, and
`changed from X to Y` phrasing for updates.

A session is one ordered list of current `edition` turn records that share
one `sessionId`, one `date`, and one optional `sessionIndex`. The session
digest covers the date, the session identity, and each turn's speaker and
text, so the same session content has the same digest under any record keys.

### Session turn records

A turn record's value is exactly the fields below; a value with any other
key, including a product store's own annotations, is not a session turn and
the session parser rejects it. Every string is NFC-normalized, nonempty, and
free of control characters; every string except `text` is a single line.

| Field | Contract |
| --- | --- |
| `id` | Turn identifier, at most 512 bytes. |
| `sessionId` | Session identifier, at most 512 bytes. |
| `sessionIndex` | Optional; when present, a non-negative safe integer: the session's position in its corpus. Absent means unknown. |
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
observation was extracted; a consumer that finds a different current digest
treats the observation as stale.

## Keys, dependencies, and the receipt

Observation keys are `edition:obs-<sessionSha256>-<nnn>` where `nnn` is the
zero-padded index of the observation in the model response, at most 48 per
session. The record's `dependencies` list exactly one receipt key
(`activity:observe-…`), every cited source key, and the superseded key when
present, so the graph rejects an observation whose sources do not exist. The
record parser rejects a record that lacks its receipt dependency or names more
than one.

One `activity:observe-<sessionSha256>` record receipts the extraction. Its
value has `format: "oh.observation-activity.v1"`, `v: 1`, the model
identifier, `instructionSha256`, `promptSha256`, `responseSha256`, the
`observedAt` instant, the session digest and optional session index, the
observation count, the session's turns as sources (one through 512, ordered and
unique by key), and `candidatesTruncated`:
the keys of this session's observations whose supersession lookup hit its
candidate bound (see below), in ascending index order, empty when supersession
was off or no lookup was truncated. The receipt depends on every turn of the
session. Extraction is idempotent by session content: when the receipt exists,
the observer is not called and the existing keys and truncation flags are
returned. A rejected response commits nothing.

## Bounded response parser

The parser accepts only a JSON object with the single key `observations`,
optionally wrapped in one Markdown code fence (bare or `json`), removed by a
linear scan so a degenerate fence cannot stall the parser. It rejects, with a
stable reason code, a response over 256 KiB, malformed JSON, a duplicate
object key, nesting deeper than eight levels, more than 48 observations, an
observation with extra or missing fields, and any field outside the bounds
above (a non-NFC `text` is rejected with code `text`). An observer that
returns anything other than a string is a caller error and is thrown, not
recorded as a rejection. Source aliases must
name turns of the session; the speaker must be the label of a cited turn; a
`resolvedFrom` without an `eventAt`, or the reverse, is rejected; identical
texts within one response are rejected. The rejection index names the first
failing observation.

## Supersession

An optional policy links a new observation to the latest current observation
with the same `facet` and `speaker`. The candidate set is the keyword lane
restricted to observation keys, at most 100 hits, re-parsed through this
profile; a candidate already superseded by another is skipped. When the
observation being linked is already committed, it and its own successors
(every candidate whose `supersedes` chain leads back to it, chains bounded at
8192 links, a looping chain counting as leading back) are skipped, so
re-applying the policy to a chain's predecessor leaves the chain as it is and
never closes a cycle. Observations of one session with the same facet and
speaker chain in response order ahead of the store's head. When the policy is
applied to a batch of already committed observations, the batch is processed
in session order regardless of the order the caller lists the keys in, and
same-facet, same-speaker records of the batch chain to one another in that
order ahead of the store's head under the ordinary conflict rule; the batch
order never decides chain direction, and a key listed twice counts once.

Session order is the receipt's session index, then its instant, then the key.
A missing session index is incomparable: two positions compare by index only
when both carry one, otherwise by instant alone, so an unindexed session is
never treated as earlier than every indexed one. The link records
`orderingConflict: true` when the chosen predecessor sits strictly later in
session order (index when both are known, then instant) than the observation
being linked, or when both statement dates contain a calendar date
(`YYYY-MM-DD` or `YYYY/MM/DD`, with an optional clock time) and the
predecessor's is later. A statement date without a calendar date takes part
only through session order. On a conflict both dates render. The policy never
chooses which value is correct.

When the lookup returns the full 100 hits, the true chain head may lie
outside the examined set; the link reports `candidatesTruncated` and the
receipt lists the affected observation keys so a consumer can re-link them or
account for the degradation.

## Rendering

A renderer places observations ahead of raw turns as
`Memory: [<statedAt>] <speaker> (<kind>): <text>`, followed by the event date
and its expression when present, `(superseded on <date>)` when a rendered
successor exists, and an explicit both-dates marker on an ordering conflict.
For a query that matches a bounded recommendation pattern, `preference`
observations are grouped first under `Remembered preferences (<facets>)`. The
renderer uses no model and is re-runnable from the stored records alone.

## Boundaries

- The library never dispatches a model call. The caller supplies an observer
  with a model identifier and an `observe(prompt)` function.
- Observations never replace raw turns; they are added beside them.
- The record codec can be registered only in a store whose `edition` kind is
  reserved for this profile: a registry keeps one parser per kind, so in a
  store that also holds turn records the turns would fail to parse. The
  library never registers it, and it is not part of the contract manifest.
- No ontology assertion is written, because an observation binds no subject,
  predicate, and object.
