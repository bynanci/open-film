# Integration contracts for v0.1

All quantities called duration/sourceIn/sourceOut/timelineStart/timelineDuration
are seconds. Capture timestamps are ISO 8601 with provenance/confidence.

`@openfilm/core` exports:

- `MediaAsset`: `id`, `uri`, `mediaType: image|video|audio|360-video`, `name`,
  `capturedAt?`, `capturedAtConfidence?`, `capturedAtSource?`, `duration?`,
  `dimensions?`, `frameRate?`, `codec?`, `contentHash?`, `perceptualHash?`,
  `tags: string[]`, `rating?: number` (0–5), `state: {favorite?,rejected?,locked?}`,
  `metadata: Record<string, unknown>`, `thumbnailUri?`, `proxyUri?`, `gps?`.
- `OpenFilmProject`: `schemaVersion: '1.0.0'`, `id`, `title`, `createdAt`,
  `updatedAt`, `mediaLibraries`, `stories: Story[]`, `timelines: Composition[]`,
  `settings: {width,height,frameRate}`. `MediaLibrary` has `id`, `uri`, `name`.
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
project schema 1.0.0 or catalog schema v5. It binds a stable version ID,
project ID, request ID, saved project revision, manifest/catalog SHA-256,
catalog schema version, software version and a sorted source-reference manifest
containing only asset IDs, hashes, sizes, media types and managed/external kind.
Absolute media paths and credentials are excluded. Version content is immutable;
renaming changes only private index metadata.

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

`app.collectMedia` exposes shared `plan`, `create` and `verify` operations.
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

The CLI uses `collect plan|create|verify --project <path>`; create requires
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
