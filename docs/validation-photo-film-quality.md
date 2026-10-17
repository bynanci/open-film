# Photo-film quality validation

This record covers the generated 20-second A/B calibration workflow, using
[the public fixture generator](../fixtures/photo-film-quality/README.md).
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

Re-executed on 2026-10-17 at 23:30 UTC using FFmpeg 7.1.5 on Linux, with the
implementation frozen at `ae61376ee8e9413e0982c00075053a2fe297b7c1` on
`codex/photo-film-quality`. The run explicitly records `workingTreeDirty: false`.
The local `implementation-sources.json` lists hashes of the actual core,
renderer, fixture and runner source files. Its SHA-256 is
`9ea26157c2343b9a01ecf93468628f11809e99c2bcde282f3ed1972f7cec5bcc`.
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

The fixture scenario regression tests pass (3 tests): unchanged 20-second
timing and source library, rejection of an incomplete library, and safe active
motion with intentional crop fallback. Scoped ESLint and Prettier checks pass.
Actual aesthetic judgment, listening and projection are still manual gates.

## Candidate regression ledger

The committed implementation has these complete local results:

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

## Focused correctness review

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

## Manual gates

- Inspect actual start/middle/end frames and transition edges for crop loss,
  inappropriate overlap, drift, missing characters and unreadable text.
- Listen to real narration, original audio and licensed music; a synthetic
  gated tone cannot verify intelligibility or emotional continuity.
- Test real portrait/landscape originals, actual CJK project text and intended
  projection/playback hardware. No user image or attachment is a public fixture.
- Windows native operation, hardware/camera sources and real Resolve finishing
  remain separate workstation gates.
