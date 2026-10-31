# Professional Cut Desk Phase 2 Edit Semantics — Validation

Date: 2026-10-31.
Capability: Professional edit semantics (Roll, Slip, Slide, Insert, Overwrite, Lift, Batch) operating strictly on the single authoritative `Composition` without introducing a secondary timeline engine or phantom track state.

## Key Invariants and Contracts

1. **Roll Edit Semantics**:
   - Modifies the cut point between two adjacent clips on the same track.
   - **Duration Invariant**: $\text{duration}(A) + \text{duration}(B) = \text{constant}$.
   - **Sequence Invariant**: Total sequence duration is strictly invariant. Downstream clips do not ripple or shift.
   - **Boundary Constraints**:
     - Preceding clip ($A$): $0 < \text{duration}(A) + \delta \le \text{mediaDuration}(A) - \text{sourceIn}(A)$.
     - Succeeding clip ($B$): $0 \le \text{sourceIn}(B) - \delta \le \text{mediaDuration}(B) - \text{duration}(B) - \delta$.
   - **Lock Enforcement**: Rejects roll if either clip or track is locked.
   - **Audio Automation**: Audio keyframes are constrained and preserved within the adjusted clip boundaries.

2. **Slip Edit Semantics**:
   - Shifts the media source in-point and out-point without moving the clip on the timeline or altering its timeline duration.
   - **Placement Invariant**: $\text{timelineStart}$ and $\text{timelineDuration}$ are strictly constant.
   - **Media Boundary Constraints**: $0 \le \text{sourceIn} + \delta$ and $\text{sourceOut} + \delta \le \text{mediaDuration}$.
   - **Lock Enforcement**: Rejects slip if clip or track is locked.

3. **Slide Edit Semantics**:
   - Shifts a middle clip earlier or later in the timeline while adjusting its adjacent preceding ($P$) and following ($F$) neighbours.
   - **Middle Clip Invariant**: $\text{duration}(C)$, $\text{sourceIn}(C)$, and $\text{sourceOut}(C)$ remain strictly unchanged.
   - **Adjacent Duration Invariant**: $\text{duration}(P) + \text{duration}(C) + \text{duration}(F) = \text{constant}$.
   - **Downstream Invariant**: Clips beyond $F$ are unaffected and do not move.
   - **Boundary Constraints**: Enforces media boundaries and positive duration ($\ge 1$) on both $P$ and $F$.

4. **Insert Edit Semantics**:
   - Inserts media at the target timeline time point on the specified track.
   - If placed within an existing clip, cleanly splits the clip into left and right pieces at the insertion point.
   - **Ripple Invariant**: All downstream clips on the track ($\text{timelineStart} \ge \text{targetTime}$) are rippled forward by the inserted duration.
   - **Composition Invariant**: Composition duration expands to accommodate the inserted material.
   - Keyboard mapping: `,` (comma) in Record monitor or Story edit mode.

5. **Overwrite Edit Semantics**:
   - Places media across interval $[\text{timelineStart}, \text{timelineStart} + \text{duration}]$ on the target track.
   - Trims or splits existing overlapping clips to make room for the new media.
   - **No-Ripple Invariant**: Downstream clips outside the overwrite interval do not move.
   - Keyboard mapping: `.` (period) in Record monitor or Story edit mode.

6. **Lift Edit Semantics**:
   - Removes a clip from the track, leaving an empty gap on the timeline.
   - **No-Ripple Invariant**: Downstream clips do not move (contrasting with Ripple Delete).
   - Keyboard mapping: `;` (semicolon) in Record monitor or Story edit mode.

7. **Batch Edit & Atomic Transaction**:
   - Sequentially executes an array of `TimelineCommand` operations in a single atomic transaction.
   - Fully supports atomic rollback and session Undo/Redo.

8. **Strict Single Timeline Model**:
   - All professional editing operations run directly against the authoritative `Composition` data model.
   - No phantom timeline or parallel state engine is introduced.

## Test Evidence

- `packages/solver/tests/pro-edit-semantics.test.ts` (25/25 passed):
  - Validates roll forward/backward, zero delta no-op, lock rejection, non-adjacent clip rejection, and media boundary guards.
  - Validates slip forward/backward, source media limits, and lock rejection.
  - Validates slide earlier/later, neighbour adjustment, non-adjacent rejection, and media limits.
  - Validates insert at start, middle (split), append, downstream ripple, and duration expansion.
  - Validates overwrite middle, overwrite spanning multiple clips, and non-ripple preservation.
  - Validates lift gap creation and downstream position stability.
  - Validates batch command execution.
- `packages/solver/tests/editing.test.ts` (61/61 passed).
- `pnpm test:contracts` (73/73 test files, 1427/1427 passed).
- `pnpm typecheck` (0 errors).
- Multi-locale parity across `en-US`, `zh-TW`, and `ja-JP` for all Cut Desk edit shortcut labels and tooltips.
