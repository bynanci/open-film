# Architecture

OpenFilm is a local media and story engine with multiple application entry points.
All edit quantities use seconds; originals are referenced and never rewritten by
import or composition. The engine produces decisions and operations that a preview
renderer or timeline exporter can consume.

The Desktop product layer uses stable Library/Story/Edit/Export workspace IDs,
Vue I18n catalogs and local preferences. UI locale never enters a domain state
discriminator or changes project content. Optional film locale/settings and
template/user text provenance stay in portable models; template packages supply
their own content catalogs. See [internationalization](i18n.md) and
[product workflow](product-workflow.md).

Application errors carry stable codes and parameters, with diagnostic detail
preserved for CLI/debug use. The frontend localizes the code at display time.
The same application import pipeline accepts native paths and validated browser
upload receipts. Uploads stream only to local project-managed sources, while
ordinary native imports continue referencing originals. MP4 export renders the
current composition into an atomic finished output rather than reusing a stale
preview. No new remote service or alternate composition engine is introduced.

```mermaid
flowchart TD
  Desktop[Vue workspace / Tauri shell] --> API[Loopback HTTP API]
  API --> Application[Application service]
  CLI[Headless CLI] --> Application
  Application --> Domain[Portable models and algorithms]
  Application --> Catalog[SQLite catalog adapter]
  Application --> Media[Filesystem / FFprobe / ExifTool / FFmpeg adapters]
  Application --> Devices[Pixel / Insta360 source adapters]
  Devices --> Media
  Application --> Renderer[FFmpeg preview renderer]
  Application --> Exporters[Timeline serializers]
  Template[External story template] --> Domain
```

## Packages and boundaries

| Package           | Responsibility                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `core`            | Media, event, story, composition, project, and job models; schema validation/migration.   |
| `plugin-sdk`      | Extension ports/manifests and provider disclosure/consent validation.                     |
| `metadata`        | Portable capture timestamp resolution.                                                    |
| `events`          | Exact/perceptual groups and deterministic event clustering.                               |
| `story`           | Generic story construction and explainable offline ranking.                               |
| `solver`          | Composition, pure timeline commands, scoped beat regeneration and shortening suggestions. |
| `analysis`        | Portable AI provider registry with per-invocation consent/disclosure checks.              |
| `exporters`       | JSON, OTIO cut layout with metadata-only advanced edits/warnings, limited FCPXML and EDL. |
| `catalog`         | Node SQLite persistence, paginated descriptors and atomic source-location updates.        |
| `media`           | Local inspection, source matching/status, hashes and safe thumbnail/proxy conversion.     |
| `source-pixel`    | Pixel metadata/Motion Photo evidence and DNG inspection through existing source ports.    |
| `source-insta360` | Flat export metadata and original-source associations; raw/spherical preview limits.      |
| `render`          | Composition-to-FFmpeg preview adapter.                                                    |
| `application`     | Import/render/export orchestration, durable editing and relinking shared by CLI/API.      |
| `ui`              | Reserved package; current desktop helpers live in `apps/desktop`.                         |

Portable packages do not import Node, Vue, or Tauri. The application orchestrates
concrete local adapters through the same models; it deliberately avoids a general
dependency-injection framework. Scenario-specific language belongs to external
template packages. The first official template is registered by the application;
the SDK defines extension contracts, while arbitrary plugin discovery is future
work.

## Import and analysis

The 0.3 foundation adds portable transcript/word timing, waveforms, scenes and
generic markers to Core. `@openfilm/provider-whisper` implements the existing SDK
transcription port through optional local Python/faster-whisper. A user-supplied
model and GPU-to-CPU fallback leave Python/model installation optional for all
other workflows. Registry consent rules remain intact.

Catalog version 2 stores validated source-hash/version-bound intelligence outside
MediaAsset and project.json. Indexed transcript revisions support bounded reads;
failed/cancelled replacement preserves earlier results. Application operations
check source identity before reuse and successful commit and use existing durable
Jobs. Waveform decoding streams bounded peaks; scene detection downsizes frames.

Transcribe/waveform/scenes jobs carry optional execution ownership in existing
Job JSON. SQLite atomically reserves the project analysis slot, consumes the
exact queued checkpoint once and fences progress by owner/active state. Result
publication and completed Job status share the existing transcript/cache
transaction, including source and transcript revision guards. Only proven-dead
owners auto-recover; unknown or subsequently stopped owners have exact-checkpoint
confirmed recovery. Runtime cancellation capabilities belong to the server's
AbortController map. See [media-analysis recovery](media-analysis-recovery.md).

Application-layer provider waits share an abort boundary for transcription and
language review. Aborting settles the application wait even when the provider
ignores its signal; attached result/failure handlers still consume late settlement.
Transcription progress callbacks close with that wait, and existing abort checks
prevent validation/indexing of an obsolete result. The application and HTTP task
guards then release normally, preserving prior recognition until a validated
retry succeeds. ProviderRegistry still enforces disclosure and consent at invocation;
the SDK and SQLite schemas remain unchanged.

CLI, API and Desktop share these operations. Precision mode separates source and
composition seconds and applies snapping, trim and split through the existing
TimelineCommand history. Analysis does not rewrite Story or composition. See
[media intelligence](media-intelligence.md) and [reference decisions](vidscribe-reference.md).

Catalog v3 adds immutable transcript revision metadata, durable command receipts
and independent text undo/redo, portable project glossary entries and review
suggestions/batches. Core owns validated `TranscriptCommand` operations and
alignment state; application owns source verification, jobs and optional review
provider orchestration. Text edits never dispatch composition commands. Undo and
revision selection issue fresh tokens, protecting stale suggestion checks against
revision reuse. Accepted text commands and their suggestion audit commit in one
SQLite transaction. v1/v2 migrations retain original provider results and roll
back on failure.

Catalog v4 rebuilds only the transcript segment index inside the migration
transaction. JSON-encoded opaque ID keys avoid SQLite UTF-8 collisions for
isolated surrogate code units without changing original segment JSON, timings,
words, revisions, receipts or review evidence. v1/v2/v3 upgrades and malformed
legacy-data rollback share the same migration boundary.

Global terminology uses a validated, atomic, backed-up user-data file outside the
project. Trusted runtime options configure its path and an optional generic
LanguageProvider; project data and HTTP bodies cannot configure executables or
destinations. Bounded review prompts contain declared text/transcript context only.
The registry checks current disclosure and remote consent before every batch.
Completed batches remain durable on failure, cancellation and restart. Desktop
adds a paged Transcript mode within Edit rather than a second timeline engine.
See [text commands](transcript-editing.md), [terminology](glossary.md) and
[review evidence](review-suggestions.md).

Filesystem discovery yields supported file candidates lazily and avoids symlink
traversal. Import runs at most three file tasks concurrently. Each task inspects
media, normalizes metadata, fingerprints content, generates derived outputs, and
commits the catalog record. One malformed file becomes a structured job error
with its URI and stage instead of stopping the batch.

Completed files and cache outputs are reused on subsequent import. Hashes are
checked before and after processing so externally changing media is retried.
Preference edits survive reinspection. Interrupted queued/running jobs are marked
failed on reopen with an explicit reimport instruction; the process does not claim
to resume an in-flight decoder at an arbitrary byte offset.

Device adapters add namespaced metadata through existing source ports. Recognized
raw/spherical media and undecodable DNG remain catalog entries with actionable
preview limits; unsupported sources do not silently enter flat preview or automatic
composition. Supported HDR previews require known color metadata and FFmpeg tone
mapping filters. Original files and inspected metadata remain intact. See
[source support](source-support.md) for generated-fixture evidence and remaining
camera/hardware checks.

Analysis reads compact paged descriptors, then groups them in memory. It does not
decode all media or load complete EXIF/FFprobe blobs, but grouping still materializes
the descriptor collection and runs synchronously. Incremental analysis and
archive-scale worker/latency validation remain future work.

## Story and solver semantics

Candidates are partitioned chronologically by story creation. Ranking uses
observable user preference, dimensions, uniqueness, chronology, tags, and event
context; returned factors explain the score. No external model is used.

Selected IDs and must-include IDs are required in their beat; library locks are
required globally. Must-exclude and rejected media are ineligible. An asset can
appear once. Beat order is fixed; explicit selection/asset-order edges are retained,
and a chronological constraint can detect an incompatible manual order.

Automatic composition treats maximum durations, beat minima, source bounds and
inclusion as hard constraints. Targets are soft. Clips normally start from
4-second still/6-second motion pacing
and can stretch toward targets up to 12 seconds; hard minima can use longer still
holds or source durations. A playable clip has a minimum of one second or its
shorter source length. Unknown-duration moving/audio media cannot be required
without inspection. Candidate overlap and lock placement use bounded search;
complex search failures instruct users to narrow pools or pin selections.

The application caps a story scope at 2,000 candidates, including locks. Catalog
pagination supports larger libraries, but no 100,000-asset benchmark or unrestricted
story-scale guarantee is implied.

## Editing and source relocation

The solver applies pure commands to composition/story snapshots. The application
editor validates runtime command input, checks content revisions, persists a batch
before acknowledging it, and retains bounded undo/redo history for the open
project session. Validation or write failure preserves the previous document and
history. Clip locks and required-source constraints protect automatic changes;
manual over-limit cuts remain saveable, with rendering blocked until shortened.
The editor extends the current project model and application service. See
[editing contracts](EDITING_CONTRACTS.md).

The media adapter checks availability and proposes hash-first relink candidates.
The application owns bounded, expiring plans and revalidates selected files; the
catalog commits reference/location changes in one SQLite transaction while
preserving current user edits. Current roots live in
`metadata["openfilm.reference"]`, avoiding a JSON/SQLite transaction. Asset IDs and
timeline references survive relinking and subsequent import. Cache paths are
project-relative; location/cache changes do not invalidate timeline undo history.
Source availability is transient. Logical volume identity supports explicit
remounting, with physical-volume auto-detection deferred. See
[media portability](media-portability.md) and [relinking contracts](RELINK_CONTRACTS.md).

## Interchange boundaries

OTIO carries native cut layout, source references, still holds, audio and gaps.
Advanced edits are preserved in OpenFilm metadata with explicit compatibility
warnings and an adjacent report. Speed edits use unretimed native excerpts and
padding where needed; NLE effects must be recreated manually. FCPXML and EDL keep
their existing restrictions. The official OTIO parser gate verifies structure,
timing and preserved metadata using generated real sources; it does not verify
Resolve import or playback. See [NLE compatibility](nle-compatibility.md).

## Local service and native shell

The HTTP adapter binds to `127.0.0.1` (port 4310 by default), validates Host/origin/write bodies,
and exposes project, catalog, job, story, timeline editing, relinking, preview and
export operations. Mutations are serialized; relinking and project replacement
are blocked while import/render jobs run. The Vue
workspace runs on port 1420 during development. Errors use non-success responses
with actionable text. Remote provider ports exist; the default application does
not instantiate a remote provider.

Desktop App owns the project/generation-guarded Activity snapshot. Transcript and
Suggestions consume this shared input instead of independently reading full job
history. The parent retains its existing poll, and older unfinished review jobs
remain available for recovery. Future job-history pagination must preserve those
recovery and fast-completion guarantees.

Tauri supplies native folder selection and can spawn a configured local Node
service, stopping its owned child on exit. It does not replace the Node media and
SQLite adapters. Development starts the service separately; deployment must
supply a verified runtime, service, media tools, and update/installer integration.

See [the integration contracts](CONTRACTS.md), [project format](project-format.md),
and [ADRs](adr/001-monorepo.md) for public interfaces and design decisions.

## Shared visual geometry contract

Clip visual geometry is a core-domain contract rather than an adapter-specific
interpretation. Coordinates use composition-frame pixels with the origin at the
frame center: positive x moves right and positive y moves down. A visual source
is contain-fit to the composition frame, then user scale and clockwise rotation
are applied around the actual fitted media center, x/y translation is applied in
frame pixels, and the result is clipped by the composition frame.

The desktop preview first fits an explicit composition-frame box into its viewport,
then independently contain-fits the decoded source aspect inside that frame. User
transforms apply to the fitted source box, not a letterboxed frame-sized element.
The frame box owns clipping, so translating or rotating beyond its edges matches
the renderer instead of leaking into spare UI space. Browser intrinsic dimensions
replace catalog dimensions after decode, keeping generated proxies and orientation
effects aligned with what the user is actually previewing.

The FFmpeg renderer follows the same ordering at output resolution. Its contain
fit uses decoded width/height and sample aspect ratio; positive SAR is preserved
as display aspect and unspecified SAR uses square pixels. It computes the output
size in one scale operation before normalizing SAR, without relying on a newer
FFmpeg `reset_sar` option or adding an intermediate resample. It converts
the transformed source to an alpha-capable format before rotation so transparent
rotated corners reveal lower visual tracks rather than becoming black. Final
encoding quantization remains pixel-based, while UI mapping may use fractional CSS
pixels. The contract is versioned as `CLIP_GEOMETRY_CONTRACT_VERSION` in
`@openfilm/core`.

This contract does not claim NLE interchange support. Exporters that cannot
faithfully represent a transform must continue to reject it or mark it metadata-only
rather than silently changing geometry.
