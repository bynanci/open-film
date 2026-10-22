# M9A Story Graph & Multi-Perspective Workspace Validation

## Status

Implementation and automated regression evidence are recorded on branch `story_graph_view_m9a`.
All local automated gates (`format:check`, `test:i18n`, `lint`, `typecheck`, and unit/domain/UI test suites)
pass with zero warnings or errors. Touch/pen gestures and hardware high-DPI display checks remain manual gates.

## Automated Contracts & Architecture

| Area                                 | Evidence                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Domain Model**                | Canonical `Story` and `StoryBeat` remain authoritative. `StoryBeatNode` references stable `storyId` and `beatId` without schema duplication. Strict schema and graph validation (`validateStoryGraph`, `validateGraphViewState`).                                                                    |
| **Node Types & Idea Sources**        | 4 node types: `theme`, `beat`, `asset`, `idea`. Idea nodes retain explicit source provenance: `user-memory`, `planned`, `wish`, `unknown`. `@`-mentions utilize stable asset IDs without leaking private filesystem paths.                                                                           |
| **Edge Semantics & Cycle Rejection** | 5 relationship edges: `contains`, `supports`, `precedes`, `echoes`, `alternative`. `contains` and `precedes` enforce topological cycle rejection on edge addition. Self-referencing edges are rejected. `echoes` edges express thematic resonance and are excluded from execution dependency graphs. |
| **Playback Order Invariance**        | Narrative sequence is driven by explicit reorder operations (`setAsNextBeat`, `Story.beats`), never inferred from canvas node coordinates `(x, y)`. Moving nodes or running auto-layout never mutates playback sequence.                                                                             |
| **Revision Separation**              | `GraphViewState` (pan, zoom, coordinates, collapsed states) is persisted in `cache/story-graph-views.json` and in-memory cache, isolated from `project.updatedAt` and composition content revisions. Canvas layout changes result in strictly 0 render or provider calls.                            |
| **Multi-Perspective Workspace**      | Story workspace features 3 synchronized perspectives: Outline (`outline`), Story Graph (`graph`), and Storyboard (`storyboard`). Active beat selection (`activeBeatId`) is bidirectionally preserved across perspective switching and Edit timeline navigation.                                      |
| **Media Playback Rule**              | Only the actively selected beat/media card allows video/audio playback; all other cards display static image thumbnails with lazy loading. Removing graph nodes/edges never deletes underlying library assets.                                                                                       |
| **Synthetic Benchmarks**             | Deterministic auto-layout tested on synthetic 100-node and 500-node graphs (<50ms execution). Update costs remain bounded without unbounded memory allocation.                                                                                                                                       |

## Automated Gates Run

Run date: 2026-10-22 UTC. Base branch: `main` at `bdde0ac`. Branch: `story_graph_view_m9a`.

| Command                                                                                                                                                                                    | Result                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                                                                                                                        | Passed; all files formatted properly.                                                             |
| `pnpm test:i18n`                                                                                                                                                                           | Passed; 2,035 semantic keys, errors, and UI strings matched across `en-US`, `zh-TW`, and `ja-JP`. |
| `pnpm lint`                                                                                                                                                                                | Passed with `--max-warnings=0`.                                                                   |
| `pnpm typecheck`                                                                                                                                                                           | Passed (`tsc` and `vue-tsc`).                                                                     |
| `pnpm vitest run packages/core/tests/story-graph.test.ts packages/story/tests/story-graph-layout.test.ts packages/application/tests/story-graph.test.ts tests/unit/story-graph-ui.test.ts` | Passed: 4 test files, 33 tests in 6.69s.                                                          |

## Synthetic Benchmark Metrics

Deterministic auto-layout algorithm (`computeStoryGraphAutoLayout`) performance on synthetic datasets:

| Graph Size   | Node Count | Edge Count | Auto-Layout Execution Time | Status                |
| ------------ | ---------- | ---------- | -------------------------- | --------------------- |
| Small Story  | 10 nodes   | 9 edges    | 0.82 ms                    | Pass (<5 ms)          |
| Medium Story | 100 nodes  | 99 edges   | 4.88 ms                    | Pass (<50 ms target)  |
| Large Story  | 500 nodes  | 499 edges  | 21.65 ms                   | Pass (<100 ms target) |

All layouts produce deterministic, collision-free layered layouts with Themes on top, Beats left-to-right, Assets beneath beats, and Ideas arranged nearby.
No render calls, provider calls, or project revision bumps occur during layout computation or canvas manipulation.
