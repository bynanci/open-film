# M5 / F08 Reviewable Agent Editing validation

This is PR 5B, based on merged Layer Editor PR #30 at
`a33340c43d40f82825bc788e1c82625883e6acbb`. It reuses the saved Composition,
GraphicScene v1, the current TimelineEditor revision, and the layer Inspector.
It adds no timeline, project schema, provider implementation, or independent
persistence path.

## Behavior and safety contract

- A Desktop request targets its selected GraphicScene layer. The application
  accepts one to eight unique selected node IDs for headless/API callers and
  binds every proposal to the saved Composition revision, project, Composition,
  scene and selected IDs.
- The local parser uses a small deterministic grammar for translation, size,
  rotation, opacity, visibility and text. Unsupported instructions become
  typed conflicts; they are not guessed or sent to a provider automatically.
- Provider responses must be a single bounded JSON object with allowlisted
  `translate` or `set` operations. Operations cannot add/remove layers, change
  media sources, or execute HTML/JavaScript. Every value is validated against
  the selected node type, GraphicScene bounds and lock ancestry before it can
  appear as an action.
- Optional text generation uses `KnowledgeService.generateReviewText`,
  `ProviderRegistry` and explicit descriptor-bound `text` consent. The prompt
  includes only the instruction and selected layer visual snapshot; it omits
  asset IDs, paths, project files and other layers. No provider call occurs
  before consent for a remote provider.
- The UI displays affected IDs, reasons, before/after values and typed
  conflicts. Actions start unselected and the user explicitly selects the
  exact changes to accept; the application applies only the action IDs supplied
  by the user. Acceptance is
  one existing `graphic.scene.upsert` edit and therefore uses normal autosave,
  stale revision, Undo/Redo and reopen behavior.
- Proposals remain ephemeral and are rejected when stale, missing, locked,
  unselected, conflicting or unavailable. An uncertain acceptance stores its
  exact request ID in project/Composition-scoped local storage so Retry cannot
  silently create a second edit. Switching owners reloads the corresponding
  receipt; a stale retry fails closed.

## Regression evidence

- `tests/unit/graphic-scene-agent-review.test.ts` covers dropping a stale
  in-flight Desktop preview without leaving the editor busy.
- `packages/solver/tests/graphic-scene-agent.test.ts` covers the local grammar,
  strict JSON parsing, before/after actions, explicit action selection, bounds,
  locked ancestors, unselected IDs and conflicts.
- `packages/application/tests/graphic-scene-agent.test.ts` covers preview
  without save, local accept, one-step Undo/Redo, reopen, provider refusal before
  consent, selected-only provider disclosure, unselected output conflicts,
  locked layers and stale revision rejection.
- `tests/integration/graphic-scene-adapters.test.ts` covers HTTP preview and
  acceptance through the same server-held TimelineEditor, followed by HTTP
  Undo.
- `tests/e2e/graphic-scenes.spec.ts` covers Desktop Preview → Select → Explicit
  Accept, deselect disabling acceptance, saved layer position and Undo.
- `packages/application/tests/graphic-scenes.test.ts` creates a synthetic
  background MP4, accepts a deterministic layer translation, renders a new real
  H.264 MP4, probes 320×180 / 12 fps / 72 frames / 6 seconds, decodes the
  three-second frame and verifies the red shape moved to its accepted position.
  The test also compares the render manifest source SHA-256 with the original
  synthetic source and checks that surfaced warnings equal the manifest.

## Validation status

Focused unit, application, API integration and FFmpeg regression command:

```sh
pnpm exec vitest run \
  tests/unit/graphic-scene-agent-review.test.ts \
  packages/solver/tests/graphic-scene-agent.test.ts \
  packages/application/tests/graphic-scene-agent.test.ts \
  packages/application/tests/graphic-scenes.test.ts \
  tests/integration/graphic-scene-adapters.test.ts
```

The focused command passed 5 files / 22 tests. Full local checks passed:
`pnpm format:check`, `pnpm test:i18n` (1,609 semantic keys across English,
Traditional Chinese and Japanese), `pnpm lint`, `pnpm typecheck`, `pnpm test`
(197 files / 2,882 tests), `pnpm build`, and `pnpm test:interchange` (18
OpenTimelineIO 0.18.1 checks). The complete Playwright suite passed 163/163
against system Chromium at `/usr/bin/chromium`; the Playwright download host
returns HTTP 403 in this environment, so the configured system-browser fallback
was used. `opentimelineio==0.18.1` was installed into an isolated `/tmp` Python
virtual environment for the E2E and interchange checks. The production build
succeeds with the existing desktop bundle-size advisory (896.77 kB uncompressed).
After adding the stale-preview busy reset, its component regression and the
GraphicScene browser test passed again; the 163-test full suite ran immediately
before that small guard change.

Native Rust checks are unavailable locally because Cargo is not installed;
exact-head GitHub CI must pass its native job before merge. Exact-head CI and
fresh PR review remain required.

Provider model quality, external endpoint availability, physical display
quality, hardware/4K throughput and downstream Resolve/NLE finishing remain
manual gates; synthetic fixtures do not certify them.
