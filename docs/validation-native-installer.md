# M7E native runtime / installer validation

Status: implementation candidate. Runtime/process behavior is tested with generated
media. A distributable target runtime, actual installer artifacts and clean
Windows/macOS observations remain separate, unfinished acceptance gates.
No native-installer release, signing identity or automatic-update feed has been
configured.

## Synthetic runtime evidence

`tests/integration/native-runtime.test.ts` builds the current service/launcher,
stages Node, FFmpeg/FFprobe, fontkit/resvg and a local CJK font into a temporary
bundle. It checks deterministic repeated manifests, hash mismatch rejection,
SPDX/file hashes, a read-only bundle root, a long CJK/space-containing install
path, and unwritable app-data diagnostics as a non-administrator Linux process.
The temporary license receipts are explicitly synthetic test data and the manifest is marked `test-only`; installer admission rejects that state. This bundle
is never uploaded or described as distributable third-party software.

The regression launches two independently owned services and authenticates their
different ephemeral loopback sessions. It opens a generated image/WAV project,
saves a Story edit, renders/decodes an MP4 through the bundled tools, checks the
source/output/font receipts, closes the first service without stopping the second,
restarts/reopens the saved edit and tests owner-channel EOF cleanup. It verifies
that original source hashes remain unchanged.

| Measurement     | Observed synthetic output                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Video           | H.264, 160 × 90, 10 fps                                                                                                                          |
| Decoded frames  | 20 frames, 2.0 seconds                                                                                                                           |
| Audio           | AAC, 48,000 Hz, mono                                                                                                                             |
| Source SHA-256  | Image `ea6d8e2f8361a6569eec7b0095bc40ed1b1a05f7750cf279f9032642994349a6`; WAV `e30a9f63dd5d80cd13ee594f95ce605a67790b7bede88669ca22d3c6a304d630` |
| Output SHA-256  | `6bf5c8656c1fab9dffef213840eadd999b532d09eb7ea3d9e8c98b6d66917070`                                                                               |
| Font SHA-256    | `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`                                                                               |
| Render warnings | Empty for this synthetic fixture                                                                                                                 |
| Project reopen  | Saved Story text retained after acknowledged close/restart                                                                                       |
| Ownership       | Closing one service preserves the second; EOF closes the owned service                                                                           |

`OPENFILM_NATIVE_QA_OUTPUT` retains only synthetic MP4 plus a path-free numerical
receipt in a caller-chosen local directory. It does not publish the test runtime
or its synthetic license receipts.

Unit regressions reject malformed schemas, unsafe paths, extra files, altered
bytes, links and unsupported updater policy; update verification refuses absent
trusted keys and invalid Ed25519 signatures. HTTP regression verifies session,
Host/Origin boundaries and independent ephemeral ports. Browser bridge tests
exercise graphical integrity diagnostics, keyboard retry and prevented native
close for pending drafts. These browser tests simulate the Tauri bridge; the
actual Tauri window/OS behavior remains a workstation gate.

## Local validation gates

| Command                 | Result                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`     | Passed; rerun after final documentation update.                                                                                                                                            |
| `pnpm test:i18n`        | Passed: 1,709 matching semantic keys across English, Traditional Chinese and Japanese.                                                                                                     |
| `pnpm lint`             | Passed.                                                                                                                                                                                    |
| `pnpm typecheck`        | Passed; final confirmation recorded in PR.                                                                                                                                                 |
| `pnpm test`             | Passed: 213 files / 2,926 tests; final full repeat completed in 106.34 seconds.                                                                                                            |
| `pnpm build`            | Passed; existing >500 kB bundle advisory.                                                                                                                                                  |
| `pnpm test:e2e`         | Focused native bridge: 2/2 passed. Complete local/CI suite results are tracked on the candidate PR.                                                                                        |
| `pnpm test:interchange` | Passed: 18 parser tests and official OpenTimelineIO 0.18.1 read/write/read; real Resolve remains unverified.                                                                               |
| `pnpm test:native`      | Full local Tauri gate blocked: GTK/WebKit development prerequisites are absent.                                                                                                            |
| Rust runtime module     | Rust 1.99.0 installed with checksum verification; all four isolated module tests, formatter and Clippy passed; locked Cargo metadata passed. Full Tauri compilation is a separate CI gate. |

Expected red tests first failed because runtime/session validation did not exist.
The first browser attempt could not find the default Chromium cache; using the
existing temporary Playwright browser path restored execution. The bridge fixture
then needed Tauri's actual detection flag. A meaningful close regression exposed
an invalid jobs read at Welcome; the product now handles the no-project case and
cancels a close request when preparation fails. Assertions were retained. An initial interchange invocation used the system Python without OpenTimelineIO; rerunning with the existing explicit `OPENFILM_OTIO_PYTHON` venv passed.

## Artifact and workstation gates

The candidate workflow is implemented but has not been dispatched with audited
target runtime artifacts. It requires reviewed SHA-pinned binaries, full license
receipts/source obligations and an independently reviewed manifest digest. It
also verifies service/launcher bytes against the current checkout build. Installed
developer tools and synthetic license fixtures do not satisfy this prerequisite.

- Linux installer artifact: not-run; this environment lacks Tauri host libraries
  and reviewed distributable runtime closure. Process-level Linux evidence above
  does not certify a clean Linux installation.
- Windows installer/upgrade/uninstall/rollback: not-run; no Windows workstation
  evidence or artifact has been obtained.
- macOS app/DMG/Gatekeeper/upgrade/uninstall/rollback: not-run; no macOS workstation
  evidence or artifact has been obtained.
- Signing and automatic updates: not configured. Signature verification is an
  inactive extension only; no downloader or automatic activation is claimed.
- Resolve, 4K, GPU/camera, ASR quality and cross-platform owner liveness gates
  remain independently pending.

Follow [the candidate-bound checklist](workstation-qa.md#m7e-native-installer-candidate).
Do not change a gate to passed without observations, artifact hashes and the
candidate SHA. CI and correctness-review results are tracked on the M7E PR;
green Cargo/Node/browser checks never substitute for these workstation gates.

### Follow-up correctness review

Full local browser suite passed 170 tests. Added a real-process regression that pauses after storage preflight, closes the owner and resumes startup; no service may start after the closed acknowledgement. Startup probes are abortable and concurrent service-close callers share one shutdown promise. Review fixes also prevent destruction of the main window before draft flushing, wait for the stdout reader before evaluating close acknowledgement, remount the workspace on a new connection, preserve executable permissions in safe archive transport and require matching shell/runtime versions. Final exact-head CI and remaining review findings are tracked in PR #38. Native workstation gates above remain not-run.

### PR #38 review remediation, 2026-10-20

The review baseline `6059a7dbd1d1d40a0a5c8f10c476808407328faa` already handles
`WindowEvent::CloseRequested` and calls `prevent_close()` before requesting the
frontend handshake. It also includes the source run ID, safe runtime tar
extraction, stdout-reader synchronization, connection remount, selected Rust
toolchain and shell/runtime version checks. These seven findings needed
verification rather than another implementation.

The remaining three findings are corrected:

- Candidate uploads wrap all installer outputs in `installers.tar`, preserving
  AppImage/macOS executable modes and bundle links; the upload includes an
  archive SHA-256 receipt and readable candidate identity.
- Update verification pins full bundle validation to the exact signed manifest
  digest. A deterministic regression replaces both the manifest and payload
  after the signed bytes are read; the unsigned replacement is rejected. The
  candidate verifier uses the same digest-bound read.
- The root build runs the pinned Vite JavaScript entry point with the current
  Node executable. It no longer depends on launching a Windows pnpm `.cmd` shim.
  A real build fixture passes with an empty PATH and unavailable pnpm launcher;
  this is launcher regression evidence, not a Windows workstation observation.

The baseline native-shell CI passed in
[run 39404610623](https://github.com/bynanci/open-film/actions/runs/39404610623/job/118567886352)
and [run 39404618276](https://github.com/bynanci/open-film/actions/runs/39404618276/job/118567784064).
Those runs cover the baseline commit only. The remediated integration head must
pass fresh native-shell CI before merge.

The remediation was validated locally with the following results. The new Node
regressions were observed failing before their fixes; the archive regression
first failed because the transport helper was absent.

| Check                                                                | Result                                                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test --maxWorkers=1`                                           | 214 files / 2,928 tests passed in 349.56 seconds.                                                                                                          |
| Focused manifest/update and build launcher regressions               | 7 Node tests passed; the signed-manifest replacement and missing-launcher cases failed on the baseline.                                                    |
| Python runtime extraction and installer archiving regressions        | 3 tests passed, including executable modes, macOS bundle links and the archive SHA-256 receipt.                                                            |
| Focused native bridge browser tests                                  | 3 passed on isolated ports 48538/18538 using Chromium; these simulate the Tauri bridge.                                                                    |
| Rust runtime module                                                  | 5 tests passed with Rust 1.99.0; includes the delayed stdout-close acknowledgement. Full-crate formatter and isolated module Clippy passed.                |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test:i18n` | Passed; 1,709 semantic keys match across all three locales.                                                                                                |
| `pnpm build`                                                         | Passed with the existing >500 kB frontend chunk advisory.                                                                                                  |
| Full local Tauri compilation                                         | Not run for this remediation: GTK 3 and WebKitGTK 4.1 development libraries are absent. Baseline native CI above passed; fresh integration CI is required. |

The built CLI smoke check also passed real media import, playable MP4 output,
local CJK title raster, exports and project reopen. Its protocol fixture remains
separate from ASR quality evidence.

The default Tauri configuration keeps bundling disabled; candidate packaging is
manual, requires a reviewed runtime and does not publish a native-installer release. The code is
suitable for merge as disabled candidate tooling after fresh CI passes. Native
installer distribution remains blocked on audited target runtimes and clean
installation observations, including Windows/macOS signing, upgrade, rollback
and uninstall. These tooling checks qualify neither a native-installer release
nor the unfinished workstation gates; the source release version is tracked
separately.

### Runtime recovery and additional review, 2026-10-20

The actual RuntimeGate/App lifecycle regression reproduced loss of unflushed
beat and category drafts when Retry replaced the App owner. Retry now retains
only authored local beat/category values and ScenePlanner inputs in bounded
window memory before replacing the connection. Manually edited proposal text
remains downloadable; generated proposals, acceptance receipts, provider
consent/configuration and pending external actions are not replayed.

Restoration requires the same server-observed project path and ID, the same
story/beat or asset owner, and an unchanged saved baseline. Category restoration
also compares media URI, hash and type after a fresh read. Late reads and dirty
live fields cannot be overwritten. Newer edits take priority; conflicting copies
stay downloadable until explicitly discarded. Each snapshot is consumed in the
same synchronous turn that applies it to its checked owner, so applied drafts
are never offered as pending copies during another recovery read. Discarded
entries are rechecked after every await and cannot return through delayed reads.
An empty replacement service can start and the user can reopen the original
project. Recovery is limited to 16
entries / 1 MiB; exceeding either bound keeps the old App owner mounted instead
of truncating its only draft copy. Retained drafts and restored dirty fields
continue to prevent close. The local guard is installed before boot/recovery
awaits, covering dirty live fields even while a recovery read is pending.

Additional findings are corrected: the native shell hashes and parses the same
bounded manifest buffer; a dead clean service can close without an unavailable
jobs read or a new shutdown acknowledgement, while live shutdown still requires
its acknowledgement; and the workspace is inert during connection recovery or
close. Local beforeunload guards still prevent dead-service close for drafts,
and normal live close still uses the existing flush preparation.

| Follow-up check                                                                      | Result                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actual RuntimeGate/App/ScenePlanner headless lifecycle regressions                   | 29 passed, including exact/empty values, repeated failed Retry, path/story/media changes, empty-service reopen, late/newer edits, mixed recovery ownership, overflow retention, pending/mixed discard and pending/live/dead close guards. API/native I/O is simulated; the actual setup/lifecycle code runs. |
| Focused lifecycle, existing benchmark, script-review and asset-selection regressions | 4 files / 112 tests passed with one worker.                                                                                                                                                                                                                                                                  |
| Exact Rust runtime module                                                            | 9 tests passed; formatter and isolated Clippy passed with Rust 1.99.0. Full Tauri compilation remains dependent on native CI.                                                                                                                                                                                |
| Static checks                                                                        | Lint, TypeScript/Vue and formatting checks passed; 1,715 semantic keys match across all three locales.                                                                                                                                                                                                       |

Expected failures were observed before fixing lost drafts, older-copy priority,
late-owner listener installation, partial-recovery snapshot consumption after an
owner refresh, pending/mixed draft discard, pending close guards, and dead-service close. Snapshot
application and consumption now share one synchronous checked ownership boundary.
The new bounded manifest-reader tests first failed because that verification boundary was
absent, then passed with the same-buffer implementation. No full suite or
browser suite was rerun in the isolated follow-up checkout; the integration
head requires the combined gates and fresh native-shell CI. Windows/macOS and
all other workstation gates above remain not-run.

### Native I/O and global shortcut follow-up, 2026-10-20

The original keyboard isolation finding also applies to window listeners:
inert DOM alone does not prevent Timeline/Precision global keydown handlers.
A Chromium regression runs the actual RuntimeGate template/lifecycle and exact
production editor handlers with observable action sinks. It reproduced Delete,
Undo and marker actions behind runtime controls. RuntimeGate now stops keydown
propagation in the window capture phase while blocked, starting or closing, and
when a retained-draft control owns the event during normal editing. It preserves
default activation: Tab, Enter and Space still operate Back/Retry, Download and
Discard, and ready workspace shortcuts resume normally.

The reported audio-quality and generated-audio players now use typed URL
helpers bound to the current native port/session and encoded project/receipt
identity. Both use anonymous cross-origin media requests, matching the existing
App convention and preserving the service's Origin checks. The native-origin
Chromium regression runs both real components against an actual ephemeral
private-session server, measures generated fixture media, decodes original and
candidate MP4 audio and previews the explicit local mock's generated audio.
It checks byte-range responses and rejection of the unprefixed endpoint.
The simulated website origin receives Chromium's local-network permission in
the fixture; this is not an observation of an installed Tauri WebView.

The same contract was independently reproduced in the existing Soundtrack source
player: changing only its live cross-origin mode enabled decoding on the same
native URL. The bounded template audit adds anonymous CORS to 13 service-backed
media tags in Timeline/Precision/Soundtrack, photo/title previews, timeline
thumbnails and visual-QA frames. Existing App, AssetCard, ScenePlanner and
Transcript media already use it. The graphics preview consumes an already
fetched blob URL and requires no change. A permanent actual Soundtrack/TimelineClip
browser case now checks native source decoding, four-second duration, decoded
thumbnail dimensions and continued rejection of an attacker Origin.

Owned service shutdown now registers read-only file responses before filesystem
awaits, aborts their response/pipeline on close, checks cancellation after path
and stat reads, and waits for their settlement. Mutation sockets keep their
existing graceful lifetime. Real-process regressions pause a 128 MiB native
range response under backpressure and hold another read before stat returns;
both obtain a matching successful close acknowledgement and exit while an
already acquired PATCH completes and persists its Story title. No force kill
or blanket connection destruction is used for normal shutdown.

A genuine service spawn failure now settles its completion and is closable
without an acknowledgement from a process that never existed. A trusted test
hook removes the child's working directory after verified preflight to produce
a real ENOENT spawn error. The launcher closes successfully, and a fresh owner
then starts and closes. Successfully spawned services retain the existing live
acknowledgement and exit requirements.

| Check                                                                                                    | Result                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused native runtime, stream/write, owned control, draft lifecycle and actual audio-player regressions | 7 files / 45 tests passed with one worker.                                                                                                                                                                                                                                      |
| Chromium runtime keyboard and native audio/source/thumbnail playback                                     | 4 passed without default ports; media service uses an ephemeral port. Keyboard fixture mocks the App slot/IPC/action sinks while executing the real Gate and editor handlers; media fixture runs real players/thumbnails, media generation and HTTP/session boundary.           |
| Expected failures                                                                                        | Observed background shortcut actions, all three raw audio media URLs, missing close acknowledgement with a paused response, and unclosable real spawn error before their fixes. A native-origin media isolation probe also demonstrated the required cross-origin request mode. |
| Native module and workstation status                                                                     | Rust runtime source is unchanged from the nine-test reviewed head. Combined gates and fresh native-shell CI remain required. All native-installer workstation gates above remain not-run.                                                                                       |

### Packaged FFmpeg filter admission follow-up, 2026-10-20

The packaged launcher now requires 43 filters before starting its service. The
previous 17-filter admission list admitted reduced runtimes that could not run
shipped output profiles or Visual QA. The bounded production-call audit retains
every previous requirement and adds the following actual graph dependencies:

| Production workflow / graph source                                                                                         | Added required filters                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Renderer, output profiles, proxy/motion normalization (`render/index.ts`, `media/index.ts`, `application/motion-media.ts`) | `pad`, `crop`, `setsar`, `color`, `rotate`, `tpad`                                            |
| Film looks, photo motion and PhotoDepth (`render/look-filters.ts`, `photo-filters.ts`, `graphic-scenes.ts`)                | `colorchannelmixer`, `perspective`, `split`, `alphaextract`, `blend`, `alphamerge`            |
| Timeline audio and decoded Audio Quality (`render/index.ts`, `audio-quality.ts`)                                           | `atempo`, `adelay`, `alimiter`, `anullsrc`, `asetnsamples`, `astats`, `ametadata`, `loudnorm` |
| Scene detection, PNG delivery and Visual QA (`media/intelligence.ts`, `application/export-profiles.ts`, `visual-qa.ts`)    | `select`, `signalstats`, `metadata`                                                           |
| Explicit local motion fixture and HDR preview/thumbnail/render (`application/motion-provider.ts`, `media/color.ts`)        | `zoompan`, `zscale`, `tonemap`                                                                |

There is no shared required-filter capability list in production. Existing
`SOURCE_CLOCK_AUDIO_FILTER` and `AUDIO_METER_FILTER` remain the graph sources for
waveform/Whisper timestamp normalization and decoded meters respectively. The
audit includes them; `asetpts`/`aresample` were already required. Production has
no `ebur128`, `silencedetect` or `showwaves` invocation. The local TTS mock writes
WAV bytes directly, and its normalization adds no explicit filter. Test-only
`sine`/`testsrc` generators and quality-script-only filters are not admission
requirements. The normal nonpackaged HDR capability diagnostic remains intact.

The new real-process fault-injection test stages and hash-verifies an executable
fixture that delegates to stock FFmpeg but synthetically omits one advertised
filter at a time. This is capability fault injection, not 43 separately compiled
FFmpeg builds. Before the fix, omitting `pad` still reached `ready`; afterward
each of the 43 independent omissions blocks with `runtime.codecs`, never starts
a service and closes cleanly. A complete-advertisement fixture is accepted. The
existing unwrapped stock-FFmpeg runtime test also starts, renders/decodes actual
H.264/AAC output, verifies source/font/output hashes, reopens the saved project
and preserves independent service ownership. These synthetic Linux observations
do not qualify an installer or a Windows/macOS workstation.

| Focused follow-up check                                                                     | Result                                                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Actual native launcher, reduced-advertisement fixture and stock-FFmpeg runtime              | 3 tests passed; all 43 omissions are checked independently within the new fault-injection case.            |
| Stock-FFmpeg Audio Quality, profiles, Visual QA, local motion, HDR and manifest regressions | 6 files / 42 tests passed with one worker, including decoded output and original-byte preservation checks. |
| Static validation                                                                           | Focused ESLint, full TypeScript/Vue, changed-file formatting and `git diff --check` passed.                |

No full test/browser suite or native OS workstation gate was rerun for this
isolated list change; combined release validation remains separate.

### Failed shutdown, startup cancellation and native downloads, 2026-10-20

Three remaining review findings were reproduced against the integrated source.
An actual staged launcher retained a dead service after its real private control
channel reported `close-failed`. The launcher now keeps that failure visible,
waits for the service's actual exit and exits its owner channel nonzero. It never
reports `closed` success for the failed shutdown. Rust can reap the owner and a
single explicit Retry starts a fresh verified service; successfully spawned live
services still require their matching close acknowledgement and exit.

RuntimeGate now polls pending close requests during initial startup and Retry.
Live App owners retain the full jobs/Collect/relink/flush close preparation;
unknown runtime states with an App veto close without flushing. A blocked
dead service retains the existing local-draft guards, and an initial startup
without an App can cancel directly. An accepted close invalidates its startup
response before awaiting native close; late ready results after close, failure
or disposal cannot remount the workspace. A veto leaves the pending Retry valid
and its authored drafts protected.

Rust close no longer waits behind the start operation mutex. It cancels that
attempt's ticket before taking the child lock; file hashing checks cancellation,
and spawn publishes the child atomically with its final cancellation check.
Successful close remains terminal until shell exit; failed close permits a new
explicit Retry. The owned reader's terminal close evidence survives cancellation
of a startup attempt. Late ready, unrelated blocked and EOF publications stay
fenced; replacement waits for the old reader to finish before taking ownership.
Real-process Rust regressions use a hash-verified six-file synthetic shell
launcher, separately from the Node/FFmpeg runtime acceptance test.

Actual Chromium at `http://tauri.localhost` reproduced an Origin-less private
export anchor receiving 403. All 11 service-backed download links now share
`LocalDownload`: seven export/profile links, two caption links, Collect ZIP and
NLE handoff. Ordinary same-origin browser anchors retain direct streaming and
Enter activation. Cross-origin service links fetch through the current private
prefix, with redirects and credentials disabled, then save a window-local blob.
Owner/URL/filename changes and unmount abort pending fetches; old connection/body
results cannot publish. Errors are visible, and created blob URLs are revoked.
Origin, Host, session and consent rules are unchanged; no new download credential
or protocol is introduced.

The permanent browser cases save actual rendered MP4, render manifest, SRT/VTT
and caption manifests, compare each download's SHA-256 to its server-owned file
and attach filename/byte-count/hash evidence. They cover native Enter activation,
blob cleanup, ordinary direct streaming with zero blobs, a fault-injected403
error with no unhandled rejection/download/blob, and continued real403 rejection
of an Origin-less cross-site anchor, attacker Origin and missing native prefix.
The fault-injected response exercises error presentation; the successful output
and Origin controls use the real ephemeral native-session server.

Full Tauri compilation requires fresh native-shell CI: local GTK/WebKit
development prerequisites remain absent. Native OS save-dialog behavior and
large cross-origin blob memory use remain manual gates. These Linux process and
Chromium observations do not certify an installed WebView or any installer;
the Windows/macOS and distribution gates above remain not-run.

| Focused final follow-up check                                                                              | Result                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native launcher/stream/control/session, draft lifecycle, shared download and consumer/manifest regressions | 9 files / 108 tests passed, one worker. Existing draft Discard/ownership, live ACK and acquired-write controls remain passing.                                                                      |
| Actual Chromium downloads, same-origin streaming, errors and Origin controls                               | 5 tests passed. Download filenames, byte counts and SHA-256 values are attached; successful artifacts are compared to their server-owned files.                                                     |
| Exact Rust runtime module                                                                                  | 13 tests passed; formatter and isolated Clippy passed with Rust 1.99.0. Includes verified pending-process cancellation, late ready rejection, first-Retry owner ACK and hash cancellation controls. |
| Static checks                                                                                              | Focused ESLint, full TypeScript/Vue, changed-file formatting and diff checks passed.                                                                                                                |

Expected RED cases were observed for the real failed-close owner, busy initial
startup/Retry and Rust operation lock, and actual native-origin export navigation.
Independent review also exposed the pending live-job veto and cancelled-reader
terminal-ACK edges; their causal controls remain in the passing suite. A consumer
template parse test caught a closing-tag edit error, which was corrected without
removing the inventory assertion. No full test or browser suite was rerun in this
isolated follow-up; integration and fresh full native CI remain separate gates.

## 2026-10-30 runtime closure and emitted attribution

Source checkpoint: `codex/v1-native-runtime-closure`, based on actual
`origin/main` `d5a286ed9250872e8eb9b1c3e40adb926f913d34`. This is the bounded
Tasks 5–6 engineering increment. Parent whole-branch review and repository-wide
CI remain separate from these local results. The earlier GLib/security execution
was not resumed; no vulnerability, crash, debugger, or control reproduction was
run here. The original remediation worktree was left untouched.

Environment: Linux x64, kernel `6.18.55`, Node `24.19.0`, local pnpm `11.19.0`
with the unchanged frozen lock, GNU readelf/binutils `2.44`. Rust's isolated
`1.99.0` toolchain was used only for the original standalone collector smoke
fixture described below. GTK3 and WebKit2GTK 4.1 are absent according to actual
`pkg-config` observations; this is not a completed native application build.

| Check                                            | Observed result                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused Vitest command below                     | **114/114 passed**, 8 files; includes the 52 genuine owned port-0 native-runtime integration checks                                        |
| `python3 scripts/native/test-inspect-linkage.py` | **9 passed**; ELF/PE/Mach-O fixtures, recursive absence/ABI/path/architecture faults, Mach-O dylib identity and unmodeled loader rejection |
| `python3 scripts/native/test-extract-runtime.py` | **2 passed**                                                                                                                               |
| `pnpm lint` / `pnpm typecheck`                   | Passed                                                                                                                                     |
| `pnpm format:check`                              | Passed                                                                                                                                     |
| `pnpm build`                                     | Passed; existing large-chunk notice remains visible                                                                                        |
| `pnpm test:ci-partition`                         | Passed: 359 files classified, 52 contract / 307 media                                                                                      |
| `pnpm test:docs-i18n`                            | Passed: 10 README locale sets / 129 English reference mirrors                                                                              |

```sh
pnpm exec vitest run tests/unit/native-attribution.test.ts tests/unit/native-cargo-attribution.test.ts tests/unit/native-distribution-receipt.test.ts tests/unit/native-linkage-receipt.test.ts tests/unit/native-support-files.test.ts tests/unit/runtime-manifest.test.ts tests/unit/build-launcher.test.ts tests/integration/native-runtime.test.ts
```

The regressions were observed failing before their implementations. Controls
cover missing/hash-invalid sidecars, traversal, final/parent links, hardlinks,
case/ownership/destination collisions, full-notice absence, architecture
mismatch, unknown/recursive/system imports, symbol-version mismatch, unreviewed
or replaced OS baseline, edited raw contribution mappings, stale source/package/
lock/output hashes, and an attempt to relabel shipped JS as CLI-only. The build
launcher test retains its actual no-pnpm Node invocation and exclusive-rename
checks, using copied private source and the real attribution helper.

The actual service output exposed esbuild-injected `__esm`/`__export` code that
its module metafile omits. Its frozen MIT package is now explicitly attributed
when helpers occur; helper presence has a null byte count. Actual Vite output
also includes the frozen Vue export helper. The final regular build recorded
**8 artifacts / 31 contributing package identities**, including **12 third-party
identities**, rather than all frozen lock entries. The contribution file SHA-256
was `88b3feb286c8408071e7c6c1d7bcd21b8e6511f283cc21e0c830fd495aa2f8e1`.
Full license/NOTICE/source-obligation approval for those actual distribution
inputs remains open. `NOASSERTION` is never used as license approval.

Actual tool observations were retained locally in
`/tmp/openfilm-runtime-closure-evidence/` for review:

- GNU readelf inspected an original, harmless static C fixture. Its binary hash
  was `a9bf037f2498acb0bb24a4598e6152a50e5bac207941a70227ccaf8f1d85a051`;
  the executed technical receipt hash was
  `4342d6b3e348cb88dfea1d0a028b709efbd9492f6f997f6dba906e8f06317505`.
  The policy explicitly says `reviewed: false`; `distributionApproved` is false.
  This demonstrates actual inspector execution, not an audited runtime input.
- Actual Node `24.19.0` hash
  `bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12`
  imported `libdl.so.2`, `libstdc++.so.6`, `libm.so.6`, `libgcc_s.so.1`,
  `libpthread.so.0`, `libc.so.6`, and `ld-linux-x86-64.so.2`.
  The inspector correctly rejected it without an explicit reviewed system
  baseline. No host libraries were copied or automatically approved.
- `rustc 1.99.0 (b940084d7 2026-09-28)` built only the original standalone
  `openfilm-attribution-smoke` fixture with locked release JSON output and an
  explicit `x86_64-unknown-linux-gnu` target. The collector recorded one target
  artifact, shell hash
  `957c606648be1a20050164cc0851ecff9807776925e579e3b22401fd2ee03824`,
  canonical workspace identity and the actual compiler/invocation evidence.
  The final collector receipt hash was
  `243e3eb78937cf4a61f274254f70d545eea4260e17308a3fb11378410c375ef3`.
  This fixture is not the OpenFilm app and is never distribution-approved.

The parent approved the artifact-DAG clarification in the copied design/plan:
RuntimeManifest hashes JS/runtime/tool/npm/license receipts; the final shell
embeds that manifest digest. Final Rust/shell attribution therefore lives in a
separate post-build receipt outside the runtime. Tests verify that the runtime
manifest remains unchanged and reject writing the external receipt inside it.
Task 7 must later bind both receipts and final installer/trust/security bytes;
there is no self-hash or fixed-point claim.

Both existing M7E checkboxes remain open. Missing audited per-platform Node/
FFmpeg/font/addon inputs and complete notices/source offers, target import/ABI
preflight, full application native build/security evidence (including the GLib
blocker), compiled/generated/sysroot source review, candidate binding, signing/
notarization, installer replace/rollback/uninstall and physical Windows/macOS
workstation checks remain required. Automatic updates remain off and the default
`bundle.active=false` configuration is unchanged. No installer, PR, merge or
release was produced by this implementation task.

## 2026-10-30 independent runtime review corrections

The first independent whole-feature review examined exact source
`350a48f0bf58f044b0e3a9a706486680151d8960` against
`d5a286ed9250872e8eb9b1c3e40adb926f913d34` and requested three P2 corrections.
The previous evidence above is retained at its actual checkpoint.

Ten controls reproduced the reviewed defects on an otherwise complete synthetic
receipt: five native reviewed/verified-baseline failures, three unaccounted
static/ambiguous link directives, and two real external directory aliases into
the runtime. The complete positive fixture itself remained reviewable, so an
unrelated missing prerequisite could not mask these controls. Additional RED
checks reproduced missing Cargo target/host role observations and incomplete
policy/tool/binary receipt fields.

The corrected native review requires an executed verified target binary
observation, policy/tool identities and an independently reviewed OS baseline
reference. Exact target static link directives now require one final-shell/source
inventory binding and complete license ownership; the resulting package and SPDX
retain the directive and artifact relationship. Host-only libraries remain
build-only. Source, owner, name, shell, missing/unreviewed license and duplicate
coverage counterexamples all remain blocked. Canonical output resolution refuses
existing parent aliases into the runtime before even creating output parents;
Windows drive/case/UNC and POSIX sibling controls retain their correct bounds.

Frozen corrected source passed the full focused command above: **141/141 tests
in eight files**, zero failed/pending tests. The three directly changed test
files also passed **61/61** before the frozen run. Python linkage **9/9** and
extraction **2/2**, TypeScript/Vue, full ESLint and the normal build passed.
The normal build still records **8 artifacts / 31 package identities / 12
third-party identities**, contribution SHA-256
`88b3feb286c8408071e7c6c1d7bcd21b8e6511f283cc21e0c830fd495aa2f8e1`.
The existing bundle-size notice is retained. Formatting, documentation mirrors
and CI-partition results are recorded with the clean handoff; full hosted/repo
CI and a fresh scoped correction review remain parent-owned.

All receipts remain `distributionApproved: false`; runtime review cannot approve
the compiled shell or its OS baseline. No new native code, crash/debugger
reproduction, full Tauri build, signing, installer, workstation observation or
release occurred. The actual Node/import and standalone Rust smoke observations
above keep their original hashes and limits. Both M7E checkboxes and all
source-security, target-input, trust and physical gates remain open.

### 2026-10-30 clean-checkout fixture correction and merged foundations

Hosted Verify run `41110757757` at `ec8e43fc6fed30f8ccbf0802cfbb2f68ac6929d5` failed three media tests because the fixtures required a pre-existing repository `dist/`. The other 3715 media tests passed. The correction supplies owned temporary repositories, real generated contribution inputs and explicit staging entries; it retains the attribution, permission and hash assertions. A fresh detached checkout at `1d54764bb88fd3ae18065431b1964f469340aa55` passed all 59 affected tests with no `dist/` before or after execution. The identical test correction was independently reviewed at `b0d3f43050c8f94b7ed3392653bb0312f4a18f35`.

The integration checkpoint `9aec7aecbea3633cefda1c5a86ff510897460bb8` includes merged main `6cdaa4fa46f83c2b41ffc4ee34eee586134a8532`; 83 native attribution/support/Cargo/distribution/linkage/build-launcher cases, type checking, the actual desktop/server/CLI build and documentation locale checks passed locally. These results do not establish native source admission, installer trust or workstation verification. The published successor requires fresh hosted gates.

## 2026-11-04 candidate evidence reconciliation

This record reconciles the merged source at `c068b8fdf2a09832443db892770b22ad3e5a36e6` with D7B/M7E readiness. It records hosted evidence and the remaining release boundary; it does not mark a native installer or v1.0.0 ready. The public GitHub release remains `v0.4.0`. PR #99 aligns readiness documentation; it does not supply a runtime candidate or installer evidence. On 2026-11-04 at 16:11 UTC, main had advanced to `fcc00131c2f2d90d9dd20952dad192a65cceaa31` with Catalog/story ranking and paging changes. The recorded hosted checks below remain bound to c068; re-run the relevant candidate checks against fcc before using them as current-main evidence.

### Candidate identity and hosted checks

The exact source candidate examined was `c068b8fdf2a09832443db892770b22ad3e5a36e6`. Its Tauri lockfile SHA-256 is `a6d4ca550fcf3db4b851405d650e8d7d8aa74de5e4f160f2eb950ef7cec66142`.

| Run                                                                                                  | Result                        | What it establishes                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Verify #41309782967](https://github.com/bynanci/open-film/actions/runs/41309782967)                 | Success; all 9 jobs succeeded | Format, locales, lint, types, contract/media gates, four browser shards, Linux native-shell build/tests, docs build and required-lane aggregation passed on this source SHA. |
| [Windows media recovery #41309783080](https://github.com/bynanci/open-film/actions/runs/41309783080) | Success                       | The hosted Windows recovery regression workflow passed; this is not a clean-machine installer observation.                                                                   |
| [Render QA #41309783048](https://github.com/bynanci/open-film/actions/runs/41309783048)              | Success                       | Linux x64, macOS arm64 and Windows x64 render QA jobs passed. This does not build, install, sign or notarize a desktop package.                                              |
| [Dependency security #41480452103](https://github.com/bynanci/open-film/actions/runs/41480452103)    | Success; both jobs succeeded  | The JavaScript audit and the RustSec scan completed for the same source SHA. Informational Rust advisories are retained below.                                               |

The Rust scan artifact is [rust-advisories, artifact 13158229380](https://api.github.com/repos/bynanci/open-film/actions/artifacts/13158229380/zip). Its `rust-audit.json` SHA-256 is `381960f4cfc3cc42d32771e37cf993f2b5ef2c028ad18415b0d03d4cd9d7ff86`. The scan used advisory database commit `263a4d951a0867d4bddc29dddd6d59427c78f9a7`, last updated 2026-11-02, and examined 431 locked dependency entries.

A fresh local `cargo-audit 0.22.2 audit --file
apps/desktop/src-tauri/Cargo.lock --json` run on 2026-11-04 used database
commit `965bf9ad083b58e6340d65829d85217b18be9290` (updated
`2026-11-03T21:34:28+01:00`). It examined the same 431 locked entries, found
zero vulnerabilities and the same two `unsound` warnings plus one
`unmaintained` notice. The JSON SHA-256 is
`8708edb849f8a08b52375ff2ace19302ae786ff76244d649ee47bde2c52fba21`; the
standard scan exited 0. Repeating with `--deny unsound` exited 1 on the two
unsound notices. The JSON is identical and the process status is recorded
separately; a normal audit's exit 0 is not a security-gate pass.

### Rust dependency findings

The audit reports `vulnerabilities.found: false` and zero entries in its vulnerabilities list. It also reports two `unsound` advisories and one unmaintained package. The successful job therefore means the scanner completed under its configured policy; it does not mean the listed unsound code is patched or proven unreachable.

- `glib 0.18.5`, registry checksum `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`, is still reported for [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html). The affected `VariantStrIter` methods are reported for `>=0.15.0,<0.20.0`; the advisory lists `>=0.20.0` as patched. The locked GTK/Tauri graph remains on the 0.18 family, so a package-family upgrade is not established as compatible. The exact Linux target tree contains GLib through Tauri/GTK; the Windows and macOS target trees do not. A source scan of first-party Rust and resolved dependency sources found no `VariantStrIter` / `array_iter_str` call sites outside GLib. This is useful reachability evidence, not a binary call-graph proof or source remediation. Keep the GLib release gate open pending a compatible upstream correction or completion and independent review of the source-aware control plan.
- `tokio 1.53.2`, registry checksum `e95f91fcc7a621e8b030f6aa23c71fe9838ae2fb4d8118b75602a328f5144044`, is still reported for [RUSTSEC-2026-0386](https://rustsec.org/advisories/RUSTSEC-2026-0386.html). The advisory lists `>=1.53.3` as patched in this version line. Rust/Cargo 1.99.0 reverse feature trees for Linux x64, Windows x64 and macOS arm64 show Tokio enabled through Tauri, but no `net` feature. The affected `io::unix::AsyncFd` API is gated by `cfg(all(unix, feature = "net"))`; Windows is non-Unix and neither Unix target enables `net`. A source scan found no affected safe-constructor calls outside Tokio. Therefore this API is not reachable in the currently resolved target/feature graphs; the advisory remains in the lockfile and the graph must be reassessed if features change. This review made no dependency update.
- `proc-macro-error 1.0.4` remains listed as unmaintained under `RUSTSEC-2024-0370`; the audit finding is preserved, not suppressed.

Using isolated Rust/Cargo 1.99.0 tooling, locked reverse feature trees were inspected for `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc` and `aarch64-apple-darwin`; the current lockfile SHA-256 remains `a6d4ca550fcf3db4b851405d650e8d7d8aa74de5e4f160f2eb950ef7cec66142`. These observations improve on the earlier direct-source grep, but do not establish a binary call graph. In c068 main, the GLib code remains unpatched; its gate still requires compatible source remediation or full source-aware control evidence and independent review. Keep all findings visible and re-audit any later candidate against a fresh database. Do not infer a release pass from the standard audit's exit 0.

### 2026-11-06 current-main audit refresh

The exact `main` source inspected was `b6304914a7eb351d8e5d0a0a11b41e163713e20b`.
With isolated Rust/Cargo 1.99.0 tooling and `cargo-audit 0.22.2`, a new
`cargo audit --json` on `apps/desktop/src-tauri/Cargo.lock` completed at
2026-11-06 09:45:07 UTC. The lock SHA-256 is
`a6d4ca550fcf3db4b851405d650e8d7d8aa74de5e4f160f2eb950ef7cec66142`, unchanged
from the prior source-aware review; the Tauri manifest and toolchain declaration
are unchanged from c068 as well. The scan examined 431 locked packages and used
advisory database commit `26fd2d43f7280a1fb925a3743ec463017afe7119` (1,409
advisories; last updated `2026-11-05T09:50:49+01:00`). The raw JSON is retained
at [`rustsec-main-b630491-2026-11-06.json`](https://github.com/bynanci/open-film/blob/main/docs/evidence/native-installer/rustsec-main-b630491-2026-11-06.json),
SHA-256 `1e7c14faa21b79ab4b72fa0e3f7c0a8acbf6e61e828906c1a544b40845f823dc`.

The report has zero vulnerabilities, two `unsound` advisories (GLib and Tokio)
and one `unmaintained` notice (`proc-macro-error`). Its scanner settings classify
`unsound` and `unmaintained` as informational; the ordinary command therefore
exited 0. This confirms the current lockfile warnings but does not make them
patched, unreachable by binary proof, or release-approved. The GLib
`VariantStrIter` source-aware admission gate remains open. No dependency update,
native build, source reproduction or workstation observation is claimed here.

### 2026-11-06 repeat audit after advisory database update

A second scan of the same `main` candidate `b6304914a7eb351d8e5d0a0a11b41e163713e20b` used isolated Rust/Cargo 1.99.0 tooling and `cargo-audit 0.22.2`. `cargo audit --json` completed at 2026-11-06 16:03:55 UTC against `apps/desktop/src-tauri/Cargo.lock`. The 431-package lockfile remains at SHA-256 `a6d4ca550fcf3db4b851405d650e8d7d8aa74de5e4f160f2eb950ef7cec66142`. The refreshed advisory database is commit `309392b18f6b17022f82c701f300433126901068` (1,422 advisories; last updated `2026-11-06T16:34:32+01:00`). The raw report is retained at [`rustsec-main-b630491-2026-11-06T1603Z.json`](https://github.com/bynanci/open-film/blob/main/docs/evidence/native-installer/rustsec-main-b630491-2026-11-06T1603Z.json), SHA-256 `00f4182c10f7a51abf1b1a47f73b01e309cb95f71a6691d94f86ccfaf7b57eec`.

This repeat scan again found zero vulnerabilities, two `unsound` notices (GLib `RUSTSEC-2024-0429` and Tokio `RUSTSEC-2026-0386`) and one `unmaintained` notice (`proc-macro-error` `RUSTSEC-2024-0370`). The configured policy treats those warning classes as informational, so the command exited 0; the warnings remain open and are not a security or release pass. The lockfile, target graphs, and dependency source were not changed by this evidence refresh. The previously documented GLib source-aware gate and installer/workstation gates remain open.

### 2026-11-06 Tokio patch candidate

The open PR #120 candidate is based on main `b6304914a7eb351d8e5d0a0a11b41e163713e20b` and changes only the Tokio package entry in `apps/desktop/src-tauri/Cargo.lock`: `1.53.2` → `1.53.3`, the patched version listed by `RUSTSEC-2026-0386`. The resulting lockfile SHA-256 is `2e36795c727a50337aa8fe7aa9b20a40bedd99ecf53c265036ae07f13b6c0698`; the Tokio `1.53.3` registry checksum is `ce3335fa71841cda333a58d7615b03901380ecf09d59b3296d21f8bbac0dde4e`. No unrelated lockfile versions were changed.

At 2026-11-06 16:57 UTC, `cargo audit --file apps/desktop/src-tauri/Cargo.lock --json` completed against advisory database `309392b18f6b17022f82c701f300433126901068` (1,422 advisories). It examined 431 packages, reported zero vulnerabilities and no Tokio warning, while retaining GLib `RUSTSEC-2024-0429` and unmaintained `proc-macro-error` `RUSTSEC-2024-0370`. The scanner classifies both as informational and exits 0; this does not close the remaining security or release gates. Raw JSON: [`rustsec-candidate-tokio-1.53.3-2026-11-06T1657Z.json`](evidence/native-installer/rustsec-candidate-tokio-1.53.3-2026-11-06T1657Z.json), SHA-256 `37721d09476c72f4e2adaed62f73a7f9ef84849d43918cb858520e64bafdc5fa`.

`cargo tree --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --target x86_64-unknown-linux-gnu -i tokio` resolves `tokio v1.53.3` through Tauri; `cargo metadata --locked --offline --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps --format-version 1` passed. No first-party Rust `AsyncFd` use was found. Native compilation, fresh hosted CI for this candidate and Windows/macOS workstation acceptance remain pending; this candidate has not been merged or admitted for release.

The local `pnpm test:native` attempt passed `cargo fmt --check`, then stopped during Clippy dependency compilation because this Linux host lacks `glib-2.0 >= 2.70` in pkg-config. The chained Rust tests were not reached. This is a host prerequisite failure, not a native-code pass or failure; the exact candidate still needs the hosted native-shell gate.

### Separate D7B source-repair experiment (not admitted)

An isolated source-repair experiment at `423ccd3af308fe855b0da7f9ab9d0e1e78be8b2a` was audited on 2026-11-04. It is not based on current main `fcc00131c2f2d90d9dd20952dad192a65cceaa31`: it is 219 commits behind and 5 commits ahead, so it is not a release candidate and must be reconciled onto current main before further candidate validation. The reviewed GLib source verifier passed for 121 files, and locked Linux metadata/closure verification passed for 431 dependencies with the source patch and Tokio 1.53.3. The candidate lock SHA-256 is `c0f457e0ab610c0db6c5d4eddc5997f4de3a91e2c832587c956d337b5e7c8161`.

The fresh three-graph RustSec capture used `cargo-audit 0.22.2` and advisory DB commit `965bf9ad083b58e6340d65829d85217b18be9290` (1,403 advisories; fetched 2026-11-04). With the reviewed path-patched GLib source, the candidate scan exited 0 under `--deny unsound`, found zero vulnerabilities and retained the `proc-macro-error 1.0.4` / RUSTSEC-2024-0370 unmaintained notice. The current-registry control exited 1 for GLib 0.18.5 / RUSTSEC-2024-0429; the historical-lock control exited 1 for that GLib notice and Tokio 1.53.2 / RUSTSEC-2026-0386. Both controls also retained the unmaintained notice. This distinguishes the patched candidate source from the registry and historical controls; it does not establish that the optimized GLib behavior was reproduced or corrected.

The source-aware admission gate remains **blocked**. All five baseline, patched and application probe builds failed before execution because `pkg-config` could not find `glib-2.0`; the native application build also stopped at the missing GTK/GLib development closure. These are infrastructure failures, not reproduction or pass evidence. The input source and lock snapshots remained unchanged, and independent admission rejected the candidate because the optimized controls were incomplete. Do not close the GLib gate based on source hashes or the clean path-patched audit alone.

### 2026-11-04 local admission-harness follow-up

On the isolated D7B source-repair worktree (`423ccd3af308fe855b0da7f9ab9d0e1e78be8b2a` plus uncommitted security-harness changes), five Python guard suites passed: GLib source verifier 26/26, closure verifier 18/18, RustSec audit parser 8/8, admission validator 30/30, and optimized-controls validator 16/16 (98 total). These tests exercise source/evidence validation and fail-closed admission logic; they do not execute the GLib baseline, patched or application probes and do not establish remediation.

The current executor has no `cargo`, `rustc`, `rustup`, `ninja` or `meson`, and no GTK/WebKit development packages. An isolated GLib 2.84.4 pkg-config tree resolves the version but cannot resolve its `sysprof-capture-4` dependency. No system packages were installed. Native control builds and fresh RustSec capture were therefore not rerun; the candidate remains unadmitted, and the earlier evidence above retains its original source and environment limits.

### Runtime, license and installer evidence

The merged repository contains runtime staging, emitted-code attribution, source/license receipt validation and SPDX SBOM generation. Existing synthetic runtime tests use explicit test-only receipts; they validate the machinery, not a distributable runtime. The workflow `runtime:stage` needs separately reviewed runtime inputs, full license/source obligations and an independently pinned manifest digest.

As of 2026-11-04, the public `Native installer candidate` workflow still has **zero runs** on `main`. Its dispatch requires a reviewed target runtime artifact and manifest digest, but `apps/desktop/src-tauri/resources/runtime` is absent from this checkout. The Verify artifacts for this candidate contain synthetic render QA and Resolve reference evidence, not a reviewed native runtime, a production `sbom.spdx.json`, `candidate.json` or installer archive. No candidate-bound Windows/macOS/Linux package hash, native trust receipt, signing or notarization receipt was found. Thus runtime source/license/SBOM code exists, while final source closure and a reviewed per-platform package are still unproven.

### Workstation and release gates

GitHub's latest published release is still `v0.4.0`; the `1.0.0` package version in source is not a published release. [Issue #7](https://github.com/bynanci/open-film/issues/7) remains open for real Resolve interchange, representative source media, GPU/4K and related physical observations. The issue's older macOS dead-owner statement is stale: [PR #98](https://github.com/bynanci/open-film/pull/98) implements Darwin boot-session identity checks. That code change does not satisfy candidate-bound macOS workstation testing.

Still required for D7B/M7E are reviewed Windows/macOS runtime artifacts and candidate-bound packages, signing/notarization where applicable, clean supported install and first launch without developer tools, CJK/long-path rendering, update failure/recovery, rollback and project-preserving uninstall, repeated native first-open trials, and the planned one-hour memory/workflow observation. The current execution host is Linux x86_64 and has neither the required GTK/WebKit/AppIndicator/librsvg development packages nor a Windows/macOS workstation. No real installer or physical workstation acceptance was run. Issue #7's Resolve, external-drive, real-media, GPU/4K, display and listening gates also remain manual. Use the [M7E workstation checklist](workstation-qa.md#m7e-native-installer-candidate) on each target OS; hosted CI and generated media are not substitutes for those observations.
