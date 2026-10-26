# Professional Cut Desk Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a frame-accurate professional Source/Record foundation with versioned drop-frame timecode, continuous Composition playback, staged I/O and one acknowledged Undo transaction per accepted edit.

**Architecture:** Keep the saved Composition authoritative and add two view adapters: Source continues to use the existing Precision source surface, while Record resolves that Composition through one shared rational-frame resolver. Core owns timebase and sequence mapping; the renderer and Desktop consume those functions. The existing edit endpoint remains the atomic server boundary, while the Desktop gains an explicit queue-barrier transaction method for professional gestures.

**Tech Stack:** TypeScript 5.9, Vue 3.5, Vitest 5, Playwright 1.63, Node 24, pnpm 11, FFmpeg/ffprobe, existing OpenFilm core/application/solver/render packages

**Spec:** `docs/superpowers/specs/2026-10-26-professional-cut-desk-design.md`

## Global Constraints

- Implement only approved Phase 1A; Phase 1B monitor layout/Ribbon/gestures and Phase 1C responsive polish remain separate PRs.
- Base all work on repository commit `9f593eba5e067aa60c88579e6198425e5fcfa6a6` or its reviewed fast-forward successor; record the exact base/head in validation.
- One saved Composition remains authoritative; do not create a second timeline, hidden cut list or browser-only timing model.
- Original media is immutable; no test or preview may overwrite source bytes.
- Durable edits use existing validated `TimelineCommand` values and the existing revision/idempotency boundary.
- `I`/`O` stage transient Source marks; only **Apply range** persists one `trim` transaction and one active-session Undo entry.
- Clip locks, operation-specific source locks, required selections, stale revisions, autosave, reopen and project switching fail closed.
- General mode keeps its guided Story/Precision behavior and saved project/history; Expert labels those same targets as Record/Source.
- No untrusted project HTML, JavaScript, remote URL or executable shortcut profile is introduced.
- All UI strings are localized in en-US, zh-TW and ja-JP; pseudo-locale, IME, keyboard accessibility and CJK layout remain covered.
- Preserve Apache-2.0, LICENSE and NOTICE; fixtures must be synthetic or CC0 and contain no personal media.
- Do not claim cross-process Undo persistence, hardware performance, color-managed display parity or unsupported embedded source timecode.
- Each task follows TDD and ends in the listed focused tests and commit before the next task begins.

## Review Focus

1. **Legacy fractional rates and malformed explicit timebases:** `29.97`, `59.94`, exact NTSC ratios, mismatched `frameRate`, illegal DF rates and impossible labels must derive or reject without silently dirtying a project (Task 1 tests).
2. **Frame-boundary media resolution:** gaps, overlaps, crossfade tails, missing source duration and exact first/last frames must resolve identically under forward and random seek order (Task 4 tests).
3. **Ambiguous transaction completion:** stale base, lost acknowledgement, retry with the same request ID, abort and project disposal must never duplicate history or publish into a different project (Task 5 tests).
4. **Shortcut leakage:** text fields, selects, contenteditable, dialogs, retained-draft UI, Pipeline Workbench, modifier keys and active IME composition must retain native behavior (Tasks 6 and 9 tests).
5. **Decode or readiness failure at an edit:** unavailable media, a not-yet-ready next source, backgrounding and late media events must pause/fence Record rather than running a hidden clock or showing the wrong source (Tasks 7 and 8 tests).

---

## File Structure

- `packages/core/src/timebase.ts`: rational rate normalization, frame/time conversion and DF/NDF parsing/formatting.
- `packages/core/src/sequence.ts`: deterministic Composition-frame resolution and primary edit-point lookup.
- `packages/application/src/index.ts`: versioned timebase creation/update policy and durable project mutation.
- `apps/server/src/server.ts`: validated create/update adapters for project timebase.
- `apps/desktop/src/projectTimebase.ts`: finite new-project presets and same-rate DF alternative selection.
- `apps/desktop/src/composables/useTimelineEditor.ts`: explicit acknowledged professional transaction beside the existing coalesced queue.
- `apps/desktop/src/sourceMarks.ts`: revision-bound transient Source I/O state.
- `apps/desktop/src/composables/useRecordTransport.ts`: integer-frame Record clock, shuttle state and cancellation.
- `apps/desktop/src/components/TimecodeField.vue`: accessible parse/seek field shared by Source and Record.
- `apps/desktop/src/components/RecordMonitor.vue`: Composition-driven picture/audio presentation adapter.
- `apps/desktop/src/components/PrecisionEditor.vue`: Source target, staged marks and Source transport.
- `apps/desktop/src/components/TimelineEditor.vue`: target labels, Record integration, edit navigation and shortcut routing.
- `tests/e2e/professional-cut-desk.spec.ts`: real-browser professional workflow and project-switch regressions.
- `packages/render/tests/professional-cut-desk.test.ts`: real `30000/1001` MP4/audio/hash evidence.

### Task 1: Versioned rational project timebase

**Files:**

- Create: `packages/core/src/timebase.ts`
- Create: `packages/core/tests/timebase.test.ts`
- Modify: `packages/core/src/models.ts:58-63,379-390,476-491`
- Modify: `packages/core/src/validation.ts:1148-1200`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/project.test.ts:1-120`

**Interfaces:**

- Produces: `ProjectTimebaseV1 { version: 1; rateNumerator: number; rateDenominator: number; dropFrame: boolean }` as optional `ProjectSettings.timebase`.
- Produces: `timebaseRate(timebase: ProjectTimebaseV1): number`.
- Produces: `nominalFrameRate(timebase: ProjectTimebaseV1): number` and `timebaseKey(timebase: ProjectTimebaseV1): string`.
- Produces: `resolveProjectTimebase(settings: ProjectSettings): ProjectTimebaseV1` and `projectFrameRate(settings: ProjectSettings): number`.
- Produces: `sequenceFrameAt(seconds: number, timebase: ProjectTimebaseV1, rounding?: "floor" | "nearest"): number` and `sequenceTimeAt(frame: number, timebase: ProjectTimebaseV1): number`.
- Produces: `formatSequenceTimecode(frame: number, timebase: ProjectTimebaseV1): string` and `parseSequenceTimecode(value: string, timebase: ProjectTimebaseV1): number`.
- Produces: `projectSettingsWithTimebase(settings: ProjectSettings, timebase: ProjectTimebaseV1): ProjectSettings`.

- [ ] **Step 1: Write failing rational/DF tests**

  Add tests named `derives legacy rates without mutating settings`, `roundtrips 29.97 and 59.94 drop-frame boundaries`, `rejects nonexistent drop-frame labels and separators`, `keeps integer frame conversion stable beyond one day`, and `rejects malformed or mismatched explicit timebases`. Assert frame `1800` formats as `00:01:00;02`, frame `17982` as `00:10:00;00`, frame `3600` at 59.94 as `00:01:00;04`, and each formatted value parses to its original integer frame.

- [ ] **Step 2: Run the new core tests and observe the missing contract failure**

  Run: `pnpm exec vitest run packages/core/tests/timebase.test.ts packages/core/tests/project.test.ts`

  Expected: FAIL because `ProjectTimebaseV1` and the timebase functions do not exist.

- [ ] **Step 3: Add the timebase type, math and strict validation**

  Implement the listed interfaces. Map legacy values within `0.001` of `24000/1001`, `30000/1001` and `60000/1001` to those ratios; reduce other finite positive decimals with denominator at most `1_000_000`. Permit `dropFrame: true` only for exact `30000/1001` and `60000/1001`. Validate explicit `settings.frameRate` against the rational quotient with relative tolerance `1e-9`.

- [ ] **Step 4: Preserve legacy serialization and give newly created projects an explicit default**

  Keep schema-1 projects with no `timebase` valid and unmodified by `validateProject`/`migrateProject`. Change `createProject()` to include `30/1` NDF; retain the documented 0.1.0 migration's existing three-field settings output so migration alone does not invent durable metadata.

- [ ] **Step 5: Run focused core validation**

  Run: `pnpm exec vitest run packages/core/tests/timebase.test.ts packages/core/tests/project.test.ts`

  Expected: PASS, including JSON roundtrip and no input aliasing.

- [ ] **Step 6: Commit the core contract**

  ```bash
  git add packages/core/src/timebase.ts packages/core/src/models.ts packages/core/src/validation.ts packages/core/src/index.ts packages/core/tests/timebase.test.ts packages/core/tests/project.test.ts
  git commit -m "feat(core): add versioned project timebase"
  ```

### Task 2: Safe project timebase creation and update API

**Files:**

- Modify: `packages/application/src/index.ts:290-305,480-510,1490-1525`
- Modify: `packages/application/tests/project-mutation-failure.test.ts`
- Modify: `packages/core/src/errors.ts`
- Modify: `apps/server/src/server.ts:180-220,950-985,2370-2400`
- Modify: `apps/desktop/src/api.ts:280-287,910-930`
- Modify: `apps/desktop/src/i18n/locales/system-en-US.ts`
- Modify: `apps/desktop/src/i18n/locales/system-zh-TW.ts`
- Modify: `apps/desktop/src/i18n/locales/system-ja-JP.ts`
- Modify: `tests/integration/server.test.ts`

**Interfaces:**

- Consumes: Task 1 `ProjectTimebaseV1`, `resolveProjectTimebase`, `projectSettingsWithTimebase`.
- Produces: optional `CreateFilmOptions.timebase?: ProjectTimebaseV1` and `CreateFilmInput.timebase?: ProjectTimebaseV1`.
- Produces: `ProjectTimebaseUpdateInput { projectId: string; baseRevision: string; timebase: ProjectTimebaseV1 }`, using the existing project-version revision digest rather than timestamp equality.
- Produces: `OpenFilmApplication.updateProjectTimebase(input: ProjectTimebaseUpdateInput): OpenFilmProject`.
- Produces: `PATCH /api/project/timebase` and `api.updateProjectTimebase(input)`.
- Produces: stable `project.timebaseConflict` for foreign/stale/conform-required updates, localized in every supported UI locale.

- [ ] **Step 1: Write failing application and HTTP policy tests**

  Assert creation stores the requested exact rational and projected `frameRate`; same-rational NDF→DF update succeeds; foreign `projectId` and stale project-version `baseRevision` return 409; a rational-rate change succeeds only before any timed Composition exists; and a populated project rejects rate conform with no file mutation.

- [ ] **Step 2: Run the focused policy tests**

  Run: `pnpm exec vitest run packages/application/tests/project-mutation-failure.test.ts tests/integration/server.test.ts`

  Expected: FAIL because the create input and update endpoint do not accept timebase.

- [ ] **Step 3: Implement the application mutation boundary**

  Validate owner identity and `application.versions.currentRevision()` before mutation. Treat a legacy saved rate's Task 1-derived rational as its current rate, allowing its same-rational DF choice to normalize `frameRate`. Reject a rational change when any Composition has positive duration, clips, captions or GraphicScenes. Persist through `publishProject` so existing file-lock and atomic-write checks remain authoritative.

- [ ] **Step 4: Add strict server and Desktop adapters**

  Permit only the four version-1 timebase fields, require project/revision ownership for updates, and pass abort-safe typed data through `api.updateProjectTimebase`. Do not broaden the existing generic project PATCH allow-list.

- [ ] **Step 5: Re-run application and HTTP tests**

  Run: `pnpm exec vitest run packages/application/tests/project-mutation-failure.test.ts tests/integration/server.test.ts`

  Expected: PASS with 409 conflict evidence and byte-identical rejected project JSON.

- [ ] **Step 6: Commit the API boundary**

  ```bash
  git add packages/application/src/index.ts packages/application/tests/project-mutation-failure.test.ts packages/core/src/errors.ts apps/server/src/server.ts apps/desktop/src/api.ts apps/desktop/src/i18n/locales/system-en-US.ts apps/desktop/src/i18n/locales/system-zh-TW.ts apps/desktop/src/i18n/locales/system-ja-JP.ts tests/integration/server.test.ts
  git commit -m "feat(application): persist safe project timebase changes"
  ```

### Task 3: New-project timebase presets and existing-project DF choice

**Files:**

- Create: `apps/desktop/src/projectTimebase.ts`
- Create: `tests/unit/project-timebase-ui.test.ts`
- Modify: `apps/desktop/src/appTypes.ts`
- Modify: `apps/desktop/src/components/AppLauncher.vue`
- Modify: `apps/desktop/src/App.vue:1170-1210,1305-1340,4720-4760`
- Modify: `apps/desktop/src/i18n/modules/app/en-US.ts`
- Modify: `apps/desktop/src/i18n/modules/app/zh-TW.ts`
- Modify: `apps/desktop/src/i18n/modules/app/ja-JP.ts`
- Modify: `tests/e2e/ui-helpers.ts`
- Modify: `tests/e2e/global-workflow.spec.ts:250-330`

**Interfaces:**

- Consumes: Task 2 create/update APIs.
- Produces: `PROJECT_TIMEBASE_PRESETS` with `23.976 NDF`, `24 NDF`, `25 NDF`, `29.97 DF`, `29.97 NDF`, `30 NDF`, `50 NDF`, `59.94 DF`, `59.94 NDF`, `60 NDF`; default is `30 NDF`.
- Produces: `sameRateDropFrameChoice(settings: ProjectSettings): ProjectTimebaseV1 | undefined`.
- Produces: `FilmCreation.timebase` and App handler `changeProjectTimebase(timebase: ProjectTimebaseV1): Promise<void>` for Task 9.

- [ ] **Step 1: Write failing preset/payload tests**

  Assert every preset has a unique ID and valid Task 1 timebase, `29.97 DF` serializes `30000/1001`, default creation emits `30/1` NDF, and an existing NTSC project exposes only the opposite same-rate DF choice.

- [ ] **Step 2: Run focused UI unit tests**

  Run: `pnpm exec vitest run tests/unit/project-timebase-ui.test.ts`

  Expected: FAIL because the preset module and form field do not exist.

- [ ] **Step 3: Add the finite launcher control and typed creation payload**

  Add one labelled select to the existing creation form; do not expose free-form numerator/denominator entry. Keep the chosen preset when template or duration changes. Submit exact integers, never rounded strings.

- [ ] **Step 4: Add the fenced existing-project update handler**

  Flush current drafts, fetch the existing `/versions/revision` digest, capture `project.id`, call Task 2, then refresh only if ownership still matches. On conflict retain the current project and report the existing error surface.

- [ ] **Step 5: Verify localized real-browser creation**

  Extend the Traditional Chinese workflow to create `30000/1001 DF`, reopen it, and assert the exact saved `settings.timebase` plus projected `frameRate`; assert no raw translation keys.

  Run: `pnpm exec playwright test tests/e2e/global-workflow.spec.ts --grep "Traditional Chinese film"`

  Expected: PASS.

- [ ] **Step 6: Commit the creation UX**

  ```bash
  git add apps/desktop/src/projectTimebase.ts apps/desktop/src/appTypes.ts apps/desktop/src/components/AppLauncher.vue apps/desktop/src/App.vue apps/desktop/src/i18n/modules/app tests/unit/project-timebase-ui.test.ts tests/e2e/ui-helpers.ts tests/e2e/global-workflow.spec.ts
  git commit -m "feat(desktop): choose professional project timebase"
  ```

### Task 4: Shared sequence-frame resolver and renderer rate parity

**Files:**

- Create: `packages/core/src/sequence.ts`
- Create: `packages/core/tests/sequence.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/render/src/index.ts:390-430,600-855`
- Modify: `packages/render/tests/render.test.ts`

**Interfaces:**

- Consumes: Task 1 rational frame functions and existing `Composition`, `Track`, `Clip`, `MediaAsset`.
- Extends the renderer's structural `RenderSettings` with optional `timebase?: ProjectTimebaseV1`; export-profile rates remain independent.
- Produces: `ResolvedSequenceClip` with `trackId`, `trackIndex`, `clipIndex`, `clip`, `asset`, `startFrame`, `endFrame`, `localTime`, `sourceTime`, `opacity`, `visual`, and `audible`.
- Produces: `resolveCompositionFrame(composition: Composition, assets: readonly MediaAsset[], frame: number, timebase: ProjectTimebaseV1): { frame: number; time: number; primary?: ResolvedSequenceClip; visual: ResolvedSequenceClip[]; audible: ResolvedSequenceClip[] }`.
- Produces: `primaryEditFrames(composition: Composition, timebase: ProjectTimebaseV1): number[]`.
- Produces: `resolveClipFrameRange(clip: Clip, timebase: ProjectTimebaseV1): { startFrame: number; endFrame: number }` and `resolveClipSourceRange(clip: Clip, asset: MediaAsset): { sourceIn: number; sourceOut: number; speed: number }`.

- [ ] **Step 1: Write failing deterministic resolution tests**

  Cover exact first/last frame, gaps, overlapping overlay tracks, missing asset, invalid source bounds, speed mapping, incoming crossfade/outgoing tail opacity and deduplicated primary boundaries. Resolve frames in forward, reverse and seeded random order and assert deep equality by frame.

- [ ] **Step 2: Run the core resolver tests**

  Run: `pnpm exec vitest run packages/core/tests/sequence.test.ts`

  Expected: FAIL because the resolver module does not exist.

- [ ] **Step 3: Implement the pure half-open frame resolver**

  Match the renderer's existing start rule `round(timelineStart * rate)` and end rule `start + ceil((duration - 1e-9) * rate)`. The primary track is the first non-overlay `video` track. Return sorted layers in saved track/clip order and throw on invalid/missing source data rather than inventing a clip.

- [ ] **Step 4: Normalize renderer project rate through the same timebase**

  At renderer admission, create an internal settings copy whose `frameRate` is Task 1 `projectFrameRate(settings)`. Replace the duplicated source-range calculation with `resolveClipSourceRange`; do not change export-profile frame rate semantics.

- [ ] **Step 5: Verify core and existing render boundaries**

  Run: `pnpm exec vitest run packages/core/tests/sequence.test.ts packages/render/tests/render.test.ts`

  Expected: PASS, including legacy integer rates and canonical legacy `29.97` behavior.

- [ ] **Step 6: Commit the shared resolver**

  ```bash
  git add packages/core/src/sequence.ts packages/core/src/index.ts packages/core/tests/sequence.test.ts packages/render/src/index.ts packages/render/tests/render.test.ts
  git commit -m "feat(core): share deterministic sequence frame resolution"
  ```

### Task 5: Explicit acknowledged edit transaction

**Files:**

- Modify: `apps/desktop/src/api.ts:1335-1350`
- Modify: `apps/desktop/src/composables/useTimelineEditor.ts:1-430`
- Modify: `tests/unit/p0-editor-command-state.test.ts`
- Modify: `packages/application/tests/editor.test.ts`
- Modify: `tests/integration/editor-http.test.ts`

**Interfaces:**

- Consumes: existing `api.edit`, local `applyTimelineCommand`, request receipts and server history.
- Produces: `CommitTransactionResult = { status: "accepted"; revision: string } | { status: "conflict" | "cancelled" | "failed" }`.
- Produces: `commitTransaction(input: TimelineCommand | TimelineCommand[], referencedAssets?: readonly MediaAsset[], signal?: AbortSignal): Promise<CommitTransactionResult>` from `useTimelineEditor`.
- Produces: `transactionBusy: ComputedRef<boolean>`; existing `historyBusy` remains semantically history-only.

- [ ] **Step 1: Write failing queue-barrier and ambiguity tests**

  Assert an older coalesced command is acknowledged before the transaction; the transaction receives a fresh base revision/request ID and one API batch; Undo restores exactly the pre-transaction state; 409 reloads saved state without leaving an optimistic command queued; a lost response is recovered with the same request ID; pre-send abort sends nothing; and disposal fences the late result.

- [ ] **Step 2: Run focused transaction tests**

  Run: `pnpm exec vitest run tests/unit/p0-editor-command-state.test.ts packages/application/tests/editor.test.ts tests/integration/editor-http.test.ts`

  Expected: FAIL because `commitTransaction` is absent.

- [ ] **Step 3: Implement the explicit barrier without replacing normal autosave**

  Flush pending/history work, locally validate the complete batch, persist its request ID in the existing draft envelope, publish one optimistic state, and call `api.edit` immediately. Clear the envelope only after acknowledgement. On 409 discard the optimistic batch and reload; on ambiguous transport failure retain the exact batch for idempotent recovery.

- [ ] **Step 4: Fence cancellation and owner changes**

  Add optional `AbortSignal` to `api.edit`. Never publish after composable disposal; a request possibly accepted before abort remains in recovery storage until an idempotent reload resolves it. Reject a second professional transaction while one is active.

- [ ] **Step 5: Verify one-request/one-history behavior**

  Run: `pnpm exec vitest run tests/unit/p0-editor-command-state.test.ts packages/application/tests/editor.test.ts tests/integration/editor-http.test.ts`

  Expected: PASS, including retry receipts and reopen with `canUndo === false` after process/session reconstruction.

- [ ] **Step 6: Commit the transaction boundary**

  ```bash
  git add apps/desktop/src/api.ts apps/desktop/src/composables/useTimelineEditor.ts tests/unit/p0-editor-command-state.test.ts packages/application/tests/editor.test.ts tests/integration/editor-http.test.ts
  git commit -m "feat(desktop): add atomic professional edit transaction"
  ```

### Task 6: Source marks, Source transport and accessible timecode entry

**Files:**

- Create: `apps/desktop/src/sourceMarks.ts`
- Create: `apps/desktop/src/components/TimecodeField.vue`
- Create: `tests/unit/source-marks.test.ts`
- Modify: `apps/desktop/src/components/PrecisionEditor.vue:1-825,1365-1450`
- Modify: `apps/desktop/src/monitor.ts`
- Modify: `apps/desktop/src/i18n/modules/precision/en-US.ts`
- Modify: `apps/desktop/src/i18n/modules/precision/zh-TW.ts`
- Modify: `apps/desktop/src/i18n/modules/precision/ja-JP.ts`
- Modify: `tests/unit/monitor-stability.test.ts`
- Modify: `tests/unit/precision-navigation-barrier.test.ts`
- Modify: `tests/e2e/native-runtime-shortcuts.spec.ts`
- Modify: `tests/e2e/precision-editing.spec.ts`

**Interfaces:**

- Consumes: Task 1 timecode functions and Task 5 `commitTransaction`.
- Produces: `SourceMarkOwner { projectId: string; compositionId: string; revision: string; clipId: string; assetId: string; timebaseKey: string }` and pure `SourceMarks` transitions `stageIn`, `stageOut`, `markStale`, `reset`.
- Produces: `TimecodeField` props `{ frame: number; timebase: ProjectTimebaseV1; label: string; minFrame: number; maxFrame: number; disabled?: boolean }` and `seek(frame)` emit.
- Produces from `PrecisionEditor` expose: `play`, `pause`, `stop`, `shuttle(direction: -1 | 1)`, `step(direction: -1 | 1, seconds?: boolean)`, `stageIn`, `stageOut`, `applyRange`, `addSourceMarker`, `playhead`, `marksStale`, and existing `flush`/`hasPending`.
- Changes `PrecisionEditor` props to include `revision: string`, `settings: ProjectSettings`, and `commit(command: TimelineCommand, signal?: AbortSignal): Promise<CommitTransactionResult>` while retaining `submit` for non-professional coalesced Inspector paths.

- [ ] **Step 1: Write failing Source mark and shortcut tests**

  Assert I/O changes only transient values; invalid order disables Apply; Apply calls one `trim` transaction; selection/project/timebase change clears marks; revision change marks them stale; accepted Apply resets them; and locked primary source versus clip/overlay lock follows the approved matrix.

- [ ] **Step 2: Add failing keyboard-isolation cases**

  In the real Chromium shortcut fixture cover active IME, input/select/contenteditable, dialog, retained draft and Pipeline Workbench. Assert `J/K/L/I/O/B/M`, Space and arrows do not prevent default or mutate counters in those contexts.

- [ ] **Step 3: Run focused Source tests**

  Run separately:

  ```bash
  pnpm exec vitest run tests/unit/source-marks.test.ts tests/unit/monitor-stability.test.ts tests/unit/precision-navigation-barrier.test.ts
  pnpm exec playwright test tests/e2e/native-runtime-shortcuts.spec.ts
  ```

  Expected: FAIL on missing staged-mark and shuttle behavior.

- [ ] **Step 4: Implement staged marks and transaction-backed Apply**

  Stop calling `trim` from Set In/Set Out and numeric changes. Show explicit Apply/Reset, stale and protection reasons. Route Apply, split and pointer/keyboard trim commit through Task 5; marks remain transient and are not written to localStorage or Composition.

- [ ] **Step 5: Implement Source shuttle and direct timecode**

  Use bounded tiers `-4, -2, -1, 0, 1, 2, 4`. Positive tiers use supported media playback rate; negative tiers use integer-frame stepping from the reliable source rate or labelled project-rate fallback. `K` stops, `Home`/`End` seek the staged Source range, `M` remains source-only, and `event.isComposing` plus the complete isolation guard wins before shortcut handling.

- [ ] **Step 6: Verify Source behavior in the real Precision fixture**

  Add browser assertions that I/O makes no network edit until Apply, Apply is one edit request/one Undo, stale marks cannot apply after an external edit, source-lock trim remains allowed, source-lock split is blocked, and reopen retains only the accepted range.

  Run: `pnpm exec playwright test tests/e2e/precision-editing.spec.ts --grep "staged|source lock|split"`

  Expected: PASS.

- [ ] **Step 7: Commit Source semantics**

  ```bash
  git add apps/desktop/src/sourceMarks.ts apps/desktop/src/components/TimecodeField.vue apps/desktop/src/components/PrecisionEditor.vue apps/desktop/src/monitor.ts apps/desktop/src/i18n/modules/precision tests/unit/source-marks.test.ts tests/unit/monitor-stability.test.ts tests/unit/precision-navigation-barrier.test.ts tests/e2e/native-runtime-shortcuts.spec.ts tests/e2e/precision-editing.spec.ts
  git commit -m "feat(desktop): stage source marks and add professional transport"
  ```

### Task 7: Integer-frame Record transport

**Files:**

- Create: `apps/desktop/src/composables/useRecordTransport.ts`
- Create: `tests/unit/record-transport.test.ts`

**Interfaces:**

- Consumes: Task 1 rational frame helpers and Task 4 `primaryEditFrames`.
- Produces: `RecordTransport` with refs `frame`, `playing`, `shuttleRate`, `buffering` and methods `play()`, `pause()`, `stop()`, `seek(frame: number)`, `step(direction: -1 | 1, seconds?: boolean)`, `shuttle(direction: -1 | 1)`, `previousEdit()`, `nextEdit()` and `dispose()`.
- Consumes injected `now`, `requestFrame`, `cancelFrame` and visibility hooks in tests; production defaults use browser APIs.

- [ ] **Step 1: Write failing integer-clock tests**

  Inject fake `performance.now`, rAF and visibility. Assert forward playback crosses two exact edit frames, reverse shuttle visits deterministic decreasing frames, repeated J/L changes bounded tier, K stops, one-second step uses nominal frame count, seek order does not affect resolved output, and end-of-Composition stops on the final complete frame.

- [ ] **Step 2: Write failing clock cancellation tests**

  Assert inactive target and visibility loss pause without advancing, a buffering hold freezes the current frame, owner change resets the clock, and `dispose()` cancels every rAF/visibility listener.

- [ ] **Step 3: Run the Record unit tests**

  Run: `pnpm exec vitest run tests/unit/record-transport.test.ts packages/core/tests/sequence.test.ts`

  Expected: FAIL because the Record transport does not exist.

- [ ] **Step 4: Implement the monotonic integer-frame clock**

  Anchor play to `{frame, now}` and derive requested frames from Task 1 rational rate, never by accumulating floating-point seconds. Reverse is frame-stepped. Stop/fence on inactive target, hidden document, owner change or an explicit buffering hold supplied by the monitor.

- [ ] **Step 5: Verify the pure transport contract**

  Run: `pnpm exec vitest run tests/unit/record-transport.test.ts packages/core/tests/sequence.test.ts`

  Expected: PASS with no pending fake rAF or visibility listener after disposal.

- [ ] **Step 6: Commit the Record clock**

  ```bash
  git add apps/desktop/src/composables/useRecordTransport.ts tests/unit/record-transport.test.ts
  git commit -m "feat(desktop): add integer-frame record transport"
  ```

### Task 8: Composition-driven Record monitor

**Files:**

- Create: `apps/desktop/src/components/RecordMonitor.vue`
- Create: `tests/unit/record-monitor.test.ts`
- Modify: `apps/desktop/src/components/PhotoPresentationPreview.vue`
- Modify: `apps/desktop/src/components/NativeTitlePreview.vue`
- Modify: `apps/desktop/src/components/GraphicScenePreview.vue`

**Interfaces:**

- Consumes: Task 4 `resolveCompositionFrame`, Task 7 `RecordTransport`, existing photo/title/GraphicScene evaluators and `evaluateAudioGain`.
- Produces: `RecordMonitor` props `{ projectId; composition; assets; revision; settings; sourceStatuses?; sourceVersion?; active }`, emits `frame`, `playing`, `selectClip`, `split({ clipId: string; sourceTime: number })`, `issue`, and exposes the Task 7 transport methods.
- Produces: controlled photo preview props `externalTime?: number` and `externalPlaying?: boolean`; omission preserves current self-owned General preview.

- [ ] **Step 1: Write failing readiness and owner-fencing tests**

  Assert the next primary source is pre-armed, a not-ready boundary holds Task 7 with `buffering`, missing source pauses with a typed issue, project/composition identity change remounts both banks, and late `canplay`/`timeupdate` from the old owner is ignored.

- [ ] **Step 2: Write failing layer and audio tests**

  Resolve the same frames in seeded random order and assert saved visual order, source time, crossfade opacity, controlled photo local time, title/GraphicScene sequence time and every active audio element's clip volume × automation gain. Assert reverse shuttle pauses/mutes audio.

- [ ] **Step 3: Run the monitor tests**

  Run: `pnpm exec vitest run tests/unit/record-monitor.test.ts tests/unit/record-transport.test.ts`

  Expected: FAIL because RecordMonitor and controlled photo preview do not exist.

- [ ] **Step 4: Implement current/next media banks and readiness hold**

  Maintain current/next primary media banks, seek each bank with Task 4 `sourceTime`, pre-arm before the edit and preserve saved layer order. Do not advance the clock across an unready or unavailable primary source; publish the specific issue and resume only for the same owner.

- [ ] **Step 5: Implement supported picture, graphics and audible layers**

  Reuse controlled photo evaluation, NativeTitlePreview, effective look, GraphicScenePreview at Record time and existing geometry helpers. Create one media element per currently audible entry, apply clip volume × `evaluateAudioGain`, and resync only on source change, explicit seek, boundary or drift beyond half a source frame.

- [ ] **Step 6: Verify component lifecycle and General-preview compatibility**

  Run: `pnpm exec vitest run tests/unit/record-monitor.test.ts tests/unit/record-transport.test.ts tests/unit/photo-preview-source-recovery.test.ts tests/unit/native-title-preview.test.ts`

  Expected: PASS; uncontrolled PhotoPresentationPreview behavior remains unchanged.

- [ ] **Step 7: Commit the Record monitor**

  ```bash
  git add apps/desktop/src/components/RecordMonitor.vue apps/desktop/src/components/PhotoPresentationPreview.vue apps/desktop/src/components/NativeTitlePreview.vue apps/desktop/src/components/GraphicScenePreview.vue tests/unit/record-monitor.test.ts
  git commit -m "feat(desktop): add continuous Composition record monitor"
  ```

### Task 9: Expert Source/Record integration and professional keyboard routing

**Files:**

- Create: `apps/desktop/src/i18n/modules/cut-desk/en-US.ts`
- Create: `apps/desktop/src/i18n/modules/cut-desk/zh-TW.ts`
- Create: `apps/desktop/src/i18n/modules/cut-desk/ja-JP.ts`
- Modify: `apps/desktop/src/i18n/locales/en-US.ts`
- Modify: `apps/desktop/src/i18n/locales/zh-TW.ts`
- Modify: `apps/desktop/src/i18n/locales/ja-JP.ts`
- Modify: `apps/desktop/src/components/TimelineEditor.vue:90-155,240-390,1320-1535,2320-2865`
- Modify: `apps/desktop/src/App.vue:4720-4770`
- Modify: `apps/desktop/src/editor.css`
- Modify: `tests/unit/timeline-clip-render-boundary.test.ts`
- Modify: `tests/e2e/workspace-modes.spec.ts`

**Interfaces:**

- Consumes: Tasks 3, 5, 6, 7 and 8.
- Produces: Timeline emit `timebaseChange(timebase: ProjectTimebaseV1)` and exposed navigation `navigateToRecordFrame(frame: number): Promise<boolean>`.
- Produces: explicit active monitor target derived from existing mode: Expert `story` = Record, Expert `precision` = Source; General retains Story/Precision copy and behavior.
- Produces: Record split transaction `{ type: "clip.split"; clipId: primary.clip.id; sourceTime: primary.sourceTime }` only when Task 4 resolves one eligible primary clip.

- [ ] **Step 1: Write failing integration assertions**

  Extend compiled-SFC tests to require a RecordMonitor only for active Expert Record, preserve the existing General player, pass the exact current Composition/revision/settings, and fence all callbacks after project/composition identity changes.

- [ ] **Step 2: Add Source/Record target labels and timebase control**

  In Expert mode label the existing Story and Precision tabs Record and Source, with an explicit target status; do not add another timeline. Add Task 1 TimecodeField to each target. Offer only Task 3's same-rate DF/NDF alternative for an existing project and emit the fenced App update.

- [ ] **Step 3: Route Record keyboard commands**

  Expert Record owns Space, J/K/L, frame/second arrows, Up/Down edit navigation, `Home`/`End` sequence bounds, B and direct sequence timecode; Record M is intentionally ignored until a sequence-marker contract exists. General Story retains Left/Right clip navigation and existing Delete behavior. Source remains owned by Precision. Apply the shared IME/input/modal/draft/Pipeline guard before every mode-specific branch.

- [ ] **Step 4: Route Record split through the atomic transaction**

  Pause transport, resolve the exact frame again against the latest editor state, and call Task 5 once. Solver errors remain authoritative for clip/source locks, crossfade and bounds; the UI never auto-unlocks or selects a different clip to make split succeed.

- [ ] **Step 5: Verify workspace modes and localization**

  Run separately:

  ```bash
  pnpm test:i18n
  pnpm exec vitest run tests/unit/timeline-clip-render-boundary.test.ts
  pnpm exec playwright test tests/e2e/workspace-modes.spec.ts
  ```

  Expected: PASS in General/Expert and en-US/zh-TW/ja-JP/pseudo-locale; no raw keys or shortcut leakage.

- [ ] **Step 6: Commit Cut Desk integration**

  ```bash
  git add apps/desktop/src/i18n/modules/cut-desk apps/desktop/src/i18n/locales apps/desktop/src/components/TimelineEditor.vue apps/desktop/src/App.vue apps/desktop/src/editor.css tests/unit/timeline-clip-render-boundary.test.ts tests/e2e/workspace-modes.spec.ts
  git commit -m "feat(desktop): integrate expert source and record targets"
  ```

### Task 10: Real browser, FFmpeg and release-grade validation

**Files:**

- Create: `tests/e2e/professional-cut-desk.spec.ts`
- Create: `packages/render/tests/professional-cut-desk.test.ts`
- Create: `docs/professional-cut-desk.md`
- Create: `docs/validation-professional-cut-desk.md`
- Add: `docs/superpowers/specs/2026-10-26-professional-cut-desk-design.md`
- Add: `docs/superpowers/plans/2026-10-26-professional-cut-desk-phase-1a.md`
- Modify: `docs/CONTRACTS.md`
- Modify: `docs/en/CONTRACTS.md`
- Modify: `TASKS.md`
- Modify: `ROADMAP.md`

**Interfaces:**

- Consumes: the complete Phase 1A surface.
- Produces: synthetic fixture and exact evidence only; no new production API.

- [ ] **Step 1: Write the real FFmpeg regression before declaring parity**

  Generate local red/green/blue picture sources with distinct synthetic tones and hashes. Build an exact 180-frame `30000/1001` Composition with two edit boundaries, one crossfade, one GraphicScene and an audible overlay. Render MP4, ffprobe `avg_frame_rate === "30000/1001"` and 180 decoded frames, sample first/middle/last and both boundary frames for expected source/layer identity, measure tone windows, verify manifest source hashes, and confirm every original hash is unchanged.

- [ ] **Step 2: Run the FFmpeg regression and fix only production discrepancies**

  Run: `pnpm exec vitest run packages/render/tests/professional-cut-desk.test.ts`

  Expected: PASS with the test printing artifact path, frame count, sampled timestamps, stream rate, source hashes and warnings. Do not weaken tolerances to hide a renderer/monitor mismatch.

- [ ] **Step 3: Add the real-browser professional workflow**

  Use the same class of synthetic sources. Assert Record crosses boundaries without selection-driven restart; seeded random seeks show the same active clip and GraphicScene frame; Source I/O produces no edit before Apply; Apply/split each take one Undo; Home/End use the active target's bounds; Record M writes no source or sequence marker; DF entry rejects `00:01:00;00` and accepts `00:01:00;02`; source/clip/overlay lock rows match policy; external edit makes marks stale; project switch cancels transport and ignores late media events; General mode remains usable.

- [ ] **Step 4: Run focused browser and accessibility evidence**

  Run: `pnpm exec playwright test tests/e2e/professional-cut-desk.spec.ts tests/e2e/precision-editing.spec.ts tests/e2e/native-runtime-shortcuts.spec.ts tests/e2e/workspace-modes.spec.ts`

  Expected: PASS in Chromium with axe checks, keyboard-only operation and no horizontal page overflow at 1024×768, 1440×900 and 1920×1080. This is browser evidence, not a physical workstation claim.

- [ ] **Step 5: Document contract, limitations and evidence**

  Document rational/DF rules, source elapsed-time fallback, Source/Record ownership, current source-only marker scope, transaction recovery, lock matrix, unsupported sequence markers, session-only Undo and manual gates. Update TASKS/ROADMAP only for Phase 1A; keep 1B–4 incomplete.

- [ ] **Step 6: Run the complete available repository gates**

  Run in order:

  ```bash
  pnpm format:check
  pnpm test:i18n
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm build
  pnpm test:e2e
  pnpm test:interchange
  pnpm test:native
  ```

  Expected: every available gate passes. If native prerequisites or Windows/macOS workstation access are absent, record that as an unexecuted manual gate; do not report it as passing.

- [ ] **Step 7: Perform final diff, security and scope review**

  Run separately:

  ```bash
  git diff --check
  git status --short
  git diff --stat <base>...HEAD
  ```

  Confirm no private media/cache, generated MP4, credentials, HTML/JS execution path, second timeline, Phase 1B mock UI or unrelated user change is committed.

- [ ] **Step 8: Commit validation and documentation**

  ```bash
  git add tests/e2e/professional-cut-desk.spec.ts packages/render/tests/professional-cut-desk.test.ts docs/professional-cut-desk.md docs/validation-professional-cut-desk.md docs/superpowers/specs/2026-10-26-professional-cut-desk-design.md docs/superpowers/plans/2026-10-26-professional-cut-desk-phase-1a.md docs/CONTRACTS.md docs/en/CONTRACTS.md TASKS.md ROADMAP.md
  git commit -m "test: validate professional cut desk phase 1a"
  ```

## Completion Criteria

- Phase 1A is complete only when all ten task commits are present, focused tests and full available gates are recorded at the exact head, and the FFmpeg/browser evidence matches the saved Composition.
- A PR may be opened after fresh review finds no correctness blocker; it must report exact base/head SHA, changed paths, CI, actual tests, FFmpeg evidence and manual gates.
- Do not merge or mark Phase 1B–4 complete as part of this plan.
