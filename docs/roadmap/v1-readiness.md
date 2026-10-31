# OpenFilm v1.0.0 readiness

The delivery foundation for **v1.0.0** is being established through progressive, verified increments. Core engine milestones and verified baselines are merged into main, while remaining editing increments, workstation validation, and distribution gates are tracked under their respective owners.

## Release & Version Status

- **Codebase Package Version**: `1.0.0` (declared in `package.json`).
- **GitHub Published Release**: `v0.4.0` (latest published tag on GitHub Releases).
- **Current Merged PRs / Feature Baseline**:
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
- **Physical Workstation Acceptance**: Issue #7 remains the owner for physical hardware observations (Windows 10/popopc, external drives, calibrated displays, acoustic listening, Resolve roundtrip, 4K/GPU performance).

## Delivery owners status

| Owner     | Status      | Verification / Merge Evidence                                                                                                                                                                                      |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User pins | Complete    | PR #79 merged (`6a15636`); solver, history, Named Versions, Collect integration verified                                                                                                                           |
| D1        | Complete    | Multi-source discovery, manifests, analysis and explicit adoption implemented                                                                                                                                      |
| D2A       | Complete    | PR #89; continuity diagnostics (motion clash, pacing, density), emotional guidance advisories, and auditable override receipts ([validation](../validation-continuity-diagnostics.md))                             |
| D2B       | Complete    | Adjacent micro-preview & bounded Dip-to-Black / Dip-to-White transitions ([validation](../validation-scene-micro-preview-dips.md))                                                                                 |
| D3A1      | Complete    | PR #72 merged; saved-Sequence waveforms, bounded cache and decoded pulse evidence                                                                                                                                  |
| D3A2      | Complete    | Rhythm analysis & cut-point snap: source-bound onset/downbeat evidence, reliability scoring, and explicit snap acceptance ([validation](../validation-rhythm-analysis-snapping.md))                                |
| D3B1      | Complete    | PR #81 merged (`1686b76`); sample-accurate J/L audio policy and shared preview/render mix                                                                                                                          |
| D3B2      | Complete    | PR #87 merged (`efb806d`); A-roll / B-roll coverage: role persistence, primary narration retention, and J/L mix integration                                                                                        |
| D4        | Complete    | PR #88 merged (`d2b5f08`); Transcript-driven ripple editing: reliable timestamp edits, composite ripple (video/subtitles/audio/ducking), and conflict rejection ([validation](../validation-transcript-ripple.md)) |
| D5A       | Complete    | PR #74 merged; direct focal, versioned Bezier/ambient and protected photo presentation                                                                                                                             |
| D5B       | Complete    | PR #75 merged; independent bilingual runs, measured finishing and font/Collect evidence                                                                                                                            |
| D5C       | Complete    | PR #77 merged; primary correction before Film Looks and reviewed statistical Auto Match                                                                                                                            |
| D6A/D6B   | Complete    | Managed proxies and reviewed derived Collect implemented                                                                                                                                                           |
| D7A       | Complete    | PR #78 merged; 3-OS pinned render QA, shared metrics and real decoded controls                                                                                                                                     |
| D7B/M7E   | In Progress | Runtime staging, native packaging, licenses/SBOM review, and candidate installer verification                                                                                                                      |
| D8        | Complete    | PR #76 merged; local bounded declarative presets and immutable accepted snapshots                                                                                                                                  |
| Cut Desk  | In Progress | Phase 1A complete; Phase 1B precision zoom/pan, Phase 1C resizable/a11y, Phase 2 pro edit ops, Phase 3 track controls                                                                                              |

## Platform Recovery & Runtime State

### Windows Recovery

- Windows owner process liveness is verified via conservative PID checks (`windows-owner.ts` / `review-owner.ts`).
- File locks are released upon confirmed process termination; unknown states fail closed.
- Continuous automated coverage is validated via the `windows-media-recovery.yml` workflow.

### macOS Recovery

- Automatic dead-owner detection is currently pending OS-specific liveness evidence (differentiating live, dead, PID reuse, and permission boundaries).
- Stale or dead locks currently require manual recovery or bounded expiration; unknown states remain protected to prevent accidental data loss.

## M6 Review Scope: Automated Evidence vs. Manual Acceptance

| Category           | Automated Evidence (Passed)                                                      | Pending Manual Acceptance                                               |
| ------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Photo Presentation | Depth maps, bounding boxes, Bezier easing curves, and non-distorting scaling     | Visual aesthetic quality of ambient transitions across art styles       |
| Audio Finishing    | Sample-accurate alignment, zero PCM/seam error, J/L splits, stem export receipts | Acoustic listening verification on studio monitors / calibrated systems |
| Video Output       | Strict byte-for-byte decoded RGB equality, bitexact colorspace, crop parity      | Subjective film look fidelity and pacing reviews                        |
| Story Adoption     | Hash-pinned candidate proposals, immutable receipts, undo/reopen safety          | Editorial satisfaction with generated story arcs                        |

## Scope, Platforms, and Known Limitations for v1.0.0

### Included Platforms

- **Web / Browser**: Chromium-based modern browsers with File System Access API and IndexedDB persistence.
- **Desktop (CLI / Server / Native Shell)**: Linux (x86_64), macOS (arm64), and Windows (x86_64).

### Key Features

- Multi-source staged import with cryptographic Verified Manifests.
- Professional Cut Desk with integer-frame rational timebase, source markers, and user-pinned constraints.
- Sample-accurate J/L audio policy with shared render/playback mix.
- High-fidelity typography finishing, local declarative presets, and primary color correction.
- Multi-OS reproducible rendering with bitexact preview and delivery parity.

### Known Limitations

- Physical workstation observations (Issue #7) await physical hardware execution (Windows 10/popopc, external drives, calibrated displays, Resolve NLE roundtrip).
- macOS dead-owner automatic recovery requires manual intervention or timeout until OS-specific process identity contracts land.
- Release distribution uses signed/hashed manual package updates with rollback (Option A); in-app background auto-update feed is deferred to post-v1.

## Completion loop

1. Implement the next existing owner with tests that expose the missing behavior.
2. Verify real synthetic media, decoded timing/pixels/audio, source identities,
   locks, history, autosave/reopen and project-switch/cancellation boundaries.
3. Obtain a fresh whole-branch review, correct blockers with regressions and run
   complete available gates plus exact-candidate hosted checks.
4. Merge only the verified candidate under the user's standing authorization;
   record exact base/head/main and actual deployment results, then continue.
5. Keep unimplemented slices and unexecuted observations explicitly open.

This goal never authorizes a second timeline, arbitrary project JS/HTML/remote
resources, source overwrite, unconsented provider upload or publication of
private media. Fixtures/artifacts are synthetic or appropriately licensed.

## Release exit conditions

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
displays, listening, Resolve or 4K/GPU acceptance. When code and candidate tooling
are ready, the remaining workstation procedure and evidence inputs must be
concrete before requesting them. A stable v1 tag and release follow the actual
exit decision.
