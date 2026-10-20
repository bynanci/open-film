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

### Follow-up: concurrent crop approval changes

Independent review of `ac5c5bae0579c586703c33968acb5bc442634df5` reproduced a
stale approval: a save during asynchronous preview hashing could publish a still
whose pixels differed from the reviewed frame. The original revision check ran
before hashing, and PNG publication captured its project snapshot afterward.
MP4 also captured settings after validation and lacked a publication revision
guard.

The follow-up freezes project, Composition, settings and catalog asset metadata
before validation; rechecks the revision after asynchronous verification; and
carries the reviewed source identities into the renderer. Actual renderer inputs
must match that snapshot. Source hashes are rechecked before delivery, with
revision and filesystem state guards through both publication renames. A change
between or after those renames rolls the pair back, preserving existing outputs.

Fifteen new regression cases passed: eight PNG/MP4 cases for changes during
validation, after approval, in source bytes and in derived render plans; a save
during MP4 rendering; source changes after MP4/PNG receipt staging; and four
real-I/O publication rollback cases. The original nine application races were
observed failing first; all eight completed stale-plan renders had pixels that
differed from the preview. The publication and late source guards also have
recorded failing runs with their causal checks absent.

The follow-up focused run passed **21 files / 160 tests** in 63.73 seconds.
All fifteen race/rollback regressions passed again after final cleanup. Type
checking, focused lint, formatting and diff checks passed. The exact independent probe now reports
`published:false`, `changedDuringValidation:true`, and a stale-preview error.
Logs are retained locally under `/tmp/openfilm-v1-validation/` with prefixes
`pr36-stale-approval`, `pr36-publication-guard`, `pr36-source-publication`, and
`pr36-source-png-publication`. The fixed independent probe is recorded in
`pr36-independent-stale-probe-fixed.log`. Browser and full-suite execution are
reserved for the coordinator's integration run.

### Follow-up: audio and preview request boundaries

Four further comments were checked against
`918e9a1817ed19d9292b87578a0f6f33a7e9a3b8`. The earlier crop guard is
retained; the additional gaps were reproduced before their fixes.

| Review thread | Disposition and regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4326505574`  | Fixed: audio-only rendering does not select or validate picture captions. A saved track with 5,001 valid cues now permits the WAV mix and both role stems; normal MP4 still enforces the caption limit.                                                                                                                                                                                                                                                                                                               |
| `4326505595`  | Fixed: a preview reserves the server mutation queue across its body read and active-job registration. A partial HTTP body followed by project close previously closed the captured application; close now returns 409 and the completed preview remains readable.                                                                                                                                                                                                                                                     |
| `4326505606`  | Partly covered by the previous crop follow-up: PNG has revision/source guards through publication and rollback. WAV/stem routes still released the server mutation queue early. PNG/WAV/stem delivery now retains that queue through publication; real exports paused after receipt staging keep a concurrent edit queued and complete before the edit. Cancellation bypasses the queue.                                                                                                                              |
| `4326505622`  | Fixed: previews and PNGs use a picture-only intermediate and visual source receipts. After standalone narration and music files are removed, preview/still pixels match a normal MP4 rendered while the files were available, including captions and a title attached to an audio clip. FFprobe confirms that intermediates contain only video, and their encoding receipts report no audio. Preview verification and still retries work with those audio files absent; MP4/WAV delivery still rejects missing audio. |

Six new application/HTTP regressions cover these cases using actual FFmpeg and
an ephemeral loopback port. Their failing runs are retained in
`pr36-p2-red.log` and `pr36-p2-offline-red.log` under
`/tmp/openfilm-v1-validation/`. The earlier source-change and rollback evidence
under the `pr36-stale-approval` and `pr36-publication-guard` prefixes remains
applicable to PNG publication. Picture review covers visual source identities;
a delivered MP4 also captures and verifies its audio sources.

The focused follow-up run passed **21 files / 165 tests** in 76.30 seconds,
including all renderer suites and the prior crop/rollback races. The separate
actual-render HTTP cancellation regression passed. `pnpm typecheck`, changed-file
lint, formatting and diff checks passed. Logs use the `pr36-p2-` prefix in the
same local validation directory. Full-suite, browser and collected-font
integration remain with the coordinator.

### Follow-up: concurrent requests, recovery files and rendered fonts

The next four findings were checked from
`72cc85ae42a82106b9b80668b1ec2bdf58cdde2d`. All four have failing actual-I/O
regressions recorded before their causal fixes.

| Review thread | Disposition and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4326958726`  | Fixed: private per-request filesystem locks span lookup, rendering and publication across service/CLI instances, followed by a final completed-winner check. Concurrent PNG publishers previously changed the winner's pixels and receipt; WAV publishers changed its receipt. The winner remains immutable, and a later identical retry verifies it.                                                                                                                                        |
| `4326958750`  | Fixed: callers retain work on `RenderPublicationRecoveryError`. Real injected install/restore failures leave the original bytes readable at the reported recovery paths in a mode-0700 work directory.                                                                                                                                                                                                                                                                                       |
| `4326958767`  | Fixed: previews persist canonical actual font file/face identities and crop snapshots carry them into the renderer. Separate Noto Sans/Serif CLI processes produce different preview pixels; the wrong font now rejects both PNG/MP4 delivery before encoding/publication. Matching font bytes copied to a collected path remain valid. A separate actual-render case binds distinct title, caption and GraphicScene fonts. Crop still request fingerprints also include the reviewed fonts. |
| `4326958778`  | Fixed: stem lookup precedes the empty-role outcome and every accepted empty request publishes a manifest-only directory. Adding or removing audio rejects reuse of the old ID; a passive service restart verifies an unchanged empty request. No placeholder WAV is created.                                                                                                                                                                                                                 |

Lock owners are published as complete, mode-0600 records with an exclusive hard
link. Recovery reuses verified local boot/PID scope, checks Linux process-start
identity for PID reuse, and serializes reclaimers of the observed token/inode.
Release checks both token and inode. Real live child processes cannot claim
each other's lock. SIGKILL before or after actual WAV publication permits a
same-ID retry; a completed winner's bytes and receipt remain unchanged. Unknown
owner scope/liveness fails closed. Native platform liveness remains subject to
the workstation gates above; Linux process controls are the measured evidence.

Cancellation tests cover PNG during rendering and WAV/stems after receipt
staging, followed by successful same-ID retries and empty request-lock folders.
The late WAV test also reproduced a publication-after-abort gap. WAV pair
publication and stem directory installation now check cancellation, revision
and source state through publication, with rollback if the state changes.

The initial request/recovery/empty-role failures are in
`pr36-request-font-red.log`; actual cross-process font failures are in
`pr36-font-identity-red.log`. Removing only dead-owner recovery and inode-release
guards produced three failing lifecycle controls in
`pr36-request-lock-causal-red.log`; those guards were restored before validation.
The late cancellation red run is `pr36-request-late-cancel-red.log`. These logs
remain under `/tmp/openfilm-v1-validation/`.

The final focused run passed **22 files / 182 tests** in **94.96 seconds**,
including the earlier crop, source-change and rollback regressions. The new
request/font/lifecycle selection passed **18 cases** separately. `pnpm typecheck`,
changed-file ESLint, formatting and diff checks passed. The final logs use
`pr36-request-font-` prefixes. This follow-up does not run a full repository or
browser suite; collected per-style font integration remains with the coordinator.

### Follow-up: font assignment approval

Independent review of the integrated `a39512c` font protection reproduced a
remaining gap: swapping two local font candidates between rendered uses kept
the provenance set equal while the actual reviewed pixels changed. Both PNG
and MP4 crop deliveries still accepted the old token. The genuine two-case
red run is `/tmp/openfilm-v1-validation/pr36-font-use-red.log`.

Production commit `1a1955c560a58a53e88d6d34b14232824a0478f3` adds separate
`fontBindings` receipts alongside the existing `fonts` provenance set. Each
binding uses a typed tuple of title track/clip, caption track/cue, or graphic
scene/node IDs. Canonicalization preserves delimiter-bearing identifiers and
the three namespaces, rejects conflicting bindings, and never includes local
font paths. Nested group text participates. Hydrated previews, render snapshots,
PNG request fingerprints and final receipts retain the bindings. A renderer
rejects a changed assignment before encoding; old set-only receipts require a
new preview. Existing collected per-style font callbacks keep selecting the
actual font; the protection records the resulting file and face.

Six focused controls pass in `pr36-font-use-controls.log`: real PNG/MP4
two-font swaps across title, caption and nested graphic text reject with no
published artifact; identical bytes relocated to different candidate paths
produce the reviewed pixels; old persisted receipts reject in fresh application
instances and newly generated approvals succeed; typed-tuple collision and
direct renderer legacy-snapshot controls pass. `pnpm typecheck`, changed-file
ESLint, formatting and diff checks pass. Full repository, browser and native
checks remain with the coordinator.

The broader focused export/render run passed **22 files / 188 tests** in
**156.49 seconds**, including the prior source, cancellation, publication,
request-lock and rollback controls. Its log is `pr36-font-use-focused.log`.

Independent integration probes also pass on immutable callback-enabled snapshot
`42ccae24b043020a14dec844448c6f9c8bcaa6a1`. Both title/caption swaps and
shared-ID title/caption/nested-scene swaps reject; relocating the original bytes
accepts and preserves decoded pixels. Evidence is retained in
`pr36-independent-font-assignment-green/evidence.json` and
`pr36-independent-font-shared-ids-green/evidence.json` under the same validation
directory. These probes only change private synthetic candidate files.

### Late review readback for PR41

Four later PR36 comments were reproduced against integrated baseline
`9ccc082d0f724294b724296eea7aa4fd48e59349` in a new isolated clone. The earlier
PR36 frozen branch and integrated checkout were left untouched.

| Review thread | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4327450649`  | Fixed. Valid 120-fps and sub-1-fps projects crashed Export profile creation. Desktop now clamps only delivery choices to 1–60 fps; preview, PNG, WAV, stems and profiled MP4 use that rate. Saved summaries/settings retain their original rate, while delivery summary and time bounds use the output rate.                                                                                                                                       |
| `4327450668`  | Fixed. Zero-gain sources were still opened, receipted and assigned stems. The shared audio source selector, scoped renderer passes, role discovery and receipt/retry coverage now exclude only muted uses. Shared audible/tiny-positive uses remain; visual sources remain required for picture output.                                                                                                                                            |
| `4327637390`  | Fixed. Real saved width-only/height-only changes left the reviewed crop visible and approved. Both dimensions now invalidate the preview and approval through the existing cancellation fence; equivalent polling preserves them.                                                                                                                                                                                                                  |
| `4327637403`  | Fixed. Omitted captions and a track named `automatic` reused a completed PNG request despite different pixels. Receipt fingerprints now distinguish automatic/none/named modes with tagged values; `auto` and `automatic` remain legal IDs, and legacy untagged preview receipts fail closed. The integrated per-use font guard already prevented final mismatched crop publication; the new selection guard rejects before invoking the renderer. |

The causal unit/application red run is
`/tmp/openfilm-v1-validation/pr41-export-late-four-red.log`. It records 11
failures from actual offline-muted audio delivery, wrong role discovery,
different-caption PNG cache reuse, the earlier font-guard rejection path,
out-of-range project rates and dimension invalidation. Explicit tagged receipt
controls were also red in `pr41-export-caption-tag-red.log`.

The first focused green selection passes 16 cases in two files. It includes
actual WAV/PNG delivery, MP4 selection refusal, source hashes, fresh-service retries, all-muted PCM
silence/manifest-only stems, shared tiny-positive gain, zero-gain picture-source
requirements and legacy untagged receipt refusal. Real browser rate mount
failures were recorded in `pr41-export-browser-red.log`; the corrected isolated
HTTP fixture records causal width/height browser failures in
`pr41-export-browser-dimensions-red.log` after valid saves reached the displayed
settings. Initial fixture origin/polling errors are not treated as feature
failures. Browser tests run their own ephemeral services and represent the
existing trusted development frontend only within their fixture proxy.

Final focused verification passed **23 files / 216 tests** in **127.28 seconds**,
covering all renderer suites and prior publication, source-change, request-lock,
cancellation and font-assignment controls. The five real HTTP/Chromium browser
cases passed in **21.0 seconds**. They probe actual delivered MP4 frame rates
and frame counts for 120→60 and 0.5→1 fps, exercise PNG/WAV/stem requests, retain
saved settings/Composition, preserve an equivalent polled preview, and clear
both dimension changes. The final logs are `pr41-export-focused.log`,
`pr41-export-browser-green.log`, `pr41-export-typecheck.log`,
`pr41-export-lint.log` and `pr41-export-format.log` in the same validation
directory. Typecheck, changed-file ESLint, formatting and diff checks pass.

No project schema, required-selection, request locks or per-use collected font
bindings change. Full repository, packaged/native and general release gates
remain with the coordinator.

### Initial remediation verification

At `ac5c5bae0579c586703c33968acb5bc442634df5`, focused verification passed in
21 files / 145 tests, covering all renderer
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

## Atomic stem directory publication follow-up — 2026-10-20

Collect finding `4328164569` also reproduced an empty-directory overwrite in
audio-stem publication. The complete staged stem directory now moves through the
shared OS atomic no-replace wrapper. A raced empty directory is preserved, while
a valid same-request winner is accepted only through existing request, profile,
source, receipt and output-hash checks. A completed stem directory becomes visible
with every WAV and `manifest.json` together, including the manifest-only result
when no roles apply. Same-ID process-crash retries retain the original atomic
visibility contract.

The wrapper loads before the final synchronous source/revision/abort fence.
Unsupported native operations or filesystems produce a typed, localized choice
to export a WAV mix or choose another disk; there is no ordinary-rename fallback.
Known-stage inode receipts bind publication and rollback. A late failure reclaims
only the owned directory into its private stage with an exclusive rename.
Foreign replacement directories and rollback-path winners remain untouched; the
existing `RenderPublicationRecoveryError` retains original PCM, per-role render
receipts and a copy of the aggregate manifest in private render work when safe
rollback is impossible. It also retains any existing staging recovery path.

Real-process regressions cover raced destinations, same-ID retry after SIGKILL,
exact source/output hashes, valid PCM sample counts, empty-role durability,
cancellation and stale-source/revision fences. Independent reviewers retain the
causal REDs from the original overwrite and the rejected portable-copy prototype.
Linux native calls are exercised locally; macOS/Windows and unsupported-filesystem
checks remain workstation gates.

The final bounded run passes 148 tests in eight related publication/Collect/export
files and 12 core/error-localization tests. TypeScript/Vue, changed-file lint,
formatting and localization checks pass. No full suite or browser is launched for
this follow-up; independent actual-process checks and combined release gates are
reported separately.

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
