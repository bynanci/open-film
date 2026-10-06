# Roadmap

OpenFilm's north star is ownership of media, story decisions, and the final edit.
The current release establishes a useful offline workflow; later milestones should
improve that workflow without tying the portable domain to a UI, cloud, or NLE.

## 0.1 — Local story and rough cut

Implemented: projects, SQLite catalogs, local folder import, metadata provenance,
derived media, duplicate/event analysis, ratings and selection state, generic
stories, an external template, duration-constrained composition, MP4 preview,
timeline export, CLI, local API, and desktop workspace. See [TASKS.md](TASKS.md)
for the detailed release checklist.

## Real editing — Working development tree

The Real Editing Workflow round has added a story-first graphical timeline,
non-destructive clip and beat commands, explicit locks, explainable duration
fitting, undo/redo and durable autosave with conflict recovery. Browser tests
exercise editing, preview rendering and reopening. Single/folder media relinking,
missing/offline state, portable cache references, Pixel/Insta360 source adapters
and safe supported HDR previews are implemented. The generated Proposal reference
workflow and independent OTIO/Resolve preparation make these capabilities testable.

## Global product experience — Working development tree

The editing foundation is merged in PR #1. The product round adds Welcome and
guided film creation, a nonblocking workflow indicator, goal-based import/export,
story boards with separate selected/suggested memories, contextual editing and
recoverable offline-media guidance. Stable workspace IDs, structured error codes
and Vue I18n support English, Traditional Chinese and Japanese without changing
user-authored film text. A separate persisted film locale controls template-owned
defaults; legacy text stays intact. Local theme/preferences, shared visual tokens,
CJK/pseudo layouts and browser accessibility checks support the desktop experience.
See [product workflow](docs/product-workflow.md), [i18n](docs/i18n.md) and
[design system](docs/design-system.md). Exact completed gates remain in TASKS and
the [validation record](docs/validation-global-product.md) and PR checks rather
than implying hardware or real NLE certification.

## Next — Real-world verification and delivery

- Package the native shell with a verified local Node service and media runtime;
  test installation and updates on supported operating systems.
- Perform actual Resolve import QA first, including manual recreation of advanced
  edits currently stored only in OTIO metadata. Expand native effect support only
  with tested preservation; other NLEs follow later.
  The Global Product Experience preflight found no application QA evidence; the
  [Resolve record](docs/resolve-qa-record.md) remains not run.
- Validate removable volumes on Windows hardware and representative Pixel HDR,
  Motion Photo and Insta360 source files.
- Improve metadata corrections, timezone handling, sidecar ingestion, and event
  editing without hiding uncertainty.
- Validate real camera orientation/color behavior and future 360 reframing;
  source recognition alone is not stitching or optical validation.

## Then — Extensibility and scale

- Add a discoverable plugin/template registry with compatibility checks and
  documentation, plus additional device/source adapters.
- Add more general event/person coverage and media-balance constraints, together
  with explainable infeasibility reporting.
- Add optional local vision, embeddings, transcription, and language providers;
  keep remote integrations explicit and consented.
- Benchmark 10,000–100,000-asset catalogs with published fixtures, memory/latency
  measurements, incremental analysis, background workers, and broader story
  scoping. No such scale claim is made by 0.1.0.

Professional color grading, complex GPU effects, cloud collaboration, marketplaces,
and mobile editing remain deferred. Milestones are priorities, not release dates.
