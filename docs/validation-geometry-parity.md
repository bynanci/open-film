# Geometry parity validation

Base: `015579ee443a70601368fe5575fe032458b117b4`, the PR #4 squash merge.
Initial PR #5 candidate: `2d08782e1c07e0a08b445e2ca18539252243cfcd`.

## Scope

The shared core contract maps source contain-fit, scale, clockwise rotation and
composition-frame translation into a clipped source preview and FFmpeg output.
This validates per-clip geometry. It does not claim a live multitrack compositor,
professional color management, actual Resolve import or camera/hardware QA.

## Review and regression evidence

Both initial exact-head CI runs failed their inspector resize browser assertion:
[push](https://github.com/bynanci/open-film/actions/runs/37574835947) and
[PR](https://github.com/bynanci/open-film/actions/runs/37574841068). Native jobs
passed. These are not green candidate gates.

Actual browser reproduction retained that failure. Runtime measurement found
897×491 source pixels before inspector collapse and 1169×491 after; a 16:9 frame
is height-limited to 872.889×491 in both cases. A required growth assertion was
therefore invalid for that layout. Independently, instrumented ResizeObserver
observed only the editor and parent: the source element appears after an async
load, so the mount-only registration never attached it. Width-limited current-fit
checks must prove the production fix without requiring growth when height-bound.

A real FFmpeg reproduction also found a pre-existing non-square-pixel distortion:
160×90 media with SAR 2:1 displays at 32:9, but the old contain/setsar pipeline
filled 160×90 rather than the expected 160×45. It occurs in the baseline as well
as the initial candidate and is tracked as an explicit parity correction.

Initial focused core/render tests passed 10 cases. SAR 2:1 and 1:2 regressions
then failed on the unmodified renderer. The correction contain-fits decoded
display aspect in one scale operation, normalizes output SAR and retains the
existing user transform ordering. Final focused core/render tests passed **13
cases**, including unspecified SAR, scale, rotation, translation and clipping.

The strengthened width-limited browser case failed on the unchanged component.
A post-render watcher now observes the source element when it appears, unobserves
hidden/replaced targets and rebinds after returning from Precision. The complete
500-clip focused case then passed with zero retries, including current-fit
assertions, inspector restoration, transient numeric edits, playback, keyboard,
cache and autosave behavior. Original failed CI and focused/diagnostic runs are
retained rather than relabeled as success.

## Complete local candidate validation

Production/test head: `7b8aa9d1e8a18fe46f3dcd24a13b40500da09621`.
All nine required local gates passed: format, i18n (1,023 keys), lint, TypeScript
and Vue typecheck, **994 unit/integration tests in 84 files**, build, **60 browser
cases**, official OTIO interchange and native format/Clippy/test-harness checks.
Built CLI import/render/reopen/export smoke also passed. Native harnesses ran
zero behavioral tests; native-window behavior is not established.

The complete browser run used one worker and zero retries: **60 passed, zero
failed/skipped, 727 shell seconds / 12.1 runner minutes**. Before/after Git heads,
clean status and all captured source/test hashes match. Its 500-clip case passed
in 8.9 seconds with current viewport fit, inspector restoration and mode changes.
The run retains 174 named non-attachment PNGs; the Transcript/Glossary/Suggestions
matrix contains exactly 36 across en-US/zh-TW/ja-JP/pseudo and 1280×720,
1440×900, 1920×1080. These automated captures/assertions are scoped layout evidence.

An independent immutable-source review found no new correctness findings; its
fresh isolated core suite passed 5 cases. Final documentation is recorded after
the complete source run. Fresh published-head CI and Codex review are separate
readiness checks on [PR #5](https://github.com/bynanci/open-film/pull/5).

Core/FFmpeg geometric samples and browser fit checks are not a comprehensive
cross-adapter per-pixel color/decoder comparison or continuous multi-track
playback certification.

## Manual gates

Real camera/proxy orientation and color, large 4K footage, GPU/native-window
behavior, Windows installation and actual DaVinci Resolve import remain separate
workstation gates. Generated media, official OTIO validation, schema checks and
compiled native harnesses do not establish those outcomes.
