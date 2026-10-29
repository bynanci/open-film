# Direct clip-picture manipulation recovery plan

> Execute with tests first. This is a selective port, not a merge of
> `codex/direct-manipulation-editing`.

**Goal:** Let a General-mode user move and proportionally resize the selected
flat photo/video directly in the existing preview while preserving the current
Composition, geometry, transaction, history, persistence, lock and stale-owner
contracts.

**Review:**
`docs/superpowers/reviews/2026-10-29-direct-manipulation-recovery.md`

## Constraints

- Keep `ClipTransform` and the existing `transform` command unchanged.
- Preview updates are local and ephemeral; pointer-up submits one
  `commitTransaction` request.
- Do not port the old gesture queue or `TimeTrackEditor`.
- Preserve current frame-pixel geometry and preview rounding.
- Cancel on Escape, pointer cancel/loss, window blur, selection/revision/project
  owner change, viewport geometry change or disabling.
- Keep controls keyboard accessible and provide a 44×44 coarse-pointer hit area.
- Do not execute project HTML/JavaScript or alter source media.

## Task 1 — Prove transform interaction math

**Files:**

- Add: `apps/desktop/src/clipTransformInteraction.ts`
- Add: `tests/unit/clip-transform-interaction.test.ts`

- [x] Add failing tests for CSS-pixel movement to frame-pixel translation,
      opposite-corner anchoring under rotation, minimum scale and invalid input.
- [x] Implement the smallest pure functions using the current geometry contract.
- [x] Run the focused unit test.

## Task 2 — Add the accessible ephemeral overlay

**Files:**

- Add: `apps/desktop/src/components/ClipTransformOverlay.vue`
- Modify: editor locale modules for English, Traditional Chinese and Japanese.
- Modify: `apps/desktop/src/editor.css` only for the preview toolbar/container.

- [x] Add component/render-boundary assertions that fail without the overlay,
      labelled controls, cancellation and coarse-pointer target rule.
- [x] Implement move and four proportional corner controls; keep the compact
      visible handle separate from its hit target.
- [x] Add arrow-key fine control, Shift acceleration and Escape cancellation.
- [x] Cancel when the session owner or preview geometry changes.

## Task 3 — Integrate through the current transaction boundary

**Files:**

- Modify: `apps/desktop/src/components/TimelineEditor.vue`
- Modify: `tests/unit/timeline-clip-render-boundary.test.ts`
- Add: `tests/e2e/direct-clip-manipulation.spec.ts`

- [x] Add a failing render-boundary test proving the toggle and overlay use the
      selected clip, current preview geometry and current busy/lock state.
- [x] Add a failing browser regression for one-command move, Escape cancel,
      independent Undo/Redo, lock gating, viewport cancellation and reopen.
- [x] Integrate a preview-only draft into current `clipFields`/preview geometry.
- [x] Submit one full transform command with `commitTransaction`; do not batch
      adjacent gestures or accept a stale owner.
- [x] Disable conflicting controls only while a gesture or its transaction is
      active; unchanged reset/centre actions must not clear redo.

## Task 4 — Verify and hand off

- [x] Run focused unit and browser tests.
- [x] Run format, i18n, docs-i18n, lint, typecheck, complete Vitest, build,
      interchange and complete browser gates available in the environment.
- [x] Run native gates only with their prerequisites; record workstation-only
      pointer/trackpad/high-DPI checks as manual.
- [x] Inspect the final diff against B-01–B-05 and obtain an independent review.
- [ ] Record exact base/head and open a separate PR after the dependency PR is
      merged. Do not merge until exact-head CI is green.
