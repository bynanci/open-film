# Readable Caption Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native captions readable and temporally smooth in preview/export, with a high quality bounded delivery path.

**Architecture:** Extend optional TitleStyle fields and share one frame-based opacity evaluator between Vue and FFmpeg. Preserve current project defaults. A constrained RenderOptions quality preset enables lossless intermediates and a single final lossy encode.

**Tech Stack:** TypeScript, Vue, Vitest, FFmpeg, fontkit/Resvg.

**Spec:** `docs/superpowers/specs/2026-10-18-readable-caption-delivery.md`

## Global Constraints

- Base on merged main 7eb9aaa; work only in this feature worktree.
- No private media, names, chat excerpts or local source paths in Git.
- Preserve older project defaults; no migration or new dependencies.
- Final movie workflow stays 1920×1080/30 fps; soundtrack/timeline are outside repository scope.

## Review Focus

- One-frame/overlapping fades must keep text visible and avoid division by zero.
- First/last live frame opacity must match native decoding.
- Trimmed/sped-up video preview must use timeline time.
- Bottom inset must keep scrim/glyphs on canvas.
- Quality presets must preserve default args and reject invalid runtime values.

### Task 1: Core caption timing and layout contract

Files: `packages/core/src/models.ts`, `validation.ts`, `title-layout.ts`, `index.ts`, focused core title tests; new `title-opacity.ts` if appropriate.

Produces exact spec helpers `resolveTitleFadeFrames` and `titleOpacityAtTime`.

- [ ] Add real tests that fail before implementation for optional field validation, frame opacities, short/overlapping fades and 15% safe inset.
- [ ] Implement minimal fields, shared evaluator and layout inset; defaults keep existing layout.
- [ ] Run focused core tests and typecheck; report the red and green evidence.

### Task 2: Native rendering and quality

Files: `packages/render/src/index.ts`, `photo-filters.ts`, focused native render/title tests.

Consumes Task 1 helpers. Adds constrained `RenderOptions.quality` per spec.

- [ ] Write failing real pixel/frame tests for native title track and attached-title fades, safe inset, and quality selection.
- [ ] Apply alpha fade frame counts before setpts; pass quality flags through existing photo/general resize paths.
- [ ] Run actual FFmpeg tests on Windows using fileURLToPath and one worker; record manifest/default compatibility.

### Task 3: Preview and inspector

Files: `apps/desktop/src/components/PhotoPresentationPreview.vue`, `TimelineEditor.vue`, `PhotoPresentationInspector.vue`, relevant desktop tests.

Consumes Task 1 opacity helper and optional style fields.

- [ ] Add failing behavior tests for opacity across still/video/title variants and preservation of unrelated style fields.
- [ ] Apply shared opacity using local timeline time; expose size/weight/fades/inset using existing presentation command path and undo/redo.
- [ ] Run relevant desktop tests and typecheck; no source-media mutation.

### Task 4: Integration and review

- [ ] Build/typecheck and run affected core/render/application/desktop checks, then the repository test command; report preexisting platform failures separately.
- [ ] Independent whole-diff review for schema compatibility, frame parity, unsafe input and UI field preservation.
- [ ] Commit code/docs only; prepare a reviewable PR without merging.

### Task 5: Private movie proof and delivery

Outside repo: use supplied original images, existing approved soundtrack and timings. Native bold sans captions, restrained scrim, 15% bottom inset, 8-frame in/out; native protected push/pull and short crossfades. Produce a 40–52 second excerpt before a full fresh 1080p render. Use lossless native intermediates and one final high quality encode; preserve exact approved AAC packets. Validate original-source hashes, title readability, native opacity/motion, decoded frames and Drive playback/quality. Preserve the approved earlier version.
