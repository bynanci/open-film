# Relinking integration contracts

The existing asset metadata extension is sufficient. No breaking Core or SQLite
schema change is needed. Store `metadata["openfilm.reference"]` as:

```ts
interface PortableReference {
  originalUri: string;
  contentHash?: string;
  filename: string;
  fileSize?: number;
  mediaLibraryId: string;
  relativePath: string;
  volumeId: string; // stable logical identity, not a drive letter
  rootUri: string; // current mount/import root
}
```

`originalUri` never changes. Asset IDs, user metadata, ratings, locks, story and
timeline documents never change merely because files move. Sources are never
modified. Logical volume identity supports explicit remount/relink; native
physical-disk auto-detection is not claimed.

## Media adapter helpers — packages/media/src/relink.ts

Export through @openfilm/media. Own filesystem inspection, safe folder traversal,
normalization, hashing and matching, without catalog/application imports.

```ts
type SourceStatus = { assetId: string; status: 'available'|'missing'|'inaccessible'; message?: string };
type RelinkCandidate = {
  id: string; path: string; uri: string; fileSize: number; contentHash: string;
  match: 'content-hash'|'relative-path'|'filename-size'|'manual';
  automatic: boolean; reason: string;
};
type RelinkMatch = { assetId: string; candidates: RelinkCandidate[]; suggestedId?: string; reason?: string };
referenceFor(asset:MediaAsset, libraries:MediaLibrary[]):PortableReference;
sourceStatus(asset:MediaAsset):Promise<SourceStatus>;
planMediaRelink(assets:MediaAsset[], libraries:MediaLibrary[], input:{folder?:string;file?:string}):Promise<RelinkMatch[]>;
```

Use SHA-256 first; known hash mismatch blocks fallback entirely. Without a known
hash, relative path wins, then filename+size. Filename alone never automatic.
Multiple equal-rank matches stay ambiguous. Explicit single file can be manually
confirmed only when no known hash contradicts it. Reject symlinks/nonregular files
and include specific reasons. File URL and Windows D:/E:/UNC path normalization
must be independently tested on Linux (native mount verification stays manual).
`referenceFor` derives legacy metadata from the longest matching library root,
preserving opaque library identity and filesystem byte size where available.

## Application/catalog — packages/application/src/relink.ts

Export `MediaRelinker` and types from @openfilm/application. One instance per open
application, like TimelineEditor. Own catalog batch methods and focused tests.

```ts
type RelinkPlan = { id: string; createdAt: string; matches: RelinkMatch[] };
class MediaRelinker {
  constructor(application: OpenFilmApplication);
  status(assetIds?: string[]): Promise<{
    assets: SourceStatus[];
    libraries: {
      id: string;
      name: string;
      status: "online" | "offline" | "partial";
      roots: string[];
    }[];
  }>;
  plan(input: {
    assetIds?: string[];
    libraryId?: string;
    folder?: string;
    file?: string;
  }): Promise<RelinkPlan>;
  apply(input: {
    planId: string;
    selections: { assetId: string; candidateId: string; confirm?: boolean }[];
  }): Promise<{ assets: MediaAsset[] }>;
}
```

Plans are bounded/expiring and server-owned. Revalidate files at apply time;
validate type and existing source trims/duration before accepting unverified
legacy manual matches. Explicit confirmation is required for nonautomatic
candidates. Preserve asset IDs and metadata. Folder changes commit in one SQLite
transaction, checking expected URI/hash and destination URI uniqueness, merging
only reference/location data into latest catalog rows. A changed rating during
planning survives. Roll back all rows on any failure. Store canonical current
roots inside catalog reference metadata so a JSON/SQLite cross-store transaction
is unnecessary. Expose errors with numeric status for HTTP.

Catalog also needs `getAssetByUri(uri)` so relinked sources can be imported again
without generating duplicate identities. Root integrates this lookup into import.

## Root integration

- Allocate/reuse library identity before import, persist PortableReference, keep
  relinked IDs, save cache URI as project-relative `cache/...`. Recover old absolute
  cache entries using only recognized cache subpaths when project is moved.
- GET `/api/media/status` (optional `assetIds` comma-separated IDs).
- POST `/api/media/relink/plan` -> RelinkPlan.
- POST `/api/media/relink/apply` -> `{assets}`.
- Reject relink while import/render jobs active. Keep existing mutation queue.
- After flushing timeline, refresh editor state and source playback after relink.
  Source/thumbnail availability is transient, never stored in revision payload.

## Desktop

Provide Relink Media from Library and selected asset; folder and single-file paths
can be entered, with native picker where available. Show match evidence and chosen
candidate before Apply; ambiguous/manual matches require explicit choice. Display
Missing Media, library offline, and actionable mismatch messages. Keep cached
thumbnails and all editing controls usable. Refresh status on opening/returning to
Library, on explicit Check again and after relink; do not poll/decode500 media.
Use source URI/version as playback key after relink. Flush pending edits first.
