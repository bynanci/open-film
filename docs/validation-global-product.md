# Global Product Experience and i18n validation — 2026-10-06

This round starts from merged `main`
`10caced98a22b79116f2ec63a965ed9e25c9b272` on
`codex/global-product-i18n`. The branch's PR checks record the exact candidate
commit and remote execution result; this document records the local evidence.

## Previous round and Resolve evidence

[PR #1](https://github.com/bynanci/open-film/pull/1) merged candidate
`729f33083076282e4247c53ffec91b06dd5593c2` after all four correctness review
threads were resolved: import-scoped Insta360 association indexing, accepted media
preview formats, current-state Fit suggestions and paged media availability above
2,000 assets. Its [PR checks](https://github.com/bynanci/open-film/actions/runs/37387623001)
and [merged-main checks](https://github.com/bynanci/open-film/actions/runs/37387995045)
passed.

No actual Resolve import evidence exists in the accessible repository/workspace.
The [QA record](resolve-qa-record.md) remains **not run**. The compatibility model,
Desktop card and [matrix](nle-compatibility.md) distinguish implementation,
schema/parser checks, real NLE verification and manual recreation. No feature is
newly certified by opening an OTIO file with its parser.

## Automated gates

Local verification uses Linux x86_64, Node 24.14.0, pnpm 11.11.0, FFmpeg/FFprobe
7.1.5, ExifTool 13.59.3, Chromium 151, official OpenTimelineIO 0.18.1 and Rust
1.99.0. Fixtures are generated public-domain media. No private media, translation
API or cloud provider participates in the workflow.

| Gate                               | Local result                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                | Passed repository formatting.                                                                                                                               |
| `pnpm lint`                        | Passed with warnings denied.                                                                                                                                |
| `pnpm typecheck`                   | Passed TypeScript and Vue checks.                                                                                                                           |
| `pnpm test:i18n`                   | Passed 732 semantic keys in each of en-US, zh-TW and ja-JP, including parameter parity, error codes and literal UI references.                              |
| `pnpm test`                        | Passed 391 tests across 43 files.                                                                                                                           |
| `pnpm build`                       | Passed CLI, server and Vue production builds.                                                                                                               |
| `pnpm test:e2e`                    | Passed all 18 browser cases with no skips.                                                                                                                  |
| `pnpm test:interchange`            | Passed official OTIO read/write/read, real source hash/bounds validation and existing XML checks; the missing-source negative regression fails as intended. |
| `pnpm test:native`                 | Passed Rust formatting, Clippy and test-target execution. Rust targets contain zero behavior tests; this does not exercise a native window or installer.    |
| `node scripts/smoke-built-cli.mjs` | Passed the built CLI's real media workflow.                                                                                                                 |

The CI workflow runs these gates, installs local CJK fonts and uploads browser
artifacts. Local browser execution sets `OPENFILM_CHROMIUM=/usr/bin/chromium` and
`OPENFILM_OTIO_PYTHON` to the installed parser environment. Native checks use the
workspace's documented sysroot; CI additionally builds the native target.

## Product and persistence coverage

- A full Traditional Chinese browser journey creates a Proposal film, imports
  generated media, organizes memories, builds a localized story, edits and locks
  clips, renders a preview and downloads an actual MP4. JSON inspection verifies
  stable internal data and preserved user-authored text.
- English and Japanese journeys exercise actual browser uploads, story/edit
  workspaces, OTIO export, compatibility disclosure, localized errors and
  Settings. Language switching preserves the mounted application and film;
  restart/reopen restores preferences and edits.
- Content-language tests cover template ownership, unchanged fields, cleared
  intents, custom titles, legacy projects and undo/redo. HTTP regressions verify
  saved/reopened project defaults and sparse updates. A delayed Story save test
  proves that newer typing stays dirty instead of being silently discarded.
- Normal creation uses a configured default location without requiring an
  advanced project path. Browser-managed media can move with a project; unsafe
  paths and Windows cross-drive escapes are rejected. Unicode names, spaces,
  `#` and `&` are exercised without translating or changing source paths.
- Editing retains trim, photo duration, reorder, speed/volume, transitions,
  lock protection, autosave, undo/redo and recovery. Fit Preview does not save;
  Skip recomputes the plan and Apply checks its current state. Independent row
  savings are not misrepresented as the combined plan's total.
- Existing Proposal, relink and 500-clip regressions remain in the browser gate.
  A cache-recovery test deletes a managed thumbnail, reimports the same asset and
  verifies the existing card recovers without changing source bytes or identity.

## Screens and accessibility

Visual/browser checks cover en-US, zh-TW, ja-JP and development-only en-XA at
1280×720, 1440×900 and 1920×1080, with an additional 1024px layout check. Screens
include Welcome, Create Film, Import, Library, Story, Edit, Export, Resolve
details, Settings, errors, missing media and file/folder recovery dialogs.

Assertions check document overflow, visible actions, long titles and paths,
missing translation keys, keyboard focus and light/system/reduced-motion states.
The MP4 action is fully visible at 1280×720. Token tests check actual foreground/
surface contrast pairs; rendered core screens report zero violations in the
configured axe WCAG A/AA checks. This is not a certification of every assistive
technology or operating-system dialog.

An initial browser run exposed a stale test heading and an overflowing long
pseudo-localized Resolve hint. The selector now targets the editor's semantic
state and the destination surface wraps long text. The affected cases and then
the complete 18-case suite passed without relaxing layout assertions.

A final launcher adjustment routes required-field validation through the existing
localized inline messages instead of browser-language native popups. The affected
Traditional Chinese full workflow passed again with new empty-name and invalid-
duration assertions; the repository gates and PR CI cover the resulting candidate.

The first remote push and PR runs each passed 17 browser cases but failed the
500-clip case. Holding the real startup availability request reproduced the
failure: navigation appeared enabled before boot finished, while its handler
discarded clicks during the busy state. Navigation now exposes that disabled
state. The regression gates and releases the actual request, then retains all
500-clip assertions. Five focused repetitions and the full 18-case suite passed
with `CI=1`; subsequent PR checks record remote verification of the fix.

Screenshots and generated MP4 files live under `test-results/` during execution
and in CI's `browser-test-results` artifact. The local complete-run archive is
`/tmp/openfilm-global-browser-final`; these generated outputs are not committed.

## Manual verification still required

- Real DaVinci Resolve import, playback, media relinking and save/reopen with the
  exact application version, OS, project frame rate, OpenFilm SHA and fixture
  recorded. Speed, volume/mute, transforms, crossfades and titles still require
  manual recreation; parser validation does not establish visual fidelity.
- Real native Windows installer, picker/window behavior and removable-drive
  disconnect/reconnect. Linux lexical path tests do not certify Windows hardware.
- Representative real Pixel HDR/Motion Photo and Insta360 raw sources. Generated
  metadata and supported flat-export fixtures do not certify camera-specific
  extraction, stitching or reframing.

No requested automated gate is blocked by a missing local dependency. These
manual platform/media gates remain distinct from completed source implementation.
