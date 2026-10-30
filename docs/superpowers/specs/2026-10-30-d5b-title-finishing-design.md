# D5B — Bilingual title runs and bounded finishing

Status: independent design proposal; product implementation awaits the parent
agent's interface approval. Inspected base:
`e1255b1a8a83260149211d909cca8c1a50948c6b`, branch
`codex/v1-d5b-titles`. The user authorized roadmap implementation, regressions
and independent review; the parent owns integration and hosted gates.

Authority: the existing nested D5B/F05 item in `TASKS.md`, and
`docs/roadmap/seven-subsystem-reconciliation.md`, especially “Transcript and
titles” and “Pre-implementation safety gates”. This document adds no queue.

## Intent and observed owners

An editor should be able to finish a Traditional Chinese and English title with
different sizes, tracking and local faces, then see the same placement and
finishing in the Monitor and delivered MP4. A title edit must preserve the saved
cut, source media, transcript provenance and existing history behavior.

Already implemented; extend these owners:

| Concern              | Existing source and behavior                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saved data           | `packages/core/src/models.ts`: optional strict `TitleStyle` v1, `Clip.title`, `CaptionCue.text`, `CaptionTrack.style`; project schema `1.0.0`                                         |
| Validation           | `packages/core/src/validation.ts`: closed title/caption objects; size `(0,4096]`, weight integer `100..900`, line height `1..4`, safe margins `0..0.3`                                |
| Layout               | `packages/core/src/title-layout.ts`: actual measured advances/ink, grapheme breaks, CJK punctuation, 32-line cap, role defaults, tracking, safe areas and clip-local fade             |
| Raster               | `packages/render/src/titles.ts`: local fontkit outlines → numerical SVG → resvg full-frame PNG; no browser font shaping or FFmpeg drawtext                                            |
| MP4                  | `packages/render/src/index.ts`: attached/standalone titles and selected native captions already burn in; caption timing uses `captionFrameRange`                                      |
| Editing              | `packages/solver/src/editing.ts`, `packages/application/src/editor.ts`: detached commands, revision fence, exact request retry, atomic save, Undo/Redo and source/paired-source locks |
| Preview              | `OpenFilmApplication.titleOverlay`, title PNG route, `NativeTitlePreview.vue`, `PhotoPresentationPreview.vue`, `RecordMonitor.vue`                                                    |
| Evidence/portability | Render font hashes and usage bindings, crop approval fences, Visual QA, Collect font family/weight bindings, JSON/OTIO metadata, native-caption SRT/VTT sidecars                      |

Missing: independently styled primary/secondary runs, bounded shadow/stroke/
per-line pills, per-run font evidence, and caption raster playback in the actual
Record Monitor. `RecordMonitor.vue` currently has no caption overlay; the
Caption Inspector/lane and MP4 renderer exist. This parity gap is part of D5B,
not a new Caption Track implementation.

## Approaches and proposed decision

1. **Recommended: canonical literal text plus optional versioned run metadata.**
   Store both languages in the existing string, separated by one authored LF;
   metadata identifies that boundary and independent typography. Keep one
   Composition, command queue and measured raster. Text exports retain both
   languages through their existing literal-text path.
2. Store two complete strings in a second title object while retaining the old
   title as a fallback. Rejected: two canonical primary texts can disagree,
   especially after a legacy text edit, caption refresh or NLE handoff.
3. Separate title clips/layers, browser CSS or FFmpeg typography. Rejected:
   duplicates timing/edit ownership or introduces different wrapping and glyphs.

The following values are builder proposals, not additional user decisions.
Alternative 1 requires parent approval before product code.

## Closed persisted contracts

Define these types in a focused `packages/core/src/title-runs.ts`; export them
through core. Existing schema, catalog and all existing version numbers stay
unchanged. Add `Clip.titleRuns?: TitleTextRuns`,
`CaptionCue.textRuns?: TitleTextRuns`, and
`TitleStyle.finishing?: TitleFinishing`. No font path is project-authored.

```ts
type TitleRunId = "primary" | "secondary";
interface TitleRunTypography {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  tracking?: number;
}
interface TitleTextRuns {
  version: 1;
  /** UTF-16 index of the single LF separating the two nonempty run slices. */
  splitAt: number;
  primary?: TitleRunTypography;
  secondary?: TitleRunTypography;
  /** Composition pixels; absent resolves to 0.35 × base resolved font size. */
  gap?: number;
}
interface TitleFinishing {
  version: 1;
  shadow?: {
    color: string;
    opacity: number;
    offsetX: number;
    offsetY: number;
    blur: number;
  };
  stroke?: { color: string; width: number };
  pill?: {
    color: string;
    opacity: number;
    paddingX: number;
    paddingY: number;
    radius: number;
  };
}
```

| Input         | Exact bound/meaning                                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run count     | Exactly two when metadata exists; primary is `text.slice(0, splitAt)`, secondary is `text.slice(splitAt + 1)`                                                                                                  |
| Boundary      | Safe integer `1 <= splitAt < text.length - 1`; `text[splitAt] === "\n"` and `text[splitAt - 1] !== "\r"`; each slice is nonempty after trimming and valid Unicode; no split inside CRLF, grapheme or surrogate |
| Text size     | Combined run text including separator at most existing `MAX_TITLE_LENGTH = 8000` UTF-16 units; legacy caption storage retains its existing 20000 limit, including its existing raster-fit limitation           |
| Font family   | Existing nonempty family rule, at most 256 units, no controls; it is a local family label, never a path, CSS or URL                                                                                            |
| Typography    | Same domains as base style: size `(0,4096]`, integer weight `100..900`, line height `1..4`, tracking `0..min(100, effective font size)`                                                                        |
| Gap           | Finite `0..128` composition pixels                                                                                                                                                                             |
| Colors        | Exactly `#RRGGBB` (case insensitive); resolver canonicalizes uppercase; no CSS functions, alpha syntax, `url()` or markup                                                                                      |
| Shadow        | One only; opacity `0..1`, offsets `-64..64`, Gaussian standard deviation `blur: 0..16` pixels                                                                                                                  |
| Stroke        | One only; centered outline width `0..16` pixels; white glyph fill remains the existing default                                                                                                                 |
| Pill          | One rectangle per nonempty measured line; opacity `0..1`, X/Y padding `0..64`, radius `0..64` pixels, effective radius clamped to half the actual rectangle width/height                                       |
| Versions/keys | Exact `version: 1`; reject unknown versions, keys, prototypes, symbols, arrays, non-finite numbers and numeric strings before mutation/raster work                                                             |

Both runs inherit the base style independently; one run's override never changes
the other's value. No language is inferred and no translation is generated.
Explicit newlines within either slice remain authored paragraph breaks.
`finishing.pill` explicitly selects per-line pills instead of the existing
block scrim; the saved `background` setting is retained and resumes if pills
are removed. Shadow applies to the outlined text, not the pills or block scrim.
Paint order: legacy scrim or pills → text shadow → stroke → white glyph fill.

Absent runs and absent finishing follow the old layout/raster path exactly.
An empty finishing object (`{version:1}`) resolves to the same pixels as absent
finishing. Omitted fields are never injected into saved legacy projects.

## Shared geometry and raster interfaces

Keep `layoutTitleText`'s four-argument API and legacy `TitleLayout` fields.
Factor its paragraph wrapping into a shared internal helper, then add:

```ts
validateTitleTextRuns(value: unknown, text: string): TitleTextRuns;
validateTitleFinishing(value: unknown): TitleFinishing;
resolveTitleRuns(text: string, runs: TitleTextRuns | undefined,
  style: TitleStyle | undefined, frame: FrameSize): ResolvedTitleRun[];
type TitleRunTextMeasure = (run: TitleRunId, text: string,
  fontSize: number, tracking: number) => TitleTextMetrics;
layoutTitleRuns(text: string, runs: TitleTextRuns | undefined,
  style: TitleStyle | undefined, frame: FrameSize,
  measure: TitleRunTextMeasure): TitleLayout;
```

`ResolvedTitleRun` has `{id, text, style: ResolvedTitleStyle}`. Add optional
`TitleLayout.runLayouts?: {version:1; runs: TitleRunLayout[]}`, where each
`TitleRunLayout` has `{id, style, lines, bounds}` using existing line/rectangle
types. The top-level lines are the ordered flattened lines and top-level style
retains base fade/position. Run baselines use their own ascent, descent and
line height; the two measured blocks stack with the resolved gap, then the
combined visible block is anchored once to the existing center/bottom region.

All visible paint counts toward safety: outline half-width, pill padding and
the bounded shadow extent. Gaussian support is deliberately clipped at three
standard deviations in a fixed numerical SVG filter region. Reserve asymmetric
paint insets before wrapping/anchoring; union the per-line paint bounds for
final `bounds`. The full union must fit all four safe boundaries. No automatic
shrink, crop, clipping to the frame, silent fallback to one run or punctuation
relaxation is permitted. Overflow returns an actionable typed failure.
Combined output remains at most 32 measured lines and the existing 33177600
pixel / 8K output admission remains in force.

Extend the existing final options argument of `inspectTitleOverlay` and
`createTitleOverlay` with `textRuns?: TitleTextRuns` and
`fontPathForStyle?: (style: TitleStyle | undefined) => string | undefined`.
Keep `fontPath?: string`; the per-style trusted resolver wins when it returns a
path, otherwise the explicit override/environment/local fallback order remains.
Resolve/load each effective run style and call `layoutTitleRuns` once. Resvg
receives only trusted path outlines, fixed SVG elements and bounded numeric/
hex values. Disable system font loading exactly as today.
Capture each loaded face/buffer once and reuse it for inspection, measurement
and path generation; a second font load must not substitute different bytes
between measurements, cache identity and final raster evidence.

Keep the legacy primary `font` field and string `warnings`. Add per-run font
results and typed diagnostics to inspection/overlay results. Extend
`titleOverlayCacheKey`'s existing input with `textRuns?` and `runFonts?`:
`runFonts` is an ordered pair of `{id, fontSha256, postscriptName}` when runs
exist and is required for that case. Cache identity includes canonical runs,
all finishing values, frame, layout/raster algorithm discriminator, and both
actual font hashes/faces; never key only by the primary face or family label.

## Font evidence, review and portable packages

For each run record requested family/weight, actual family/weight/PostScript
name/file SHA-256, and typed `family-fallback` or `weight-fallback` diagnostics.
`TitleRunFontResult` is `{id:TitleRunId,font:TitleFontIdentity,
requestedFamily:string,requestedWeight:number,actualWeight:number,
diagnostics:TitleFontDiagnostic[]}`. A `TitleFontDiagnostic` contains
`{code:"family-fallback"|"weight-fallback",run:TitleRunId,
requestedFamily:string,requestedWeight:number,actualFamily:string,
actualWeight:number,postscriptName:string,sha256:string}`. These diagnostic
types contain no paths; internal `TitleFontIdentity` retains its trusted path.
Missing local font or glyph is a hard inspection/render failure naming its run;
an available local fallback is an explicit warning, never an invented exact
match. Keep existing English evidence strings for compatibility; product UI
uses diagnostic codes and its three locale dictionaries. HTTP responses and
manifests exclude local font paths.

Extend `RenderFontBinding` with optional `run?: TitleRunId`. Keep the existing
three-element usage tuple and its legacy encoding. Canonical binding identity
becomes `[usage, run-or-absent]`; two different actual fonts for the same run
remain a hard conflict. A bilingual item writes primary and secondary bindings;
legacy items omit `run` exactly as before. Crop preview/acceptance checks compare
the full bindings, so font changes or swapped run assignments invalidate a
review even when the unordered font set is unchanged.

Collect Media enumerates effective styles for both runs in every selected and
saved Composition, including captions outside the currently selected output
language. Reuse existing family/weight binding keys, hash checks, license review
and `titleFontPath`; require both bindings on relocation/reopen. Add no font
download or redistribution. Existing installed Noto CJK is OFL-1.1; OS fonts
retain their own terms. D7A owns a separately pinned test-font/tool record; D5B
records the actual local face/hash and does not claim another platform's font
or readability evidence. Visual QA consumes the same run-aware inspection and
package font resolver rather than remeasuring with an unrelated fallback.

## Commands, revisions, locks and failure behavior

Extend existing commands only:

```ts
// Existing presentation command gains:
titleRuns?: TitleTextRuns | null;
// Existing caption.cue.update.patch gains:
textRuns?: TitleTextRuns | null;
```

Validate effective text/runs/style after assembling a detached candidate and
before save/history. Runs require nonempty effective text: a metadata-only
command may use the saved text when its text field is omitted.
Changing a bilingual canonical string requires supplying updated runs or
explicit null; otherwise reject with `timeline.titleRunsConflict`, even if an
old offset happens to point at another newline. Unchanged text in an existing
style command remains valid. Removing a title clears its run metadata in the
same operation; non-null runs paired with `title:null` reject. Clearing runs
alone preserves the whole literal string as homogeneous multiline text.
Caption manual revision increments for run edits as for existing text/time
edits; transcript provenance and warnings are retained.

Use current optimistic application, exact request fingerprint, one history step
per command batch, autosave and persisted revision behavior. All clip, primary
source and paired-photo locks and existing Story pin/constraint checks still
apply. Caption commands remain independent Composition overlays: current code
has no caption lock or automatic source-lock inheritance, so do not invent one
or mutate the transcript/source to change caption styling. A locked visual
title rejects through the existing presentation owner.

Trim, speed, split and replacement preserve run/effect data alongside the
existing style. Split keeps the existing duplicated-text behavior; each piece
evaluates its own local fade. Caption millisecond intervals and range conflicts
are unchanged. No text edit alters source timing/audio, Story constraints,
audio automation or graphics. Failed commands leave project bytes, catalog,
revision, request receipts and both history stacks unchanged. Raster/font
failure leaves the authored edit available for correction but publishes no
partial MP4, stale image or source change.

## Application, Monitor and Inspector

Extract the current title PNG/cache implementation to a focused
`NativeTextOverlayService` in `packages/application/src/title-overlays.ts`.
Expose `OpenFilmApplication.textOverlays`; keep `titleOverlay` as a delegating
compatibility method. Inject the same current-editor-revision callback pattern
as `GraphicSceneService`.

```ts
type NativeTextReference =
  | {kind:"title"; clipId:string}
  | {kind:"caption"; trackId:string; cueId:string};
interface NativeTextOverlayRequest {
  projectId:string; compositionId:string; revision:string;
  reference:NativeTextReference;
}
image(input:NativeTextOverlayRequest,
  options?:{signal?:AbortSignal}):Promise<string>; // internal cache path
inspect(input:NativeTextOverlayRequest,
  options?:{signal?:AbortSignal}):Promise<NativeTextInspection>; // no paths
```

`NativeTextInspection` is the measured/failed inspection union from the render
owner with each `font.path` removed, `runFonts:TitleRunFontResult[]` mapped to
the same path-free identities and typed diagnostics retained. Its failure
branch preserves `{kind,detail,message,run?}`. The HTTP adapter never serializes
internal `TitleOverlay` objects or absolute font/cache paths.

Keep the existing title PNG route; add corresponding caption PNG and inspection
routes under `/api/compositions/:compositionId/caption/:trackId/:cueId.png`,
`/title/:clipId/inspection`, and `/caption/:trackId/:cueId/inspection`.
All routes require current `projectId` and `revision`. Capture the exact
reference/text/style/runs/frame, check project/revision before and after awaits,
and reject a changed owner with 409 before streaming. Reuse safe cache paths,
temporary cleanup/atomic rename and the current 64-image cache bound. Deduplicate
concurrent same-key work; cap raster work at one active plus eight queued
requests per application and return typed 429 `title.busy` beyond that bound.
Closing an application cancels its queued work; finishing stale work cannot
publish an image into another owner.

Add a reusable `NativeCaptionPreview.vue` for the Record Monitor and the current
Story monitor. It uses the existing `captionFrameRange`, current Composition
frame and output frame rate, not a source/media clock. Omitted selected track
means the first saved track, null means none, an explicit absent ID is an error.
Thread App's existing `outputCaptionTrackId` into `TimelineEditor` and both
monitors; a caption preview selector emits back to that same state so Monitor
and MP4 language/none selection agree. Inspector selection alone does not alter
which language is delivered.

Decode an image before showing it; on seek/track/revision/project changes clear
the previous cue immediately, abort pending work, and only publish a decoded
PNG whose full ownership key still matches. No stale cue may be retained as a
playback fallback. Font/raster failure shows a localized “caption unavailable”
status and typed detail; source playback remains independently usable. Reuse
this ownership discipline for native title image errors. Images are full-frame
composition-sized with no CSS text effects; title fade applies to the complete
finished PNG. Caption fade behavior remains the renderer's current behavior.

UI direction extends the existing quiet editing workspace. The editor is
finishing a remembered scene while keeping the cut visible: primary text,
secondary text, composition pixels and safe bounds are the vocabulary. Existing
film black, panel charcoal, silver controls, white glyphs and warning amber
remain the color world. The signature is two language rows beside the same
measured frame, with actual local-font status for each row. Keep existing
Inspector organization instead of a new effect workspace, numeric composition
units instead of viewport CSS units, and explicit measured status instead of
decorative font previews.

Share focused `BilingualTextControls.vue` and `TitleFinishingControls.vue` between
the visual title and Caption Inspectors. Stage an empty second-language draft
locally and commit only a valid two-run edit. Existing single-language defaults
remain untouched on open. Show primary/secondary size, tracking, family, weight
and line height; keep finishing controls progressively disclosed. Default-style
reset removes base style/finishing and run typography/gap overrides while keeping
text and its boundary. Use explicit per-run reset actions. Existing field labels,
keyboard/IME handling and shortcut exclusion remain; errors/status use
`aria-live`, focus stays on the authored field, CJK labels wrap, and coarse
pointer controls remain at least 44 × 44 CSS pixels. Add all copy in en-US,
zh-TW and ja-JP; do not expose paths, SVG, cache keys or font-engine internals.

## Trust and compatibility matrix

| Input/boundary            | Admission and consequence                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untrusted project/command | Closed nested versions/keys, Unicode and numeric limits; no callable code, CSS, HTML, arbitrary SVG, remote URL or font path                                |
| Local font/runtime input  | Only existing trusted env/package/local lookup; keep hash-verified collected paths; no project-selected shell arguments or networking                       |
| Paths/cache               | Application-generated hashes/UUID temporary names under safe cache owner; no request output path, arbitrary deletion or source writes                       |
| Revision/project switch   | Check captured project/reference/revision after asynchronous font/raster work; abort and drop late UI results; no history for preview reads                 |
| Resource exhaustion       | 8000 UTF-16 units, two runs, 32 total lines, one of each effect, fixed 3σ filter support, 8K pixel ceiling, bounded cache and queue                         |
| Legacy reopen             | Absence is identity; no SQLite/project migration, eager materialization or source rewrite; unknown nested versions fail closed and are not silently reset   |
| JSON/OTIO                 | Full run/finishing data stays in original Composition/clip metadata; native editable typography remains manual recreation                                   |
| SRT/VTT                   | Both literal run texts and authored millisecond times survive; fonts/tracking/shadow/stroke/pills are absent, with explicit existing/new handoff disclosure |
| MP4/reference bake        | Shared PNG is burned in; selected language, actual fonts, warnings and per-run bindings are captured in the existing manifest/review receipt                |

Do not expand GraphicScene node schemas, transcript timing, title roles, title
fade behavior, 4K/OS performance claims or the preset registry. Original-media
bytes and identity remain unchanged.

## Acceptance and evidence

1. Pure core tests pin bounds, unknown versions/keys, canonical text boundary,
   Unicode/graphemes/CJK punctuation, mixed face metrics, line/gap limits,
   negative ink bearings and complete effect safety on every edge. Legacy
   layouts are exactly equal and old project JSON is unchanged after reopen.
2. Application/solver tests pin every lock source, Story pins, stale revisions,
   exact/conflicting retries, atomic mixed-batch rejection, Undo/Redo, autosave,
   reopen, reset, replacement, trim/speed/split and caption manual provenance.
3. Real font/raster tests pin two actual face/hash identities, fallback codes,
   missing secondary glyph/font failures, canonical cache invalidation, queue
   bounds and crop approval rejecting swapped run assignments. Collect tests
   relocate/reopen both font bindings and reject a missing secondary binding.
4. Synthetic FFmpeg MP4 tests use a procedural still/video and synthesized tone,
   with primary `繁體標題` and secondary `Our story`, distinct measured sizes and
   tracking. Decode first/last active, middle and adjacent inactive frames at 30
   and 30000/1001 fps; compare the exact shared raster's solid glyph, stroke,
   shadow and pill samples against decoded output with explicit codec tolerance.
   Include shuffled seeks, attached/standalone titles, native captions, fade,
   trimmed/speeded clips, safe bounds and unchanged source SHA-256/audio.
5. Real SRT/VTT sidecar/parser assertions retain both texts and original cue
   milliseconds and disclose lost styling. JSON/OTIO/handoff tests retain full
   metadata and never claim editable NLE effects. Browser tests load the actual
   current PNG, assert decoded image pixels against the renderer baseline and
   exercise delayed responses, project switch, IME/keyboard, three locales,
   narrow/coarse-pointer UI, reset, Undo/Redo and reopen.

The implementation plan assigns focused tests to each owner. The parent runs
full suites/CI and owns ports 4310/1420, native benchmarks, publishing and PR
review/merge. This design pass runs no product tests or browser servers. Physical
Windows/macOS display quality, licensed installer fonts and actual NLE finishing
remain separately recorded manual gates.
