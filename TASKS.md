# OpenFilm development tasks

This is the current contributor-facing work list. [ROADMAP.md](ROADMAP.md)
explains the direction; [v1.0 readiness](docs/roadmap/v1-readiness.md) defines the
release requirements. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting a
substantial change, and check existing issues or pull requests to avoid duplicate
work.

Status reviewed against
[`main`](https://github.com/bynanci/open-film/commit/main)
on 2026-11-01. The latest published source release remains **v0.4.0**.

- An unchecked item is unfinished work or missing verification.
- A checked item identifies an implemented scope, not a blanket release or
  hardware certification.
- Existing milestone IDs are retained so design documents and implementation
  history remain easy to follow.

## Editing and story workflow

### Professional Cut Desk

- [ ] **Phase 4:** finish the remaining finishing interactions and physical workstation checks. Reuse the existing proxy, sequence-waveform and audio-policy implementations.

Phases 1A–1C, Phase 2 (Roll, Slip, Slide, Insert, Overwrite, Lift, Ripple Delete, Batch edits) and Phase 3 (track controls: target, lock, mute, solo, visibility & persistence) have merged implementations, including precision zoom/pan, snap-bypass gestures, responsive monitor layouts and accessibility controls.
See the [Cut Desk guide](docs/professional-cut-desk.md),
[approved design](docs/superpowers/specs/2026-10-26-professional-cut-desk-design.md),
[Phase 1B validation](docs/validation-cut-desk-phase-1b.md),
[Phase 1C validation](docs/validation-cut-desk-phase-1c.md),
[Phase 2 validation](docs/validation-cut-desk-phase-2.md), and
[Phase 3 validation](docs/validation-cut-desk-phase-3.md). Physical interaction
and workstation checks remain in the verification section below.

### Story and editing follow-up

- [ ] Connect and verify the remaining desktop/API review-and-apply workflows
      for the continuity, adjacent-scene micro-preview, rhythm and transcript
      ripple services. The dip-transition selector is already available; a merged
      application service alone does not establish a complete user workflow.
- [ ] Implement source-bound onset/downbeat/phrase landmark extraction and
      validate its quality on representative music. The current rhythm service
      stores and consumes supplied evidence.
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

- [x] **D7B / M7E:** complete audited runtime inputs, dependency/security review,
      license notices and the remaining native distribution requirements ([validation](docs/validation-native-installer.md)).
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
- [ ] Reproducible 10,000–100,000-asset performance benchmarks before advertising
      support at those scales.
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
