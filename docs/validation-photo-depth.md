# M8A PhotoDepth validation

## Status

Implementation and automated regression evidence are recorded on the M8A
branch. All local automated gates passed after the latest review fixes; GitHub
checks will rerun after the branch update. Human-photo quality, physical
workstation display, 4K sustained work, and downstream NLE review remain manual
gates. A synthetic test pass is not evidence of face/hand preservation or
professional image quality.

## Automated contracts

| Area                    | Evidence                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core schema/evaluator   | Strict version/mode/identity/bounds validation, unsafe and malformed data rejection, fallback reason, deterministic arbitrary seek order.                                                                                        |
| Application/persistence | Hash mismatch rejection without revision change, layer lock fencing, typed edit Undo/Redo, autosave and reopen. Named-version restore retains recipe data and source identities.                                                 |
| Renderer                | Synthetic landscape, alpha silhouette, separate background fill; source/mask dimensions and alpha validation; empty/mismatched mask failures; source hash receipts; deterministic random frame access.                           |
| Real MP4                | Actual FFmpeg H.264 output, FFprobe frame count/duration/size/rate, first/middle/last plus shuffled decoded seeks, Monitor-PNG versus decoded-frame RGB tolerance, manifest source hashes, and unchanged synthetic source files. |
| Visual QA               | Typed mask missing/invalid/mismatch/empty/holes, source changed, background missing, protected-region and fallback findings; unrelated missing assets no longer hide PhotoDepth manual-review findings.                          |
| Desktop                 | Playwright local asset import, selection, save, preview, Undo/Redo, reopen, readiness gating for unhashed inputs, and deletion of a bound image with its recipe.                                                                 |
| Compatibility           | Optional additive `photoDepth` on schema-1.0.0 GraphicScene; projects without the field keep existing behavior. JSON interchange contract is checked with the existing suite.                                                    |

## Automated gate run

Run date: 2026-10-20 UTC. M7A PR #34 is merged. The current M8A PR targets
`main` at `bb2c4521ad894478893485119442a00ffd9b34cc`; GitHub Verify checks will
rerun after the review-fix commit is pushed.

| Command                 | Result                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`     | Passed; all files formatted.                                                                                                               |
| `pnpm test:i18n`        | Passed; 1,745 semantic keys, application errors and literal UI keys matched across en-US, zh-TW and ja-JP.                                 |
| `pnpm lint`             | Passed with `--max-warnings=0`.                                                                                                            |
| `pnpm typecheck`        | Passed (`tsc` and `vue-tsc`).                                                                                                              |
| `pnpm test`             | Passed: 213 test files, 2,954 tests; Vitest reported 105.13 seconds.                                                                       |
| `pnpm build`            | Passed. Vite reported the 958.49 kB main JavaScript chunk advisory.                                                                        |
| `pnpm test:e2e`         | Passed: all 169 Playwright tests in 16.6 minutes. PhotoDepth browser regression passed, including bound-layer deletion and recipe cleanup. |
| `pnpm test:interchange` | Passed: 18 parser/interchange checks plus source URL rejection and relocation/hash checks. Actual Resolve import remains unverified.       |
| `pnpm test:native`      | Not run: `rustc` and `cargo` are not installed in this environment.                                                                        |

Review corrections covered by regression tests: apply node opacity once to the
combined depth layers; validate locks on both old and new bound nodes; project
the protected region through the fitted image content rectangle; reject all
parallax-only fields on fallback recipes; scope Visual QA source failures to
recipe dependencies; disable creation when any required hash is unavailable;
and remove the recipe when its bound image layer is deleted.

The actual FFmpeg evidence was regenerated after the final code changes by
`OPENFILM_PHOTO_DEPTH_QA_OUTPUT=/tmp/openfilm-m8a-photo-depth-review-final pnpm exec vitest run packages/render/tests/photo-depth.test.ts -t 'renders six seconds'`.
It passed in 5.93 seconds and produced an H.264 MP4 at 320×180, 30/1 fps, 180
decoded frames and 6.000 seconds. Repeated reads in shuffled frame order
`0, 90, 179, 35, 140, 179, 0, 90` returned identical decoded pixels at repeated
indexes. The decoded MP4 versus shared Monitor PNG mean RGB absolute errors at
frames 0, 90 and 179 were 1.6001, 1.5312 and 1.6355 (each below the declared
12-level limit). The output SHA-256 is
`4bc0aa115885176c18f1af031e7c573eadcf5c0e9eff4edf25f39336d4ea5a46`.
The explicit no-mask fallback and legacy scene both rendered MP4s with the same
SHA-256, `14ebd5411ff2b107b97c3716972960cf5b1fbd5ee6f2f7170e52a822f84a31eb`;
their decoded frames 0, 90 and 179 matched byte for byte. The fallback decoded
frames 0 and 179 differed from the parallax output, confirming that the depth
motion changes the rendered pixels while the fallback preserves the old Image
rendering.

The synthetic source receipts were unchanged by rendering:

| Source          | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| Landscape       | `665b71e65fea8ffccf439e455611dd490213c8c6f01bf6a1ccb782a56b2c5d3b` |
| Alpha mask      | `43d3b7f5f5ba38004c1080de39ed32b0c2f41b73f8634bfb7703ac9bb46bddfa` |
| Background fill | `516c32c17a5d987c79ed061953ed5f0dc8695282c09c0b0b0359459d7044c5a8` |

Parallax/fallback/legacy MP4s, manifest, source images and decoded/Monitor samples remain in the
temporary path above; none are committed or uploaded as CI artifacts. The tests
use synthetic data only and contain no private photos, personal paths or
credentials.

## PR #35 source-receipt and alpha review remediation

The reviewed baseline is `e78c4e06da2eb908dc0cb4548718c83b7798a8f1`
(`main` base `bb2c4521ad894478893485119442a00ffd9b34cc`). All nine review
threads were checked against that exact head; remote thread states were not
changed during local remediation.

| Discussion ID | Disposition and evidence                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4321620390    | Already fixed: one opacity group wraps both depth layers; the renderer's subject-alpha regression passes.                                                                                                                                                       |
| 4321620402    | Already fixed: old and new bound-node IDs both receive lock checks; application rebinding regression rejects the locked destination.                                                                                                                            |
| 4321620405    | Already fixed: source dimensions determine the fitted content rectangle; safe-motion/source-fill regressions cover padded images.                                                                                                                               |
| 4321620410    | Already fixed: fallback parsing rejects every parallax-only field; parameterized core tests cover the strict contract.                                                                                                                                          |
| 4321746408    | Already fixed: the source-failure predicate matches recipe dependencies; an unrelated missing image still permits mask-hole and manual-review findings.                                                                                                         |
| 4321746411    | Already fixed: create readiness requires hashed source/mask/background assets; unit tests cover missing hashes and other disabled states.                                                                                                                       |
| 4321746415    | Already fixed: Desktop layer removal also removes its bound recipe; existing browser regression covers deletion and recipe cleanup.                                                                                                                             |
| 4322253724    | Accepted and fixed: fallback QA compares the saved receipt with its already verified current source hash before skipping parallax checks. A real catalog relink returns an incomplete report with `photo-depth.source-changed`, rather than failing the QA job. |
| 4322253730    | Accepted and fixed: foreground preparation multiplies source alpha by mask alpha. Monitor and actual decoded H.264 pixels cover transparent, opaque, half-alpha and intersected quarter-alpha samples.                                                          |

Before the production changes, the two new regressions failed: fallback QA
threw with a `graphics.sourceChanged` cause, and a source-transparent pixel
became alpha 255. Afterward, both passed. The fallback test also renders a
valid 48-frame fallback before the relink and checks that both local source
files retain their original hashes.

The alpha regression expects `[0, 255, 0, 128, 64, 128]` at six synthetic
sample positions. The Monitor returned `[0, 255, 0, 129, 64, 128]`; decoded
MP4 RGB channels returned `[0, 255, 0, 129, 65, 128]`. The declared tolerances
are one level for Monitor alpha and eight levels for decoded H.264 RGB.
All three source hashes remain unchanged and match the render manifest.
The output SHA-256 is
`73f20db517f8a2b9d902e30122f38fef000aa98d58d1d2b144b60492e19fbced`.
Synthetic output and machine-readable measurements are retained only in
`/tmp/openfilm-v1-validation/pr35-render-evidence`.

Local checks used Node 24.19.0, pnpm 11.11.0 and FFmpeg 7.1.5. The baseline
focused run passed 54 tests in four files; the final focused run passed 56 tests
in the same four files. Two additional PhotoDepth application tests passed
(12 unrelated tests were filtered out). `pnpm test --maxWorkers=1` passed all
2,956 tests in 213 files in 391.08 seconds with no port collision. Formatting,
i18n (1,745 matching semantic keys), lint and TypeScript/Vue type checks passed.
Browser and native-desktop suites were not rerun for these source/render-only
fixes. The coordinator runs the combined integration gates after collecting
the independent PR fixes.

The six-second, 180-frame render was regenerated with byte-identical parallax,
fallback and legacy MP4 hashes to those recorded above. Repeated shuffled seeks,
Monitor/decoded-frame parity, source receipts and protected-region regressions
also passed.

## PR #35 follow-up at reviewed head 909c435

All five new findings were reproduced against
`909c435c98bb49fc1242cf4f5a5ca52e983c824e` before changing production code.

| Discussion ID | Disposition and regression evidence                                                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4326502537    | Accepted and fixed: mask/background selection and Create remain available while fallback is active; recreating parallax retains the recipe ID. Only existing-parallax tuning is conditional.                                                         |
| 4326502543    | Accepted and fixed: source-background recipes seed an available background on open and when Library assets arrive. Both fresh-component and later-import cases switch to asset mode successfully.                                                    |
| 4326502552    | Accepted and fixed: the fallback reason is selectable before first creation and resets for a newly selected image. A chosen reason survives parameter saves on the same image.                                                                       |
| 4326502562    | Accepted and fixed: the PhotoDepth `graphics.resourceLimit` admission error becomes a typed `photo-depth.mask-invalid` finding. Real 3000×3000 source/mask PNGs return an incomplete QA report with mask/node/scene identities and unchanged hashes. |
| 4326502570    | Accepted and fixed: pending mask selection survives acknowledged parameter saves for the same saved mask/source/recipe identity. A newly saved mask identity still replaces the draft; disabled editing still emits no commands.                     |

The initial red run contained six expected failures: five component behaviors
(the fallback-reason finding has two cases) and the real mask-budget QA failure.
The later-Library background case was also observed failing before adding the
asset-list watcher. The final focused run passed 66 tests in five files; the
two selected PhotoDepth application/history tests also passed (12 unrelated
tests were filtered out). Formatting, i18n (1,745 semantic keys), lint and
TypeScript/Vue type checks passed.

`tests/unit/photo-depth-panel.test.ts` compiles and mounts the actual Vue SFC
using the repository's existing Vue host renderer. It checks rendered controls,
user model/change events, emitted scene commands and acknowledged prop updates.
No browser server or shared default ports are needed for these regressions.
The focused renderer run regenerated the same synthetic MP4 hashes recorded
above, including source-alpha intersection, protected-region checks, arbitrary
seeks and fallback/legacy parity. No full suite or browser suite was rerun for
this follow-up; the coordinator owns combined release verification.

## PR #35 Library, timing and mask-orientation follow-up at a19f54b

Reviewed baseline: `a19f54bd771b0c93f17b50e07fc6f1e70a09eedd`.

| Discussion ID                  | Disposition and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4326942553                     | Accepted as an explicit decode-policy fix: mask inspection now disables autorotation, matching foreground preparation. A synthetic EXIF-6 PNG with a recognized 90-degree display matrix previously rejected the correct protected region; Monitor and actual FFmpeg output now match its unrotated reference.                                                                                                                                    |
| 4326942566                     | Accepted and fixed: changing the bound image interval also changes recipe duration for both parallax and fallback. Actual inspector controls accept 4.5-second and 3-second intervals; invalid shorter edits remain rejected. Browser saves, Undo and reopened recipes preserve the binding.                                                                                                                                                      |
| 4326942581                     | Accepted and fixed: typed command admission requires local file images for source, mask and background. Tests alter synthetic persisted catalog data to HTTPS and hosted `file://` URIs, then verify that admission leaves the document, revision and history unchanged. Normal catalog imports already reject non-file URIs.                                                                                                                     |
| 4326942597 / PR #40 4326967726 | Accepted and fixed together: the panel queries every Library image page separately, filters eligible local hashed images, refreshes after terminal import jobs, and fences superseded reads. Only explicitly chosen recipe dependencies enter optimistic command context; the service resolves those IDs from its catalog. Story candidate pools and required selections are unchanged. Unrelated imports preserve editor revision and Undo/Redo. |

The first red run reproduced both timing modes and both missing-Library UI
behaviors. Corrected source-admission fixtures then reproduced both non-file
dependency admissions, and the actual FFmpeg orientation case rejected a valid
protected region before the one-option production fix. The separate application
pool/history test already passed and protects the existing service behavior.

FFmpeg 7.1.5 does not interpret PNG eXIf orientation natively on this runner.
The regression writes real EXIF orientation metadata and adds FFmpeg's
`-display_rotation 90` input override only in its test process adapter, so the
real decoder exercises recognized rotation while honoring production
`-noautorotate` options. This is compatibility-policy evidence, not a claim
that this installed decoder natively autorotates PNG metadata. No production
process options are replaced by the test adapter.

The focused run passes 58 tests in six files: actual Vue controls, core editor
history/application checks, solver checks and actual FFmpeg rendering. The
isolated Chromium test imports both unlocked mask/background images through
the panel after the editor loads with explicit Story pools; it verifies that
the old revision and Undo history survive import, authors the recipe, retimes
it, previews a shared frame, exercises Undo/Redo, reopens and removes the bound
image. It passes on API port 49135 and UI port 49235. Its temporary proxy supplies
the existing trusted loopback Origin/Host; no default port was bound and no
production origin policy changed. A direct frame request retries only the
existing typed `graphics.busy` response while the automatic preview completes.

The oriented-mask render is 320×180, six seconds, 48 decoded frames. Shuffled
Monitor frames match the plain-mask reference, foreground/background decoded
pixels match the Monitor within eight RGB levels, and both MP4s have SHA-256
`bcb228765fc472a431b7a260315ccd945d6ec4571387710176e92b428dac15eb`.
All source hashes remain unchanged. Retained temporary synthetic masks, MP4s,
Monitor/decoded frames, manifest and measurements are in
`/tmp/openfilm-v1-validation/pr35-wave2-render-evidence`; focused/browser/static
logs use `/tmp/openfilm-v1-validation/pr35-wave2-*`.

Formatting, changed-file lint, TypeScript/Vue checks and i18n (1,746 matching
semantic keys) pass. No full suite, native installer or real-photo manual gate
is inferred from these focused checks; combined integration gates remain with
the coordinator.

## Late PR #35 readback in the PR #41 integration — 2026-10-20

Reviewed base: `9ccc082d0f724294b724296eea7aa4fd48e59349`. The previous
PR #35 branch remains frozen; this follow-up is isolated for PR #41 integration.

| Discussion ID | Disposition and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4327435195    | Fixed: graphics preview owns an exact Composition seek independently of clip selection. Graphics-only films render on the existing canvas; gaps retain their requested time. A covering clip supplies only the preview background. Saved revisions, project/Composition changes, frame-rate changes and clip navigation clear stale ephemeral seeks. Native metadata retains its pending seek; native transport updates the cursor while microsecond source-clock rounding preserves an exact requested frame. No dummy source, clip, second timeline, preview command or history entry is created. |
| 4327435201    | Fixed: strict recipe validation no longer assigns into the caller's scene. Literal-data and accessor checks still precede the detached clone. Mutable and frozen caller scenes/commands retain object identity through validation, rejection and application Undo/Redo.                                                                                                                                                                                                                                                                                                                             |
| 4327435212    | Fixed: only the mask decoded-pixel cap raises the existing mask-specific error. Other preparation budgets produce `graphics.resource-limit`, without a mask asset or part identity. The localized UI describes a graphics resource limit. Actual 4K/60 frame work and three individually admitted 2700×2700 RGBA16 PNGs exceeding the combined source-byte budget reproduce the distinction. The exact source/mask pair first passes decoding, alpha/subject checks and source verification at safe settings.                                                                                       |

The corrected baseline browser fixture first obtains a successful saved
`graphics.png` frame response. It then reproduces no Monitor image in a
graphics-only film, and frame 15 instead of requested frame 30 in a visual gap.
An unchanged-production baseline with the final data fixtures has eight
expected failing core/application/renderer controls: mutable and frozen
admission, rejection without prior mutation, both resource budgets, and the
mask-specific error. Independent review reproduces a first native video seek
returning frame 30 instead of 120. Our enhanced browser gate then reproduces
source-clock rounding showing frame 208 instead of the exact requested 209.
These are automated regressions,
not manual-gate exceptions.

The saved Visual QA contact sheet reproduces the same navigation gap: clicking
the three-second sample leaves a graphics-only Monitor at frame 209 or moves a
visual gap to frame 15, instead of frame 90. QA sample and issue links now reuse
the same exact Composition preview cursor when no visual clip covers the time.
Their decoded image is loaded and its PNG hash matches the saved frame response;
selection, revision and Undo/Redo stay unchanged. Project and Composition owner
checks reject navigation whose pending flush completes after switching owners.
Films without graphics retain their existing nearest-clip navigation.

The related suite passes 164 tests in eleven files. The cursor follow-up also
passes 26 transport/Monitor/navigation tests in three files. Isolated browser cases cover
graphics-only, gaps, a different covering motion photo, a real slowed native
video, and the existing PhotoDepth authoring/import/history/reopen flow. They
check exact frames 30/120/209, an initial Middle seek before video metadata,
frame stepping, actual play/pause, image-to-video navigation, revision cleanup,
QA sample/issue links, unchanged selection/revision/history for preview-only actions, and reopened
saved data. The local harness uses API port 42791 and UI port 47417; no shared
default port or production Origin policy changes are involved.

Actual FFmpeg controls render both eight-second films to 320×180 H.264 MP4s
with 240 decoded frames at 30 fps. Shuffled seeks 209/30/120/209 are repeatable.
The displayed browser RGBA SHA-256 values equal the uncompressed shared
Monitor frames exactly; decoded MP4 mean absolute RGB errors are 0.91–1.16
levels per channel. Source hashes remain unchanged. Synthetic source files,
Monitor/decoded PNGs, both MP4s, manifests and measurements are retained under
`/tmp/openfilm-v1-validation/pr35-late-final-render-evidence`. Existing six-second
render, fallback/legacy, source-alpha, orientation and receipt controls also
pass with artifacts under `pr35-late-existing-render-evidence`.

TypeScript/Vue, changed-file lint, formatting, diff checks and i18n (1,971
matching semantic keys) pass. Exact source commits, per-run results and
independent review are recorded in `/tmp/openfilm-v1-validation/pr35-late-*`.
Full combined release checks and the manual gates below remain separate.

## Manual gates

- Test representative real photographs only on a local workstation. Check hair,
  hands, clothing edges, moving camera grain, transparent holes, ghosting and
  two-person contact. Keep original and mask hashes; never attach private images
  or exported clips to CI or the public repository.
- Compare paused Monitor and exported MP4 on Windows/macOS hardware displays.
- Run sustained 4K photo-source preview and output; capture peak memory,
  cancellation/retry and thermal/storage observations.
- Import the rendered synthetic package in the actual target NLE/player and
  record the baked/unsupported status accurately.

Initialize and validate a candidate-bound evidence record with
[`docs/workstation-qa.md`](workstation-qa.md). No manual gate is inferred from
the automated tests.
