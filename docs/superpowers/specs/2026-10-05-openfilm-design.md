# OpenFilm v0.1 design

The user's complete specification is in `docs/PROJECT_BRIEF.md`. The user
explicitly authorizes reasonable technical decisions and continuous implementation;
design and plan review are recorded here without adding an approval stop.

OpenFilm is an offline media catalog and story composition engine. Originals are
referenced by file URI and never modified or copied into projects. A project is a
versioned `.openfilm` directory with a JSON manifest, SQLite catalog, editable
story/composition JSON, and regenerable cache. UI and CLI use an application
service; only adapters use Node filesystem, SQLite, FFprobe/FFmpeg, or ExifTool.
Core models and algorithms remain browser-portable TypeScript.

The first complete vertical workflow creates a project, imports generated media,
resolves timestamp provenance, fingerprints duplicates, generates thumbnails and
video proxies, groups events, rates/selects assets, applies a plugin story template,
solves duration constraints, previews a real MP4, exports editable timelines, and
reopens the project. Template-specific vocabulary lives only in its template.

Alternatives considered: Rust-only domain would limit a portable TS SDK; a remote
backend would violate the offline default; a local Node adapter is selected for
the first milestone with `node:sqlite`, and a Tauri shell provides the native UI
boundary. Runtime dependencies are FFmpeg/FFprobe; ExifTool is optional with a
documented fallback. Desktop development uses a loopback API and Vue/Vite.

The UI is a content-first film workspace: Library, Stories, Timeline, Export.
It shows real state and explicit progress/errors, paginates assets, exposes
favorite/rejected/locked/rating controls and editing selections, and does not
require cloud or AI. Remote providers are optional contracts with explicit consent.
API requests are restricted to loopback and same configured UI origins.

Validation includes domain edge cases, project schema/migration rejection, actual
SQLite reopening, generated images/video, originals' hash invariance, bad-file
isolation, import restart/cancellation, solver infeasibility, real rendered MP4
duration, OTIO/FCPXML structure, and a browser journey. Future color grading,
complex transitions, cloud collaboration, marketplace, and mobile editing remain
outside v0.1. Native build prerequisites will be installed where supported;
unavailable host capabilities are reported with evidence, never marked passed.
