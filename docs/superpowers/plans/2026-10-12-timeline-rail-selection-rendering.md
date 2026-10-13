# Timeline Rail Selection Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Bound the clip presentation work caused by selecting a clip in a 500-clip Story rail while preserving the existing editing workflow.

**Architecture:** Extract the existing clip button into a presentation-only Vue leaf with stable inputs. TimelineEditor retains selection, drag ownership, commands, history, navigation barriers, recovery, playback and scrolling. Measure actual render work before and after; accept the boundary only if its selection benefit justifies its first-mount cost.

**Tech Stack:** Vue 3, TypeScript, vue-i18n, Vitest with actual compiled SFCs, Playwright/Chromium and existing synthetic interaction instrumentation.

**Spec:** [Performance and interaction refinement](../../performance-interaction.md), [Roadmap](../../../ROADMAP.md), and the user request: converge all existing PRs before planning isolation of the 500-clip Timeline rail's selection rendering cost.

## Global Constraints

- Planning base: merged main `75b2617e5b0bbb4806c0a201d2013b903699b1e5`, 2026-10-12. PRs #8, #9, #10 and #11 are merged; re-fetch main before implementation.
- Follow the existing Core, Composition, TimelineCommand and application boundaries. This is one UI performance PR, with no schema migration or new timeline engine.
- Keep request receipts, autosave, revision conflict handling, pending mutation barriers, project generation checks and ownership recovery intact.
- Keep deferred first Edit mount and retained editor history after visiting Edit. Use the existing shared job polling and thumbnail service.
- Preserve semantic buttons, clip IDs, lazy thumbnails, keyboard focus, input-focus guards and en-US / zh-TW / ja-JP / en-XA behavior.
- Use identical fixture, browser, viewport and server mode for comparisons; retain raw samples and exclude a separate warm-up. Milliseconds are diagnostic; stable request/render/DOM bounds belong in CI.
- Real Resolve import, model/GPU/camera quality, large 4K sources and native installation remain workstation gates.

## Review Focus

- Repeated asset IDs in different clip instances: selection and DOM keys must distinguish clip IDs.
- Locked, missing and inaccessible clips: remain selectable, with accurate badges, ARIA and protected mutation behavior.
- Late source/status/locale updates during playback or hidden Edit: presentation must refresh without an incomplete memo/cache key.
- Pending Precision or Transcript writes: selection, navigation and history must respect existing save barriers.
- Cross-track/cross-beat drag and far-away keyboard selection: retain reorder rejection, focus and independent rail/lane scrolling.

---

## Current Evidence and Scope

`TimelineEditor.vue` computes `groups` from Story and composition; selection does not invalidate that computed value. Its inline rail template still evaluates every clip's button presentation whenever the parent renders. `clipOptions` is already stable. Start at the button render boundary; do not change grouping, Story duration aggregation or selection lookup without separate evidence.

The existing combined-source report at `.cloud-onboarding/artifacts/openfilm-pr-convergence/benchmark-published/interaction-performance-0.json` was one synthetic sample on `64ebfce786e995e33597fb29b2438f11623cfba7`. Its desktop source fingerprint `9b97d88da64900aec2ea04c29ca9248a1bc65e7cfe678c3aa124b3eff1b6962f` matches this main. At 1440×900 with Chromium 151.0.7922.173, 20 clicks included one already-selected clip and 19 changes: 43 TimelineEditor renders, 481.8 ms inclusive render time, 76 rail MutationObserver records, 500 clip buttons and one video. The 38 source/media requests and five shared jobs polls contained no editor/catalog reload. Automation elapsed was 5,089.3 ms; this is not input latency or a repeatable timing baseline.

The next baseline needs three retained repetitions plus an excluded warm-up. Count clip body work independently of parent renders. Two class/ARIA updates per selection are necessary; zero DOM mutations, zero parent renders and zero source requests are inappropriate success criteria. The existing probe does not instrument the editor before its first mount; first-visit render counts must be marked unmeasured unless new test-only instrumentation actually covers that phase.

### File Ownership

| File                                                                           | Responsibility                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `apps/desktop/src/components/TimelineClip.vue` (new)                           | Existing clip button presentation, translated labels and semantic pointer events.         |
| `apps/desktop/src/components/TimelineEditor.vue`                               | Rail assembly and stable leaf props/events; all editing ownership remains here.           |
| `tests/unit/timeline-clip-render-boundary.test.ts` (new)                       | Actual-SFC work counts and presentation invalidation.                                     |
| `tests/e2e/interaction-performance.spec.ts`                                    | Baseline/candidate samples, leaf render probe and bounded selection work.                 |
| `tests/e2e/editing.spec.ts`, `clip-focus.spec.ts`, `precision-editing.spec.ts` | Focus, mutation barriers, real command/persistence coverage; add only missing assertions. |
| `docs/performance-interaction.md`, `TASKS.md`, `ROADMAP.md`                    | Verified measurements, tradeoffs and final completion state.                              |

## Task 1: Establish the Clip Render Work Contract

**Files:** Create `tests/unit/timeline-clip-render-boundary.test.ts`; modify `tests/e2e/interaction-performance.spec.ts`; update the measurement contract in `docs/performance-interaction.md`.

**Interfaces:** Consume the real `TimelineEditor.vue` SFC, reactive `EditorState` and existing synthetic fixture (2,000 assets, 500 clips, ten beats, 10,000 transcript segments). Produce a test-only count of `editor.clip.select` / `editor.clip.selectLocked` label evaluations and per-component render calls; keep production sources uninstrumented. Reuse the compilation/host approach in `tests/unit/precision-render-boundary.test.ts` without creating a general test framework.

- [x] Add a passing baseline test, `records inline clip body work on a selection change`, that compiles the real parent and invokes the rendered button. Assert 500 clip buttons, exactly one selected button, the previous button deselected, and unchanged composition/history/request receipts. Record label evaluations after clearing initial mount counts.
- [x] Add the optimization contract test, `only reevaluates the previous and next clip bodies on selection`. For 500 clips, clear mount counts, select another clip and await Vue ticks. Assert exactly two clip selection-label evaluations, unchanged sibling button identities and no command/save calls. Assert clicking the already-selected clip adds zero clip body evaluations.
- [x] Run `pnpm exec vitest run tests/unit/timeline-clip-render-boundary.test.ts -t 'only reevaluates'`. Retain its RED log showing the actual inline work exceeds two; ensure failure comes from the work assertion rather than missing imports or a broken host.
- [x] Extend the browser report to distinguish attempted clicks, actual selection changes, parent/leaf render counts, source reads, jobs polling, command writes, DOM records and heap measurements. Require the requested clip's class, `aria-pressed` and inspector identity before accepting each sample. Add a cross-beat selection scenario with the same count of actual changes.
- [x] Capture one excluded warm-up and three retained baseline samples in separate fresh output directories. Use the command below with labels `rail-warmup` and `rail-baseline`; warm-up runs once, baseline uses `--repeat-each=3`. Record exact SHA, source hashes, browser, viewport and build mode; source hashes must match before/after each run. Do not run concurrently with another browser suite.

```sh
OPENFILM_CHROMIUM=/usr/bin/chromium \
OPENFILM_BENCHMARK_LABEL=rail-baseline \
OPENFILM_BENCHMARK_OUTPUT=/tmp/openfilm-rail-baseline \
pnpm exec playwright test tests/e2e/interaction-performance.spec.ts --repeat-each=3
```

- [x] Record the RED work contract and baseline evidence in the branch. Commit `test: establish timeline clip selection render budget`; the RED optimization assertion may remain local until Task 2 makes it green, so do not publish a failing CI checkpoint.

## Task 2: Isolate the Existing Clip Button

**Files:** Create `apps/desktop/src/components/TimelineClip.vue`; modify `apps/desktop/src/components/TimelineEditor.vue` near `name`, `drop` and the inline clip loop; extend `tests/unit/timeline-clip-render-boundary.test.ts`.

**Interfaces:** The leaf consumes:

```ts
interface TimelineClipProps {
  clip: Clip;
  selected: boolean;
  assetName?: string;
  thumbnailSrc?: string;
  mediaType?: MediaAsset["mediaType"];
  sourceStatus?: SourceStatus["status"];
}
```

Use the existing `Clip` / `MediaAsset` types from `@openfilm/core` and type-only `SourceStatus` from `../api`. Emit `select: [clip: Clip]`, `dragStart: [clipId: string]`, `dragEnd: []`, `drop: [targetClip: Clip]`. Parent bindings use stable handlers: `chooseClip`, `startClipDrag(clipId: string): void`, `endClipDrag(): void`, `drop`. The leaf creates no command, request, history, watcher for media loading or global event listener.

- [x] Add presentation tests before extraction: repeated asset ID/different clip IDs; locked/missing/inaccessible selection; locale change; source status removal; thumbnail appearing after repair; asset name change; duration/speed/transition/lock updates; replaced clip object after Undo/Redo. Assert labels, badges, duration, width, draggable state and selection reflect the newest inputs, with no command writes from presentation updates.
- [x] Move the current root `<button>` and its children into the leaf. Preserve `id="clip-${clip.id}"`, `.editor-clip`, selected/locked classes, duration-width clamp 120–240 px, `aria-pressed`, translated select/locked labels, lazy image, empty-source icon, badges and metadata. Resolve display name as `assetName ?? clip.title ?? t('editor.media')`; keep translations and locale-aware number formatting reactive inside the leaf. Keep existing global CSS and focus selectors unchanged.
- [x] Replace only the inline button loop with keyed leaf instances. Pass each existing clip reference, `selectedClipId === clip.id`, primitive asset fields/status and the existing thumbnail URL. Keep clip ordering, beat heading/duration calculation and `groups` semantics unchanged. Avoid fresh DTO props and per-iteration event closures; use the four stable parent handlers above. Child handles the existing dragover/drop prevent-default behavior and emits ownership actions to the parent.
- [x] Run `pnpm exec vitest run tests/unit/timeline-clip-render-boundary.test.ts`. Expected: selection contract GREEN, every invalidation/semantics case passed. Parent may still render for legitimate inspector/player updates; unrelated clip bodies must not rerender from selection or an unchanged jobs/recovery snapshot.
- [x] Run focused browser suites: `pnpm test:e2e tests/e2e/editing.spec.ts tests/e2e/clip-focus.spec.ts tests/e2e/editor-mount-lifecycle.spec.ts tests/e2e/precision-editing.spec.ts`. Expected: original focus, same-beat reorder, protected locks, history, recovery and held-write barriers all pass. Confirm hidden Story rail receives acknowledged Precision edits and later displays their duration correctly.
- [x] Commit `perf: isolate timeline clip presentation during selection` with the green tests. Keep application, composables, provider/catalog/schema and unrelated workspace lifecycle changes outside this commit.

## Task 3: Validate the Benefit and Converge One PR

**Files:** Modify `tests/e2e/interaction-performance.spec.ts`; add only uncovered cases to `tests/e2e/editing.spec.ts` / `clip-focus.spec.ts` / `precision-editing.spec.ts`; update `docs/performance-interaction.md`, `TASKS.md`, `ROADMAP.md`.

**Interfaces:** Consume Task 1's report and Task 2's `TimelineClip` boundary. Extend the test-only Vue render probe's existing allowlist to include `TimelineClip`, preserve `render.apply(this, args)` and record instrumentation coverage. No production counters or timing threshold.

- [x] Assert at most 40 additional TimelineClip render calls for each 19-change selection scenario after mount counts are reset. Require positive actual selection changes and instrumented leaf coverage so an inert editor cannot pass. Idle jobs updates with unchanged display data cause zero clip-body updates; source-status changes update the affected buttons. Enforce no `/api/editor` or catalog reload and no command writes during selection; allow existing source range reads and shared jobs polling.
- [x] Add any missing real-browser assertions for cross-beat/cross-track drop rejection, locked selection, Arrow-key rail/lane reveal without page scroll, and pending Transcript/Precision save barriers. Verify selection leaves composition revision/history/autosave draft unchanged, whereas an explicit edit remains undoable and survives save/reopen.
- [x] Capture candidate warm-up and three retained comparable repetitions, using Task 1's command with fresh `rail-candidate` paths. Compare clip work, parent time, ScriptDuration, layout, DOM records, first Edit mount, retained-editor revisits and heap after repeated visits. Keep production fingerprints fixed within each run and disclose instrumentation changes. Count component instances and verify lazy thumbnail behavior; 500 leaves can increase initial mount/memory cost.
- [x] Accept only a demonstrated bounded selection-work reduction with correct state updates. If first-mount or retained-memory costs materially worsen, investigate that tradeoff before landing; do not hide it with a selection-only success claim. Revert the extraction if comparable measurements do not support it, retaining useful test/evidence changes.
- [x] Run core visual/focus suites at 1280×720, 1440×900 and 1920×1080 for en-US / zh-TW / ja-JP / en-XA using `pnpm test:e2e tests/e2e/global-visual.spec.ts tests/e2e/clip-focus.spec.ts`. Inspect selected/locked focus, long titles and missing badges; verify no new horizontal page overflow. Preserve reduced motion, theme and keyboard behavior. Record observed limitations without claiming complete WCAG certification.
- [x] Run the full regression below on a frozen candidate. Expected: every applicable command exit 0; inspect actual test counts and native harness limits. Archive logs, raw browser reports/screenshots, RED/GREEN evidence and tracked-file hashes. Fix new correctness failures before publishing.

```sh
pnpm format:check
pnpm test:i18n
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:interchange
pnpm test:native
node scripts/smoke-built-cli.mjs
```

- [x] Update docs with exact base/head, work counts, three-sample diagnostic ranges, first-mount/memory tradeoffs and workstation gates. Check TASKS only after implementation, regression and documentation are complete. Commit `test: verify timeline selection boundary and document measurements`.
- [ ] Open one focused PR from freshly fetched main, attach it to the task, obtain independent correctness review and fix all P1/P2 findings with regressions. Require exact-head CI green and accurate evidence before convergence. Do not mix future face/highlight/caption features into this optimization.

## Planning Status

Local implementation is complete on `62e48e397d6346e551b0678a183529ba48ea699b`: actual-SFC RED→GREEN, baseline/candidate warm-ups plus three retained repetitions, 34 focused browser cases, all ten full local gates and independent production review passed. See `docs/performance-interaction.md` for first-mount tradeoffs and raw evidence. The final checkbox records the external publication gate at the time this document was committed; consult the pull request for current exact-head CI and publication status.
