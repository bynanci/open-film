# Incremental release train

Plan reviewed on 2026-11-08 against main
[`23ac0a22a500b4454449da56436305c5c41292cc`](https://github.com/bynanci/open-film/commit/23ac0a22a500b4454449da56436305c5c41292cc).
This schedules source releases as separate cumulative milestones, not a record
of already published versions.

## Current release state

- Latest public source release remains `v0.4.0`, published 2026-10-20.
- Main includes merged GLib source repair PR #128 and browser balancing PR #131.
  The security head `e11051f` passed all 19 hosted checks and independent technical
  review; this does not select main's 1.0.0 metadata as a release version.
- Main already contains work through the proposed v0.8.0 scope. Repeated tags
  from the same main would ship that whole feature set rather than staged cuts.
- The source-only v0.5.0 candidate remains Draft PR
  [#129](https://github.com/bynanci/open-film/pull/129) on dedicated
  `release/v0.5.0`, based on PR #75's historical scope at
  `d5a286ed9250872e8eb9b1c3e40adb926f913d34`. New candidate head
  `54534d8cf985203e8b5abbd09a771436f8fe09e5` retains all 22 version surfaces at
  0.5.0 and adds the independently reviewed GLib source-security backport.
- The candidate's [Verify 42493427242](https://github.com/bynanci/open-film/actions/runs/42493427242),
  [native source admission 42493427131](https://github.com/bynanci/open-film/actions/runs/42493427131),
  Windows Recovery, DCO and Linux/Windows/macOS Render QA passed on that SHA.
  Downloaded reports validate 313 browser cases and 57 render tests per target.
  Its own independent technical source-security review returned PASS; no older
  main execution receipt substitutes for this candidate.
- The [exact source/asset owner packet](../release-owner-review-v050.md) is
  prepared. Owner approval of the scope, hashes and retained maintenance warning
  remains pending. No tag or release was created; native acceptance stays open.

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
- Candidate work: PR #129 is technically validated at
  `54534d8cf985203e8b5abbd09a771436f8fe09e5`, including its own reviewed GLib
  backport and fresh controls/audits. Keep it Draft until the release-owner
  decision on the [prepared source/asset packet](../release-owner-review-v050.md).

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

As checked on 2026-11-07, Storytelling `main` is
[`610ed49673d6f554e539008b34f5fc5479b9dbc1`](https://github.com/bynanci/storytelling/commit/610ed49673d6f554e539008b34f5fc5479b9dbc1).
The owner merged the three prerequisite deliveries:

- PR #1, Rust M0 foundation/SDLC: head
  [`4c5682c221b8d602ad7bbebe7a4c400c3e1ff95b`](https://github.com/bynanci/storytelling/commit/4c5682c221b8d602ad7bbebe7a4c400c3e1ff95b), merge
  [`22279814ff6b147c386186569d7f77f3a803cf8b`](https://github.com/bynanci/storytelling/commit/22279814ff6b147c386186569d7f77f3a803cf8b).
- PR #2, OpenFilm migration map: head
  [`95291d31c47601181070bf89a28b1a182ddf6ed8`](https://github.com/bynanci/storytelling/commit/95291d31c47601181070bf89a28b1a182ddf6ed8), merge
  [`9fb403be811643baf948acdb6d72232d4a6207bb`](https://github.com/bynanci/storytelling/commit/9fb403be811643baf948acdb6d72232d4a6207bb).
- PR #7, finite read-only M1-01 visual snapshot importer: head
  [`c2fb478c278550b682efba5f898082e8bcd20e24`](https://github.com/bynanci/storytelling/commit/c2fb478c278550b682efba5f898082e8bcd20e24), merge
  [`610ed49673d6f554e539008b34f5fc5479b9dbc1`](https://github.com/bynanci/storytelling/commit/610ed49673d6f554e539008b34f5fc5479b9dbc1).
  Its push and PR-integration runs both passed the required quality/contracts,
  Linux/Windows/macOS Rust, and required-gates jobs: [push run 42327081582](https://github.com/bynanci/storytelling/actions/runs/42327081582),
  [PR run 42327143353](https://github.com/bynanci/storytelling/actions/runs/42327143353).
  This validates only the declared visual mapping profile; it is not an OTIO
  export, actual FilmCraft handoff, source-byte verification, or release.

M1-01 is complete. M1-02 (finite OTIO compiler and explicit loss report) is the
next implementation milestone; M1-03 still requires actual FilmCraft import,
render, readback, save and reopen. Neither task is marked complete by M1-01 CI.

The next steps are:

1. Implement M1-02 as a bounded OTIO compiler with an explicit, profile-bound
   loss report and official parser oracle.
2. Validate M1-03 through an actual FilmCraft import, render, save and reopen
   inside an isolated project, without changing the original project.
3. Only then consider a Rust planner feature flag or broader agent integration.

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
  admission. The source archive/owner-review packet is prepared, but owner
  approval and the release-branch merge are pending.
- proc-macro-error RUSTSEC-2024-0370 remains a maintenance warning for explicit
  owner review with scope, expiry and recheck triggers. GLib source remediation
  is verified; no generic scanner-success waiver is used.
- The current integration cannot confirm restricted repository alerting,
  protection or signing-secret administration (HTTP 403). Ask administration to
  confirm state; do not infer it from failed reads.
- The first four source milestones must not advertise native installers or
  physical workstation certification. Those observations remain under
  [Issue #7](https://github.com/bynanci/open-film/issues/7).

See the [release gate audit](../validation-release-gates.md) and
[native installer validation](../validation-native-installer.md) for the
candidate evidence and platform gates.
