# D5B Bilingual Title Finishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` under the parent's already selected
> execution method. Steps use checkbox syntax for tracking. This worker must
> not spawn agents or implement product code until the parent approves the
> interfaces; the parent owns independent review and integration.

**Goal:** Add separately versioned bilingual runs, bounded title finishing and
font evidence with actual Monitor/MP4 parity through existing owners.

**Architecture:** Preserve canonical literal title/caption text; optional v1 run
metadata supplies its bilingual boundary and typography. Extend core measured
layout and the existing fontkit/resvg PNG, then route preview, renderer, review
receipts, Collect fonts and existing typed commands through that owner.

**Tech Stack:** Existing Vue 3/TypeScript, Node/SQLite, fontkit 2.0.4,
resvg 2.6.2, FFmpeg/FFprobe, Vitest and Playwright; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-d5b-title-finishing-design.md`

## Global Constraints

- Preserve project schema `1.0.0`, catalog v6 and all existing version numbers.
- Preserve original media, source timing/audio, Story pins/constraints,
  caption provenance, graphics, locks, autosave and Undo/Redo.
- No second timeline, browser/FFmpeg typography fork, project HTML/JS/SVG,
  remote URL/font, font download, dependency upgrade or private media.
- Two runs, 8000 combined UTF-16 units, 32 combined lines; gap `0..128` pixels.
- Typography uses existing size `(0,4096]`, integer weight `100..900`, line
  height `1..4`, tracking `0..min(100,effective font size)` and 256-unit families.
- One bounded shadow/stroke/pill: hex RGB only; shadow opacity `0..1`, offsets
  `-64..64`, blur `0..16`; stroke width `0..16`; pill opacity `0..1`, padding
  and radius `0..64`; reserve all paint and fixed 3σ shadow support inside safety.
- Absent new fields are identity; unknown versions/keys fail closed before
  writes and must never be automatically downgraded.
- Read-only image work uses safe project cache paths, 64 images, one active
  raster plus eight queued requests, and typed 429 `title.busy` beyond the bound.
- Parent owns full suites, hosted CI, native benchmarks and shared browser
  servers on ports 4310/1420. This design pass runs no product tests or servers.

## Review Focus

- A primary-text edit must not silently assign secondary typography to another
  newline; require updated runs or explicit null (`Task 1/3`).
- A secondary face or swapped run/font assignment must invalidate an approved
  crop even when the unordered font set is unchanged (`Task 2/4`).
- Extreme shadow/ink bearings at 0% safe margins must not clip or paint outside
  the declared bounds (`Task 1/2/7`).
- A late caption/title decode after seek, track change or project switch must
  never appear in the new owner (`Task 5/6/7`).
- An unselected caption language in a later saved Composition must retain its
  secondary packaged font on relocation/reopen (`Task 4`).

---

## File ownership

- New core `title-runs.ts`: types, validators, canonical text slicing and run
  resolution. Existing `title-layout.ts` owns all wrapping, metric geometry and
  safety; no independent wrapping algorithm.
- Existing `render/src/titles.ts` owns font shaping and raster. A small new
  `title-finishing.ts` may own fixed numerical SVG paint generation if needed;
  it must consume resolved layouts, never reinterpret text.
- New application `title-overlays.ts` owns current-reference capture, inspection,
  bounded raster admission and safe cache publication; `index.ts` wires it.
- New focused Vue components own bilingual fields, finishing fields and caption
  images. Existing Inspectors/Monitor/App remain the interaction/state owners.
- Existing renderer manifest, export profiles, Collect and exporters retain
  their current responsibilities. No cross-subsystem restructuring.

### Task 1: Closed run/finishing schemas and one measured layout

**Files:** Create `packages/core/src/title-runs.ts`,
`packages/core/tests/title-runs.test.ts`; modify `models.ts`, `validation.ts`,
`title-layout.ts`, `index.ts`, `packages/core/tests/title-layout.test.ts`,
`native-captions.test.ts` and `project.test.ts` under core.

**Interfaces:** Produce the spec's `TitleTextRuns`, `TitleRunTypography`,
`TitleFinishing`, `TitleRunId`, `ResolvedTitleRun`, `TitleRunLayout`;
`validateTitleTextRuns(value:unknown,text:string):TitleTextRuns`,
`validateTitleFinishing(value:unknown):TitleFinishing`,
`resolveTitleRuns(text,runs,style,frame):ResolvedTitleRun[]` and
`layoutTitleRuns(text,runs,style,frame,measure:TitleRunTextMeasure):TitleLayout`.
Keep `layoutTitleText` and all legacy layout fields; add optional versioned
`runLayouts`. Combined layout is anchored once, after independent measurements.

- [x] Add failing tests named `rejects_unknown_run_and_finishing_versions`,
      `keeps_one_canonical_two_language_string`,
      `wraps_each_run_with_its_own_metrics`,
      `reserves_complete_effect_ink_on_all_edges`, and
      `legacy_absence_is_exact_identity`. Assert every numeric boundary and
      one-step-outside, null/array/unknown-key/prototype/symbol/numeric-string,
      NaN/Infinity, bad RGB, invalid Unicode, separator/CRLF offsets, empty
      slices, 8000/8001 units, 32/33 combined lines and 128/128.01 gap.
- [x] Pin CJK opening/closing punctuation, Latin words, explicit paragraphs,
      combining/ZWJ graphemes, negative left bearing, differently sized primary/
      secondary baselines and shadow offsets on both sides. Assert resolved
      safety includes pills, centered stroke and clipped 3σ support.
- [x] Run `pnpm exec vitest run packages/core/tests/title-runs.test.ts packages/core/tests/title-layout.test.ts packages/core/tests/native-captions.test.ts packages/core/tests/project.test.ts`; observe assertion failures for the
      new behavior before implementation.
- [x] Implement closed validators and shared wrapping/layout; permit optional
      new model fields without adding migrations or materializing defaults.
      Verify legacy project JSON and layout objects stay equal, including
      centered titles ignoring stored bottom distance.
- [x] Repeat the focused command; all cases pass. Commit
      `feat(core): define bounded bilingual title runs and finishing`.

### Task 2: Run-aware local raster, cache keys and font diagnostics

**Files:** Modify `packages/render/src/titles.ts`, `packages/render/src/index.ts`
exports and `packages/render/tests/titles.test.ts`; create
`packages/render/tests/title-finishing.test.ts`; optional focused SVG helper as
described in file ownership.

**Interfaces:** Extend existing inspection/raster options with
`textRuns?:TitleTextRuns` and
`fontPathForStyle?:(style:TitleStyle|undefined)=>string|undefined`; retain
`fontPath`. Add `TitleRunFontResult` with `{id,font,requestedFamily,
requestedWeight,actualWeight,diagnostics}`, typed diagnostic code
`family-fallback|weight-fallback`, and optional run on failed inspection.
Keep primary `font`, `warnings` and all existing function positional arguments.
Extend cache input with optional `textRuns` and ordered paired
`runFonts:{id,fontSha256,postscriptName}[]`; require both when runs exist.

- [x] Add failing actual local-font tests for different run size/tracking and
      weight, two face/hash results, requested-family/weight fallback diagnostics,
      missing secondary font/glyph, primary/secondary swap and secondary font
      hash changing the PNG cache key. Assert output contains no user markup
      or remote/font references; source text resembling SVG stays literal glyphs.
- [x] Pin actual PNG samples in glyph, outline, shadow and both line pills;
      assert alpha never escapes measured full bounds (allow only the explicit
      raster edge rounding), including negative offsets and maximum blur.
      Assert absent/empty finishing preserves legacy PNG bytes.
- [x] Run `pnpm exec vitest run packages/render/tests/titles.test.ts packages/render/tests/title-finishing.test.ts` and retain intended failing
      assertions before implementing.
- [x] Load effective faces through the existing trusted resolver, call Task 1
      geometry, draw numerical paths with fixed paint order/filter support and
      use existing 8K admission. Never embed user text in SVG markup or use
      browser/FFmpeg text layout. Normalize equivalent effect/color values for
      caching and capture actual face/hash evidence for both runs.
- [x] Pass the focused tests and commit
      `feat(render): rasterize bilingual title finishing with font evidence`.

### Task 3: Existing typed commands, recovery and timing preservation

**Files:** Modify `packages/solver/src/editing.ts`,
`packages/application/src/editor.ts`; extend
`packages/solver/tests/editing.test.ts`, `native-captions.test.ts`,
`packages/application/tests/quality-editor.test.ts`,
`quality-presentation-validation.test.ts`, `captions.test.ts`; create focused
`packages/application/tests/title-finishing-editor.test.ts` if separation helps.

**Interfaces:** Existing `presentation` gains
`titleRuns?:TitleTextRuns|null`; existing `caption.cue.update.patch` gains
`textRuns?:TitleTextRuns|null`. Existing `caption.track.style` validates nested
finishing through `TitleStyle`. Reject unsupplied boundary updates after a text
change with `timeline.titleRunsConflict`; removing a title also removes runs.

- [x] Add failing tests named `rejects_ambiguous_bilingual_text_update_atomically`,
      `honors_clip_primary_and_paired_source_locks`,
      `retains_pins_and_other_tracks`,
      `retries_exact_edit_and_rejects_conflicting_request_id`,
      `undo_redo_and_reopen_preserve_whole_run_style` and
      `trim_speed_split_replace_preserve_title_runs`. Compare saved bytes,
      catalog source state, revision and both history stacks on every rejection.
- [x] Test valid effective tracking against each inherited/overridden font size,
      a mixed batch with an invalid final runs field, null-clearing without text
      loss, reset preserving boundary, title removal rejecting non-null runs,
      and unknown nested versions before saving. Caption edits increment manual
      revision while retaining source/segment warnings and exact cue times.
- [x] Run the focused modified solver/application files, observe failing new
      assertions, then implement detached candidate validation and null rules
      through existing owners. Keep current caption independent-lock semantics
      and all caption shortening conflicts.
- [x] Pass focused files; no port or full-suite run. Commit
      `feat(editor): persist bilingual title edits through existing history`.

### Task 4: Renderer receipts, approval fences, Collect and interchange

**Files:** Modify `packages/render/src/index.ts`, `manifest.ts`,
`packages/application/src/export-profiles.ts`, `visual-qa.ts`, `collect-media.ts`,
`packages/exporters/src/index.ts`, `handoff.ts` where needed; tests in
`packages/render/tests/manifest-provenance.test.ts`,
`tests/integration/export-profiles.test.ts`,
`packages/application/tests/collect-media-review.test.ts`,
`packages/exporters/tests/captions.test.ts` and exporter/handoff owner tests.

**Interfaces:** `RenderFontBinding` gains `run?:TitleRunId`; keep the existing
three-element `usage`. `canonicalRenderFontBindings` validates optional run and
keys by `[usage,run-or-absent]`, preserving old encoding. Render passes each
clip/cue's metadata to Task 2 and records both assignments and diagnostics.
Collect enumeration passes Task 1 effective styles through existing family/
weight binding keys; review and QA consume the same per-run font evidence.

- [x] Add failing receipt tests for two run fonts sharing one usage, conflict
      within one run, malformed/unknown run ID, legacy receipt identity and
      swapped assignments invalidating approval despite an unchanged font set.
- [x] Add failing Collect tests for both fonts in selected/later Compositions,
      unselected caption languages, relocation/reopen parity and a missing or
      hash-changed secondary binding. Keep existing rights/path checks.
- [x] Add SRT/VTT parser tests retaining `繁體標題\nOur story` and exact
      `900..1500` milliseconds; assert literal markup rules remain. Verify
      JSON/OTIO original Composition retains runs/finishing, metadata-only NLE
      warnings name bilingual typography/effects, and caption handoff discloses
      style loss without claiming native editable effects.
- [x] Run only the changed render/application/exporter files, observe intended
      failures, implement the existing-owner integrations, then pass them.
      Commit `feat(export): bind bilingual fonts and preserve title metadata`.

### Task 5: Current-owner inspection and PNG service

**Files:** Create `packages/application/src/title-overlays.ts`,
`packages/application/tests/title-overlays.test.ts`,
`tests/integration/title-finishing-http.test.ts`; modify application `index.ts`,
server `server.ts`, desktop `api.ts`, and `tests/integration/photo-quality-http.test.ts`.

**Interfaces:** Produce spec `NativeTextReference`,
`NativeTextOverlayRequest`, path-free `NativeTextInspection`,
`NativeTextOverlayService.image(input,options?):Promise<string>` and
`.inspect(input,options?):Promise<NativeTextInspection>`.
`OpenFilmApplication.textOverlays` uses injected current-revision callback;
legacy `.titleOverlay(compositionId,clipId)` delegates. Expose existing title
PNG plus caption PNG and title/caption inspection routes, all project/revision
bound. Desktop adapters accept `AbortSignal`, never an output path.

- [x] Add failing tests for wrong project/stale revision/missing cue, changed
      revision or font during an await, delayed old-project completion, aborted
      queue work, one active/eight queued raster admission, 429 overflow,
      same-key deduplication, 64-image eviction and temporary cleanup.
- [x] Add HTTP assertions for `image/png`, correct run-aware bytes, path-free
      inspection, 409 after any owner change and unchanged saved project/history
      on every image read. Use `startServer({port:0})`; no fixed ports.
- [x] Run the new application/HTTP files and existing photo HTTP regression;
      observe new failure assertions. Extract current safe cache handling,
      implement capture/rechecks, trusted font resolver and bounded work queue.
      Check owner again before stream publication and cancel on app close.
- [x] Pass focused tests; commit
      `feat(preview): serve measured bilingual title and caption overlays`.

### Task 6: Shared Inspector controls and actual Monitor captions

**Files:** Create desktop components `BilingualTextControls.vue`,
`TitleFinishingControls.vue`, `NativeCaptionPreview.vue`; modify
`PhotoPresentationInspector.vue`, `TimelineEditor.vue`, `RecordMonitor.vue`,
`NativeTitlePreview.vue`, `App.vue`, `editor.css`, locale owners en-US/zh-TW/ja-JP;
create `tests/unit/title-finishing-controls.test.ts`,
`tests/unit/native-caption-preview.test.ts`; extend native title, record monitor,
caption and legacy style recovery unit tests.

**Interfaces:** Bilingual controls consume `{text,runs?,style?,frame,disabled}`
and emit `change:{text:string;runs:TitleTextRuns|null}`. Finishing controls
consume `{style,disabled}` and emit `change:TitleStyle`. Caption preview consumes
`{composition,compositionId,projectId,revision,frame,frameRate,
captionTrackId?:string|null,active}`. App supplies existing
`outputCaptionTrackId` to TimelineEditor; its `captionTrack` event calls existing
`changeOutputCaptionTrack`. Record Monitor receives that same selection.

- [x] Add failing component tests for untouched legacy inputs, two-row CJK/Latin
      editing, independently preserved fractional size/tracking/custom weights,
      staged empty secondary draft, reset preserving both text/boundary, IME
      composition and numeric invalid input, locks and unchanged focus.
- [x] Test `captionFrameRange` half-open frames at 30/30000:1001, default first
      track, explicit track/none and invalid ID; delayed image/inspection and
      decode after seek/revision/track/project switch must clear/drop the old
      cue, abort requests and revoke blob URLs. Missing secondary font and
      overflow show localized status without substituting CSS text.
- [x] Run the new focused unit files plus existing record/native-title/style-
      recovery regressions; observe failure assertions. Implement controls with
      existing visual tokens and keyboard exclusion. Integrate caption image
      over current Story and Record picture, gated by saved/current owner;
      compare language selection with the export selector.
- [x] Pass focused files, `pnpm test:i18n`, and type checks when coordinated
      with parent. Commit `feat(desktop): edit and preview bilingual title finishing`.

### Task 7: Actual media, browser regressions and independent handoff

**Files:** Create `packages/render/tests/bilingual-title-finishing.test.ts`,
`tests/e2e/title-finishing.spec.ts`; extend native caption/native text MP4
tests and caption/export browser owners; create
`docs/validation-title-finishing.md` and English reference mirror, update the
current native text/caption docs and required locale mirrors. Update only the
existing nested D5B/F05 checkbox when the parent confirms all exit gates.

**Interfaces:** Existing production render, title/caption PNG endpoint, editor
commands and SRT/VTT sidecars; no fixture-only product behavior. Evidence
records exact source/head, command, real local font file/hash/face and tool
versions; manual workstation checks remain open.

- [x] Add failing actual FFmpeg tests for procedural picture + synthetic tone,
      bilingual native attached/standalone titles and caption cue at 30 and
      30000/1001 fps. Decode before/first/middle/last/after cue frames and shuffled
      seeks; sample flat glyph/stroke/shadow/pill interiors from the exact shared
      PNG and compare decoded values within 8/255 per RGB channel (codec edge
      pixels excluded explicitly). Assert visible bounds within 2 decoded pixels,
      distinct run metrics, fade on text only, source hashes unchanged and
      preserved decoded audio/timing against an otherwise identical renderer
      baseline without titles. Select exact output frame indices rather than
      trusting approximate seek timestamps. Require missing font/glyph/overflow
      to fail before final output publication. Strip each run/effect or move the
      expected bounds by more than 2 pixels as negative controls; comparisons
      must fail for those deliberate differences.
- [x] Run focused render media files; observe failing assertions, fix only
      necessary integration gaps and pass the media tests. Inspect and parse
      actual generated SRT/VTT with both texts and exact millisecond boundaries;
      assert receipts contain both run identities and warnings/disclosures.
- [x] Add browser cases using actual synthetic fixtures/current PNG endpoint:
      both Inspectors, actual decoded image/canvas samples matched to render
      baseline, seek/caption boundaries, independent controls, track/none output
      selection, reset/Undo/Redo/reopen, delayed replies/project switch, three
      locales/pseudolocale, keyboard/IME, narrow viewport and 44px coarse targets.
      Parent runs these against its owned browser servers; this worker must not
      start competing services on 4310/1420.
- [x] Write evidence and documentation; mark only proved behavior and keep
      physical display/macOS/Windows/NLE/font redistribution limits explicit.
      Run formatter/doc-locale checks on changed documents; coordinate parent
      full format/i18n/lint/type/unit/media/build/browser/interchange/native gates.
- [ ] Commit the media/docs slice. Parent dispatches independent whole-branch
      review, fixes findings with focused regressions, records exact-head CI and
      creates the separate D5B PR. No push/PR/merge by this design worker.

## Execution handoff and self-review

All spec sections have an owner: contracts/layout Task 1; raster/font diagnosis
Task 2; mutation/recovery Task 3; receipts/Collect/interchange Task 4; cache and
current-project service Task 5; UI/Monitor Task 6; actual media/browser/docs
Task 7. Review-focus conditions are each assigned a named failure test above.
The single canonical string, three nested v1 data contracts and optional run
receipt field were approved by the parent before implementation. Tasks 1–6
are implemented and recorded in the private execution ledger; Task 7 records
actual media and focused regression proof. Six browser cases passed under the
parent's exclusive lease, now released. Fresh whole-branch review and exact-head
integration remain parent-owned gates. No full suite, native
benchmark, shared browser server, dependency upgrade, push or PR was started by
this worker without the parent's lease.
