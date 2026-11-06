# Cut Desk Phase 4B.2 — visual keyframes

Date: 2026-11-06
Base: main at [`7add4762fe8174d76f43b863375ea39b73121e76`](https://github.com/bynanci/open-film/commit/7add4762fe8174d76f43b863375ea39b73121e76), which includes the merged Phase 4B.1 contract from PR #125.
Implementation: [draft PR #126](https://github.com/bynanci/open-film/pull/126).
Pre-sync candidate head: `e6eed6360b1a94c03e1becdd90f1c6bcd02edd48`; the code
was last changed at `e7fb5ec4d9e5ff97454038f853ac04163eb94540`.
Current branch has been synchronized with main; its new exact head requires a
fresh full hosted validation before merge.

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
  uses a fixed composition canvas, and position/opacity stay on frame-evaluated
  filters. Source files remain read-only.
- Split and trim operate on integer project frames, preserve seam values and
  rebase the right side. Audio timing and automation are not changed.

## Local evidence

These local results were collected on the pre-sync code candidate, not on the
new synchronized head:

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

## Hosted evidence before base synchronization

On the previous exact head `e6eed6360b1a94c03e1becdd90f1c6bcd02edd48`,
Verify run [42295543183](https://github.com/bynanci/open-film/actions/runs/42295543183)
passed fast-contract, all four browser shards, heavy-media, native-shell and
docs-site. Three-platform Render QA passed in
[run 42295543273](https://github.com/bynanci/open-film/actions/runs/42295543273),
Windows FFmpeg 9 passed in
[run 42295543169](https://github.com/bynanci/open-film/actions/runs/42295543169),
and DCO passed in
[run 42295539680](https://github.com/bynanci/open-film/actions/runs/42295539680).
These results predate the current main synchronization and do not validate the
new head. Fresh full exact-head CI is required.

## Known limits and remaining gates

- This slice supports visual `x`, `y`, `scale`, `rotation` and `opacity` only.
  Native NLE keyframe interchange is not claimed.
- 4B.3 forward speed ramps remain unimplemented. No audio retiming policy or
  audio behavior is inferred by this visual slice.
- Current synchronized head must pass fast-contract, all six browser shards,
  heavy-media, native-shell, Render QA and Windows FFmpeg 9 before merge.
- No Windows/macOS workstation, GPU/4K, Resolve or listening evidence was
  collected for this candidate.
- The generic local Render QA harness requires a pinned Noto fixture that this
  environment could not download; the focused synthetic animation MP4 regression
  did run locally.
