# Cut Desk Phase 4A source-frame scopes — validation

Date: 2026-11-05  
Workspace branch: `codex/cut-desk-phase-4a-scopes`  
Base revision: `7cc0c9f10699f49ff0c046d024cabe620bc90818` (`origin/main`, fetched 2026-11-05)

This Phase 4A candidate is isolated from the active Silence Audition PR. The
catalog-search PR is merged. This candidate has not been merged to `main`.

## Delivered scope

- The Record monitor samples a selected, visible and ready video clip directly
  from its decoded video element, or loads a selected photo from the local asset
  route. Samples are downscaled proportionally so neither dimension exceeds 512
  pixels. Original and sampled dimensions are both shown.
- The scopes show RGB and luma histograms, an RGB parade, a luma waveform and a
  BT.709 chroma vectorscope. Fully transparent pixels are excluded.
- Analysis describes browser-decoded, sRGB-like source values before OpenFilm
  color corrections, Film Looks, compositing, captions and display management.
  It does not claim scene-linear, HDR or calibrated-output measurements.
- Sampling does not write to the Composition. Unavailable, unready or
  canvas-inaccessible frames are reported in the panel. Photo loading is fenced
  against project, Composition, revision and selection changes so a late decode
  cannot replace current scopes.
- The panel keeps its capture control reachable in the constrained Record
  monitor layout; it does not shrink its header outside the scrollable region.
- The split-wipe compares synchronized Record-preview layers with Film Look
  bypassed on the left and applied on the right. Labels identify both sides as
  browser previews, not calibrated display or rendered-output measurements.
  The comparison is preview-only and does not edit the saved Composition or
  exports.

## Automated evidence

- `pnpm exec vitest run tests/unit/frame-scopes.test.ts` — 4 tests passed for
  histogram/waveform bins, chroma mapping, transparent pixels, source/sample
  dimensions and bounds.
- `pnpm exec playwright test tests/e2e/professional-cut-desk.spec.ts -g 'samples bounded source-frame scopes|samples a high-resolution photo|split wipe compares Film Look' --workers=1` — 3 tests passed. They sample a synthetic video and a 640×360 photo, check the 512×288 photo sample and four canvases, verify the two Film Look preview states and slider, and confirm that the saved edit is unchanged.
- `pnpm typecheck` — passed for the candidate branch.
- The 4 scope unit tests and 3 targeted browser cases passed before the
  catalog-search merge; the post-merge revalidation is recorded below.

## Remaining Phase 4A work

Physical display and color-management checks remain workstation work. This
browser preview is not evidence of calibrated display behavior or rendered
output values. HDR and hardware-monitor behavior have not been implemented or
claimed.
