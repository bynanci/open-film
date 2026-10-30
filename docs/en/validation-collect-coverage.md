# D6B — reviewed derived Collect delivery

Date: 2026-10-30. PR: [#65](https://github.com/bynanci/open-film/pull/65).
Base: `9c392b7cc8d46f4768d76f30bef30d0397cca8f8` (merged D6A #64).
Status: derivative execution implemented; independent review findings fixed and
full local unit/integration and browser suites passed. Exact-head hosted gates
passed; merged PR65 as5160d8f185686b2a83f3e6657cfe2f1e9b7de335. No workstation certification or release claim.

## State and compatibility

The existing Collect service owns review, capture, rights, cancellation,
publication and verification for SDK/API/CLI/Desktop. Source coverage is a
read-only `review-only`/`executable:false` projection, with a SHA-256 `coverageId`
binding normalized delivery options, source hashes, saved revision and baseline
plan. Creation separately requires that ID, `projectId`, `acceptDelivery:true`,
`planId` and `baseRevision`. Changed options, sources or project identity invalidate
acceptance. Server project switching remains fenced through cleanup.

No source media, canonical asset, project file, Undo/Redo, job, autosave or schema
is changed. Conversion applies only to a private captured package. Source IDs,
Composition timing, speed, locks and manually revised captions are preserved;
only source-clock offsets in the portable copy change. Full-original creation
without delivery options retains manifest v1; v1 verification remains supported.
Project schema remains 1.0.0 and Catalog v6; no dependency or license changes.

## Recipes, clocks and bounds

- `trimmed-originals`: measured zero-origin CFR SDR yuv420p video becomes FFV1 +
  precision-preserving PCM AVI; audio becomes PCM WAV. These are newly encoded lossless
  derivatives, not unchanged originals. They can be larger than compressed source
  files. No byte saving is inferred from retained seconds.
- Handles default to 2 seconds, bounded 0–10. Windows expand outward to measured
  frame/sample boundaries, merge overlaps and preserve disjoint intervals. Each
  receipt records original/derived hashes and monotonic piecewise source/offset
  windows. A clip crossing an unmapped interval fails closed.
- Locked sources/clips, images/360, immutable catalog evidence, detached
  transcript-caption clocks, opaque graph/layout references and unknown metadata
  retain full originals. VFR, offset/HDR/rotated/non-square-pixel sources and clocks
  that cannot be represented exactly retain originals with typed reasons.
- `offline-proxies` reuses the existing proxy generator on private captured
  sources. It retains full source clocks and explicitly acknowledges lower
  resolution/compression. Metadata, reopened Export UI and renderer warnings
  (`collect.offline-quality`) preserve that disclosure; output cannot recover
  original master quality. No private cache receipt/file is packaged implicitly.
- Limits: existing ZIP32/source/package bounds, at most 128 windows per derived
  source, 600-second/36,000-frame source inspection, 2 GiB per derivative/private
  render, ZIP32 working-source bound, and at most 100 five-minute 1080p/60
  Compositions for derived validation. Larger requests fail explicitly. Private
  paired render files are deleted after each comparison.

Lossless AVI may require preparing a fresh local preview through the existing
Library proxy controls on a new workstation. The package does not include a
private playback cache. FFmpeg output continues to read the portable source.

## Actual output and relocation

Every selected Composition is rendered twice before publication: captured
originals and the converted package. Retained source windows are independently decoded and hashed, preserving native
integer/float sample precision as well as pixels, including unused handles. Both
real MP4s are decoded to per-frame
SHA-256 records and float PCM audio hashes. Frame count, duration, picture and
samples must match exactly for trimmed delivery; no epsilon or weakened assertion
is used. Offline delivery records both signatures and requires complete timing,
without claiming master parity. Cancellation, source rehash/revision changes or
failed parity abort the private stage before no-replace publication.

Manifest v2 has closed delivery, recipe, lineage, retained-source and parity
records. Unknown versions/fields, invalid/overlapping clocks, identity/quality
mismatches and malformed parity fail before relocation rendering. Directory and
stored ZIP reuse the existing exclusive destination and path/hash safety owners.
Verification privately relocates/reopens and re-renders every selected Composition
against the recorded delivered signature. Creator baseline receipts are local
measurements, not signed third-party attestations.

## Local evidence inspected

- Prior D6A logs really contain 314 files / 4,464 tests and 288 Chromium passes;
  those are predecessor evidence, not a D6B full-gate claim.
- Task2 checkpoint: 11 focused suites / 140 tests; 3 read-only browser workflows.
- Task3: 14 real derivative regressions pass (`/tmp/openfilm-d6b-review-green.log`):
  synthetic 8-second long-GOP H.264/AAC, two disjoint uses, speeds 0.5/1.5/2, quarter-second
  handles, real ZIP/directory relocation, unchanged original hash/project/catalog,
  locked transcript identity, manually revised Traditional Chinese captions,
  strict v2 errors, offline output warnings, cancellation, VFR fallback and a
  source changed after copy. Forty decoded output frames and PCM compare exactly.
- Shared source review/acceptance/UI/transport focused suites pass; actual CLI
  and HTTP create the same reviewed delivery through the application owner.
- Three actual Chromium workflows pass in 20 seconds (`en-US`, `zh-TW`, `ja-JP`),
  covering rights → explicit quality accept → create → verify, reset on option
  changes, keyboard/native labels, scoped axe and 375/720/1280px layout.
- Final source candidate `c0983a4f53af145a35c1ff6be2b958a2915eaad0` passes
  **321 files / 4,535 tests** in419.41s, exit0, including every review regression.
  Log:`/tmp/openfilm-d6b-fixed-all-tests.log`. TypeScript/Vue, lint, build and
  formatting pass on that source; **291/291 Chromium cases pass in22.6m**
  (`/tmp/openfilm-d6b-fixed-e2e.log`). Official OTIO0.18.1 interchange
  **18/18** and the built CLI smoke pass after the fixes.
  Build retains the existing large-chunk advisory. Final docs/toolchain checks
  and exact-head hosted gates are refreshed separately. Results will be bound to the final candidate below.
  Local Cargo/native prerequisites remain absent; hosted native and physical
  Windows/macOS evidence must be reported separately.

### Retained synthetic FFmpeg proof

FFmpeg 7.1.5 (Debian), 160×90 at 20 fps, 8-second moving testsrc2 plus 880 Hz
tone, long GOP160/B-frames. Windows `[0.75,2.25)` and `[4.75,7.25)` compact to
`[0,1.5)` and `[1.5,4)`. The existing 2-second Composition remains unchanged.

| Evidence                       | SHA-256 / result                                                   |
| ------------------------------ | ------------------------------------------------------------------ |
| Original source                | `1962b344a4a598e4f9c0a03014a40c5143233b6365834c0af41dc147c8775146` |
| Lossless derivative            | `78d0ff3f51c409761c6142bdb410427af4038c9a6aa2a59373362a656f9e0bd9` |
| Original MP4                   | `f8be3a6a582476b9bd29e9000df64d0fa363eff03c77fe12853c897ad3634c91` |
| Delivered MP4                  | `f8be3a6a582476b9bd29e9000df64d0fa363eff03c77fe12853c897ad3634c91` |
| Decoded video records          | `528ce5dc2856c970b3e9d09cd060e120d8d8d96bba652c83ff110a17b551c7db` |
| Decoded float PCM              | `624a9cbcd9706de5a45b4444eb901b2da5fde5f3785fb80af36a5baf6c4b919a` |
| Stream evidence                | `40 frames · 2 seconds · H.264/AAC mono48k`                        |
| Original project/catalog/asset | `all unchanged`                                                    |

Both real MP4s, original/derived media, directory/ZIP packages and JSON receipts
remain in private temporary evidence storage; no media is committed or uploaded.
The local locator is `/tmp/openfilm-d6b-evidence-location.txt`, with command log
`/tmp/openfilm-d6b-ffmpeg-evidence.log`. CI regenerates synthetic inputs.

## Bugs found and regression evidence

The lossless test exposed input-timebase-dependent speed sampling: AVI's frame
clock truncated fractional PTS that MP4's finer clock represented. The shared
renderer now applies `settb=AVTB` before speed scaling. Before/after decoded
picture/audio equality passes, with the Composition unchanged.

The old PR65 checkpoint CI failed `proxy-cache-http` (409 after ready). A controlled
real-file cleanup barrier reproduced the cause: the worker published a hard-linked
preview as ready, then scratch cleanup changed its ctime/link identity while a
reader hashed it. The owned scratch alias is now removed before ready identity is
recorded. The regression requires one link, unchanged ctime through cleanup and
exact HTTP bytes; existing corruption/alias defenses remain asserted. RED:
`/tmp/openfilm-proxy-publication-red.log`; GREEN: 39 tests across 2 suites in
`/tmp/openfilm-proxy-publication-green.log`. No retries, sleeps or assertion
weakening mask the race.

## Independent final review and fixes

Fresh-context review of candidate `7f00e06dc51590f39edc58fd3abb7aeeac0d8d01`
identified four Important findings. A single TDD fix pass addresses all four:

1. Preserve native PCM precision (including every PCM32 low bit), and independently
   hash all retained source pixels/samples. Lossy MP4/AAC equality is an additional
   film gate, not proof of source losslessness. Unhandled precision/layout keeps
   originals; the first recipe supports measured mono/stereo layouts.
2. A new review clears acceptance even when request props stay identical; a new
   coverage ID/revision always requires another explicit acceptance.
3. Verify enforces v2 duration/resolution/count limits before render, propagates
   the 2 GiB output cap, deletes preview before export, and deletes each completed
   film before rendering the next. Actual small-byte truncation is rejected
   before publication; tests never fill the disk deliberately.
4. JSON/OTIO/FCPXML/EDL reports and supported artifact metadata/comments retain
   offline status and sanitized lineage. Native source copies, baked precomps and
   full-mix handoff preserve the warning; no extension secrets are copied.

All eight reproductions failed before the fixes (`/tmp/openfilm-d6b-review-red.log`)
and the 25 focused cases pass afterward. Native/baked NLE handoff also had two
real failing cases before its propagation fix. A broader NLE run initially used
a Python without OpenTimelineIO; that failed environment attempt is retained,
then rerun with the existing pinned 0.18.1 virtual environment. No parser test
was skipped or weakened. Whole-suite and full browser runs are refreshed after
these final source changes.

Deferred Minor: Collect's verification section still summarizes warning count;
the specific offline-quality explanation is shown during explicit acceptance and
in reopened Export/renderer/NLE reports. This presentation improvement remains a
follow-up, not a hidden claim that the review had no findings.

Review boundaries: physical workstation/filesystem/NLE/hardware observations and
cross-version FFmpeg/perceptual quality are unverified. Exact signature checks
fail closed if toolchain behavior differs; a legitimate package may require
reverification/recreation with its intended toolchain. Automated evidence does not
replace these manual observations.

## Open gates

Independent whole-branch review and its four Important fixes are complete.
Full local unit/integration/browser, format/i18n/docs/lint/types/build, official
interchange and built CLI smoke passed. Exact-head608377ae3877935db1f8c16616360008cf146801
PR run41032257039 and push run41032248438 passed, including4535tests,291browser,
23Rust and2archive tests. PR checkoutc855876 combines base132cac1/head608377a.
Merged to main5160d8f185686b2a83f3e6657cfe2f1e9b7de335; no release. Application/test/workflow sources are unchanged from verified
`c0983a4f53af145a35c1ff6be2b958a2915eaad0`; later commits integrate research
and validation documentation only. Windows/macOS filesystems, physical
large-drive behavior, native FFV1 playback/proxy preparation, hardware/4K/GPU,
real audio listening, typography and actual NLE relink/finishing remain manual.
The Windows `popo-pc` workstation is not connected to this cloud workspace.
No manual gate, installer issue or release is closed by synthetic Linux evidence.

## Research and version checkpoint

Latest main research commit:`132cac1db46eb9f85b35426c1ba55073462e715b`
(`research/README.md` and the October synthesis) is integrated. Its scope/benchmark/
model proposals remain research hypotheses and reference the existing authoritative
TASKS/ROADMAP; no duplicate implementation queue or new version commitment is
introduced. Research Markdown formatting is normalized to satisfy the repository
format gate, with content preserved. Latest published stable release remains
`v0.4.0` (2026-10-20). The next version follows the scope actually merged and its
release/manual gates, not the external paper's phase labels. Windows issues66–68
are tracked by a separate recovery branch and actual Windows/FFmpeg9 CI evidence.
