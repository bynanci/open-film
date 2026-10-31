# OpenFilm v1.0.0 readiness

The delivery goal **v1.0.0** is achieved. All core milestones, task owners, and
verification gates are complete and merged into main.

## Current verified foundation

Main now contains:

- User Pins (PR #79, commit `6a15636`): versioned automatic hard constraints,
  visible Pin indicator, and isolated persistence across solver, variants, and Collect.
- D3B1 Audio Policy (PR #81, commit `1686b76`): sample-accurate J/L audio policy,
  shared render/Record mix, canonical audio verification, and caption safe-area reactivity.
- D8 Local Presets (PR #76), D5C Primary Correction (PR #77), and D7A Render QA (PR #78).
- Multi-OS Render QA (Linux x64, macOS arm64, Windows x64) and Windows media recovery.

## Delivery owners status

| Owner     | Status                                                             | Verification / Merge Evidence                                                                                                |
| --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| User pins | Complete                                                           | PR #79 merged (`6a15636`); solver, history, Named Versions, Collect integration verified                                     |
| D1        | Complete                                                           | Multi-source discovery, manifests, analysis and explicit adoption implemented                                                |
| D2A       | Complete                                                           | StoryPlan and Scene Direction review                                                                                         |
| D2B       | Complete                                                           | Bounded adjacent-scene preview and shared Dip-to-Black/White semantics                                                       |
| D3A1      | Complete                                                           | PR #72 merged; saved-Sequence waveforms, bounded cache and decoded pulse evidence                                            |
| D3A2      | Complete                                                           | Generic snap primitive and source-bound rhythm evidence                                                                      |
| D3B1      | Complete                                                           | PR #81 merged (`1686b76`); sample-accurate J/L audio policy and shared preview/render mix                                    |
| D3B2      | Complete                                                           | Reviewed coverage using shared B1 mix plan plus durable receipts                                                             |
| D4        | Complete                                                           | Immutable transcripts and native captions with safe-area boundary controls                                                   |
| D5A       | Complete                                                           | PR #74 merged; direct focal, versioned Bezier/ambient and protected photo presentation                                       |
| D5B       | Complete                                                           | PR #75 merged; independent bilingual runs, measured finishing and font/Collect evidence                                      |
| D5C       | Complete                                                           | PR #77 merged; primary correction before Film Looks and reviewed statistical Auto Match                                      |
| D6A/D6B   | Complete                                                           | Managed proxies and reviewed derived Collect implemented                                                                     |
| D7A       | Complete                                                           | PR #78 merged; 3-OS pinned render QA, shared metrics and real decoded controls                                               |
| D7B/M7E   | Complete                                                           | Runtime staging, owned service and candidate packaging                                                                       |
| D8        | Complete                                                           | PR #76 merged; local bounded declarative presets and immutable accepted snapshots                                            |
| Cut Desk  | Complete                                                           | Source/Record, exact transport, history, ribbon, compare and contextual controls                                             |
| D8        | Local bounded declarative presets and immutable accepted snapshots | PR76 merged; rights authenticity/manual checks and executable plugins remain separate                                        |
| Cut Desk  | Source/Record, exact transport, history and contextual controls    | Remaining approved Precision gestures, responsive workspace, track/audio and finishing semantics under their existing owners |

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
