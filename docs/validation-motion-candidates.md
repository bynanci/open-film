# M8B motion candidate validation

Validation date: 2026-10-20, Linux cloud, Node 24.19.0, pinned pnpm 11.11.0,
FFmpeg/ffprobe 7.1.5-0+deb13u1 available locally. No paid or real remote generation was called.
Recorded hashes identify this run, not a cross-platform codec golden.

## Source and dependency

- Main inspected: `bb2c4521ad894478893485119442a00ffd9b34cc`.
- Exact stacked base: M8A PR #35,
  `e78c4e06da2eb908dc0cb4548718c83b7798a8f1`.
- M8B branch: `codex/m8b-ai-motion`; PR targets `codex/m8a-photo-depth`.
  This is **not independently mergeable into main** until dependency integration
  and exact-base CI/review. No merge or release is performed.
- Final head is the commit carrying this validation record; exact SHA is recorded
  in the PR and delivery report (avoids a self-referencing commit hash).

## Actual synthetic media evidence

Reproduce with `pnpm exec tsx scripts/verify-motion-candidates.ts`.
Artifacts are outside the checkout at `/tmp/openfilm-m8b-evidence`: two actual
MP4 candidates, first/every-second/final PNG samples, adopted-film MP4, and JSON
measurements. All inputs are generated test patterns and synthetic tone. No media
binary, personal photo, chat or key is committed.

| Measurement                | Observed                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Original PNG SHA-256       | `d747014a23a4aa3162a1a7ffa15e46f7454de0a37a9a5820ab13f5a18208e321`                                    |
| Candidate 1 MP4 SHA-256    | `26ab3dcc1ff7e28ace3ea8c41bbaded0b7a78ece8704c002fcf38fde04cd7eef`                                    |
| Candidate 2 MP4 SHA-256    | `6a265df599f5bf3c4271bced27b0cf1f7d32bcd538e5b69e4e8913b9486af991`                                    |
| Adopted actual MP4 SHA-256 | `2d6f2c8570b7d94f3522b1ed2d43cb4eaf16aec24779b43131f2ddd9222e0261`                                    |
| Candidate decoding         | Each 4.000 s, 160×90, 12 fps, 48 decoded H264/yuv420p frames, no audio                                |
| Actual Composition output  | 4.000 s, 48 decoded video frames, original synthetic narration audio present                          |
| Samples                    | Frames 0, 12, 24, 36, 47 (0, 1, 2, 3, 3.9167 s)                                                       |
| Arbitrary seek             | Order 36 → 0 → 47 → 12 → 24; decoded MD5 equals sequential frame for every sample in both candidates  |
| Original immutability      | SHA-256 unchanged after adoption/render; external-import test also checks external MP4 hash unchanged |
| Source/receipt identity    | Receipt source/output hashes match actual admitted/decoded files; private raw intent is absent        |

Candidate 1 first/middle/final decoded MD5:
`87052cb79209d4745c6f7d4b027eddb8` /
`35465ae73aee7dd8eddcb1dfe68c6e14` /
`71c166f87eaf00eed36fc4fe9b2832fe`.
The fixture repeats deterministically across fresh request IDs; variants have
distinct output hashes. Unknown SDR color metadata remains explicit manual review.
This is evidence of camera fixtures and local candidate adoption, **not AI quality**.

## Regression matrix

| Boundary                 | Evidence                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider consent         | `tests/unit/motion-provider.test.ts`: image/text consent required on each registry call and revoked consent rejected                                                                                                                                                                                                   |
| Actual lifecycle/history | `packages/application/tests/motion-generation.test.ts`: preview leaves Composition unchanged; manual review gate; fixed-duration replacement; unchanged narration; duplicate/lost ack; Undo/Redo/reopen/Restore; real render; external MP4 audio removal/hashes; M8A scene replacement/restore; Named Version creation |
| Failure ownership        | `motion-faults.test.ts`: 429/500 sanitization + explicit retry; URL/invalid/oversized result; ignored abort/timeout; request ID dedupe/conflict; revoked receipts; foreign project; changed original/revision; locked source/clip; required constraints; project generation fence                                      |
| Crash and retention      | Inject failure after prepared journal before typed edit; reopen and resume once; physically remove aged unadopted media at open; retain recovery/adopted data; explicit discard checks                                                                                                                                 |
| HTTP                     | `tests/integration/motion-generation.test.ts`: strict subject declaration, project-scoped range media, accept/import/restore gating and idempotence                                                                                                                                                                    |
| CLI                      | Same file: preview, Accept, Import, Restore and clear in separate actual CLI processes                                                                                                                                                                                                                                 |
| Browser                  | `tests/e2e/motion-generation.spec.ts`: real preview MP4s, consent revoke invalidates candidates, manual review/accept/replace, reload and Restore, history availability                                                                                                                                                |

## Gates

Runtime source tested: `de52cf168fe36ba15a65a74240e1269d85638e50`.
The final follow-up commit updates documentation only. Command results and durations
are recorded below; exact current head/check status is reported in PR #40. Earlier
red tests caught unsupported request envelope fields, metadata lookup, precommit
recovery and an expiry-root helper creating an empty folder; these were corrected
without skipping or weakening assertions. An initial overlapping browser startup
hit occupied port 4310; a later concurrent unit/browser run failed 27 tests
(26 native benchmark port collisions plus a new CLI regression exposing missing
`--clip` option admission). The CLI was corrected and its actual processes passed;
full suites are rerun sequentially, without skips or changed assertions. A following run began before all old browser
server children had exited and failed seven native benchmark cases. After
shutting down only those owned test services, the frozen browser rerun passed all
170 tests, then the fully isolated unit/integration rerun passed all 2976 tests.
The earlier browser run was stopped after its Precision failure was traced to
Vite hot updates during an i18n edit (the service correctly returned source.changed
but the view was reset). The unchanged Precision assertions passed in the final
complete run. No final check was skipped or weakened.

| Command                          | Final status                                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`              | Passed on final source and documentation                                                                                                                                                                  |
| `pnpm test:i18n`                 | Passed: 1779 matching semantic keys, all three locales                                                                                                                                                    |
| `pnpm lint`                      | Passed after removing unused import                                                                                                                                                                       |
| `pnpm typecheck`                 | Passed                                                                                                                                                                                                    |
| `pnpm test`                      | Passed: 217 files / 2976 tests, 119.75 s; final isolated complete run                                                                                                                                     |
| `pnpm build`                     | Passed; existing large-chunk advisory remains                                                                                                                                                             |
| `pnpm test:e2e`                  | Passed: 170/170 tests, 16.6 minutes, frozen-source complete rerun                                                                                                                                         |
| `pnpm test:interchange`          | Passed: 18 official OTIO parser tests, source/bounds/relocation checks; real Resolve not verified                                                                                                         |
| `pnpm test:native`               | Passed in Linux CI native-shell (plus locked cargo build); local not run because cargo/Rust unavailable; no Windows/macOS workstation claim                                                               |
| Synthetic FFmpeg evidence script | Passed: real MP4 decode, sample/seek/hash/output checks                                                                                                                                                   |
| Independent correctness review   | Three findings fixed; focused application suites independently passed (18 tests); actual MP4/hash/seek evidence independently reverified                                                                  |
| GitHub CI                        | Source head de52cf1: native-shell passed; typescript-and-media browser stage pending at documentation update. Final documentation-only head automatically reruns CI; see PR #40 checks for current status |

## Remaining gates / limitations

No verified remote image-to-video provider, BYOK remote motion UI, paid API call,
license/retention/cost QA, face/pose/contact preservation guarantee, physical
Windows/macOS display or installer, hardware/GPU, sustained 4K or real Resolve QA
is claimed. Human/detail deformation, edges and color require workstation review.
Only bounded 2–6 s photo clips at 1x are supported; overlapping non-matching scenes,
diptych and protected/required edits are deliberately refused. Closed projects
have no background cache deletion daemon. Adopted sources remain for history;
private journal storage is not an authenticity boundary against the same OS user.
M8A PR #35 remains an integration dependency; do not merge M8B independently.

## Changed paths

```text
ROADMAP.md
TASKS.md
apps/cli/src/index.ts
apps/desktop/src/api.ts
apps/desktop/src/components/MotionGenerationPanel.vue
apps/desktop/src/components/TimelineEditor.vue
apps/desktop/src/i18n/locales/en-US.ts
apps/desktop/src/i18n/locales/ja-JP.ts
apps/desktop/src/i18n/locales/zh-TW.ts
apps/desktop/src/i18n/modules/motion/en-US.ts
apps/desktop/src/i18n/modules/motion/ja-JP.ts
apps/desktop/src/i18n/modules/motion/zh-TW.ts
apps/server/src/server.ts
docs/CONTRACTS.md
docs/architecture.md
docs/motion-candidates.md
docs/roadmap/creative-scene-platform.md
docs/security/motion-candidates-threat-model.md
docs/superpowers/plans/2026-10-20-ai-motion.md
docs/validation-motion-candidates.md
packages/analysis/src/index.ts
packages/application/src/editor.ts
packages/application/src/index.ts
packages/application/src/motion-generation.ts
packages/application/src/motion-media.ts
packages/application/src/motion-provider.ts
packages/application/tests/motion-faults.test.ts
packages/application/tests/motion-generation.test.ts
packages/plugin-sdk/src/ports.ts
scripts/verify-motion-candidates.ts
tests/e2e/motion-generation.spec.ts
tests/fixtures/motion-generation.ts
tests/integration/motion-generation.test.ts
tests/unit/motion-provider.test.ts
```
