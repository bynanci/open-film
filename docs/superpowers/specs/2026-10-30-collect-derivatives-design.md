# D6B — Reviewable derived Collect Media packages

Status: actual delivery candidate implemented; final full branch gates and
independent review remain required before D6B is marked ready to merge.
Initial design base: D6A candidate `c8273bcdf6a6dcbcc9a1f6ab9bc84a6ffb1e5ceb`.
Current integration base: merged PR #64,
`9c392b7cc8d46f4768d76f30bef30d0397cca8f8`.
The user has authorized continued roadmap/storage execution without additional
planning approval rounds. New implementation choices below are the builder's
calls, rather than attributed user decisions.

## Existing owners and gaps

`CollectMediaService` already captures a consistent saved project/catalog,
selects current-film/entire-project dependencies, hashes original media/fonts,
reviews rights and atomically publishes directories or streaming stored ZIP32.
Its v1 manifest verifies relocation/reopen, source hashes and a real MP4. It
excludes jobs, credentials, private caches and Named Versions. Do not rebuild it.

True gaps: source-range consolidation/handles, derivative/original lineage,
explicit offline quality and original-baseline decoded picture/audio/time
comparison. D6A manages private previews; those private receipts are not portable
masters and cannot silently become a source-derivative package contract.

## Approaches and selected state flow

1. Copy preview cache files into existing v1 source slots. Rejected: this changes
   source identity/quality without lineage and can invalidate transcript timing.
2. **Selected: versioned derivative planning and receipts over the existing
   Collect service**, followed by separately verified execution. Source windows
   are deterministic projections of the current Composition, not a second
   timeline. Full-original v1 collection remains the default. Requested modes
   are `originals`, `trimmed-originals`, `offline-proxies`.
3. A new package/project format or scheduler. Rejected: duplicates the current
   catalog, rights, publication, ZIP and relocation owners.

First expose a read-only source-use/handles plan bound to saved project revision,
baseline Collect plan ID and full source hashes. Union overlapping/adjacent uses
with clamped configurable handles (default2s, range0–10s). Keep distinct disjoint
windows; never pretend their bounding envelope excludes the intervening gap.
Use `resolveClipSourceRange` so explicit trims, speed and duration tolerance agree
with rendering. Include all saved tracks/hidden resources to preserve reopen.
Opaque/non-clip references, images/raw360, locks and missing timing receive typed
copy-original/block reasons rather than invented source windows.

A coverage preview is explicitly `review-only` and **not executable**. No mode
may be enabled in Create until its derivative, catalog/provenance conversion,
quality disclosure and baseline-parity gates exist. This first slice is not a
completed trimmed-media or offline-package feature.

## Execution design and compatibility gates

- Keep source clocks/provenance explicit. A compacted source may contain multiple
  original intervals; receipt maps each original interval to derivative offset
  and hash. A lossless derivative is newly encoded media, not an unchanged
  original. Stream copy alone cannot promise frame/sample boundaries on long GOP.
- Convert only a private captured package. Original project/catalog/media and
  manual/source locks remain unchanged. Preserve source-use IDs and exact saved
  Composition timing. Opaque transcript/analysis/graph dependencies must retain
  originals until a typed clock/provenance conversion exists; no timestamp
  fiction or silent loss of immutable revisions.
- New manifest v2 identifies delivery mode, original/derivative hashes, recipe,
  intervals/handles and acknowledged quality. Reject unknown versions. V1 verify
  remains accepted. Preview caches, operational owners, keys and credentials are
  never copied as evidence or as implicit originals.
- Trimmed delivery requires actual decoded frame/audio/time equality to an
  original-project reference, including first/middle/last and source boundaries.
  Offline preview delivery must explicitly disclose lower resolution/compression,
  require acceptance and label review-only output. It cannot claim master parity.
- Reuse bounded source snapshots, no-follow/private paths, output probe/hash,
  cancellation, stale revision/source rechecks and exclusive no-overwrite
  publication. Derivative work obeys ZIP32/source limits and explicit disk bounds.
  Failed/cancelled work cannot publish a partial package or alter originals.

## Threat and acceptance matrix

Untrusted project/manifest data is data only: no JS/HTML, remote URL, executable,
request-supplied cache path or arbitrary deletion. Source maps must be monotonic,
non-overlapping and bounded by exact source/derivative duration. Reject duplicate
IDs, non-finite/negative time, unsupported mode/version, excessive windows and
stale project/hash. Explicit consent never relaxes path/hash/source invariants.

Tests progress from pure range/contract assertions to consistent application
capture, shared CLI/API review, actual derivative generation, directory/ZIP
relocation and real original-baseline MP4 comparison. Synthetic long-GOP video,
audio, overlapping/disjoint uses, rational-speed clips, manual captions,
transcript-bearing assets, locks and cancellation are required. Physical large
external drives, Windows/macOS/NLE finishing remain separate evidence gates.

## Implemented bounded recipe decision (2026-10-30)

Lossless eligible CFR SDR video uses FFV1/float PCM AVI and audio uses float PCM
WAV, within existing allowed demuxers. Frame/sample windows expand outward and
compact disjoint intervals; clock/protection uncertainty retains originals. AVI
is a derived source, not an interoperable browser codec; new-machine playback
may require the existing local proxy preparation. Lossless files may be larger.

Every selected Composition receives actual original/delivered MP4 picture/PCM
comparison before publication; v2 verification re-renders every delivered film.
Private render output is bounded, then deleted per comparison. Limits and the
unsupported-clock policy are recorded in validation and the execution ledger.
Preview-only projection remains non-executable; separate explicit acceptance is
bound by coverageId, project/revision and options, with offline disclosure.
