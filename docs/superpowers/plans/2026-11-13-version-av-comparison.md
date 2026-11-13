# Saved-version Audiovisual Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two saved Named Versions genuinely viewable and audible without restoring or editing the active cut.

**Architecture:** Existing immutable version authority supplies frozen inputs to the existing FFmpeg Renderer and RenderSnapshot. A bounded private pair service uses existing render Jobs/controllers/owner locks; native videos share transport and audible-side ownership.

**Tech Stack:** Existing TypeScript, SQLite, Vue3, FFmpeg, Vitest and Playwright; no new dependency or schema.

**Spec:** `docs/superpowers/specs/2026-11-13-version-av-comparison-design.md`.

## Global Constraints

- Preserve one editing authority, source/lock/pin/revision guards, Undo/Redo, autosave and named-version bytes.
- Keep structural compare zero-render; actual MP4 preparation is explicit.
- No Restore/Adopt, current asset/settings substitution, new Mixer/Timeline/Job engine or provider.
- Private media is project/owner/token bound; never expose arbitrary paths or execute project code.
- Use the saved frame/settings for rendering and font resolution, actual output/audio metadata and clear expiry.
- Upper bounds: one-hour duration,1GiB per-file,2GiB private cache,15-minute lifetime,one owned pair; preserve foreign-owner safety and sequential rendering.
- Initial feature is Named Versions. Creative Variants adapter, Export tail UI and workstation/native/release gates remain open.
- Synthetic test sources only; author/DCO NAN CHUN WANG <by.nanci.tw@gmail.com>.

## Review Focus

- Same source IDs with different saved settings/transforms/audio must render the two historical cuts, not current state.
- Rename is metadata; corruption/deletion/source changes and explicit missing Composition IDs must reject without fallback.
- A second prepare/project switch/late decoder event cannot revive an old pair or audible stream.
- Failed B/cancel/output tamper cannot expose partial or foreign files; cleanup waits for owned children.
- Unequal durations/frame rates and browser play rejection must remain honest and usable.

### Task1: Trusted historical snapshot capability

**Files:** `packages/application/src/project-versions.ts`; new focused application tests.

**Interfaces:** Export `ProjectVersionPreviewSnapshot` and methods `snapshotForPreview(versionId, compositionId?, {signal}?)` and `previewTargets(versionId)` from the existing service. Snapshot owns project, selected Composition, assets, saved source references, immutable payload identity and `assertCurrent()`; metadata returns small project/version/payload and composition title/ID/duration/frame-rate fields.

- [x] Write meaningful failing tests through the existing version service for frozen settings/assets, missing explicit Composition, source mutation, owned returned values, corrupt/deleted payload, rename and cancellation.
- [x] Observe RED before implementation; retain logs externally.
- [x] Reuse load/rebaseTarget/verifySources without Restore or current-project edits; support AbortSignal through source hashing while preserving existing callers.
- [x] Verify unchanged active manifest/semantic Catalog/editor history and saved payload bytes, legacy/moved managed media and existing version regressions.
- [x] Run tests and scoped checks; obtain independent task review; commit only owned files signed off. Commit: `262941ff34fd135ab30cf48fc532aed8c7b0abac`; 38 focused/existing tests pass. This is Task 1 evidence, not final feature acceptance.

### Task2: Actual private paired MP4 application/API

**Files:** new `packages/application/src/version-comparison-preview.ts`; application wiring/export in `index.ts`; `apps/server/src/server.ts`; application and real HTTP tests.

**Interfaces:** Export `VersionComparisonPreviewInput`, versioned descriptor and side types from application. Input fields and routes are exact in the spec. Application exposes `versionComparisonPreview` and `runVersionComparisonPreview(input,signal)`; use requestId as existing render Job identity with safe conflicts. Service methods support prepare, descriptor/status, internal guarded media authorization, discard and dispose.

- [ ] Add RED tests for real saved A/B settings/visual/audio rendering, publication/cancel/source/project guards, request conflicts, private file/range handling and failure of the second side.
- [ ] Render sequential actual MP4s with FFmpegRenderer/RenderSnapshot, saved source proof and saved-frame font binding; enforce limits and pair-atomic publication.
- [ ] Reuse existing active/task/disconnect handling, render Jobs and owner-aware lock. Register close/dispose and stream ownership; never delete foreign live/unverifiable cache.
- [ ] Add explicit prepare/metadata/status/media/discard routes with exact body validation, project fencing and no paths in JSON.
- [ ] Decode synthetic frames/audio and check source/snapshot/current-edit invariants; run relevant existing render/version/audio HTTP regressions, task review and signed-off commit.

### Task3: Real Versions A/B viewing workflow

**Files:** shared native-video comparison component/composable; `ProjectVersionsPanel.vue`; `api.ts`; existing English/Traditional Chinese/Japanese locales; focused Vitest UI/playback tests.

**Interfaces:** Consume the exact application descriptor/routes. UI stores IDs/descriptors/playback state only; it does not own/copy mutable Composition state. Existing Restore remains separate.

- [ ] Add failing tests for actual media binding, shared seek/unequal ending, single audible side, play rejection, stale events/request, close/unmount/project switch and keyboard/focus behavior.
- [ ] Wire target metadata, explicit prepare/cancel/retry and two native videos; provide one transport plus A/B/mute controls and truthful error/ended states.
- [ ] Preserve structural diff and current editing; invalidate before changing selections, pause/unload native resources and revoke only the owned preview.
- [ ] Use current tokens, responsive dimensions and complete i18n/ARIA/IME/reduced-motion handling.
- [ ] Run focused tests/static checks; task review and signed-off commit.

### Task4: Browser proof, documentation and delivery

**Files:** focused Versions Playwright regressions; paired validation/architecture records; TASKS/ROADMAP; sanitized synthetic screenshots/evidence only.

- [ ] Verify real prepare→play→seek→audible switch→close and selection/project race flows with actual synthetic MP4s, saved source/current-edit invariants and1024×768/1920×1080 screenshots.
- [ ] Document fixed snapshot data flow/threat boundaries, cache/format/clock/audio limitations and separate Variants/Export/workstation follow-up; mark only completed scope.
- [ ] Run appropriate unit/application/HTTP/browser/media/static/build/interchange checks and final independent whole-branch review; report every failure/unrun gate.
- [ ] Fetch current main, push one cohesive draft PR, attach its URL and inspect actual exact-head CI; preserve release/native/owner gates.
