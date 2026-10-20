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

| PR                           | Original head                              | Reviewed remediation head                  | Result                                                 |
| ---------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| #35 PhotoDepth               | `e78c4e06da2eb908dc0cb4548718c83b7798a8f1` | `909c435c98bb49fc1242cf4f5a5ca52e983c824e` | 2 fixed; 7 already addressed                           |
| #36 Professional Export      | `66941903c27c41e49a938d257efd725e11286a3f` | `ac5c5bae0579c586703c33968acb5bc442634df5` | 10 fixed                                               |
| #37 Collect Media            | `cd537da784d73478a8d156fcc9677aafd8f79e26` | `0caff4d1444dec734eb3874970f1cb8a6fc043e5` | 9 fixed                                                |
| #38 Native Installer tooling | `6059a7dbd1d1d40a0a5c8f10c476808407328faa` | `282321a58b3c6a457ebdae59b50beb3ef63cc2f1` | 3 fixed; 7 already addressed                           |
| #39 NLE Fidelity             | `2dc059635b80a403aac215810fa0cda36cb329c5` | `d436b5acfd3d45c22df0e9939c51c8c7ccb832b6` | All 22 already addressed; no speculative runtime edits |
| #40 Motion Candidates        | `1ba6c57c58d0f08f3a09ce645eb6453e43550398` | `86ca011504777b6747b3765f5e597ec4042247b0` | New orphan-cache retention defect fixed                |

Each feature retains its own validation document and discussion dispositions.
The GitHub inventory covers 39 PRs/187 reviews/298 threads; this release remediates
the five confirmed Named Versions findings plus all current review findings on
PRs 35–40. Historical unresolved flags are not treated as confirmed defects.

## Evidence before integration

- Named Versions: new failures observed before correction, then 31 focused tests
  plus 1 browser scenario passed, including 50-version capacity recovery, receipt
  tombstones, active journals, source-change rejection and checkpoint deletion.
- Source validation: same 1,000-reference/7-call workload,7,000 sorts → 0;
  median 10.31 ms →2.07 ms, max 13.30 ms →3.81 ms on local Node 24.19.
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
- Native tooling: 214 files/2928 Node tests;7 targetedNode,3 Python transport,
  3 isolated-port browser and 5 isolatedRust tests, formatter/Clippy passed.
  Full local Tauri build lacks GTK/WebKit; fresh hosted native CI remains required.
- NLE handoff: 213 files/2960 tests;41 focused tests, format/i18n/lint/typecheck/
  build/interchange passed. Actual 32-frame reference,16-frame precomp,
  endpoint error below 3/255 and 192000-sample mix;12 inventory hashes/TAR entries
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

Fresh independent review reproduced three blockers beyond the original thread
fixes: crop approval spanning asynchronous validation/publication; native Retry
dropping unsaved local text when App remounts; and a synthetic credential file
disguised as Story-only image media being copied and verified as a package source.
All require additional regressions and independent rereview before merge. Fresh
GitHub reviews of the remediation heads are also being checked against code and
reproductions. None of these pending findings is waived by the initial green suite.

## Combined gates

Initial combined tree passed 231 files / 3,107 tests, format/i18n/lint/typecheck,
production build, built CLI smoke and 18 official interchange tests. Two targeted
browser scenarios (Traditional Chinese reviewed crop and named-version recovery)
also passed. This run predates the independent-review follow-ups above;
it is a baseline, not final release approval.

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
