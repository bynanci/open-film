# Real Editing Workflow Implementation Plan

> Agentic workers implement independently owned files; root integrates each
> priority into a working tested slice before progressing to the next.

**Goal:** Let a person graphically finish, relink, reopen and export a real film.
**Architecture:** Extend existing solver/application/HTTP/Vue boundaries.
**Tech Stack:** Existing TypeScript/Vue/SQLite/FFmpeg/Tauri toolchain.
**Spec:** ../specs/2026-10-05-real-editing-design.md and ../../EDITING_CONTRACTS.md.

## Global constraints

Originals remain immutable. Existing public APIs remain functional. No unrelated
Core redesign. Preserve exact locks/required selections. No claim of real camera
or Resolve certification without those fixtures/applications. main stays green.

## Review focus

- Autosave conflict, project switch and failed disk writes must not lose edits.
- Speed/trim must retain valid source bounds and recalculate timeline duration.
- Regeneration/shortening must preserve locks and edits outside the beat.
- Relink ambiguity/changed files must not silently bind a wrong source.
- Offline libraries, HDR and raw360 must produce concrete recoverable states.

## P0 graphical editing

- [x] Add optional per-clip lock validation/schema tests without a breaking schema.
- [x] Implement pure commands, scoped regeneration and explainable fit suggestions;
      test bounds, ordering, protected clips and edits outside the target beat.
- [x] Implement application revision/undo/redo/atomic save service; test reopen,
      rejected edits, stale clients, failure rollback and request replay.
- [x] Add HTTP editor routes and real source preview; exercise actual project IO.
- [x] Build dark story-beat timeline, clip/beat controls, autosave and shortcuts.
- [x] Verify graphical end-to-end editing/render/reopen; update TASKS immediately.

## P1 relinking

- [x] Add stable provenance/library references and missing-media reporting.
- [x] Implement single/folder inspect+confirm relink with hash-first matching.
- [x] Expose Desktop relink flow; test offline library and Windows path identity.
- [x] Verify moved-media render/reopen with unchanged original hashes; document.

## P2 source adapters

- [x] Pixel recognition/metadata and experimental Motion Photo detection.
- [x] Insta360 export recognition and raw source association with explicit levels.
- [x] Preserve HDR/color metadata; safe supported proxies or actionable failure.
- [x] Adapter tests, integration and user-facing unsupported360 states.

## P3/P4 reference and interchange

- [x] Generate CC0 proposal fixture and document the complete reference workflow.
- [x] Add proposal E2E with manual edits, locks, regeneration, fit and reopen.
- [x] Add Resolve fixture matrix and official OTIO parser/serialization tests.
- [x] Document actual implementation/parser evidence vs manual Resolve/camera QA.

## P5 release verification

- [x] Run format, lint, typecheck, test, build, e2e, interchange and native gates.
- [x] Review actual UI screenshots and independently audit regressions.
- [ ] Update TASKS/ROADMAP/README, create PR, verify its CI against exact head.
