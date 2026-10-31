# D2B Adjacent Scene Micro-Preview and Dip Transitions — Validation

Date: 2026-10-31.
Capability: Bounded adjacent scene micro-preview, Dip-to-Black and Dip-to-White transition support, preview-to-render parity, single-step atomic application, and fail-closed stale proposal protection.

## Key Invariants and Contracts

1. **Bounded Adjacent Scene Micro-Preview**:
   - Focuses on a bounded window around the target cut point: maximum 2.0s before cut (`MICRO_PREVIEW_PRE_CUT_MAX`), maximum 3.0s after cut (`MICRO_PREVIEW_POST_CUT_MAX`), and maximum 5.0s total duration (`MICRO_PREVIEW_MAX_DURATION`).
   - Proposals carry a base revision hash (`baseRevision`) and deterministic candidate ID (`SceneMicroPreviewProposal`).
   - Preview operations are evaluated purely in memory, never prematurely mutating the saved project timeline.

2. **Dip-to-Black and Dip-to-White Transition Model**:
   - Follows the existing transition contract: duration $D \le \text{timelineDuration}$, incoming clip positioned at timeline start $T$.
   - Outgoing clip extends by tail $D/2$.
   - First half of transition ($0 \le \Delta < D/2$): Outgoing clip is primary, black/white overlay fades in to 100% opacity ($opacity = 2\Delta / D$).
   - Midpoint of transition ($\Delta = D/2$): Black/white overlay reaches 100% full black or full white.
   - Second half of transition ($D/2 \le \Delta \le D$): Incoming clip is primary, black/white overlay fades out from 100% to 0% ($opacity = 2(1 - \Delta / D)$).
   - `resolveCompositionFrame` produces `transitionOverlay` (`color: "black" | "white"`, `opacity: number`), rendered via hardware-accelerated `.record-dip-overlay` in `RecordMonitor.vue`; symmetrical fade-in/fade-out color filters in the FFmpeg render pipeline achieve pixel-level parity between preview and export output.

3. **Stale Proposal and Conflict Protection**:
   - When project stories or timeline structure change, their revision hash updates immediately.
   - If an operator attempts to seek or apply an expired micro-preview proposal, the system fails closed, rejecting the operation with `microPreview.staleProposal` (HTTP 409).

4. **Single Atomic Undoable History Step**:
   - Applying a candidate micro-preview transition to the timeline generates a single history record. An operator needs only a single Undo operation to return to the original cut state.

## Test Evidence

- `packages/core/tests/micro-preview.test.ts` (7/7 passed):
  - Valid proposal structure, bounded constants, and validators.
  - Fail-closed validation for bounds exceeding limits (> 2s pre, > 3s post, > 5s total).
  - Proper rejection of invalid transition types and non-positive durations.
  - Sequence frame resolution supporting `dip-to-black` and `dip-to-white`.
- `packages/solver/tests/micro-preview.test.ts` (7/7 passed):
  - Micro-preview proposal generation with deterministic hashing.
  - Outgoing clip edge checks and non-adjacent clip rejection.
  - Frame sampling: pre-cut, first half, midpoint (100% black/white overlay), second half, and post-cut behavior.
- `packages/application/tests/micro-preview-service.test.ts` (5/5 passed):
  - Proposal creation without modifying saved project.
  - Accurate frame seeking with overlay evaluation.
  - Single atomic history step application and single-undo recovery.
  - Fail-closed stale proposal rejection upon timeline modifications (HTTP 409).
  - Ephemeral cancellation and cache clearance.
- `packages/render/tests/dip-transitions.test.ts` (2/2 passed):
  - `dip-to-black` FFmpeg rendering: Outgoing video maintained in first half, midpoint reaches solid black (RGB < 35), transitions into incoming video.
  - `dip-to-white` FFmpeg rendering: Outgoing video maintained in first half, midpoint reaches solid white (RGB > 200), transitions into incoming video.
