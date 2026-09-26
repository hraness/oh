# Optional development support

Oh is free, every feature works without an account, and nothing here changes
that. `oh support` lets the CLI mention, from time to time, that you can pay for
Oh’s development if it helped, and gives you the switches to quiet it.
Requires 0.10.2 or newer.

## What you might see

After a useful command, such as `init`, `put`, `get`, `list`, `log`, `search`,
`recall`, `tombstone`, `sync export`, `sync import`, or
`research prepare-packet` that exits with status 0, the CLI may write a note to
stderr. Standard output and exit codes never change. The SDK, help, `oh
contract`, `oh verify`, and failed commands stay quiet, and CI environments
turn the note off.

`HRANESS_SUPPORT_AUDIENCE` chooses who the note is for:

| Value | What happens |
| --- | --- |
| `agent` (default) | One JSON line for a coding agent, at most once every 10 minutes. This holds in a pseudo-terminal too. |
| `human` | A short invitation on an interactive terminal: once after the first useful result, then at most once every seven days. |
| `off` | Nothing. |

Setting `HRANESS_SUPPORT=off` also silences the note.

There is no newsletter and no email lookup. Any payment happens in your
browser, after you read the current terms there, and no command can authorize
one.

## Commands

| Command | What it does |
| --- | --- |
| `oh support protocol --json` | Prints the procedure an agent follows when it closes out a task. |
| `oh support offer --json` | Returns an invitation to show, or `kind: "quiet"`. |
| `oh support shown ID` | Records that an invitation appeared. |
| `oh support release ID` | Cancels an invitation that was not shown. |
| `oh support status --json` | Prints the current preferences. |
| `oh support dismiss` | Stops invitations. |
| `oh support snooze` | Pauses invitations for 30 days. |
| `oh support enable` | Turns invitations back on. |

These commands never open or change an Oh database. They keep their state in
`$XDG_STATE_HOME/hraness/support`, or `~/.local/state/hraness/support` when
`XDG_STATE_HOME` is unset. Other Hraness tools on the same device read the same
preferences, so a dismissal or snooze applies to all of them.

Agents follow the procedure in the
[Agent Skill](../skills/oh/SKILL.md#handle-optional-development-support):
read the protocol once at the end of a successful task, show at most one
invitation, and honor `off`, dismiss, and snooze.
