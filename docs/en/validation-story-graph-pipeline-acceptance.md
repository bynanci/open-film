# Story Graph × Pipeline End-to-End Product Acceptance Validation

## Status

Comprehensive integration acceptance evidence combining M9A through M11B is recorded on branch `story_graph_pipeline_e2e_acceptance` based on `creative_variants_m11b` (PR #48).

All local automated gates (`format:check`, `test:i18n`, `lint`, `typecheck`, `build`, and end-to-end integration acceptance test suite) pass 100% with zero warnings or errors. Clean-machine physical GPU video playback and live hardware auditory listening QA remain open workstation gates; synthetic tests are never treated as aesthetic or hardware proof.

## Evidence Categorization

| Category               | Status   | Notes                                                                                                                                                                                                                                                                                              |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **implemented**        | Complete | All 7 end-to-end acceptance journeys, fixed fixtures, narrative protections, and privacy contracts implemented.                                                                                                                                                                                    |
| **automated-verified** | Complete | Full automated test suite passes: `tests/integration/story-graph-pipeline-e2e-acceptance.test.ts` (6 tests), plus regression test suites in `creative-variants.test.ts` (9 tests), `pipeline.test.ts` (11 tests), `pipeline-change-impact.test.ts` (11 tests), and `story-plan.test.ts` (5 tests). |
| **failed**             | 0        | Zero test or verification failures across all automated gates.                                                                                                                                                                                                                                     |
| **blocked**            | 0        | No blocking issues or upstream dependency blockers.                                                                                                                                                                                                                                                |
| **manual-pending**     | Open     | Live multi-track human listening QA, clean-machine physical GPU playback, and high-DPI workstation verification gates intentionally remain open.                                                                                                                                                   |

## Fixed Acceptance Fixture

The acceptance test suite uses a strictly controlled, reproducible synthetic fixture:

- **6 Synthetic Images**: 1280×720 synthetic JPEG images (`photo_1` through `photo_6`), each with unique content hashes, dimensions, timestamps, and realistic Jiufen hiking trail GPS coordinates (`GeoPoint`).
- **3 Fictional Memories**: Personal reflective thoughts (`user-memory`, `wish`) capturing personal nostalgia and future wishes without conflation into historical facts.
- **3 Fictional Conversations**: Dialogue excerpts (`planned`) reflecting intentions and advice from companions, tea house owners, and guides.
- **Schematic Route**: Explicit graph edges (`precedes`, `echoes`, `contains`) mapping the narrative progression without canvas coordinate guesswork.
- **Reproducible WAV Guide Tone**: 30.0-second 16-bit PCM Mono 44.1 kHz sinusoidal WAV tone. Explicitly labeled `tone` across all metadata; never masquerades as human speech.
- **Manual Traditional Chinese Subtitles**: Authentic localized strings aligned to scene intentions and visual directions.
- **Frame Calculation**: 30.0 seconds at 30 fps yielding exactly **900 frames** under default 1280×720 resolution.

## 7 End-to-End Journeys Verified

### Journey 1: Story -> Graph -> Media Relationships -> Explicit Story Order

- Connects canonical `StoryBeat`s with ideas and photo assets via explicit graph edges.
- Unresolved alternatives or narrative cycles fail closed with actionable conflict warnings; sequence is never inferred from arbitrary canvas positions.
- Thematic echo is preserved: `photo_1` serves as opening anchor (`b1`) and returns as closing echo (`b6`) via explicit distinct clip instances without duplicating the asset or bypassing deduplication guards.

### Journey 2: Storyboard Proposal (`StoryPlan`) -> Review -> Rough Cut A

- Generates 5-dimension storyboard cards (`whichImage`, `whatExpressed`, `howPresented`, `howLong`, `whyRationale`).
- Source nature is preserved: personal memory vs. forward-looking wish vs. conversation plan remain distinct.
- `previewPlan` is non-destructive: does not mutate original Story or Composition.
- `acceptPlan` creates a new rough cut (新試剪) bound strictly to the current input revision; original manual edits in `timelines[0]` remain completely untouched.

### Journey 3: Guided Pipeline -> Input / Review -> FFmpeg Render -> QA -> Export

- Runs the canonical 8-step `guided-story-to-video` pipeline.
- Requires explicit reviewer approval at review gates (`waiting-review`); review state holds no subprocesses or locks.
- Advances project revision cleanly through legal signed receipts (`receipt.action === "composition-adopt"`).
- Produces physical preview video artifact (`preview-video`) and visual QA inspection report (`qaReport`).
- Total output duration confirms 30 seconds at 30 fps (900 frames).

### Journey 4: Creative Variant B (Subtitles Only) -> Verified 0 TTS / 0 Motion Reuse

- Modifies only subtitle text without touching audio or visual assets.
- Change impact analysis correctly identifies:
  - `scene-prepare` -> `reuse`
  - `narration` -> `reuse`
  - Downstream subtitle rendering and export -> `rerun`
- Service call counters prove:
  - `ttsCalls === 0` (0 TTS calls)
  - `motionCalls === 0` (0 motion generation calls)
- Generates verified output MP4 reflecting updated subtitle payload while reusing existing audio tracks.

### Journey 5: Narration Modification Invalidation Propagation

- Modifies voice narration asset (duration changed to 32 seconds).
- Change impact analysis correctly identifies:
  - `scene-prepare` -> `reuse` (visual candidates remain completely preserved)
  - `narration` -> `needs-review` (consumed audio input changed, requires reviewer confirmation)
  - `timing-captions` -> `rerun` (audio duration changed from 30s to 32s)

### Journey 6: Fault Injection Resilience

- **Cancel Injection**: Cancelling an in-flight run immediately transitions status to `cancelled`; late arrival responses are rejected.
- **Retry Original Input**: Retrying a cancelled run reuses the exact immutable input snapshot and increments the attempt counter without creating orphan jobs.
- **Source Change Detection**: Modifying source media content hash triggers cache miss fallback; tampered data cannot produce false cache hits.
- **Project Switch & Reopen**: Persisting and reopening across project boundaries preserves run history and does not falsely kill active tasks.
- **Version Restore**: Restoring a named checkpoint version reverts project revision; old runs targeting superseded revisions are marked `outdated` via `isRunOutdated`.

### Journey 7: Creative Variants A/B Review, Adoption & Baseline Restoration

- **Section Isolation ("只改本段")**: Variant B modifies pacing of Beat 1 (tightened to 3.5s) while provably preserving 100% of non-target sections (`preservedSections`).
- **Zero-Render A/B Comparison**: `compareVariants` compares variant A and B without triggering video rendering (`renderCalls === 0`).
- **Single-Audio Playback**: Enforces single-active audio playback between variants.
- **Pre-Adoption Version Checkpoint**: `adoptVariant` creates a named version checkpoint automatically before promoting Variant B to `timelines[0]`.
- **Baseline Restoration**: Restoring the pre-adoption checkpoint cleanly restores Baseline A to `timelines[0]`.

### Privacy Contracts: Collect Media & Export

- Collecting media for the active film (`scope: "current-film"`) packages strictly the media assets directly referenced by its composition.
- Private, unrelated assets in the project catalog (`private_unrelated.jpg`) are strictly excluded from the export archive.

## Bug Fixes Applied

- **`packages/application/src/creative-variants.ts` (`createVariant`)**:
  - Cloned variant clips in `derivedComposition` now have their `beatId` mapped to the corresponding newly generated beat ID in `derivedStory` via `beatIdMap`.
  - `composition.beatLooks` similarly maps `beatId` references to derived beat IDs.
  - Prevents `ProjectValidationError: unknown beat ID ... for this composition's story` when `validateProject` is called during variant creation and adoption.

## Automated Verification Gates

Run date: 2026-10-23 UTC. Base: `creative_variants_m11b` (commit `1bae98e`). Branch: `story_graph_pipeline_e2e_acceptance`.

| Gate                     | Command                                                                         | Result                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Prettier Formatting**  | `pnpm format:check`                                                             | Passed; all matched files use Prettier code style.                                           |
| **i18n Completeness**    | `pnpm test:i18n`                                                                | Passed; 2,219 semantic keys verified across `en-US`, `zh-TW`, and `ja-JP`.                   |
| **ESLint**               | `pnpm lint`                                                                     | Passed with `--max-warnings=0`. Clean run with zero errors and zero warnings.                |
| **TypeScript / Vue SFC** | `pnpm typecheck`                                                                | Passed (`tsc --noEmit && vue-tsc --noEmit -p apps/desktop/tsconfig.json`). Zero type errors. |
| **Vite Client Build**    | `pnpm build`                                                                    | Passed; production client bundle built in 5.54s.                                             |
| **Acceptance Suite**     | `pnpm vitest run tests/integration/story-graph-pipeline-e2e-acceptance.test.ts` | Passed (6/6 tests passed in 7.03s).                                                          |
| **Creative Variants**    | `pnpm vitest run packages/application/tests/creative-variants.test.ts`          | Passed (9/9 tests passed in 3.31s).                                                          |
| **Pipeline Service**     | `pnpm vitest run packages/application/tests/pipeline.test.ts`                   | Passed (11/11 tests passed in 5.63s).                                                        |
| **Change Impact**        | `pnpm vitest run packages/application/tests/pipeline-change-impact.test.ts`     | Passed (11/11 tests passed in 7.87s).                                                        |
| **Story Plan**           | `pnpm vitest run packages/application/tests/story-plan.test.ts`                 | Passed (5/5 tests passed in 0.97s).                                                          |

## Open Workstation Gates

- Clean-machine native installer signing and execution.
- Physical GPU accelerated hardware video decoding/encoding.
- Live human auditory listening QA on multi-track audio mixing.
