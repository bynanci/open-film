# D5A — Photo finishing

Status: proposed interfaces for coordinator approval; product implementation has
not started. Base: `e1255b1a8a83260149211d909cca8c1a50948c6b` (PR #69).
Owner: the existing nested D5A/F05 item in `TASKS.md`; this document adds no queue.

## Outcome and existing owners

An editor can set a photo's focal point directly in the Monitor, choose a bounded
custom camera easing, and place a blurred, darkened rendition behind the sharp
photo. Accepted edits remain ordinary saved Composition data with existing
commands, source protections, history, autosave and reopening.

The current implementation already has normalized focal/protected rectangles,
contain/hero/diptych layouts, hold/push-in/pull-out/pan, linear/smoothstep easing,
arbitrary seeks, and floating point FFmpeg perspective with cubic interpolation.
`packages/core/src/presentation.ts` owns layout and endpoint safety;
`PhotoPresentationPreview.vue` and `packages/render/src/photo-filters.ts` consume
it. GraphicScene PhotoDepth owns its separate original/mask/fill/protected-subject
recipe and fallback. D5A extends these owners without recreating those features.

Inspection found these integration constraints:

- `PhotoLayout` and `PhotoMotion` are strict version-1 objects today. Unknown
  fields and versions fail validation. Missing recipes give contain/identity.
- `PhotoPresentationInspector.vue:setLayout` reconstructs a version-1 object;
  changing it without preserving new fields would erase an ambient recipe.
- Story Monitor uses a separate image path for a photo without presentation;
  Record Monitor already uses `PhotoPresentationPreview` for all stills.
- `useTimelineEditor.commitTransaction` awaits history/flush, then chooses the
  latest revision. A drag needs an optional check against its captured revision
  after those awaits to prevent implicit rebasing.
- Composition data is in `project.json`. `TimelineEditor.persist` validates the
  project and publishes through `OpenFilmApplication.saveSync`, whose SQLite
  `withProjectWrite` lock protects the manifest CAS and atomic publication. There
  is no Composition table or separate presentation pin to migrate.
- Source replacement intentionally clears layout/motion; photos cannot be split
  or source-trimmed. Protected regeneration retains the complete existing clip.
  D5A keeps these established semantics.

## Approaches and recommendation

1. Extend version-1 objects and use CSS blur beside FFmpeg blur. This is small,
   but changes the meaning of an existing version and leaves blur/edge behavior
   dependent on browser filters.
2. **Recommended: additive version-2 recipes, shared core easing, and one raw
   ambient preparation function used by both Monitor PNG and MP4.** Old objects
   remain exact, the new behavior is explicit, and the same bounded raster and
   geometry enter both adapters. This adds a local preview endpoint and private
   preparation work.
3. Express every photo as a new GraphicScene/PhotoDepth recipe. This would move
   existing framing, locks and commands to another owner and duplicate the photo
   contract. It does not fit this milestone.

Recommendation and all defaults below are builder proposals, pending coordinator
approval. No new dependencies, network service, second timeline, executable
project expressions, arbitrary HTML/SVG, or writes to original media are needed.

## Portable contracts

Keep the exact current fields as `PhotoLayoutV1` and `PhotoMotionV1`. Export these
additions from `packages/core/src/models.ts` and the existing core entry point:

```ts
interface PhotoAmbientFillV1 {
  version: 1;
  kind: "ambient";
  /** Gaussian sigma as a fraction of the composition's shorter edge. */
  blurSigma: number;
  /** Encoded SDR RGB multiplier is 1 - dim; alpha is handled separately. */
  dim: number;
}
interface PhotoLayoutV2 extends Omit<PhotoLayoutV1, "version"> {
  version: 2;
  fill: PhotoAmbientFillV1;
}
type PhotoLayout = PhotoLayoutV1 | PhotoLayoutV2;

interface PhotoBezierEasingV1 {
  version: 1;
  kind: "cubic-bezier";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface PhotoMotionV2 extends Omit<PhotoMotionV1, "version" | "easing"> {
  version: 2;
  easing: PhotoBezierEasingV1;
}
type PhotoMotion = PhotoMotionV1 | PhotoMotionV2;
type PhotoEasing = PhotoMotion["easing"];
```

- Ambient `blurSigma` is finite in `[0, 0.05]`, `dim` finite in `[0, 0.85]`.
  Explicit creation defaults are `blurSigma: 0.02`, `dim: 0.45`.
- Bézier coordinates are finite in `[0, 1]`, with `x1 <= x2` and `y1 <= y2`.
  Endpoints are fixed at `(0,0)` and `(1,1)`. Equal handles and endpoint-flat
  curves are valid. The ordered bound deliberately excludes crossing handles,
  overshoot, bounce, discontinuities and arbitrary path strings. Initial custom
  handles are `(0.42,0)` and `(0.58,1)`.
- Version 1 accepts only its current fixed easing strings and current layout
  keys. Version 2 requires its new object. Nested unknown versions/fields,
  missing values, arrays, strings-as-numbers, infinities and NaN fail closed.
- Removing fill explicitly converts layout v2 to the equivalent v1 object.
  Selecting a fixed easing explicitly converts motion v2 to v1. Focal, protected
  rectangle, gap, secondary selection and preset edits preserve untouched fields
  and versions. Changing a motion preset preserves an existing custom easing.
- No project-schema or SQLite-schema bump. No reader migration fills absent
  properties or rewrites old recipes. New readers open legacy projects with the
  same identity defaults. Old binaries may reject newly authored v2 projects;
  forward readability is not promised.
- `validatePhotoLayout`, `validatePhotoMotion`, Composition/project parsing,
  direction-receipt parsing and command parsing all use the same discriminated
  validation. Scene Direction continues to emit its existing v1 recipes.

## Shared math and rendering

`packages/core/src/photo-easing.ts` exports
`PHOTO_BEZIER_BISECTION_STEPS = 24` and
`evaluatePhotoEasing(easing: PhotoEasing, progress: number): number`.
It rejects nonfinite progress, clamps to `[0,1]`, returns exact endpoint values,
and preserves the existing linear and smoothstep formulas exactly. For custom
easing, evaluate `B(t;a,b)=3(1-t)^2*t*a+3(1-t)*t^2*b+t^3`; bisect `Bx(t)=p`
for exactly 24 iterations, using `Bx(mid) < p` to update the lower bound, then
evaluate `By` at the final midpoint. No state depends on previous samples.
`evaluateClipAtTime` keeps its current `localTime / timelineDuration` clock.

`packages/render/src/photo-easing.ts` exports
`photoEasingExpression(easing: PhotoEasing, progressExpression: string): string`.
The progress expression is a renderer-owned constant, never project input.
The generated custom expression resets `st`/`ld` registers, performs the same 24
bounded iterations using `while`, and uses round-trip numeric literals from
validated handles. Each perspective corner evaluates independently. Preserve
`(on-1)/frameRate/timelineDuration`, exact endpoints, floating point perspective,
and cubic pixel interpolation. Do not replace the camera with integer zoompan,
browser-only easing, per-frame JS animation state or a large sampled curve.

The 2026-10-30 disposable spike used actual FFmpeg 7.1.5 perspective with six
curves and 257 samples per curve, including `x1=x2=0` and `x1=x2=1`.
Every printed result matched the reference within `5.0e-7`, the resolution of
FFmpeg's six-decimal `print` output; endpoints were exactly 0 and 1. Expressions
were 404–406 bytes. Evidence is local at
`/tmp/openfilm-d5a-easing-spike-jgl23mwy/evidence.json` plus six FFmpeg logs.
This establishes local expression support, not FFmpeg 6.1 or OS parity; the
implementation must run the same focused expression proof in those CI lanes.

`PhotoPlan` gains an **optional** `ambient` field only for layout v2:

```ts
interface PhotoAmbientLayer {
  assetId: string;
  cell: { x: number; y: number; width: number; height: number };
  cover: PhotoLayer;
}
interface PhotoAmbientPlan {
  version: 1;
  layers: PhotoAmbientLayer[];
  sigma: number; // blurSigma * min(frame.width, frame.height)
  dim: number;
}
// PhotoPlan.ambient?: PhotoAmbientPlan
```

The existing resolver creates centered cover geometry for each existing layout
cell. A single photo has one cell; diptych has two independent source cells and
keeps its black gap. Decorative fill does not use focal/protected cropping or
alter the foreground safety result. Clip cell boundaries by rounded left/right
and top/bottom edges; v2 cells must be at least one output pixel. Application
preflight checks this against the actual project frame before mutation.

`packages/render/src/photo-ambient.ts` exports
`preparePhotoAmbientFills(clips: readonly Clip[], assets: readonly MediaAsset[],
frame: FrameSize, work: string, options?: { signal?: AbortSignal }):
Promise<PreparedPhotoAmbientFills>`. The result contains:

- `fills: Map<string, { path: string; sha256: string }>` keyed by clip ID;
- `assetOverrides: Map<string, MediaAsset>` pointing to owned verified copies;
- `sources: { assetId: string; sha256: string }[]`;
- `verifySources(): Promise<void>` and `assertSourceIdentities(): Promise<void>`.

Only v2 fills trigger preparation. Reuse `withVerifiedSourceFile` and
`inspectGraphicImage` for admitted local PNG/JPEG/WebP bytes, full hashes,
private snapshots, codec/pixel admission and source-alpha behavior. Retain the
admitted private copy under the caller's work directory after the verification
callback exits; both foreground inputs and fill use that copy. Deduplicate
source copies within the call. Rehash originals and assert captured file/asset
identities before success, retaining existing render snapshot checks as well.

Each cell is decoded using `previewVideoFilters` (including display orientation,
SAR and the existing supported SDR conversion), flattened over opaque black for
the decorative fill, centered-cover fitted, cropped to its cell, blurred with
`gblur=sigma=<shared sigma>:steps=3`, then RGB multiplied by `1-dim`. Sigma zero
omits blur. Compose the cells on an opaque black full-frame PNG. Source alpha in
the sharp foreground remains intact.

**The ambient intermediate contains raw source appearance before primary color
or Film Looks.** Combine raw foreground and ambient, then apply the coordinated
primary → Film Look group once, then the existing motion/static transform and
transition compositing. Native titles/captions/GraphicScene overlays follow in
their existing order and are outside the photo's color group. There is no look
baked into the fill key, so Record Monitor look bypass uses the same raw PNG.
D5C owns primary coefficients; D5A adds no parallel color implementation. The
legacy absent/v1 branch retains current output behavior and identity defaults.

## Local preparation ownership and failure behavior

Ambient preparation uses the existing still-image bounds: source bytes at most
64 MiB, decoded source pixels at most 32,000,000, output frame pixels at most
8,294,400, positive integer frame dimensions. These bounds affect the new fill
operation, not reopening or plain legacy photo rendering. Per preparation call,
owned source copies total at most 1 GiB and ambient PNGs at most 256 MiB, checked
before publication; an individual PNG is at most 64 MiB. No frame-sized sequence
or per-seek background render is generated. Failure is explicit and preserves
the saved recipe for correction.

`PhotoPresentationService` in `packages/application/src/photo-presentation.ts`
owns transient Monitor preparation, with
`ambient(compositionId: string, clipId: string, input: PhotoAmbientInput):
Promise<Buffer>` and `close(): void`.
`PhotoAmbientInput` is `{ projectId: string; baseRevision: string;
signal?: AbortSignal }`. Read the exact saved clip/settings/catalog assets;
accept no request-supplied source URI, layout, curve, filter, path or HTML.
Use the same raw preparation function as the renderer.

The GET endpoint is
`/api/compositions/:compositionId/photo-fill/:clipId.png?projectId=...&revision=...`.
`photoFillPreviewUrl(compositionId, clipId, revision, projectId)` in the existing
Desktop API module constructs it. Match project and revision before work and
immediately before returning, including saved-disk/settings/source identities
as in `GraphicSceneService`. The server also checks the currently open
application instance. Use `Cache-Control: no-store`; no portable URI is saved.

The service has one worker, up to four distinct pending keys, exact-request
deduplication and no persistent PNG cache. A key includes the captured project,
composition, clip, revision, frame, fill recipe and source/decode identities.
At most one completed result per in-flight key is shared with its waiters.
Abort queued work on disconnect; cancel a shared worker only after its last
waiter leaves. Project close aborts all work, fences late results and cleans
owned private directories. Busy overflow returns `jobs.busy`/409 with a retry
control. Stale/project mismatch returns `timeline.conflict`/409; bad recipe
`request.invalid`/400; missing/unsupported preparation `media.previewUnavailable`
/422; resource bounds `request.tooLarge`/413; hash changes `source.changed`/409.

Monitor readiness includes the current ambient image. A missing/failed fill is
a visible failure with Retry, never a successful black-background fallback.
Errors/loads from removed URLs or old projects cannot alter current readiness.
Retain a previous PNG only while the complete source/fill/frame identity is
unchanged. Reconnect/source-version changes invalidate it. Failed MP4 preparation
or cancellation retains the previously completed output and sidecar.

## Threat and compatibility review

Project JSON, HTTP input and imported media bytes cross an untrusted boundary;
only application-owned numeric templates may produce filter/curve/SVG syntax.
The existing local server, imported catalog identities and owned work roots
remain the authority for locating data. D5A adds no remote capability.

| Failure or threat                                                   | Required control                                                                              | Acceptance evidence                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Filter/markup injection through a saved curve or fill               | Closed numeric schemas, trusted generated expressions, no URI/path/filter request fields      | Invalid-key/string tests and actual supported-expression samples             |
| Memory/disk/CPU exhaustion from images, repeated requests or curves | Byte/pixel/work bounds, one worker/four pending keys, fixed iterations, one raster per recipe | Deliberate over-budget and queue tests, unchanged prior output               |
| Source relink/replacement during preparation                        | Verified private bytes reused by foreground/fill, final source/file/catalog checks            | Blocked-decode relink/file-swap tests and full hash receipts                 |
| Old gesture or HTTP result edits a newer project/revision           | Captured identity, post-flush revision pin, pre-return project/disk checks                    | Delayed-flush and late-response/project-close regressions                    |
| Path traversal or overwrite of original/completed media             | Catalog-only sources, safe private work, existing atomic output pair publication              | Malformed request/path rejection and original/prior-output hash checks       |
| New effects erase legacy edits or bypass protection                 | Exact v1 branch, strict v2 variants, preserve untouched options, current command protections  | Legacy byte identity, locks/required media, Undo/reopen/version tests        |
| Different color/blur math hides incorrect output                    | Raw shared raster, one coordinated color group, separate region metrics                       | Actual Monitor/MP4 measurements and deliberate wrong/double-processing cases |

An unsupported new recipe fails closed before mutation or output replacement;
opening a legacy project does not silently opt it into new work or resource
limits. A preparation failure leaves its saved v2 recipe available for correction.
An ambiguous dispatched edit retains the existing recovery contract instead of
being reported as an unsaved cancelled gesture.

## Focal gesture, transaction and protection

Add `PhotoFocalOverlay.vue` and pure
`apps/desktop/src/photoFocalInteraction.ts`. Export a captured
`PhotoFocalGeometry` with `sourceToViewport: readonly [number, number, number,
number, number, number]` in CSS client pixels. The helper
`resolvePhotoFocalGeometry(layer: PhotoLayer, motion: PhotoMotionTransform,
transform: Clip["transform"], frame: FrameSize,
rect: { left: number; top: number; width: number; height: number }):
PhotoFocalGeometry` composes displayed-source placement, current motion and the
existing static transform (including its rounded x/y). Export
`photoFocalPointAtViewport(point, geometry): PhotoFocalPoint | null` and
`photoFocalPointFromDelta(initial, delta, geometry): PhotoFocalPoint | null`;
both clamp normalized output, and a singular/nonfinite geometry returns null.

The overlay has `point`, `geometry`, `disabled`, `sessionKey` props and emits
`preview(point)`, `commit(point)`, `activity(boolean)`, `cancelled()`. Expose
`cancel()`. Capture geometry, initial point, pointer ID and session identity on
primary pointerdown; moves use that frozen inverse, not the changing crop.
Capture pointer and ignore additional fingers/pen buttons. Release emits at most
one commit, and a no-op emits none. The focus marker can move while the resolved
crop is constrained; the saved point is not falsified to imply crop freedom.

The single-photo **Set focus** action enters an explicit transient hero preview
for Original/contain and preserves hero options otherwise. Merely entering or
cancelling the mode saves nothing; committing writes the existing
`layout.focalPoint`, retaining fill/protected options. Keep the existing diptych
contain behavior; its focus values remain preserved and the direct crop tool is
disabled with an explanation. This milestone adds no secondary crop mode.

Keep draft layout outside `useTimelineEditor.state`. `TimelineEditor.vue` passes
a transient derived clip into the existing preview, so neither an image-only
legacy branch nor a new timeline becomes a hidden edit owner. Edit only the
selected playback clip in active Story mode, pause transport during the gesture,
and block other accepted edits/history/export/navigation until commit settles
or the gesture is cancelled. Graphic-layer and picture-transform gestures are
mutually exclusive. Read-only Record Monitor uses the same presentation output.

Extend the existing hook compatibly:

```ts
interface CommitTransactionOptions { expectedBaseRevision?: string }
commitTransaction(input, referencedAssets = [], signal?, options?: CommitTransactionOptions)
  : Promise<CommitTransactionResult>
```

The pin is checked **after awaited history/flush and before optimistic
publication or request creation**. A mismatch returns conflict without a draft,
POST, history mutation or implicit rebase. The gesture captures project,
composition, clip, saved revision, primary URI/hash/decode identity, source
version, frame, viewport and initial options. Cancel on any captured identity
change, selection change, status/lock change, play/seek, mode/project close,
resize, blur, pointercancel/lost capture, Escape or unmount. Late results cannot
publish into the replacement session. Abort before dispatch creates no edit;
after an ambiguous dispatch, retain the existing exact-request recovery draft
and show the normal pending/conflict state rather than claiming rollback.

Successful acceptance is one existing presentation transaction and one Undo
step. Server command validation remains authoritative for clip/source/paired
locks, rejection, supported still media and required/selected paired sources.
No automatic lock or new manual-edit pin is introduced. Existing protected
regeneration preserves v2 recipes; explicit source replacement still clears
layout/motion, with Undo restoring them. Duration changes preserve endpoints
and curve and alter only the clip-local clock. Protected-region contain/hold
warnings and GraphicScene/2.5D fallback retain their current semantics.

## UI and interoperability

Use the existing Vue 3/TypeScript Inspector, Monitor and `--of-*` tokens. The
editor is choosing a source subject, camera timing and frame treatment; retain
the current quiet editing chrome, source image as the dominant surface and one
focus crosshair as the distinguishing interaction. Use existing canvas-black,
surface, text, muted, accent and warning tokens; add no palette or fonts.

Provide labelled numeric focal controls as an equivalent path. The crosshair
supports arrows by `0.01`, Shift+arrows by `0.1`, Home to center, Escape to cancel;
keyboard repeat coalesces until keyup/blur into one commit. Custom easing gets
four labelled bounded numeric controls and a small SVG curve preview, with an
explicit Apply button; dragging curve handles is not required. Ambient gets a
toggle, blur/dim controls and Apply; a batch contains one presentation command.
Retain visible focus, 24 px mouse targets and at least 44 px coarse targets.
Announce saved/conflict/fallback state without per-pointer aria-live chatter.
Add en-US, zh-TW and ja-JP keys, pseudo-locale checks, long CJK label wrapping
and 320 px Inspector/1280×720 layout coverage. No implementation terms appear
in product labels.

JSON and OTIO metadata preserve full v2 recipes/source references. Existing
OTIO metadata-only warnings cover these photo effects; add explicit custom
easing/ambient descriptions where they aid review. FCPXML/EDL reject unsupported
recipes before replacing output. Existing fidelity handoff bakes affected visual
ranges via the same renderer. No native NLE curve/fill fidelity is claimed.
MP4 sidecars keep their stable outer version. Set `renderer.presentationVersion`
to 2 only when a v2 photo recipe is used, otherwise retain 1. For a v2 use, add
optional `photoPresentation: RenderPhotoPresentationEvidence` with this exact
shape in `packages/render/src/manifest.ts`:

```ts
interface RenderPhotoPresentationEvidence {
  version: 1;
  bezierBisectionSteps: 24;
  fills: {
    clipId: string;
    sha256: string;
    sources: { assetId: string; sha256: string }[];
  }[];
}
```

`sha256` is the actual raw ambient PNG hash; source entries are its actual
verified original receipts. A motion-only v2 use has an empty `fills` array.
Old absent/v1 renders must not gain different processing merely from opening
them.

## Acceptance and evidence

1. Pure contracts cover exact legacy values and absent-property preservation;
   both strict v2 objects; every bound, unknown key/version, malformed number;
   arbitrary/shuffled/clamped time; endpoint and protected-region safety;
   rotated/SAR sources; cell rounding and the one-pixel ambient-cell bound.
2. Actual FFmpeg expression samples compare with `evaluatePhotoEasing` on both
   supported FFmpeg versions, including endpoint-flat handles and constants with
   small exponent-form values. No project string can enter generated syntax.
3. Solver/application tests cover one accepted history step, exact retry,
   Undo/Redo, autosave/reopen/Named Versions, failed batch preserving redo and
   saved bytes, duration changes, locked/required/paired protection, protected
   regeneration, source replacement and unchanged original hashes. Test the
   hook's pin after a deliberately delayed flush, not only before it.
4. Preparation/HTTP tests cover same-ID relink during decode, file replacement,
   unknown codecs, alpha, bounded resources, abort/disconnect, queue overflow,
   deduplication, project closure/switch and late response. Reject arbitrary URL,
   filter, path and draft recipe fields. Preserve previous MP4 and manifest on
   failed preparation.
5. A synthetic six-second, 320×180, 30 fps ambient/custom-curve photo renders
   exactly 180 MP4 frames without changing source/timing/audio. Compare actual
   Monitor screenshots and decoded RGB at frames 0, 90 and 179: mean absolute
   RGB error at most 12 levels and foreground landmark position error at most
   1.5 px. Apply metrics independently to visible ambient and sharp-foreground
   regions so a large background cannot hide incorrect foreground motion.
   Seek/decode in order `0,90,179,35,140,179,0,90`; repeated indices are byte
   identical. Last-frame time is `179/30`, not the excluded duration endpoint.
6. Add contain, protected-hero fallback and diptych/gap cases, primary/Look once
   and bypass cases, alpha, current PhotoDepth fallback and legacy byte identity.
   Deliberately wrong curve, missing fill, double dim and double color must fail
   the corresponding measurements. Assert every original SHA-256 before/after
   and against the manifest; retain output/PNG hashes and exact source commit,
   FFmpeg build, Chromium, OS and commands in a local JSON evidence ledger.
7. Browser regressions prove no save during drag, one save/Undo at release,
   cancellation and stale-session fencing, keyboard/coarse input, field
   preservation, retry/readiness, CJK/pseudo-locale and no competing gestures.

Only generated synthetic or CC0 assets enter public fixtures. Actual private
photo aesthetics, face/edge quality, touch/pen hardware, calibrated displays,
native OS presentation, sustained 4K and real NLE finishing remain separate
manual evidence. This design phase ran only the disposable expression spike;
the acceptance evidence above is required future work, not a completion claim.

## Affected files and builder decisions

- Core: `packages/core/src/{models,validation,presentation,index}.ts`, new
  `packages/core/src/photo-easing.ts`; core presentation/easing tests.
- Render: new `packages/render/src/{photo-easing,photo-ambient}.ts`, existing
  `photo-filters.ts`, `index.ts`, `manifest.ts`; real render/ambient tests.
- Application/server: new `packages/application/src/photo-presentation.ts`,
  existing application `index.ts`/`editor.ts`, `apps/server/src/server.ts`;
  presentation-validation, service and HTTP tests. Catalog/media owners are
  reused; no SQL or verified-source implementation change is required.
- Desktop: new `photoFocalInteraction.ts`/`PhotoFocalOverlay.vue`; existing
  `PhotoPresentationPreview.vue`, `PhotoPresentationInspector.vue`,
  `TimelineEditor.vue`, `composables/useTimelineEditor.ts`, `api.ts`, `editor.css`
  and `i18n/modules/editor/{en-US,zh-TW,ja-JP}.ts`. Record Monitor should need no
  independent fill/easing logic; test its existing preview component path.
- Tests/docs: focused core/solver/application/render/unit/HTTP/browser tests;
  `docs/photo-film-quality.md`, matching English contract,
  `docs/validation-photo-film-quality.md`, and the existing D5A task only after
  exact-head acceptance. Exporter tests exercise existing metadata/rejection
  owners; production exporter edits only if evidence shows missing warnings.

Builder may choose internal helper names, SVG curve styling and test fixture
organization within these contracts. Changing portable versions/bounds,
processing order, pin timing, source ownership, fallback semantics or declared
metric thresholds requires coordinator review. Execution uses the user's
already selected subagent-driven workflow; no further agents or product edits
are part of this design-only assignment.
