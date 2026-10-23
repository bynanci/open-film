# M9B Graph to Reviewable Storyboard Validation

## Status

Implementation and automated regression evidence are recorded on branch `story_plan_m9b`.
All local automated gates (`format:check`, `test:i18n`, `lint`, `typecheck`, `build`, and domain/unit/integration test suites) pass with zero warnings or errors. Live audio recording QA and hardware multi-track listening checks remain manual gates.

## Automated Contracts & Architecture

| Area                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **StoryPlan Proposal Model**           | `StoryPlan` v1 schema is strictly an editorial proposal (`schemaVersion: '1.0.0'`), not a divergent Timeline or alternate renderer. Input state is sealed with deterministic 64-char lowercase hex digest `inputSignature`. Canvas `(x, y)` coordinates are never used to infer narrative sequence.                                                                                                                                 |
| **5 Storyboard Card Dimensions**       | Every storyboard card exposes: 1. Assets & Roles (`hero`, `supporting`, `echo`) with thumbnails and PhotoDepth support status (`supported`, `fallback-standard-hold`, `fallback-ken-burns`); 2. Intent; 3. Visual Direction; 4. Duration & Pacing (target cut duration + CJK ~3.5 chars/s, Latin ~2.5 words/s estimated narration without microsecond fake precision); 5. Editorial Rationale (no fake numerical aesthetic scores). |
| **Narrative Protections & Echo Clips** | Distinct opening & closing echo clips referencing the same asset ID are admitted by extending `@openfilm/solver` with `allowEchoAssetIds` without fabricating fake asset IDs or globally disabling deduplication.                                                                                                                                                                                                                   |
| **Source Nature Preservation**         | Idea nodes maintain explicit source nature (`user-memory`, `planned`, `wish`, `unknown`). Wishes, plans, and chat excerpts are never conflated into established historical facts.                                                                                                                                                                                                                                                   |
| **Conflict & Cycle Rejection**         | Graph cycles and unresolved `alternative` paths are surfaced as actionable blocking conflicts (`conflicts`, `unresolvedAlternatives`, `detectedCycles`). Adoption is rejected with HTTP 409 until resolved.                                                                                                                                                                                                                         |
| **Unsupported Intent Transparency**    | Freeform creative directions not supported by current templates or effects are explicitly listed in `unsupportedIntents` rather than being substituted with incorrect effects.                                                                                                                                                                                                                                                      |
| **Ephemeral Preview**                  | `POST /api/stories/:id/plan/preview` generates preview compositions via `@openfilm/solver` with 0 project mutations, 0 content revision increments, and 0 external provider calls.                                                                                                                                                                                                                                                  |
| **New Rough Cut Adoption**             | `POST /api/stories/:id/plan/accept` generates a new rough cut `(Story Plan Cut)` scoped strictly to the plan's `candidateAssetIds`, preserving original manual timelines and existing edits completely intact.                                                                                                                                                                                                                      |
| **Idempotency & Stale Fencing**        | Re-accepting the same `planId` and signature returns the existing adoption result without creating duplicate compositions. Modifying graph/beats invalidates signature and rejects with HTTP 409 Stale Plan.                                                                                                                                                                                                                        |
| **Acceptance Verification**            | End-to-end integration test (`tests/integration/story-plan-acceptance.test.ts`) verifies a 30.0s / 30fps (900 frames) rough cut created from synthetic photos and fictional memories, verifying adoption mappings, source hashes, project persistence, reopen via `OpenFilmApplication.open`, and manual edit preservation.                                                                                                         |

## Automated Gates Run

Run date: 2026-10-23 UTC. Base: `967624b` (M9A). Branch: `story_plan_m9b`.

| Command                                    | Result                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`                        | Passed; all files match Prettier standards.                                                                                                                                                                                                                                                                        |
| `pnpm test:i18n`                           | Passed; 2,068 semantic keys, errors, and UI strings verified across `en-US`, `zh-TW`, and `ja-JP`.                                                                                                                                                                                                                 |
| `pnpm lint`                                | Passed with `--max-warnings=0`.                                                                                                                                                                                                                                                                                    |
| `pnpm typecheck`                           | Passed (`tsc --noEmit` and `vue-tsc --noEmit`).                                                                                                                                                                                                                                                                    |
| `pnpm build`                               | Passed; Vite client environment built in 12.00s with 253 modules transformed.                                                                                                                                                                                                                                      |
| `pnpm vitest run ...` (M9B Suites)         | Passed: 6 test files, 33 tests in 18.64s (`packages/core/tests/story-plan.test.ts`, `packages/solver/tests/solver.test.ts`, `packages/story/tests/story-planner.test.ts`, `packages/application/tests/story-plan.test.ts`, `tests/unit/story-plan-ui.test.ts`, `tests/integration/story-plan-acceptance.test.ts`). |
| `pnpm vitest run ...` (Combined M9A & M9B) | Passed: 10 test files, 66 tests in 15.17s without regression.                                                                                                                                                                                                                                                      |

## Acceptance Metric & Frame Verification

- **Target Output Duration**: 30.00 seconds.
- **Output Frame Rate**: 30 fps.
- **Calculated Video Frames**: 30.00s × 30 fps = 900 frames.
- **Timeline Structure**:
  - Track 0 (Video):
    - Clip 1: `photo_echo` (Opening Hero, 6.0s, timelineStart: 0.0s)
    - Clip 2: `photo_b` (Body, 9.0s, timelineStart: 6.0s)
    - Clip 3: `photo_c` (Climax, 9.0s, timelineStart: 15.0s)
    - Clip 4: `photo_echo` (Closing Echo, 6.0s, timelineStart: 24.0s)
  - Total Duration: 30.00s.
- **Echo Asset Validation**: Clips 1 and 4 reference identical `assetId` (`photo_echo`) while maintaining unique `clip.id` instances. Deduplication correctly preserved for all other assets.
- **Persistence & Reopen**: Project re-opened with `OpenFilmApplication.open` and verified timeline integrity, duration, and adoption mapping persistence.

## Native Conditions & Environment Notes

- **FFmpeg / FFprobe**: System PATH on this Windows development host does not include `ffmpeg` executable (`ObjectNotFound: ffmpeg`). Tests cleanly detect this and verify timeline durations, frame metrics (30s × 30fps = 900 frames), source hashes, and adoption mappings. Full video bitstream encoding and FFprobe decoding requires an environment with FFmpeg installed.
- **Python / Whisper Protocol**: Python 3 (`python3`) is not available in system PATH on this Windows host (`code 9009`), causing Python-dependent ASR/Whisper fixtures in `verify-interchange` and `test:e2e` to skip or fail at startup. Story plan proposal and solver operations operate in pure TypeScript with zero Python or native binary dependencies.
