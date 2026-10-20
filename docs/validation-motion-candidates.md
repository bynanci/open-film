# M8B motion candidate validation

Validation date: 2026-10-20, Linux cloud, Node 24.19.0, pinned pnpm 11.11.0,
FFmpeg/ffprobe 7.1.5-0+deb13u1 available locally. No paid or real remote generation was called.
Recorded hashes identify this run, not a cross-platform codec golden.

## Independent recovery follow-up (2026-10-20)

The focused follow-up preserves reviewed PhotoDepth dependency history. Its exact
base is `86ca011504777b6747b3765f5e597ec4042247b0`; the managed-import correction is
`737170a7a8c9cd189d855b6ca0bddf059a4746dd`, followed by the same-editor history
correction `0ffb6b32cbf01ac3d3a0586dfe9d3a893fce4783`. This validation update changes
documentation only after that tested source. No browser, full suite, external
provider or physical workstation test was run for this follow-up; combined
integration gates belong to the release coordinator.

Review comment `4326629423` is resolved. A fault injected after the real
`importManagedSources` catalog commit and before the prepared receipt reproduced
an accepted candidate that could not recover after reopening an implicit-pool
project. Recovery now finds only the expected managed URI, verifies its safe
location, content hash and actual bytes, and proves the original reviewed
document and all other sources remain unchanged before adopting that one asset.
Explicit Accept, source/target locks, original-source hash and stale revision
checks still apply. Recovery reuses the committed asset and finishes once.

A second regression reproduced losing an earlier authored Undo entry when that
same crash was retried without reopening the editor. History now rebases only
from the verified original preview revision or its current revision. The test
performs an authored beat edit, real preview, explicit Accept, injected commit
failure, same-editor retry, two Undo operations and two Redo operations. A paired
case changes another source before preview and proves unrelated history stays
invalidated.

| Follow-up evidence                                                        | Result                                                                                                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `737170a` focused motion application, fault, provider and HTTP/CLI suites | 4 files / 30 tests passed, 41.04 s; result recorded in the PR delivery                                                                                                           |
| Same-editor history regression before correction                          | Failed with `Nothing to undo`; `/tmp/openfilm-v1-validation/pr40-same-editor-history-red.log`                                                                                    |
| `0ffb6b3` same four focused suites                                        | 4 files / 32 tests passed, 40.05 s; `/tmp/openfilm-v1-validation/pr40-history-focused-green.log`                                                                                 |
| Source/output proof in the recovery tests                                 | Original PNG SHA-256 unchanged; actual adopted render has 48 decoded video frames, 4.000 s duration and original synthetic narration audio; no duplicate managed video           |
| Recovery counterexamples                                                  | Changed target, original/managed locks, altered original/managed bytes and unrelated pool-source changes rejected without changing the project or consuming the accepted receipt |
| Edited source formatting and ESLint                                       | Passed                                                                                                                                                                           |
| Complete TypeScript and Vue typecheck                                     | Passed; `/tmp/openfilm-v1-validation/pr40-history-typecheck.log`                                                                                                                 |

Reproduce the final focused source checks with:

```sh
pnpm exec vitest run --maxWorkers=1 packages/application/tests/motion-faults.test.ts packages/application/tests/motion-generation.test.ts tests/unit/motion-provider.test.ts tests/integration/motion-generation.test.ts
pnpm exec prettier --check packages/application/src/editor.ts packages/application/src/motion-generation.ts packages/application/tests/motion-faults.test.ts
pnpm exec eslint packages/application/src/editor.ts packages/application/src/motion-generation.ts packages/application/tests/motion-faults.test.ts
pnpm typecheck
```

Remaining manual gates are unchanged: human/detail deformation, edges and color;
physical Windows/macOS installation/display; hardware/GPU and sustained 4K; real
Resolve interchange; and any future remote provider's quality, license,
retention/cost and consent verification. The local fixture remains synthetic
camera motion with no remote upload or AI-quality claim.

## Fresh review remediation (2026-10-20)

Exact reviewed base: `f5625e8c0380df4bc3fa20250fb3e0dcde77e204`.
Tested source: `9e4a163ae0339240363270266e274968abd3cc4b`.
The commit adding this record changes documentation only. No full suite, default
browser ports, remote provider call, push, merge or release was performed for
this follow-up.

| Finding                                                              | Disposition and proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4326967703`: injected local providers mislabeled as camera fixtures | ACCEPT / resolved. Real local-provider invocation now records additive v1 `local-generation` / `provider-declared` / `provider-cost-unknown` provenance, preserved in adopted asset metadata. The regression first observed `fixture` / `camera-derived-original`, then passed after the fix. Explicit job consent and separate manual Accept remain required; existing registry consent tests pass and the application remote-availability gate is unchanged. Built-in provenance remains unchanged. |
| `4326967719`: imported receipt commits before candidate deletion     | ACCEPT / resolved. Injected failure after the real durable receipt write reproduces remaining bytes. Reopen and explicit cleanup now remove leftovers for imported/restored/revoked states without deleting receipt journals or managed sources. All six terminal-state/cleanup combinations pass. A prepared-state counterexample preserves byte-identical candidate and journal data, then resumes the exact replacement successfully.                                                              |
| `4326967736`: external picker stops at 100 videos                    | ACCEPT / resolved. Bounded 100-video pages and full-Library search expose later sources. Up to three named choices survive page/search changes and can be removed off-page. Actual Vue host regressions cover pagination, search, protected videos, project/revision/source changes, cancellation and late failures; the real browser reaches/adopts Video 205.                                                                                                                                       |
| `4326967726`: shared PhotoDepth full-Library dependencies            | Assigned to the PR #35 owner with duplicate `4326942597`. This follow-up changes no PhotoDepth source. Its independently validated dependency integration belongs to the coordinator.                                                                                                                                                                                                                                                                                                                 |

Fresh exact-source verification:

| Gate                                                      | Result                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused application/fault/provider/HTTP/CLI/picker suites | 5 files / 46 tests passed, 45.83 s; `/tmp/openfilm-v1-validation/pr40-fresh-final-focused.log`                                                                                                                                                                                                                                                               |
| Actual synthetic media                                    | Six new cleanup cases render 4.000 s / 48 decoded video frames with original synthetic narration present. Original and managed video SHA-256 values remain unchanged. Existing frame-decode, source/fence, Undo/Redo/reopen, HTTP and CLI regressions pass.                                                                                                  |
| Browser full-Library picker                               | 1 passed, 4.1 s total; `/tmp/openfilm-v1-validation/pr40-fresh-picker-browser-rerun.log`. 205 Library videos use regular byte-identical synthetic MP4 copies of one probed fixture. Page 3, cross-page choices/removal, search total=1, exact Video 205 receipt identity, manual Accept and Replace, Restore action availability and original hash verified. |
| Edited-source ESLint and Prettier                         | Passed                                                                                                                                                                                                                                                                                                                                                       |
| Complete TypeScript and Vue typecheck                     | Passed; `/tmp/openfilm-v1-validation/pr40-fresh-final-typecheck.log`                                                                                                                                                                                                                                                                                         |
| Locale contract                                           | 1787 semantic keys and placeholders match across en-US, zh-TW and ja-JP                                                                                                                                                                                                                                                                                      |
| Scope                                                     | Eight source/test/locale paths; no version, task, roadmap, project-schema, render-code or dependency changes                                                                                                                                                                                                                                                 |

The initial browser attempt timed out on the test's exact `getByLabel` select
locator; its trace showed the expected accessible combobox. The test now selects
by the combobox role/name, and the unchanged runtime source passed. No behavior
assertion was removed or weakened. The isolated harness used loopback ports
43869/45497 and was stopped after validation; ports 4310/1420 were not used.

Reproduce the application and UI host checks with the command below, followed by
the edited-file lint/format checks and `pnpm typecheck` / `pnpm test:i18n`:

```sh
pnpm exec vitest run --maxWorkers=1 packages/application/tests/motion-faults.test.ts packages/application/tests/motion-generation.test.ts tests/unit/motion-provider.test.ts tests/unit/motion-video-picker.test.ts tests/integration/motion-generation.test.ts
```

The browser regression is `tests/e2e/motion-video-picker.spec.ts`; it runs in the
normal browser suite or with an isolated local service/Vite harness. Final
combined CI/browser/release gates remain with the coordinator. Manual fidelity,
workstation/installer/display, hardware/GPU/4K, Resolve and any future remote
provider verification remain unclaimed. Reverting the source follow-up removes
the three corrections; existing receipts and project schema need no migration.

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
