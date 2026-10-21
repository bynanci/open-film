# OpenFilm project format

An `.openfilm` project is a directory. **Project schema 1.0.0** is independent of
the **OpenFilm application release 0.1.0**. A project refers to source media by
local file URI. Native file/folder import references originals in place; browser
file selection copies the chosen bytes into project-managed `sources/` because a
browser does not expose their original local paths. Neither route modifies originals.

Published machine-readable contracts are in
[`schemas/openfilm-project-1.0.0.schema.json`](https://github.com/bynanci/open-film/blob/main/schemas/openfilm-project-1.0.0.schema.json),
[`schemas/media-asset-1.0.0.schema.json`](https://github.com/bynanci/open-film/blob/main/schemas/media-asset-1.0.0.schema.json),
and [`schemas/plugin-manifest-1.schema.json`](https://github.com/bynanci/open-film/blob/main/schemas/plugin-manifest-1.schema.json).

```text
film.openfilm/
  project.json
  database.sqlite
  story/                 reserved for future standalone story documents
  timeline/              reserved for future standalone composition documents
  analysis/
    events.json
    duplicates.json
  sources/               browser copies or collected hash-addressed media
  fonts/                 hash-addressed fonts in a collected package
  collect-manifest.json  package hashes, scope and rights receipts only
  versions/              immutable named project snapshots and private index
    index.json           mutable labels and idempotency receipts only
    <version-id>/
      project.json       saved schema-1.0.0 manifest image
      database.sqlite    SQLite-consistent catalog image
      record.json        immutable version identity and source hashes
  cache/
    thumbnails/
    proxies/
    preview.mp4
    export-preview/        short-lived private profile-frame PNG cache
    export-work/           private staged MP4/PNG/WAV render work
  exports/
    timeline.json | timeline.otio | timeline.fcpxml | timeline.edl
    timeline.<format>.report.json
    film-<unique-id>.mp4  finished playable exports
    still-<request-id>.png + manifest
    mix-<request-id>.wav + manifest
    stems-<request-id>/    aligned role WAVs and manifest
```

SQLite may also have active `database.sqlite-wal` and `database.sqlite-shm` files.
Analysis/cache/export files appear when their workflow runs. Stories and timelines
currently live in `project.json`; creating the reserved directories does not mean
they already contain separate canonical documents.

Profile outputs are derived files. Their versioned Export Profile and receipts
bind output dimensions, frame/time or sample measurements, source hashes and
warnings without changing Composition/project settings or project schema
1.0.0. See [Export Profiles](export-profiles.md). Private previews expire and
can be regenerated; exported stills and WAVs remain in `exports/` until removed
by the user.

## Manifest and catalog

`project.json` contains `schemaVersion`, `id`, `title`, ISO `createdAt`/`updatedAt`,
`mediaLibraries`, `stories`, `timelines`, and `settings`. Each library has an ID,
URI, and display name. Settings contain width, height, and frame rate; new projects
default to 1920 × 1080 at 30 fps. Stories reference candidate/selected media IDs;
compositions contain tracks and clips referencing catalog media IDs.

Compositions may also contain additive `graphicScenes`; a scene may include a
version-1 `photoDepth` recipe tied to a root Image node. Its source, alpha mask
and optional background remain ordinary local catalog assets with content
hashes. This optional extension retains project schema 1.0.0: legacy projects
without scenes or PhotoDepth need no migration, and no derived image bytes are
embedded in `project.json`.

Optional `projectContentLocale` (`en-US`, `zh-TW`, `ja-JP`) and `filmSettings`
(`templateId`, `targetDuration`, `maxDuration`) describe new-film defaults without
creating a story. Story overrides remain possible. Template beats optionally carry
`templateBeatKey`, `titleSource` and `intentSource`; only explicit template-owned
fields change when the film language changes. Existing text with no provenance
remains verbatim. These additive fields retain schema 1.0.0 and require no catalog
migration. UI language and theme are local preferences outside the project.

The manifest is validated before atomic temporary-file replacement. The catalog
uses SQLite schema `PRAGMA user_version=2`, WAL mode, indexed fields for listing,
and JSON descriptors for extensible asset data. Version 1 migrates atomically to
version 2 by adding transcript revision/segment tables, derived-analysis caches
and source-bound manual markers. Existing asset/job descriptors are preserved;
failed migration rolls back. Large transcripts use bounded segment pages, with
words stored alongside each segment. Manifest schema remains 1.0.0. See
[media intelligence](media-intelligence.md).
User preference patches change rating/state/tags while keeping source descriptors.
Future catalog schema versions are rejected. Access through `ProjectCatalog`
preserves the schema's invariants; avoid ad-hoc SQL mutations.

Close the application before copying the project directory as a filesystem
backup; use SQLite-aware backup tooling for a live catalog. Include source media
in a separate backup. A manifest alone does not preserve catalog preferences or
grant access to missing original files.

Jobs retain their legacy URI/stage/message diagnostics and may also store a stable
error `code`, string/number `params`, and `detail` for localized recovery messages.

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

## Named versions

The optional `versions/` directory is application-owned data outside project
schema 1.0.0 and catalog schema v5. Projects without it open normally. Version
creation captures the saved manifest and a bounded catalog image while the
catalog writer is excluded; it validates the SQLite schema, integrity and
foreign keys before staging and publishing the package. Snapshot metadata and
hashes do not copy source media or expose absolute source URIs through API/CLI
records. Names and descriptions live in the index and can change without
rewriting a saved version. The store has explicit count and byte caps and does
not silently prune versions.

Restore validates the selected manifest/catalog/source fingerprints, current
revision and locks, then first creates a named recovery checkpoint. Manifest
publication runs in the catalog restore transaction; a small private journal
rolls back to the checkpoint when startup detects an interrupted publication.
The current project manifest and catalog are replaced together, and editor
snapshots are invalidated. This does not restore cache/exports or originals and
does not become session Undo/Redo. See [Named Versions](named-versions.md) for
the full lifecycle and failure behavior.

Browser-managed copies record a validated source-relative path and their previous
managed URI under `openfilm.managedSource`. On moving the project, opening it
rebases only assets still pointing at their managed source; an explicitly relinked
external file stays external. IDs and original provenance remain stable. Source
paths must remain within `sources/`; project cache or arbitrary metadata paths are
never imported as managed media.

Collect Media packages use the same managed-source boundary. Their optional
`collect-manifest.json` records selected Stories/Compositions, relative paths,
content hashes/sizes, required font bindings, explicit rights declarations and
digests of original URIs. The project catalog contains only referenced assets
and their selected transcript data; unrelated Library assets, caches, jobs,
provider credentials and named-version snapshots are not included. Each distinct
source byte sequence is stored once beneath `sources/<hash-prefix>/`; asset URIs
remain unique and opaque while their `openfilm.managedSource.relativePath` points
to the shared source bytes. Font files and their resolver bindings are stored in
`fonts/` and checked by hash when a collected project opens. These package
receipts live outside schema 1.0.0 and catalog schema v5; projects without them
continue to open as before. See [Collect Media](collect-media.md) for the
directory/ZIP and Verify contract.

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

## Native installer storage separation

The M7E RuntimeManifest and bundled executables are app installation resources,
not project data. Runtime staging and installer packaging do not copy or migrate
project directories. First-run checks use app-data working storage. Manual app
rollback preserves projects and relies on existing project/catalog compatibility
checks; unsupported versions are refused rather than rewritten. See
[Native Installer](native-installer.md).
