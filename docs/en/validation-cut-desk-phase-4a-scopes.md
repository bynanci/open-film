# Cut Desk Phase 4A source-frame scopes — validation

Feature merged: 2026-11-05 in [PR #112](https://github.com/bynanci/open-film/pull/112),
merge commit [`92ccf361642f060466b269dc2fcf3ed4d77102b3`](https://github.com/bynanci/open-film/commit/92ccf361642f060466b269dc2fcf3ed4d77102b3).
Current integration evidence: PR #119, based on main
[`b6304914a7eb351d8e5d0a0a11b41e163713e20b`](https://github.com/bynanci/open-film/commit/b6304914a7eb351d8e5d0a0a11b41e163713e20b).

The original PR #112 Verify run
([run 42041892767](https://github.com/bynanci/open-film/actions/runs/42041892767))
had three browser shards time out in the `Install native media tools and
independent timeline parser` setup step, so its aggregate check failed. The
focused local scope tests below passed. The later
full PR #119 Verify run on the current main base passed all four browser shards,
fast-contract, heavy-media, native-shell and docs checks
([run 42230170897](https://github.com/bynanci/open-film/actions/runs/42230170897));
its three-platform Render QA also passed
([run 42230170858](https://github.com/bynanci/open-film/actions/runs/42230170858)).
This later run verifies the merged code in the full current-base candidate; it
does not replace physical display acceptance.

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
- PR #112's focused Vitest, Playwright and typecheck results are pre-merge
  candidate evidence. The original hosted run's timeouts are retained above
  rather than represented as a green PR #112 aggregate.
- Current-base hosted regression evidence is PR #119's full Verify and
  three-platform Render QA runs linked above.

## Remaining Phase 4A work

Physical display and color-management checks remain workstation work. This
browser preview is not evidence of calibrated display behavior or rendered
output values. HDR and hardware-monitor behavior have not been implemented or
claimed.
