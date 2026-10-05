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
