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
proxies?:boolean}): Promise<{job:Job,imported:number,skipped:number,failed:number}>`,
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
