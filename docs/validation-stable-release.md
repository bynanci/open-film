# 0.4.0 integrated release validation

Status: integration in progress; publication and merge require fresh combined
gates and hosted CI. No installer/workstation certification is implied.

## Reviewed inputs

Main baseline: `bb2c4521ad894478893485119442a00ffd9b34cc`.
Named Versions hardening: `41357e73fbb2b1686d96192664ed405b908aed5a`;
checkpoint race follow-up: `ede62fc0dcdcfda373b0b1a7757880e36f45532a`.
The release number follows the documented development 0.3.2 marker; old package
metadata remained 0.1.0. Workspace/Tauri/Cargo metadata now agree on 0.4.0 without
changing project schema 1.0.0.

| PR                           | Original head                              | Reviewed remediation head                  | Result                                                  |
| ---------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------- |
| #35 PhotoDepth               | `e78c4e06da2eb908dc0cb4548718c83b7798a8f1` | `a19f54bd771b0c93f17b50e07fc6f1e70a09eedd` | 2 original + 5 fresh fixed; 7 already addressed         |
| #36 Professional Export      | `66941903c27c41e49a938d257efd725e11286a3f` | `72cc85ae42a82106b9b80668b1ec2bdf58cdde2d` | 10 original + 4 fresh fixed; crop race fixed            |
| #37 Collect Media            | `cd537da784d73478a8d156fcc9677aafd8f79e26` | `282379b268a1f8c144e25aa354408c2831162284` | 9 original + 5 fresh fixed; safe required-stream decode |
| #38 Native Installer tooling | `6059a7dbd1d1d40a0a5c8f10c476808407328faa` | `b4093f392f6e58fa39f5d31d37be072dade02cbe` | 3 original + 3 fresh fixed; fenced draft recovery       |
| #39 NLE Fidelity             | `2dc059635b80a403aac215810fa0cda36cb329c5` | `077abf2e69e14dc02a882f9103e651ef450e2d1d` | 22 original already addressed; 8 fresh fixed            |
| #40 Motion Candidates        | `1ba6c57c58d0f08f3a09ce645eb6453e43550398` | `f5625e8c0380df4bc3fa20250fb3e0dcde77e204` | Orphan cache, idempotent adoption and prior Undo fixed  |

Each feature retains its own validation document and discussion dispositions.
The GitHub inventory covers 39 PRs/187 reviews/298 threads; this release remediates
the five confirmed Named Versions findings plus all current review findings on
PRs 35–40. Historical unresolved flags are not treated as confirmed defects.

## Evidence before integration

- Named Versions: new failures observed before correction, then 31 focused tests
  plus 1 browser scenario passed, including 50-version capacity recovery, receipt
  tombstones, active journals, source-change rejection and checkpoint deletion.
- Source validation: same 1,000-reference/7-call workload, 7,000 sorts → 0;
  median 10.31 ms → 2.07 ms, max 13.30 ms → 3.81 ms on local Node 24.19.
  Supported 50,000-reference correctness is tested; no cross-device latency claim.
- PhotoDepth: 213 files/2956 tests passed. Actual alpha MP4 levels
  `[0,255,0,129,65,128]` agree within 1/255 with expected alpha intersection;
  source hashes and 180-frame baseline output remain unchanged.
- Professional Export: 213 files/2951 tests and 145 focused tests passed. Actual
  mono/stereo sources produce stereo 48 kHz/24-bit stems with 576,000 samples each;
  three MP4 ratios contain 144 frames / 12 seconds; preview/still pixels and source hashes match.
- Collect Media: 100 targeted tests, including 21 baseline-failing regressions.
  Retained synthetic MP4/relocated ZIP/directory/recollection proof decodes 10/10
  identical frames after original media removal; source provenance is stable.
- Native tooling: 214 files/2928 Node tests; 7 targeted Node, 3 Python transport,
  3 isolated-port browser and 5 isolated Rust tests, formatter/Clippy passed.
  Full local Tauri build lacks GTK/WebKit; fresh hosted native CI remains required.
- NLE handoff: 213 files/2960 tests; 41 focused tests, format/i18n/lint/typecheck/
  build/interchange passed. Actual 32-frame reference, 16-frame precomp,
  endpoint error below 3/255 and 192000-sample mix; 12 inventory hashes/TAR entries
  verified. Audio owners exclude silent video, stills and titles.
- Motion: 4 files/23 tests plus typecheck/edited-file checks passed; reopen removes
  23 expired receiptless folders, retains recent work and generates 2 real previews.

## Independent integration review

Shared render/package review passed on `ec2d245db0040fda4e41f9c716cd8c24a8f58404`;
`8af3f5a4a95e478b6ab457f5c641d4fb56859d62` changes ancestry only and has the
same Git tree. A cross-feature fixture combines PhotoDepth source/mask/fill,
hidden media, accepted motion, narration, title/caption/scene text and package
fonts. All six source receipts survive collection/handoff; relocated portrait
output is byte-identical with an intentionally invalid host font override:
90×160, 24 fps, 96 frames, SHA-256
`317e9e2f2f896ab5114df7dd4d3ff3c8f8ea5ff5927b47e189a39a873e7b3a50`.
Offline hidden-picture originals do not block a 192,000-sample WAV.

### Fresh review follow-ups

The first remediation heads received 22 additional GitHub findings. Each was
checked against behavior and recorded in its feature validation document; all
22 were genuine or covered by the concurrent crop correction. New regressions
failed before their fixes. Important changes include:

- PhotoDepth: fallback recreation, reopened background selection, first-fallback
  reasons, pending mask selection and typed diagnostics for the mask pixel limit.
- Export: exact crop-plan/source binding through pair publication and rollback;
  PNG/frame-preview picture-only source selection; WAV/stems ignore irrelevant
  captions; request ownership and delivery mutation fences remain cancellable.
- Collection: reject known credential paths before reading them and inspect all
  actual media, including Story-only references; retain legitimate identifiers
  and fonts, redact embedded tag paths, reject aggregate oversize before payload
  reads, and account for every ZIP byte outside the central directory.
- Native recovery: retain authored text in bounded same-window memory, fence
  project/path/media/saved baselines, and export/discard unresolved drafts.
  Generated proposals, action receipts and provider consent do not transfer.
  Runtime manifest hashing/parsing uses the same bounded buffer; dead-service
  close uses local draft guards; the blocked workspace is inert.
- Handoff: reject missing sources, shared graphic limits and unsupported SRT text
  before approval. Authored amplified gain is retained in render/provenance and
  neutralized only after full-mix baking; real output RMS ratio was 1.999606×.
- Motion: recover a catalog-committed source after interruption using exact URI,
  hash and original revision; preserve prior Undo history on same-editor retry.
  Reopen, replacement Undo/Redo and a 48-frame/narration render pass.

Independent crop rereview passed: the original race refuses publication, and
PNG/MP4 match all 43,200 decoded RGB bytes of the reviewed preview. Additional
plan/source/late-staging races and rename rollback passed (27 targeted tests).

Independent review also found two defects in the first corrections. Collection
now decodes one frame of the required stream instead of assuming the first 32
interleaved packets contain video; a valid video starting at 5 seconds remains
supported. Native recovery rechecks retained membership after awaits, consumes
successfully restored entries synchronously, and installs local close guards
before asynchronous boot/recovery. Explicit Discard never reappears or autosaves.
Native independent final review passed 29 lifecycle cases, two separate original
race probes and nine Rust checks. Collection independent final review passed 33 safety/archive/decoder checks.
Complete combined and exact-head CI gates remain required.

### Latest review queue

A further GitHub review round is being remediated before release:

| PR  | Additional scope                                                                                                    | State                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| #35 | Mask orientation parity, recipe retiming, local dependency admission and imported full-Library dependency selection | Reproduction/fixes in progress                                           |
| #36 | Cross-process request-ID publication, retained recovery backups, reviewed font identities and empty-stem receipts   | Reproduction/fixes in progress                                           |
| #38 | Native media URL prefixes, streaming shutdown, spawn-error cleanup and background global shortcuts                  | Reproduction/fixes in progress                                           |
| #39 | Even dimensions, selected-caption budget, probed source handles and exact complete-frame bounds                     | Fixed; 95 focused tests and independent 29-case review passed            |
| #40 | Accurate injected-provider provenance, terminal preview-byte cleanup and external-video pagination                  | Reproduction/fixes in progress; PhotoDepth picker duplicate owned by #35 |

NLE reference rendering has a measured admission budget of 64 selected caption
cues; 65 selected cues reject before approval. All 5,000 native/unselected cues
remain in SRT/VTT sidecars. The boundary fixture renders 32 actual frames with a
14,118-byte filter argument on Linux. This is not an arbitrary-project or
Windows/macOS command-line capacity guarantee. Larger caption reference batching
is a separate follow-up.

## Combined gates

Initial combined tree passed 231 files / 3,107 tests, format/i18n/lint/typecheck,
production build, built CLI smoke and 18 official interchange tests. Two targeted
browser scenarios (Traditional Chinese reviewed crop and named-version recovery)
also passed. This run predates the independent-review follow-ups above;
it is a baseline, not final release approval.

A later combined source `c22be50ccc8b0fe04cdea65b5048441d0938ad06` passed
234 files / 3,210 tests and all eight basic gates in 173.43 seconds for the test
command. Eight real Chromium feature scenarios passed in 23.1 seconds; the shared
96-frame package/render scenario retained the identical MP4 hash above. These
results precede the latest review queue and are retained as baseline evidence.

The final candidate must rerun:
`pnpm format:check`, `pnpm test:i18n`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm test:e2e`, `pnpm test:interchange`, built CLI smoke and
`pnpm test:native` in a prerequisite-equipped hosted runner. Exact source/tree
identity, exit codes, counts and CI URLs will be read back before publication.

## Manual and distribution gates

Windows/macOS clean-machine installation, signing/notarization, update/rollback
operation, real NLE import/playback/relinking, protected real subjects, typography/
license suitability, physical color/HDR, sustained 4K/GPU and hardware listening
remain not-run/manual. Native tooling may merge as a disabled/manual candidate
slice; these gaps block installer distribution and related certification claims.
Remote motion remains disabled; no paid provider or private media is used.

Next milestone: workstation evidence and measured downstream NLE/installer
compatibility, with separate provider review before enabling remote generation.
