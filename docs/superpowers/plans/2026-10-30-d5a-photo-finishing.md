# D5A Photo Finishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct focal editing, bounded custom Bézier motion and raw ambient
fill through the existing photo commands, with recoverable edits and measured
Monitor/MP4 parity.

**Architecture:** Keep existing v1 recipes exact and introduce explicit v2 layout
and motion variants. Core owns bounded geometry/easing, one render preparation
function produces the raw ambient PNG for both adapters, and the existing editor
transaction accepts each completed focal gesture against its captured revision.

**Tech Stack:** Existing TypeScript, Vue 3, SQLite/project JSON, FFmpeg,
Vitest/Playwright, Vue i18n and `--of-*` design tokens; no dependency upgrades.

**Spec:** `docs/superpowers/specs/2026-10-30-d5a-photo-finishing-design.md`

## Global Constraints

- Base `e1255b1a8a83260149211d909cca8c1a50948c6b`; implementation waits for
  coordinator approval of the proposed interfaces.
- Owner is the existing nested D5A/F05 task. Do not add another task queue.
- Keep exact v1 layouts, fixed easing and legacy contain/identity defaults;
  no project-schema or SQLite-schema bump. Unknown versions/fields fail closed.
- Ambient `blurSigma` is finite in `[0, 0.05]`, `dim` finite in `[0, 0.85]`.
  Explicit creation defaults are `blurSigma: 0.02`, `dim: 0.45`.
- Bézier coordinates are finite in `[0, 1]`, with `x1 <= x2` and `y1 <= y2`.
  Endpoints are fixed at `(0,0)` and `(1,1)`. Initial custom handles are
  `(0.42,0)` and `(0.58,1)`; inversion uses exactly 24 bisection steps.
- The ambient intermediate contains raw source appearance before primary color
  or Film Looks. Combine raw foreground and ambient, then apply the coordinated
  primary → Film Look group once, then existing motion/static transform and
  transition compositing. Titles/captions/GraphicScene overlays stay outside.
- Source bytes at most 64 MiB; source pixels at most 32,000,000; output pixels
  at most 8,294,400. Source-copy budget 1 GiB, raster budget 256 MiB per call,
  individual PNG at most 64 MiB; no per-frame ambient sequence.
- No second timeline, remote URL, project expression syntax, arbitrary JS/HTML,
  source overwrite, silent fallback, new saved pin or automatic lock.
- Reuse source verification, project CAS, locks/required selections, existing
  request recovery/history, PhotoDepth fallback, display/color admission and
  FFmpeg floating perspective/cubic interpolation.
- Use synthetic/CC0 fixtures only. Keep private evidence under `/tmp`.
- Shared servers on ports 4310/1420, complete Vitest, native/benchmark and full
  browser gates are coordinator-owned. Obtain the coordinator's scheduling slot
  before browser work; do not start those servers from an isolated worktree.

## Review Focus

- A revision/source changes while transaction flush is awaiting: reject before
  optimistic publication or POST. Task 3 owns the delayed-flush regression.
- An old Inspector/preset path reconstructs v1 and drops a saved fill/curve:
  preserve untouched options and only downgrade on explicit removal. Task 4
  owns the field-preservation regressions.
- Record Monitor bypass or grouped color applies the creative operation twice:
  raw raster excludes color, group gets color once, captions remain independent.
  Tasks 2 and 5 own distinct-region and deliberate double-color failures.
- A source/project changes during queued PNG preparation: return no obsolete
  bytes and never let an old load/error change readiness. Tasks 2–4 own source
  pin, HTTP closure and stale-image regressions.
- A near-frame-width diptych gap rounds a fill cell to zero pixels: reject v2
  atomically against the actual frame without changing legacy parsing. Tasks 1
  and 3 own portable/project-aware boundary regressions.

---

### Task 1: Portable variants and deterministic core

**Files:**

- Modify `packages/core/src/{models,validation,presentation,index}.ts`.
- Create `packages/core/src/photo-easing.ts` and
  `packages/core/tests/photo-easing.test.ts`.
- Modify `packages/core/tests/presentation.test.ts` and
  `packages/solver/tests/quality-editing.test.ts`.

**Interfaces:**

- Produces `PhotoLayoutV1`, `PhotoLayoutV2`, `PhotoAmbientFillV1`,
  `PhotoMotionV1`, `PhotoMotionV2`, `PhotoBezierEasingV1` and `PhotoEasing`
  exactly as the spec defines; retain existing `PhotoLayout`/`PhotoMotion` names
  as unions.
- Produces `PHOTO_BEZIER_BISECTION_STEPS = 24` and
  `evaluatePhotoEasing(easing: PhotoEasing, progress: number): number`.
- Extends `PhotoPlan` with optional `ambient: PhotoAmbientPlan`; define the
  spec's `PhotoAmbientLayer`/`PhotoAmbientPlan` and preserve old result shapes
  when ambient is absent. Existing resolver/evaluator signatures stay intact.

- [ ] Add failing tests named `keeps legacy plans and optional fields exact`,
      `rejects unsupported nested recipe shapes`, `bounds and orders Bezier handles`,
      `is independent of seek order`, `resolves ambient cells without changing
protected foreground safety`, and `preserves protected v2 clips in regeneration`.
      Assertions include absent `ambient` for v1; exact legacy smoothstep values;
      rejection at `blurSigma=0.050001`, `dim=0.850001`, crossed handles, all unknown
      versions/keys, strings/arrays/nonfinite numbers; valid equal/endpoint handles;
      exact progress endpoints, clamp and no input mutation. Use a 320×180 frame and
      reject a v2 diptych gap of 319 whose rounded cell is zero pixels; preserve the
      legacy version-1 portable validator behavior.
- [ ] Run `pnpm exec vitest run packages/core/tests/photo-easing.test.ts
packages/core/tests/presentation.test.ts packages/solver/tests/quality-editing.test.ts`.
      Confirm failures identify unsupported v2/easing/ambient interfaces.
- [ ] Implement strict discriminants in the existing validators, export the new
      types/helpers, add optional ambient planning and replace only the evaluator's
      easing branch with the shared helper. Use fixed 24-step bisection, exact
      endpoint returns and the spec's `<` branch. Keep existing safety warnings,
      hold behavior, clock, diptych and source-dimension ownership.
- [ ] Repeat the focused command; expect all selected tests to pass. Confirm
      old exact `PhotoPlan` assertions still pass unchanged and protected
      regeneration retains both complete v2 recipes.
- [ ] Commit the core deliverable and obtain a fresh contract review before
      using these interfaces downstream.

### Task 2: Shared raw ambient preparation and actual FFmpeg easing

**Files:**

- Create `packages/render/src/{photo-easing,photo-ambient}.ts`.
- Modify `packages/render/src/{photo-filters,index,manifest}.ts`.
- Create `packages/render/tests/{photo-easing,photo-ambient}.test.ts`.
- Modify `packages/render/tests/photo-quality.test.ts` and
  `packages/render/tests/presentation-capability.test.ts`.

**Interfaces:**

- Consumes Task 1's `PhotoEasing`, ambient plan and iteration constant.
- Produces `photoEasingExpression(easing: PhotoEasing,
progressExpression: string): string`; only callers supply trusted generated
  progress expressions, never user strings.
- Produces `preparePhotoAmbientFills(clips: readonly Clip[], assets: readonly
MediaAsset[], frame: FrameSize, work: string, options?: { signal?: AbortSignal })
: Promise<PreparedPhotoAmbientFills>` with the spec's `fills`,
  `assetOverrides`, `sources`, `verifySources` and `assertSourceIdentities`.
- Extends `photoPresentationFilters` options with
  `ambient?: { path: string; sha256: string }`; its existing return shape stays
  unchanged. Produces the spec's `RenderPhotoPresentationEvidence`; old sidecars
  omit it, and `renderer.presentationVersion` becomes 2 only for actual v2 use.
  Renderer options/source snapshots remain the existing contract.

- [ ] Add failing actual-render tests for fixed-step expression equivalence;
      two ambient cells/gap and fractional bounds; raw raster excluding Film Look;
      source-alpha handling; same-ID/source-byte changes; cancellation and work
      limits; stationary legacy byte identity; existing PhotoDepth fallback;
      prior-output/sidecar preservation after preparation failure. Include a
      synthetic PNG with a nonopaque patch and orientation/SAR metadata.
- [ ] Run only `pnpm exec vitest run packages/render/tests/photo-easing.test.ts
packages/render/tests/photo-ambient.test.ts` (no servers); expect feature
      failures. Reproduce the disposable spike in a committed focused test with six
      curves × 257 actual perspective-expression samples and error <= `5.1e-7`
      when using FFmpeg six-decimal output. Include small exponent-form constants.
- [ ] Implement the bounded `st`/`ld`/`while` compiler with reset registers and
      shared constants. Preserve `(on-1)/fps/duration`, 24 iterations, fixed easing
      strings, floating affine coordinates and `interpolation=cubic`. Use validated
      numeric literals and a trusted polynomial template; no project expression
      string or curve LUT enters the graph.
- [ ] Implement ambient preparation by composing existing verified-source and
      graphic image admission helpers. Decode the admitted owned copies, generate
      one full-frame raw PNG per unique fill/geometry/source recipe, and retain
      verified foreground asset overrides until the renderer's existing work
      cleanup. Enforce source/pixel/raster budgets, cell clipping, black gap,
      `gblur:steps=3`, zero-blur bypass and `1-dim` RGB once. Expose final original
      hash and identity checks; no catalog/source mutation.
- [ ] Integrate preparation before renderer input construction; primary and
      secondary inputs for affected clips resolve through `assetOverrides`.
      Combine raw fill/foreground, then one group color stage, then existing
      motion/static/transition handling. Coordinate the primary → Film Look seam
      with D5C; use existing Film Look code rather than adding color formulas.
      Include ambient/easing recipe policy and PNG/source hashes in sidecars,
      retaining the stable outer manifest version and completed-output publication.
- [ ] Run the new focused files, then the relevant photo-quality/capability
      cases with `-t` selectors. Expect real FFmpeg success, matching source hashes,
      exact legacy/fallback output comparisons and rejection preserving old bytes.
      Record FFmpeg version/build. FFmpeg 6.1 expression proof is a required CI gate.
- [ ] Commit this renderer deliverable and obtain fresh source/render review.

### Task 3: Saved-snapshot preview service and pinned transactions

**Files:**

- Create `packages/application/src/photo-presentation.ts` and
  `packages/application/tests/photo-presentation.test.ts`.
- Modify `packages/application/src/{index,editor}.ts`,
  `packages/application/tests/quality-presentation-validation.test.ts`,
  `apps/server/src/server.ts`, `apps/desktop/src/api.ts`,
  `apps/desktop/src/composables/useTimelineEditor.ts`,
  `tests/unit/p0-editor-command-state.test.ts` and
  `tests/integration/photo-quality-http.test.ts`.

**Interfaces:**

- Consumes Task 2's preparation function and its exact owned-work/source contract.
- Produces `PhotoAmbientInput { projectId: string; baseRevision: string;
signal?: AbortSignal }`, `PhotoPresentationService.ambient(compositionId:
string, clipId: string, input: PhotoAmbientInput): Promise<Buffer>` and
  `close(): void`; attach it as `OpenFilmApplication.photoPresentation`.
- Produces GET `/api/compositions/:compositionId/photo-fill/:clipId.png` with
  required `projectId` and `revision` query fields, no-store PNG bytes and the
  spec's closed request/error behavior.
- Produces `photoFillPreviewUrl(compositionId: string, clipId: string,
revision: string, projectId: string): string`.
- Extends the hook with `CommitTransactionOptions { expectedBaseRevision?:
string }` as the optional fourth `commitTransaction` argument. Existing
  callers and `CommitTransactionResult` are unchanged.

- [ ] Add failing tests for wrong/current project and revision; disk/settings
      or source change while blocked in decode; abort/disconnect/close; one worker,
      four distinct pending keys, exact-key deduplication and last-waiter abort;
      missing source/unsupported codec/budget status; no output/cache publication
      after failure. Assert no request accepts URL/path/filter/HTML/draft recipe.
- [ ] Add `rejects a captured revision after awaited flush before any POST` in
      the existing hook harness. Delay flush, publish a different acknowledged
      revision, then release; expect `{status:"conflict"}`, unchanged authoritative
      state and no new transaction draft/request/history. Verify callers omitting
      the pin retain existing behavior. Also test pre-dispatch abort and ambiguous
      sent-request draft recovery.
- [ ] Add application validation/history tests: invalid v2 gap is rejected
      before any batch mutation and preserves redo/disk bytes; valid v2 presentation
      is one Undo step; exact request retry, Redo, autosave/reopen and Named Version
      restore retain exact optional fields; locks/paired/required selections and
      duration/source replacement preserve existing semantics.
- [ ] Run the focused new cases in application, HTTP and hook files with `-t`;
      confirm unsupported service/pin failures. Use ephemeral test servers only if
      they bind their own random port; never use the shared browser ports here.
- [ ] Implement the service and endpoint from the saved snapshot, using the
      GraphicScene owner's project/disk/settings/asset fencing pattern and the
      shared raw renderer preparation. Keep private work under a safe owned cache
      directory, clean on all outcomes, recheck current application before response,
      and register close cancellation. No persistent raster cache or project edit.
- [ ] Add project-aware ambient-cell preflight in the existing editor mutation
      path. Add the hook pin check after awaited flush/history and before `applyTo`,
      draft retention or POST. Build the URL through existing encoded API helpers.
- [ ] Repeat focused checks; expect exact status/byte/state assertions to pass.
      Commit and obtain fresh transaction/stale/source review. Notify the
      coordinator before touching the shared hook so other editor work can rebase.

### Task 4: Focal gesture, Inspector controls and Monitor readiness

**Files:**

- Create `apps/desktop/src/photoFocalInteraction.ts`,
  `apps/desktop/src/components/PhotoFocalOverlay.vue`,
  `tests/unit/photo-focal-interaction.test.ts`,
  `tests/unit/photo-focal-overlay.test.ts` and
  `tests/unit/photo-presentation-finishing.test.ts`.
- Modify `apps/desktop/src/components/{PhotoPresentationPreview,
PhotoPresentationInspector,TimelineEditor}.vue`, `apps/desktop/src/editor.css`,
  `apps/desktop/src/i18n/modules/editor/{en-US,zh-TW,ja-JP}.ts` and
  `tests/unit/photo-preview-source-recovery.test.ts`.

**Interfaces:**

- Consumes core frame/easing/ambient types, Task 3's URL and pinned transaction.
- Produces `PhotoFocalGeometry`, `resolvePhotoFocalGeometry(...)`,
  `photoFocalPointAtViewport(...)` and `photoFocalPointFromDelta(...)` with the
  exact signatures/types in the spec. Point/delta parameters are `{ x: number;
y: number }`; singular/nonfinite geometry returns null.
- `PhotoFocalOverlay` props: `point: PhotoFocalPoint`,
  `geometry: PhotoFocalGeometry`, `disabled: boolean`, `sessionKey: string`;
  events `preview(point)`, `commit(point)`, `activity(boolean)`, `cancelled()`;
  exposed `cancel(): void`.
- Existing Inspector `command` event remains; it writes one existing
  presentation command for each explicit Apply. Timeline owns transient focal
  draft/session and uses one pinned `commitSource` transaction at completion.

- [ ] Add failing pure/component tests for inverse mapping under source
      orientation, letterbox, zoom, static rotation/translation, fractional viewport
      and zero geometry; frozen mapping across crop preview; no-op; one primary
      pointer; release once; every cancellation from the spec; stale commit result;
      arrows `0.01`, Shift `0.1`, Home center and key-repeat coalescing. Assert zero
      commands during moves and one after completion.
- [ ] Add Inspector tests for focal/protected/gap/secondary edits retaining
      v2 fill; motion preset retaining custom curve; explicit fixed easing/fill
      removal downgrading only the relevant version; invalid drafts not emitted.
      Verify existing titles, soundtrack, constraints and selections are untouched.
- [ ] Add preview recovery tests requiring both current foreground and ambient
      readiness; failure plus Retry; same-ID relink/source-version invalidation;
      removed-source late load/error ignored; project/clip/revision changes fenced;
      Record Monitor color bypass using the same raw fill and no double filter.
- [ ] Run the focused new unit files and existing recovery cases; expect missing
      overlay/ambient/control failures. No browser server is needed for these hosts.
- [ ] Implement the pure affine helper and overlay using current pointer-capture,
      focus and cancellation conventions. Capture geometry/session once; keep draft
      out of saved state. Integrate explicit single-photo focus mode into Story
      preview including Original/contain; preserve existing diptych contain behavior
      with a clear disabled explanation. Pause transport, coordinate other gestures,
      and include focal pending state in edit/history/navigation/export barriers.
- [ ] Add the ambient image and one raw color group to the existing photo preview,
      shared by Story and Record paths; use current URL identities/readiness rules
      and retry state. Add fixed/custom easing, numeric handles/curve illustration
      and ambient Apply controls in the existing Inspector. Use existing tokens,
      visible focus, 24 px mouse/44 px coarse targets and all three real locales.
- [ ] Repeat focused unit checks and run `pnpm test:i18n`, `pnpm typecheck` and
      scoped formatting/lint for changed files. Expect matching semantic keys,
      no TypeScript/Vue errors and passing behavior assertions. Commit and obtain
      fresh interaction/accessibility/field-preservation review.

### Task 5: Measured output, browser regressions and exact-head handoff

**Files:**

- Create `tests/e2e/photo-finishing.spec.ts`.
- Extend `packages/render/tests/photo-quality.test.ts`,
  `packages/exporters/tests/compatibility.test.ts`,
  `packages/exporters/tests/exporters.test.ts` and
  `tests/integration/nle-handoff.test.ts`.
- Update `docs/photo-film-quality.md`, `docs/en/photo-film-quality.md`,
  `docs/validation-photo-film-quality.md` and its English evidence counterpart
  as appropriate; close only the existing D5A task after the complete gate.

**Interfaces:**

- Consumes completed Tasks 1–4 and existing renderer/export/handoff interfaces.
- Produces local `OPENFILM_PHOTO_FINISHING_QA_OUTPUT` evidence: source/output/
  ambient/Monitor/decoded-frame hashes, actual measurements, tool versions,
  candidate SHA and exact commands. No private/generated binary enters Git.

- [ ] Write the six-second synthetic 320×180/30 fps ambient/custom-curve
      scenario, keeping a distinct central protected shape and asymmetric background
      pattern. Assert 180 frames/6.000 s, unchanged film/audio/source identities,
      first/middle/last frame time at `0`, `90/30`, `179/30`, foreground landmark
      error <= `1.5` px, and separate foreground/ambient mean RGB errors <= `12`.
      Decode shuffled indices `0,90,179,35,140,179,0,90`; assert repeated bytes match.
- [ ] Add deliberate wrong-easing, missing-fill, double-dim and double-color
      falsification cases; each must fail its relevant metric. Include contain,
      protected-hero fallback, diptych/gap, alpha, color/bypass, legacy identity and
      current PhotoDepth fallback. Assert every full source hash before/after and
      against sidecars; record actual raster/output hashes rather than expected
      filter strings.
- [ ] Add real browser tests for focus entering/cancelling Original/contain,
      dragging without interim save, one POST/Undo, conflicting saved revision,
      resize/blur/project switch/late completion, keyboard/coarse hit targets,
      fill retry/readiness, controls preserving options and three real locales plus
      pseudo-locale at 1280×720 and narrow Inspector. Capture the actual Monitor
      element at known clip-local times for the parity measurements above.
- [ ] Add interchange tests: JSON/OTIO preserve complete v2 recipes, OTIO reports
      metadata-only effect handling, FCPXML/EDL reject before output mutation, and
      existing fidelity handoff bakes via the same renderer. Edit production exporter
      warnings only if these tests show a user-visible omission.
- [ ] Run focused render/export tests. Schedule the browser command with the
      coordinator; use `OPENFILM_CHROMIUM=/usr/bin/chromium` and the approved server
      slot. Run `pnpm exec playwright test tests/e2e/photo-finishing.spec.ts` and the
      affected existing photo/Record Monitor browser cases. Expect declared pixel,
      hash, request-count and interaction assertions to pass; record failures and
      correct them without weakening thresholds to fit results.
- [ ] Self-review design coverage, then obtain independent complete-branch
      review on the exact commit. Resolve findings with regression evidence and
      repeat only affected checks. Give the coordinator the exact SHA, focused
      outcomes, evidence path, changed interfaces and any remaining manual gates.
- [ ] Coordinator runs full format/i18n/lint/types, contract/media test partitions,
      build, official OTIO (`/tmp/openfilm-otio-venv/bin` on PATH), complete browser
      discovery/shards, native/OS checks and both supported FFmpeg lanes on the exact
      head. Do not claim a focused run is the whole gate. After all required checks
      and fresh review, the coordinator creates/reviews/merges the independent D5A
      PR under the user's standing authorization, then updates the authoritative task.

## Plan self-review and execution handoff

The five tasks cover portable validation/math; verified source/raster/render;
saved-snapshot service and post-flush pin; transient interaction/readiness;
and actual output/interchange/browser evidence. Each review-focus input has an
owning regression above. Portable names, versions, bounds, processing order and
transaction timing match the linked design; acceptance evidence is deliberately
future work.

The disposable FFmpeg expression spike is the only execution performed during
this planning phase. Product work, further agents, PR creation, pushing and merge
wait for coordinator design approval. The user's chosen subagent-driven method
is already recorded; do not ask them to choose it again.
