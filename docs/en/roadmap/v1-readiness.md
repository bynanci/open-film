# OpenFilm stable-release readiness

This page records the long-range v1.0 objective; it does not approve a tag.
As of 2026-11-14, the latest public source release remains v0.4.0 while main's
package metadata says 1.0.0. The staged sequence starts with source-only v0.5.0,
continues through v0.8.0 and reserves v1.0.0 for native distribution readiness.
Main at [`9b8df866`](https://github.com/bynanci/open-film/commit/9b8df866134e12e864d642005c46231b41d9da53)
includes the independently reviewed GLib source fix from PR #128 and the merged
A/V comparison/export warning in PRs #161/#162. Main Verify, Windows recovery
and three-platform Render QA passed on that exact SHA. PR #129's candidate
`54534d8cf985203e8b5abbd09a771436f8fe09e5` merged to the separate
`release/v0.5.0` branch at `1b8d386e2a68b2448d20742138b4b100c799289b`.
The owner disposition is limited to that source-only branch update and the
disclosed maintenance warning; no tag, public asset, binary distribution or
workstation claim is approved. The
[owner review record](../release-owner-review-v050.md) documents the compressed
archive digest discrepancy and source-tree verification. It does not provide
installer or physical workstation acceptance. See the
[current release gates](../validation-release-gates.md) and
[release train](incremental-release-train.md). Main metadata is not a published
version; Storytelling maintains a separate repository and release track.

## Post-audit update — 2026-11-14

PR #163 subsequently merged to main at `a335b09`, adding same-build Cargo
evidence capture to the native receipt workflow. All 20 PR-head hosted checks
passed. The corresponding post-merge Verify, Windows recovery and Render QA
were in progress at 16:22 UTC; Pages passed. This source tooling does not close
Issue #140: no reviewed runtime input set, native installer candidate, signed
artifact or candidate-bound receipt has been produced. Issue #141 and the
Windows/macOS workstation gates remain open.

For a shorter overview, see the [roadmap](https://github.com/bynanci/open-film/blob/main/ROADMAP.md)
and [current tasks](https://github.com/bynanci/open-film/blob/main/TASKS.md).
Status was reconciled against the exact main SHA above; dated validation records
retain the results of their original runs. The latest GitHub release is still
v0.4.0; the PR #129 branch merge created no tag or publication.

## Release & Version Status

- **Package metadata**: root, Desktop, Tauri and Cargo currently declare 1.0.0; this is build metadata, not a selected release tag.
- **Latest GitHub release**: v0.4.0, published 2026-10-20. The proposed next OpenFilm train is v0.5.0, followed by v0.6.0–v0.8.0. PR #129 used base SHA `d5a286ed9250872e8eb9b1c3e40adb926f913d34` and candidate PR head `54534d8cf985203e8b5abbd09a771436f8fe09e5`; GitHub merged it as `1b8d386e2a68b2448d20742138b4b100c799289b`, the current `release/v0.5.0` branch head. The candidate's exact CI, native source admission, Render QA and independent technical source review passed. The branch merge does not approve a public tag, source archive asset or binary distribution. Storytelling maintains a separate release track.
- **Selected merged feature baseline (through PR #99, with recent changes noted below)**:
  - PR #64: D6A managed proxy queue, eviction, rebuild, and health UI.
  - PR #69: Windows workflow recovery for issues #66–#68 (FFmpeg frame sync, atomic sync, benchmark quiescence).
  - PR #70: CI contract and media lane separation.
  - PR #71: CI delivery reliability and E2E isolation.
  - PR #72: D3A1 saved-Sequence waveforms and rational-frame resolvers.
  - PR #74: D5A photo presentation, focal coordinates, and ambient depth.
  - PR #75: D5B bilingual title finishing and measured canvas boundaries.
  - PR #76: D8 local bounded declarative presets and immutable accepted snapshots.
  - PR #77: D5C primary color correction and statistical Auto Match.
  - PR #78: D7A 3-OS pinned render QA (Linux x64, macOS arm64, Windows x64).
  - PR #79: User Pins versioned constraints, indicator, and solver integration.
  - PR #81: D3B1 sample-accurate J/L audio policy, shared render/Record mix.
  - PR #84: Cross-platform runtime, native staging, and test hardening.
  - PR #85: Issue #82 causal fix for Windows preview vs. delivery pixel parity.
  - PR #86: Roadmap alignment and capability crosswalk.
  - PR #87: D3B2 A-roll / B-roll coverage roles, primary narration protection, and J/L mix.
  - PR #88: D4 Transcript-driven ripple editing, composite ripple, and conflict rejection.
  - PR #89: D2A Continuity diagnostics (motion clash, pacing, density) and emotional guidance advisories.
  - PR #90: D2B Scene micro-preview & bounded Dip-to-Black / Dip-to-White transitions.
  - PR #91: D3A2 Rhythm analysis & cut-point snap (source-bound onset/downbeat evidence, reliability scoring).
  - PR #92: Cut Desk Phase 1B (precision gestures, zoom/pan, Alt snap-bypass, Shift fine trim).
  - PR #93: Cut Desk Phase 1C (responsive resizable workspace, tabbed & dual-monitor layouts, persistent preference recovery, ShortcutSheet, coarse-pointer targets).
  - PR #96: Cut Desk Phase 2 (professional edit semantics: Roll, Slip, Slide, Insert, Overwrite, Lift, Batch).
  - PR #97: Cut Desk Phase 3 (track controls: target, lock, mute, solo, visibility & persistence).
  - PR #98: PR 4.1 (macOS Darwin cross-process dead-owner detection & boot session verification).
  - PR #99: Finalize the long-range readiness ledger and roadmap alignment.
  - PR #120 patches Tokio to 1.53.3; PR #128 adds the independently reviewed, source-verified GLib repair and fail-closed native admission.
  - PR #119: Merge Tobi-ishi workspace and control-panel UX; exact-head hosted checks passed, while workstation and NLE gates remain open.
  - PR #121: Add explicit event/person coverage constraints with source-consistent asset balance.
  - PR #126: Merge deterministic visual keyframes and bounded opacity rendering.
  - PRs #132–#136: recover stale title previews and delayed search cleanup; retain GraphicScene textures during playback holds; fetch pinned FFmpeg through the asset API and retry transient acquisition failures with bounded backoff.
  - Cut Desk Phase 2/3 command persistence integration, external asset resolution, and atomic Undo/Redo regression.
  - D3B2, D4, D2A, D2B review-and-apply HTTP API routes and desktop UI workflow completion.
  - D3A2 real audio rhythm analysis producer (FFmpeg PCM onset/downbeat/phrase extraction), durable persistence, project reload recovery, and cut-point snap cut lifecycles.
- **Current release gate audit**: See [release gates](../validation-release-gates.md)
  for the 2026-11-08 evidence snapshot and source-only versus installer criteria.
- **Incremental releases**: See [release train](incremental-release-train.md) for
  proposed OpenFilm scope cut lines and the independent Storytelling M0/M1 path.
- **Physical Workstation Acceptance**: Issue #7 remains the owner for physical hardware observations (Windows 10/popopc, external drives, calibrated displays, acoustic listening, Resolve roundtrip, 4K/GPU performance).

## Delivery owners status

| Owner     | Status    | Verification / Merge Evidence                                                                                                                                                                                                                     |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User pins | Complete  | PR #79 merged (`6a15636`); solver, history, Named Versions, Collect integration verified                                                                                                                                                          |
| D1        | Complete  | Multi-source discovery, manifests, analysis and explicit adoption implemented                                                                                                                                                                     |
| D2A       | Complete  | PR #89; continuity diagnostics (motion clash, pacing, density), emotional guidance advisories, review-and-apply HTTP routes, and auditable override receipts ([validation](../validation-continuity-diagnostics.md))                              |
| D2B       | Complete  | Adjacent micro-preview, review-and-apply HTTP routes, & bounded Dip-to-Black / Dip-to-White transitions ([validation](../validation-scene-micro-preview-dips.md))                                                                                 |
| D3A1      | Complete  | PR #72 merged; saved-Sequence waveforms, bounded cache and decoded pulse evidence                                                                                                                                                                 |
| D3A2      | Complete  | Rhythm analysis producer (FFmpeg PCM onset/downbeat/phrase extraction), durable file persistence, project reload recovery, and explicit snap acceptance ([validation](../validation-rhythm-analysis-snapping.md))                                 |
| D3B1      | Complete  | PR #81 merged (`1686b76`); sample-accurate J/L audio policy and shared preview/render mix                                                                                                                                                         |
| D3B2      | Complete  | PR #87 merged (`efb806d`); A-roll / B-roll coverage: role persistence, primary narration retention, review-and-apply HTTP routes, and J/L mix integration                                                                                         |
| D4        | Complete  | PR #88 merged (`d2b5f08`); Transcript-driven ripple editing: reliable timestamp edits, composite ripple, review-and-apply HTTP routes, and conflict rejection ([validation](../validation-transcript-ripple.md))                                  |
| D5A       | Complete  | PR #74 merged; direct focal, versioned Bezier/ambient and protected photo presentation                                                                                                                                                            |
| D5B       | Complete  | PR #75 merged; independent bilingual runs, measured finishing and font/Collect evidence                                                                                                                                                           |
| D5C       | Complete  | PR #77 merged; primary correction before Film Looks and reviewed statistical Auto Match                                                                                                                                                           |
| D6A/D6B   | Complete  | Managed proxies and reviewed derived Collect implemented                                                                                                                                                                                          |
| D7A       | Complete  | PR #78 merged; 3-OS pinned render QA, shared metrics and real decoded controls                                                                                                                                                                    |
| D7B/M7E   | Candidate | Runtime staging, native packaging toolchain, and candidate manifest verification implemented; distributable target runtime, signing/notarization, and physical installer acceptance remain open ([validation](../validation-native-installer.md)) |
| D8        | Complete  | PR #76 merged; local bounded declarative presets and immutable accepted snapshots                                                                                                                                                                 |
| Cut Desk  | Complete  | Phases 1A–1C, Phase 2 (edit semantics) & Phase 3 (track controls & persistence) complete; application command validator, external asset resolution, and atomic Undo/Redo verified                                                                 |

## Platform Recovery & Runtime State

### Windows Recovery

- Windows owner process liveness is verified via conservative PID checks (`windows-owner.ts` / `review-owner.ts`).
- File locks are released upon confirmed process termination; unknown states fail closed.
- Continuous automated coverage is validated via the `windows-media-recovery.yml` workflow.

### macOS Recovery

- Automatic dead-owner detection is complete and verified via OS-specific boot session identity (`sysctl -n kern.bootsessionuuid`), cryptographic SHA-256 hash digest verification (`SHA-256([platform, hostname, bootSessionUuid])`), and ESRCH process liveness checks (`review-owner.ts` / `review-owner-platform.test.ts`, [validation](../validation-macos-dead-owner.md)).
- Dead owner processes across reboots or process termination are safely reclaimed; active processes, unknown states, and foreign platform locks fail closed to prevent accidental data loss.
- Continuous automated coverage is validated via cross-platform native tests and the `windows-media-recovery.yml` workflow.

## M6 Review Scope: Automated Evidence vs. Manual Acceptance

| Category           | Automated Evidence (Passed)                                                      | Pending Manual Acceptance                                               |
| ------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Photo Presentation | Depth maps, bounding boxes, Bezier easing curves, and non-distorting scaling     | Visual aesthetic quality of ambient transitions across art styles       |
| Audio Finishing    | Sample-accurate alignment, zero PCM/seam error, J/L splits, stem export receipts | Acoustic listening verification on studio monitors / calibrated systems |
| Video Output       | Strict byte-for-byte decoded RGB equality, bitexact colorspace, crop parity      | Subjective film look fidelity and pacing reviews                        |
| Story Adoption     | Hash-pinned candidate proposals, immutable receipts, undo/reopen safety          | Editorial satisfaction with generated story arcs                        |

## Long-range scope, platforms, and known limitations

### Included Platforms

- **Web / Browser**: Chromium-based modern browsers with File System Access API and IndexedDB persistence.
- **Desktop (CLI / Server / Native Shell)**: intended targets are Linux (x86_64), macOS (arm64), and Windows (x86_64). This list is not installer acceptance evidence; see the platform gates.

### Key Features

- Multi-source staged import with cryptographic Verified Manifests.
- Professional Cut Desk with integer-frame rational timebase, track controls (target, lock, mute, solo, visibility), professional edit semantics (Roll, Slip, Slide, Insert, Overwrite, Lift), and user-pinned constraints.
- Sample-accurate J/L audio policy with shared render/playback mix and A-roll / B-roll coverage.
- Continuity diagnostics, emotional guidance advisories, and adjacent micro-preview with dip transitions.
- Rhythm analysis and cut-point snapping with source-bound audio intelligence.
- High-fidelity typography finishing, local declarative presets, and primary color correction.
- Multi-OS reproducible rendering with bitexact preview and delivery parity.
- Cross-platform process dead-owner detection and recovery on Windows and macOS.

### Known Limitations

- Physical workstation observations (Issue #7) await physical hardware execution (Windows 10/popopc, external drives, calibrated displays, Resolve NLE roundtrip).
- Signed manual packages and rollback are the intended distribution model, but signing, candidate packages, update failure recovery and uninstall behavior are not configured or validated. In-app background updates remain deferred.

## Contributing to release readiness

1. Choose an open item from the current tasks and confirm its scope in an issue
   or the linked design before substantial implementation.
2. Reuse the existing project and editing contracts. Include focused regressions
   for changed behavior, compatibility and failure recovery.
3. Submit a reviewable pull request with the checks performed and any platform
   or manual verification that remains outstanding.
4. Update the task status after the change is merged. Preserve earlier results
   in dated validation records and add new evidence for the relevant revision.

Changes must preserve original media, reviewable editing decisions and explicit
consent for remote providers. Use generated or appropriately licensed fixtures;
private media and credentials do not belong in public reports. Follow the
[contributing guide](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.md)
for the development workflow.

## Release exit conditions

See the [current release gate policy](../validation-release-gates.md); the conditions below remain the long-range acceptance checklist.

- The accepted included contracts above have no unresolved correctness blocker;
  task owners, architecture, validation and compatibility disclosures agree.
- Complete format, locales, lint, types, unit/integration, build, browser,
  interchange and equipped native gates pass for the exact release source.
  Focused OS render evidence records actual tool/font/metric identities.
- Dependency/security, license/NOTICE/SBOM and runtime provenance are reviewed.
  A retained informational advisory is not a claim that its version is patched.
- Candidate-bound Windows/macOS installation, first run without developer tools,
  CJK/long paths, render/decode/reopen, update/failure recovery, rollback and
  uninstall preservation have the required workstation evidence. Signing and
  notarization claims require their actual artifacts and receipts.
- Advertised hardware/model/NLE/display guarantees have corresponding evidence;
  optional unverified integrations retain explicit support boundaries.

Issue #7 remains the owner of outstanding physical workstation observations.
Hosted Windows 2022 and Linux/ARM64-macOS CI are automated platform evidence;
they do not stand in for physical Windows 10/popopc, external drives, calibrated
displays, listening, Resolve or 4K/GPU acceptance. The release maintainer should document the candidate, workstation procedure and
remaining observations before a release decision. Publish a stable v1 tag only
after the applicable exit conditions are satisfied.

## 2026-11-11 backlog reconciliation

The [current issue plan](next-issues-2026-11-11.md) audits main `08e38b6` and
Storytelling snapshot `b7fcf86`. It separates accepted bounded SDK scopes from
production M3-03, identifies final native candidate evidence binding as code work,
and preserves owner and physical acceptance as open gates. The dated records
above keep their original source/measurement identities; no publication is
approved by this update.
