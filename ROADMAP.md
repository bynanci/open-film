# OpenFilm roadmap

OpenFilm helps people turn a collection of photos, video and audio into a story
and an editable film. Development focuses on a reliable local workflow, clear
editing decisions and portable projects.

This page describes the project direction. See [TASKS.md](TASKS.md) for current
work and [v1.0 readiness](docs/roadmap/v1-readiness.md) for release criteria.
Suggestions and contributions are welcome through [GitHub Issues](https://github.com/bynanci/open-film/issues)
and the [contributing guide](CONTRIBUTING.md).

## Release status

| Channel                                                            | Status                          | What to expect                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [v0.4.0](https://github.com/bynanci/open-film/releases/tag/v0.4.0) | Latest published source release | A tagged source checkout; see its release notes for the included features.                                            |
| `main`                                                             | Active development              | Additional features and fixes that have not been published in a stable release.                                       |
| Native installers                                                  | In progress                     | Packaging tools exist, but distributable installers still require platform, dependency and installation verification. |
| v1.0                                                               | Release goal                    | Published when the documented readiness criteria are met; the package version alone does not establish a release.     |

The Silence scope below was checked against main
[`d332fb3265077ca08f218f6ba9b6c65d2519eaa2`](https://github.com/bynanci/open-film/commit/d332fb3265077ca08f218f6ba9b6c65d2519eaa2)
on 2026-11-06. Durable Jobs and Desktop Review are merged in PRs #107/#108.
Rendered audition is merged in PR #111. Physical workstation and listening
acceptance remain separate gates.

## Current focus

### Bring the Tobi-ishi identity into everyday tasks

The current UI candidate shares warm stone tokens and original angular surfaces,
removes duplicate General-mode progress controls, and gives Inspector categories
keyboard tabs with essential controls first. Script/direction disclosure and
Import/Fit/Preview/Relink quick actions reuse existing save, review and ownership
guards. This is a presentation and workflow refinement over the same project,
Composition and processing services. Candidate checks and remaining gates belong
in [TASKS.md](TASKS.md); [design rationale](docs/adr/tobiishi-surfaces.md) records
the shared application/site boundary.

### Add reviewed local media-intelligence workflows

The 2026-11-04 CLI/application slice and 2026-11-05 durable Job/API PRs add
source-bound low-energy analysis, restart-safe review and explicit Apply.
They reuse FFmpeg, existing SQLite reservation and owner recovery, the
`SilenceService` and one TimelineEditor. Analysis never automatically edits the
Composition. The desktop Precision Review UI and read-only before/after audition
through the existing Record mix are merged. The Audio Automation Ripple
implementation in [PR #114](https://github.com/bynanci/open-film/pull/114) adds a
versioned 48 kHz clock map for gain/fade/ducking preservation through reviewed
ripple and direct split. Incompatible sample spans, J/L timing and mapped
source/tempo changes fail closed. Explicit envelope reset and original-source
Collect preserve reviewability; Record also bounds the retained DSP history.
Complex-graph deterministic rounding is validated through actual FFmpeg contexts
and unchanged Windows pixel probes. The PR records final review and CI results.
Actual-media listening and workstation gates remain
open. No Auto-Editor runtime or eleven upstream tools/models are installed.

Next slices are hosted validation and integration review for the automation
clock, followed by optional providers whose quality, timing, runtime costs and
artifact rights are verified.
Existing scene/rhythm analysis, primary-color adjustment, role-based stems and
GraphicScenes remain the foundation. See the
[eleven-project integration reference](docs/en/media-intelligence-integrations.md),
[繁體中文](docs/media-intelligence-integrations.md) and
[ADR 012](docs/adr/012-reviewed-media-intelligence.md).

### Make the everyday editing workflow dependable

Professional Cut Desk Phases 1A–1C, Phase 2 editing operations and Phase 3 track
controls have merged implementations. Phase 4A scopes/comparison and Phase 4C
shortcut profiles have also merged. Remaining Phase 4 work is split into
deterministic animation (4B), long-form workstation evidence (4D), contract-led
compound editing (4E) and evidence-led multicamera (4F). Preserve one saved
Composition across General and Expert modes, predictable selection, user pins,
history and recovery.

Source/Record transport, sequence waveforms, independent audio timing, precision
gestures, responsive monitor layouts, source scopes and shortcut profiles
already have implementations. Remaining work should extend those features
rather than introduce a second timeline. See the [Cut Desk guide](docs/professional-cut-desk.md),
[precision-gesture validation](docs/validation-cut-desk-phase-1b.md) and
[responsive-workspace validation](docs/validation-cut-desk-phase-1c.md).

Cut Desk Phase 4B is progressing in separate reviewable stages: the shared
frame-time contract is draft PR [#125](https://github.com/bynanci/open-film/pull/125),
and visual keyframes are draft PR [#126](https://github.com/bynanci/open-film/pull/126)
stacked on it. Speed ramps remain gated on source-mapped caption/audio/rhythm
consumers and an explicit audio policy. See the [4B contract evidence](docs/validation-cut-desk-phase-4b-time-contract.md)
and [visual-keyframe validation](docs/validation-cut-desk-phase-4b-visual-keyframes.md).

### Make story decisions easier to review

Build on the existing Story Graph, authored StoryPlan, Pipeline and creative
variants. Continuity diagnostics, adjacent-scene micro-previews, rhythm proposals,
A-roll/B-roll coverage and transcript ripple services now have merged
implementations. Their guides and validation records describe the delivered
scope; broader workstation and editorial verification still matters.

Explicit per-beat event/person coverage and photo/video balance constraints are
now available from the Story Graph Inspector and preserved through StoryPlan
preview and acceptance. Solver hard constraints protect selected media, locks,
and User Pins; infeasible plans fail without rewriting them. See the
[Story Coverage validation](docs/validation-story-coverage.md) and
[implemented foundations and open tasks](TASKS.md) for evidence and limits.
Further work should explain the evidence behind suggestions and continue
professional editorial review without inferring identity or overriding choices.

### Finish distribution and real-world verification

Complete the native runtime, dependency and license review, then validate
installation, first launch, updates, rollback and uninstall on the target
platforms. Confirm camera files, external drives, audio playback, display
behavior and supported NLE handoffs on actual workstations.

The [installer guide](docs/native-installer.md),
[workstation checklist](docs/workstation-qa.md) and
[Issue #7](https://github.com/bynanci/open-film/issues/7) describe the outstanding
evidence. CI results do not replace those observations.

The current native-security candidate patches Tokio to `1.53.3` for
`RUSTSEC-2026-0386`; GLib `RUSTSEC-2024-0429`, the unmaintained proc-macro
notice, reviewed runtime inputs and all workstation gates remain open. See the
[candidate audit evidence](docs/validation-native-installer.md#2026-11-06-tokio-patch-candidate).

## Foundations available on main

These are existing development-branch capabilities, not a list of new v0.4.0
features. Their guides describe supported behavior and remaining limits.

| Area       | Existing foundation                                                                            | Documentation                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Media      | Multi-source import, scoped analysis, source provenance, proxies and relinking                 | [Import and analysis](docs/roadmap/multi-source-analysis.md), [media portability](docs/en/media-portability.md)                             |
| Story      | Story Graph, authored outlines, reviewable proposals and rough-cut generation                  | [Story authoring](docs/story-arc-authoring.md), [story workflow](docs/en/product-workflow.md)                                               |
| Editing    | Non-destructive clip and layer editing, captions, photo presentation, color and audio controls | [Precision editing](docs/en/precision-editing.md), [Cut Desk](docs/professional-cut-desk.md)                                                |
| Iteration  | Named Versions, creative variants, A/B review and Pipeline artifact reuse                      | [Versions](docs/named-versions.md), [variants](docs/validation-creative-variants.md), [Pipeline](docs/validation-pipeline-orchestration.md) |
| Delivery   | MP4 and interchange output, output profiles, Visual QA and Collect Media                       | [Export profiles](docs/export-profiles.md), [NLE handoff](docs/nle-handoff.md), [Collect Media](docs/en/collect-media.md)                   |
| Extensions | Local declarative presets, provider ports and optional local/BYOK integrations                 | [Presets](docs/local-presets.md), [provider generation](docs/provider-generation.md)                                                        |

Existing functionality remains free and open source. The basic workflow runs
locally without a cloud account. Optional external providers have their own
requirements and charges, and require explicit consent.

## Longer-term work

These directions are outside the immediate release work and have no committed
release date:

- Broader source and provider integrations, including additional local analysis
  implementations.
- Archive-scale analysis and background scheduling, plus native cold-start
  measurements for the existing Desktop locale/workspace code splitting.
  Chronological cursor paging, literal substring
  search indexing, and lazy Story Template / PhotoDepth selectors are implemented;
  see the [Catalog scale validation](docs/validation-catalog-scale-benchmark.md)
  and [Catalog search validation](docs/validation-catalog-search-index.md).
- Executable extension discovery and loading beyond the current SDK and built-in
  registration. The local data-only preset registry already exists.
- Additional interchange fidelity where the target editor and format can support
  it, backed by actual import and playback checks.

Cloud collaboration, hosted generation and a plugin marketplace are not current
availability promises. Proposals should identify a user problem, explain how
existing capabilities fall short and state the maintenance cost.

## How priorities are chosen

Reliability, source-media safety and project compatibility come first. New work
should improve a blocked step in the filmmaking workflow, keep decisions
reviewable and reuse existing application services. Performance and compatibility
claims need reproducible evidence.

For a substantial change, start with an issue describing the workflow and the
expected result. Documentation fixes, translations, reproducible bug reports and
small focused fixes are useful contributions at every stage.

## Development history

Detailed feature guides and dated validation records remain in [docs](docs/index.md).
The previous chronological roadmap is preserved in the
[2026-10-31 source snapshot](https://github.com/bynanci/open-film/blob/a88470f65ac26ac59b962227440dc57d2a5b5169/ROADMAP.md).
Consult that snapshot for historical PR-by-PR notes; use this page and
[TASKS.md](TASKS.md) for current direction and work.
