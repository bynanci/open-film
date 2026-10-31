# D4 Transcript-Driven Ripple Editing — Validation

Date: 2026-10-31.
Capability: Reliable-timing-only transcript ripple editing through an application-level compound operation with typed cross-track retime and conflict policies.

## Key Invariants and Contracts

1. **Reliable Timing Only (Fail-Closed)**:
   - Evaluates transcript segment boundaries before proposing or applying ripple operations.
   - Any segment with `timingSource: "estimated"` or `alignmentState: "text-edited"` without verified boundary timing immediately fails closed with `transcript.unreliableTiming` (HTTP 422).
   - No guesswork, proportional approximation, or inaccurate trimming is applied.

2. **Atomic Cross-Track Retiming**:
   - Executes a single, coordinated compound edit across:
     - Primary / visual clips (splitting or trimming in accordance with speech ranges).
     - Native caption tracks (deleting cues falling within cut ranges, and retiming subsequent cues by exact integer milliseconds).
     - Graphic scenes (deleting or retiming scene intervals).
     - Overlay audio tracks (trimming or retiming independent sound and B-roll overlays).
     - Continuous narration coverage bindings (re-deriving coverage bindings deterministically via `resolveCompositionCoverageBindings`).
   - Maintains exact audio, video, and SRT/VTT subtitle synchronization.

3. **Single History Revision**:
   - The entire compound edit produces exactly one undo record in `TimelineEditorState`.
   - A single `undo()` call returns all tracks, cues, graphics, and audio to their exact pre-edit state.
   - `redo()` cleanly restores the ripple-edited cut.

4. **Conflict Rejection**:
   - If any affected clip or source asset is locked, the operation fails closed with `timeline.lockedClipConflict` (HTTP 409).
   - If user pins cannot be satisfied, the operation fails closed with `timeline.pinConflict` (HTTP 409).

## Test Evidence

- `packages/core/tests/transcript-ripple.test.ts` (7/7 passed):
  - Valid proposal generation for verified transcript segments.
  - Fail-closed on estimated timing.
  - Fail-closed on unverified text-edited alignment.
  - Fail-closed on missing segments.
  - Fail-closed on locked clips.
  - Atomic ripple delete across video, captions, audio, and graphics.
  - Keep mode support (deleting all content outside the selected speech bounds).
- `packages/application/tests/transcript-ripple-editor.test.ts` (3/3 passed):
  - End-to-end integration with `TranscriptEditor` and `TimelineEditor`.
  - Atomic ripple delete execution with timeline duration reduction, video split, caption cue retiming, and single undo/redo step.
  - Fail-closed behavior verifying that invalid timing or locked clips leave the composition untouched.
