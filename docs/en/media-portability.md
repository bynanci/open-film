# Moving and reconnecting media

OpenFilm keeps original media outside the project. Moving a `.openfilm` directory
preserves its catalog, story, timeline, edits and cached thumbnails/proxies. Newly
created cache references are relative to the project. Older generated absolute
cache references are recovered when reopening the moved project.

Missing files remain in the Library and Timeline with **Missing Media**. Ratings,
locks, source ranges, effects and beat selections remain editable and saved.
Rendering requires available originals; reconnect the disk or relink before
rendering. **Check again** refreshes source and library availability without
decoding all the media. An unavailable library displays **Library offline**.

Use **Relink Media** for a folder, or the selected asset's relink action for one
file. Enter its new path or use a native picker. Review the matching evidence,
choose ambiguous candidates explicitly, and apply the selected matches. Pending
timeline edits are saved before relinking. Import or render jobs must finish or
be cancelled first.

Matching proceeds in this order:

1. Exact SHA-256 content hash, even if the filename changed.
2. Relative path within the library, when no original hash is known.
3. Filename plus byte size, when no original hash is known.
4. Explicit single-file selection and confirmation for unidentified legacy media.

Only a unique exact content match is automatically selected. Weaker matches
require confirmation; filename alone never automatically identifies a source.
Known hash mismatches cannot be overridden by a weaker match. Multiple equivalent
candidates stay ambiguous. Files are checked again when applying; stale plans,
deleted files, source ranges longer than replacement media and destination
collisions produce specific errors. A folder relink updates all selected catalog
rows in one SQLite transaction or changes none.

References live in the existing `metadata["openfilm.reference"]` extension:
original URI, hash, filename, byte size, library ID, relative path, logical volume
ID and current root URI. The original URI and asset ID survive every relink.
The project and catalog schema versions remain unchanged because this is additive
metadata. Legacy references are derived from existing library roots and filesystem
metadata; no guessed content hashes are invented. Re-importing a successfully
relinked source retains its original asset ID and user decisions.

Logical volume IDs survive a mount path or drive-letter change. Reconnecting at
the same path needs only **Check again**. For a new drive letter or mount point,
relink the folder once. Windows drive, UNC and file-URL normalization are covered
by portable tests. Automatic operating-system disk discovery and actual Windows
removable-drive mounting still need native hardware verification; this release
does not claim physical-volume auto-detection.

Source files are never renamed, rewritten or removed by relinking. Cached media
remains in the project. Keep backups of originals as well as the project.
