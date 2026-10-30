# D3A1 Sequence waveform implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show bounded current source peaks in the saved Record sequence clock.

**Architecture:** Core projection shares source/frame resolvers and bin rounding.
Existing application cache provides waveform-only reads. A derived Record view
uses guarded seek and existing local analysis jobs, never a second timeline.

**Tech Stack:** Existing Vue3, TypeScript, FFmpeg, Vitest and Playwright.

**Spec:** [D3A1 design](../specs/2026-10-30-d3a1-sequence-waveforms-design.md).

## Global constraints

- No dependencies, new extractor, timeline or project/catalog schema.
- Preserve locks/pins, source bytes, Composition, history/autosave/reopen.
- No private fixtures, providers, remote URL or project JS/HTML execution.
- Keep complete CI gates; stable remains0.4.0 until release criteria are met.

## Review focus

- Source duration shorter than clip duration must yield silence, not a held peak.
- Half-open rational clip boundaries must not leak a peak into the next edit.
- Delayed source/project reads must never repopulate a newer context.
- Repeated assets must share bounded cached evidence without per-frame requests.
- Missing/foreign jobs cannot be cancelled by this overview's preparation controls.

## Task1 — Shared projection and waveform-only read

Files: `packages/core/src/sequence-waveform.ts`, core exports/tests;
`apps/desktop/src/waveform.ts`; application intelligence and tests;
`apps/server/src/server.ts`, Desktop API and HTTP regression.

Interfaces: `waveformPeakBetween(wave,start,end)` shares bin math;
`projectClipWaveform(input)` returns peaks/coverage. Intelligence
`readWaveforms(assetIds)` returns bounded current waveform evidence; HTTP fences
the project before/after awaits. No transcript hydration.

- [ ] Write literal failing projection tests, observe RED, implement and prove GREEN.
- [ ] Write failing waveform-only/bounds/source/hash tests, then implement shared read.
- [ ] Verify existing Source geometry, source cache and HTTP project-switch behavior.
- [ ] Commit passing contract/application changes.

## Task2 — Record overview and preparation

Files: `SequenceWaveform.vue`, bounded loader helper/composable,
`TimelineEditor.vue`, existing three-locale Cut Desk messages, unit/browser tests.

- [ ] Test bounded cache/read generations and cancellation before implementation.
- [ ] Add derived per-track view, frame viewport, seek and explicit preparation.
- [ ] Exercise real browser seek, locks/history, context races and responsive/CJK.
- [ ] Commit working view and regressions.

## Task3 — Media evidence and reviewed delivery

Files: synthetic FFmpeg regression, `TASKS.md`, `ROADMAP.md`, mirrored validation,
v1 readiness crosswalk linking existing owners without duplicate feature checkboxes.

- [ ] Render/decode actual pulse-source MP4 and verify projected time/hash evidence.
- [ ] Execute format/i18n/docs/lint/types/fullunit/build/browser/interchange gates;
      native on equipped hosted CI. Coordinate fixed local ports across worktrees.
- [ ] One fresh whole-branch review; one regression-backed Important/Critical fix pass.
- [ ] Publish one coherent PR, require exact candidate CI, then merge under existing
      authorization and record exact base/head/main proof. Continue next roadmap owner.
