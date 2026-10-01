# Update Oh

Automatic updates require Oh 0.14.1 or newer. Upgrade an older installation
once through its package manager.

Supported Bun and npm global installations on macOS and Linux check for a
newer release at most once a day before a command starts. Automatic updates are
enabled by default. Help, version output, CI, and commands already running do
not trigger an update. If another command is using the installation, the
update waits for a later invocation.

```sh
oh update status --json
oh update check
oh update
oh update disable
oh update enable
```

Set `HRANESS_NO_UPDATE=1` to suppress automatic updates for an invocation.
Exact Bun version installs stay pinned until `update enable`. Ordinary Bun
ranges, tags, and GitHub release archive installs track newer releases. npm
does not reliably retain the original global version constraint; use
`update disable` to keep an npm global at its installed version.

Source checkouts, local project dependencies, temporary `bunx` or `npx`
installs, linked copies, and copied skill scripts keep their existing update
process. On Windows, update through the package manager. Library imports do
not check for updates or change installed code.

The updater stores its preference, last check time, and installation/process
records locally. It keeps verified archives beside the global installation
because the package manager may reference them. Keep an archive while the
installation references it. Update checks send no application data to the release service.

Updates use immutable GitHub releases and require an authenticated
[GitHub CLI](https://cli.github.com/) (`gh`).

Research commands stay offline and keep the installed version.
