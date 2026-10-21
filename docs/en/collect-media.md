# Collect Media portable packages

Collect Media makes a relocatable copy of the saved project material needed to
open and render a film. It does not move or rewrite originals. Desktop, HTTP and
CLI use `CollectMediaService` from `@openfilm/application`; the service keeps the
existing Composition as the only edit timeline and does not change project
schema 1.0.0 or catalog schema v5.

## Scope and review

Choose one of two scopes before packaging:

- **Current film** selects one saved Composition and its Story.
- **Entire project** selects every saved Story and Composition.

Only assets referenced by those Story selections/constraints, Composition clips,
secondary layouts and GraphicScene images are collected. Unused Library assets
are omitted. This includes a selected Composition's audio/video, generated WAVs,
derived media used by the edit, captions and scene data already stored in that
Composition, plus fonts resolved by its titles, captions and GraphicScene text.

Planning reports each selected asset/font's display name, type, size and
SHA-256. An item is blocked when it is missing, unreadable, a symlink path,
changed since catalog inspection, over the file limit, an unsupported URI,
inside a nested archive, missing a font, or missing an explicit rights
declaration. A font fallback can remain packageable with a typography review
warning. The warning is not a claim that the replacement font is visually
equivalent.

Every media file and collected font needs a confirmed rights basis (`owned`,
`licensed`, `cc0`, `public-domain` or `other`). Non-owned declarations include a
license name; attribution is optional. The declaration is a user-provided
receipt, not an automated license determination. Absolute local paths and
secret-like text are rejected from receipt fields; file URLs are not accepted.

## Package layout and privacy

The application captures `project.json` and a SQLite-consistent catalog image
while the existing catalog writer is fenced. The catalog is filtered to the
selected assets and their transcript data; jobs, review suggestions, caches,
unselected assets and free-page remnants are removed. The filtered SQLite image
is vacuumed before publication. Named Versions snapshots are intentionally
excluded and the UI/manifest report `versionsIncluded: false`.

Each distinct source byte sequence is stored once at
`sources/<first-two-hash-characters>/<sha256>.<extension>`. Fonts are stored at
`fonts/<sha256>.<extension>`. An asset's package URI is opaque and unique to its
stable asset ID, while `openfilm.managedSource.relativePath` identifies its
hash-addressed file. Reopening after relocation rebases only these managed
sources inside the package. Original media is untouched.

The manifest records file hashes/sizes, selected Story/Composition IDs,
per-asset source hashes, fonts, rights declarations, scope, version exclusion,
and only a SHA-256 digest of each original URI. It does not contain original
absolute source paths. Asset display names are reduced to filenames; path-like
tags are omitted and metadata keys that look like secrets are removed. Local
paths inside metadata strings are replaced by digests. Project schema,
composition IDs, locks, selected media IDs and saved edit state are retained.

## Safety, limits and publication

Directory packages contain regular files only. ZIP uses UTF-8 names and stored
entries; ZIP extraction rejects traversal, absolute/UNC/drive paths, duplicate
or case-colliding paths, symlinks/special files, nested archives, malformed
headers, overlapping entries, size-limit violations and bad CRCs. Archive input
is extracted only into a new private temporary directory. Symlinked source,
package and output path components are rejected. Hard-linked directory files
are rejected. Names are normalized to portable relative paths; CJK names round
trip.

The current implementation bounds source count to 10,000, each source to 2 GiB,
the manifest to 16 MiB, and the catalog snapshot to its existing 256 MiB limit.
ZIP output follows ZIP32 limits (under 4 GiB). ZIP entries are stored without
compression to avoid decompression-bomb behavior; package size estimates report
the uncompressed payload and manifest, before ZIP headers. Work is staged beside
the destination, protected by an exclusive per-destination lock and published
only after source, project and catalog revision checks. Cancellation removes
staged files and leaves no published partial package. Existing destinations are
never intentionally overwritten.

The HTTP service creates uniquely named packages only in the open project's
`exports/` directory; verify accepts a package name in that same directory. The
CLI is a local command and accepts an explicit destination. No endpoint accepts
arbitrary archive extraction destinations.

## Verify and reopen

`Package Verify` copies a directory package or extracts a ZIP into a private
temporary root. It checks every manifest file hash and size, catalog membership,
asset URI/rebase metadata, source/font hashes, selected Story/Composition IDs,
and rights coverage. It opens the isolated package without access to original
source locations, renders a preview and a real MP4, then checks the MP4 render
receipt against the manifest's source hashes and the MP4 byte hash. FFmpeg
decodes every video frame; FFprobe checks H.264 dimensions, frame rate, decoded
frame count/duration and the expected audio stream. Returned evidence contains
only hashes and technical stream facts, not source paths.

For an entire-project package, Verify renders the first saved Composition as the
representative MP4. Other Compositions remain present and can be selected after
opening the package. An isolated Verify run proves behavior on the current host;
it does not certify Windows/macOS filesystem semantics, fonts installed on a
workstation, or any particular NLE. See [validation](../validation-collect-media.md)
for automated evidence and outstanding manual gates.

## Commands

The CLI requires explicit rights declarations in a JSON array. In this checkout,
a typical flow is:

```sh
pnpm cli collect plan --project ./film.openfilm --scope current-film \
  --composition <composition-id> --rights ./rights.json
pnpm cli collect create --project ./film.openfilm --scope current-film \
  --composition <composition-id> --rights ./rights.json \
  --plan-id <plan-id> --base-revision <revision> \
  --format zip --destination ./handoff/film.zip
pnpm cli collect verify --project ./film.openfilm --package ./handoff/film.zip
```

The HTTP routes are `POST /api/collect/plan`, `POST /api/collect/create` and
`POST /api/collect/verify`. Create/verify operations are cancellable by closing
the request; the server keeps the project busy until staged work has stopped.
The Desktop Export view provides the same plan, rights review, package creation
and verification sequence.
