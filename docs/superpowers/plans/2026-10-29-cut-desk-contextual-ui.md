# Cut Desk contextual UI implementation plan

**Goal:** Connect story intent to the current Record/Source decision while adding
a reversible effective-look comparison, without another timeline or saved state.

**Design:**
`docs/superpowers/specs/2026-10-26-professional-cut-desk-design.md`

## Task 1 — Prove the missing presentation contracts

- [x] Add a failing component test for Sequence/Beat/Clip/Source, two clocks,
      protection, snap applicability and current action.
- [x] Add failing Record tests for video/photo effective-look bypass that retain
      media identity and saved Composition bytes.
- [x] Add a failing Timeline integration test for owner-fenced held/latched state.

## Task 2 — Add the Edit Decision Ribbon

- [x] Derive Record context from `resolveCompositionFrame` at the Record frame.
- [x] Derive Source context from the selected clip and existing Precision owner.
- [x] Expose the existing Precision snap preference; label Record snapping not
      applicable rather than inventing an active snap mode.
- [x] Use existing semantic tokens, tabular time, textual states, CJK-safe reflow
      and no additional timeline/rail/project contract.

## Task 3 — Add transient film-look comparison

- [x] Bypass current Record visual filters through a presentation-only prop.
- [x] Support pointer and keyboard hold plus an explicit latched control.
- [x] Clear held state on release/cancel/loss/blur/visibility and clear all state
      on Escape or project/revision/target/active-source changes.
- [x] Keep bypass out of resource ownership, renderer options, history and saves.

## Task 4 — Verify and hand off

- [x] Run focused unit, actual look/FFmpeg and workspace browser regressions.
- [x] Inspect 1,920px English and Traditional Chinese screenshots and correct
      monitor-space/contrast defects.
- [x] Run the complete local gate matrix and independent final review.
- [ ] Rebase onto the merged dependency, record exact base/head, open a separate
      PR and merge only after exact-head hosted CI succeeds.
