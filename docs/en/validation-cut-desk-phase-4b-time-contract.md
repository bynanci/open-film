# Cut Desk Phase 4B.1 — deterministic legacy clip-frame time

Date: 2026-11-06
Implementation: [PR #125](https://github.com/bynanci/open-film/pull/125), merged
in main at [`7add4762fe8174d76f43b863375ea39b73121e76`](https://github.com/bynanci/open-film/commit/7add4762fe8174d76f43b863375ea39b73121e76).
Code-validation head: `1d8712571139d5654eda6bdbccaaac302a06c5a0`; final PR head with
refreshed evidence: `1e58038d1bb933956290a0d275eef2c5f2ae7aa0`.
The implementation was developed against main at
`9b33249c3bd60872072c55fac4efac43d6d6e13b`; PR #125's hosted verification below
passed on its exact final head before merge.

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
  Build reports the existing `TimelineEditor` chunk-size advisory at 590.14 kB.
- `pnpm test:docs-i18n` — passed; 10 README locales and 170 English reference
  mirrors found.
- `vitest run packages/render/tests/render.test.ts -t 'honors trim, speed, audio volume, title and crossfade while preserving source bytes'`
  — 1 actual FFmpeg MP4 regression passed (23 cases deselected by the focused
  filter). It checks resolver source positions at frames 3 and 8 against decoded
  red/black frames and verifies source hash preservation.
- `git diff --check` — passed.

`pnpm test:render-qa` did not complete locally: setup requires the hash-pinned
Noto test-font fixture, and `setup-render-qa.ts fonts-only` could not fetch it
because the environment could not reach GitHub (`ENETUNREACH`). No unpinned
system-font fallback was used. Hosted Render QA passed for Linux, Windows and
macOS on the final PR #125 head.

## Files

- `packages/core/src/sequence.ts`
- `packages/core/tests/sequence.test.ts`
- `packages/render/tests/render.test.ts`
- `docs/superpowers/specs/2026-11-06-cut-desk-phase-4b-deterministic-animation-design.md`
- `docs/validation-cut-desk-phase-4b-time-contract.md` and its English mirror

## Remaining gates

- Final PR #125 head `1e58038d1bb933956290a0d275eef2c5f2ae7aa0` passed DCO
  ([run 42305593855](https://github.com/bynanci/open-film/actions/runs/42305593855)),
  Verify fast-contract, all four browser shards, heavy-media, native-shell and
  docs-site
  ([run 42305596300](https://github.com/bynanci/open-film/actions/runs/42305596300)),
  three-platform Render QA
  ([run 42305596301](https://github.com/bynanci/open-film/actions/runs/42305596301)),
  and Windows FFmpeg 9
  ([run 42305596411](https://github.com/bynanci/open-film/actions/runs/42305596411)).
  Native-shell completed in 29m42s. The complete renderer/media suite was not
  run locally; hosted heavy-media QA passed.
- The focused actual FFmpeg regression confirms unchanged scalar-speed frame
  mapping and source-hash preservation. Local pinned-font Render QA remains
  blocked by the network error described above.
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
