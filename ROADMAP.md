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

## Next — Reliability and delivery

The Real Editing Workflow round has added a story-first graphical timeline,
non-destructive clip and beat commands, explicit locks, explainable duration
fitting, undo/redo and durable autosave with conflict recovery. Browser tests
exercise editing, preview rendering and reopening. The next implementation slice
includes verified single/folder media relinking, missing/offline state and portable
cache references. Device adapters, the Proposal reference workflow and independent
OTIO/Resolve preparation follow.

- Package the native shell with a verified local Node service and media runtime;
  test installation and updates on supported operating systems.
- Exercise actual import/export round trips in Resolve, Premiere, and Final Cut;
  expand each exporter only with tested edit preservation.
- Add relinking and volume-aware media references for moved libraries.
- Improve metadata corrections, timezone handling, sidecar ingestion, and event
  editing without hiding uncertainty.
- Make export/analysis jobs and renderer cancellation consistently visible in the
  desktop, and add timeline edit controls for existing model operations.
- Validate representative camera codecs, HDR/orientation behavior, and meaningful
  360-media workflows; a `.360` media type alone is not stitching or reframing.

## Then — Extensibility and scale

- Add a discoverable plugin/template registry with compatibility checks and
  documentation, plus device/source adapters beyond local folders.
- Add more general event/person coverage and media-balance constraints, together
  with explainable infeasibility reporting.
- Add optional local vision, embeddings, transcription, and language providers;
  keep remote integrations explicit and consented.
- Benchmark 10,000–100,000-asset catalogs with published fixtures, memory/latency
  measurements, incremental analysis, background workers, and broader story
  scoping. No such scale claim is made by 0.1.0.

Professional color grading, complex GPU effects, cloud collaboration, marketplaces,
and mobile editing remain deferred. Milestones are priorities, not release dates.
