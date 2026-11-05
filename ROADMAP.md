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

The status below was reconciled against `main` at
[`e3f94f9`](https://github.com/bynanci/open-film/commit/e3f94f9cda161a3f955275a1a77f5f13d2bf7834)
on 2026-11-05. This branch candidate adds durable silence Jobs and HTTP routes;
that work remains a PR candidate until reviewed and integrated. A merged
implementation, an automated check and a physical workstation test describe
different evidence. Feature guides and validation records identify their limits.

## Current focus

### Add reviewed local media-intelligence workflows

The 2026-11-04 CLI/application slice and the 2026-11-05 durable Job/API candidate
add source-bound low-energy analysis, restart-safe review and explicit Apply.
They reuse FFmpeg, existing SQLite reservation and owner recovery, the
`SilenceService` and one TimelineEditor. Analysis never automatically edits the
Composition. Affected clips with local audio automation fail closed before a
Review is published until ripple remapping is proven. The candidate remains a
PR until reviewed; the desktop Review UI and full media/workstation gates remain
open. No Auto-Editor runtime or eleven upstream tools/models are installed.

Next slices are desktop review and optional providers whose quality, clocks,
runtime costs and artifact rights are verified.
Existing scene/rhythm analysis, primary-color adjustment, role-based stems and
GraphicScenes remain the foundation. See the
[eleven-project integration reference](docs/en/media-intelligence-integrations.md),
[繁體中文](docs/media-intelligence-integrations.md) and
[ADR 012](docs/adr/012-reviewed-media-intelligence.md).

### Make the everyday editing workflow dependable

Build on the completed Professional Cut Desk Phase 1A–1C implementations. Finish
the remaining Phase 2–4 editing operations, track/audio controls and finishing
interactions while preserving one saved Composition across General and Expert
modes, predictable selection, user pins, history and recovery.

Source/Record transport, sequence waveforms, independent audio timing, precision
gestures and responsive monitor layouts already have implementations. Remaining
work should extend those features rather than introduce a second timeline. See
the [Cut Desk guide](docs/professional-cut-desk.md),
[precision-gesture validation](docs/validation-cut-desk-phase-1b.md) and
[responsive-workspace validation](docs/validation-cut-desk-phase-1c.md).

### Make story decisions easier to review

Build on the existing Story Graph, authored StoryPlan, Pipeline and creative
variants. Continuity diagnostics, adjacent-scene micro-previews, rhythm proposals,
A-roll/B-roll coverage and transcript ripple services now have merged
implementations. Their guides and validation records describe the delivered
scope; broader workstation and editorial verification still matters.

Further work should make those decisions useful in complete editing workflows,
cover remaining event/person and media-balance constraints, explain the evidence
behind suggestions and preserve the user's explicit choices. See the
[implemented foundations and open tasks](TASKS.md) for current ownership and
evidence.

### Finish distribution and real-world verification

Complete the native runtime, dependency and license review, then validate
installation, first launch, updates, rollback and uninstall on the target
platforms. Confirm camera files, external drives, audio playback, display
behavior and supported NLE handoffs on actual workstations.

The [installer guide](docs/native-installer.md),
[workstation checklist](docs/workstation-qa.md) and
[Issue #7](https://github.com/bynanci/open-film/issues/7) describe the outstanding
evidence. CI results do not replace those observations.

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
- Archive-scale analysis and background scheduling, plus measured Desktop
  workspace code splitting. Chronological cursor paging, literal substring
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
