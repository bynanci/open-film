# Desktop Lazy Workspace Validation

Measured on 2026-11-06 in a Windows worktree based on `main` at
`1bafb5cd4532ce9f9a171499abc8631e4863d1ee`. Environment: Node.js 24.14.0,
pnpm 11.11.0, Vite 8.2.4, Chromium through Playwright. The measurement includes
the candidate changes in this branch.

## Scope

Fifteen conditionally displayed Desktop components now use Vue async component
loading: `AppSettings`, `ImportPanel`, `ExportWorkspace`, `CollectMediaPanel`,
`ProxyStoragePanel`, `ProjectVersionsPanel`, `ScenePlanner`,
`StoryScriptReview`, `StoryGraphView`, `StoryboardView`, `PipelineWorkbench`,
`CreativeVariantComparisonModal`, `TimelineEditor`, `RelinkMedia` and
`AnalysisJobActions`. A localized status component appears only when a lazy
component takes longer than 150 ms to resolve.

## Production bundle

`pnpm build` completed successfully. The generated `index.html` loads the entry
and statically preloads four JavaScript dependencies. Summing those five output
files gives the initial JavaScript download; async workspace chunks are excluded.

| Resource                         |  Minified |      gzip | Loading            |
| -------------------------------- | --------: | --------: | ------------------ |
| Entry plus static modulepreloads | 887.29 kB | 290.42 kB | Initial            |
| Entry chunk                      | 272.03 kB |  81.51 kB | Initial            |
| Initial stylesheet               | 195.75 kB |  31.54 kB | Initial            |
| `TimelineEditor` JavaScript      | 584.72 kB | 155.78 kB | On Edit navigation |
| `TimelineEditor` stylesheet      |  37.97 kB |   6.74 kB | On Edit navigation |

The previous value recorded in `TASKS.md` was 1.72 MB minified / 508 kB gzip.
The production build still reports a chunk-size advisory because the deferred
`TimelineEditor` chunk exceeds 500 kB minified. That code is excluded from the
initial modulepreloads and is fetched when Edit opens.

## Browser navigation

The focused Playwright test records `performance.measure` from immediately
before clicking Edit until more than one editor clip is rendered. It also checks
that the TimelineEditor resource is absent before navigation and present after.
The observed Edit navigation times were 2,093 ms in the focused run and 769 ms
in the full workspace-mode file. These are local Vite development-server
measurements over the synthetic E2E fixture; they are not release-build or cold
OS-cache startup measurements, and the two observations are not a benchmark
median.

## Verification

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed; emitted the deferred-chunk advisory described above.
- `pnpm test:unit` — 234 files passed, 3,588 tests passed and 2 skipped.
- `pnpm exec vitest run tests/unit/build-attribution.test.ts --maxWorkers=1` — passed.
- `pnpm exec playwright test tests/e2e/workspace-modes.spec.ts` — 22 passed.
- `pnpm exec prettier --check` for all changed Vue, TypeScript, test and build
  attribution files — passed.

The lazy CSS attribution fallback is covered by the focused build-attribution
unit test; it maps an extracted async Vue stylesheet to the style module
retained by its owning emitted chunk.

## Remaining evidence

No native Tauri executable was present at the standard release path during this
run, so no native cold-start result is claimed. The task remains open until a
native candidate can be measured with the project benchmark runner; no bundle
size target is set from this browser-only evidence. This also does not establish
clean-install, update/rollback, Windows or macOS signing, notarization, or
installer-candidate evidence from the separate M7 release gate.
