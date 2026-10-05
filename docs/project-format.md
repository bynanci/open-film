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
reimport, while its URI-based catalog ID and preference edits are retained.

All `sourceIn`, `sourceOut`, `timelineStart`, `timelineDuration`, and story duration
values are seconds. Transforms, volume/speed, titles, and transitions describe
operations. They never modify the source. IDs must remain consistent across the
catalog, beat candidates/selections, and timeline clips.

Current runtime media references use absolute `file:` URIs. Moving a source library
requires relinking support that is not yet exposed. Reserved relative/volume
reference contracts do not imply automatic relocation is implemented.

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
settings. OTIO uses a timeline/stack/track hierarchy, source time ranges, original
media URIs, and explicit gaps. FCPXML declares resources and rational source/record
times. EDL is intentionally restricted to cuts it can express. Unsupported
operations produce an error rather than a timeline missing edits; JSON retains
the complete model. See [README exports](../README.md#exports) for release limits.
