# OpenFilm v1.0.0 Release Readiness & Distribution Alignment — Validation

Date: 2026-10-31.
Capability: Full release packaging readiness, signed manual update with rollback alignment, verified SBOM and licenses review, and v1.0.0 roadmap finalization across all delivery owners.

## Key Invariants and Contracts

1. **Distribution Contract (Option A)**:
   - Signed manual package updates with rollback is codified as the authoritative distribution contract for v1.0.0.
   - Background in-app auto-update feeds and dynamic downloaders remain intentionally disabled and deferred to post-v1.
   - Verification of runtime updates enforces an Ed25519 detached cryptographic signature over the exact `runtime-manifest.json` digest, verifying complete file hashes, package boundaries, and permissions before admission.

2. **Runtime Staging, Provenance & SBOM (M7E)**:
   - Runtime staging (`scripts/native/stage.ts`) produces a deterministic, hash-covered `runtime-manifest.json` declaring platform, architecture, Node/service versions, and individual SHA-256 digests for all bundled files.
   - Build contributions (`dist/build-contributions.json`) track exact esbuild/Vite/Vue runtime modules and package identities.
   - `sbom.spdx.json` and attribution receipts (`receipts/attribution.json`) distinguish emitted code, copied runtime packages, compiled Rust code, host build/proc-macro inputs, and external OS dependencies.
   - Full Apache-2.0, MIT, OFL-1.1, and MPL-2.0 license receipts, historical notices, and source obligations are hash-pinned and verified without cyclic dependency between runtime manifest and post-build shell attribution.

3. **Cross-Platform Dead-Owner Recovery**:
   - Both Windows (`MachineGuid` + process liveness) and macOS (`kern.bootsessionuuid` + ESRCH liveness) provide verified OS-specific process identity evidence.
   - Dead owners across reboots or process termination are safely reclaimed; active processes, unknown states, and foreign platform locks fail closed to protect against data loss.

4. **Professional Cut Desk & Core Engine Capabilities**:
   - 100% completion of Cut Desk Phase 1A, 1B (precision gestures, zoom/pan, Alt snap-bypass, Shift fine trim), Phase 1C (responsive resizable workspace, dual-monitor / tabbed layouts, persistent preference recovery, ShortcutSheet, coarse-pointer targets), Phase 2 (edit semantics: Roll, Slip, Slide, Insert, Overwrite, Lift, Batch), and Phase 3 (track controls: target, lock, mute, solo, visibility & persistence).
   - Strict single authoritative `Composition` invariant preserved across all modules with zero secondary timelines.
   - Sample-accurate J/L audio policy, A/B-roll coverage, rhythm analysis & cut-point snap, continuity diagnostics, and scene micro-preview with dip transitions.

5. **Decoded Frame & Delivery Parity**:
   - Strict byte-for-byte decoded RGB equality and bitexact colorspace maintained across Linux x64, macOS arm64, and Windows x64.
   - Physical workstation observations (Issue #7) remain tracked under explicit manual hardware gates.

## Test Evidence

- **Contract Test Suite**: 74 files, 1445 tests passed (`pnpm test:contracts`).
- **Native Attribution & Packaging Suite**: 5 files, 82 tests passed (`vitest run tests/unit/native-*.test.ts`):
  - `tests/unit/native-distribution-receipt.test.ts` (6/6 passed)
  - `tests/unit/native-cargo-attribution.test.ts` (10/10 passed)
  - `tests/unit/native-linkage-receipt.test.ts` (7/7 passed)
  - `tests/unit/native-attribution.test.ts` (45/45 passed)
  - `tests/unit/native-support-files.test.ts` (14/14 passed)
- **Cross-Platform Review Owner Suite**: 22/22 tests passed (`packages/application/tests/review-owner-platform.test.ts`).
- **Cut Desk Track Controls Suite**: 18/18 tests passed (`packages/solver/tests/track-controls.test.ts`).
- **Cut Desk Pro Edit Semantics Suite**: 25/25 tests passed (`packages/solver/tests/pro-edit-semantics.test.ts`).
- **Documentation Locale Mirrors**: 146/146 English reference mirrors in exact byte-for-byte sync (`pnpm test:docs-i18n`).
- **Semantic i18n Keys**: All semantic keys matching across English, Traditional Chinese, and Japanese (`pnpm test:i18n`).
- **Static Analysis & Types**: `pnpm lint` (0 warnings), `pnpm typecheck` (passed), and `pnpm format:check` (passed).
