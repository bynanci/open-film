# M7B Export Profiles validation

## Status

The shared versioned Export Profile path spans Application, FFmpeg, HTTP, CLI
and Desktop. The PR review remediation below was verified from baseline
`66941903c27c41e49a938d257efd725e11286a3f`; the earlier M7B validation record
is retained afterward as historical evidence. Real-person framing, workstation
playback, sustained high-resolution rendering, and target NLE behavior remain
manual gates; synthetic fixtures do not establish those properties.

## PR 36 review remediation — 2026-10-20

All ten review findings were reproduced or confirmed at the baseline and fixed.
The regressions were observed failing before their causal changes, including an
actual FFmpeg stem export with mono narration and stereo music. That export
previously failed the identical-channel check.

| Review thread | Disposition and regression                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4322173617`  | Fixed: the audio-only renderer forces stereo; real mono/stereo mix and stems have identical channels, sample rates and sample counts.                                                                                      |
| `4322173624`  | Fixed: preflight uses the renderer's audio/role source selection. Offline picture-only media allows WAV/stems; MP4 still rejects the missing picture.                                                                      |
| `4322173633`  | Fixed: differing hashes or sizes for the same asset across role receipts abort before publication. A real sequential FFmpeg test changes one shared source between renders.                                                |
| `4322173637`  | Fixed: Desktop still request identity includes look and caption choices; unchanged retries retain their ID.                                                                                                                |
| `4322173641`  | Fixed: validated profile quality determines application and renderer encoding even if a separate quality option disagrees.                                                                                                 |
| `4322173645`  | Fixed: cache pruning enumerates prior-session owned files, expires old previews, removes orphan receipts and caps regular previews at twelve without following symlinks.                                                   |
| `4322173650`  | Fixed: null and omitted look overrides share saved-look receipt and idempotency semantics.                                                                                                                                 |
| `4322334041`  | Fixed: crop publication requires a live preview token bound to revision, profile/quality, look/captions, sources and the still frame. Application, HTTP, CLI and Desktop pass the proof; a standalone boolean is rejected. |
| `4322334055`  | Fixed: frame validation shares complete-frame duration calculation with the renderer; 1.05 seconds at 10 fps rejects frame 10 and permits frame 9.                                                                         |
| `4322334067`  | Fixed: PNG profiles retain the selected intermediate encoding quality. Desktop preview and still requests share high-detail quality.                                                                                       |

The CLI adds `export --format png --preview` and `--crop-preview-token` for a
review-then-export workflow across processes. Private preview receipts expire
after ten minutes and include an output hash. They are validated against the
current project and source identities before use; this does not claim that a
human actually inspected the frame.

Focused verification passed in 21 files / 145 tests, covering all renderer
suites, profile and quality HTTP/CLI integration, film looks, core profiles and
Desktop component behavior. The complete `pnpm test --maxWorkers=1` run passed
213 files / 2,951 tests in 293.60 seconds. `pnpm lint`, `pnpm typecheck`,
`pnpm format:check`, and `pnpm build` passed; the build retains the existing
Vite chunk-size advisory. The built CLI advertises both crop review flags. The updated
Playwright crop regression was discovered with `--list`; browser execution is
reserved for the coordinated integration run. It checks the submitted preview
token, high-detail encoding, equal preview/still PNG bytes, and unchanged saved
Composition geometry.

Fresh real FFmpeg evidence was generated with
`OPENFILM_EXPORT_PROFILES_QA_OUTPUT=/tmp/openfilm-review-audit/pr36/render-evidence pnpm exec tsx scripts/export-profiles-quality.ts`.
The report is local at `/tmp/openfilm-v1-validation/pr36-render-evidence.log`,
with synthetic-only outputs under
`/tmp/openfilm-review-audit/pr36/render-evidence/fb5f4870-98b1-47af-adc2-41e79b89a033`.
All three MP4 ratios contain 144 decoded frames at 12 fps and last 12 seconds;
their output hashes match their manifests. The 90×160 still and preview at
4.5 seconds decode identically. The run preserves the Composition and all
synthetic source hashes.

The updated fixture deliberately uses mono narration with stereo music. The
full mix and both stems are stereo 48 kHz, 24-bit PCM, 576,000 samples and
12.000 seconds:

| Output    | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| Mix       | `79888cf3f84af7a8981a94627f5b054d112a189923821a64f772b83010e8259d` |
| Narration | `f57274dc203485511d5d4e0626b4da4b8fd98d567905bf8c1f6c3d70cb108e22` |
| Music     | `8a329dfdd442693fc301d1b84e128a5f5287b08cb66e7e46d1909f89ac8adf94` |

## Earlier M7B validation record

## Contract coverage

| Area               | Evidence                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile validation | Strict version, ratio/dimension/fps/pixel limits, framing/related subtitle strategy, format and quality validation; malformed and unsupported input rejected.                                           |
| Rendering          | Existing saved Composition and renderer produce contain/letterbox and explicit center crop; output geometry is not persisted to project settings. Crop requires a reviewed preview and confirmation.    |
| PNG preview/still  | A real intermediate MP4 is decoded at a frame-aligned timestamp. Still and preview receipts bind revision, look/caption selection, source hashes, dimensions, warnings and output hash.                 |
| Audio              | Existing clip audio automation produces full mix and role stems as aligned 48 kHz 24-bit PCM WAV. Missing roles produce a warning and no placeholder file.                                              |
| Safety/recovery    | Cancellation, retry/idempotency, stale revision/source fencing, path traversal, symlink collision, project switch, atomic publication and private file modes have application/HTTP/browser regressions. |
| Compatibility      | No project or SQLite schema change. Existing MP4 settings and legacy Composition remain valid.                                                                                                          |

## Actual FFmpeg evidence

Generated on 2026-10-20 UTC with
`pnpm exec tsx scripts/export-profiles-quality.ts`. The script creates only
synthetic landscape, narration, music and Traditional Chinese caption content;
all output remains under `/tmp/openfilm-export-profiles-qa/` and is not committed
or uploaded as an artifact.

Run directory:
`/tmp/openfilm-export-profiles-qa/3dc9192b-1e2b-4264-b986-ad2adc53a4ec`.
Each H.264 MP4 decoded to the requested dimensions, 144 frames at 12 fps and
12.000 seconds. FFprobe and SHA-256 receipts were checked by the script.

| Profile                  | Output                                          | MP4 SHA-256                                                        | Decoded first/middle/last RGB SHA-256                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16:9 contain, 320×180    | `film-6f217fdf-6b68-458d-b482-c4dfa47c727c.mp4` | `40118d464d969995bbd91f0deb383bf766a25f334cef08a70bca1c1ac10f1722` | `fe9b66c555715cea3fbe0b33abb897216a637258331ad96a711a2d67a675fc86`; `58c5548f66005c65f26288c97a3eff1cb22d690fab100ec267774aaa137c6065`; `440d34eb3a01080386f04ff0f1c46f703a2bc470f012a89ac7975ffb7537650b` |
| 9:16 contain, 180×320    | `film-bdbcbef2-208c-4ea8-b90a-2bdcf8a13413.mp4` | `97209daa28d42738ec946d9aa0a3d06550112b4e02c91e4d85683a1a5d3e4551` | `c2f32fc5ec89dcf023c8e20ff4f60690c5be0606e47a27582c01f853b8af5af8`; `4888a3c5c895658a54131bc7c68f0d813f34ec5a7b20c1c4da9b61ae537386c1`; `dca9b064b36219e242d5f63023d15b760f4c69ace81421102ca3b63f223afe82` |
| 1:1 center crop, 240×240 | `film-a893d07f-2170-4e48-bd77-92b0f42d439a.mp4` | `e94cd12dd09ef3bde3d1e59da294f3520b289564708d5b17f3c893613bbf1798` | `fc1f5c20822bb54e5e64cd4ab48f174556f32070b66d2fca3a48ddd1dc07a206`; `756f83119e824ed716cc77372689f41867e673426b7d70d113b4d5b724b39729`; `e05253098b783ea747a1478d504d0e8cf8eaa047f1742e35910f4982cbe2b473` |

The portrait output recorded the expected black-letterbox warning. The square
crop recorded the explicit center-crop/subtitle-safe-area warning. MP4 manifest
output hashes matched the file hashes. A 90×160 PNG preview at 4.5 seconds and
the still output decoded to identical RGB pixels; the PNG receipt reports
`alpha: false` and warns that transparency is unsupported.

The full WAV and narration/music stems were all 48 kHz, stereo, 576,000 samples
and 12.000 seconds. Their hashes were:

| Output         | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| Full mix       | `c2d82b7d1e7e5c794da22c577c687bb77b67cd0ef39616a5f2d07eca0fe45afc` |
| Narration stem | `fd92f6425b14e69fbc76c60a8327acbbd48d6422686f7e61f90b79799e9651a0` |
| Music stem     | `8a329dfdd442693fc301d1b84e128a5f5287b08cb66e7e46d1909f89ac8adf94` |

The synthetic source hashes were unchanged during output:

| Source        | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| Landscape PNG | `3cf6829a9b2b4dd904f55771cfb08ac53b256e67a78db88aff1c296e1721e005` |
| Narration WAV | `b8455214fa68eddd920294c8d32e56dc8ee76f0d9576f4977e10a1bec2c6fe99` |
| Music WAV     | `63e1c65e5181a33f528dc69db78b3b32cc71ae783a9a3feef97232f5a21ecb`   |

The final report also confirmed the in-memory saved Composition/project remained
unchanged. The run used synthetic media only. The three MP4s decoded to 144
frames each; output hashes matched their manifests. The 90×160 still and preview
at 4.5 seconds decoded to identical RGB pixels. The WAV mix and narration/music
stems each contain 576,000 stereo samples at 48 kHz (12 seconds).

The first GitHub `typescript-and-media` run exposed one-frame-short output on
its FFmpeg build (143 of 144 frames at 12 fps, 5 of 6 at 30 fps). Profiled
outputs now explicitly clone the final composed frame as needed and trim to the
complete frame count derived from the output duration. The prior failing real
FFmpeg integration and renderer regressions pass locally after this correction;
new GitHub checks are pending.

## Automated test runs

Run date: 2026-10-20 UTC. Verification was run after rebasing M7B onto current
`main` at `bb2c4521ad894478893485119442a00ffd9b34cc`.

| Command                 | Result                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`     | Passed for the final M7B files.                                                                                                                      |
| `pnpm test:i18n`        | Passed; 1,720 semantic keys matched across en-US, zh-TW and ja-JP.                                                                                   |
| `pnpm lint`             | Passed with `--max-warnings=0`.                                                                                                                      |
| `pnpm typecheck`        | Passed (`tsc` and `vue-tsc`).                                                                                                                        |
| `pnpm test`             | Passed: 213 files, 2,939 tests.                                                                                                                      |
| `pnpm build`            | Passed; main bundle 948.96 kB (gzip 287.69 kB), with the existing Vite chunk-size advisory.                                                          |
| `pnpm test:e2e`         | Passed: 169 Playwright tests before the final frame-count correction; the M7B browser export regression passed again after that correction (1 test). |
| `pnpm test:interchange` | Passed: 18 checks, including OTIO read-write-read, source bounds/hash, unsafe URL rejection, and relocation.                                         |
| `pnpm test:native`      | Not run: `rustc` and `cargo` are unavailable in this environment.                                                                                    |

The M7B PR is open and its checks are rerunning against the frame-count
correction. The M7D Collect Media work package is queued in `TASKS.md` and
`ROADMAP.md`; this M7B change does not implement it.

## Manual gates

- Review portrait and square framing with representative real photos locally;
  verify faces, hands, paired subjects, GraphicScene overlays, and subtitle
  safe areas remain visible. Never attach private source material to the repo,
  logs, CI or PR.
- Compare preview and exports on Windows/macOS displays and a normal player.
- Measure sustained full-resolution/4K renders, memory and cancellation on
  target workstations.
- Import stills/audio and the rendered MP4 into the intended downstream NLE and
  record actual compatibility behavior.
