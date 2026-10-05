# Changelog

Changes use release versions; the project schema has its own version.

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
