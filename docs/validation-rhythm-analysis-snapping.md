# D3A2 Rhythm Analysis and Cut-Point Snapping — Validation

Date: 2026-10-31.
Capability: Source-hash-bound onset, downbeat, and phrase evidence, sequence timeline projection with trim/speed/source-range mapping, bounded solver snap proposals with deterministic tiebreaking, explicit user acceptance, and fail-closed source/revision invalidation.

## Key Invariants and Contracts

1. **Source-Hash-Bound Rhythm Analysis Evidence**:
   - `RhythmAnalysisEvidence` version 1 requires `assetId`, 64-character hex `sourceHash` (bound to media asset `contentHash`), `reliability` score (0 to 1), optional musical metrics (`tempoBpm`, `meterNumerator`, `meterDenominator`), and sorted `landmarks`.
   - Landmarks carry `time` (seconds in source media), `kind` (`"onset" | "downbeat" | "phrase"`), `confidence` (0 to 1), and `strength` (0 to 1).
   - If the media asset's `contentHash` changes, the evidence is immediately invalidated; projection fails closed with `rhythm.sourceMismatch`.

2. **Accurate Timeline Mapping under Speed and Trims**:
   - Projects source landmarks into timeline sequence time:
     $t_{\text{timeline}} = \text{clip.timelineStart} + (t_{\text{source}} - \text{sourceIn}) / \text{speed}$.
   - Only landmarks falling within the active trim range $[sourceIn, sourceOut]$ are mapped.
   - Preserves single timeline model; does not introduce any secondary timeline engine.

3. **Explicit Bounded Snap Proposal**:
   - `RhythmSnapProposal` evaluates a requested position with bounded search tolerance (default 0.25s, maximum 0.5s).
   - If bypass is requested (e.g., operator holds Alt key or opts out of snapping), the proposal retains the requested position with `bypassed: true`, `delta: 0`, and `targetLandmark: undefined`.
   - Nearest landmark within tolerance is selected. When multiple candidates are equidistant, deterministic tiebreakers resolve the conflict:
     1. Highest kind priority (`phrase` > `downbeat` > `onset`).
     2. Highest confidence.
     3. Highest strength.
     4. Earlier timeline time.

4. **Explicit User Acceptance and Atomic History**:
   - Analysis and proposal generation are read-only and never modify the active timeline automatically.
   - An edit is committed only upon explicit acceptance via `RhythmService.applySnap` or `TimelineEditor.edit({ commands: [{ type: "rhythm.snap", proposal }] })`.
   - Rejects stale proposals if the composition revision changes between proposal generation and acceptance (`rhythm.staleProposal`).
   - Generates exactly one atomic undo step in the timeline history.

## Test Evidence

- `packages/core/tests/rhythm.test.ts` (3/3 passed):
  - Validates landmark structures, confidence, strength, and non-negative timestamps.
  - Validates rhythm analysis evidence, sourceHash 64-hex requirement, and sorted landmark assertion.
  - Validates snap proposals, edge modes (`in`, `out`, `cut`), and bounded tolerance ($\le 0.5$s).
- `packages/solver/tests/rhythm.test.ts` (5/5 passed):
  - Landmark projection with trim boundary filtering and speed scaling.
  - Fail-closed validation on contentHash mismatch (`rhythm.sourceMismatch`).
  - Nearest landmark selection, tolerance bounds, bypass flag, and multi-factor tiebreaking.
  - Atomic cut-point split and duration conservation.
  - Trim out-point adjustment and stale proposal rejection (`rhythm.staleProposal`).
- `packages/application/tests/rhythm-service.test.ts` (5/5 passed):
  - Evidence caching and retrieval by assetId and sourceHash.
  - Timeline landmark lookup for clips.
  - Proposing snap with cut-point calculation.
  - Atomic application through `TimelineEditor` with complete Undo and Redo parity.
  - Explicit bypass mode verification.
- `vitest.contract.config.ts` (72/72 files, 1402/1402 passed).
