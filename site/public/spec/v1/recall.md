# Recall and dated rendering V1

Recall is a read-only layer over V1 search. It runs one search per query,
optionally adds the records dated inside a resolved window, fuses these ranked
lists, and renders the result in date order under headers that are relative to
a question date. Each ranked list is a lane, recorded in result evidence as
`lane: "query"` or `lane: "window"`. Recall never widens the V1 search limit
of 1 through 100 results for any lane, never writes records, and never changes
the bytes of a record’s text. Records stay authoritative in SQLite, and recall
returns only results whose digest matches the current stored record.

## Recall response

Besides the store and any search backends, `recallOhV1` accepts:

- 1 through 6 distinct queries, each nonempty and at most 16,384 UTF-8 bytes;
- a per-query limit of 1 through 100 (default 10);
- a search mode: `keyword`, `semantic`, `hybrid`, or `rerank`;
- a question instant, `asOf`, which may be `null`;
- an optional window; and
- an optional view.

Every query runs as one ordinary V1 search with that limit and mode. When the
mode is omitted, the SDK selects the strongest configured backend as described
in [search and local reranking](retrieval.md).

Recall fuses lanes by reciprocal rank. A record at 1-based `rank` in a lane
receives `1 / (60 + rank)` from that lane, and its fused score is the sum over
all lanes. Results are sorted by descending score, then by record key in
UTF-16 code-unit order. The response holds at most `(queries + 1) × limit`
results.

| Field | Contract |
| --- | --- |
| `asOf` | The canonical UTC instant supplied by the caller, or `null`. |
| `diagnostics` | `semantic-unavailable` and `rerank-unavailable` entries from the underlying searches, and `window-unavailable` when the window scan could not run. |
| `mode` | The search mode applied to every query. |
| `queries` | The distinct queries, in the caller’s order. |
| `results` | Fused results, each with `evidence` (`lane`, `query` index or `null`, `rank`, and the lane’s `score`), the current record, and the fused `score`. |
| `window` | The window applied, or `null`. |

A window has exactly `since`, `until`, and `v: 1`. Both bounds are canonical
UTC instants, and `since` is no later than `until`. When a window is present,
recall adds one window lane: the current records whose view instant lies
inside the window, ordered by instant, then view order, then key, keeping the
first `limit`. The scan reads at most 65,536 current records. When the graph
holds more, recall reports `window-unavailable` and adds no window results.
The window lane never contacts a model or a provider.

## Views

A view is a function that maps one record to exactly four fields: `instant` (a
canonical UTC instant or `null`), `order` (an integer or `null`), `session`
(nonempty text, at most 512 bytes), and `text` (the exact text to render). The
default view reads the record value’s `observedAt` as the instant, `sessionId`
as the session, and `text` as the text, and sets `order` to `null`. A value
without a string `text` renders as its canonical JSON, and a record without a
valid `sessionId` forms its own session, named by its record key.

A view MUST NOT alter record text.

## Relative date grammar

`resolveRelativeDateWindowV1(query, asOf)` is a pure, rule-based function. Its
complete vocabulary is the table `oh.recall-date-grammar.v1`, published as
[`recall-date-grammar.json`](recall-date-grammar.json). Matching is
case-insensitive over NFC text. Every rule resolves to whole UTC calendar days
anchored on the question day, and weeks start on Monday. The table is frozen:
changing a pattern, a tolerance, or the vocabulary requires another grammar
version.

| Rule | Expression | Window |
| --- | --- | --- |
| `today`, `yesterday`, `tomorrow` | the word | that one day |
| `days-ago` | `N days ago` | exactly N days before |
| `weeks-ago` | `N weeks ago` | N weeks before, plus or minus 3 days |
| `months-ago` | `N months ago` | N calendar months before, plus or minus 15 days |
| `years-ago` | `N years ago` | N years before, plus or minus 45 days |
| `in-days`, `in-weeks`, `in-months`, `in-years` | `in N days`, `in N weeks`, `in N months`, `in N years` | the same tolerances after the question day |
| `last-week`, `this-week`, `next-week` | the phrase | the whole Monday through Sunday week |
| `last-month`, `this-month`, `next-month` | the phrase | the whole calendar month |
| `last-year`, `this-year`, `next-year` | the phrase | the whole calendar year |
| `last-weekend`, `this-weekend`, `next-weekend` | the phrase | the Saturday and Sunday of that week |
| `past-span` | phrases such as `in the last N weeks` or `over the past month` | from N units before the question day through the question day |
| `last-weekday`, `this-weekday`, `next-weekday` | `last Saturday`, `this Monday`, `next Friday` | the most recent such day strictly before, the day within the current week, or the first such day strictly after |

`N` is a positive number of one through three digits, or one of the words `a`,
`an`, and `one` through `twelve`. The articles `a` and `an` pair only with a
singular unit, and a `past-span` phrase without a count means one unit. A
calendar shift past the end of the target month clamps to that month’s last
day. When one matched expression contains another, only the containing
expression counts. The table’s `exclusions` then drop every remaining
expression whose prefix matches an exclusion pattern. The `anchored` exclusion
covers a prefix ending in `before`, `after`, `since`, `until`, `prior to`, or
`following`. In “the day before yesterday” and “since last week”, the matched
date is only a reference point, so both queries resolve to `null`. A query
with no remaining match, or with more than one distinct remaining match,
resolves to `null`; recall never guesses a window. The grammar assumes UTC,
so a host that knows the user’s time zone converts the question instant before
calling.

## Dated rendering

`renderOhRecallV1(response, { asOf, budgetBytes, view? })` produces one text,
identified as renderer `oh.recall-render.v1`, within a UTF-8 budget of 1
through 4,000,000 bytes. The renderer takes results in their given order,
which for a recall response is fused-rank order. A result that would push the
text over the budget is left out and counted, and a later, smaller result can
fit after it. A key that appears twice renders once. Whether a result fits
depends only on the exact byte count of the composed text. The renderer may
skip recomposing the text when a result fits within a fixed allowance for
headers and separators, and that shortcut never changes which results are
included.

With a question instant, the text contains:

- the line `Question date: YYYY/MM/DD (Www)`;
- one block for each session that has an instant, headed
  `Date: YYYY/MM/DD (Www), N days before the question`, with `after` for a
  later day, `the day of the question` for the same day, and `1 day` for an
  offset of one day;
- a gap marker such as `[3 weeks later]` between consecutive dated sessions on
  different days; and
- one block for each session with no instant, headed `Date: unknown`, after
  every dated session.

Dated sessions appear in order of their earliest instant, with ties broken by
session name in UTF-16 code-unit order. Within a session, records follow in
instant order, then view order, then response order, separated by blank lines.
A gap marker counts whole days below 14 days, whole weeks below 61 days,
30-day months below 365 days, and 365-day years from 365 days on. Each count
is rounded down and uses a singular unit when it is one.

Blocks are separated by one blank line. Without a question instant, the text
is the record texts in the given order, separated by blank lines, with no
headers. When no result fits, the text is empty and has no question-date line.
The rendering reports `keys` (the included keys in rendered order), `omitted`
(how many results did not fit), and `bytes` (the exact UTF-8 length). A
validator with the same results, question instant, view, and budget
reproduces the bytes exactly.

## Contract and command line

Recall adds no record kind, limit, contract entry, or migration to the V1
contract, and the V1 contract manifest does not mention recall. The
`oh recall` command resolves a window from its query with this grammar when
`--as-of` is given, and it renders under a fixed budget of 96,000 bytes. The
SDK exposes the same functions with a budget the caller chooses.
