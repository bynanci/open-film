# Photo-film quality validation

This record covers the generated 20-second A/B calibration workflow, using
[the public fixture generator](https://github.com/bynanci/open-film/tree/main/fixtures/photo-film-quality).
It contains no user photographs, original films or private audio.

## Automated evidence

Run:

```sh
pnpm exec tsx scripts/photo-film-quality.ts /tmp/openfilm-photo-quality-evidence
```

The script renders real MP4s using `FFmpegRenderer`, stores both compositions
and their structural diff, verifies source hashes against renderer-generated
manifests, checks duration and audio-stream presence with FFprobe, extracts
24 frames per variant, and measures integrated loudness, true peak and overall
RMS. A narrow-band music measurement can expose whether the synthetic music
is attenuated during the known narration-tone interval. It cannot measure
speech intelligibility or whether the mix is pleasant.

Both variants use the candidate renderer. A is a minimal contain/fixed-gain
recipe for comparison, not a render from an older binary or the supplied private
film. B changes only the documented composition decisions over the same sources.

The fixed comparison checks these distinct design operations:

| Operation          | A                    | B                                         |
| ------------------ | -------------------- | ----------------------------------------- |
| Portrait           | Contain              | Protected hero framing and gentle push-in |
| Landscape pair     | Contain              | Hero framing with protected region        |
| Detail             | Static contain       | Focused framing and bounded pan           |
| Paired memories    | One primary source   | Two explicit diptych sources              |
| Wide edge subjects | Contain              | Protected hero request with safe fallback |
| Text               | Legacy default title | Film title / scene statement / subtitle   |
| Audio              | Fixed gain           | Fade-in/out and manual ducking            |
| Duration           | 20 seconds           | 20 seconds                                |

## Execution record

Re-executed on 2026-10-18 at 00:31 UTC using FFmpeg 7.1.5 on Linux, with the
corrected implementation frozen at `8baa2740eea22bcb2f33a29647839c12a7585b31` on
`codex/photo-film-quality`. The run explicitly records `workingTreeDirty: false`.
The local `implementation-sources.json` lists hashes of the actual core,
renderer, fixture and runner source files. Its SHA-256 is
`6a10222797e296f6f28792bd41667f05a64045c96c20501a76b7f1f6fed2aadf`.
This is local execution evidence for that committed implementation, rather than
CI, human listening or workstation evidence. Later validation/CI-configuration
commits do not change that implementation identity.

| Measured output                          |           A |           B |
| ---------------------------------------- | ----------: | ----------: |
| Container duration                       |    20.000 s |    20.000 s |
| Video frames (FFprobe)                   |         600 |         600 |
| Integrated loudness                      |  −21.2 LUFS |  −22.9 LUFS |
| True peak                                |  −11.1 dBFS |  −14.2 dBFS |
| Overall RMS                              | −23.27 dBFS | −25.16 dBFS |
| 220 Hz music band, before narration tone | −26.08 dBFS | −26.07 dBFS |
| 220 Hz music band, during narration tone | −25.96 dBFS | −37.04 dBFS |

Both MP4s contain audio, every renderer manifest source hash matches its
generated source, and all ten original source files retain the same bytes
after rendering. B's music-band measurement decreases by approximately
10.96 dB during its ducking interval; A changes by approximately 0.11 dB. These
are measurements of this synthetic fixture, not a general loudness target or
an assessment of speech intelligibility.

The actual extracted frames show the hero portrait, two-source diptychs,
three Traditional Chinese text roles, a 0.2-second dissolve and the wide
protected-region contain fallback. The manifest records only the expected
`PHOTO_PROTECTED_REGION_CONTAIN_FALLBACK` advisory for B. The comparison
scenario tests verify that the push-in and pan remain active and safe instead
of silently falling back to holds. Frame labels occupy an added strip outside
the decoded image, so they do not cover the subtitles under review.

Output SHA-256:

- A: `3161b86cc6071f6b34249a7ddbc5cbe4d25a7289ffef9466e5772fab625e6ad4`
- B: `50efd58bb33accdf78d078c23d2918af02732921a6ad37760bfe3ba86f65a376`

Both hashes and all listed audio measurements match the earlier clean
`025bead76ce4303382a1bb785798776ccf24eb14` and
`ae61376ee8e9413e0982c00075053a2fe297b7c1` runs. Their MP4s, manifests,
source identities, summaries and Python-environment failure trace were archived
locally before each rerun. The 2026-10-18 00:05 UTC `025bead` run used the same
fingerprinted core/renderer/fixture source digest as this run; the newer fixes
affect other application/editor paths. The initial `ae61376` run's
2026-10-17 23:30 UTC source digest was
`9ea26157c2343b9a01ecf93468628f11809e99c2bcde282f3ed1972f7cec5bcc`.
Both regenerated 24-frame contact sheets were inspected after the corrected run;
the requested framing, motion, title and transition samples remain present.

The fixture scenario regression tests pass (3 tests): unchanged 20-second
timing and source library, rejection of an incomplete library, and safe active
motion with intentional crop fallback. Scoped ESLint and Prettier checks pass.
Actual aesthetic judgment, listening and projection are still manual gates.

## Corrected implementation regression ledger

The frozen `8baa2740eea22bcb2f33a29647839c12a7585b31` implementation has these
complete local non-browser results. Its browser/CI outcomes are recorded
separately on [PR #18 checks](https://github.com/bynanci/open-film/pull/18/checks);
earlier implementations' browser history below is not substituted for them.

| Gate                         | Result                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `pnpm format:check`          | Passed                                                                         |
| `pnpm test:i18n`             | Passed: 1,275 keys                                                             |
| `pnpm lint`                  | Passed                                                                         |
| `pnpm typecheck`             | Passed                                                                         |
| `pnpm test`                  | Passed: 158 files, 2,273 tests in 110.40 seconds                               |
| `pnpm build`                 | Passed                                                                         |
| `pnpm test:interchange`      | Passed: official OTIO 0.18.1 parser and compatibility harness                  |
| Built CLI smoke              | Passed: real CJK/render/reopen workflow                                        |
| Focused photo browser suite  | Passed: 11/11 in 1.1 minutes                                                   |
| Corrected-head browser suite | Recorded separately on PR #18 checks; earlier-head browser counts do not apply |
| `pnpm test:native`           | Not runnable locally: `cargo` is unavailable                                   |
| Published-head CI            | Recorded separately on PR #18 checks; local results do not substitute          |

## Historical `025bead` implementation checks

The preceding `025bead76ce4303382a1bb785798776ccf24eb14` implementation passed
157 files / 2,251 Vitest tests in 109.42 seconds and a complete 119/119 browser
run in 16.4 minutes. The later validation-only head
`df22ae18e5642a63b6fcf7a8db5e12f2af3ae1f8` also had successful CI. These results
precede four additional correctness fixes and do not validate the newer
`8baa274` implementation or its expanded 121-case full browser suite. Current
browser/CI evidence remains linked to PR #18 checks.

## Historical initial implementation checks

The following results belong to
`ae61376ee8e9413e0982c00075053a2fe297b7c1`, before the follow-up review fixes.
They do not describe the corrected implementation's larger test suite.

| Gate                    | Result                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`     | Passed                                                                                                   |
| `pnpm test:i18n`        | Passed                                                                                                   |
| `pnpm lint`             | Passed                                                                                                   |
| `pnpm typecheck`        | Passed                                                                                                   |
| `pnpm test`             | Passed: 153 files, 2,213 tests                                                                           |
| `pnpm build`            | Passed                                                                                                   |
| `pnpm test:interchange` | Passed: official OTIO 0.18.1 parser and compatibility harness                                            |
| Built CLI smoke         | Passed                                                                                                   |
| Complete browser suite  | 116 passed / 1 environment failure in 16.5 minutes; separate configured retry 1/1 passed in 32.7 seconds |
| `pnpm test:native`      | Not runnable locally: `cargo` is unavailable                                                             |
| Published-head CI       | Recorded separately on candidate PR checks; local results do not substitute                              |

Earlier failed attempts remain part of the record. The first full regression
attempt exposed a static resvg import/bundling failure; the implementation now
loads that runtime lazily. A later attempt had seven port-4310-related test
failures while a separate browser suite was running concurrently. After fixing
that test orchestration and running the suites serially, all 153 files / 2,213
Vitest tests passed. These earlier failures are not counted as successful runs.
The native lifecycle helper tests inside Vitest do not replace the unavailable
Rust/Tauri gate or actual native workstation operation.

The complete browser run finished with 116 passing tests and one environment
failure in 16.5 minutes. The invocation omitted `OPENFILM_OTIO_PYTHON`, so the
Proposal workflow's parser check fell back to a system Python without OTIO.
Its failure trace remains in the local evidence directory under
`proposal-python-environment-failure/`. A separate `--last-failed` retry using
the verified OTIO 0.18.1 virtual environment passed the remaining test in 32.7
seconds (29.4 seconds in the test), without an implementation change:

```sh
OPENFILM_CHROMIUM=/usr/bin/chromium OPENFILM_OTIO_PYTHON=/tmp/openfilm-interchange-venv/bin/python3 pnpm test:e2e --last-failed
```

All 117 cases were exercised successfully across these attempts. This is not
recorded as a single successful 117-test run. Remote CI is recorded independently
on the candidate PR checks.

The previous base's successful exact-head Verify job
[`38997528797`](https://github.com/bynanci/open-film/actions/runs/38997528797)
took approximately 19 minutes, including 15 minutes of browser coverage, against
a 20-minute job limit. The expanded photo-film suite raises that job budget to
30 minutes while retaining every gate and the existing per-test timeouts. This
is CI capacity headroom, not a runtime performance improvement.

## Initial implementation correctness review

Independent final review reproduced and corrected three Desktop issues before
the implementation was frozen:

| Reproduced issue                                                                                   | Corrected behavior and regression                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A saved motion-only photo used a static monitor while FFmpeg applied motion.                       | Presentation activates for motion without requiring a layout field. The browser reopens a motion-only clip, seeks its endpoint and plays/pauses without mutating the film. |
| A saved diptych's explicit gap remained when choosing contain or hero, blocking validation.        | Single-photo layout commands remove diptych-only data. The browser changes a persisted gap-16 diptych to hero, undoes it, and changes to contain.                          |
| Undo/Redo restored audio trim/speed in data but left the audio element at its prior playback rate. | Audio preview reconfigures from the restored source range and speed. The browser verifies rate and current source time through Undo and Redo.                              |

The focused photo-quality browser suite passed all seven tests. Supplementary
regressions cover title-only photos/videos using the shared title raster outside
source transforms, unsupported native audio playback staying paused, the combined
editing/history/reopen flow and localized desktop layouts. An independent
compiled-SFC reproduction also confirmed the three corrected behaviors.

Scoped rendering/source-isolation review additionally covered actual decoded
FFmpeg pixels at motion samples, two diptych inputs, real mixed-audio fades and
ducking, original preservation when an output aliases a source through a hard
link, missing-font/glyph errors and source-bound export manifests. HTTP coverage
rejects titles requested for another project or stale revision. These checks
exercise implementation correctness; they do not establish hardware playback,
human listening, photographic aesthetics or real Resolve import.

## PR #18 follow-up correctness review

The corrected `8baa2740eea22bcb2f33a29647839c12a7585b31` implementation addresses
twelve unique follow-up P2 issues: the preceding round's five newly valid bot
findings and three independent-review findings, followed by three newly reviewed
correctness issues and one historical-style recovery issue. Each has regression
coverage. Current non-browser and focused browser results remain distinct from
the historical complete browser runs above.

| Finding                                                            | Correction and regression coverage                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unbounded new title/raster input                                   | Bound new commands and rasterization at 8,000 UTF-16 code units while keeping legacy project reading compatible. Reject invalid new edits before mutation.                                                          |
| Sound controls offered ordinary Story audio as overlay-editable    | List/control only explicitly designated overlay tracks; compiled-component tests retain ordinary audio outside the Sound controls.                                                                                  |
| One failed/stale photo layer corrupted the current presentation    | Recover layers independently and ignore events from obsolete layer resources; verify primary/secondary replacement and recovery.                                                                                    |
| Diptych gap could equal or exceed output width                     | Atomically reject an invalid gap before project/history mutation, using the actual project frame width.                                                                                                             |
| Empty overlay tracks blocked restrictive interchange               | Remove empty tracks on edit and preserve cleanup through history/reopen; FCPXML/EDL ignore legacy empty tracks.                                                                                                     |
| Incompatible media could replace/configure audio                   | Remove automation when replacements have no audio; preserve/clamp compatible curves. Reject silent-video configuration; Undo restores the original automation.                                                      |
| Sparse title defaults changed on editing/clearing                  | Preserve resolved role defaults, explicit overrides, text-only edits and clear/Undo semantics; cover sparse/legacy title styles.                                                                                    |
| Relinked Sound source reused stale playback/buffer                 | Bind playback to current URI/reconnect version, pause the old buffer and ignore obsolete errors; exercise same-ID source changes.                                                                                   |
| Effective title tracking failed only after save/render             | Preflight tracking against resolved role/default typography and project size before mutation; cover authored styles with omitted font size.                                                                         |
| Replacing visual media discarded its graphic title style           | Preserve title styling across source replacement and cover replacement/history behavior.                                                                                                                            |
| Visual overlay clips disappeared from selection controls           | Keep visual overlay clips selectable without offering audio overlays as visual clips; verify the available edit targets.                                                                                            |
| A readable historical subtitle style crashed Inspector setup/watch | Display safe defaults and a localized inline warning without mutating saved style. An explicit Reset preserves text; Undo restores the old style while recovery, text correction and clear controls stay reachable. |

One bot report repeated the already-corrected legacy-title rendering issue.
The alleged P1 PNG selector failure was not reproduced with actual FFprobe:

| FFprobe version | Actual PNG selector result      |
| --------------- | ------------------------------- |
| 6.0             | Reported failure not reproduced |
| 7.0.2           | Reported failure not reproduced |
| 7.1.5           | Reported failure not reproduced |

The probe now nevertheless declares `format:stream` sections explicitly, with
real generated PNG/JPEG regression tests for dimensions and codec metadata.
This is recorded as explicit selection and coverage, not as proof that the
reported PNG failure existed on those versions.

Fresh independent review of the frozen corrected source passed all four latest
findings. The focused photo browser suite passed 11/11 tests, including actual
reopen/reset/Undo recovery for historical invalid title tracking. Component
regression helpers use the declared public
`vue/compiler-sfc` entry point rather than an undeclared transitive Node module.
Neither that review nor generated-media tests establish hardware playback,
private-film aesthetics, human audio listening or actual Resolve QA.

## Manual gates

- Inspect actual start/middle/end frames and transition edges for crop loss,
  inappropriate overlap, drift, missing characters and unreadable text.
- Listen to real narration, original audio and licensed music; a synthetic
  gated tone cannot verify intelligibility or emotional continuity.
- Test real portrait/landscape originals, actual CJK project text and intended
  projection/playback hardware. No user image or attachment is a public fixture.
- Windows native operation, hardware/camera sources and real Resolve finishing
  remain separate workstation gates.

## D5A photo finishing candidate

On 2026-10-30, the approved D5A implementation was validated from base
`e1255b1a8a83260149211d909cca8c1a50948c6b`. Product commits are `feabe3b`
(portable variants/math), `9faeb5c` (verified raw ambient/render), `a502e8d`
(preview/transaction fencing) and `c225259` (focal UI/compatibility fixes).
This is candidate evidence; fresh whole-branch review and the complete
exact-head gate remain coordinator-owned before merge. The existing D5A task
remains open for those gates.

| Focused check                                                                           | Result                                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Core/solver/application/HTTP/UI/export regression batch                                 | 16 files / 294 tests passed                                      |
| Actual renderer/easing/ambient/photo quality/capability                                 | 4 files / 31 tests passed                                        |
| Existing real PhotoDepth fallback/legacy plus new v2 fidelity handoff                   | 2 selected real-media cases passed                               |
| New photo finishing plus existing photo quality/Film Looks/Record Monitor browser files | 37 tests passed in 2.5 minutes                                   |
| TypeScript and Vue type checking                                                        | Passed                                                           |
| UI localization                                                                         | 2,678 semantic keys match in en-US/zh-TW/ja-JP                   |
| Scoped lint                                                                             | 38 changed TypeScript/Vue files, zero warnings                   |
| Documentation locales                                                                   | 10 README locale families / 124 English reference mirrors passed |

No full Vitest, native/benchmark or uncoordinated browser run was performed.
The browser run used the coordinator's exclusive 4310/1420 slot, exited 0 at
session 90055, and both listeners were confirmed stopped before release.
Local tools were Node 24.19.0, pnpm 11.19.0, FFmpeg 7.1.5 and Chromium
151.0.7922.173. FFmpeg 6.1 and other OS/native behavior still require their
exact-head CI gates.

The renderer produced a real 6.000-second, 320×180, 30 fps / 180-frame H.264
MP4. Frame times were `0`, `90/30` and `179/30`; the last sample is not the
excluded six-second duration endpoint. Actual Monitor screenshots were taken
from the existing component at 320×180 CSS pixels and an integer viewport
position, with no resampling. Independently measured visible regions returned:

| Measurement                                    | Observed             | Declared limit |
| ---------------------------------------------- | -------------------- | -------------- |
| Ambient mean absolute RGB error                | 1.6618–1.7273 levels | ≤12            |
| Sharp foreground mean absolute RGB error       | 2.4146–3.3723 levels | ≤12            |
| Monitor/decoded foreground landmark difference | 0 pixels             | ≤1.5 px        |

Both Monitor pixels and decoded MP4 pixels repeated exactly at repeated indexes
in seek order `0,90,179,35,140,179,0,90`. Deliberately removing fill, applying dim
twice, applying color twice, or holding the wrong curve position triggered the
corresponding region/channel/landmark failure. A separate actual FFmpeg
perspective test compared six curves × 257 samples, including endpoint-flat
and exponent-form handles, with the shared fixed-24-step evaluator; maximum
printed error was below `5.1e-7`, FFmpeg's six-decimal print resolution.

The generated source SHA-256 before and after all operations was
`9ee5b23528b9506138678700a32dad194ef01bd27f61193ca3a27b152a1affb0`.
It matches the renderer source receipts. The raw ambient PNG hash was
`cf4f2d025679b349a6add7d51680a46a0bffddcea335a9400545f3ab08868e4f`.
The ambient/custom-motion MP4 without a Look was
`ca95dc013ecd7ee9920fc649892391f0da127dc9438c273c319bb0cc83708a38`;
the Monitor parity fixture with its one Retro Look was
`a14f9ffe1a8cc632e803957932ce73e8e287dd6327342a94700d001b0d10743e`.

Generated originals, both MP4s/sidecars, raw fill, Monitor/decoded PNGs,
deliberate-failure PNGs, `render-evidence.json`, `monitor-parity.json` and the
implementation source-hash receipt remain under
`/tmp/openfilm-d5a-photo-finishing`. Existing PhotoDepth evidence remains under
`/tmp/openfilm-d5a-photo-depth`. No media binary was committed or uploaded.

Regressions also cover strict old/new recipes; source hashes/alpha/gap bounds;
source/clip/paired protection; exact retry, one Undo step, Redo, autosave,
reopen and Named Versions; delayed-flush revision rejection before POST;
same-key cancellation/retry, queue limits and project closure; and PNG HTTP
admission with no arbitrary path/URL/filter input. JSON/OTIO preserve full v2
metadata, FCPXML/EDL reject it, and actual fidelity handoff bakes a 32-frame
reference without changing source or saved project bytes.

Independent failure cases found during this work were corrected with focused
regressions: a cancelled worker must not poison a same-key retry; affine color
lift must not tint the black diptych separator; applying an already disabled
fill must leave absent legacy layout absent; idle Escape must exit the focus
tool; and legacy images must retain their direct parent for Record readiness.
The last issue interrupted an earlier browser run after 34 passes; product
markup was corrected and the same existing assertions passed unchanged in the
final 37-case run.

Builder rulings keep deduplicated waiters bounded at 32, place layout separators
outside the photographic color group but inside camera/static transforms, keep
the exact v1 image DOM while grouping only ambient v2, and cancel an unfinished
keyboard burst on blur. D5C owns primary correction; this candidate supplies its
raw → primary → Film Look seam without implementing another color path.
Private-photo/subject aesthetics, touch/pen hardware, calibrated displays,
sustained 4K, native OS and real NLE finishing remain manual gates.

### D5A final review correction wave

The final review of `1e4d4c302e28be3866879c2a351a849fcd4c742b` identified
one Important resource-admission defect and one Minor localized conflict-code
defect. This correction preflights all raw/display/SAR source geometry and all
centered-cover intermediates before source admission or a subprocess. It uses
the existing output/source/texture budgets: output ≤4,096 per edge and
8,294,400 pixels; sources ≤32,000,000 pixels; scale intermediates ≤8,192 per
edge and ≤64 MiB at four bytes per pixel. Invalid, nonfinite and unsafe geometry
returns `request.tooLarge` / 413. Blur retains three passes after crop within the
admitted frame and the existing sigma bound. The sampling recipe is unchanged.
The captured-revision rejection now reports `timeline.conflict`, preserving its
original diagnostic guidance and no-new-POST/CAS behavior.

Regression failures were observed before the fixes using a hard subprocess
fence, never by allocating the adversarial 3840×768000 intermediate. Tests
cover portrait/landscape strips, SAR/display values, overflow/nonfinite values,
byte/edge boundaries, ordinary admission, later clips and paired cells. Actual
application rejection leaves no preview cache publication, history or saved
project/source change; a valid subsequent retry succeeds. Renderer rejection
preserves a previous completed MP4 and manifest and removes temporary work.

Fresh ordinary actual-media evidence is retained separately under
`/tmp/openfilm-d5a-photo-finishing/final-fix`. The original, raw fill, six-second
MP4 and all sampled decoded RGB hashes match the preceding control exactly;
the control artifacts were retained. This is bounded synthetic evidence, not a
sustained 4K or private-photo aesthetics claim. The final correction passed
7 focused files / 97 tests, 37 related browser cases in 2.4 minutes, TypeScript
and Vue checks, five-file scoped lint, localization and documentation mirrors.
The browser run used an exclusive 4310/1420 lease; both listeners were confirmed
stopped before release. Fresh Monitor measurements, both MP4s and all ten
independently decoded Monitor/output RGB24 frame hashes match retained controls
exactly. All 40 implementation/test source hashes were recomputed for the fresh
receipt. Historical counts above remain evidence for their original candidate;
coordinator-owned scoped re-review and complete exact-head CI remain pending.

### D3 → D5A integration checkpoint

The approved D3 waveform head `06cd982` was merged into reviewed D5A `f1d90ea`
with merge `628ecfcb188c161d5e453d136772fb11b7ff9a95`. No manual source
resolution was needed. Current focused checks passed: 12 files / 198 tests,
including the real SequenceWaveform TimelineClip host's 55 tests; five related
files / 71 tests; actual renderer four files / 40 tests; and two selected
PhotoDepth 180-frame / ambient fidelity-handoff cases. TypeScript/Vue, changed
source lint/format, 2,714 localization keys and 127 documentation mirrors passed.

The initial related browser run passed 36 of 37 cases. The existing slow
GraphicScene playback case observed five requests while its exact assertion
expected three. Its production/test files are unchanged by this merge; the
retained trace shows aborted native-playback requests. Without edits, its
isolated retry passed and the complete Record Monitor file then passed 6/6.
Every selected case has passed across these attempts; this is not a single
successful 37-case run. No assertion, timeout or threshold was changed.

Fresh synthetic source/media/Monitor artifacts and actual current implementation
SHA-256 receipt are in `/tmp/openfilm-finishing-integration/A-628ecfc/`.
Earlier candidate receipts remain historical. Full exact-head hosted gates and
final integration review are coordinator-owned and are not established here.

### Synchronous focal commit fence after integration

The subsequent integrated browser run exposed a resize event-order race: pointer
release could precede delivery of the resize/ResizeObserver cancellation. The
isolated focal fix captures window dimensions, the actual overlay rectangle and
source-session identity, then compares them synchronously before pointer or
keyboard acceptance. Frozen source mapping and the existing post-await revision
barrier are retained. Eight deterministic regressions first failed; the four-file
focused backport batch passes 59 tests, including all 16 overlay cases. Removing
the source-session guard makes its regression fail; the guard was restored.
The source/test-only fix was backported from `4b7a497` to this branch. Complete
hosted gates remain coordinator-owned; earlier stage receipts retain their
original source identities.

### Focal admission geometry quality increment

The preceding scoped fence review passed and separately documented unchanged
start-time behavior in a pure component probe: an already resized surface could
admit a gesture using geometry that its observer had not refreshed. The
coordinator chose to close that unshipped boundary defensively. The probe does
not establish natural browser event-order reachability.

New pointer-pick, handle-drag and first-key admission require the supplied
geometry rectangle to match the measured overlay rectangle. Stale admission
produces no activity, draft preview, commit or saved change; current bounds can
be retried after refresh. The existing frozen mapping and synchronous post-start
window/rectangle/source-session acceptance fences remain intact. The cost is an
ignored interaction while initial bounds are stale.

Twelve deterministic stale-start regressions failed first: three admission modes
across changed left/top/width/height. The current four-file focused batch passes
74 tests, including all 31 overlay cases and the previous 16 checks. Three
fractional-geometry unit cases verify correct pick/drag/keyboard mapping. All
eight photo browser cases pass in 28.3 seconds, including the added ordinary
320.5 × 180.25 pixel viewport at fractional coordinates, one pointer and one
keyboard transaction, preserved source hash and the existing actual MP4/parity
negative controls. TypeScript/Vue, scoped lint/format and documentation mirrors
pass. Shared browser ports were confirmed closed before lease release.

Fresh source/test hashes, logs and synthetic Monitor/media evidence are retained
under `/tmp/openfilm-finishing-integration/A-focal-start/`. Earlier controls keep
their original receipt identities. A fresh scoped review of this increment and
full exact-head hosted gates remain coordinator-owned before publication.

### 2026-10-30 — repaired documentation base integration

The reviewed focal/photo implementation now includes repaired base `fab0a4c`
through merge `21d34f7`. All contribution/governance locales and research are
preserved, including the corrected three Source links and research formatting.
`git diff c37b203 HEAD -- apps packages` is empty for this merge.

Current checks: `pnpm typecheck`, `pnpm test:i18n`, `pnpm test:docs-i18n`,
`pnpm format:check`, scoped ESLint and `pnpm exec vitest run
 tests/unit/docs-site-validation.test.ts tests/unit/photo-focal-overlay.test.ts`
passed (two files / 35 tests). The earlier browser/media receipts remain tied to
their original implementation identities; this documentation merge makes no new
browser, physical-device or hosted-CI claim. Fresh checkpoint hashes and logs
are retained in `/tmp/openfilm-finishing-integration/A-latest-base/`.
