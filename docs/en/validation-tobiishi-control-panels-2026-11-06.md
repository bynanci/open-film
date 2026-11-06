# Tobi-ishi control-panel validation — 2026-11-06

## Candidate and scope

Implementation source: `9209059458e831339d36fe6380628c2fda13fa98`.

Base: `d332fb3265077ca08f218f6ba9b6c65d2519eaa2` (`main`, re-fetched on
2026-11-06). The `codex/tobiishi-control-panel` candidate includes the existing
Garden Stone workspace changes, preserved as commit `3644e79`, and a merge of
that base at `9bcc420`. This record describes local verification, not hosted CI
or a native release.

The candidate shares design tokens and original angular backing planes, reduces
duplicate General-mode navigation, and adds guarded quick actions, keyboard
Inspector tabs and a device-local collapse preference. Story authoring fits its
content, uses a 1:1.618 narrative/media split on wide desktops, and keeps script
review mounted behind disclosure. Library status occupies a compact band;
Export uses one outer task surface. Storyboard pairs text and timing with media
instead of reserving a separate full-width empty row. Selection uses a soft
backing with stable insets. Original media, project schema and processing engines
are unchanged by this UI slice.

Transcript playback is outside the independently scrolling transcript list.
Row summaries clamp to four lines; the selected editable text and stored document
remain complete. This fixes player interception of long transcript row actions.

## Automated evidence

| Check                                                            | Result and limits                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` | Passed locally.                                                                                                                                                                                                                                 |
| `pnpm test:i18n`                                                 | Passed: 3,162 semantic keys across en-US, zh-TW and ja-JP.                                                                                                                                                                                      |
| `pnpm test:docs-i18n`, license, provenance and partition checks  | Passed locally; documentation counts may increase with this record.                                                                                                                                                                             |
| `pnpm test`                                                      | Full run executed: 448 files, 5,891 cases; initially 5,800 passed and 91 failed. See the specific reruns below; this is **not** recorded as a single green full run.                                                                            |
| Seven affected unit/integration files                            | All passed after fixes: 209 UI-host cases, 65 NLE handoff cases and 30 native benchmark runner cases. One new closed-disclosure test raises total verified unique cases to 5,892.                                                               |
| `pnpm test:e2e`                                                  | Full 345-case run executed: initially 319 passed, 26 failed. Corrected cases passed in successive `--last-failed` runs: 22, 1 and 3. All 345 unique cases were exercised successfully across the full run and reruns.                           |
| Final focused browser checks                                     | Passed: 16 core visual, Tobi-ishi control and Story workflow cases after the final Storyboard refinement.                                                                                                                                       |
| `pnpm test:interchange`                                          | Passed: 18 tests and official OpenTimelineIO 0.18.1 parsing/serialization/source validation. Real Resolve import remains unverified.                                                                                                            |
| `pnpm test:native`                                               | Partially runnable: Rust 1.99.0 installed and `cargo fmt --check` passed. Clippy stopped with exit 101: missing `gobject-2.0.pc` / GLib development libraries. Cargo tests did not run after that failure. This user environment has no `sudo`. |
| Hosted exact-head CI                                             | Not claimed. Git transport works, but GitHub API authentication returns 401/403 in this environment. Check the published branch's required checks before merging.                                                                               |

Initial failures were investigated rather than suppressed. Missing OTIO was
resolved by installing OpenTimelineIO 0.18.1. Native benchmark runner tests use
port 4310, so they were rerun after the application browser server stopped.
Isolated SFC hosts were updated for the shared lighting/preferences dependencies
and complete script disclosure. Browser assertions now use semantic Inspector
tabs and the single global Pipeline entry point. The source-image probe was
moved below the sticky header; its RGB tolerance and white-edge threshold were
retained. Frame-click testing uses the middle of a frame cell, preserving the
engine's floor convention. Long transcript regressions exercise complete
4,096-character edits, glossary matching, rejected oversized saves and recovery.

A new Storyboard readability assertion reproduced the actual selected-state
failure: title contrast 2.13:1, timing contrast 1.13:1 and an unnecessarily tall
329px short-content card. The obsolete pseudo-element selection rule was removed.
The browser test requires at least 4.5:1 for titles and timing on selected and
unselected backing planes, and a content-sized short-fixture card below 300px.
These checks do not impose a height cap on authored long content.

## PR #119 current-head follow-up — 2026-11-06

The current follow-up is based on `main`
`b6304914a7eb351d8e5d0a0a11b41e163713e20b` and includes PR #119 updates through
`e205f3bbedc65061f3520d00995546afdeaf80cb`. The previous exact-head run
[42190592757](https://github.com/bynanci/open-film/actions/runs/42190592757)
passed fast-contract, heavy-media, docs-site, native-shell and all three render
QA platforms. Browser shard 1 failed two direct-clip hit-test checks; Windows
media recovery failed the split-review import helper before it observed the two
source cards. Those findings were investigated and corrected in this follow-up.

The follow-up keeps the f98 modal work and its theme/focus/contrast E2E checks,
retains project-generation fencing for lazy Import focus, and reconciles the
sidebar breakpoint with the remote change: labels remain visible at 1200px and
1101px, and the 76px icon rail starts at 1100px. The Windows import helper now
waits for and validates the durable `POST /api/import-draft/sources` response
and saved selection count before asserting rendered cards. Entering picture
adjustment now samples the source viewport after Vue applies the adjustment
toolbar, preventing the toolbar reflow from leaving stale first-frame monitor
dimensions and clipped resize hit targets.

The exact-head Verify run
[42195116358](https://github.com/bynanci/open-film/actions/runs/42195116358)
on `4da316f3666a106918a72e12d8fbea78be088ac3` exposed three stale or timing-
sensitive browser assertions: the cancellation test expected two identically
named `Add media` buttons although the completion summary intentionally has one
`Add more media` action; two direct-clip tests hit resize handles calculated
before the toolbar reflow; and the audio-preview test expected the Inspector
tabs to use `display:flex` although the current two-column design uses CSS grid.
Browser shard 1 had 86 passes and 3 failures, shard 2 had 86 passes and 1
failure. Shards 3 and 4, fast-contract, heavy-media, docs-site, native-shell,
all three Render QA platforms, Windows recovery and DCO passed. The legacy
`typescript-and-media` aggregate failed only because the required-lane guard
observed the two failed browser shards; its media checks were not run as a
separate job. The new local regressions exercise the single completion action,
post-layout resize geometry and current Inspector layout without weakening the
render, hit-target or import-cancellation behavior.

A follow-up local repetition also showed that the cancellation test waited for a
transient `Import cancelled` notice even after the durable completion summary
had changed to `Import stopped`. The test now waits for that persistent status
and confirms `/api/jobs` contains a terminal cancelled import before checking
the project and reopening Import. This tests the completed cancellation state
instead of depending on notification timing.

After the `4da316f` browser failures were corrected, PR branch commit `b2e44c7`
preserved the monitor controls and added viewport diagnostics. Its Verify run
[42198971760](https://github.com/bynanci/open-film/actions/runs/42198971760)
reported three failures in browser shard 1 (`86 passed`): the resize handle
still extended below the source viewport at 1024×720; the native-caption test
timed out while the saved cue still had its prior text; and the language test
expected a welcome tagline in the Edit workspace, whose actual heading is the
film title. The first is addressed by measuring the source viewport after the
adjustment toolbar reflows. The caption test now waits for the matching
`POST /api/compositions/:id/edit` response, checks its status and then checks
the saved cue. The language test now checks the selected locale, the localized
timeline region and translated validation feedback. Shards 2–4, fast-contract,
heavy-media, docs-site, native-shell, Windows media recovery and all Render QA
platforms passed. A follow-up raises the transform overlay above the source
image, so the right-side handles remain visible and hit-testable. The legacy
`typescript-and-media` guard failed only because
it observed `BROWSER_RESULT: failure`; its fast, media and docs results were
successful.

On PR head `316e741aadfcf3b41508e8f99c9689850d6ad18c`, Verify run
[42201643719](https://github.com/bynanci/open-film/actions/runs/42201643719)
found one additional compact-height defect in browser shard 1: at 1024×720 the
picture toolbar wrapped, leaving the source viewport 22px below its player row
and overlapping the Story rail. The lower half of the bottom-right touch target
then hit the source image. The same run's fast-contract, docs-site, native-shell,
Windows media recovery, and Windows/macOS Render QA jobs passed. Browser shards
2 and 4, heavy-media QA, and Linux Render QA were cancelled after the browser
failure; they are not passing evidence. The required-lane aggregate therefore
failed. The CSS follow-up reserves more player height at short desktop
viewports and reduces the minimum preview height so the source viewport stays
inside its row. The coarse-pointer E2E now asserts row boundaries as well as all
four hit targets.

After rebasing onto the concurrent PR commits through `e205f3b`, the local
cross-workflow regression run found a transient low-contrast frame when theme
colors animated together. The final styles change navigation and workflow text
and backgrounds atomically while keeping shadow motion. The axe theme/focus
regression passed after this correction.

Local evidence on the reconciled, unpushed worktree:

| Check                                  | Result                                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused interaction/theme E2E          | 52/52 passed across captions, direct clip manipulation, global visual/axe, Professional Cut Desk, and Story workflow UX.                                                                                                                              |
| Compact-height touch resize regression | 5/5 passed at 1024×720; preview and Story rows remain disjoint and all four 44px targets receive hits.                                                                                                                                                |
| Native caption persistence regression  | 5/5 passed with durable edit response and reopen assertions.                                                                                                                                                                                          |
| Theme contrast and keyboard focus      | 1/1 passed after making text/background theme updates atomic; axe reports no contrast violations.                                                                                                                                                     |
| Local fast-contract and build checks   | `format:check`, `test:i18n` (3,198 keys), `lint`, `typecheck`, `test:contracts` (77 files / 1,504 tests), and `build` passed.                                                                                                                         |
| Bundle advisory                        | TimelineEditor is 589.37 KB minified, above the existing 500 KB advisory; build succeeds.                                                                                                                                                             |
| Hosted verification                    | On `e205f3b`, fast-contract, docs-site, native-shell, Windows recovery, all three Render QA platforms and DCO passed. Browser shard 1 reproduced the 1024×720 resize-hit failure; shards 2–4 passed and heavy-media was still running when inspected. |
| Full Vitest                            | Not rerun after rebasing onto the latest PR commits; the current focused contract suite passed.                                                                                                                                                       |

The prior `main@b630491` Verify, Windows media recovery and Render QA pass in
[run 42171211968](https://github.com/bynanci/open-film/actions/runs/42171211968).
It does not replace required exact-head CI for this follow-up. Real Windows/macOS
installer, signing/notarization, workstation, Resolve, GPU/4K and listening checks
remain separate gates.

## Interaction and visual coverage

Desktop captures cover en-US, zh-TW, ja-JP and expanded en-XA at 1280×720,
1440×900 and 1920×1080; compact layout checks also cover 1024px. The focused
tests verify Inspector arrow/Home/End navigation, collapse persistence, guarded
Import/Fit actions, script preservation and the wide Story proportion. Existing
browser cases cover drag/reorder, Story/Precision selection, keyboard operation,
Undo/Redo, locked/pinned edits, failure recovery, save/reopen and the 500-clip
rail's lazy decoding and selection rendering boundary.

Screenshots use generated sample media. Public imagery belongs to the separate
website candidate; ordinary application tests do not require those assets.
Passing browser/axe/token tests is not certification of every screen reader,
native system or input device.

## Remaining manual gates

- Required hosted checks on the exact published candidate and merge revision.
- Linux native checks with GTK/WebKit/GLib development dependencies; real Windows
  and macOS installer, keyboard and display-scale checks.
- Real workstation startup/one-hour memory measurements, camera media and audio
  listening checks. Synthetic browser measurements do not replace them.
- Real DaVinci Resolve import and save/reopen evidence; keep its workstation gate.

## Follow-up — browser shard 4 and variant touch close

Verify run [42260127413](https://github.com/bynanci/open-film/actions/runs/42260127413)
on PR head `6d051b9458a924bb23d339a94957788f1804d349` completed with browser
shard 4 failing one Storyboard geometry check (`87 passed`), while fast-contract,
shards 1–3, heavy-media QA, docs-site and all three Render QA jobs passed. The
native-shell job was cancelled when the aggregate run ended; it is not passing
evidence. The failure measured 3px of `scrollHeight` overflow against a 1px
limit. A local reproduction found that the blurred, translated Tobi-ishi `::after`
shadow contributes those pixels even though the card's content boxes remain
inside its bounds. The regression now measures the card's direct content items
against its padded bounds, excluding only that decorative pseudo-element while
still enforcing the 1px limit on content overflow.

The same inspection reproduced a separate asynchronous touch issue: the variant
list response changes the centered modal's layout after the close target has
been measured. The list grid now reserves a minimum height and exposes a
localized loading status with `aria-busy`; the coarse-pointer close target
remains at least 44×44px. A deterministic Playwright regression holds the list
response, asserts the close button moves no more than 1px, then dispatches a real
Chromium touch and verifies the modal closes and focus returns to its trigger.
Exact-head full CI for this follow-up is pending.

### Local verification on the latest PR base

After syncing `ccbd74ef599dc533d424e0bbe797d5360ce224e7`, the follow-up was
reapplied without changing that commit's content-bound measurement. Local
verification completed as follows:

| Check                                                 | Result                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Touch close regression                                | 3/3 passed with the asynchronous list response held and released.                                                     |
| Component redesign + Tobi-ishi workflow browser specs | 15/15 passed, including modal focus return, 44px touch target, viewport/theme checks and storyboard content bounds.   |
| Format, localization and documentation                | `format:check` passed; `test:i18n` passed with 3,213 semantic keys; `test:docs-i18n` passed with 169 English mirrors. |
| Static and contract checks                            | `lint` and `typecheck` passed; `test:contracts` passed (77 files, 1,504 tests).                                       |
| Build                                                 | Passed. The existing `TimelineEditor` chunk advisory remains at 590.14KB minified, above 500KB.                       |

On the synced PR head `ccbd74e`, hosted Verify run
[42263471483](https://github.com/bynanci/open-film/actions/runs/42263471483)
has fast-contract, all four browser shards, docs-site and native-shell successful;
heavy-media QA is still running. Windows media recovery and Linux, Windows and
macOS Render QA runs are successful. These checks cover `ccbd74e`, not the
follow-up commit below it. Exact-head hosted verification remains required.
