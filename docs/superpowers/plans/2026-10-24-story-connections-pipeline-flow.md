# Story Connections and Pipeline Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe story-graph drag connections and a stage-by-stage pipeline UI that adapts between standard and expert work modes.

**Architecture:** Extend the existing StoryGraph application service with one typed connection operation, then use it from pointer and keyboard UI interactions. Present the existing pipeline stages through a shared stage descriptor model, with standard and expert layouts reading the same run state.

**Tech Stack:** Vue 3, TypeScript, existing OpenFilm core/story/application contracts, Vitest, Playwright, CSS design tokens, vue-i18n.

**Spec:** `docs/superpowers/specs/2026-10-24-story-connections-pipeline-flow-design.md`

## Global Constraints

- Do not create a second timeline, story graph, or pipeline state model.
- Node layout remains private view state and cannot change Composition or project revision.
- Semantic links must pass existing graph validation and save through application logic.
- Do not execute project HTML/JavaScript or load remote graph resources.
- Preserve Undo/Redo, autosave, locks, project reopen, pipeline review, retry, cancel, consent, and stale-result behavior.
- All new UI text must exist in en-US, zh-TW, and ja-JP.

## Review Focus

- Pointer release outside any node cancels cleanly and never leaves a stuck connection state.
- A duplicate or self-link produces a reviewable error and no saved mutation.
- A `precedes` link between beats updates canonical order and remains cycle-free.
- Standard mode preserves every required stage action even though diagnostics are collapsed.
- Long CJK stage names and 1024×768 layouts keep the current gate and next action visible.

---

### Task 1: Typed graph connection operation

**Files:**

- Create: `packages/story/src/story-graph-connections.ts`
- Modify: `packages/story/src/index.ts`
- Modify: `packages/application/src/story-graph.ts`
- Modify: `apps/server/src/server.ts`
- Test: `packages/story/tests/story-graph-connections.test.ts`
- Test: `packages/application/tests/story-graph.test.ts`

**Interfaces:**

- Produces: `inferStoryGraphEdgeType(source, target): StoryGraphEdgeType`.
- Produces: `connectStoryGraphNodes(graph, fromNodeId, toNodeId, type): StoryGraph`.
- Produces: `StoryGraphService.connectNodes(storyId, fromNodeId, toNodeId, type): Promise<{story: Story; graph: StoryGraph}>`.

- [x] Write failing tests for inferred types, duplicate/self rejection, cycle rejection, canonical asset selection, and canonical beat order.
- [x] Run the focused story and application tests and verify failures are caused by the missing interfaces.
- [x] Implement the minimal connection helpers, application method, and `connect-nodes` server quick action.
- [x] Run the focused tests and verify they pass.

### Task 2: Pointer and keyboard graph connections

**Files:**

- Modify: `apps/desktop/src/components/StoryGraphView.vue`
- Modify: `apps/desktop/src/i18n/modules/app/en-US.ts`
- Modify: `apps/desktop/src/i18n/modules/app/zh-TW.ts`
- Modify: `apps/desktop/src/i18n/modules/app/ja-JP.ts`
- Test: `tests/unit/story-graph-ui.test.ts`
- Test: `tests/e2e/story-workflow-ux.spec.ts`

**Interfaces:**

- Consumes: `storyGraphQuickAction(..., { action: "connect-nodes", ... })`.
- Produces: pointer-based node movement, live connection preview, dedicated handles, keyboard source/target selection, and localized status/error output.

- [x] Write failing component and browser assertions for pointer handlers, handles, preview path, keyboard mode, and cancellation.
- [x] Run the focused tests and verify they fail for the missing UI.
- [x] Replace mouse-only movement with pointer movement and implement the connection interaction.
- [x] Run the focused tests and verify they pass.

### Task 3: Stage-by-stage pipeline workbench modes

**Files:**

- Modify: `apps/desktop/src/components/PipelineWorkbench.vue`
- Modify: `apps/desktop/src/i18n/modules/app/en-US.ts`
- Modify: `apps/desktop/src/i18n/modules/app/zh-TW.ts`
- Modify: `apps/desktop/src/i18n/modules/app/ja-JP.ts`
- Test: `tests/unit/pipeline-workbench-ui.test.ts`
- Test: `tests/e2e/story-workflow-ux.spec.ts`

**Interfaces:**

- Produces: a shared `WORKBENCH_STAGES` descriptor list, progress summary, next/previous navigation, standard focused ledger, and expert diagnostic panes.

- [x] Write failing tests for the shared descriptor, accessible stage rail, current-gate summary, mode-specific density, and canonical task dependencies.
- [x] Run the focused tests and verify the expected failures.
- [x] Implement the stage ledger and mode-specific presentation without changing pipeline execution state.
- [x] Run the focused tests and verify they pass.

### Task 4: Documentation and regression gates

**Files:**

- Modify: `TASKS.md`
- Modify: `ROADMAP.md`
- Create: `docs/validation-story-connections-pipeline-flow.md`
- Create: `docs/en/validation-story-connections-pipeline-flow.md`

**Interfaces:**

- Produces: reproducible validation evidence and documented manual gates.

- [x] Add mirrored validation documentation and update task/roadmap status.
- [x] Run formatting, i18n, lint, typecheck, unit/integration suites, build, browser tests, interchange, and native tests where prerequisites are available.
- [ ] Inspect 1024×768 and 1280×720 screenshots, keyboard connection flow, touch/pointer cancellation, reopen persistence, and reduced motion.
- [ ] Record exact results and any workstation-only gates without weakening assertions.
