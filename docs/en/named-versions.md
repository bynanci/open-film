# Named project versions

Named versions are immutable, project-owned snapshots for cross-session
comparison and recovery. They are separate from the current edit session's
Undo/Redo history. Creating or restoring a version does not add a timeline or
change the project schema (`1.0.0`). A project without a `versions/` directory
opens as before.

## Version record and storage

`ProjectVersionRecord` v1 contains a stable version ID, project ID, name,
optional description, creation time, optional parent, idempotency request ID,
project revision, manifest and catalog SHA-256 hashes, SQLite schema version,
application version, and a source-reference manifest. Names and descriptions
are index metadata, so a rename cannot change the saved `project.json` or
SQLite image. Source references expose only asset ID, media type, managed versus
external kind, byte size and SHA-256; absolute file URIs remain private inside
the saved project catalog and are not copied into version API results.

Each version package contains the exact validated project manifest and a
SQLite-aware catalog image. It does not copy originals, browser-managed media,
render outputs, cache entries or credentials. Snapshot files are staged under
the project, hashed, validated, and published as a complete version directory.
The catalog snapshot copies SQLite's main file only after checkpointing its WAL
and acquiring an exclusive project lock. This uses SQLite file operations
available on the supported Node 24.14 runtime; inspection opens a private
permission-restricted temporary copy. Concurrent readers/writers cause a
retryable busy result instead of an inconsistent snapshot. The version store
has explicit count and byte bounds and never silently removes an older version.

## Compare and restore

Diffs are deterministic and identify additions, removals and changes in project
settings, Story/beats, Compositions/tracks/clips, captions, GraphicScenes and
template bindings, audio automation, and source identity. Composite entity IDs use unambiguous tuples and explicit order entities record
story/beat, track/clip, cue, scene/node and template ordering. The first version
does not produce pixel-level image differences. Source paths are omitted from
diff/API diagnostics.

Restore requires the current project revision, an explicit confirmation, and a
fresh checkpoint of the current project. It revalidates the selected version,
catalog schema/hash and current source bytes before publishing, including a
second verification after the recovery checkpoint is captured. Missing or
changed external media is reported as Missing/Relink; OpenFilm never guesses a
replacement or writes to an original. A changed or missing source, stale
revision, active job, current asset/clip lock conflict, symlink, catalog lock,
invalid snapshot or failed publication blocks the restore without leaving a
partial project. A recovery journal is checked before a project is opened after
an interrupted restore. The base revision is rechecked inside the catalog
restore transaction before rows change and the manifest is checked again just
before publication. Moved projects rebase managed source references in the
working restore while retaining the original immutable version package.

Successful restore replaces project-level saved state and resets stale editor
state. It is not represented as Undo/Redo. The pre-restore checkpoint remains a
named version, so the prior work remains available after close/reopen.

## Local data and limits

Version packages and their index are private project data. They contain the same
local source URIs already stored in the SQLite catalog, so keep the project
directory private and make separate backups of external originals. Source bytes
remain where the user imported them. Version limits apply only to this durable
store; cache cleanup never removes versions.

## Freeing version capacity

At the 50-version or 2GiB limit, explicitly delete a snapshot you no longer need
before saving or restoring; restore needs one free slot for its recovery
checkpoint. Desktop provides **Delete…** with an irreversible-action dialog,
Escape/cancel and keyboard confirmation. No version is automatically pruned.
The current project, Undo/Redo and original media remain unchanged.

CLI: `openfilm versions delete <version-id> --project <film.openfilm>
--base-revision <sha256> --confirm` (one command). HTTP:
`DELETE /api/versions/<version-id>` with JSON `baseRevision` and `confirmed:true`.
The shared service checks the saved revision while holding the project write
lock and refuses deletion during active jobs or restore recovery. A repeated
delete is safe; a repeated create request for an explicitly deleted version
returns404 rather than recreating it. Interrupted removal can leave unindexed
bytes, which a retry removes; separate backups remain advisable.
