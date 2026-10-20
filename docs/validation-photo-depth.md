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
