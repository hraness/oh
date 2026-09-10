# Recall and dated rendering V1

Recall is a read-only composition over V1 search. It runs several bounded
searches, fuses their ranks, optionally adds the records dated inside a
resolved window, and renders the result chronologically under headers that
are relative to a question date. It never widens the V1 search limit of 1
through 100 results for any lane, never writes records, and never changes the
bytes of a record's text. Records stay authoritative in SQLite; every result is
rejoined to the current record digest by the underlying V1 search.

## Recall response

`recallOhV1` accepts 1 through 6 distinct queries, each nonempty and at most
16,384 UTF-8 bytes, a per-query limit of 1 through 100 (default 10), a search
mode (`keyword`, `semantic`, or `hybrid`; default `keyword`), an `asOf`
question instant or `null`, an optional window, and an optional view. Every
query is one ordinary V1 search with that limit and mode.

Fusion is reciprocal rank: each lane contributes `1 / (60 + rank)` for a record
at 1-based `rank` in that lane; a record's score is the sum over lanes. Results
are ordered by score, then by record key in code-unit order. The response holds
at most `(queries + 1) × limit` results.

| Field | Contract |
| --- | --- |
| `asOf` | The canonical UTC instant supplied by the caller, or `null`. |
| `diagnostics` | `semantic-unavailable` entries from the underlying searches and `window-unavailable` when the window scan could not run. |
| `mode` | The search mode applied to every query. |
| `queries` | The distinct queries in the order they were fused. |
| `results` | Fused results, each with `evidence` (`lane`, `query` index or `null`, `rank`, lane `score`), the current record, and the fused `score`. |
| `window` | The window applied, or `null`. |

A window has exactly `since`, `until`, and `v: 1`; both bounds are canonical
UTC instants with `since` no later than `until`. When a window is present,
recall adds one window lane: the current records whose viewed instant lies
inside the window, ordered by instant, then view order, then key, cut to
`limit`. The scan reads at most 65,536 current records; a larger graph yields a
`window-unavailable` diagnostic instead of a partial lane. The window lane
never contacts a model or a provider.

## Views

A view maps one record to `instant` (canonical UTC instant or `null`), `order`
(integer or `null`), `session` (nonempty text, at most 512 bytes), and `text`
(the exact text to render). The default view reads a record value's
`observedAt`, `sessionId`, and `text`; any other value renders as its canonical
JSON under its record key. A view MUST NOT alter record text.

## Relative date grammar

`resolveRelativeDateWindowV1(query, asOf)` is pure and rule-based. Its complete
vocabulary is the frozen table `oh.recall-date-grammar.v1`, published as
[`recall-date-grammar.json`](recall-date-grammar.json). Matching is
case-insensitive over NFC text. Every rule resolves to whole UTC calendar days
anchored on the question day; weeks start on Monday. The table is frozen:
changing a pattern, a tolerance, or the vocabulary requires a new grammar
version.

| Rule | Expression | Window |
| --- | --- | --- |
| `today`, `yesterday`, `tomorrow` | the word | that one day |
| `days-ago` | `N days ago` | exactly N days before |
| `weeks-ago` | `N weeks ago` | N weeks before, plus or minus 3 days |
| `months-ago` | `N months ago` | N calendar months before, plus or minus 15 days |
| `years-ago` | `N years ago` | N years before, plus or minus 45 days |
| `in-days`, `in-weeks`, `in-months`, `in-years` | `in N days`, ... | the same tolerances after the question day |
| `last-week`, `this-week`, `next-week` | the phrase | the whole Monday through Sunday week |
| `last-month`, `this-month`, `next-month` | the phrase | the whole calendar month |
| `last-year`, `this-year`, `next-year` | the phrase | the whole calendar year |
| `last-weekend`, `this-weekend`, `next-weekend` | the phrase | the Saturday and Sunday of that week |
| `past-span` | `in the last N weeks`, `over the past month`, ... | from N units before the question day through the question day |
| `last-weekday`, `this-weekday`, `next-weekday` | `last Saturday`, `this Monday`, ... | the most recent such day strictly before, the day within the current week, or the first such day strictly after |

`N` is a number of one through three digits or one of the words `a`, `an`,
`one` through `twelve`; a missing count in `past-span` means one. A calendar shift
past the end of the target month clamps to that month's last day. When one
expression contains another, only the containing expression counts. Any
query with no match, or with two distinct matches, resolves to `null`; recall
never guesses a window. The grammar assumes UTC; hosts that know the user's
zone convert the question instant before calling.

## Dated rendering

`renderOhRecallV1(response, { asOf, budgetBytes, view? })` produces one text
under renderer `oh.recall-render.v1` with a UTF-8 budget of 1 through
4,000,000 bytes. Results are admitted in their given (fused rank) order; a
result whose admission would exceed the budget is omitted and counted while
later, smaller results may still fit. Duplicate keys are rendered once.

With a question instant the text is:

- the line `Question date: YYYY/MM/DD (Www)`;
- each session in chronological order under
  `Date: YYYY/MM/DD (Www), N days before the question` (or `after`, or
  `the day of the question`), its records in instant, then order, then
  admission order, joined by blank lines;
- a gap marker such as `[3 weeks later]` between consecutive dated sessions on
  different days (days below 14, weeks below 61 days, months below 365 days,
  years otherwise);
- sessions with no instant last, under `Date: unknown`.

Blocks are joined by one blank line. Without a question instant the text is the
plain rank-ordered list of record texts joined by blank lines, with no headers.
The rendering reports the admitted keys in rendered order, the omitted count,
and the exact byte length; a validator that holds the same records and the
same question instant reproduces the bytes exactly.

## Boundaries

Recall does not add a record kind, a limit, a contract entry, or a migration;
the V1 contract manifest is unchanged. The `oh recall` command applies the
grammar to its query when `--as-of` is given and renders under a fixed 96,000
byte budget; the SDK exposes the same functions with the caller's budget.
