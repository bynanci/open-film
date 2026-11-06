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
