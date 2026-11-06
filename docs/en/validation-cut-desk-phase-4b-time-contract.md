# Cut Desk Phase 4B.1 — deterministic legacy clip-frame time

Date: 2026-11-06

Replacement clean-base PR: [#125](https://github.com/bynanci/open-film/pull/125)

Base: `9b33249c3bd60872072c55fac4efac43d6d6e13b` (`main`)

Head: `1d8712571139d5654eda6bdbccaaac302a06c5a0`
Status: draft and unmerged; all reported GitHub checks passed on this head.

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
un-pinned system-font fallback was used. Hosted Render QA passed for Linux,
Windows and macOS on PR #125.

## Files

- `packages/core/src/sequence.ts`
- `packages/core/tests/sequence.test.ts`
- `packages/render/tests/render.test.ts`
- `docs/superpowers/specs/2026-11-06-cut-desk-phase-4b-deterministic-animation-design.md`
- `docs/validation-cut-desk-phase-4b-time-contract.md` and its English mirror

## Remaining gates

- Hosted PR #125 checks passed: DCO, fast-contract-check, four browser shards,
  heavy-media-qa, native-shell, Windows recovery, docs-site, Windows FFmpeg 9,
  and Render QA on Linux, Windows and macOS. The full pinned-font Render QA
  remains locally blocked by the font-fixture download network error described
  above.
- The focused actual FFmpeg regression confirms unchanged scalar-speed frame
  mapping; the complete renderer/media suite has not been run locally.
- Add the persisted visual contract only with both Monitor and renderer
  consumers, lock/pin/stale-revision command checks, arbitrary seek evidence,
  synthetic MP4 decode comparison, and save/reopen/Undo/Redo browser coverage.
- Keep 4B.3 speed ramps blocked on source-mapped caption/audio/rhythm consumers
  and an explicit audio policy. Do not infer workstation, GPU/4K or target-NLE
  acceptance from automated CI.

## Follow-on implementation

The visual keyframe slice is being developed on a separate stacked branch.
Its current code, local checks and outstanding end-to-end/hosted gates are
recorded in `docs/validation-cut-desk-phase-4b-visual-keyframes.md`.
