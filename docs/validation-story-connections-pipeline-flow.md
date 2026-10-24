# Story connections and Pipeline flow validation

- Branch: `codex/story-graph-connections-pipeline-flow`
- Base: `ddf13781e3cd9654e6ea6679871358f0c26ccbb4`
- Date: 2026-10-24 UTC
- Fixtures: generated PNG/MP4 media and fictional story text only
- Contracts retained: `Story`, `StoryGraph`, `GraphViewState`, Composition,
  canonical Pipeline recipe, application save path and project schema 1.0.0

## Implemented behavior

StoryGraph node movement now uses Pointer Events for mouse, pen and touch, while
coordinates remain in the existing project-private `GraphViewState` cache. Expert
mode adds a focused connection handle, live Bezier preview, visible target state,
Escape cancellation and Enter/Space operation. General mode exposes the same
operation as a source/relation/target form in the Inspector. Coordinate
hit-testing preserves touch targets through implicit pointer capture, and target
selection cannot leave a node-layout drag active.

The new `connect-nodes` application operation validates the requested typed edge
before one save. A `beat → asset / supports` connection updates
`StoryBeat.selectedAssetIds`; a `beat → beat / precedes` connection uses the
existing canonical reorder operation. Duplicate, self-referencing, missing and
cyclic dependency links fail without returning a changed graph. Original media
is never written or removed. Valid custom graph node IDs remain the exact edge
endpoints while canonical beat asset selection is updated.

Pipeline Workbench reads one shared five-gate descriptor over the existing eight
recipe steps. General mode presents the active gate, status, completed progress,
previous/next controls, required review and recovery action. Expert mode adds a
task/issue-style rail with step IDs, dependencies and task status plus the run
inspector. Stage and task order remain fixed by the recipe; there is no draggable
execution graph or second pipeline state.

## Automated evidence

| Gate                                          | Result                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Typed story/application connection tests      | Pass: duplicate, self, cycle, exact custom endpoints, canonical asset selection and beat order                            |
| Mounted Vue behavior and Pipeline model tests | Pass: captured-touch target, no stale node drag, keyboard connection, General fallback, gate navigation and status        |
| `pnpm format:check` / `pnpm lint`             | Pass                                                                                                                      |
| `pnpm test:i18n` / `pnpm test:docs-i18n`      | Pass: 2,300 semantic keys and placeholders; 111 English reference mirrors                                                 |
| `pnpm typecheck`                              | Pass: TypeScript and Vue SFC checks                                                                                       |
| Focused Vitest selection                      | Pass: 5 files / 29 tests                                                                                                  |
| Full `pnpm test`                              | Pass with pinned OTIO Python: 280 files / 3,831 tests in 346.18 seconds                                                   |
| `pnpm build`                                  | Pass in 1.04 seconds; existing >500 kB application chunk advisory remains                                                 |
| Real Chromium graph interaction               | Pass: pointer node move persisted to graph view cache; pointer connection saved a typed edge and canonical selected asset |
| Real Chromium Pipeline interaction            | Pass: General focused gate, Expert 8-task rail, 1024×768 and 1280×720 overflow checks                                     |
| Browser project-start race regression         | Pass: active-project/welcome condition wait; focused create/cancel sequence 2/2                                           |
| Review-focused Chromium regression            | Pass: 7/7 StoryGraph, Pipeline, CJK and keyboard workflow cases after review fixes                                        |
| Full `pnpm test:e2e`                          | Pass: 230/230 in 19.8 minutes using `/usr/bin/chromium`                                                                   |
| `pnpm test:interchange`                       | Pass: 18 tests; official OpenTimelineIO 0.18.1 read/write/read, sources, hashes, bounds and relocation                    |
| `pnpm test:native`                            | Not run: attempted, but `cargo` is not installed in this environment                                                      |

The first Playwright invocation did not execute product assertions because the
default Playwright browser bundle was absent. The same unchanged tests were run
with the installed `/usr/bin/chromium`; both focused cases and all 230 browser
cases then passed.

A later fresh full-browser run passed 229/230 and exposed an existing test
startup race before the import-cancellation scenario: a one-shot visibility read
could run before the active project's controls mounted, then wait for a welcome
screen button that was not present. The captured trace showed the prior project
was healthy and still open. The setup now waits for either stable active-project
or welcome state before switching; its focused two-test sequence and the
subsequent complete 230/230 run passed.

The first full Vitest invocation used system Python and passed 3,830 tests, while
the NLE handoff case failed only because `opentimelineio` was unavailable there.
The repository's pinned `/tmp/openfilm-otio-venv` reports OpenTimelineIO 0.18.1;
the failed case passed in isolation and the full 3,831-test suite then passed
with `OPENFILM_OTIO_PYTHON` set to that interpreter.

## Manual gates

Physical touch and pen hardware, screen-reader announcements, OS IME, high-DPI
native WebView behavior and sustained large-graph ergonomics remain workstation
checks. These automated results do not claim hardware certification. No renderer,
FFmpeg output, provider transport or original-media behavior changed in this UI
and story-application slice.
