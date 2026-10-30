# OpenFilm v1.0.0 readiness

The user has set **v1.0.0** as the delivery goal. The latest published stable
release is **v0.4.0**; unreleased work does not become a stable release merely by
changing a version field. This crosswalk links the existing
[task owners](https://github.com/bynanci/open-film/blob/main/TASKS.md) and
[dependency/evidence map](seven-subsystem-reconciliation.md); it creates no
second feature queue.

## Current verified foundation

Main `6cdaa4fa46f83c2b41ffc4ee34eee586134a8532` now also contains D8 local presets (#76),
D5C primary correction (#77) and D7A reproducible render QA (#78). Exact heads
285f9f6,1dbef72 andfff6270 each passed their complete required hosted gates and
independent whole/scoped review. The final D7 candidate additionally passed actual
Ubuntu/Windows/macOS ARM64117measurements/10decodednegativecontrols/17outputs,
plus19finishingcases on each OS and aggregate admission.

Earlier PR69/71/72/73/74/75 and issues66–68 retain their original evidence. Main
post-merge Verify/Windows/Pages and the new Render QA are running; earlier merged
main or PR results are not relabeled as results for this new main SHA. User Pins
and later owners remain separate candidates until their exact gates pass. The
historical unreproduced Windows font observation remains in validation; current
strict assertions and synthetic evidence capture are retained, with no claimed
causal repair or hardware certification.

## Delivery owners and remaining scope

| Owner     | Existing foundation                                                           | Required increment toward the goal                                                                                            |
| --------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| User pins | Existing clip/source locks and manual-presentation preservation               | Versioned automatic hard constraints, frame-safe re-solve, visible Pin and isolated persistence; not implemented at this base |
| D1        | Multi-source discovery, manifests, analysis and explicit adoption implemented | Retain source/privacy/revision protections; workstation observations remain separate                                          |
| D2A       | StoryPlan and Scene Direction review                                          | Typed-evidence continuity and advisory emotion guidance; unavailable shot language remains manual review                      |
| D2B       | Existing crossfade                                                            | Bounded adjacent-scene preview and shared Dip-to-Black/White semantics                                                        |
| D3A1      | Saved-Sequence waveforms, bounded cache and decoded pulse evidence            | PR72 merged; retain privacy/source-clock/seek protections and manual workstation limits                                       |
| D3A2      | Generic snap primitive                                                        | Source-bound rhythm evidence and explicit bounded snap proposals with uncertainty                                             |
| D3B1      | Composition audio/automation                                                  | Versioned J/L audio policy and shared preview/render mix semantics                                                            |
| D3B2      | Multi-visual Story scenes                                                     | Reviewed coverage using the shared B1 mix plan plus its own durable receipts; no double mix                                   |
| D4        | Immutable transcripts and native captions                                     | Reliable-timing-only compound ripple with explicit cross-track retime/conflicts                                               |
| D5A       | Direct focal, versioned Bezier/ambient and protected photo presentation       | PR74 merged; retain physical display and other declared manual boundaries                                                     |
| D5B       | Independent bilingual runs, measured finishing and font/Collect evidence      | PR75 merged; retain hardware/native/manual typography boundaries                                                              |
| D5C       | Primary correction before Film Looks and reviewed statistical Auto Match      | PR77 merged; calibrated display and native/NLE guarantees remain separate                                                     |
| D6A/D6B   | Managed proxies and reviewed derived Collect implemented                      | Preserve provenance/quotas/quality disclosures; cross-drive workstation evidence remains                                      |
| D7A       | Three-OS pinned render QA, shared metrics and real decoded controls           | PR78 merged; physical workstation and installer evidence remain separate                                                      |
| D7B/M7E   | Runtime staging, owned service and candidate packaging                        | Compatible GLib remediation, complete runtime/license closure and installer evidence                                          |
| D8        | Local bounded declarative presets and immutable accepted snapshots            | PR76 merged; rights authenticity/manual checks and executable plugins remain separate                                         |
| Cut Desk  | Source/Record, exact transport, history and contextual controls               | Remaining approved Precision gestures, responsive workspace, track/audio and finishing semantics under their existing owners  |

Each increment first reconciles actual source and prior evidence, writes its
independent compatibility/threat design where required, and extends its existing
owner. Separate branches/PRs keep review and rollback concrete. Independent photo,
title, color and preset work can proceed together; J/L policy precedes typed
coverage, and every combined contract is retested against the latest main.

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

Issue7 remains the owner of outstanding physical workstation observations.
Hosted Windows2022 and Linux/ARM64-macOS CI are automated platform evidence;
they do not stand in for physical Windows10/popopc, external drives, calibrated
displays, listening, Resolve or4K/GPU acceptance. When code and candidate tooling
are ready, the remaining workstation procedure and evidence inputs must be
concrete before requesting them. A stable v1 tag and release follow the actual
exit decision.
