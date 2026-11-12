# OpenFilm development tasks

This is the current contributor-facing work list. [ROADMAP.md](ROADMAP.md)
explains the direction; the [release gate policy](docs/validation-release-gates.md)
defines current release requirements. The [incremental release train](docs/roadmap/incremental-release-train.md)
keeps OpenFilm and Storytelling releases on separate version tracks. The v1.0
readiness page remains a long-range scope record. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before starting a substantial change, and check existing issues or pull requests
to avoid duplicate work.

Historical baseline reviewed against [main `08e38b6`](https://github.com/bynanci/open-film/commit/08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224)
on 2026-11-11. Planning PR #147, CI/profiling PR #148 and SDK PR #149 are merged;
[the issue execution record](docs/validation/issue-execution-2026-11-11.md) separates
implementation PRs #149–#151, whole-code verification and remaining external gates.
Their linked PR records carry current final-head checks and merge status.
PRs #128, #130–#137 are merged. PR #137 final-head and post-merge
checks passed, including 1,548 contracts, 4,429 media tests and 363 browser cases;
workstation schema 1.1 does not certify physical observations. PR #128's head `e11051f`
passed all 19 checks, including actual native source admission and independent
technical source review. The v0.5.0 source-only candidate in Draft PR #129 is
`54534d8cf985203e8b5abbd09a771436f8fe09e5`; its own full CI, three-platform
Render QA, optimized native controls and independent adapted-source review pass.
Release-owner approval of the exact source archive and retained maintenance
warning remains pending. Native installer/workstation gates remain open. The
latest published source release remains **v0.4.0**.

- An unchecked item is unfinished work or missing verification.
- A checked item identifies an implemented scope, not a blanket release or
  hardware certification.
- Existing milestone IDs are retained so design documents and implementation
  history remain easy to follow.

## Next execution queue

The [2026-11-11 issue plan](docs/roadmap/next-issues-2026-11-11.md) maps the
28 unchecked baseline entries to code, evidence, owner and deferred work.
Its first independent code packages are a read-only Storytelling compatibility
capsule, measured CI profiling, and final native evidence binding. Runtime
provisioning and target QA proceed through separate dependencies. Existing
Issue #7 and PR #129 remain the hardware umbrella and source-owner gate.

- [x] Complete the bounded [#139 media cost profile](docs/validation/media-test-profile.md)
      using two fixed-source repetitions and 56 real tool calls. Render work
      dominated the selected cases; no production speedup, fixture reuse or
      weaker suite assertion is claimed.
- [x] Implement actual-checkout source-head guards and unconditional Windows
      recovery coverage in [PR #148](https://github.com/bynanci/open-film/pull/148).
      The approved, unapplied [merge policy](docs/governance/merge-controls-operator-handoff.md)
      remains unapplied; this implementation does not approve distribution.
- [x] Obtain the owner's approval for the fixed #146 main-ruleset proposal
      `207bc7fed2804ad79d69e0c98ecf68f9ce4ba21c5d0e7fde8e68d4c158e3ce2e`
      after this round of validated PRs. This approval excludes release/signing.
- [ ] Apply that approved policy with authorized administrator access after the
      PR round, verify safe control cases, and obtain alerting/release-role
      attestations for [#146](https://github.com/bynanci/open-film/issues/146).
      The exact approved POST after round #147–#151 main verification returned
      HTTP 403 (integration administration access); no rule was created. Owner
      approval remains valid, and an existing Rulesets administrator must apply
      the fixed JSON. Native signing, lifecycle and performance remain separate.

## Editing and story workflow

### Tobi-ishi workspace and control panels (merged in PR #119)

- [x] Share local color, typography, original angular backing planes and lighting
      without clipping media, text, hit areas or keyboard focus.
- [x] Keep one progress route in General mode; retain Pipeline review/recovery
      in the compact bar and complete navigation in its drawer and Expert dock.
- [x] Provide keyboard Inspector tabs and a device-local collapse preference;
      put essential timing, speed and volume before styling tools.
- [x] Disclose script/direction tools without unmounting authored drafts or review;
      expose Import, Fit review, Preview and Relink through guarded quick actions.
- [x] Validate content-sized whitespace, paired Storyboard media/text, independent
      transcript scrolling and readable selected states with browser regressions.
- [x] Execute local regression gates and record full-run failures, corrected
      reruns and native dependency limits without treating reruns as a green CI run.
- [x] Hosted exact-head CI passed on PR #119 head
      `4015d685f69bc9a697db95df67cebf5d8af72d22` before merge to main commit
      `9b33249c3bd60872072c55fac4efac43d6d6e13b`; DCO, fast-contract,
      typescript-and-media, four browser shards, heavy-media, native-shell,
      Windows recovery and three-platform Render QA passed. See
      [PR #119](https://github.com/bynanci/open-film/pull/119) and the
      [dated validation record](docs/validation-tobiishi-control-panels-2026-11-06.md).
- [ ] Complete real workstation, display-scale, keyboard and NLE checks. Hosted
      CI and merge do not close these manual gates.

See the [design system](docs/design-system.md),
[layout rationale](docs/layout-refinement.md) and
[shared-surface decision](docs/adr/tobiishi-surfaces.md) and
[dated validation](docs/validation-tobiishi-control-panels-2026-11-06.md).

### Multi-source review response cleanup (PR #133)

- [x] Wait for held stale review-search responses and remove the route in both
      normal completion and assertion-failure cleanup. Preserve selection,
      stale-response and result assertions; this is test-harness reliability,
      not a change to import or review behavior.
- [x] Validate the focused multi-source browser spec repeatedly and in the
      exact-head six-shard CI, with Windows media recovery and three-platform
      Render QA. See the [multi-source validation record](docs/validation-multi-source-analysis.md)
      and [PR #133](https://github.com/bynanci/open-film/pull/133).

### GraphicScene sampled-preview continuity (PR #134)

- [x] Reproduce a disappearing preview when transport playback pauses or holds
      while its exact still is pending; retain the last successful texture until
      the current frame arrives. Project, Composition, revision and source-scope
      changes still clear the old texture and fence stale responses.
- [x] Add a deterministic browser regression with a held graphics response and
      verify the retained texture is replaced by the exact paused frame.
- [x] Run the existing bounded-playback, discontinuity and owner-switch case
      five times; all ten repeated GraphicScene cases passed locally. The full
      Record Monitor browser spec passed 7/7 and its unit suite passed 43/43.
- [x] Rebase and merge the focused correction as
      [1522879b](https://github.com/bynanci/open-film/commit/1522879b538d7145b1972d721dde78155179592e).
      Exact-head Verify, Windows Recovery, three-platform Render QA, native-shell,
      docs-site, and DCO passed. This sampled-preview evidence does not establish
      realtime playback, GPU/4K performance, or workstation acceptance. See the
      [GraphicScene validation record](docs/validation-graphic-scene.md) and
      [PR #134](https://github.com/bynanci/open-film/pull/134).

### Stale title-preview response recovery (PR #132)

- [x] Add `finally` cleanup for the held fetch/response gates and remove the
      route after the handler settles, even when an assertion fails. A dedicated
      browser case injects an assertion failure after the stale HTTP 409 and
      verifies the blocked response handler completes.
- [x] The exact-head Verify run passed 376 media files / 4,421 tests and all
      six browser shards (362 cases); Windows Recovery passed 140 tests plus
      14 browser cases; three-platform Render QA and DCO passed.
- [x] Merge PR #132 at
      [d141b140](https://github.com/bynanci/open-film/commit/d141b140cd96b2db45a2a822435f6dee6f810d14).
      See the [merged PR](https://github.com/bynanci/open-film/pull/132).

### Bounded retries for pinned Render QA tools

- [x] Trace the post-merge Windows Recovery HTTP 503 responses to a retry window
      of only two requests with a 250 ms initial delay; both failures occurred
      before tests, while the exact PR candidate and three-platform Render QA
      passed.
- [x] Add a deterministic red-green regression for repeated 503 responses and
      a persistent-origin failure that remains bounded.
- [x] Expand retries to five attempts with capped exponential backoff while
      preserving pinned origin allowlists, byte bounds, SHA-256 checks,
      Retry-After handling, and fail-closed permanent errors.
- Exact-head Verify, Windows Recovery, three-platform Render QA, and DCO remain
  required merge gates for the follow-up; see
  [PR #136](https://github.com/bynanci/open-film/pull/136) and the
  [Render QA validation record](docs/validation-render-qa.md).

### Media intelligence: reviewed silence and durable Jobs (2026-11-05)

Merged PRs [#107](https://github.com/bynanci/open-film/pull/107) and
[#108](https://github.com/bynanci/open-film/pull/108) provide the durable
`silence-analysis` Job, HTTP lifecycle and Precision Review/Accept UI. It uses the existing
`SilenceService`, SQLite reservations, owner recovery and TimelineEditor; it
does not add an editing engine, provider, model or new timeline. Rendered before/after audition and real-media/workstation quality checks
remain separate acceptance scopes. See the
[dated validation record](docs/validation-silence-durable-jobs-2026-11-05.md),
[recovery and API contract](docs/media-analysis-recovery.md),
[integration guide](docs/en/media-intelligence-integrations.md),
[繁體中文](docs/media-intelligence-integrations.md) and
[ADR 012](docs/adr/012-reviewed-media-intelligence.md).

- [x] Accept source-bound low-energy evidence: 48 kHz/20 ms, first audio stream,
      per-channel peak maximum, zero-based containers/delayed audio/packet gaps,
      rejection of nonzero container starts, bounded parameters, duration/interval
      limits, cancellation and no-audio failures. Do not label
      the result as speech VAD.
- [x] Accept the complete CLI analyze → JSON preview → confirmed apply workflow
      with durable exact review, source hash and Composition revision checks;
      generic and batch editor routes must enforce the same acceptance boundary.
- [x] Verify trim/speed and padding projection, locks/pins, supported ripple
      synchronization, fail-closed independent audio timing, and session-local
      Undo/Redo. Separate CLI invocations do not share undo history.
- [x] Record focused tests, build/type checks and remaining platform limits for
      this candidate before marking its implemented scope accepted.
- [x] Persist `silence-analysis` Job identity, exact source hash and Composition
      revision, request-idempotent reservation, owner-fenced state transitions,
      `waiting-review`, cancellation, explicit retry and conservative recovery.
- [x] Provide real HTTP create/status/Review/cancel/retry/recover/apply routes
      that share `SilenceService` and `TimelineEditor`; require the exact
      persisted proposal and never auto-apply analysis.
- [x] Persist a bounded Apply acknowledgement with the same project manifest
      save as the ripple edit, including exact replay after restart and repair
      after a Job acknowledgement write failure.
- [x] Verify synthetic WAV analysis through real HTTP, two-process owner
      recovery, request replay, cancellation, retry, stale callback rejection,
      source/revision fencing and duplicate Apply.
- [x] Preserve silence ripple protections for locked clips, user-pinned clips,
      independent audio timing, and the active TimelineEditor Undo/Redo stack.
- [x] Preserve local gain/fade/ducking automation through reviewed silence
      ripples and direct Clip Split with a versioned 48 kHz source-clock map.
      The in-flight candidate reuses AudioMixPlan, TimelineEditor and compound
      Undo/Redo; it does not add a mixer or edit state.
- [x] Reject J/L timing, locked/pinned owners, stale source clocks and later
      trim/speed/source replacement operations when their mapped automation
      cannot be proven valid. See the [automation ripple validation](docs/validation-audio-policy.md).
- [x] Verify the merged baseline media gate in configured CI: main `272af11`,
      [Verify 42011116534](https://github.com/bynanci/open-film/actions/runs/42011116534).
      New audition candidate CI is reported separately in its validation record.
- [x] Reject non-equivalent fractional sample windows before Review, retain
      mapped sources in Collect, provide explicit desktop envelope reset, and
      include original DSP histories in the existing Record preparation budget.
      [PR #114](https://github.com/bynanci/open-film/pull/114) records the exact
      candidate, independent review and required hosted checks before merge.
      Complex-graph scaling now receives deterministic rounding flags; unchanged
      exact-pixel Windows probes remain a final-head merge gate.
- [x] Provide the desktop Precision Review/Apply surface over the durable API
      ([PR #108](https://github.com/bynanci/open-film/pull/108)).
- [x] Implement and locally validate immutable Silence rendered audition through the existing Record
      mix, accepted-render PCM comparisons, cancellation and stale-result guards
      ([candidate validation](docs/validation-silence-rendered-audition.md)).
- [x] Record the bounded Linux objective proof with permissioned CC0 human
      dialogue and guitar: existing durable Review → audition → explicit Accept
      → MP4 decode → Undo/Redo → Save → cold Reopen, exact PCM/WAV parity and
      source/protection checks. See the [real-media validation and retained
      evidence](docs/validation-silence-real-media.md). This does not close
      [#144](https://github.com/bynanci/open-film/issues/144): the mixed case's
      existing frame-aligned MP4 export excludes 1,152 PCM samples / 24 ms,
      explicitly retained as `qa.frameAlignedAudioTail` / manual review.
- [ ] Complete real dialogue/music listening QA and Windows/macOS workstation
      audition checks, recorded A/V synchronization, more than two captured
      channels and live browser lifecycle cases. The objective CC0 proof does
      not establish listening quality or acceptance of its excluded tail.
- [ ] Admit additional scene/rhythm, mask/restoration, stabilization/interpolation,
      separation or browser-rendering providers only after quality, timing,
      runtime and code/weight rights checks. Reuse existing capabilities.

### Professional Cut Desk

- [x] **Phase 4A — source scopes and split-wipe comparison.** Merged in
      [PR #112](https://github.com/bynanci/open-film/pull/112). Browser scopes
      describe bounded, pre-look source samples; calibrated display, HDR and
      hardware-monitor behavior are not included. See the
      [Phase 4A validation](docs/validation-cut-desk-phase-4a-scopes.md).
- **Phase 4B — deterministic animation:** only the deferred 4B.3 speed-ramp
  subtask below remains open; this aggregate is not a second implementation task. The shared frame-time contract
  and visual keyframes are implemented in 4B.1/4B.2. Speed ramps (4B.3) are
  deferred pending production host proof and require source-mapped caption/audio/
  rhythm consumers, explicit audio policy, arbitrary-seek evaluation and
  Monitor/FFmpeg parity. Preserve the existing Composition and user-pin
  contracts.
- [x] **Phase 4C — shortcut profiles.** Merged in
      [PR #113](https://github.com/bynanci/open-film/pull/113). Profiles are
      validated declarative local preferences, separate from project content.
      Supported physical keyboard layouts and native OS reservations remain a
      workstation check. See the
      [Phase 4C validation](docs/validation-cut-desk-phase-4c-shortcut-profiles.md).
- [ ] **Phase 4D — long-form evidence.** Add bounded performance telemetry and
      gather workstation evidence for proxies, high-DPI, pen/trackpad and
      multichannel audio workflows.
- [ ] **Phase 4E — compound editing (deferred).** Revisit only after the
      Storytelling host path is proven and a versioned Composition contract
      demonstrates that it cannot introduce a hidden second timeline.
- [ ] **Phase 4F — multicamera (deferred).** Revisit only after production host proof
      and only with explicit synchronization and source-provenance evidence.

#### Phase 4B — deterministic animation

- [x] **4B.1 shared frame-time contract:** merged in PR [#125](https://github.com/bynanci/open-film/pull/125) at `7add4762fe8174d76f43b863375ea39b73121e76`; exact-head hosted verification passed before merge.
- [x] **4B.2 visual keyframes:** merged in PR [#126](https://github.com/bynanci/open-film/pull/126); feature head `b4aba4c4bb70b8cb03edd54342f1b94cec649245`, main merge [`5f737a6c8f35dce48e213370ff27900962c9304c`](https://github.com/bynanci/open-film/commit/5f737a6c8f35dce48e213370ff27900962c9304c). Exact-head Verify, all six browser shards, heavy-media QA, three-platform Render QA, Windows FFmpeg9 recovery, native-shell, docs-site and DCO passed. See [validation](docs/validation-cut-desk-phase-4b-visual-keyframes.md).
- [ ] **4B.3 speed ramps:** deferred until the production SDK host path is proven and source-mapped caption, audio and rhythm consumers are reconciled under an explicit audio policy. Keep existing audio timing unchanged until then.

See the [4B design](docs/superpowers/specs/2026-11-06-cut-desk-phase-4b-deterministic-animation-design.md), [shared contract validation](docs/validation-cut-desk-phase-4b-time-contract.md) and [visual keyframe validation](docs/validation-cut-desk-phase-4b-visual-keyframes.md).

Phases 1A–1C, Phase 2 (Roll, Slip, Slide, Insert, Overwrite, Lift, Ripple Delete, Batch edits) and Phase 3 (track controls: target, lock, mute, solo, visibility & persistence) have merged implementations, including precision zoom/pan, snap-bypass gestures, responsive monitor layouts and accessibility controls.
See the [Cut Desk guide](docs/professional-cut-desk.md),
[approved design](docs/superpowers/specs/2026-10-26-professional-cut-desk-design.md),
[Phase 1B validation](docs/validation-cut-desk-phase-1b.md),
[Phase 1C validation](docs/validation-cut-desk-phase-1c.md),
[Phase 2 validation](docs/validation-cut-desk-phase-2.md), and
[Phase 3 validation](docs/validation-cut-desk-phase-3.md). Physical interaction
and workstation checks remain in the verification section below.

### Story and editing follow-up

- [x] Connect and verify the remaining desktop/API review-and-apply workflows
      for the continuity, adjacent-scene micro-preview, rhythm and transcript
      ripple services ([workflow review-and-apply validation](tests/integration/workflow-review-apply-http.test.ts)).
- [x] Implement source-bound onset/downbeat/phrase landmark extraction,
      durable persistence, reopen restoration, and cut-point snap proposals
      ([rhythm pipeline validation](tests/integration/rhythm-pipeline.test.ts), [D3A2 validation](docs/validation-rhythm-analysis-snapping.md)).
- [x] Define and implement explicit per-beat event/person coverage and
      media-balance constraints without changing user-pinned choices. Story
      Graph authoring, StoryPlan preservation, durable project validation, and
      solver conflict behavior are recorded in the [Story Coverage validation](docs/validation-story-coverage.md).

Continuity diagnostics (D2A), adjacent-scene previews and dip transitions (D2B),
rhythm proposals (D3A2), A-roll/B-roll coverage (D3B2) and transcript ripple edits
(D4) now have merged implementations. Their evidence and supported scope are
linked under **Implemented foundations** below. New work should build on those
services and preserve explicit review, source identity, locks and history.

Design references: [story authoring](docs/story-arc-authoring.md),
[editing contracts](docs/EDITING_CONTRACTS.md),
[seven-subsystem design crosswalk](docs/roadmap/seven-subsystem-reconciliation.md).
The crosswalk records design responsibilities; current completion status is
recorded here, in the [release gate audit](docs/validation-release-gates.md),
and in the long-range v1.0 readiness record.

## Distribution and platform readiness

### Incremental release train

- [x] Define separate, cumulative OpenFilm source releases (`v0.5.0` through
      `v0.8.0`) and reserve `v1.0.0` for native distribution closure; keep
      Storytelling independently versioned ([release plan](docs/roadmap/incremental-release-train.md)).
- [x] Prepare and verify the first `v0.5.0` source-only candidate in Draft PR
      [#129](https://github.com/bynanci/open-film/pull/129), head
      `54534d8cf985203e8b5abbd09a771436f8fe09e5`, on dedicated
      `release/v0.5.0` base `d5a286ed9250872e8eb9b1c3e40adb926f913d34`.
      All 22 version surfaces remain 0.5.0; only the reviewed security backport
      extends its historical feature cut. See the [owner packet](docs/release-owner-review-v050.md).
- [x] Pass the candidate's source, dependency/native admission, provenance,
      Windows Recovery and three-platform Render QA gates. Downloaded reports
      verify 313 browser cases and 57 render tests per target, with no hardware
      certification. Prior `04035f3` results remain historical.
- [x] Obtain independent technical GLib dispositions for main repair PR #128
      and the adapted release source; retain source/lock/control/audit proof.
- [ ] Obtain release-owner approval of the exact source/asset scope and explicit
      proc-macro-error maintenance-warning decision; no tag/publication is approved.

- [x] Storytelling M0 PR #1 and migration-map PR #2 are merged. The finite,
      read-only M1-01 importer PR #7 is also merged; its checks and exact SHAs
      are recorded in the [independent Storytelling release track](docs/roadmap/incremental-release-train.md).
- [x] Prove the bounded, read-only OpenFilm → Storytelling compatibility capsule
      for [Issue #138](https://github.com/bynanci/open-film/issues/138): the existing
      exporter feeds the pinned SDK's finite profile without stripping unsupported
      fields. Local verification passes 94 exporter/unit tests and 11 actual-SDK
      application/CLI tests, including unchanged project, Catalog and source bytes;
      see the [scope and evidence](docs/validation/storytelling-compatibility-138.md).
      The [PR #149 gate record](https://github.com/bynanci/open-film/pull/149)
      tracks final-head verification. This is not production adapter or
      FilmCraft acceptance: production approval/execution/quiescence/retry remain
      open. Do not enable an M4 writer/authority switch or reimplement completed
      M1-02/M1-03 from bounded proofs. Keep versions independent.

- [x] **Native evidence tooling:** add bounded runtime intake and target staging,
      plus versioned pre-trust identity, final-byte snapshots and external candidate
      binding to reconstructed contribution/security evidence. See the
      [candidate receipt validation](docs/validation-native-candidate-receipt.md)
      and [runtime intake evidence](docs/runtime-intake-141.md). Fixture checks
      remain record-only and do not authorize distribution.
- [x] Record the [retained runtime provenance and obligations](docs/validation/runtime-provenance-141.md)
      for 50 existing inputs; keep actual target binaries, complete source/license
      closure, OS trust and redistribution approval open.
- [x] Prepare the original 2,000-asset synthetic benchmark fixture from an owned
      frozen-lock installation and verify its source/manifest/inventory identities;
      see [preparation evidence](docs/validation/native-benchmark-preparation-145.md).
      This is not a native warm/cold, memory/soak or hardware measurement.
- [x] Execute and independently verify one authenticated, fresh original-path
      hosted source replay after [PR #152](https://github.com/bynanci/open-film/pull/152)
      merged. All six policy identities, 16 raw pins, unchanged original ZIP and
      complete replayed admission matched; `distributionApproved: false`.
      See the [2026-11-12 evidence and snapshot-history limitation](docs/validation/issue-followup-2026-11-12.md).
      This checks only source replay; final native receipts and OS gates remain open.
- [ ] **D7B / M7E:** issues [#140](https://github.com/bynanci/open-film/issues/140)
      and [#141](https://github.com/bynanci/open-film/issues/141) remain open for
      actual reviewed runtime inputs, rights/license and security closure, signed
      final bytes and complete reviewed candidate receipts. Issues
      [#142](https://github.com/bynanci/open-film/issues/142) and
      [#143](https://github.com/bynanci/open-film/issues/143) remain open for
      actual Windows/macOS trust and installation/lifecycle observations; see
      [native distribution validation](docs/validation-native-installer.md).
- PR [#120](https://github.com/bynanci/open-film/pull/120) merged on
  2026-11-06; Tokio is now 1.53.3 and RUSTSEC-2026-0386 is no longer reported
  by that audit. PR #128 now repairs the actual GLib source; both registry
  controls still expose the affected upstream version. The source-aware proof
  accompanies the path-crate audit, and proc-macro-error remains an owner
  maintenance-review item. See the dated
  [native validation](docs/validation-native-installer.md).
- [x] Resolve the tracked GLib 0.18.5 / `RUSTSEC-2024-0429` source-remediation gate with
      compatible upstream remediation, transitive reachability review and re-audit;
      keep `proc-macro-error` maintenance notices visible. Branch
      `codex/native-glib-0429-current` carries an exact, provenance-pinned backport
      of upstream gtk-rs commit `05dff0ee`; its source and Linux dependency-closure
      checks, optimized native controls, fresh same-DB audits and independent technical
      reviews passed. PR #128 merged at `23ac0a2`; release candidate `54534d8` has
      its own complete security evidence. Installer/workstation and release-owner
      decisions remain separate.
- [ ] Validate clean-machine installation and first use without developer tools,
      including CJK and long paths on supported Windows/macOS targets.
- [x] Extend the existing workstation record to schema 1.1 with separate
      Windows/macOS/Linux installer gates; preserve read-only validation of
      historical 1.0 records and begin every new gate as `not-run`.
- [ ] Validate signing/notarization, supported manual updates, failed-update
      rollback and uninstall behavior that preserves projects.
- [x] Complete macOS dead-owner recovery evidence for process identity, PID reuse
      and permissions via `kern.bootsessionuuid` ([validation](docs/validation-macos-dead-owner.md)). Windows recovery has a separate implemented path.
- [ ] Complete native first-open repetitions and the one-hour memory/workflow
      observations required by the performance plan.

References: [native installer](docs/native-installer.md),
[native performance](docs/native-performance.md),
[native validation](docs/validation-native-installer.md),
[media-analysis recovery](docs/media-analysis-recovery.md).

## Workstation verification

These items require observations on the target system. Generated fixtures,
format parsers and hosted CI provide useful evidence but do not complete them.
Record the application revision, operating system, tools, media description and
actual result using the [workstation checklist](docs/workstation-qa.md).

- [ ] **Multi-source M7:** native file/folder pickers, permissions, repeated
      selections, external drives, cancellation and relocation on Windows/macOS.
- [ ] **Issue #7 / Windows follow-up:** reproduce the relevant workflow on the
      target physical Windows workstation, including the issues #66–#68 recovery path.
- [ ] **NLE handoff:** actual Resolve import, playback, relinking, saved-project
      reopen, captions, color, audio channels and effect limitations.
- [ ] **Camera media:** representative Pixel HDR/Motion Photo and Insta360
      source files, including unsupported/raw-source behavior.
- [ ] **Playback and display:** keyboard, trackpad, touch/pen, high-DPI layouts,
      calibrated displays/projectors and sustained 4K/GPU workloads.
- [ ] **Audio and providers:** real speech/transcription quality, optional TTS
      pronunciation/latency/cost behavior, multi-track listening and hardware latency.
- [ ] **Creative output:** photo/depth edges, titles, movement, pacing and story
      decisions assessed on representative films by a person.
- [ ] **Project portability:** cross-machine Collect Media, fonts, external media,
      filesystem permissions and interrupted-operation recovery.

Tracking: [Issue #7](https://github.com/bynanci/open-film/issues/7),
[Resolve procedure](docs/resolve-workstation-qa.md),
[multi-source validation](docs/validation-multi-source-analysis.md),
[Collect validation](docs/validation-collect-coverage.md).

## Later work

These items remain open, but are not prerequisites for every current editing
change. Discuss their scope before implementation.

- [x] Balance the full browser suite with deterministic per-test shard lists
      ([PR #131](https://github.com/bynanci/open-film/pull/131)). The original
      exact-head Verify run [42407414566](https://github.com/bynanci/open-film/actions/runs/42407414566)
      passed 358 cases on its then-current base; it remains historical evidence.
      After synchronizing with main `07016dac8c23148181f7d36a402a86d8d8bc0533`,
      `pnpm test:browser-partition` verified the current 363-case inventory with
      shard sizes 61/61/61/60/60/60 and Transcript Productivity spread 4/4/5/5/4/4.
      The earlier hosted comparison showed the longest browser test step fall
      from 8m05s to 6m35s versus run 42403889374, while keeping one worker,
      existing timeouts, assertions and zero retries. PR #131 is merged; subsequent main `08e38b6` verifies the 363-case
      inventory. The earlier timings remain historical evidence. See the
      [E2E shard validation](docs/validation-ci-pages-e2e.md).
- [ ] Executable plugin discovery/loading beyond built-in registration and SDK
      contracts. Keep the existing data-only preset format available.
- [ ] Additional local vision, embedding and language-provider implementations;
      optional local transcription already has an implementation.
- [ ] Archive-scale incremental analysis and background worker scheduling.
- [x] Reproducible 10,000–100,000-row Catalog benchmark for chronological paging,
      search, lookup, summary scans and seeding ([method, results and limits](docs/validation-catalog-scale-benchmark.md)).
      This is Catalog evidence, not end-to-end support at those library sizes.
- [x] Add versioned keyset cursors for chronological Catalog pages and use them
      in the main Desktop library, paged photo pickers, Motion video
      picker, server API and CLI. Keep legacy offset callers compatible; see the
      [Catalog scale measurements](docs/validation-catalog-scale-benchmark.md)
      and [fcc00131 check review](docs/validation-fcc00131-follow-up.md).
- [x] Add semantics-preserving indexing for literal substring name/tag search.
      Short, escaped and NUL queries retain the current `LIKE` behavior; exact
      tag checks preserve tag boundaries. Schema v7 migration, query plans and
      10,000/100,000-row results are recorded in the
      [Catalog search validation](docs/validation-catalog-search-index.md).
- [x] Bound additional descriptor and option memory in the Story Template and
      PhotoDepth pickers with lazy keyset pages. Each selector displays one
      200-row page and keeps only selected dependencies between pages; the
      existing Editor document asset pool is unchanged. See the
      [picker scale validation](docs/validation-catalog-scale-benchmark.md).
- [x] Defer non-English UI message catalogs until the locale is selected.
      English remains the fallback; current build emits separate Traditional
      Chinese and Japanese chunks. See the
      [locale loading validation](docs/validation-desktop-locale-loading.md).
- [x] Lazy-load infrequently used Desktop workspaces. The current entry and
      static JavaScript preloads total 556.04 kB minified / 181.11 kB gzip, and
      the synthetic browser flow measured 254 ms to a usable Edit view. Lazy
      editor flush and native planner-draft recovery wait for their async
      components. See the
      [desktop lazy workspace validation](docs/validation-desktop-lazy-workspaces.md).
- [ ] Measure cold startup from signed Windows/macOS installer candidates and
      set an initial-workspace size target from those workstation results. The
      browser bundle and Vite navigation measurements do not satisfy this gate.
- [ ] Further NLE fidelity for transparent overlays and separately editable
      baked effects/stems, with target-editor evidence.
- [ ] Evaluate remote image-to-video adapters against verified APIs, consent,
      cost and fidelity requirements. Remote motion remains disabled today.

## Implemented foundations

The following scopes have merged implementations. Use their linked records for
what was checked and what still needs physical or editorial validation.

| Scope                                                                            | Evidence                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cut Desk precision gestures and responsive/accessibility controls (Phases 1B–1C) | [Precision gestures](docs/validation-cut-desk-phase-1b.md), [responsive workspace](docs/validation-cut-desk-phase-1c.md)                                                                      |
| Cut Desk professional edit semantics (Phase 2)                                   | [Phase 2 edit semantics](docs/validation-cut-desk-phase-2.md)                                                                                                                                 |
| Cut Desk track controls and persistence (Phase 3)                                | [Phase 3 track controls](docs/validation-cut-desk-phase-3.md)                                                                                                                                 |
| Continuity diagnostics and adjacent-scene micro-previews (D2A, D2B)              | [Continuity](docs/validation-continuity-diagnostics.md), [micro-previews and dips](docs/validation-scene-micro-preview-dips.md)                                                               |
| Source-bound rhythm evidence and accepted snap proposals (D3A2)                  | [Rhythm analysis](docs/validation-rhythm-analysis-snapping.md)                                                                                                                                |
| A-roll/B-roll coverage commands and narration retention (D3B2)                   | [PR #87](https://github.com/bynanci/open-film/pull/87), [audio policy](docs/validation-audio-policy.md)                                                                                       |
| Explicit event/person coverage and image/video balance                           | [Story Coverage validation](docs/validation-story-coverage.md)                                                                                                                                |
| Reliable-timestamp transcript ripple and cross-track retiming (D4)               | [Transcript ripple](docs/validation-transcript-ripple.md)                                                                                                                                     |
| macOS Darwin cross-process dead-owner detection & boot session verification      | [macOS dead owner recovery](docs/validation-macos-dead-owner.md)                                                                                                                              |
| Multi-source discovery, manifests, analysis and explicit adoption (D1)           | [Multi-source validation](docs/validation-multi-source-analysis.md)                                                                                                                           |
| Saved-sequence waveforms and independent J/L audio timing (D3A1, D3B1)           | [Waveforms](docs/validation-sequence-waveforms.md), [audio policy](docs/validation-audio-policy.md)                                                                                           |
| Photo presentation, bilingual titles and primary color (D5A–D5C)                 | [Photos](docs/validation-photo-film-quality.md), [titles](docs/validation-title-finishing.md), [color](docs/validation-primary-color.md)                                                      |
| Managed proxies and derived Collect packages (D6A, D6B)                          | [Proxy storage](docs/validation-proxy-storage.md), [Collect coverage](docs/validation-collect-coverage.md)                                                                                    |
| Cross-platform render QA and local declarative presets (D7A, D8)                 | [Render QA](docs/validation-render-qa.md), [presets](docs/validation-local-presets.md)                                                                                                        |
| Native packaging staging, licenses/SBOM review, and runtime closure (D7B/M7E)    | [Native validation](docs/validation-native-installer.md)                                                                                                                                      |
| Open-source IP governance, contributor provenance, and DCO enforcement           | [ADR 011](docs/adr/011-open-source-ip-governance.md), [GOVERNANCE.md](GOVERNANCE.md), [DCO.md](DCO.md)                                                                                        |
| User-pinned editing constraints                                                  | [User Pins](docs/validation-user-pins.md)                                                                                                                                                     |
| Graph, StoryPlan, Pipeline, change impact and creative variants                  | [End-to-end acceptance](docs/validation-story-graph-pipeline-acceptance.md)                                                                                                                   |
| Native captions, graphic scenes, layer editing and reviewable agent edits        | [Captions](docs/validation-native-caption-track.md), [graphics](docs/validation-graphic-scene.md), [layers](docs/validation-layer-editor.md), [agent edits](docs/validation-agent-editing.md) |
| Named Versions, export profiles, NLE handoff and media collection                | [Versions](docs/validation-named-versions.md), [exports](docs/validation-export-profiles.md), [NLE](docs/validation-nle-handoff.md), [Collect](docs/validation-collect-media.md)              |

## Keeping this list useful

For an implementation PR, update the relevant item and link the guide or
validation record. State the delivered scope and remaining work rather than
marking an entire subsystem complete after one increment. Record test commands
and results in the PR or a dated validation record; keep this page focused on
what contributors can work on next.

The previous detailed checklist is preserved in the
[2026-10-31 source snapshot](https://github.com/bynanci/open-film/blob/a88470f65ac26ac59b962227440dc57d2a5b5169/TASKS.md).
Historical validation files remain at their existing paths.
