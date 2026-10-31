# D2A Continuity Diagnostics and Emotional Guidance — Validation

Date: 2026-10-31.
Capability: Deterministic continuity diagnostics across adjacent scenes, emotional guidance advisories, and human override receipts with strict cryptographic auditability.

## Key Invariants and Contracts

1. **Adjacent Scene Continuity Analysis**:
   - Evaluates motion vectors, camera motion, shot scale, duration, and visual density across adjacent scene boundaries.
   - Flags jarring motion clashes (such as opposing camera pans without visual buffers) as `CONTINUITY_MOTION_CLASH` with severity `advisory` or `warning`.
   - Flags sudden pacing disruptions (scene duration ratios >= 3.5x) as `CONTINUITY_PACING_MISMATCH`.
   - Flags abrupt visual complexity changes (visual density ratio >= 3.0x) as `CONTINUITY_VISUAL_DENSITY_SPIKE`.

2. **Explicit Human Review on Missing Evidence**:
   - When shot classification, camera motion, or vector direction is absent or unverified, the system strictly avoids guessing or hallucinating scene properties.
   - Issues `CONTINUITY_MISSING_SHOT_LANGUAGE` with severity `manual-review`, explicitly requiring human inspection.

3. **Emotional Arc & Story Direction Advisories**:
   - Generates contextual advisories (`ContinuityAdvisory`) aligned with story arc progression (`rising`, `climax`, `resolution`).
   - Advisories provide actionable suggestions (e.g., pace acceleration or settling) without mutating timeline edits unilaterally.

4. **Human Overrides and Idempotent Auditable Receipts**:
   - Human operators can accept, dismiss, or customize proposals via `ContinuityOverride`.
   - Applied decisions generate immutable `ContinuityReceipt` records stamped with SHA-256 `receiptDigest` and `inputDigest`.
   - Replay idempotency: Applying an already recorded proposal and override set returns the existing receipt without modifying project history.
   - Stale proposal protection: Applying a proposal whose digest does not match current project inputs is rejected with `continuity.staleProposal` (HTTP 409).
   - Bounded receipt history: A hard cap of `MAX_CONTINUITY_RECEIPTS = 100` prevents project bloat, failing closed with `continuity.conflict` (HTTP 409) if exceeded.

## Test Evidence

- `packages/core/tests/continuity.test.ts` (5/5 passed):
  - Valid proposal generation and validation.
  - Fail-closed validation for missing diagnostics, invalid severities, and unknown metrics.
  - Receipt generation with deterministic SHA-256 digests.
  - Receipt validation and boundary checks (`MAX_CONTINUITY_RECEIPTS = 100`).
- `packages/solver/tests/continuity.test.ts` (7/7 passed):
  - Flagging missing shot language for manual review when scene metadata is incomplete.
  - Detecting opposing motion clashes across adjacent scenes.
  - Detecting duration pacing spikes (ratio >= 3.5x).
  - Detecting visual density spikes (ratio >= 3.0x).
  - Emotional guidance generation along story arc phases.
  - Correct application and verification of human overrides.
- `packages/application/tests/continuity-service.test.ts` (5/5 passed):
  - End-to-end proposal generation and preview via `ContinuityService.previewProposal`.
  - Applying human overrides and persisting `ContinuityReceipt` to `OpenFilmProject`.
  - Idempotent re-execution returning cached receipts.
  - Fail-closed stale proposal rejection on mismatched inputs.
  - Enforcing receipt bounds (100) failing closed with `continuity.conflict`.
