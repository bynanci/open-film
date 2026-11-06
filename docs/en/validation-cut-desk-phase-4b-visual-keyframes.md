# Cut Desk Phase 4B.2 — visual keyframes

Date: 2026-11-06

Base: draft PR #125 head `1d8712571139d5654eda6bdbccaaac302a06c5a0`

The stacked base's current checks were re-read on 2026-11-06: DCO, fast
contracts, four browser shards, heavy media QA, native shell, docs, Windows
FFmpeg 9 and Linux/Windows/macOS Render QA all passed. See [Verify
run 42272171346](https://github.com/bynanci/open-film/actions/runs/42272171346)
and [Render QA run
42272171341](https://github.com/bynanci/open-film/actions/runs/42272171341).

Branch: `codex/cut-desk-phase-4b-visual-keyframes-main` (stacked; local candidate)

Status: [draft PR #126](https://github.com/bynanci/open-film/pull/126); CI
pending and unmerged.

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

- `pnpm typecheck` — passed after UI, command, schema and renderer integration.
- `pnpm test:interchange` — passed, 18 tests; parser reports source hashes and
  bounds passed. Resolve import remains unverified.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` — passed.
  The build retains the existing warning that the `TimelineEditor` chunk is
  over 500 kB after minification.
- `pnpm test:contracts` — passed, 80 files and 1,523 tests.
- `pnpm test` — passed, 454 files and 5,934 tests (full Vitest suite).
- `pnpm test:ci-partition` — passed; verified 454 tests partition into 80
  contract files and 374 media files.
- `pnpm test:browser-partition` — passed; verified all 358 browser tests are
  assigned across four shards (90, 93, 87 and 88). This checks partitioning,
  not browser execution.
- `pnpm test:i18n` — passed, 3,232 semantic keys matched in English, Traditional
  Chinese and Japanese.
- `pnpm test:docs-i18n` — passed; 10 README locales and 171 English mirrors.
- `pnpm exec vitest run packages/application/tests/editor.test.ts` — passed,
  21 tests, including schema 1.4 save/reopen and malformed animation rejection.
- `vitest run packages/render/tests/render.test.ts -t 'renders deterministic
clip keyframes'` — passed with a real synthetic MP4. Decoded frames verify
  clip-local position, opacity, cubic-Bezier scale, rotation, output dimensions
  and unchanged source SHA-256.
- `vitest run tests/unit/record-monitor.test.ts -t 'previews transient clip
keyframes'` — passed; the held-frame preview updates while preserving the
  saved Composition and existing media resource.
- Solver tests cover typed keyframe edits, lock rejection, pin marking, exact
  split and trim frame preservation. Core tests cover strict schema, frame
  bounds, schema promotion and arbitrary seek order.
- `pnpm exec playwright test tests/e2e/direct-clip-manipulation.spec.ts --grep
'edits clip keyframes' --workers=1` — passed, 1 test, including durable save,
  two Undo/Redo steps, reopen, and unchanged original media.
- `pnpm exec playwright test tests/e2e/direct-clip-manipulation.spec.ts
--workers=1` — passed, all 6 tests, including keyframe save/reopen, direct
  manipulation undo, rejected-write recovery, lock handling and touch sizing.
- The full repository browser suite has not yet completed on this candidate;
  the four browser shards will run in hosted Verify for the stacked PR.

## Known limits and remaining gates

- This slice supports visual `x`, `y`, `scale`, `rotation` and `opacity` only.
  Native NLE keyframe interchange is not claimed.
- 4B.3 forward speed ramps remain unimplemented. No audio retiming policy or
  audio behavior is inferred by this visual slice.
- The stacked browser and hosted Verify checks remain required before marking
  this implementation candidate validated. The existing #125 time-contract PR
  is still draft and unmerged.
- No Windows/macOS workstation, GPU/4K, Resolve or listening evidence was
  collected for this candidate.
- The generic local Render QA harness requires a pinned Noto fixture that this
  environment could not download (`ENETUNREACH`); no system-font fallback was
  substituted. The focused synthetic animation MP4 regression did run locally.
