# OpenFilm project format

An `.openfilm` project is a directory. **Project schema 1.0.0** is independent of
the **OpenFilm application release 0.1.0**. A project refers to source media by
local file URI; it does not copy originals into its directory.

Published machine-readable contracts are in
[`schemas/openfilm-project-1.0.0.schema.json`](../schemas/openfilm-project-1.0.0.schema.json),
[`schemas/media-asset-1.0.0.schema.json`](../schemas/media-asset-1.0.0.schema.json),
and [`schemas/plugin-manifest-1.schema.json`](../schemas/plugin-manifest-1.schema.json).

```text
film.openfilm/
  project.json
  database.sqlite
  story/                 reserved for future standalone story documents
  timeline/              reserved for future standalone composition documents
  analysis/
    events.json
    duplicates.json
  cache/
    thumbnails/
    proxies/
    preview.mp4
  exports/
    timeline.json | timeline.otio | timeline.fcpxml | timeline.edl
    timeline.<format>.report.json
```

SQLite may also have active `database.sqlite-wal` and `database.sqlite-shm` files.
Analysis/cache/export files appear when their workflow runs. Stories and timelines
currently live in `project.json`; creating the reserved directories does not mean
they already contain separate canonical documents.

## Manifest and catalog

`project.json` contains `schemaVersion`, `id`, `title`, ISO `createdAt`/`updatedAt`,
`mediaLibraries`, `stories`, `timelines`, and `settings`. Each library has an ID,
URI, and display name. Settings contain width, height, and frame rate; new projects
default to 1920 × 1080 at 30 fps. Stories reference candidate/selected media IDs;
compositions contain tracks and clips referencing catalog media IDs.

The manifest is validated before atomic temporary-file replacement. The catalog
uses SQLite schema `PRAGMA user_version=1`, WAL mode, indexed fields for listing,
and JSON descriptors for extensible asset data. It stores media assets and jobs.
User preference patches change rating/state/tags while keeping source descriptors.
Future catalog schema versions are rejected. Access through `ProjectCatalog`
preserves the schema's invariants; avoid ad-hoc SQL mutations.

Close the application before copying the project directory as a filesystem
backup; use SQLite-aware backup tooling for a live catalog. Include source media
in a separate backup. A manifest alone does not preserve catalog preferences or
grant access to missing original files.

## Media descriptors and editing

An asset contains its ID, `uri`, name, type, tags, state, extensible namespaced
metadata, and optional technical/capture/hash/cache information. Capture resolution
is retained under `metadata["openfilm.timestamp"]`, including original value,
source, confidence, timezone, and timezone uncertainty. Unzoned capture metadata
is represented as wall-clock UTC with lowered confidence, not as proven UTC.

Namespace additional metadata, for example `openfilm.audio.transcript`, to avoid
plugin collisions. Thumbnails and proxies are derived cache, not replacements for
the original asset URI. A file changing externally is rehashed/reinspected on
reimport, while its existing catalog ID and preference edits are retained. IDs
initially derived from a source URI remain durable after relinking. Reusing an old
source path for a different file creates a separate identity when that ID already
belongs to a relinked asset.

All `sourceIn`, `sourceOut`, `timelineStart`, `timelineDuration`, and story duration
values are seconds. Transforms, volume/speed, titles, and transitions describe
operations. They never modify the source. IDs must remain consistent across the
catalog, beat candidates/selections, and timeline clips. Optional `Clip.locked`
persists clip protection without changing schema version 1.0.0. Manual edits may
exceed a story's maximum duration; rendering requires shortening the timeline
first. Undo/redo history belongs to the open editing session and is not persisted.

## Portable source references and caches

Current asset `uri` values are absolute local `file:` URIs. Relinking is exposed
through the application, HTTP API and desktop. Portable provenance uses the
existing `metadata["openfilm.reference"]` extension:

- `originalUri`: original import location; retained across relinks.
- `contentHash` and `fileSize`: optional SHA-256 identity and byte size.
- `filename`, `mediaLibraryId`, `relativePath`: source name and library-relative
  location.
- `volumeId`: stable logical identity, not an operating-system disk identifier.
- `rootUri`: current source library root or mount path.

Relinking preserves asset IDs, user metadata, ratings, locks, stories and clip
edits. It checks candidate files again before updating all selected catalog rows
in one SQLite transaction. A known hash mismatch cannot be overridden. Relative
path, filename/size and manual legacy matches require confirmation; legacy
replacements must also satisfy media-type and existing source-duration bounds.
Current roots are stored in catalog reference metadata. Relinking does not need a
transaction spanning `project.json` and SQLite or rewrite the manifest's original
library URI.

New thumbnail and proxy references use project-relative `cache/...` paths.
Reopening a moved project recovers older absolute references that match the
application's generated cache naming convention. Original sources remain external
and may still need relinking. Missing-source and library availability are checked
at runtime, independently of stored editing revisions. Automatic physical-volume
detection is not implemented. See [media portability](media-portability.md) and
[relinking contracts](RELINK_CONTRACTS.md) for matching and remount limitations.

## Validation and migration

`validateProject` checks the current schema and structural/value constraints.
`migrateProject` supports current 1.0.0 and a documented 0.1.0 draft with identical
v1 field names; that draft may omit settings, in which case 1920 × 1080 / 30 fps
is added. It does not mutate its input or infer unversioned/unknown formats.
Unknown future versions are rejected with a useful error.

Opening a draft migrates it in memory; saving/closing persists the current
manifest. Original media is never part of a schema migration. Back up a project
before opening it with a version that introduces a format migration.

## Timeline interchange

JSON exports include schema version, full composition, referenced assets, and
settings. OTIO uses native Timeline/Stack/Track/Clip/Gap objects for cut layout,
current source file URIs, still holds, audio and source ranges at 1x. Advanced
edits—speed, volume/mute, transforms, titles, crossfades and clip locks—are retained
in OpenFilm metadata with explicit warnings, not native NLE effects. Exact
original clip fields and the complete composition are embedded. Retimed clips
use unretimed native excerpts and, when needed, labeled padding gaps to preserve
record positions; reconstruct the intended speed edit manually from metadata.
Within-track overlaps are rejected.

The application returns warnings and writes an adjacent
`timeline.<format>.report.json`; OTIO also embeds its compatibility report.
FCPXML and EDL retain their limited cut-based behavior and reject unsupported
advanced operations. JSON remains the complete model export. Official OTIO parser
read/write/read verification is separate from actual NLE behavior: DaVinci Resolve
import and playback have not been verified. See
[NLE compatibility](nle-compatibility.md) for exact feature support, metadata
locations, and manual verification steps.
