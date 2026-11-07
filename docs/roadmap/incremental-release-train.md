# Incremental release train

Plan reviewed on 2026-11-07 against main
[`5f737a6c8f35dce48e213370ff27900962c9304c`](https://github.com/bynanci/open-film/commit/5f737a6c8f35dce48e213370ff27900962c9304c).
This schedules source releases as separate, cumulative milestones. It is not a
record of releases already published.

## Current release state

- The latest published release is source-only `v0.4.0` from 2026-10-20.
- The repository contains a later commit titled `release: OpenFilm v1.0.0`
  (PR #83), but no `v1.0.0` tag or GitHub Release exists. Root, Desktop, Tauri
  and Cargo metadata saying `1.0.0` is not publication evidence.
- Main has accumulated work through the proposed `v0.8.0` scope. Publishing
  multiple tags from current main would ship the same full feature set repeatedly.

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
- Candidate work: create a versioned release branch, align every package/Tauri/Cargo
  version surface, backport required security fixes, then run the full candidate gates.

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
- Historical scope anchor: current main
  [`5f737a6c8f35dce48e213370ff27900962c9304c`](https://github.com/bynanci/open-film/commit/5f737a6c8f35dce48e213370ff27900962c9304c), including merged PR #126.
- Distribution target: source archive only. This scope does not close native
  installer or physical workstation gates.
- Candidate work: freeze one release SHA and rerun all release checks. The main
  CI snapshot is supporting evidence, not candidate CI.

### v1.0.0 — Native distribution and ecosystem readiness

- Release only after the runtime and installer are actually distributable and
  every advertised platform passes signing/notarization, clean-machine first
  launch, update failure recovery, rollback and project-preserving uninstall.
- No source SHA is nominated yet. M7E, GLib security disposition and physical
  Windows/macOS workstation observations remain open.
- The intended scope is a verified distribution step after earlier source
  milestones, not a container for all unfinished features.

## Independent Storytelling release track

OpenFilm desktop and Storytelling SDK have separate repositories, release tags,
compatibility promises and release checks. Do not bundle a Storytelling SDK
release into an OpenFilm desktop release or assign Storytelling milestones an
OpenFilm version number.

As checked on 2026-11-07, Storytelling `main` is
[`551ff38920e2085e1d53a7ba777c9680678e9725`](https://github.com/bynanci/storytelling/commit/551ff38920e2085e1d53a7ba777c9680678e9725).
PR #1, Rust M0 foundation/SDLC, is still a draft at
[`4c5682c221b8d602ad7bbebe7a4c400c3e1ff95b`](https://github.com/bynanci/storytelling/commit/4c5682c221b8d602ad7bbebe7a4c400c3e1ff95b);
all listed hosted checks pass, but it is not merged. PR #2, the migration map,
is a draft at
[`95291d31c47601181070bf89a28b1a182ddf6ed8`](https://github.com/bynanci/storytelling/commit/95291d31c47601181070bf89a28b1a182ddf6ed8)
and targets the M0 branch from PR #1; its listed hosted checks pass, but it is
not merged. See [PR #1](https://github.com/bynanci/storytelling/pull/1) and
[PR #2](https://github.com/bynanci/storytelling/pull/2).

The proposed order is:

1. Review and merge Storytelling PR #1, then review and merge dependent PR #2.
2. Implement M1-01 as a read-only OpenFilm import. Do not write to the OpenFilm
   Catalog or duplicate media management.
3. Implement M1-02 as a bounded OTIO compiler with an explicit loss report.
4. Validate M1-03 through an actual FilmCraft import, render, save and reopen.
5. Only then consider a Rust planner feature flag or broader agent integration.

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

- No `v0.5.0` candidate branch or tag exists. The historical anchor predates
  the Tokio patch and cannot be tagged without a security refresh and exact-SHA
  validation.
- GLib `RUSTSEC-2024-0429` remains an unsoundness finding; the existing audit's
  successful default exit does not close it.
- Dependabot alerts are disabled, and required-check enforcement has not been
  confirmed through repository administration.
- The first four source milestones must not advertise native installers or
  physical workstation certification. Those observations remain open under
  [Issue #7](https://github.com/bynanci/open-film/issues/7).

See the [release gate audit](../validation-release-gates.md) and
[native installer validation](../validation-native-installer.md) for the
candidate evidence and platform gates.
