# GraphicScene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship the minimal safe M3/F01 declarative scene through existing editing,
Monitor and MP4 output, with verified arbitrary seeks.

**Architecture:** Core owns exact schema validation and a pure time evaluator.
Solver/application retain existing Composition history and persistence. A bounded
Node raster adapter supplies identical output-frame PNGs to Monitor and FFmpeg.

**Tech Stack:** Existing TypeScript, Vue 3, SQLite, FFmpeg, fontkit and resvg. No new dependencies.

**Spec:** [GraphicScene v1](../../graphic-scenes.md) and
[threat model](../../security/graphic-scene-threat-model.md).

## Global Constraints

- Schema-1.0.0 projects without `graphicScenes` retain existing behavior.
- No second timeline, source overwrite, remote URL, project HTML/JS or raw SVG.
- Version 1; 8 scenes / 64 nodes / depth 4 / 30 seconds per scene.
- Monitor and FFmpeg use Composition seconds quantized to the output frame grid.
- Preserve Apache-2.0/NOTICE, locks, required selections, history and autosave.
- User initially requested one PR without merge. The latest explicit instruction
  authorizes M3 review and merge after all correctness and exact-head gates pass.

## Review Focus

- A scene near a shortened cut must reject before a draft can become unsaveable.
- Overlapping children under group opacity must composite as a group.
- A frame finishing after project/revision changes must never be shown as current.
- Image signature/dimension checks must precede decoding untrusted content.
- Scene-only images must enter source hash evidence and portable metadata.

### Task 1: Portable schema, deterministic evaluator and existing history

**Files:** Create `packages/core/src/graphic-scenes.ts`, core/solver/application
graphic-scene tests; modify models/index/validation, solver editing, application
editor, errors and system locale catalogs.

**Interfaces:** Produces `GraphicScene`, `GraphicNode`,
`validateGraphicScenes(value: unknown, compositionDuration: number): GraphicScene[]`,
`evaluateGraphicSceneAtTime(scene: GraphicScene, time: number): EvaluatedGraphicScene`,
`graphicSceneAssetIds(scenes: readonly GraphicScene[]): string[]` and
TimelineCommand `graphic.scene.upsert {scene}` / `graphic.scene.remove {sceneId}`.

- [x] Write/run failing core tests: validateComposition rejects an unsafe scene;
      equal frames under `[0,3,5.9,3,0]` yield equal evaluated trees; groups/z/times,
      easing boundaries, duplicate IDs, nonfinite/unknown/deep/oversized inputs fail.
- [x] Implement strict models/validation/evaluation without platform dependencies.
- [x] Write/run failing solver/application tests for upsert/remove, stable IDs,
      unchanged bytes on invalid/stale edits, shortening and complete regeneration.
- [x] Implement commands using existing history, request and persistence paths;
      verify Undo/Redo, reopen, locks and legacy validation.
- [x] Run `pnpm exec vitest run packages/core/tests/graphic-scenes.test.ts packages/solver/tests/graphic-scenes.test.ts packages/application/tests/graphic-scenes.test.ts`; expect all pass; commit.

### Task 2: Bounded raster, application/API and actual MP4

**Files:** Create `packages/render/src/graphic-scenes.ts`,
`packages/application/src/graphic-scenes.ts`, render/application/HTTP regressions;
modify renderer/index, application/index, server routes and exporters.

**Interfaces:** Consumes Task 1. Produces
`prepareGraphicScenes(composition, assets, settings, work, options)` returning
`frame(sceneId, outputFrame): Promise<Buffer>` plus font/source evidence, and
`GraphicSceneService.frame(compositionId, {projectId,baseRevision,frameIndex,signal})`.
GET `/api/compositions/:id/graphics.png` returns only validated current PNG bytes.

- [x] Write/run failing 6-second actual MP4 regression: image/text/shape/group,
      entry/exit, first/mid/last frames and shuffled repeated output-frame hashes.
- [x] Implement safe PNG/JPEG/WebP admission, local measured text and trusted SVG;
      enforce all work/texture/output limits and cancellation cleanup.
- [x] Feed generated scene frame sequences through existing FFmpeg overlay graph,
      before captions; include scene-only sources/fonts in manifest verification.
- [x] Write/run failing API/application cases: stale/project mismatch, post-await
      revision change, request contention, missing/disguised image and cache symlink.
- [x] Implement shared preview service with bounded private lifetime, no-store
      PNG response and source/revision rechecks; JSON/OTIO retention and NLE warnings.
- [x] Run focused render/application/HTTP/exporter tests, then `pnpm test`; expect
      all pass including actual decoded MP4; commit.

### Task 3: Edit authoring, Monitor and final verification

**Files:** Create `GraphicSceneInspector.vue`, `GraphicScenePreview.vue`,
`tests/e2e/graphic-scenes.spec.ts`; modify TimelineEditor, PhotoPresentationPreview,
API helpers, editor CSS and three editor locale catalogs. Update TASKS/ROADMAP,
architecture/contracts and `docs/validation-graphic-scene.md`.

**Interfaces:** Consumes Tasks 1–2; emits existing TimelineCommands and uses saved
revision/output-frame PNGs. Inspector supports primitive, geometry, timing and
entry/exit controls. Existing selected clip supplies Composition time.

- [x] Write/run failing actual browser cases for all four primitives, CJK text,
      geometry/animation controls, shuffled seeks, autosave/history/reopen and errors.
- [x] Implement Inspector and exact-frame Monitor overlay with accessible controls,
      visible stale/error handling and cancellation on unmount/project switch.
- [ ] Run focused browser suite, then format/i18n/lint/typecheck/test/build/e2e/
      interchange; native only where prerequisites exist. Record actual output/results.
- [x] Obtain fresh whole-branch review; fix material findings with red/green tests.
- [ ] Commit/push one cohesive M3 branch, create/attach one PR, monitor exact-head
      CI and report evidence, base/head, limitations and manual gates. The latest user
      instruction authorizes merge after review and all gates pass.
