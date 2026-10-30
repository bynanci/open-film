# Current integration contracts

All quantities called duration/sourceIn/sourceOut/timelineStart/timelineDuration
are seconds. Capture timestamps are ISO 8601 with provenance/confidence.

## Professional Cut Desk Phase 1A

`ProjectSettings.timebase?` is version 1 with integer `rateNumerator`,
`rateDenominator` and boolean `dropFrame`; its rational projection must match
`frameRate`. Legacy derivation does not mutate saved settings. DF supports only
`30000/1001` and `60000/1001`, rejects nonexistent minute labels and never retimes
media. Populated projects permit only same-rational DF/NDF changes.

`resolveCompositionFrame` maps integer frames onto the saved Composition's
half-open clip ranges, source timing, crossfade tails, visual order and audio.
Expert Source/Record and General Story/Precision share that Composition. Record
has one transient monotonic frame clock with source readiness and owner fences;
Source uses reliable source-rate metadata or labelled elapsed/project-rate
fallback, not invented embedded timecode or word precision.

Source I/O stages revision-bound session marks without a command. Apply and
Record split use `commitTransaction`: flush older work, capture one base revision
and request ID, acknowledge one validated batch and create one active-session
Undo entry. Ambiguous requests retain recovery data for idempotent retry;
conflict, disposal and project switching fence publication. Saved edits survive
reopen; Undo and portable durable transaction receipts are not promised across
sessions. M writes only existing Source catalog markers; Record M writes nothing.

Clip locks block edits. Primary source locks allow clip-local trim/speed/volume
but block split, presentation and identity removal. Overlay source/clip locks
block timing/configuration; required/selected identities cannot be removed.
Existing preflight/application rules remain authoritative, including graphic and
caption bounds. Missing/unready/decode-failed media holds or stops Record. Reverse
audio, above-unity browser gain parity, synchronous GraphicScene playback and
color-managed display parity are not claimed. See the
[Phase 1A guide](professional-cut-desk.md) and
[validation](validation-professional-cut-desk.md); Phase 1B–4 remain separate.

`@openfilm/core` exports:

- `MediaAsset`: `id`, `uri`, `mediaType: image|video|audio|360-video`, `name`,
  `capturedAt?`, `capturedAtConfidence?`, `capturedAtSource?`, `duration?`,
  `dimensions?`, `frameRate?`, `codec?`, `contentHash?`, `perceptualHash?`,
  `tags: string[]`, `rating?: number` (0–5), `state: {favorite?,rejected?,locked?}`,
  `metadata: Record<string, unknown>`, `thumbnailUri?`, `proxyUri?`, `gps?`.
- `OpenFilmProject`: `schemaVersion: '1.0.0'`, `id`, `title`, `createdAt`,
  `updatedAt`, `mediaLibraries`, `stories: Story[]`, `timelines: Composition[]`,
  `settings: {width,height,frameRate,timebase?}`. `MediaLibrary` has `id`, `uri`, `name`.
- `Story`: `id,title,template?,targetDuration?,maxDuration?,beats: StoryBeat[]`.
- `StoryBeat`: `id,title,intent?,targetDuration?,minDuration?,maxDuration?,`
  `candidateAssetIds?: string[]`, `selectedAssetIds?: string[]`, `constraints?`.
- `StoryConstraint`: discriminated union with `type: must-include|must-exclude`
  and `assetIds: string[]`; other supported constraints documented by algorithms.
- `Composition`: `id,storyId,duration,tracks: Track[]`.
- `Track`: `id`, `type: video|audio|music|titles|overlay`, `clips: Clip[]`.
- `Clip`: `id,assetId,beatId?,sourceIn?,sourceOut?,timelineStart,timelineDuration,`
  `transform?: {scale?,rotation?,x?,y?,speed?,volume?}`, `title?: string`,
  `transition?: {type:'crossfade',duration:number}`.
- `Event`: `id,startAt?,endAt?,assetIds,labels,confidence?,location?`.
- `SimilarityGroup`: `id,kind:'exact'|'perceptual',assetIds,confidence`.
- `Job`: `id,type,status:queued|running|completed|failed|cancelled,progress?,`
  `errors?: {uri,stage,message}[]`, `createdAt?,updatedAt?`.
- Multi-source lifecycle types are independent: `ImportBatchStatus` is
  `sealing|sealed|partial|failed|cancelled`; `AnalysisRunStatus` is
  `queued|running|completed|partial|failed|cancelled`; `JobAttemptStatus` is
  `queued|running|succeeded|failed|cancelled|abandoned`. Terminal attempts never
  reopen; retry creates a new attempt. A sealed batch and completed run remain
  terminal.
- `SourceDraft` holds versioned `SourceSelection` descriptors and an explicit
  `SourceAccessClass`. Browser handles are opaque local references rather than
  JSON. `ExpectedManifest` freezes the requested occurrences and policy;
  `VerifiedManifest` freezes successful asset/content/context bindings plus
  failures and exclusions. `MediaSourceAdapterV2.discover` streams candidates
  as an `AsyncIterable`; legacy adapters remain supported through a bounded
  wrapper. `ContentIdentity` stores the complete SHA-256 and byte length, while
  local staging paths and leases remain private operational state.
- `AnalysisRun` binds its exact verified manifest, input fingerprint, algorithm
  versions and immutable binding IDs. Optional `TravelContextV1` contains
  manually supplied clock offsets, a validated GPX track with preserved segment
  boundaries, and explicit asset assignments. Matching never interpolates over
  a segment gap. Optional `VisualSamplingV1` selects deterministic FFmpeg frame
  sampling. `VisualSampleEvidenceV1` retains bounded labels, timestamps and
  source/frame hashes only; a remote provider receives a bounded sample only
  after explicit consent and never receives the source URI or full asset.
- `ReviewDecision` binds typed merge/split/correction/reject/story-adoption
  operations to exact base/target result IDs, result and operation fingerprints,
  manifest ID, optional story revision and optional superseded decision. Preview
  is non-mutating; stale operations are persisted as conflicts. Only an explicit
  accepted `adopt-story` operation changes StoryGraph. Operation fingerprints
  are revalidated when writing or sanitizing portable snapshots.
  Desktop preview publication and Accept require the exact current form and
  run/project context. An unresolved acceptance retains one validated private
  local receipt before sending; retry/reopen reuses its exact request ID and
  operation. Supersession is opt-in, and saved adoption refreshes only its owning
  workspace while preserving custom StoryGraph asset-node IDs.
  The search projection derives merged groups, source-range annotations and
  corrections without rewriting source evidence. Applied decision lineage joins
  the preview fingerprint. Accepted evidence may be adopted; rejected evidence
  remains ineligible. A split is limited to non-overlapping ranges on the reviewed
  source's verified content and actual video/audio duration.
- `createProject(title: string): OpenFilmProject`; `validateProject(value:
unknown): OpenFilmProject` throws on invalid/future schema; `migrateProject`
  supports documented versioned input without guessing or modifying originals.

`@openfilm/metadata`: `resolveTimestamp(input: Record<string,unknown>,
fallbackMtime?: string): {timestamp?:string,source:string,confidence:number}`.

`@openfilm/events`: `findDuplicates(assets: MediaAsset[]): SimilarityGroup[]`;
`clusterEvents(assets: MediaAsset[], options?): Event[]`.

`@openfilm/story`: `scoreAsset(asset: MediaAsset, context?): ScoreResult`;
`createStory(title: string, assets: MediaAsset[], options?:
{template?: StoryTemplate,targetDuration?:number,maxDuration?:number}): Story`.

`@openfilm/solver`: `compose(story: Story, assets: MediaAsset[]): Composition`.
Throw an actionable error when constraints cannot be fulfilled. Rejected assets
cannot be selected. Locked and must-include assets must fit; do not silently drop.

`@openfilm/plugin-sdk`: `StoryTemplate` has id/name/description and
`create(config: {title?:string,targetDuration?:number,maxDuration?:number,
assetIds?:string[]}): Story`; `PluginManifest`, source/analysis/scorer/exporter ports.
`templates/proposal-film` exports `proposalTemplate: StoryTemplate`.

`@openfilm/catalog`: `ProjectCatalog` class uses Node SQLite. Constructor takes
project directory; `upsertAsset(asset)`, `getAsset(id)`,
`listAssets({offset?,limit?,order?}?)`, `countAssets()`, `updateAsset(id,patch)`,
`saveJob(job)`, `listJobs()`, `close()`. List methods return arrays, not envelopes.

`@openfilm/application`: `OpenFilmApplication` with static async
`create(directory,title)` and `open(directory)`; instance `project`, `directory`,
`catalog: ProjectCatalog`, async `save()`, `close()`,
`importFolder(folder, options?:{signal?:AbortSignal,onProgress?:(job:Job)=>void,
proxies?:boolean}): Promise<Result>` (result contains `job`, `imported`, `skipped`,
and `failed`),
`analyze(): {events:Event[],duplicates:SimilarityGroup[]}`,
`generateStory(options?:{title?:string,template?:string,targetDuration?:number,
maxDuration?:number}): Story`, `compose(storyId?:string): Composition`,
async `render(compositionId?:string, options?:{signal?:AbortSignal}): Promise<string>`,
async `export(format:'json'|'otio'|'fcpxml'|'edl',compositionId?:string): Promise<string>`.
Story/compose should save project updates (async return allowed if implementation
requires it; communicate actual signatures). Render writes cache/preview.mp4;
export writes exports/timeline.<extension>. Import is bounded-concurrency,
per-file isolated, restartable, cancellation-aware, and source hashes immutable.

`@openfilm/exporters`: `exportTimeline(format,composition,assets,settings?):
{extension:string,content:string}`. Unsupported transforms/export formats throw
explicitly rather than silently dropping edits.

Local API at 127.0.0.1:4310, UI at localhost:1420. JSON endpoints:

- GET `/api/health` -> `{ok:true}`.
- GET `/api/project` -> `{project: OpenFilmProject|null,path:string|null}`.
- POST `/api/project/create` `{path,title}` and `/api/project/open` `{path}`.
- GET `/api/assets?offset=0&limit=60` -> `{assets,total}`.
- PATCH `/api/assets/:id` `{rating?,state?,tags?}` -> `{asset}`.
- GET `/api/thumbnail/:id` reads only a cataloged cached thumbnail.
- POST `/api/import` `{folder}` -> `{jobId}`; GET `/api/jobs` -> `{jobs}`;
  POST `/api/jobs/:id/cancel` -> `{ok:true}`.
- POST `/api/analyze` -> `{events,duplicates}`.
- POST `/api/stories` `{title?,template?,targetDuration?,maxDuration?}` -> `{story}`.
- PATCH `/api/stories/:id` `{beats?,title?,targetDuration?,maxDuration?}` -> `{story}`.
- POST `/api/compose` `{storyId?}` -> `{composition}`.
- POST `/api/render` `{compositionId?}` -> `{path}`.
- GET `/api/preview` streams only this project's rendered preview.
- POST `/api/export` `{format,compositionId?}` -> `{path}`.
- Errors: non-2xx `{error:string}`. No remote provider enabled by default.

The CLI and server are bundled by esbuild to `dist/cli/index.mjs` and
`dist/server/index.mjs`. Desktop Vite is built into `apps/desktop/dist`.
Root scripts use pnpm, Vitest, strict tsc, ESLint, Prettier, and Vite.

## GraphicScene v1

The schema-1 Composition may contain optional `graphicScenes`; omission preserves
legacy behavior. Only strict versioned Image/Text/Shape/Group data is admitted.
Scene times are Composition seconds, node times scene-local half-open intervals;
geometry uses parent-centered Composition pixels and explicit bounded animation
endpoints. Optional rotation defaults to zero; `hidden` and `locked` retain the
node's stable identity and do not require a project-schema migration. Hidden
nodes are omitted from evaluation/rendering. Equal scene/time/settings/source/
font inputs produce equal PNGs under any seek order. No project JS, HTML, raw
SVG, expressions or remote URLs execute.

`graphic.scene.upsert/remove` use existing edit revision, receipt, Undo/Redo and
save/reopen contracts. Shortening cannot exclude saved scenes. GET
`/api/compositions/:id/graphics.png` requires project ID, editor revision and integer
output frame, returns current no-store PNG bytes, and withholds stale/cancelled
work. JSON retains all source references; OTIO graphics are metadata only;
FCPXML/EDL reject unsupported scenes. Numeric/resource limits are documented in
[GraphicScene v1](graphic-scenes.md), with evidence in [validation](validation-graphic-scene.md).

The optional `photoDepth` extension binds a version-1 root Image recipe to local
catalog photo/mask/background hashes and the same scene-local interval. A pure
bounded evaluator supplies the Monitor and FFmpeg producer; existing scene
commands, locks and history remain authoritative. Old schema-1.0.0 projects do
not need a migration. See the [PhotoDepth contract](photo-depth.md) and
[validation](validation-photo-depth.md).

The M5 Layer Editor uses the existing Monitor and typed scene-upsert command for
direct transforms and Inspector edits. A locked node can only be unlocked in a
separate command; the command boundary rejects edits to its values, containing
group transforms and containing scene timing/order. Transient drag state is
discarded on revision change or editor unmount; only an acknowledged command is
saved through existing autosave/history/reopen behavior. See the
[Layer Editor validation record](validation-layer-editor.md).

## Creative Story Template Records

The schema-1.0.0 Composition may optionally contain
`graphicSceneTemplates: GraphicSceneTemplateRecord[]`. Each version-1 record
has a stable `sceneId`, a whitelisted template ID and bounded template data
validated against the existing GraphicScene and nodes. Conversation records
bind original text, citation, exact excerpt ranges and visible attribution to
text-node IDs. Route records bind manual or GPX provenance, coordinates and
waypoint labels to shape/text-node IDs. Photo records bind relationship roles,
local asset IDs/hashes, focal points and protected regions to image-node IDs.

`graphic.scene.upsert` may carry a record in the same command; omission preserves
an existing record and explicit `null` removes it. Removing the scene removes its
record. This optional field does not change the schema version, create another
timeline or alter project media. See the
[Creative Story Templates contract](creative-story-templates.md).

## M6 audio evidence and generated-source edits

Composition/project schemas and AudioAutomation v1 remain unchanged. A volume
command may carry `audioReviewId`; application editing verifies the saved review,
source/settings/output evidence before applying normal volume semantics. An
`audio.add` command may carry `generationId`; only an accepted durable receipt
matching the exact source, target, revision and command can authorize that reviewed
import. Neither reference executes project code or selects an external endpoint.
Ordinary existing volume/audio commands remain valid. Provider-generated WAVs are
managed sources with opaque provenance metadata; Undo removes the overlay while
retaining accepted media. Private receipt files support pending edit recovery,
not remote provider authenticity or speech-quality certification.

## M7A named project versions

`ProjectVersionRecord` v1 is an application-side record and does not change
project schema 1.0.0 or the current catalog schema v6. It binds a stable version
ID, project ID, request ID, saved project revision, manifest/catalog SHA-256,
the catalog schema version captured by that snapshot, software version and a
sorted source-reference manifest containing only asset IDs, hashes, sizes,
media types and managed/external kind. Historical v5 images remain immutable;
inspect validates and reports their stored schema, while diff compares saved
project/source-reference metadata without rewriting the catalog. Asset-aware
restore/rebase paths upgrade only a private temporary copy to v6 before publishing
the live catalog. Absolute media paths and credentials are excluded. Version
content is immutable; renaming changes only private index metadata.

`app.versions` exposes `currentRevision()`, `create()`, `list()`, `inspect()`,
`diff()`, `rename()`, `restore()` and startup recovery. Create/list/inspect/diff/
rename/restore are shared by API and CLI through this service. HTTP routes are
`GET /api/versions/revision`, `GET|POST /api/versions`,
`GET /api/versions/diff?before=<id>&after=<id>`,
`GET|PATCH /api/versions/:id`, and `POST /api/versions/:id/restore`.
The CLI uses `openfilm versions revision|list|create|inspect|diff|rename|restore`.
Create and restore require request IDs for lost-response idempotency; restore
also requires the current base revision and `confirmed: true`.

Catalog snapshots are bounded SQLite-consistent images. Restore refuses stale
revisions, active jobs, unsafe storage, catalog/schema/hash failures, missing or
changed sources, and current locked asset/clip conflicts. Before publication it
creates a named checkpoint; failure recovery uses a private project journal.
Session Undo/Redo is unchanged and does not include project-level restore. See
[Named Versions](named-versions.md), [project format](project-format.md#named-versions)
and [validation](validation-named-versions.md).

### M8B motion candidate contract

- `MotionGenerationReceipt` v1 binds original/input/output hashes, target/revision,
  provider/model/cost status, prompt/negative hashes, consent, manual review and
  lifecycle; raw private prompt/media never belongs in logs or general artifacts.
- Provider result is bounded bytes, never a URL or project code. All remote motion
  descriptors are disabled. The fixture is camera motion, not AI generation.
- Preview is not adoption. Accept requires explicit manual detail review; Import
  uses existing managed catalog and typed commands, preserving duration/narration.
  Locks/required selection and source/revision fences remain authoritative.
- UUID claims, abort races, stale/project fences and durable prepared journals
  handle duplicates, late results and lost acknowledgments. Prepared recovery
  rederives whitelisted commands and requires the exact saved revision/document.
- Original files never change. Cache discard/24h expiry removes unadopted previews;
  adopted media/recovery journals remain for history/Named Versions. Expiry is
  swept at open/new preview/expired access, with no daemon for closed projects.

Details: [motion candidates](motion-candidates.md).

## NLE handoff v1

HandoffPlan/receipts version independently of project schema 1.0.0. Preserve
editability is default; opaque precomp/full-mix replacement is explicit and scoped
to reported ranges. Source/cut metadata survives every bake. Saved revision,
source stream identity/hash and safe private paths are fenced before atomic
publication; cancellation removes staging. Package media references are relative.
Unknown effects, unsupported alpha/stems, off-grid visual boundaries or missing/
changed media cannot publish a success. See [NLE handoff](nle-handoff.md).

## M7D Collect Media

`app.collectMedia` exposes shared `plan`, `coverage`, `create` and `verify` operations.
Plans select one saved Composition (`current-film`) or all saved
Stories/Compositions (`entire-project`), and report only referenced assets and
resolved fonts. Every resource needs a confirmed rights declaration before a
package can be marked complete. `create` is bound to both `planId` and
`baseRevision`; changed sources, project revisions, missing rights and unsafe
paths fail before publication. It does not move originals, include unselected
Library assets, or include Named Versions snapshots.

`POST /api/collect/plan` accepts `{scope, compositionId?, rightsDeclarations?}`.
`POST /api/collect/create` accepts that selection plus
`{planId, baseRevision, format: "zip" | "directory"}`; the server chooses a
unique destination inside the open project's `exports/` directory.
`POST /api/collect/verify` accepts `{packageName}` from that directory only.
Request cancellation aborts staged work, and server project switching remains
blocked until the operation's cleanup completes.

`POST /api/collect/coverage` accepts the scope/rights plus `projectId`,
`delivery:{version:1,mode,handlesSeconds}` and optional `expectedRevision`.
It returns a non-executable source projection and SHA-256 `coverageId`. Derived
Create additionally requires the exact `delivery`, `coverageId`, `projectId` and
`acceptDelivery:true`. Unknown options, changed hashes/revision or changed handles
invalidate acceptance before write. Default Create still produces compatible v1.
V2 packages carry closed original/derivative hash and piecewise clock receipts,
retained-original reasons and decoded MP4/PCM signatures. Lossless output must
match every selected original Composition; offline output preserves full clocks
and persistent `collect.offline-quality` warnings. Immutable transcript/graph
clocks, source locks and unproven conversions keep originals. Only private capture
bytes are converted; project schema and edit/history contracts do not change.
See [limits, threat boundaries and evidence](validation-collect-coverage.md).

The CLI uses `collect plan|coverage|create|verify --project <path>`; create requires
`--plan-id`, `--base-revision`, `--format`, `--destination`, and the same scope
and optional rights JSON used for planning. Verify accepts a local directory or
ZIP path. Both entry points call the same application service.

Portable package assets use opaque per-asset `openfilm-package://` references
and hash-addressed paths under `sources/`; collected font files and bindings
reside under `fonts/`. The external `collect-manifest.json` receipt lists
relative file paths, SHA-256/size pairs, asset/font references, rights
declarations, selected IDs and only digests of original URIs. The filtered
catalog snapshot retains selected transcript data, removes unrelated and
transient rows, and is vacuumed before packaging. Package Verify validates file
and catalog hashes, reopens in a private temporary root, renders a preview and
MP4, cross-checks the renderer's source/output receipt, decodes every frame and
uses FFprobe for frame/audio stream evidence. It does not certify another
workstation or NLE. See [Collect Media](collect-media.md) and
[validation](validation-collect-media.md).

## M7E native runtime boundary

RuntimeManifest schema v1 is independent of project schema 1.0.0. Native bridge
commands `native_runtime_start`, `native_runtime_status` and
`native_runtime_close` accept no media/project executable paths. Startup returns
a ready loopback port/private session only after verification. A numbered close
request is acknowledged or cancelled by the local window after existing draft
protection; application save/SQLite close and owned-process exit remain required.
Bundled transport uses `/native/<private-session>/api/...`; ordinary browser/CLI
service behavior is unchanged. No HTTP shutdown endpoint is introduced.
See [Native Installer](native-installer.md) for file/hash/license and update contracts.

## M7B versioned Export Profiles

`ExportProfile` v1 is a strict render-only record. It selects 16:9, 9:16 or
1:1 output dimensions, frame rate, contain or explicitly confirmed center crop,
subtitle review strategy, MP4/PNG/WAV/stems format, and the existing MP4 quality
choice. Dimensions are even, ratio-consistent, 64–4096 pixels and capped at
8.3 MP; frame rate is 1–60 fps. The record is not added to Composition or saved
project settings, so legacy schema-1.0.0 projects open unchanged.

Desktop, CLI and HTTP call `ExportProfileService`; stills and MP4 use the shared
FFmpeg renderer and selected existing look/caption contract. Preview tokens bind
the project ID/revision, Composition, profile, and source hashes; they expire
and are served only from private project cache. Crop requires a preview and
explicit confirmation. PNG is opaque and reports unsupported alpha. WAV mix and
role stems use the existing clip/`AudioAutomation` renderer graph and produce
aligned 48 kHz 24-bit PCM; unavailable roles produce no placeholder file.

Receipts record profile, saved revision and Composition hash, selected frame or
audio measurements, source hashes, warnings, and output hashes. Publication is
staged and atomic. Project export/cache directories reject symlinks, IDs are
path-safe, outputs are mode-restricted, and lost-response retries verify the
existing receipt and output bytes. Export jobs never mutate source files,
Composition geometry, project schema, or editing history. See
[Export Profiles](export-profiles.md) and the
[M7B validation record](validation-export-profiles.md).

## M9A Story Graph & Multi-Perspective Workspace

The Story Graph workspace establishes a non-destructive narrative canvas and visual
multi-perspective workflow (Outline, Story Graph, Storyboard) while keeping canonical
`Story` and `StoryBeat` definitions strictly authoritative.

### Canonical Story and Beat Integrity

- `Story` and `StoryBeat` remain the sole canonical source of truth for narrative
  structure, timing, script, and chosen candidate media.
- Graph nodes reference stable `storyId` and `beatId` via typed `StoryBeatNode` entries.
  Beat text, narration, and durations are never copied into divergent schemas.
- Playback order is driven strictly by explicit canonical beat ordering, never
  inferred from canvas `(x, y)` coordinates.

### Graph Nodes and Edge Semantics

- **Node Types**: Four distinct node types are supported: `theme` (thematic anchor),
  `beat` (story beat reference), `asset` (library media reference), and `idea` (creative
  thought or memory).
- **Idea Sources**: Idea nodes explicitly record their origin via `IdeaSource`:
  `user-memory`, `planned`, `wish`, or `unknown`.
- **Edge Types**: Five relationship types are supported: `contains`, `supports`,
  `precedes`, `echoes`, and `alternative`.
- **Cycle Validation**: `precedes` and `contains` relationships are validated against
  graph cycles upon addition and persist operations. Cyclic dependencies and
  self-referencing edges are rejected with typed validation errors.
- **Thematic Echoes**: `echoes` edges denote thematic resonance and are strictly
  non-execution relationships; they are excluded from execution dependency graphs.
- **Asset Protection**: Removing an asset node or connection from the graph never
  deletes or alters the underlying `MediaAsset` in the project library.

### Revision Separation

- Canvas presentation data (`GraphViewState`: pan, zoom, node coordinate positions,
  selected nodes/edges) is persisted separately in `cache/story-graph-views.json`.
- Dragging nodes, zooming, panning, or running auto-layout does not increment the
  project content revision, mutate `project.updatedAt`, or trigger any video rendering
  or external provider executions (0 render/provider calls).

### Multi-Perspective Workspace Synchronization

- The Story workspace features three synchronized views:
  1. **Outline (`outline`)**: Sequential script and candidate selection workflow.
  2. **Story Graph (`graph`)**: Interactive 3-column canvas (Assets palette, SVG/HTML
     graph canvas, Inspector) with search, auto-layout, layout undo, and quick actions.
  3. **Storyboard (`storyboard`)**: Visual sequence card grid displaying beat timing,
     narration, visual directions, media thumbnails, and timeline mapping status.
- Beat selection (`activeBeatId`) is bidirectionally preserved when switching between
  perspectives and locating clips on the Edit timeline.
- Media playback follows the strict privacy and resource rule: only the actively
  inspected media card allows playback; all other cards display static thumbnails.

## M9B Graph to Reviewable Storyboard (StoryPlan)

The StoryPlan pipeline compiles Story Graph selections and canonical beat sequences into a reviewable storyboard proposal (`StoryPlan`), supporting non-destructive preview, conflict resolution, and explicit adoption into a new rough cut (新試剪) while keeping original manual edits intact.

### Proposal Contract (Not a Second Timeline)

- `StoryPlan` is strictly an editorial proposal (`schemaVersion: '1.0.0'`), not a divergent Timeline or alternate renderer graph.
- Input state is sealed with `inputSignature`: a deterministic 64-character lowercase hex digest of canonical story beats, target duration, candidate graph nodes, and non-echo edges.
- Narrative order is strictly defined by canonical story beat sequences and explicit precedence edges. Canvas `(x, y)` coordinates are never used to infer narrative sequence.
- Each scene card (`StoryPlanScene`) provides exactly the 5 reviewable dimensions:
  1. **Assets & Roles (`assets`)**: references to library assets with roles (`hero`, `supporting`, `echo`), display thumbnails, and PhotoDepth support status (`supported`, `fallback-standard-hold`, `fallback-ken-burns`).
  2. **Narrative Intent (`intent`)**: explicit editorial purpose grounded in canonical beat and attached thought nodes.
  3. **Visual Direction (`visualDirection`)**: staging, camera motivation, and shot presentation.
  4. **Duration & Pacing (`targetDuration`, `estimatedDuration`)**: target cut duration and CJK/Latin character-paced estimated narration timing (~3.5 CJK chars/sec, ~2.5 Latin words/sec). Microsecond fake precision timings are disallowed for unrecorded narration.
  5. **Editorial Rationale (`rationale`)**: qualitative storytelling reasons; numerical pseudo-aesthetic scores are strictly forbidden.

### Narrative Protections & Solver Extensions

- **Thematic Echoes**: When a photo appears at both opening and closing (echo), solver receives explicit `allowEchoAssetIds` containing the asset ID. The rough cut produces distinct `Clip` instances referencing the same underlying `MediaAsset` without fabricating fake asset IDs or disabling deduplication globally.
- **Source Nature Preservation**: Idea nodes explicitly distinguish `user-memory`, `planned`, `wish`, and `unknown` sources. Wishes, plans, and chat excerpts are never conflated into established factual occurrences.
- **Unresolved Conflict Rejection**: Graph cycles and unresolved `alternative` paths are surfaced as actionable blocking conflicts (`conflicts`, `unresolvedAlternatives`, `detectedCycles`). Adoption is rejected with HTTP 409 until resolved.
- **Unsupported Intent Transparency**: Freeform creative text requirements not supported by current templates or effects are surfaced in `unsupportedIntents` rather than being silently substituted with inaccurate effects.
- **PhotoDepth Degradation**: When depth maps are unconfigured or unavailable, clear fallback modes (`standard-hold`, `ken-burns`) are indicated without synthesizing fake depth geometry.

### Preview and Explicit Adoption

- **Preview Endpoint (`POST /api/stories/:id/plan/preview`)**: Generates an ephemeral preview `Composition` using `@openfilm/solver` with 0 project mutations and 0 provider calls.
- **Adoption Endpoint (`POST /api/stories/:id/plan/accept`)**:
  - Validates `planId` and matches current `inputSignature`. If graph or beats have changed since plan generation, adoption fails with HTTP 409 Stale Plan.
  - Generates a new rough cut `Composition` titled `${story.title} (Story Plan Cut)` scoped strictly to the plan's `candidateAssetIds`.
  - Leaves the user's original manual timeline and existing rough cuts completely untouched.
  - Idempotent: repeated submissions with the same `planId` return the existing adoption result without creating duplicate compositions.
  - Stores a durable `StoryPlanAcceptanceMapping` binding proposal scene IDs to created clip IDs and track IDs.

## M10A Guided Pipeline Orchestration

The Guided Pipeline Orchestration engine executes fixed, recipe-driven production workflows reusing existing application services, catalog `Job`s, `ReviewExecutionOwner`, `ProviderRegistry`, renderer, and Visual QA.

### Recipe and Port Contracts

- **Recipe Schema (`PipelineRecipe`)**: Versioned (`schemaVersion: "1.0.0"`), identified by stable ID, version string, human-readable name, and an ordered list of step definitions (`PipelineStepDefinition`).
- **Whitelisted Step Types**: Strict whitelist enforcement (`ALLOWED_PIPELINE_STEP_TYPES`):
  1. `story-plan-select`: Selection and validation of story / story plan and candidate asset references.
  2. `scene-prepare`: Visual framing, photo aspect ratio checks, PhotoDepth fallback assessment, and remote motion availability verification.
  3. `narration`: Voice narration strategy (none, user-imported audio asset, or configured remote TTS). _Tone mock (`local-audio-mock`) is strictly prohibited from masquerading as speech narration._
  4. `timing-captions`: Duration matching and subtitle/caption alignment.
  5. `composition-adopt`: Adoption of rough cut composition using legal receipts advancing `expectedRevision`.
  6. `render`: Sequential heavy video rendering (concurrency = 1 lock).
  7. `visual-qa`: Automated Visual QA inspection; triggers `waiting-review` when issues or warnings are discovered.
  8. `export`: Final explicit export to specified target profile and destination.
- **Typed Ports & DAG Integrity**: Inputs and outputs specify explicit port types (`story-reference`, `story-plan`, `asset-list`, `scene-prep-result`, `audio-source`, `timing-result`, `composition`, `render-artifact`, `qa-report`, `export-artifact`). Recipes are validated for topological acyclicity; circular step dependencies are rejected with typed validation errors.

### Execution State vs. Result Freshness

- **Immutable Input Snapshots**: Each `PipelineRun` contains an immutable `inputSnapshot` capturing the project revision, story ID, asset IDs, narration strategy, and export format, sealed with a deterministic 64-character lowercase hex digest (`computeInputSnapshotDigest`).
- **State Separation (`succeeded !== current`)**:
  - A run's completion state (`idle`, `running`, `waiting-review`, `succeeded`, `failed`, `cancelled`) reflects execution lifecycle.
  - A run's freshness state (`current`, `outdated`, `stale`) reflects applicability relative to current project content.
  - External modifications to project title, beats, or assets increment project revision, rendering prior runs `outdated` via `isRunOutdated` without rewriting historical records.
- **Legal Adoption Receipts**: Step 5 (`composition-adopt`) creates a canonical `PipelineRunReceipt` documenting composition creation and atomically advances `expectedRevision` to match the newly adopted project state, preventing legitimate run modifications from being flagged as stale.

### Concurrency, Recovery, and Side-Effect Guards

- **Concurrency = 1 for Heavy Media**: Heavy video rendering and solver operations are serialized through a dedicated single-flight execution lock (`heavyLock`).
- **Zero-Lock Review Gates**: Steps entering `waiting-review` release all write locks and do not hold active child subprocesses. Polling `getRun` is strictly read-only and never spawns background tasks or increments revisions.
- **Cancellation & Late Result Protection**: `cancelRun` broadcasts an `AbortSignal` to active tasks. Subprocess results arriving after cancellation are discarded.
- **Durable Persistence Across Reopen**: Pipeline runs are persisted to disk (`cache/pipeline-runs.json`). Reopening the application restores runs without marking running or review processes as dead simply due to UI reload.
- **Retry vs. New Run**:
  - `retryRun`: Reruns a failed or cancelled run with the _identical_ immutable `inputSnapshot`, incrementing the step `attemptNumber`.
  - `createRun`: Creates an entirely new run capturing current project revision and inputs.
- **Idempotent Execution**: Calling `startRun` on an already succeeded run returns the completed run immediately without re-triggering side effects or duplicating compositions.

## M10B Pipeline Workbench UI/UX

The Pipeline Workbench (`PipelineWorkbench.vue`) elevates the Phase M10A orchestration engine into an interactive, multi-modal film production workbench that integrates non-destructively into the creator's workspace.

### Information Architecture & Three Modes

- **Workspace Invariance**: Preserves existing `Library`, `Story`, `Edit`, `Export`, and `Versions` workspaces without displacing the user's ongoing creative context.
- **Three Progressive Modes**:
  1. **Docked Status Bar (`bar`)**: Compact status bar docked at the bottom of the workspace. Shows the active 5-stage progress indicator, run status chip, outdated warning pill, and immediate one-click CTAs.
  2. **Expandable Drawer (`drawer`)**: Slides up smoothly over the lower portion of the screen (~52vh), enabling simultaneous inspection of the Story Graph, Storyboard, Timeline, or Library while configuring the pipeline.
  3. **Full-Viewport Modal (`modal`)**: Fullscreen view for focused, immersive inspection, parameter adjustment, and review decisions.
- **Simplified 5 Stages**:
  - `materials`: Selection and verification of library photos, videos, and audio candidates.
  - `storyPlan`: Selection of canonical story, beat structure, timing, and PhotoDepth fallback.
  - `produceClips`: Narration strategy (none, user voice recording with inline audition, or remote TTS with consent), timing, and rough cut composition adoption.
  - `previewQa`: Sequential video render preview and Visual QA report with timecoded issue inspection.
  - `export`: Final film packaging to MP4 1080p.
- **Collapsible Sub-Steps & Dependencies**: Expanding reveals the underlying 8 canonical pipeline steps (`story-plan-select`, `scene-prepare`, `narration`, `timing-captions`, `composition-adopt`, `render`, `visual-qa`, `export`), typed ports, and execution attempt records.

### Card Standard & Media Protections

- **Four Questions Answered per Stage**:
  1. **What was used (`usedWhat`)**: Input media, story references, narration audio files, and export profiles.
  2. **What was produced (`producedWhat`)**: Adopted rough cut compositions, rendered video previews, QA reports, and export packages.
  3. **Current status (`currentStatus`)**: Clear human-readable status badge (`pending`, `running`, `waiting-review`, `succeeded`, `failed`, `outdated`).
  4. **Next action (`nextAction`)**: Context-dependent CTA button (supplement audio, review & confirm, adopt rough cut, retry step, export).
- **Media Playback Safeguards**:
  - Images: Displayed strictly as static thumbnails (`thumbnailUrl`).
  - Audio: Inline mini audition player (`auditionPlay`/`auditionPause`) with elapsed time and duration tracking.
  - Video: Static poster preview; video playback occurs only when the user explicitly clicks the play overlay. Unselected cards never auto-play.
- **Outdated Revision Transparency**: Completed runs whose source drafts have changed externally are marked with an amber warning banner (`outdated`) and a CTA to "Create New Run from Current Draft". Historical runs never masquerade as latest outputs.
- **Progress & Error Diagnostics**:
  - Waiting-review states display explicit action prompts without continuous infinite spinners.
  - In-progress runs with dynamic duration use indeterminate progress bars rather than fabricating completion percentages.
  - Failed steps display the failing step name, concrete failure reason, and actionable recovery CTAs (e.g. import recording, retry).

### Cross-View Navigation & Form Integrity

- **Bidirectional Locating**:
  - `[Locate in Story Graph]`: Switches to Story workspace with graph perspective, selecting the relevant beat node.
  - `[Locate in Storyboard]`: Switches to Story workspace with storyboard card grid perspective.
  - `[Locate on Timeline]`: Switches to Edit workspace, maintaining focus on the adopted rough cut clip.
  - Returning to the workbench preserves previous selections, viewports, and scroll positions.
- **Polling & Form Safety**: Background status polling (`getRun`) updates reactive run state without remounting the editor, wiping dirty drafts, or resetting uncommitted input fields.

### Usability, Accessibility, and Disclosures

- **Responsive Breakpoints**:
  - `1440×900`: Three-pane layout (stages navigation, active stage card, inspector/sub-steps).
  - `1280×720`: Two-pane collapsible layout.
  - `1024×768`: Single-pane stacked drawer with stage outline list.
- **Keyboard & IME Protection**: Keyboard listeners explicitly check event targets; keystrokes inside `input`, `textarea`, or contenteditable elements are never swallowed by global hotkeys. Number keys `1`..`5` switch stages when outside form inputs; `Escape` collapses modal/drawer.
- **Reduced Motion**: Disables transitions and animations when `@media (prefers-reduced-motion: reduce)` is active.
- **External Provider Consent**: Prior to transmitting script text to external TTS services, displays data categories, target destination, estimated cost, and requires explicit user checkbox consent.
- **Cache Transparency**: Discloses that fine-grained partial cache reuse is governed by verified per-step input signatures (Phase M11A), preventing unverified assumptions.

## M11A Change Impact and Incremental Runs

Phase M11A establishes fine-grained change impact analysis, verified artifact reuse, and incremental pipeline execution across video production workflows.

### Separation of Concerns: Project Revision vs. Per-Step Consumed Signature

- **Project Revision (`expectedRevision` / `revision`)**:
  - Used exclusively for checking rough-cut adoption permissions and detecting overall draft freshness (`isRunOutdated`).
  - A whole-project revision bump (e.g., editing a subtitle line or adding an unconsumed beat idea) **must not** invalidate unaffected pipeline steps wholesale.
- **Per-Step Consumed-Input Signature (`computeStepConsumedSignature`)**:
  - Determines artifact reusability strictly based on the exact inputs consumed by that specific step.
  - Computed via deterministic canonicalization (sorted object keys, normalized primitives, recursive arrays) fed into a 64-character lowercase hex digest mixer (`fnv1a64Mix`).
  - Stamped onto `PipelineStepAttempt.inputSignature` and `PipelineArtifactRecord.inputSignature`.

### Change Impact Matrix (8 Canonical Invalidation Cases)

1. **Canvas pan/zoom/fold (`GraphViewState`)**:
   - Updates viewport offsets and folded node states in `cache/story-graph-views.json`.
   - Produces **0 media calls** and **100% artifact reuse**.
2. **Unconsumed notes / draft ideas**:
   - Notes or draft ideas not linked into the active story plan or pipeline inputs do not alter step signatures.
   - Produces **0 media calls** and **100% artifact reuse**.
3. **Subtitle text / style modified**:
   - `timing-captions`, `render`, `visual-qa`, and `export` steps rerun.
   - Narration voice audio and photo visual candidates are completely preserved (**0 TTS calls, 0 motion calls**).
   - Generates verified output MP4 reflecting updated subtitle styling while reusing existing audio tracks.
4. **Narration script modified (rerun requested)**:
   - `narration`, `timing-captions`, `composition-adopt`, `render`, `visual-qa`, and `export` steps rerun.
   - Visual candidate assets and `scene-prepare` artifacts are completely preserved.
5. **Photo changed / PhotoDepth changed**:
   - `scene-prepare`, `render`, `visual-qa`, and `export` steps rerun.
   - Voice narration audio is completely preserved (**0 TTS calls**).
6. **Output aspect ratio changed**:
   - Delivery framing, safe areas, `render`, `visual-qa`, and `export` steps rerun.
   - Voice narration audio is completely preserved.
7. **Source bytes, font, or adapter version changed**:
   - Any modification to source media bytes (`asset.hash`), font files, or adapter version invalidates all downstream consumers.
8. **Consent / capability revoked**:
   - Revoking external service consent or credentials invalidates remote steps.
   - A cached artifact **cannot** authorize new remote dispatches or bypass user consent.

### Verified Artifact Reuse Before Cache Hit

Before any artifact from a prior run is reused, `verifyArtifactForReuse` strictly verifies:

1. **Input Signature Equality**: The current step's computed consumed-input signature matches the recorded `artifact.inputSignature`.
2. **Disk Existence & Non-Zero Bytes**: The physical artifact file exists at its resolved path on disk and has `stat.size > 0`.
3. **Byte Size Integrity (Tampering Detection)**: The on-disk file size matches `artifact.sizeBytes`. If corrupted, truncated, or tampered with, the check fails closed with a cache miss fallback.
4. **Referenced Asset Availability**: All catalog media assets consumed by the step still exist in the project catalog.
5. **Adapter Version & Capability**: The adapter version matches current runtime expectations.
6. **Consent & Scope**: Required permissions and speech consent remain actively granted.

### Full-Render Fallback Transparency

- When composition or subtitle changes require re-rendering, OpenFilm reports `renderMode: "full-render-fallback"`.
- OpenFilm **never claims** to splice in-place bitstream MP4 frames or hack video containers without re-rasterization.
- When existing adapters do not support bitstream-level delta splicing, full-render rasterization is explicitly disclosed in the impact report.

### Immutable History & Asset Protection

- **User Confirmation Creates a New Run**: Confirming an incremental run creates a brand new `PipelineRun` with a fresh `runId` and updated `inputSnapshot`.
- **Historical Immutability**: Previous runs, attempts, and receipts remain completely untouched. Old manifests are never renamed or disguised.
- **Provenance Stamping**: Reused step attempts are recorded with `status: "succeeded"`, their verified `inputSignature`, and metadata `reuseSource: { runId, stepId, reason }`.
- **Asset Pruning Protection**: `isAssetReferencedByPipeline` checks all historical snapshots, step attempts, and artifact records to ensure media referenced by any pipeline run cannot be deleted or pruned.

## M11B Creative Variants and A/B Review

Phase M11B introduces creative variant branching, side-by-side A/B review, lock preservation, zero-render comparison, pre-adoption version checkpoints, baseline restoration, and media collection privacy.

### Three Distinct Versioning Concepts

1. **Project Snapshot (`ProjectVersionRecord`)**:
   - Managed by `app.versions`. Persists immutable point-in-time full project snapshots with name, revision, and timestamp.
2. **Session Undo/Redo**:
   - In-memory ephemeral stack tracking user interactions and mutations within an active editing session.
3. **Creative Variant (`CreativeVariant`)**:
   - Structured alternative creative branches exploring different pacing, scene focus, or narration scripts.
   - Stored in `cache/creative-variants.json`.
   - References existing `MediaAsset`s, Story, and Composition records.
   - **Does NOT duplicate raw media files** and **does NOT create a secondary version database**.

### Scope and "只改本段" Section Isolation Proof

- When creating a variant with `scope.type === "section"`:
  - The variant targets a single specified beat/section.
  - All non-target beats and clips are provably preserved (`preservedSections`).
  - Preserved clips maintain exact media asset ID, filters, transforms, and timing relative to preceding cursor offsets.
  - Modifying a section containing locked clips (`clip.locked === true`) without prior unlocking is rejected with HTTP 409 (`timeline.conflict`). Cloned variant clips strictly inherit lock flags.

### Zero-Render A/B Comparison and Single-Audio Rule

- **Zero-Render Comparison**:
  - Comparing variants (`compareVariants`) evaluates existing composition models, story structures, and previously generated pipeline artifacts (preview MP4, visual QA reports).
  - Comparison **never** triggers media rendering, re-rasterization, or external service calls ("開比較不重新生成").
- **Single-Audio Playback Rule**:
  - The UI and player strictly enforce that only **one** variant audio channel plays at any time. Selecting Audio A mutes/pauses Audio B; selecting Audio B mutes/pauses Audio A.
- **Section-Based Timeline Alignment**:
  - When comparing variants with different overall durations, navigation aligns by section/beat chips. OpenFilm **never** falsely claims differing runtimes align at identical absolute timestamps.

### Pre-Adoption Checkpoint & Safe Reversion

- **Mandatory Pre-Adoption Checkpoint**:
  - Adopting a variant (`adoptVariant`) verifies source availability, edit locks, and expected revision before mutating the active project.
  - A named checkpoint version (`app.versions.create`) is created automatically _before_ the variant composition is promoted to `timelines[0]`.
  - If checkpoint creation fails, adoption immediately aborts and the project remains completely untouched.
- **Post-Restore Invalidation**:
  - When a user restores a baseline checkpoint (`app.versions.restore`), the project revision reverts.
  - Old pipeline runs, approval receipts, and adopted variant references targeting superseded revisions are marked `outdated` and cannot be re-adopted.

### Shared Media Safety & Collect Media Privacy

- **Catalog Media Protection**:
  - Deleting a creative variant deletes only its derived Story, derived Composition, and variant record.
  - Shared catalog `MediaAsset`s are **never deleted or pruned**.
- **Collect Media Privacy**:
  - When collecting media for a variant (`app.collectMedia.plan({ scope: "current-film", compositionId })`), only media assets directly referenced by that specific composition are packaged.
  - Private assets used exclusively in other variants or unconsumed library media are strictly excluded.

## Story Graph × Pipeline End-to-End Product Acceptance

Phase M9A–M11B product acceptance verifies the complete creative workflow across Story Graph, StoryPlan storyboard proposal, guided pipeline orchestration, change impact analysis, and creative variants.

### Fixed Synthetic Fixture Specification

- **6 Synthetic Images**: 1280×720 synthetic JPEG images (`photo_1` through `photo_6`), each with unique content hashes, dimensions, timestamps, and realistic Jiufen hiking trail GPS coordinates (`GeoPoint`).
- **3 Fictional Memories**: Personal reflective thoughts (`user-memory`, `wish`) capturing personal nostalgia and future wishes without conflation into historical facts.
- **3 Fictional Conversations**: Dialogue excerpts (`planned`) reflecting intentions and advice from companions, tea house owners, and guides.
- **Schematic Route**: Explicit graph edges (`precedes`, `echoes`, `contains`) mapping the narrative progression without canvas coordinate guesswork.
- **Reproducible WAV Guide Tone**: 30.0-second 16-bit PCM Mono 44.1 kHz sinusoidal WAV tone. Explicitly labeled `tone` across all metadata; never masquerades as human speech.
- **Manual Traditional Chinese Subtitles**: Authentic localized strings aligned to scene intentions and visual directions.
- **Frame Calculation**: 30.0 seconds at 30 fps yielding exactly **900 frames** under default 1280×720 resolution.

### Verified Workflow Guarantees

1. **Explicit Sequence & Echo Preservation**: Sequences are strictly governed by explicit graph edges (`precedes`); cycles and unresolved alternatives fail closed. Opening and closing echo clips reference distinct clip instances without duplicating media assets or bypassing deduplication.
2. **Non-Destructive Storyboard Adoption**: `StoryPlan` generates a proposal card deck without touching existing timelines; adopting a plan creates a new rough cut (新試剪) while preserving manual edits.
3. **Pipeline Review Gates**: Pipeline runs pause at required review steps (`waiting-review`); review state holds no subprocesses or locks.
4. **Change Impact & Zero-Cost Reuse**: Subtitle-only modifications reuse 100% of upstream visual preparation and narration audio, proving `ttsCalls === 0` and `motionCalls === 0`.
5. **Fault Injection Resilience**: Cancellation halts runs immediately; retry retains identical input snapshots; source data tampering triggers cache miss fallbacks; version restoration marks superseded runs as outdated.
6. **Zero-Render A/B Review & Safe Reversion**: Variant comparison inspects existing models and artifacts with `renderCalls === 0`; adoption creates automatic checkpoints; baseline restoration rolls back cleanly to Baseline A.
7. **Privacy Isolation**: Collect Media strictly isolates the assets of the active film from other variants or private catalog items.

## D6A private preview cache

- `Job.proxyCache` is a closed version-1 operational contract, excluded wherever
  existing portable/snapshot projections exclude jobs. Private receipts, policy,
  work, owner/read leases and preferences stay in cache and are not film data.
- A preview rebuild cannot mutate canonical source records, locks, Composition,
  Undo/Redo or autosave. Initial import may attach its existing proxy reference.
- Requests bind project/request/body; at most 128 tasks are queued/running and
  one owned worker runs. Running cancellation remains pending until its owner
  stops. Unknown/live execution ownership is never silently reclaimed.
- Receipts bind source hash, decoder recipe/metadata and output hash/size/path.
  Publication additionally binds the source locator, task owner and generation.
  Unknown versions or unsafe paths cannot authorize output, read or cleanup.
- Managed streaming holds a reader lease and verifies bytes; invalid managed
  pointers cannot fall through as legacy cache aliases. Compatible originals
  remain usable; HDR/HEVC retains its compatible-preview requirement.
- Review cleanup before explicit accept. Changed protection, policy, source,
  receipt or output invalidates acceptance. CLI saved reviews require exact
  revalidation and ten-minute expiry. Partial I/O reports actual removed bytes.
- Quota applies to managed preview artifacts; legacy and temporary usage are
  disclosed separately. No original-source deletion or export from proxies.
