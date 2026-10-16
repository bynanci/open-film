# Scene-script planning validation

Evidence recorded 2026-10-16 UTC for [PR #15](https://github.com/bynanci/open-film/pull/15).
This record separates the initial candidate, corrected UI checks and the final
merge policy. Current published-head results are in the [PR checks](https://github.com/bynanci/open-film/pull/15/checks);
this dated evidence record does not substitute earlier results for a newer head.

## Source and dependency

The feature started from main `e2e926b23ac0fe3bb8aa1d474592a3aef80e6ae6`, after
PR #13 merged. PR #14 subsequently merged as
`61af41fbac17c32ffdc11679612636566bd73a1c`. Its exact head
`309812aef3539d6b22f45b4f24105985bffe9137` passed both
[PR Verify 38870793791](https://github.com/bynanci/open-film/actions/runs/38870793791)
and [push Verify 38870743711](https://github.com/bynanci/open-film/actions/runs/38870743711).
Independent review found no blocker in that isolated test repair: the Precision
fixture now awaits successful Story creation and a rendered beat before reading
project state, without hiding backend errors or adding sleeps.

The first feature candidate is `b3680f1192db9eb285f494a8816499fd5cd39700` on
`codex/story-script-planner`. Results for it are retained as history; later source
changes require their own checks.

## Initial candidate results

| Gate on `b3680f1192db9eb285f494a8816499fd5cd39700` | Observed result                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                | Passed                                                                                                                                                                 |
| `pnpm test:i18n`                                   | Passed: 1,152 semantic keys in en-US, zh-TW and ja-JP, placeholders/errors/literal references                                                                          |
| `pnpm lint` / `pnpm typecheck`                     | Passed                                                                                                                                                                 |
| `pnpm test`                                        | Passed: 1,829 tests, 124 files                                                                                                                                         |
| `pnpm build` / built CLI smoke                     | Passed                                                                                                                                                                 |
| `pnpm test:interchange`                            | Passed: 18 official OpenTimelineIO 0.18.1 tests, source bounds/hashes and relocation                                                                                   |
| `pnpm test:native` / locked Cargo build            | Passed: Linux formatting/clippy, 7 Rust tests and native compile                                                                                                       |
| Full `pnpm test:e2e`                               | **Failed: 99 passed, 2 failed**, 14.8 minutes                                                                                                                          |
| PR/push CI                                         | **Failed**: [38871025308](https://github.com/bynanci/open-film/actions/runs/38871025308), [38870940710](https://github.com/bynanci/open-film/actions/runs/38870940710) |

The two full-browser failures were long pseudo-localized Categories text
overflowing the small Inspector, and an overbroad busy guard disabling normal
concurrent typing while a Story beat save awaited acknowledgement. The failing
run is not replaced by the earlier five passing feature-browser scenarios.

## Corrected UI verification and final gate

The Inspector wrapping fix and narrowed scene-acceptance guard passed the affected
`global-visual`, `global-workflow` and `scene-planning` browser files:
**13 passed in 1.9 minutes**. Source hashes before/after that run were identical.
Corrected UI formatting, lint, typecheck and build also passed. The run verifies
that ordinary beat-save typing works while delayed scene acceptance still blocks
conflicting old-beat edits.

Visual regression exercises en-US, zh-TW, ja-JP and en-XA across the existing
1280×720, 1440×900 and 1920×1080 desktop workflows. Dedicated scene-plan screenshots
include en-US/1280×720, zh-TW/1440×900, ja-JP/1920×1080 and en-XA/1280×720, plus
stale-draft recovery. This is layout/interaction evidence, not a native latency
or source-decoding benchmark.

The final candidate also corrects soundtrack wording: this planner creates a
visual composition and does not add a soundtrack. Desktop can edit/replace
existing audio clips, but cannot add a new soundtrack track to this new cut.
That later copy/diagnostic clarification and this record are not retroactively
included in the 13-test source snapshot.

The corrected runtime candidate `19eb52e27e3e3feb16390a3fff18a5f732238c4d`
subsequently passed format, i18n (1,152 keys), lint, typecheck, all 1,829 tests
across 124 files, build, built CLI smoke, 18 official OTIO checks, native checks
(7 Rust tests) and locked Cargo build. Interchange used a fresh candidate-specific
output after its first invocation correctly refused to overwrite the earlier
reference bundle. The successful retry and initial refusal are both retained.
Its complete local browser run then passed **101 tests in 14.3 minutes**. This is
historical evidence for that runtime, not proof that later review findings are
resolved. Current published-candidate results remain in the
[live PR checks](https://github.com/bynanci/open-film/pull/15/checks).

**Merge gate:** publish the corrected candidate, require its complete CI to pass,
refresh review threads/head/base and address any correctness findings before
merging PR #15. The [live PR checks](https://github.com/bynanci/open-film/pull/15/checks)
provide that result; this dated evidence point does not pre-approve it.

## Feature and review regressions

The targeted domain group passed 36 new scene-planning tests (105 related tests
in the exercised group), with 21 application/HTTP/CLI cases and five feature
browser scenarios. They cover classifications/chronology, source bounds and
locks, scene minima, actual solved duration, review/edit/accept, stale input,
atomic publication, exact retry, real rendering and reopening authored scripts.

Four independent review findings were addressed before the initial candidate:

- **P1: delayed acceptance lost old-beat edits.** Conflicting controls and media
  selection wait for acceptance; a real delayed-response browser regression
  preserves the new Story and script. The subsequent guard correction above
  retains ordinary beat-save typing.
- **P2: a supported 2,000-clip preview exceeded its own CLI acceptance cap.**
  Compact acceptance sends authored Story/scope/signature/transition; full preview
  JSON remains supported within 16 MiB. A real crossfade preview above 1 MiB
  successfully round-trips through CLI.
- **P2: exact fractional minima were rejected by floating-point accumulation.**
  A 30 × 0.1-second source scenario at a three-second limit remains valid;
  genuinely infeasible targets still fail visibly.
- **P2: accepted maximum CJK scripts could not be saved from Story.**
  Scene acceptance and `PATCH /api/stories/:id` use bounded 16 MiB input. A real
  30-scene long-CJK acceptance/edit/close/reopen regression passes. Story creation
  and ordinary APIs retain their existing 1 MiB limit.

The source signature covers relevant catalog fields, project ID and film locale.
It does not rehash media bytes during planning. Rendering retains its own source
inspection. Same-plan retries return the saved/current composition, preserving
subsequent manual edits rather than replaying an old preview.

## Follow-up correctness review

The later review identified additional P2 issues even after the earlier local
full-browser success. CI alone does not resolve them; fixes require regression
evidence and a new published-candidate review.

- **Rendering metadata was missing from the source signature.** Version 2 binds
  the fixed-size audio-presence/invalid-stream state and HDR transfer, primaries
  and matrix evidence actually consumed by rendering. It does not hash complete
  probe documents or unrelated analysis payloads.
- **A moved managed project falsely invalidated its own CLI preview.** Read-only
  preview and writable acceptance now use the same effective source URI and
  validated owned relative identity. Normal root/library reference repairs no
  longer masquerade as source changes, while actual URI/hash/path changes still
  invalidate the plan. The two application fixes were demonstrated by six
  failing regressions before the fix (and one passing control), then **32 passing
  integration cases**: 30 scene-planning cases and two caption-portability cases
  in 12.79 seconds. ESLint and TypeScript checks also passed.
- **Literal category values were corrupted by delimiter parsing.** A real browser
  reproduction changed four existing categories into six while editing only
  another value: ASCII/full-width commas were split, outer spaces stripped and
  newlines flattened. The replacement editor keeps one category per text field
  with explicit add/remove actions and saves the array literally. The regression
  covers commas, LF/CRLF, outer spaces, duplicates, editing another row and
  save/reopen, plus explicitly editing a literal value and removing one duplicate.
  The corrected working source passed six scene-browser cases in 23.5 seconds
  and 107 related actual-function harness tests. These are source-bound working
  results, not CI for the subsequently published combined fix.

The revised category UI passes i18n coverage with 1,156 semantic keys. Application
evidence is retained in `scene-plan-pr15-application-review-{red,green,final}.log`;
category evidence is in `category-roundtrip-proof.json` with its red/green logs.
These follow-up results must not be attributed to the earlier 19eb52e/ac4024f
commits. The combined candidate requires fresh CI and review under the merge
policy above.

## Second follow-up: per-scene output and SDR metadata

Candidate `f7d936b15af4b20e985545ea1aef6ed1ce79a228` passed its local core gates
(1,838 tests), native checks and 18 OTIO checks. Its full browser run was
deliberately interrupted with **exit 130** when two further P2 findings were
confirmed. That interrupted run is not a success, and its CI cannot certify the
subsequent corrections.

- **Edited acceptance could save an empty scene.** Checking only the total cut
  missed a beat whose candidates were emptied, excluded or given too little time.
  Preview/acceptance now verify at least one positive-duration visual clip for
  every beat after solving. The empty-candidate, fully filtered-pool and
  0.1-second-budget regressions all reject without saving, even when the submitted
  scene minimum is zero.
- **SDR color-only changes falsely invalidated a draft.** Signature version 3
  matches the renderer's `asset.hdr` predicate for color evidence. Audio evidence
  and the HDR flag remain bound. SDR color changes with `hdr` absent or false
  are accepted; switching SDR to HDR still invalidates a plan even when the saved
  color fields are unchanged.

The new regression selection first produced **5 failures and 1 passing control**
(30 other scene cases skipped), then the corrected integration run passed
**38 tests in 13.01 seconds**: 36 scene-planning and two caption-portability
cases. Evidence is retained in `scene-plan-pr15-second-review-red.log` and
`scene-plan-pr15-second-review-tests.log`; the interrupted candidate receipts
remain under `f7d936b-gates-before-two-p2/`. These targeted results belong to the
correction source; the combined published head still follows the complete CI
and review policy above.

## Evidence and manual limits

Session artifacts retain per-gate logs and source hashes, the 99/2 failing full
browser run, the corrected 13-test run, review reproductions and screenshots.
Initial full-suite receipts are archived under `b368-full-gates/`. Corrected
runtime receipts are `corrected-core-gates.json` and `final-native-gates.json`;
additional records include `local-gate-source-hashes.json`, `browser-accept-race-proof.json`,
`corrected-ui-source-hashes.json` and `corrected-ui-browser-proof.json` in the
`openfilm-story-planning-20261016` artifact collection. PR CI is the published
reproduction path; cloud-local files alone are not a workstation attestation.

[Issue #7](https://github.com/bynanci/open-film/issues/7) remains open for actual
workstation evidence. No Windows/macOS first-open repetitions, one-hour memory
series, real Resolve import, camera/4K quality or installer QA is established by
these automated checks. OTIO parsing and Linux native compilation do not close
those gates. Script starters do not claim image understanding, narration synthesis,
subjective screenplay quality or verified timing for unrecorded speech.
