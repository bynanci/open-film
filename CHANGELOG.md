# Changelog

Changes use release versions; the project schema has its own version.

## Unreleased — 0.3.1 Transcript Productivity

- Added shared transcript commands, revisions, independent Undo/Redo, paged
  search/replace and durable autosave in Edit's Transcript mode.
- Preserve original recognition evidence and exclude text-edited word timing
  from precision snapping. Re-transcription cannot overwrite concurrent edits.
- Added portable project and user-owned global terminology, offline glossary
  suggestions and revision-bound, auditable Accept/Skip review actions.
- Added optional consented LanguageProvider batches with partial-result
  persistence, cancellation, retry and strict text-only context boundaries.
- Catalog v3 migrates v1/v2 transactionally; project/composition schema is unchanged.

Real ASR/GPU/camera quality, native installation and actual Resolve import remain
manual gates. Captions, vision, reframing and derived films remain deferred.

## Unreleased — Real Editing Workflow

- Added a story-first graphical timeline with clip/beat editing, locks, scoped
  regeneration, duration feedback, explainable fit, undo/redo and recoverable
  debounced autosave.
- Added transactional single/folder relinking, missing/offline states, stable
  logical-volume references and project-relative cache recovery.
- Added Pixel and Insta360 source adapters, explicit raw360 capability limits,
  experimental Motion Photo detection and tested HEVC10-bit HLG/PQ SDR previews.
- Added a generated CC0 Proposal reference dataset, real browser editing/relink
  regressions, source-adapter tests and precise media failure messages.
- Added the complete Proposal reference guide and browser workflow: selection,
  manual edits, protected beat regeneration, duration fitting, actual preview,
  close/reopen and official-parser-validated OTIO export.
- Added Resolve preparation fixtures, source/hash/bounds and official OTIO
  read/write/read validation, and visible export compatibility reports. Advanced
  edits remain exact OpenFilm metadata and require manual recreation in the NLE;
  actual Resolve import is unverified.
- Fixed reused source-path identity collisions, stale device classifications,
  empty preview requests and failed render jobs remaining queued.

Project schema 1.0.0 remains compatible: clip locks are optional; portable and
device provenance uses existing metadata extension fields. Native disk mounting,
real camera variants and NLE appearance are tracked separately from parser tests.

## 0.1.0 — First vertical slice

- Added portable media, story, event, composition, project, and plugin contracts.
- Added versioned `.openfilm` projects, strict validation, a documented draft
  migration, SQLite catalog persistence, and durable jobs.
- Added local folder import with FFprobe, ExifTool/system or vendored Perl
  metadata extraction, capture provenance, SHA-256 fingerprints, perceptual
  fingerprints, thumbnails, proxies, cancellation, and restart handling.
- Added duplicate/event analysis, explainable offline scoring, generic story
  creation, an external Proposal Film template, and constrained composition.
- Added non-destructive FFmpeg preview rendering and JSON/OTIO/FCPXML/EDL timeline
  exports with explicit rejection of unsupported edits.
- Added a headless CLI, loopback application API, Vue media/story workspace, and
  optional Tauri shell with folder selection and local-service integration.
- Added generated fixtures, domain/integration/browser tests, development scripts,
  architecture documentation, and open-source policies.

The story scope is limited to 2,000 candidates. Native installer packaging,
large-library benchmarks, a full graphical timeline editor, and production NLE
round-trip certification remain outside this initial release.
