# User-Pinned Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve direct Clip/GraphicScene edits as durable hard constraints through automatic solving and all existing persistence paths.

**Architecture:** Store strict versioned overrides inline on the existing owners in core. Apply server-owned mutation policy and bounded anchor placement through the existing editor transaction, then reuse manifest/SQLite CAS, Named Versions, Collect and variant owners. Promote projects to schema 1.1.0 on first pin so old applications reject semantics they cannot preserve.

**Tech Stack:** Existing TypeScript, Vue, Node, SQLite and Vitest/Playwright; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-user-pinned-overrides-design.md`.

## Global Constraints

- Inspection/worktree base is `e1255b1a8a83260149211d909cca8c1a50948c6b`; coordinator audits complete documents before product work.
- Composition remains the only timeline; contracts belong to `packages/core`.
- No external I/O, upload, original-media writes, new database/manifest or dependencies.
- Keep schema-1.0.0 reads and immutable v5/v6 Named Versions intact; promote only on pin-state writes. Catalog remains v6.
- Existing source/clip/node locks and required selections retain their protections. Unpin affects only user overrides.
- Preserve exact pinned payloads, source identities, rational-clock frames and saved seconds; never infer occurrence identity from asset IDs.
- Incremental solve limits: 2,000 film clips, 1,000 beats, 10,000 search expansions, 20 conflict entries; fail explicitly at a bound.
- During implementation use targeted suites and synthetic temp projects/port 0. Full suites, browser ports and native benchmarks require coordinator scheduling, not an extra user permission flow.
- No push/PR/merge by this worker. Private ledger is `.superpowers/sdd/2026-10-30-user-pinned-overrides/` in this worktree.

## Review Focus

- Older software accepting unknown Clip fields must reject pinned project schema 1.1.0; verify a frozen old-version validator behavior, not just new-parser tests (Task 1).
- Two split/echo occurrences sharing the same asset retain independent pin identity across regeneration and variant mapping (Tasks 2, 3, 6).
- Off-grid seconds and 30000/1001 or 24000/1001 clocks never shift a pinned frame during solving, Collect or restore (Tasks 3, 6, 7).
- Queue waits, provider work and ambiguous save failures cannot accept stale edits or emit successful artifacts before durable publication (Tasks 4, 5).
- Effective inherited rendering can change with identical Clip bytes; parent look and future primary-color edits must detect this (Tasks 2, 8).

## File map

New focused owners:

- `packages/core/src/user-overrides.ts`: closed portable state, target types, owner category validation and project feature detection.
- `packages/solver/src/user-overrides.ts`: pure origin/target policy and full-object invariance checks; no filesystem.
- `packages/solver/src/pinned-placement.ts`: bounded detached incremental placement and constrained direct ripple.
- `packages/application/src/user-overrides.ts`: project-clock/revision integration and schema promotion helpers only; no alternative persistence.
- `schemas/openfilm-project-1.1.0.schema.json`: project version gate plus closed pin definitions, derived from existing schema structure.
- `packages/core/tests/user-overrides.test.ts`, `packages/solver/tests/user-overrides.test.ts`, `packages/solver/tests/pinned-placement.test.ts`, `packages/application/tests/user-overrides.test.ts`: contract and transaction evidence.

Existing files to extend are named in each task. UI code uses existing TimelineClip,
TimelineEditor, GraphicSceneInspector and useTimelineEditor. New localization
entries stay inside the existing editor modules.

### Task 1: Closed inline state and project-version compatibility

**Files:** Create core owner/schema/tests above. Modify `packages/core/src/{models,graphic-scenes,validation,migration,index}.ts`, `schemas/openfilm-project-1.0.0.schema.json`, `packages/core/tests/{project,graphic-scenes-schema}.test.ts`, `tests/fixtures/graphic-schema.ts` if its schema selection is hard-coded.

**Interfaces:** Export `UserLockedAttribute`, `UserOverrideState`, `OverrideTarget` exactly as spec; `validateUserOverrideState(value:unknown, owner:"clip"|"graphic-scene"):UserOverrideState`; `hasUserOverrideState(project:OpenFilmProject):boolean`; `PINNED_PROJECT_SCHEMA_VERSION = "1.1.0"`. OpenFilmProject.schemaVersion supports both versions; `PROJECT_SCHEMA_VERSION` default remains 1.0.0.

- [ ] Add failing table tests `accepts_legacy_without_materializing_defaults`, `rejects_pins_in_1_0`, `accepts_closed_1_1_pin_objects`, `rejects_unknown_version_keys_duplicates_accessors_and_sparse_arrays`, `validates_owner_categories_and_removed_effect_pins`. Assert no mutation and exact error paths.
- [ ] Add `old_validator_rejects_1_1_before_clip_processing`: use a fixed small fixture that expresses the audited old schemaVersion equality check; also validate 1.1 against existing frozen 1.0 JSON Schema and require rejection. Preserve v1 recipe fixtures.
- [ ] Run `pnpm exec vitest run --config vitest.contract.config.ts packages/core/tests/user-overrides.test.ts packages/core/tests/project.test.ts packages/core/tests/graphic-scenes-schema.test.ts`; new cases must fail for missing implementation, not environment setup.
- [ ] Implement strict override validator; add owner fields, schema dispatch and first-pin capability detection. Explicitly support 1.0/1.1 in migrateProject and supportedProjectVersions, preserving 0.1→1.0 behavior. Reject 1.0 pin fields without rewriting input.
- [ ] Repeat the targeted command; require all cases pass. Commit `feat(core): define versioned user pin contracts`.

### Task 2: Direct-edit pin policy and mutation provenance

**Files:** Create `packages/solver/src/user-overrides.ts` and tests. Modify `packages/solver/src/{editing,scene-direction,graphic-scene-agent,index}.ts`.

**Interfaces:** Export the shared `TimelineEditContext {timebase?:ProjectTimebaseV1;origin?:"direct"|"automatic"|"history"|"restore"}` and `applyOverridePolicy(before:EditorDocument,after:EditorDocument,commands:readonly TimelineCommand[],context:Required<TimelineEditContext>):EditorDocument`. D2B uses this same context for frame-dependent transition recipes; no alternate fourth argument. Add `user-pin.set` and `user-pin.resolve` command shapes from spec. Extend `applyTimelineCommand` with this optional fourth context for legacy callers; pin operations and frame-dependent recipes require its authoritative clock; application callers supply it explicitly. Legacy internal solver calls must default to automatic so policy cannot accidentally pin generated commands. Only user command ingress selects direct context. Pure helper returns a detached candidate or throws ApplicationError `timeline.pinConflict`.

- [ ] Add failing tests for trim/speed/motion/removal/depth creation and deletion, split halves, further direct edit to an already pinned target, unrelated pinned neighbor, direct delete/replace under existing required locks, and pin metadata injection via scene-upsert. Assert exact payload/absence, IDs, both split ranges and canonical categories.
- [ ] Add `automatic_replaceExisting_does_not_release_pin`, `automatic_metadata_removal_fails`, `same_asset_different_clip_ids_remain_independent`, `parent_look_effective_change_conflicts`, `source_clip_and_node_locks_still_win`.
- [ ] Run `pnpm exec vitest run --config vitest.contract.config.ts packages/solver/tests/user-overrides.test.ts packages/solver/tests/scene-direction.test.ts packages/solver/tests/graphic-scenes.test.ts`; expect new cases to fail.
- [ ] Implement direct target classification from typed commands, full payload/effective-look invariants, allowed explicit target replacement/split and state accumulation. On graphic upsert require any supplied metadata equal its prior authoritative state; policy computes new state. Disallow client-authored origin. Pin creation/removal effects happen only after the underlying command succeeds.
- [ ] Repeat focused tests; require existing lock/manual-presentation cases unchanged. Commit `feat(solver): preserve direct edits with user pin policy`.

### Task 3: Bounded anchor placement and constrained ripple

**Files:** Create `packages/solver/src/pinned-placement.ts` and tests. Modify `packages/solver/src/{editing,index}.ts`; use `packages/core/src/{sequence,timebase}.ts` without duplicating their resolution formulas.

**Interfaces:** Export `IncrementalSolveInput`, `IncrementalSolveResult`, `PinConflict`, `solveIncremental` from spec. Export `placeDirectEdit(before:EditorDocument,proposed:EditorDocument,assets:readonly MediaAsset[],timebase:ProjectTimebaseV1,targets:readonly OverrideTarget[]):IncrementalSolveResult`. It preserves non-target durations/source windows and only shifts eligible neighbor starts. Existing compose remains a new-cut solver. Thread explicit echo permissions through incremental candidate planning if the existing story/acceptance context supplies them; never infer permission from accidental asset repetition.

- [ ] Add failing `anchor_at_frames_90_150_survives_shortening`, `extension_over_anchor_is_atomic_conflict`, `regenerate_fills_only_mutable_intervals`, `required_order_across_anchor_is_not_dropped`, `locked_clip_may_move_but_pinned_clip_may_not`, and `outside_beat_is_unchanged`.
- [ ] Add fractional-clock and off-grid cases: exact original numeric start/duration/source values and `resolveClipFrameRange` output equal after solve; exact-seconds/frame disagreement conflicts. Add overlapping-spine unsupported case, crossfade tails, pinned overlay beyond shortened end, repeated split/echo occurrences, missing sources and bounded-search exhaustion.
- [ ] Run `pnpm exec vitest run --config vitest.contract.config.ts packages/solver/tests/pinned-placement.test.ts packages/solver/tests/editing.test.ts packages/solver/tests/quality-editing.test.ts`; require meaningful new failures.
- [ ] Implement spec's bounded interval allocation, retain exact protected payloads, integrate regeneration and shorten/remove/reorder/resize paths. Check hard order/selection constraints on the complete output, not partition-filtered constraints. Count search expansions explicitly and return limit diagnostics distinctly from infeasibility.
- [ ] Re-run focused tests. Add one seeded deterministic property-style loop inside this suite asserting all pinned payloads/frames remain unchanged for feasible random small gaps; no new framework. Commit `feat(solver): constrain incremental placement around pinned edits`.

### Task 4: Transactional editor, unpin and one-step re-solve

**Files:** Create application helper/tests above. Modify `packages/application/src/{editor,index}.ts`, `apps/server/src/server.ts`, `tests/integration/editor-http.test.ts`.

**Interfaces:** `promotePinnedProject(project:OpenFilmProject):OpenFilmProject` returns a detached 1.1.0 candidate iff pin metadata exists, never downgrades. `TimelineEditor.resolve(compositionId:string,input:{baseRevision:string;requestId?:string;scope:IncrementalSolveInput["scope"];mode:IncrementalSolveInput["mode"]}):Promise<TimelineEditorState>`. Existing edit/undo/redo methods retain signatures. Source clock is `resolveProjectTimebase(application.project.settings)`; context never comes from HTTP.

- [ ] Add failing application tests for first direct edit promotion, pin/unpin save/reopen, one-entry Undo/Redo, unpin-and-resolve atomic rollback, queued stale edit rejection, invalid origin/property injection, source-locked target rejection and existing timed-content rate-change rejection plus permitted equivalent-rate/drop-frame-label changes. Assert disk project and editor revision/history, not just response data.
- [ ] Add HTTP test on port 0 for valid commands and malicious origin/timebase/override-body bypass; retain existing host/origin/session protection tests.
- [ ] Run `pnpm exec vitest run --config vitest.media.config.ts packages/application/tests/user-overrides.test.ts tests/integration/editor-http.test.ts`; expect new failures.
- [ ] Implement parsing bounds and server-owned context; apply per-command target policy and final transaction invariant checks before save. Promote project once in existing persist; preserve latest schema during session history. Route re-solve through existing serialization/history/CAS. Keep source lock and project save errors intact.
- [ ] Repeat focused application tests and `pnpm exec vitest run --config vitest.media.config.ts packages/application/tests/editor.test.ts`; require pass. Commit `feat(editor): persist pins and atomic unlock re-solve`.

### Task 5: Explicit pipeline targets and new-cut acceptance

**Files:** Modify `packages/core/src/pipeline.ts`, `packages/application/src/{pipeline-orchestrator,index,story-plan,scene-plan}.ts`, `apps/desktop/src/pipeline-workbench-model.ts`, `apps/server/src/server.ts`; tests `packages/core/tests/pipeline.test.ts`, `packages/application/tests/{pipeline,pipeline-change-impact}.test.ts`, `tests/integration/story-graph-pipeline-e2e-acceptance.test.ts`.

**Interfaces:** Add strict `PipelineCompositionTarget` union and optional `PipelineInputSnapshot.compositionTarget` exactly as spec; signatures include it. Existing rough-cut artifacts carry `targetMode`, `compositionId`, `baseRevision`, `producedRevision`, `pinDigest` in bounded metadata. Resolve adoption delegates to Task 4; fresh adoption assembles subtitles before one project publication. Reuse existing run/receipt storage; no new adoption manifest.

- [ ] Add failing `legacy_run_remains_new_cut`, `new_run_requires_explicit_target`, `resolve_requires_exact_target_revision`, `same_story_multiple_cuts_never_guess`, `pin_after_async_prepare_invalidates_adoption`, `subtitle_and_composition_publish_once`, and `retry_after_ambiguous_commit_does_not_duplicate`.
- [ ] Add tests for StoryPlan and scene-plan acceptance: original pinned cut unchanged; receipt retry returns subsequently pinned accepted cut; echo assets are not used to map baseline instances. Verify failure publishes neither successful artifact nor extra cut.
- [ ] Run targeted core pipeline test under contract config, then targeted application/integration paths under media config; expect new failures.
- [ ] Implement detached adoption publication and target-specific freshness, exact digest/receipt binding, UI-selected target wiring and legacy normalization. Existing explicit new-cut APIs retain meaning; no automatic migration of old runs to resolve.
- [ ] Repeat those paths and pipeline change-impact cases; require pass. Commit `feat(pipeline): bind composition adoption to explicit pin-aware targets`.

### Task 6: Named Versions and isolated creative variants

**Files:** Modify `packages/application/src/{project-versions,creative-variants}.ts`, `packages/core/src/{project-versions,creative-variants}.ts` only where diff summaries need fields; tests `packages/application/tests/{project-versions,creative-variants}.test.ts`, `packages/core/tests/creative-variants.test.ts`. Preserve frozen v5 fixture files unchanged.

**Interfaces:** Reuse existing Restore input/revision fence, version record and variant provenance mapping. Add `pinChangedCount:number` to derived public diff summary where existing version/variant diffs are assembled; optional additive field if its wire contract requires legacy responses. No new snapshot shape or catalog version. Existing `upgradeCatalogSnapshot` validates the declared historical SQLite version and upgrades a private image; leave that mechanism unchanged while accepting the new project manifest version.

- [ ] Add failing snapshot/inspect/diff/restore cases: 1.1 pins survive; 1.0/v5 read does not rewrite bytes; explicit older Restore removes newer pins after displayed diff/CAS; existing locked source/clip conflicts still fail; failed restore recovers exact previous pins. Verify existing v5 private-copy catalog upgrade remains v6 without changing snapshot bytes.
- [ ] Add variant tests for two same-source occurrences in different beats, pinned split halves, deep-cloned GraphicScene nodes/recipes, independent unpin, constrained duration multiplier, impossible atomic failure and adoption retaining derived pins. Assert original and derived object graphs do not share mutable nodes.
- [ ] Run `pnpm exec vitest run --config vitest.media.config.ts packages/application/tests/project-versions.test.ts packages/application/tests/creative-variants.test.ts`; require new failures.
- [ ] Extend diff display data; preserve existing explicit restore semantics rather than applying automatic policy to Restore. Correct variant section occurrence selection to beatId and existing provenance; use deep copy and Task 3 constraints. Pin state remains scoped to each saved Composition.
- [ ] Repeat focused tests plus core creative-variants tests; require pass. Commit `feat(project): preserve pin state across snapshots and variants`.

### Task 7: Collect/ZIP and truthful interchange

**Files:** Modify `packages/core/src/collect-delivery.ts`, `packages/application/src/{collect-coverage,collect-derived-contract,collect-derived-media,collect-media,nle-handoff}.ts`, `packages/exporters/src/{index,handoff,compatibility}.ts`; tests `packages/application/tests/{collect-media,collect-derivatives,collect-archive,collect-zip-publication}.test.ts` and `packages/exporters/tests/{exporters,graphic-scenes,compatibility}.test.ts`, plus `tests/integration/nle-handoff.test.ts`.

**Interfaces:** Add existing-reason union member `source.user-pinned`; no new package manifest. Preserve full inline state and project 1.1.0 in native packages. Extend existing OpenFilm handoff metadata with `userOverrides` at the same occurrence/scene owner; existing compatibility result reports unsupported pin enforcement where needed. JSON export envelope version is its own format and must not be confused with project schema 1.1.0.

- [ ] Add failing full/current-film directory and ZIP round-trip tests with clips, scenes and depth resource references; exact pins/IDs/source ranges/frame resolution survive reopen. Add mixed pinned/unpinned use of one source: whole original is chosen once; derivative remapper rejects a supplied pinned mapping.
- [ ] Add native JSON/OTIO metadata tests and foreign-reader compatibility report assertions. Do not claim that an external NLE enforces OpenFilm pins. Confirm legacy collection/package fixtures remain readable.
- [ ] Run the focused application paths under media config and the named exporter and NLE handoff paths under media config (the current contract lane includes only core/solver/story/metadata/events); expect new failures. Synthetic files only; no full native/render benchmark.
- [ ] Implement coverage reason, closure over primary/paired/depth dependencies, defensive remap rejection and metadata/report preservation. Retain existing archive limits and original-source no-follow checks.
- [ ] Repeat the focused paths; require pass. Commit `feat(portability): retain pin constraints in collected projects`.

### Task 8: Visible controls and integrated feature coverage

**Files:** Modify `apps/desktop/src/components/{TimelineClip,TimelineEditor,GraphicSceneInspector,PhotoPresentationInspector,PhotoDepthControls}.vue`, `apps/desktop/src/composables/useTimelineEditor.ts`, existing editor locale modules for en-US/zh-TW/ja-JP, `apps/desktop/src/i18n/errors.ts`; add `tests/unit/user-pinned-ui.test.ts` and `tests/e2e/user-pinned-overrides.spec.ts`. Update `docs/CONTRACTS.md` and applicable user docs after implementation evidence exists.

**Interfaces:** UI emits existing typed commands and calls Task 4/5 methods with captured revision. Local optimistic drag state is not pin authority. Pin marker and tooltip consume saved `userOverrides`; no parallel map. Conflict presentation consumes `PinConflict` target IDs and translated code, never raw paths.

- [ ] Add failing UI unit cases for pin visibility, keyboard labels, lock distinction, no success before save, failed combined action retaining pins and selected owner/scroll, and captured revision after awaited flush. Add later browser flow trim→pin→regenerate neighbor→reopen→unpin/undo.
- [ ] Run `pnpm exec vitest run --config vitest.media.config.ts tests/unit/user-pinned-ui.test.ts`; expect new failures. Implement marker/actions and localized conflict copy through existing transaction composable.
- [ ] When D5A/B/C are integrated by the coordinator, add focused cases against their real fields: ambient/focal/Bézier payload retention; attached bilingual runs/title finishing; pinned effective primary correction across parent changes and Auto Match. Do not add those product fields in this branch. Caption-level pinning remains explicitly outside this contract.
- [ ] Re-run UI unit cases, targeted prior suites affected by integration, `pnpm typecheck`, focused lint/format and `pnpm test:i18n`. Use coordinator's scheduled browser lease for the new e2e only; otherwise record that it remains pending rather than claim completion.
- [ ] Update docs with actual command/schema/restore/interchange behavior and limitations. Commit `feat(desktop): expose durable user pin controls`.

## Handoff and completion gate

Design-only worker stops after source audit, these documents and private report.
After coordinator acknowledgement, execute using the already approved subagent
method. Review each task's actual diff and evidence, then a whole-branch review.
No dependency install or broad CI reconstruction is part of this plan. Coordinator
owns integration with D5 branches, full CI, browser scheduling and eventual PR/merge.

Self-review: each spec section maps to Tasks 1–8; all public signatures live in
core/solver/application owners above. Legacy source helper tolerance and off-grid
semantics are preserved. Exact frame/effective-render invariants, explicit Restore
and old-reader rejection are covered rather than inferred from JSON retention.
