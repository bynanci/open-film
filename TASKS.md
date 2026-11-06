# OpenFilm development tasks

This is the current contributor-facing work list. [ROADMAP.md](ROADMAP.md)
explains the direction; [v1.0 readiness](docs/roadmap/v1-readiness.md) defines the
release requirements. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting a
substantial change, and check existing issues or pull requests to avoid duplicate
work.

Status reviewed against
[`main`](https://github.com/bynanci/open-film/commit/d332fb3265077ca08f218f6ba9b6c65d2519eaa2)
on 2026-11-06. The latest published source release remains **v0.4.0**.

- An unchecked item is unfinished work or missing verification.
- A checked item identifies an implemented scope, not a blanket release or
  hardware certification.
- Existing milestone IDs are retained so design documents and implementation
  history remain easy to follow.

## Editing and story workflow

### Tobi-ishi workspace and control panels (2026-11-06 candidate)

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
- [ ] Obtain hosted exact-head CI before merging. Real workstation and NLE checks
      remain separate.

See the [design system](docs/design-system.md),
[layout rationale](docs/layout-refinement.md) and
[shared-surface decision](docs/adr/tobiishi-surfaces.md) and
[dated validation](docs/validation-tobiishi-control-panels-2026-11-06.md).

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
- [ ] Complete real dialogue/music listening QA and Windows/macOS workstation
      audition checks; synthetic PCM equivalence does not satisfy this gate.
- [ ] Admit additional scene/rhythm, mask/restoration, stabilization/interpolation,
      separation or browser-rendering providers only after quality, timing,
      runtime and code/weight rights checks. Reuse existing capabilities.

### Professional Cut Desk

- [x] **Phase 4A — source scopes and split-wipe comparison.** Merged in
      [PR #112](https://github.com/bynanci/open-film/pull/112). Browser scopes
      describe bounded, pre-look source samples; calibrated display, HDR and
      hardware-monitor behavior are not included. See the
      [Phase 4A validation](docs/validation-cut-desk-phase-4a-scopes.md).
- [ ] **Phase 4B — deterministic animation.** Specify and implement supported
      keyframed properties and speed ramps with arbitrary-seek evaluation and
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
- [ ] **Phase 4E — compound editing.** Start only after a versioned Composition
      contract proves the feature cannot introduce a hidden second timeline.
- [ ] **Phase 4F — multicamera.** Start only with explicit synchronization and
      source-provenance evidence.

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
- [ ] Define and implement the remaining general event/person coverage and
      media-balance constraints without changing user-pinned choices.

Continuity diagnostics (D2A), adjacent-scene previews and dip transitions (D2B),
rhythm proposals (D3A2), A-roll/B-roll coverage (D3B2) and transcript ripple edits
(D4) now have merged implementations. Their evidence and supported scope are
linked under **Implemented foundations** below. New work should build on those
services and preserve explicit review, source identity, locks and history.

Design references: [story authoring](docs/story-arc-authoring.md),
[editing contracts](docs/EDITING_CONTRACTS.md),
[seven-subsystem design crosswalk](docs/roadmap/seven-subsystem-reconciliation.md).
The crosswalk records design responsibilities; current completion status is
recorded here and in v1.0 readiness.

## Distribution and platform readiness

- [ ] **D7B / M7E:** complete audited runtime inputs, dependency/security review,
      license notices and the remaining native distribution requirements ([validation](docs/validation-native-installer.md)). Packaging tools and candidate verification are merged; signed installers and physical workstation gates remain open.
- Tokio's `RUSTSEC-2026-0386` is removed in the open PR #120 candidate by the
  lockfile-only update to patched `1.53.3`; the refreshed audit still reports
  GLib `RUSTSEC-2024-0429` and unmaintained `proc-macro-error`. This candidate
  is not merged or release-approved; see the dated evidence in the validation
  record.
- [ ] Resolve the tracked GLib 0.18.5 / `RUSTSEC-2024-0429` installer gate with
      compatible upstream remediation, transitive reachability review and re-audit;
      keep `proc-macro-error` maintenance notices visible.
- [ ] Validate clean-machine installation and first use without developer tools,
      including CJK and long paths on supported Windows/macOS targets.
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
