# Native Caption Track validation

This record covers M2 / F04 from the M1–M5 route in
[creative-scene-platform.md](roadmap/creative-scene-platform.md). The candidate
starts at main `089eaf20541391d59c81da075d739bcd3844ceb4` on
`codex/m2-native-caption-track`. Final full-gate results are recorded below after
they pass; local evidence does not replace checks on the exact published head.

## Behavior and safety boundary

CaptionTrack and CaptionCue are versioned Composition data. Cue IDs survive
text/time changes; transcript cues bind asset, transcript revision, segment,
source range and originating clip. Import uses the existing caption snapshot
service and rejects stale project, Composition, source or transcript evidence.
Unavailable word timestamps stay segment-aligned; the product never derives
word timing from segment text. Manual text and time changes increment that cue's
manual revision. Style is saved on the track. Existing Composition commands
continue to own autosave, Undo/Redo, reopen and revision conflict handling.

Edit places cue blocks on the current Composition-duration rail and uses the
existing command queue for text, multiline input, timing, font and safe-area
changes. Transcript import is shared through Application, HTTP and CLI. MP4
rendering uses the existing measured title rasterizer and FFmpeg overlay filter;
SRT/WebVTT remain separately serializable with exact millisecond cue times.
No source media is rewritten and no project-authored HTML or JavaScript runs.

## Synthetic FFmpeg evidence

`packages/render/tests/native-captions.test.ts` creates a three-second MP4 using
FFmpeg lavfi (`color` plus a 440 Hz sine tone), with no private input. It renders
a Traditional Chinese segment cue, checks H.264/AAC streams with FFprobe, and
decodes RGB frames before, during and after the cue. The active frame contains
measurable centered glyph pixels within the configured lower safe region; the
before/after frames contain no bright glyph pixels. The source SHA-256 remains
unchanged and is present in the render manifest. The estimated-timing warning is
present with the exact manual-review wording; a stale-alignment warning is not
invented. SRT and WebVTT retain `00:00:00.900`–`00:00:01.500` and the literal
Traditional Chinese text.

This generated fixture verifies the renderer, timing gate and evidence path. It
does not establish voice quality, CJK font design quality on another machine,
physical-display readability, 4K performance or any downstream NLE behavior.

## Test results

The final local candidate passed the required automated gates:

| Command                 | Result                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`     | Passed.                                                                                                                                           |
| `pnpm test:i18n`        | Passed; 1,420 semantic keys match in English, Traditional Chinese and Japanese.                                                                   |
| `pnpm lint`             | Passed with zero warnings.                                                                                                                        |
| `pnpm typecheck`        | Passed for TypeScript and Vue.                                                                                                                    |
| `pnpm test`             | Passed; 183 files and 2,761 tests. Includes the actual synthetic FFmpeg caption render regression.                                                |
| `pnpm build`            | Passed. Vite reported a >500 kB JavaScript chunk advisory.                                                                                        |
| `pnpm test:e2e`         | Passed; 160 Chromium browser tests, including the native caption import/edit/reopen workflow.                                                     |
| `pnpm test:interchange` | Passed with OpenTimelineIO 0.18.1; 18 harness cases, real-source URL/hash/bounds checks and relocation gate. Real Resolve import is not verified. |
| `pnpm test:native`      | Not run: this environment has no `cargo` or `rustc`.                                                                                              |

The browser suite used the onboarding environment's Chromium executable. The
focused UI regression imports saved segment captions, edits Traditional Chinese
text and timing, font size and safe area, checks retained source locks and
Undo/Redo, then closes and reopens the project. Exact-head CI remains pending
until the candidate branch is pushed and a PR is opened.

## Manual gates

No user media, private film, voice recording, external model/provider, hardware,
physical display, 4K workstation or Resolve/NLE was used. Those gates remain
unrun and are not implied by the synthetic MP4 result. Exact-head CI and review
status are reported with the PR after publication.
