# Site migration baseline

This collector prepares reproducible native evidence for the Oh site's styling
migration. It does not change the website, install dependencies, publish a
release, or contact a deployment provider. The first checkpoint contains the
collector and pure tests only: no browser baseline or migration has passed yet.

## Scope

The legacy source is commit
27f0587f599b15f0eb657d6c084f0c006915edc9. The collector requires a clean descendant
whose only changes are the files in this directory. Product source, CLI behavior,
the public specification, release metadata, and package manifests remain at that
legacy commit. The installed profile is Next 16.3.3, React 19.2.6, React DOM
19.2.6, and the unchanged frozen site lockfile.

The earlier preparation used 692c0f8. A normal fast-forward added the unrelated
benchmark-only PR #53 before any native run; the complete site and root manifests
were byte-identical. The baseline binds the new complete commit, not an exception
allowlist for changed product inputs.

There are 58 layout/media cells. Each has both JavaScript-enabled and
JavaScript-disabled observations, for 116 observations in a fixed order:

| Family | Routes | Widths | Appearance | Cells |
| --- | --- | --- | --- | --- |
| Ordinary | Home, specification | 375, 480, 481, 512, 513, 768, 769, 1280 | Light, dark | 32 |
| Coarse pointer | Home, specification | 375, 1280 | Light, dark | 8 |
| Forced colors | Home, specification | 375, 1280 | Light, dark | 8 |
| Reduced motion | Home, specification | 375, 1280 | Light | 4 |
| Print | Home, specification | 1280 | Light | 2 |
| Missing page | Missing route | 375, 1280 | Light, dark | 4 |

Every observation validates actual viewport and media queries while reading
computed styles, including pseudo-element font, color and transform properties.
Font and animation readiness bracket the complete synchronous layout read.
Captures use natural animations and the initial caret mode.
Their before/after state must match without correcting viewport dimensions,
scroll positions, focus, content, or computed values. Host-side finite polling
observes fonts and animations synchronously, so the no-JavaScript path does not
depend on page-side promises or animation-frame callbacks. The actual HTML's
executable Next bootstrap and its runtime array also bind the requested script
mode without injected DOM, globals or styles.

Screen observations of the two product routes use native Tab and Enter for the
skip link, ordinary links, and the first-run disclosure. All eight native FAQ
disclosures are opened and closed; both install commands exercise native
horizontal scrolling when they actually overflow. A closed state inventory
covers header/current navigation, primary/secondary actions, the first-run
summary, body links, Ask-AI and the home footer. The captures record visible
focus and hit-test evidence, desktop sticky travel, static mobile behavior,
coarse target size, and actual command overflow when present. Print and missing
pages retain strict route-specific checks rather than fabricated interactive
targets. Both modes keep the same assertions. Links to external services are
inspected but never followed; subresources must be loopback HTTP.

## Focused checks

No install is needed for the pure tests. From the repository root:

    bun test site/verification/stylex-native/contract.test.mjs site/verification/stylex-native/support.test.mjs

The tests exercise finite case membership, snapshot media fences, screenshot
options and order, no-JavaScript-compatible settlement, terminal acceptance,
native-focus requirements, and injected process/resource failure controls.
Injected controls do not constitute native process, browser, or rendering proof.

Syntax-check each authored module with the approved Node runtime's --check
option. Use the repository and host schedulers when a check actually performs
heavyweight or native work.

## Native command after review and preparation

First obtain the reviewed baseline-source, frozen script-disabled dependency
install, browser toolchain, and scheduler joins. Do not run the collector as an
installation workaround. It requires Node 24.18.1, Bun 1.3.14, a separately
provisioned playwright-core 1.62.0 entry, and the exact approved Chromium
executable version and SHA-256. All paths and executable digests are explicit
arguments, not private paths embedded in source:

    node site/verification/stylex-native/collect.mjs \
      --repo ABSOLUTE_CLEAN_OH_CHECKOUT \
      --expected-head EXACT_COLLECTOR_COMMIT \
      --output ABSOLUTE_ABSENT_EVIDENCE_DIRECTORY \
      --bun ABSOLUTE_BUN_EXECUTABLE \
      --node-sha APPROVED_NODE_SHA256 \
      --playwright ABSOLUTE_PLAYWRIGHT_CORE_ENTRY \
      --chromium ABSOLUTE_CHROMIUM_EXECUTABLE \
      --chromium-sha APPROVED_CHROMIUM_SHA256 \
      --chromium-version APPROVED_CHROMIUM_VERSION

Run this complete command through the HRA browser-auth lane and the Jungle
exclusive scheduler. It invokes the existing site command, bun run build, once
(including the site's existing prebuild and postbuild tests), then starts that
production output on one owned loopback port. It does not run next dev or claim
HMR/state continuity.

The clean build, server and browser environment preserves the schedulers' eight
inherited worker-limit values exactly, including a smaller configured pool.
Missing, malformed or over-budget limits stop the collector; it never supplies
a replacement budget. The two opaque scheduler custody bindings pass unchanged
to children but appear only as byte counts and hashes in the receipt. This is
environment preservation, not independent lease authentication. No general
environment copy, credentials, provider settings or session variables enter the
child environment.

The absolute collection deadline is 1,800 seconds, including the build;
individual observations have a 60-second bound. Every failure is terminal for
that invocation. Build output and evidence are retained; there is no rerun,
install, CSS injection, screenshot masking, or manual cache cleanup.

## Receipt boundaries

The receipt records the legacy base, current source commit/tree, tracked
source blobs/modes/hashes, full installed-file and link inventories, selected
framework versions, runtime/compiler/browser identities, build output hashes,
media, role counts, screenshot/state digests, resource records, and process
custody. Full logs and native artifacts belong in the selected private evidence
directory, never in the public repository.

Completion is written only after attempted context/browser/server collection,
exact observed PID/start-identity cleanup, original child exit/close/EOF joins,
loopback absence, and source/install/executable/build preservation checks.
Signals target only positively observed descendants; unresolved custody keeps
the receipt failed. This is bounded observed-process evidence, not a claim that
an unobserved arbitrary daemon cannot exist. The collector never uses process
names or broad process-group signals.

A complete legacy receipt is a baseline, not migration acceptance. A later
reviewed compiled-StyleX implementation still needs immutable dependency pins,
complete compiler source census, focused/canonical gates, comparison against
these native observations, current-head PR checks, merge, and deployment proof.
