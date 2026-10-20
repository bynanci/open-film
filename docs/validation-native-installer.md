# M7E native runtime / installer validation

Status: implementation candidate. Runtime/process behavior is tested with generated
media. A distributable target runtime, actual installer artifacts and clean
Windows/macOS observations remain separate, unfinished acceptance gates.
No release, signing identity or automatic-update feed has been configured.

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
