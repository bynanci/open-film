# M11B Creative Variants and A/B Review Validation

## Status

Implementation and automated regression evidence are recorded on branch `creative_variants_m11b`.
All local automated gates (`format:check`, `test:i18n`, `lint`, `typecheck`, `build`, and creative variant domain/service/UI test suites) pass with zero warnings or errors. Live multi-track listening QA and external hardware decoding verification remain manual gates.

## Automated Contracts & Architecture

| Area                                   | Evidence                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Separation of Concerns**             | Three distinct versioning layers: 1. `ProjectVersionRecord` (full immutable project snapshots); 2. Session Undo/Redo (in-memory interaction history); 3. `CreativeVariant` (structured branching records in `cache/creative-variants.json`). Does **not** duplicate raw media and does **not** create a second version database. |
| **"只改本段" Section Isolation Proof** | Modifying a specific section (`scope: "section"`) provably preserves 100% of non-target beats and clips (`preservedSections`). Cloned clips maintain exact media asset ID, filters, transforms, and timing relative to preceding cursor offsets.                                                                                 |
| **Edit Lock Preservation**             | `clip.locked` is strictly preserved on cloned variant clips. Attempting to create a variant modifying a section containing locked clips fails closed with HTTP 409 (`timeline.conflict`).                                                                                                                                        |
| **Zero-Render A/B Comparison**         | `compareVariants` inspects existing composition models, story structures, and previously generated pipeline preview/QA artifacts. Comparing variants **never** triggers media rendering, re-rasterization, or external service calls ("開比較不重新生成").                                                                       |
| **Single-Audio Playback Safety**       | The comparison player strictly enforces that only **one** variant audio channel plays at any time. Selecting Audio A mutes/pauses Audio B; selecting Audio B mutes/pauses Audio A (`activeAudioChannel === "A" \| "B"`).                                                                                                         |
| **Section-Based Alignment Navigation** | When comparing variants with different overall durations, navigation aligns by section/beat chips. OpenFilm **never** falsely claims differing runtimes align at identical absolute timestamps.                                                                                                                                  |
| **Pre-Adoption Version Checkpoint**    | `adoptVariant` verifies source availability, edit locks, and expected revision before mutating the active project. A named checkpoint version (`app.versions.create`) is created automatically _before_ promoting the variant composition. If checkpoint creation fails, adoption immediately aborts without project mutation.   |
| **Post-Restore Invalidation**          | When a user restores a baseline checkpoint (`app.versions.restore`), the project revision reverts. Old pipeline runs and approval receipts targeting superseded revisions are marked `outdated` via `isRunOutdated` and cannot be re-adopted.                                                                                    |
| **Shared Media Protection**            | Deleting a creative variant deletes only its derived Story, derived Composition, and variant record. Shared catalog `MediaAsset`s are **never deleted or pruned**.                                                                                                                                                               |
| **Collect Media Privacy**              | Collecting media for a variant with `scope: "current-film"` packages only the media assets directly referenced by that specific composition. Private assets used exclusively in other variants or unconsumed library media are strictly excluded.                                                                                |

## Automated Gates Run

Run date: 2026-10-23 UTC. Base: `incremental_runs_m11a`. Branch: `creative_variants_m11b`.

| Command                                             | Result                                                                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                 | Passed; all matched files use Prettier code style.                                                                                                                                                 |
| `pnpm test:i18n`                                    | Passed; 2,219 semantic keys verified across `en-US`, `zh-TW`, and `ja-JP`. Exact 100% parity on all variant actions, fields, diff, status, and checkpoint strings.                                 |
| `pnpm lint`                                         | Passed with `--max-warnings=0`. Clean ESLint run with zero errors and zero warnings across all packages and apps.                                                                                  |
| `pnpm typecheck`                                    | Passed (`tsc --noEmit` and `vue-tsc --noEmit -p apps/desktop/tsconfig.json`). Zero TypeScript errors across core domain, application services, server API, and Vue SFC templates.                  |
| `pnpm build`                                        | Passed; Vite client environment built with all packages resolved (5.35s).                                                                                                                          |
| `pnpm vitest run packages/core/...`                 | Passed: `packages/core/tests/creative-variants.test.ts` (3 tests covering input validation, schema verification, and diff calculation).                                                            |
| `pnpm vitest run packages/application/...`          | Passed: `packages/application/tests/creative-variants.test.ts` (9 tests covering impact preview, lock prevention, adoption, checkpoint failure rollback, restore invalidation, and Collect Media). |
| `pnpm vitest run tests/unit/creative-variant-ui...` | Passed: `tests/unit/creative-variant-ui.test.ts` (3 tests covering modal SFC contracts, accessibility, single-audio rule, section navigation, and App.vue integration).                            |

## Native Conditions & Environment Notes

- **FFmpeg / FFprobe**: System PATH on this Windows development host does not include the `ffmpeg` executable. Zero-render comparison operates completely in-memory and on pre-existing artifacts without invoking FFmpeg.
- **SQLite Database Locks on Windows**: During integration test teardown, `app.catalog.close()` is cleanly invoked in `afterEach` before temporary project directory cleanup (`rm(projectDir)`), preventing `EBUSY: resource busy or locked` errors on Windows filesystems.
