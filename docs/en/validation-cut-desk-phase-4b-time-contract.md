# Cut Desk Phase 4B.1 — deterministic legacy clip-frame time

Date: 2026-11-06  
Branch: `codex/cut-desk-phase-4b-contract-design`  
Base: `b6304914a7eb351d8e5d0a0a11b41e163713e20b` (`main`)  
Status: local implementation candidate; not merged; hosted validation pending.

## Delivered in this slice

- Added `resolveClipFrameTime` to `@openfilm/core`. Its versioned
  `ResolvedClipFrameTimeV1` result returns the rounded clip start, integer
  clip-local output frame, rational-timebase local seconds, and the source
  timestamp under the existing scalar `transform.speed` mapping.
- Routed active clips in `resolveCompositionFrame` through the same pure frame
  calculation. It has no playback history, wall clock, mutable state or media
  access. A presentation-only tail holds at the validated exclusive source end.
- Preserved existing clip/source range validation, 50 ms source-duration
  tolerance, rounded starts, half-open frame ranges, source clamping and saved
  Composition shape. No UI, schema migration, animation field, renderer output
  change or new timeline was introduced.
- Kept keyframe and speed-map data out of persisted projects until Monitor and
  FFmpeg consumers can be added and validated together. Variable-speed audio
  remains an open product/engineering decision; this candidate does not change
  any audio mapping.

## Local evidence

- TDD red check: the new focused cases failed because the resolver was absent.
- `vitest run packages/core/tests/sequence.test.ts` — 55 tests passed, including
  rational 30000/1001 mapping, arbitrary/out-of-order seeks, source endpoint
  clamping and invalid/pre-clip frame rejection.
- `pnpm test:contracts` — 77 files, 1,511 tests passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, and `pnpm build` — passed.
  Build reports the existing `TimelineEditor` chunk-size advisory at 586.83 kB.
- `pnpm test:docs-i18n` — passed; 10 README locales and 165 English reference
  mirrors found.
- `vitest run packages/render/tests/render.test.ts -t 'honors trim, speed, audio volume, title and crossfade while preserving source bytes'`
  — 1 actual FFmpeg MP4 regression passed (23 cases deselected by the focused
  filter). The test checks resolver source positions at frames 3 and 8 against
  decoded red/black frames and verifies source hash preservation.
- `git diff --check` — passed.

`pnpm test:render-qa` did not complete: its local setup requires the hash-pinned
Noto test-font fixture. `setup-render-qa.ts fonts-only` failed to fetch that
fixture because the environment could not reach GitHub (`ENETUNREACH`). No
un-pinned system-font fallback was used. Hosted checks have not yet run for this
candidate.

## Files

- `packages/core/src/sequence.ts`
- `packages/core/tests/sequence.test.ts`
- `TASKS.md`
- `ROADMAP.md`
- `docs/superpowers/specs/2026-11-06-cut-desk-phase-4b-deterministic-animation-design.md`

## Remaining gates

- Run the full contract suite and repository static/build gates on the exact
  candidate head; inspect any failures rather than treating a skipped lane as a
  pass.
- Run the applicable real FFmpeg regression set and compare existing scalar
  speed output before/after; this slice intends no render change.
- Add the persisted visual contract only with both Monitor and renderer
  consumers, lock/pin/stale-revision command checks, arbitrary seek evidence,
  synthetic MP4 decode comparison, and save/reopen/Undo/Redo browser coverage.
- Keep 4B.3 speed ramps blocked on source-mapped caption/audio/rhythm consumers
  and an explicit audio policy. Do not infer workstation, GPU/4K or target-NLE
  acceptance from automated CI.
