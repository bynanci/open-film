# Cut Desk Phase 4B.2 — visual keyframes

Date: 2026-11-06
Base: main at [`7add4762fe8174d76f43b863375ea39b73121e76`](https://github.com/bynanci/open-film/commit/7add4762fe8174d76f43b863375ea39b73121e76), which includes the merged Phase 4B.1 contract from PR #125.
Implementation: [draft PR #126](https://github.com/bynanci/open-film/pull/126).
The feature branch contains initial implementation `e7fb5ec4d9e5ff97454038f853ac04163eb94540`,
was synchronized with main at `7555b312a224fbbbedeaf14a639f354a266c1849`, and
was last refreshed before this optimization at `34a425cbb4b8ab1b239cfb2b43833bc953961e5c`.
The opacity optimization and single-key seek fix are included in the current
PR candidate; use the PR for the final exact head and hosted checks.

## Shared state flow

- `ClipAnimationV1` is bounded declarative JSON under project schema 1.4.0.
  Unknown properties, fields, accessors, sparse arrays, duplicate tracks,
  unbounded values, out-of-range frame offsets and malformed easing fail closed.
- The Inspector creates an ephemeral preview only. Accepting a key writes one
  typed `clip.animation.set` command through the existing timeline transaction,
  revision check, lock checks, pin policy, save queue and Undo/Redo history.
- `RecordMonitor` resolves the preview using the same arbitrary-frame sequence
  contract as the saved clip. Preview updates do not mutate the saved
  Composition or media identity.
- FFmpeg consumes only validated numeric tracks. The per-frame path is bounded
  to the composition frame; animated scale uses fixed-size `zoompan`, rotation
  uses a fixed composition canvas, and position stays on a frame-evaluated
  filter. Source files remain read-only.
- Opacity is compiled from the shared frame evaluator into bounded `sendcmd`
  updates for one `colorchannelmixer` instance per clip. The mixer multiplies
  the alpha already produced by existing transitions. A render is rejected if
  all opacity tracks together need more than 300,000 evaluated output frames or
  8 MiB of serialized opacity filters. Core key lookup uses binary search, and
  cubic-Bezier evaluation runs once per animated frame rather than once per
  pixel.
- Split and trim operate on integer project frames, preserve seam values and
  rebase the right side. Audio timing and automation are not changed.

## Local evidence

Latest local checks on the opacity-optimized worktree:

- Focused core/render/solver animation regressions — 4 files, 37 tests passed,
  including stable evaluation after seeking past a single key.
- `pnpm test:contracts` — 81 files, 1,548 tests passed.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` and
  `pnpm test:docs-i18n` — passed. The build reports the existing large
  `TimelineEditor` chunk advisory.
- `tests/e2e/direct-clip-manipulation.spec.ts` — all 6 tests passed, including
  the seek-at-frame-48 keyframe save/Undo/Redo/reopen workflow.
- The real synthetic MP4 regression decodes first, middle and last opacity
  samples and compares them against the shared composition-frame evaluator;
  source SHA-256, geometry and dimensions remain asserted.

After syncing with main at `7555b312a224fbbbedeaf14a639f354a266c1849`, the
following checks passed before a documentation-only refresh:

- `pnpm format:check`, `pnpm typecheck`, and `pnpm test:contracts` — 81 files,
  1,547 tests.
- `pnpm test:i18n` — 3,252 semantic keys; `pnpm test:docs-i18n` — 172 English
  reference mirrors.

These local results were collected on the pre-sync code candidate, not on the
initial synchronized head. The animation implementation was unchanged after
those checks; the following broader results are from the earlier code candidate:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` — passed.
  Build retains the existing `TimelineEditor` chunk-size advisory.
- `pnpm test:contracts` — 80 files and 1,523 tests passed.
- `pnpm test` — 455 files and 5,938 tests passed in 565.04 seconds on candidate
  `e7fb5ec4d9e5ff97454038f853ac04163eb94540`.
- `pnpm test:ci-partition` — passed; 455 files partitioned into 80 contract
  files and 375 media files.
- The pre-sync browser partition covered 358 tests across four shards (90, 93,
  87 and 88). This verifies partition assignment, not browser execution.
- `pnpm test:i18n` — passed, 3,232 semantic keys across English, Traditional
  Chinese and Japanese. `pnpm test:docs-i18n` — passed, 10 README locales and
  171 English mirrors.
- Editor application tests passed 21 cases, including schema 1.4 save/reopen
  and malformed animation rejection.
- Real synthetic MP4 regression decoded position, opacity, cubic-Bezier scale,
  rotation and output dimensions; it verified the original source SHA-256 stayed
  unchanged. A second FFmpeg regression rendered three eight-key cubic tracks
  through the version-aware private filter-graph file path, decoded all eight
  frames and verified the source SHA-256.
- Record Monitor transient preview test passed while confirming the saved
  Composition and existing media resource remain unchanged.
- `tests/e2e/direct-clip-manipulation.spec.ts` passed all 6 focused cases,
  including keyframe save/reopen, Undo/Redo, rejected-write recovery, lock
  handling and touch sizing.
- Local `pnpm test:render-qa` could not fetch the pinned Noto fixture
  (`ENETUNREACH`); no system-font fallback was used.

## Opacity filter performance evidence

On FFmpeg 7.1.5 Linux x64, the old per-pixel `geq` opacity graph and the new
frame-command graph were run against the same synthetic `testsrc2` input at
320×180, 30 fps, 90 frames, one filter-complex thread, with output sent to the
null muxer. FFmpeg reported 24.642 s for `geq` and 0.050 s for `sendcmd` plus
`colorchannelmixer` (about 493× faster for this filter-only workload; process
maximum RSS was 43,888 KiB in both runs). This isolates the opacity filter cost;
it is not a full export or encoder-throughput benchmark. The actual-render
regression separately decodes the synthetic MP4 and checks opacity samples,
geometry, dimensions and the unchanged source hash. A 300,000-frame cubic
compiler stress request was rejected at the 8 MiB serialized-filter cap in
134 ms; the Node process RSS grew by about 37 MiB during that bounded compile.

## Hosted evidence and current correction

Before the opacity optimization, synchronized head
`34a425cbb4b8ab1b239cfb2b43833bc953961e5c` passed [Verify](https://github.com/bynanci/open-film/actions/runs/42311325261)
(fast-contract, six browser shards, heavy-media, native-shell and docs-site),
[three-platform Render QA](https://github.com/bynanci/open-film/actions/runs/42311325302),
[Windows FFmpeg 9 recovery](https://github.com/bynanci/open-film/actions/runs/42311325419)
and [DCO](https://github.com/bynanci/open-film/actions/runs/42311322996). Those
checks do not cover the later opacity optimization.

On optimization head `062c38710ae7fe534594a710f762b840a6692640`,
[Verify](https://github.com/bynanci/open-film/actions/runs/42315174439) passed
fast-contract, native-shell, docs-site and browser shards 2–6. Browser shard 1
exposed a reproducible single-key seek failure at frame 48. The root cause was
binary-search lookup past a one-key track; the fix now returns the final value
before searching for an interval, with a focused regression test and all six
local direct-clip browser tests passing. Render QA Windows/macOS and Windows
FFmpeg 9 passed on that pre-fix head; Linux Render QA and heavy-media were still
running. All hosted checks must complete successfully on the final pushed PR
head before merge.

## Known limits and remaining gates

- This slice supports visual `x`, `y`, `scale`, `rotation` and `opacity` only.
  Native NLE keyframe interchange is not claimed.
- 4B.3 forward speed ramps remain unimplemented. No audio retiming policy or
  audio behavior is inferred by this visual slice.
- The current PR head must pass fast-contract, all six browser shards,
  heavy-media, native-shell, Render QA and Windows FFmpeg 9 before merge.
- No Windows/macOS workstation, GPU/4K, Resolve or listening evidence was
  collected for this candidate.
- The generic local Render QA harness requires a pinned Noto fixture that this
  environment could not download; the focused synthetic animation MP4 regression
  did run locally.
