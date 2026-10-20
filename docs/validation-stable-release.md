# 0.4.0 integrated release validation

This record covers the reviewed source implementation. Final candidate/head,
merge/tag identities, all changed paths, exact-head CI URLs, full browser results
and checksums accompany the [0.4.0 source release](https://github.com/bynanci/open-film/releases/tag/v0.4.0).
[Integration PR #41](https://github.com/bynanci/open-film/pull/41) must pass all
final checks before a merge commit and publication. No installer/workstation
certification is implied.

## Exact reviewed inputs

Main baseline: `bb2c4521ad894478893485119442a00ffd9b34cc`.
Combined implementation: `42ccae24b043020a14dec844448c6f9c8bcaa6a1`. Later documentation-only changes
retain the same implementation; the release evidence identifies the final head.
Named Versions hardening: `41357e73fbb2b1686d96192664ed405b908aed5a`;
checkpoint race: `ede62fc0dcdcfda373b0b1a7757880e36f45532a`.
Workspace/Tauri/Cargo metadata agree on 0.4.0. The project schema remains 1.0.0.
The release follows the documented development 0.3.2 marker; old package metadata
was still 0.1.0.

| PR                                   | Original head                              | Final reviewed branch head                 |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| #35 PhotoDepth                       | `e78c4e06da2eb908dc0cb4548718c83b7798a8f1` | `5336295eb5991470d543d1d71b37e526d891b63c` |
| #36 Professional Export              | `66941903c27c41e49a938d257efd725e11286a3f` | `3503ea571f910365591b59e3aa3b047066025706` |
| #37 Collect Media                    | `cd537da784d73478a8d156fcc9677aafd8f79e26` | `282379b268a1f8c144e25aa354408c2831162284` |
| #38 Native runtime/candidate tooling | `6059a7dbd1d1d40a0a5c8f10c476808407328faa` | `f25a2663fd736b8d1cd84c7bb77894c335bc4a92` |
| #39 NLE Fidelity                     | `2dc059635b80a403aac215810fa0cda36cb329c5` | `b1638752e5e436bbc53eaa0b8950585ef21c724b` |
| #40 Motion Candidates                | `1ba6c57c58d0f08f3a09ce645eb6453e43550398` | `ee0a62cfd5ae25a6b2d17033457b80259eb5a2cc` |

All six tips are ancestors of the integration candidate. A merge commit preserves
their history and lets GitHub mark the six original PRs merged. Do not squash or
rebase this integration. Each feature validation document retains its own review
thread dispositions, reproduction and acceptance limits.

The original GitHub inventory covered 39 PRs/187 reviews/298 threads. Historical
unresolved flags were checked against actual behavior rather than counted as
confirmed bugs. This pass fixes the five confirmed Named Versions findings,
current PRs 35–40 findings and further independently reproduced defects.

## Review and regression outcomes

- Named Versions: explicit confirmed capacity deletion across application/API/CLI/
  Desktop; preserve 50-version / 2 GiB limits, stale revisions and active recovery
  journals. Target sources are rechecked after checkpoint creation; checkpoint
  existence and applying journal share the catalog write lock. Independent
  deletion/restore race controls, 31 focused tests and a browser flow pass.
  Legal composite IDs and order differences are retained. The same 1,000-source/
  seven-call workload improves 7,000 sorts to zero and local median 10.31 ms to
  2.07 ms; 50,000-source correctness is covered, without a cross-device claim.
- PhotoDepth: alpha intersection, fallback controls/reasons, mask resource errors,
  local-only dependencies, 3–6 second recipe retiming and full-Library layer admission
  are fixed. Independent 58 tests and an actual folder-import/history/reopen
  browser pass without changing explicit Story pools or required selections.
  Recognized mask orientation matches Monitor/Output; the 48-frame oriented PNG
  test discloses a test-only display-rotation shim because FFmpeg 7.1 ignores PNG
  eXIf. It does not claim native EXIF support.
- Export: crop approval binds captured plan, sources, actual font files/faces and
  each typed title/caption/nested-scene use. Actual assignment swaps fail while
  unchanged relocated font bytes reproduce pixels. Legacy set-only approvals
  require a fresh preview. Exclusive request owners preserve completed winners,
  use verified dead-owner/PID/token/inode recovery, retain failed-rollback backups
  and fence late cancellation. Empty stems retain durable collision receipts.
  Owner 188 focused tests and independent 71 plus actual swap/relocation probes
  pass. Unknown/native owner liveness fails closed; Linux controls are measured.
- Collection: credential paths reject before reads; every packaged asset is
  inspected/decoded, including Story-only sources. Required-stream one-frame
  decoding supports valid delayed-video/audio files. Rights IDs, embedded-path
  redaction, valid font names, aggregate 4 GiB bounds and every ZIP byte are checked.
  Independent 33 safety/archive/decoder controls pass with unchanged delayed-source
  hash and actual relocation/reopen/render parity.
- Native: bounded authored-draft recovery protects project/path/media/revision
  identity and explicit Discard; proposals and provider consent do not transfer.
  Manifest verification uses the same bounded bytes. Runtime gates stop background
  shortcuts while preserving button/Tab behavior. Prefix-aware media URLs and
  anonymous CORS retain strict Origin/session/Host enforcement. Closing aborts
  owned read streams before/after filesystem awaits while acquired writes drain;
  real ENOENT child startup settles cleanup. Independent 99 tests, five Chromium
  cases and nine isolated Rust tests pass. Platform distribution stays partial.
- NLE: review rejects missing sources, actual renderer capabilities, Story maximum,
  odd dimensions, frame budgets, unsafe SRT and more than 64 selected burn-in cues.
  All 5,000 native/unselected cues remain in SRT/VTT. Probed media handles and exact
  complete-frame bounds drive OTIO. Title placeholders are metadata rather than
  native picture/audio; ignored title trims do not block publication, while used
  source bounds, hashes, inspection and provenance remain enforced. Amplified gain
  survives baking (measured RMS 1.999606×). Independent 126 cases and six package
  inventories/TARs pass; three actual references decode 32 expected frames.
- Motion: receipts distinguish fixture, declared external and local-provider
  provenance/cost. Terminal caches reclaim crash-left private bytes while prepared
  recovery journals stay resumable. Exact adoption retries preserve earlier Undo
  history. A bounded searchable 205-video Library picker retains at most three
  cross-page selections and fences stale reads. Fresh 46 owner/43 independent
  tests, 104 combined dependency tests and the actual 205-video browser flow pass.
- Integration: reproduce the held-Favorite-acknowledgement Inspect lost click from
  an earlier CI failure, then allow read-only inspection during selection/rating
  saves. Nine unit and the actual Proposal browser pass; category drafts, other
  project operations and mutation controls remain guarded. Shared renderer
  capability checks retain audio-only/picture-only/role scopes; independent 95
  checks include nonzero 19,200-frame WAV and 12-frame picture-only output.

## Combined automated gates

On implementation `42ccae24b043020a14dec844448c6f9c8bcaa6a1`:

- `pnpm format:check`, `pnpm test:i18n` (1,970 semantic keys), `pnpm lint` and
  `pnpm typecheck`: pass.
- `pnpm test`: **239 files / 3,306 tests passed**; no weakened or disabled
  assertions. Synthetic FFmpeg, HTTP/application, child-process, legacy-project
  and recovery regressions run as part of this command.
- `pnpm build`, built CLI smoke and `pnpm test:interchange`: pass; the official
  independent OTIO verifier passes 18 tests.

The run records source/head identity and checks that the worktree stays clean at
every gate. Earlier 3,107/3,210-test combined runs are baseline evidence only.
Final full `pnpm test:e2e` and exact candidate CI results are read back into the
checksummed release evidence before merge/publication. Hosted CI runs the complete
prerequisite-equipped `pnpm test:native`, Cargo build and dependency advisory
checks. Local full Tauri validation is not run because GTK/WebKit prerequisites
are absent; isolated Rust tests do not substitute for it.

## Actual shared FFmpeg evidence

The final implementation combines PhotoDepth source/mask/fill, hidden media,
accepted motion, narration, title/caption/nested-scene text and packaged fonts.
All six source hash receipts survive collection and handoff. A relocated portrait
MP4 with an intentionally invalid host font override is byte-identical:
90×160, 24 fps, 96 decoded frames, SHA-256
`317e9e2f2f896ab5114df7dd4d3ff3c8f8ea5ff5927b47e189a39a873e7b3a50`.
An offline hidden picture does not block the 192,000-sample WAV. Composition and
editor revision remain unchanged; originals retain their hashes.

The masked alpha fixture yields `[0,255,0,129,65,128]` within 1/255 of expected
intersection. Oriented-mask 48-frame output SHA-256 is
`bcb228765fc472a431b7a260315ccd945d6ec4571387710176e92b428dac15eb`.
The 64-cue reference boundary renders32 actual frames with a 14,118-byte filter
argument on Linux. That is not a Windows/macOS or arbitrary-project command-line
capacity guarantee; larger caption-reference batching remains a follow-up.

## Manual and distribution gates

Windows/macOS clean-machine installation, signing/notarization, update/rollback,
OS WebView behavior, actual NLE import/playback/relinking, protected real subjects,
typography/license suitability, physical HDR/color, sustained 4K/GPU and hardware
listening remain **not run/manual**. These gaps block installer distribution and
related certification claims. Native tooling stays a disabled/manual candidate
slice. The 0.4.0 release ships source, checksums and curated validation receipts;
no native installers, credentials, private media or automatic-update feed.
Remote motion remains disabled; no paid provider/private media is used.

Next milestone: workstation evidence and measured downstream NLE/installer
compatibility, plus larger caption-reference batching and separate provider
review before any remote generation is enabled.
