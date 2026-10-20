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
| Chromium runtime keyboard and native audio playback                                                      | 3 passed without default ports; audio service uses an ephemeral port. Keyboard fixture mocks the App slot/IPC/action sinks while executing the real Gate and editor handlers; audio fixture runs real players, media generation and HTTP/session boundary.                      |
| Expected failures                                                                                        | Observed background shortcut actions, all three raw audio media URLs, missing close acknowledgement with a paused response, and unclosable real spawn error before their fixes. A native-origin media isolation probe also demonstrated the required cross-origin request mode. |
| Native module and workstation status                                                                     | Rust runtime source is unchanged from the nine-test reviewed head. Combined gates and fresh native-shell CI remain required. All native-installer workstation gates above remain not-run.                                                                                       |
