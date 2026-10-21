# M5 / F03 Layer Editor validation

This record covers merged PR #30 (5A) only. It depends on integrated M3/F01
Declarative GraphicScene and M4/F02 Creative Story Templates. Exact PR base was
`e6d07b04cfb7ae905e04a6102311a26da1f18e01`, PR head was
`16439882c6a62cd20f6849e76a76054f9bb881b0`, and merge commit on `main` is
`a33340c43d40f82825bc788e1c82625883e6acbb`. PR 5B / F08 builds on the merged
Inspector and existing typed commands in its own change.

## Behavior under test

- Optional rotation, hidden and locked fields preserve schema-1 projects that
  omit them. Rotation has bounded deterministic `frame(t)` evaluation; hidden
  nodes are kept in saved data but omitted from both Monitor and FFmpeg output.
- The paused Edit Monitor uses the current saved-revision GraphicScene preview
  for selection, pointer move, resize and rotate. Gestures submit one existing
  typed `graphic.scene.upsert`, cancel on revision change, and are discarded
  when the keyed project/Composition editor is replaced.
- The Inspector edits opacity, z-order, hidden/locked state and numeric
  transforms; snapping, alignment guides and one/ten-pixel keyboard nudges use
  Composition coordinates. A locked node, its ancestor transforms and its
  containing scene's timing/order are protected at the solver command boundary.
- Existing autosave, request receipt, Undo/Redo, stale-revision conflict and
  reopen contracts continue to own persistence. No second timeline or
  project-schema migration is introduced.

## Regression evidence

`packages/core/tests/graphic-scenes.test.ts` validates optional-field
compatibility, invalid state rejection, bounded rotation and deterministic
hidden-node evaluation. `packages/solver/tests/graphic-scenes.test.ts` checks
node and group lock enforcement, unlock behavior, and immutable input.
`packages/application/tests/graphic-scenes.test.ts` checks save, Undo/Redo and
reopen for rotation/hidden/locked data. Its pre-existing stale edit and
preview-revision cases remain part of the suite.

`packages/render/tests/graphic-scenes.test.ts` generates a real synthetic
six-second, 180-frame MP4 with FFmpeg. It decodes the first, middle and final
frames, compares pixels from the shared Monitor PNG and MP4, confirms a rotated
shape occupies pixels outside its unrotated bounds, confirms a hidden shape is
absent, checks shuffled seek determinism and verifies source SHA-256 remains
unchanged and recorded in the render manifest.

`tests/e2e/graphic-scenes.spec.ts` authors overlapping layers in Desktop and
exercises grid snapping, keyboard nudging, drag, edge resize, rotation, opacity,
z-order, hidden/locked controls, locked drag protection, animation editing,
revision-change gesture cancellation, Undo/Redo, project reopen and existing M4
template editing. Fixtures contain synthetic media and fictional text only.

## Gate status

The merged exact-head push and pull-request CI passed the repository verify,
interchange, CLI smoke, native and full Playwright gates. The actual FFmpeg
regression above decodes first/mid/last frames from the six-second MP4. The
production build reports the existing 880 kB desktop JavaScript chunk size
advisory; the build succeeds.

Native tests passed in exact-head GitHub CI. Manual hardware, real-film
aesthetics, 4K throughput and downstream NLE finishing are not certified by
synthetic tests.
