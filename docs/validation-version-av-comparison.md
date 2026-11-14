# Named-version A/V comparison validation

Date: 2026-11-13. Candidate base: `befe2e5b86db17c643cfc4d7bdc93bd40fee1f1a`
(`main` at implementation start). This change adds an explicit, read-only
picture-and-sound preview for two saved Named Versions. It does not restore,
adopt, or edit the current Composition.

The follow-up candidate `creative-variant-av-preview` connects the existing
Creative Variants comparison modal to this same preview service. It flushes
pending editor changes, refreshes the selected A/B Composition IDs, saves one
durable Named Version with an expected-project identity fence, and renders both
Compositions from that immutable snapshot. Both outputs must belong to the same
snapshot and retain their distinct Composition IDs. This does not create a
second renderer, Job engine, timeline, or mixer. The named checkpoint remains
in project history after the ephemeral rendered pair is cancelled or expires;
the user can remove that checkpoint explicitly using the existing Versions
workflow.

## Data flow and safety

The existing Named Version service loads and verifies each immutable saved
project/catalog snapshot, its selected Composition, asset records, source
hashes, render settings and font settings. The existing FFmpeg Renderer renders
the two saved cuts sequentially. A single owned render Job records progress and
the existing export-request lock fences competing processes. Only after both
outputs pass stream-shape, frame-count, source-manifest, file-identity and
SHA-256 checks is the pair published to the existing project-private cache.
HTTP exposes an opaque pair ID and guarded MP4 byte ranges; it never returns
filesystem paths or source URIs. Exact request IDs are validated before a Job
is reserved. Cancellation returns after the owned render and cleanup drain.

The Desktop Versions panel holds only version/composition IDs, the opaque
descriptor and shared playback state. One time control seeks both native video
elements; only the selected side can be audible. Navigating away, switching the
project or closing the panel pauses, unloads and revokes the owned preview. It
does not copy or mutate Composition/clip arrays. The cache is private,
permission-restricted, limited to one hour per Composition, 1 GiB per MP4,
2 GiB total and 15 minutes; prepared media is ephemeral across server restarts.

## Local verification

Synthetic fixtures use red/blue stills and 440/880 Hz WAV tones. The application
test creates two immutable versions with different dimensions and frame rates,
then decodes frames 0, 5 and 9 from each actual MP4. It checks the expected
color channel thresholds, selected-tone amplitude at least 20 times the
opposite tone, H.264 stream dimensions/rate/frame count, AAC presence and
duration. It verifies source hashes and immutable version payload hashes before
and after rendering, and confirms the active manifest, semantic Catalog state,
Composition and Undo state are unchanged. The HTTP test checks output hashes,
private cache headers, valid/invalid byte ranges, wrong-project rejection,
foreign-owner cancellation rejection, invalid request IDs, and live cancel
draining. No private media or provider is used.

The browser regression loads the real prepared MP4s in Chromium, checks
metadata decode, synchronized playback/seek, audible-side switching, navigation
cleanup and project close/reopen while saved versions remain. It checks for
horizontal overflow at 1024×768 and 1920×1080 and attaches a synthetic UI
screenshot at each size to the Playwright result.

### Synthetic UI screenshots

These screenshots come from the synthetic A/B project used by Playwright; they
contain no personal media.

![Named-version A/V comparison at 1024×768](images/named-version-av-1024x768.png)

![Named-version A/V comparison at 1920×1080](images/named-version-av-1920x1080.png)

Local toolchain: Node `v24.19.0`, pnpm `11.19.0`, FFmpeg `7.1.5-0+deb13u1`,
Chromium `151.0.7922.173` on Debian 13.

Focused A/V Vitest checks passed `47` tests across four files, including the
actual FFmpeg application render and real HTTP integration scenario. The App
navigation extraction suite passed another `38` tests. The combined Playwright
run passed `12` tests across `editor-mount-lifecycle.spec.ts` and
`project-versions.spec.ts`; this includes the project-switch case that first
failed on exact head `d17bbb6` due a duplicate initial editor read. The fix
reloads only an editor instance that was already mounted before the awaited
workspace transition. `pnpm test:i18n`, `pnpm test:docs-i18n`, and Prettier on
workspace transition. An initial, incomplete full-suite attempt without
`OPENFILM_OTIO_PYTHON` surfaced an NLE handoff failure because it selected
system `python3`, which did not have OpenTimelineIO installed. With the CI-pinned
OpenTimelineIO `0.18.1` in an isolated Python 3.12 environment, the NLE case
passed and the complete `pnpm test` passed all `6,313` tests across `477` files
in `1,471.12` seconds. `tests/integration/native-runtime.test.ts` also passed
all `52` tests in `154.98` seconds, including the case that timed out in an
earlier interrupted run.

Exact head `30b9bde59216300a66647ed32e18cbf058db4b5c` passed
`fast-contract-check` and all six browser shards, but docs-site failed because
the English mirror referenced screenshots present only under `docs/images`;
heavy-media was cancelled when the branch advanced. Both synthetic screenshots
are now mirrored under `docs/en/images`, and the VitePress build passed locally.
Exact head `12a382a7f44b2e233491ca693d4d506691cf8167` passed every GitHub check:
DCO, fast-contract, all six browser shards, heavy-media, native-shell, Windows
recovery, Linux/Windows/macOS Render QA, docs-site and the Verify aggregate.
PR #165 later extends the comparison to Creative Variants; its exact source-head
results are recorded below.

## Limits and separate gates

- This validates decoded synthetic playback and channel selection. It is not a
  human listening-quality, device-latency, hardware, or production-export
  certification. The preview discloses that frame-aligned output can omit a
  short final audio tail; it does not quantify or audition that tail.
- The known 1,152-sample / approximately 24 ms mixed-export audio-tail case and
  Export workspace warning remain a separate follow-up; see
  [real-media silence validation](validation-silence-real-media.md).
- The base implementation covers Named Versions; the candidate extension also
  migrates the Creative Variants modal's placeholder A/V comparison to the
  same service. A/B output remains a rendered review artifact, not an editable
  timeline or an accepted/adopted variant.
- Restart discards ephemeral preview outputs; durable Named Version snapshots
  remain intact and can be rendered again with a new request ID.
- Windows/macOS installers, signing/notarization, clean-machine update/rollback,
  native workstation checks, Resolve interchange, external media, GPU/4K and
  release-owner approval remain separate gates in
  [release validation](validation-release-gates.md).

## Test record

| Check                                                                          | Result                                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Focused A/V application, HTTP, UI and playback Vitest (4 files)                | Passed, 47 tests; includes real HTTP and FFmpeg output                                                                                  |
| App navigation extraction Vitest                                               | Passed, 38 tests                                                                                                                        |
| Playwright Editor lifecycle + Named Versions                                   | Passed, 12 scenarios; screenshot attachments at 1024×768 and 1920×1080                                                                  |
| `pnpm test:i18n`, `pnpm test:docs-i18n`                                        | Passed; 3,288 semantic keys, 195 English mirrors                                                                                        |
| `pnpm format:check`                                                            | Passed in exact-head `fast-contract-check` for `12a382a7`                                                                               |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-version-av-otio-venv/bin/python pnpm test` | Passed, 477 files and 6,313 tests in 1,471.12 s; OTIO 0.18.1 selected explicitly                                                        |
| `tests/integration/native-runtime.test.ts`                                     | Passed, 52 tests in 154.98 s, including the previously timed-out case                                                                   |
| `pnpm lint`, `typecheck`, `test:contracts`                                     | Passed in exact-head `fast-contract-check` for `12a382a7`                                                                               |
| Build, heavy-media, Windows recovery, three-platform Render QA, docs-site      | Passed in exact-head CI for `12a382a7`                                                                                                  |
| Browser shards                                                                 | 5/6 passed on `d17bbb6`; shard 1 duplicate-read regression fixed locally                                                                |
| Exact-head `30b9bde5` Verify                                                   | fast-contract and 6/6 browser shards passed; docs-site failed on missing English screenshots; heavy-media was cancelled when superseded |
| Exact-head `12a382a7` CI                                                       | Passed all checks: DCO, fast-contract, 6/6 E2E, heavy-media, native-shell, Windows recovery, 3-platform Render QA, docs-site, aggregate |
| PR #165 source-head Verify                                                     | Passed on `039d6c20`: fast-contract, 6/6 browser shards, heavy-media, native-shell, docs-site and aggregate                             |

### Creative Variants bridge candidate

The local candidate adds unit, application, HTTP integration and browser
coverage for opening an A/B pair from Creative Variants, flushing and saving
the exact project snapshot, preparing two distinct Composition renders,
synchronized playback and seeking, single-side audio selection, cancel/reopen,
and preserving the named snapshot. It also tests closing during playback,
responsive widths, named audio controls, the shared audio-tail warning, failed
cancel recovery, completed-render retry with a fresh Job ID, stale compare
response fencing, UTF-16-safe generated snapshot names, project identity
rejection and replay of a pre-fence durable create receipt.

Local candidate results on the feature worktree, before rebase and PR creation:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:i18n` and
  `pnpm build` passed. i18n validated 3,316 semantic keys. Build completed with
  the existing large-chunk advisory.
- Focused Unit: 4 tests across 2 files passed. Project-version owner fence and
  legacy-receipt tests: 2 passed. Actual FFmpeg comparison regression: 1 passed.
- Real HTTP integration: 2 passed. Playwright A/V review: 1 passed, with
  screenshots attached at 1024×768 and 1920×1080; actual MP4 decode, playback,
  audio-side switching, warning visibility, close-during-playback cleanup and
  durable snapshot retention were checked.
- `pnpm test:contracts` passed all 1,582 tests across 82 files in 20.20 s on
  the final local rerun. One earlier run exceeded the unchanged 5 s glossary
  benchmark at 6.50 s; the same test passed in isolation, then the full lane
  passed on rerun. No threshold or assertion was changed.
- The feature source candidate was rebased onto main `8604af87` and is PR #165.
  Its exact-head CI and independent roundtable review are recorded below; no
  post-merge main result is implied by the pre-merge checks above.

### PR #165 exact-head verification

Base: main `8604af87d81811f0394677d58f2fa9dd7382a90a`.
Feature source head: `039d6c20f3e05aacb5f3c5da7a0dbb92072dedbb`.
An independent roundtable code review of this exact source head found no code
findings. Verify
([43626767825](https://github.com/bynanci/open-film/actions/runs/43626767825))
passed fast-contract, all six browser shards, heavy-media (398 files / 4,758
tests), native-shell, docs-site and the aggregate. Three-platform Render QA
([43626767826](https://github.com/bynanci/open-film/actions/runs/43626767826)),
Windows media recovery
([43626767796](https://github.com/bynanci/open-film/actions/runs/43626767796))
and DCO ([43626766089](https://github.com/bynanci/open-film/actions/runs/43626766089))
also passed.

On the same feature source tree, local `pnpm format:check`, `pnpm test:i18n`
(3,316 keys), `pnpm test:docs-i18n` (195 English mirrors), `pnpm lint`,
`pnpm typecheck`, `pnpm test:contracts` (82 files / 1,582 tests) and `pnpm
build` passed. Focused App navigation tests passed 40/40. The build retains the
existing large-chunk advisory. Full Verify also exercises the browser A/V flow;
the synthetic render test decodes both actual MP4s and checks synchronized
transport, selected audio, source/version hashes, cache behavior and lifecycle
cleanup. UI screenshots at 1024×768 and 1920×1080 are attached above.

During earlier exact-head attempts, fast-contract formatting and English mirror
drift were corrected; the browser regression now asserts audio controls remain
disabled before a rendered preview exists; and the stale App-navigation test
harness was updated to exercise preview draining on project close. The final
head passed without weakening the assertions or adding retries.

These checks do not replace human listening, physical-device A/V review,
Windows/macOS installer and signing acceptance, Resolve interchange, GPU/4K,
or release-owner approval. Those remain separate release gates.
