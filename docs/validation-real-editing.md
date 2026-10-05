# Real Editing Workflow validation — 2026-10-05

The round started from `main` commit
`259a59c37d2f126ea456bb1f3ba2de1344fbf88c` and extends the existing architecture
on `codex/real-editing-workflow`. The review is
[PR #1](https://github.com/bynanci/open-film/pull/1); its checks record the exact
validated commit. The original foundation record remains in
[validation.md](validation.md).

The complete workflow at `2174e49728e7167f2406ce87cb85b8c257974c60` passed both
source/media/browser and native jobs in
[Verify run 37345829780](https://github.com/bynanci/open-film/actions/runs/37345829780).
The PR checks remain the source of truth for subsequent commits.

## Environment and gates

Local verification uses Linux x86_64, Node 24.14.0, pnpm 11.11.0, FFmpeg/FFprobe
7.1.5, Perl 5.40.1, bundled ExifTool 13.59.3, Chromium 151, official OpenTimelineIO
0.18.1 and Rust 1.99.0. No private camera media, paid provider or Resolve application
was used. The CI workflow independently repeats these gates on Ubuntu 24.04 using
its packaged FFmpeg and Playwright Chromium.

| Command                            | Result and scope                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`                | Passed; repository formatting.                                                                                                                                                 |
| `pnpm lint`                        | Passed with zero warnings.                                                                                                                                                     |
| `pnpm typecheck`                   | Passed strict TypeScript and Vue checks.                                                                                                                                       |
| `pnpm test`                        | Passed 306 tests across 30 files, including actual media/SQLite/HTTP integration regressions.                                                                                  |
| `pnpm build`                       | Passed CLI, server and Vue production builds.                                                                                                                                  |
| `pnpm test:e2e`                    | Passed eight browser journeys covering editing, save recovery, cancellation, relinking, the Proposal reference workflow and a 500-clip timeline.                               |
| `pnpm test:interchange`            | Passed official OTIO 0.18.1 read/write/read, real source URL/hash/bounds validation and existing FCPXML XML/resource checks. A missing-source negative case fails as intended. |
| `pnpm test:native`                 | Passed Rust formatting, Clippy with warnings denied, and test-target compilation/execution. Rust targets contain zero tests; native window behavior is not exercised.          |
| `node scripts/smoke-built-cli.mjs` | Passed actual built CLI import, analysis, composition, playable preview, exports and reopen; original hashes unchanged.                                                        |

The local browser command uses `OPENFILM_CHROMIUM=/usr/bin/chromium` and
`OPENFILM_OTIO_PYTHON` pointing to an isolated Python environment containing the
official pinned parser. Local native checks use the documented workspace sysroot;
CI installs Tauri dependencies and additionally runs `cargo build --locked`.

The Global UX preflight repeated these gates after the four review fixes. Seven
browser journeys passed in the full run; the Proposal journey reached its final
parser check but failed because that invocation omitted `OPENFILM_OTIO_PYTHON`.
It passed when rerun with the installed parser environment. The failure was a
test environment selection error, not a waived product assertion.

## Behavior verified

- Clip trim, duration, order, transform, speed, volume, transition, lock and
  replacement commands enforce source bounds and protect locked edits. Beat
  regeneration stays within its selected beat; explainable Fit suggestions retain
  protected clips. History and revision tests cover undo/redo, replay, stale
  clients, atomic save failures and reopening.
- Missing/offline libraries preserve catalog and timeline state. Single/folder
  relinking revalidates candidates and hashes, rejects ambiguous or changed
  matches, and preserves edits. Reopening a moved project recovers relative and
  legacy cache references. Windows drive/UNC normalization is tested on Linux;
  this is not a physical Windows remount test.
- Device fixtures exercise Pixel metadata, conservative generic fallback,
  experimental Motion Photo detection, Insta360 flat exports, raw associations,
  and unsupported 360 states. Generated HEVC 10-bit HLG/PQ sources are converted
  to SDR previews without changing original hashes. Real-camera color and
  Motion Photo extraction are not certified.
- Reliability regressions cover failed render jobs, changed source bounds,
  absent/empty proxies, raw360 playback rejection, relinking identical files with
  changed timestamps, reused original paths and stale spherical classification.
- The Proposal browser journey imports 15 generated assets, selects favorites and
  required/rejected memories, edits the timeline, locks a clip, regenerates one
  beat, reorders by dragging, exercises undo/redo and Fit, renders an actual
  18-second MP4, closes/reopens with edits intact and exports JSON/OTIO. The
  official parser reads its seven clips, verifies its 18-second duration and
  resolves every referenced source. All fixture hashes remain unchanged.

Successful browser runs retain the generated preview, timeline/report screenshots
and official-parser evidence under `test-results/`; CI uploads that directory for
review. These are generated CC0 assets, not private user media.

## Manual verification still required

The subsequent Global Product Experience preflight found no real Resolve import
evidence in the repository, PR discussion or accessible workspace artifacts.
Generated/parser fixtures are not application QA. The
[Resolve QA record](resolve-qa-record.md) remains explicitly **not run**.

1. Actual DaVinci Resolve import, playback and reopen. Speed, volume/mute,
   transforms, crossfades and titles are **metadata only** in OTIO and require
   manual recreation. Native cuts and official parser success do not certify
   NLE appearance. Follow [the compatibility matrix and QA procedure](nle-compatibility.md).
2. Representative real Pixel HDR, DNG and Motion Photo samples, and real Insta360
   `.insv`/`.insp` associations. Raw stitching, gyro processing, automatic
   reframing and Motion Photo video extraction are outside this implementation.
3. Physical removable-disk reconnects on Windows and actual native picker/window
   interaction. Logical volume identity and relinking are implemented; hardware
   automount discovery and a self-contained installer are not claimed.

The 500-clip browser regression uses 500 actual catalog locations and one cached
thumbnail per clip. It verifies lazy image loading, one video element, requests
only for the three deliberately selected sources, playback and a persisted edit.
It asserts behavior rather than a machine-dependent latency target. No
archive-scale throughput or memory benchmark is claimed.
