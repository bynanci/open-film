# Incremental release train

Plan baseline reviewed on 2026-11-11 against main
[`08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224`](https://github.com/bynanci/open-film/commit/08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224).
Current status reconciled on 2026-11-14 against main
[`9b8df866134e12e864d642005c46231b41d9da53`](https://github.com/bynanci/open-film/commit/9b8df866134e12e864d642005c46231b41d9da53).
This schedules source releases as separate cumulative milestones, not a record
of already published versions.

## Current release state

- Latest public source release remains `v0.4.0`, published 2026-10-20.
- Main includes merged GLib source repair PR #128 and browser balancing PR #131.
  The security head `e11051f` passed all 19 hosted checks and independent technical
  review; this does not select main's 1.0.0 metadata as a release version.
- Main already contains work through the proposed v0.8.0 scope. Repeated tags
  from the same main would ship that whole feature set rather than staged cuts.
- The source-only v0.5.0 candidate was merged by PR
  [#129](https://github.com/bynanci/open-film/pull/129) to dedicated
  `release/v0.5.0`, based on PR #75's historical scope at
  `d5a286ed9250872e8eb9b1c3e40adb926f913d34`. New candidate head
  `54534d8cf985203e8b5abbd09a771436f8fe09e5` retains all 22 version surfaces at
  0.5.0 and adds the independently reviewed GLib source-security backport. The
  release branch merge is `1b8d386e2a68b2448d20742138b4b100c799289b`.
- The candidate's [Verify 42493427242](https://github.com/bynanci/open-film/actions/runs/42493427242),
  [native source admission 42493427131](https://github.com/bynanci/open-film/actions/runs/42493427131),
  Windows Recovery, DCO and Linux/Windows/macOS Render QA passed on that SHA.
  Downloaded reports validate 313 browser cases and 57 render tests per target.
  Its own independent technical source-security review returned PASS; no older
  main execution receipt substitutes for this candidate.
- The owner accepted the scope as a source-only branch update and accepted the
  disclosed `proc-macro-error` maintenance warning only for that merge. The
  archive digest discrepancy and Git-tree content verification are documented
  in the [owner review record](../release-owner-review-v050.md). No tag or
  release was created; native acceptance stays open.

## Proposed staged sequence

Each milestone below is cumulative. The feature list names its main user-facing
addition; exact change lists and compatibility notes belong in that release's
candidate record. The commit is a historical **scope anchor**, not a release
candidate or approved tag target.

### v0.5.0 — Story workflow and cinematic finishing

- Add the Story Graph, guided Pipeline, Creative Variants, Quiet Studio, and the
  first Professional Cut Desk workflow, followed by focal-point photo controls,
  easing/ambient presentation and bilingual title finishing.
- Historical scope anchor: after PR #75, commit
  [`d5a286ed9250872e8eb9b1c3e40adb926f913d34`](https://github.com/bynanci/open-film/commit/d5a286ed9250872e8eb9b1c3e40adb926f913d34).
- Distribution target: source archive only; no installer claim.
- Candidate work: PR #129 was technically validated at
  `54534d8cf985203e8b5abbd09a771436f8fe09e5`, including its own reviewed GLib
  backport and fresh controls/audits. The branch update is complete. No tag or
  public asset is approved; future publication needs a refreshed archive,
  current advisory check and explicit release decision.

### v0.6.0 — Rhythm, continuity and precision editing

- Add saved sequence waveforms, source-bound rhythm proposals, continuity and
  transition review, transcript ripple, User Pins, and the next Cut Desk editing
  phases. Preserve review-before-accept and source/history contracts.
- Historical scope anchor: PR #99 readiness merge,
  [`1e8b6d4777f5b0807e4e83ac4b511b4b6c8fbe0a`](https://github.com/bynanci/open-film/commit/1e8b6d4777f5b0807e4e83ac4b511b4b6c8fbe0a).
- Distribution target: source archive only; no installer claim.
- Candidate work: correct the historical `1.0.0` metadata for this candidate,
  backport required security fixes and verify project/catalog compatibility.

### v0.7.0 — Durable media intelligence and audio workflow

- Add durable Silence Jobs, desktop Review/Accept, rendered audition, and safe
  audio-automation ripple integration over the existing editor and mix plan.
- Historical scope anchor: PR #114 merge,
  [`d332fb3265077ca08f218f6ba9b6c65d2519eaa2`](https://github.com/bynanci/open-film/commit/d332fb3265077ca08f218f6ba9b6c65d2519eaa2).
- Distribution target: source archive only; dialogue/music listening acceptance
  remains a disclosed manual gate.
- Candidate work: backport the Tokio security patch, disposition the remaining
  GLib advisory, and repeat all exact-candidate checks.

### v0.8.0 — Performance and deterministic Cut Desk animation

- Add later Catalog/media performance work, story-coverage constraints, and
  deterministic frame-time/visual-keyframe editing with Monitor/FFmpeg parity.
  PR #119's Tobi-ishi workflow also passes exact-head hosted CI; workstation and
  NLE acceptance remain separate. PR #121 adds event/person coverage constraints.
- Historical scope anchor: main snapshot
  [`5f737a6c8f35dce48e213370ff27900962c9304c`](https://github.com/bynanci/open-film/commit/5f737a6c8f35dce48e213370ff27900962c9304c), including merged PR #126.
- Distribution target: source archive only. This scope does not close native
  installer or physical workstation gates.
- Candidate work: freeze one release SHA and rerun all release checks. The main
  CI snapshot is supporting evidence, not candidate CI.

### v1.0.0 — Native distribution and ecosystem readiness

- Release only after the runtime and installer are actually distributable and
  every advertised platform passes signing/notarization, clean-machine first
  launch, update failure recovery, rollback and project-preserving uninstall.
- No source SHA is nominated yet. M7E, candidate-specific security admission and physical
  Windows/macOS workstation observations remain open.
- The intended scope is a verified distribution step after earlier source
  milestones, not a container for all unfinished features.

## Independent Storytelling release track

OpenFilm desktop and Storytelling SDK have separate repositories, release tags,
compatibility promises and release checks. Do not bundle a Storytelling SDK
release into an OpenFilm desktop release or assign Storytelling milestones an
OpenFilm version number.

As checked on 2026-11-11, the inspected Storytelling snapshot is
[`b7fcf869d01727dcf408c457fdd42929dca80c7a`](https://github.com/bynanci/storytelling/commit/b7fcf869d01727dcf408c457fdd42929dca80c7a).
Its [accepted delivery ledger](https://github.com/bynanci/storytelling/blob/b7fcf869d01727dcf408c457fdd42929dca80c7a/docs/delivery/VIDEO_TASK_HISTORY.md#L101)
and [tasks](https://github.com/bynanci/storytelling/blob/b7fcf869d01727dcf408c457fdd42929dca80c7a/TASKS.md#L77)
supersede the earlier M1-next description:

- M1-01 read-only importer and M1-02 finite picture OTIO/loss handling are accepted
  in their declared subsets, including the official parser oracle.
- M1-03 accepts a synthetic FilmCraft v0.18.0 Linux/25fps CPU proof: a 45-frame
  192×108 H.264 preview, source ranges/PTS and save/reopen/reimport. It does not
  certify general audiovisual, Resolve, hardware or editorial fidelity.
- M2 bounded planning/shadow proofs, M3-01 exact-input review binding/selected
  proposal bridge, and M3-02 durable owner-fenced journal are accepted in scope.
- M3-03 has merged test-only lost-reply/readback proof. Production trusted
  approval, executor, in-flight timeout/quiescence and safe NotApplied retry
  remain open. The test loses acknowledgement after successful host exit; it
  does not prove recovery while a request is still executing.

The next OpenFilm work is a pinned read-only compatibility capsule over the
existing JSON exporter and SDK import/review contracts. The finite profile
rejects unsupported audio, transforms, effects, pins and animation; do not strip
these fields to manufacture compatibility. A review probe additionally consumes
the complete successful SDK proposal, snapshot and strict context, not merely
the mapped importer output. Original project/Catalog/media hashes must remain
unchanged. See the [issue plan](next-issues-2026-11-11.md).

A production M4 TypeScript client/one feature flag stays dependent on accepted
M3-03 production authority, execution and reconciliation. Do not duplicate the
existing SDK 48-item migration map and 16 gaps, or switch planner/write authority
based only on bounded test proofs. Earlier accepted M1 work must not be reopened
as missing implementation.

Keep StoryPlan/solver ownership explicit while the transfer is in progress.
Before code is copied or rewritten, review Apache-2.0/MIT source provenance and
notices. The compatibility matrix must bind OpenFilm schema/catalog, StoryPlan
contract, Storytelling SDK version, FilmCraft version, OTIO profile, and supported
or lost edit semantics. Until those gates pass, existing OpenFilm capabilities
remain the reference implementation and Storytelling remains an independent
release track.

During this transfer, defer OpenFilm speed ramps (4B.3), compound editing (4E)
and multicamera (4F). They require shared timing/ownership contracts or would
expand a second NLE before the Storytelling host path is proven.

## Candidate and publication rules

1. Prepare and publish one version at a time: complete `v0.5.0` gates before
   creating the `v0.6.0` release, and continue in order. Do not create several
   tags against one SHA to simulate separate deliveries.
2. Treat the historical anchors only as scope boundaries. For each release,
   create an exact candidate branch, apply required security/correctness fixes,
   update version surfaces and release notes, and run the complete current gate
   set against its final SHA.
3. Run fresh JavaScript and RustSec audits, record lock hashes, compatibility,
   provenance and a candidate-bound validation manifest. Unsound advisories need
   remediation or an independent target-specific disposition before release.
4. Keep `v0.5.0`–`v0.8.0` source-only unless installer gates later close. Do not
   imply that source CI certifies installers, hardware, Resolve, GPU/4K or audio
   quality.
5. Create the GitHub release as a draft only after its candidate passes. Publish
   that version after its release owner reviews the exact SHA, artifacts,
   checksums, known limitations and any manual-gate disclosures.

## Current blockers before the first staged release

- Candidate `54534d8cf985203e8b5abbd09a771436f8fe09e5` passed its technical gates,
  including independent source-security review and actual optimized native
  admission. The owner approved and PR #129 merged the source-only branch update;
  this did not approve a tag, public asset or binary distribution. The later
  compressed archive differed in bytes, while all 1,417 tracked file contents
  matched the candidate Git tree.
- proc-macro-error RUSTSEC-2024-0370 remains a disclosed maintenance warning.
  Its owner disposition is limited to the source-only branch merge; recheck by
  2026-12-08 or on the documented source/toolchain/advisory triggers. It is not
  accepted for binary distribution. GLib source remediation is verified; no
  generic scanner-success waiver is used.
- Direct main-branch metadata reports `protected: false`; repository Rulesets
  and effective main rules are empty. The branch-protection and Actions-secrets
  endpoints return HTTP 403, so classic protection and signing-secret metadata
  are unknown. The Dependabot alerts endpoint explicitly reports alerts
  disabled; other alert sources and notification/response roles remain
  unverified. An owner-reviewed governance policy is tracked separately; this
  plan does not change administrative settings.
- The first four source milestones must not advertise native installers or
  physical workstation certification. Those observations remain under
  [Issue #7](https://github.com/bynanci/open-film/issues/7).

See the [release gate audit](../validation-release-gates.md) and
[native installer validation](../validation-native-installer.md) for the
candidate evidence and platform gates.
