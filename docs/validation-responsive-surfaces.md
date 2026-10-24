# Color, border and responsive spacing validation

## Candidate

- Branch: `codex/story-arc-authoring`
- Base: `b39c2c369d584fa0bb4f75734737d4ebd68d928a`
- Changes: workspace semantic palette, decorative/input border separation,
  responsive gutters/insets, library inspector and story rail height, preview
  reflow, and pipeline chrome. Media and project contracts are unchanged.
- Fixtures: generated synthetic PNG and MP4; no personal media.

## Observed regressions and fixes

| Observation before the fix                                                                   | Cause                                                                                                                                     | Change / evidence                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library overflowed to 841px in a 768px window; inspector controls went offscreen.            | Legacy compact inspector grid and newer two-column library rules applied together.                                                        | Use one consistent inspector layout; stack at <=900px. Reproduce and retain the browser assertions.                                                           |
| Export overflowed to 696px at 640×360.                                                       | Preview aspect ratio and minimum height gave an auto-width box an oversized intrinsic width.                                              | Give the preview a definite 100% width, constrain media and remove the placeholder minimum-height conflict.                                                   |
| A 900px desktop inspector grew to over 1500px; a short beat rail stretched beside long text. | Unbounded inspector and default grid stretching.                                                                                          | Bound desktop inspector height with local scrolling; align beat navigation to the start and fit its content.                                                  |
| Pipeline question labels failed light-theme contrast.                                        | Hard-coded pale blue text independent of the theme.                                                                                       | Map labels and status/action chrome to semantic theme tokens; check with axe in both themes.                                                                  |
| Narrow project identity could collapse to a few characters.                                  | A zero-minimum flex item competed with fixed-width header tools.                                                                          | Reserve a readable identity width and let tools wrap; use measured header height for the sticky rail.                                                         |
| Expanded StoryGraph toolbar labels were clipped even at 1280px.                              | Nonwrapping toolbar groups shared a canvas with two fixed palettes.                                                                       | Wrap groups, collapse palettes according to the graph container and retain keyboard access through compact panel focus/Escape.                                |
| Fit content used a fixed 900×600 canvas.                                                     | The view transform ignored real canvas, toolbar and node geometry.                                                                        | Fit measured rendered bounds at 768/1280/1440 widths; preserve source nodes and canonical order.                                                              |
| Theme switching briefly reduced dock label contrast, despite passing settled palettes.       | Foreground/background colors interpolated independently through intermediate colors; frame sampling reproduced a minimum ratio of 1.34:1. | Switch button palette colors together and retain border/opacity transitions. Sample every animation frame in both directions; retain the existing axe checks. |

## Visual system

Graphite/mist surfaces and a restrained iris accent replace the warm workspace
tint. Surface contrast groups content; decorative outlines are reduced while
inputs use their own measurable control boundary. Existing keyboard focus
rings, state labels and lock/selection indicators remain visible.

Token checks enforce >=4.5:1 normal text and selected labels, >=3:1 focus and
input boundaries. Candidate minimum regular text contrast is 5.79:1 dark /
4.78:1 light; minimum control boundary contrast across bg/surface-1/surface-2
is 3.85:1 dark / 3.23:1 light. Browser checks measure rendered form boundaries
in addition to testing palette declarations.

Gutters, panel insets and section gaps use the responsive spacing roles in
[design system](design-system.md). The Inspector and beat list use real
viewport/selection geometry rather than screenshot-only assumptions.

## StoryGraph input and save regression

Graph title edits appeared locally but failed to save with a 404: the parent
prepended `/api` a second time and treated acknowledged graph results as edits.
Manual beat text now uses the existing `saveBeat`/flush/draft-recovery path;
acknowledged graph results are published without an extra mutation.

The active inspector field remains visible/focused when resizing into compact
mode. Its autosave regression holds one write while more text is entered,
checks that the newest edit wins, injects a synthetic 503, retries without
losing text or focus, compares Composition data and reopens the project.
Selecting another beat during that write used to be dropped by the busy gate;
it now waits for acknowledgement and enables the requested inspector on the
first click. Unit regressions also fence a failed save, project/story switches
and a changed session generation while the selection is waiting.
Failed writes remain in the existing beat draft and normal save/recovery gates;
no separate story storage or project schema is introduced.

## Checks

| Local check                      | Result                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`              | Pass                                                                                                            |
| `pnpm test:i18n`                 | Pass: 2,253 matching semantic keys in three locales                                                             |
| `pnpm lint`                      | Pass, zero warnings                                                                                             |
| `pnpm typecheck`                 | Pass                                                                                                            |
| `pnpm build`                     | Pass; the existing >500kB application-chunk advisory remains                                                    |
| Seven relevant Playwright suites | Pass: 37/37, including eight responsive/interaction cases                                                       |
| Full `pnpm test`                 | Pass: 275 files / 3,788 tests; isolated run completed in 341.17 seconds                                         |
| `pnpm test:interchange`          | Pass: 18 harness tests; official OpenTimelineIO 0.18.1 read/write/read, source hash/bounds and relocation gates |
| `git diff --check`               | Pass                                                                                                            |

The browser selection is `responsive-surfaces`, `story-workflow-ux`,
`workspace-shell`, `story-arc-authoring`, `global-visual`, `global-workflow`
and `precision-editing` under `tests/e2e`, using
`PLAYWRIGHT_BROWSERS_PATH=/tmp/openfilm-playwright-browsers` and
`OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python`. It is the relevant
browser regression selection, not the entire `pnpm test:e2e` suite. The full
Vitest run and `pnpm test:interchange` use the same OpenTimelineIO interpreter.
`pnpm test:native` is not rerun in this web UI iteration.

`responsive-surfaces.spec.ts` visits Library with an open inspector, Story,
Edit, Export, story setup, Pipeline and Settings in dark/light themes. It
checks 640×360, 768×600, 779/780/781×600, 900×600, 1024×576,
1099/1100/1101×720, 1279/1280×720, 1440×900 and 1920×1080. The 640×360 and
1024×576 cases model effective CSS reflow at 200% and 125% on a 1280×720
window; they are not claims about a physical browser's zoom controls.

Expanded en-XA checks exercise story views and setup with long labels. Core
visual/workflow regressions still cover English, Traditional Chinese and
Japanese. Internally pannable clip lanes and the spatial graph viewport keep
their two-dimensional behavior; page-level overflow and toolbar clipping remain
asserted. Tests do not hide overflow to satisfy the checks.

Spacing checks measure actual workspace padding at every matrix size: 16px
gutters/20px top at <=900px, 24px/24px on standard desktop, and 32px/32px at
1600px and wider. Theme-switch frame samples enforce >=4.5:1 on dock labels
rather than waiting for an inaccessible color transition to finish.

Resize checks allow two animation frames for ResizeObserver and Vue to settle
the responsive panel state before measuring. Compact graph palette tests check
focus entry/return, and Fit to content checks rendered node bounds against the
actual unoccluded canvas. These checks keep toolbar clipping assertions active
and do not substitute page-wide overflow suppression.

### Failures diagnosed during validation

The first full Vitest run reported 274 files / 3,768 tests passing and 20
failures, plus three unhandled rejections from the same cause. The headless
`foreign-analysis-navigation` host omitted the new `graphBeatSaveTask` input
used by the actual App flush function. Supplying the idle state restored its
existing assertions; that file and the actual App story-state tests then
passed 46/46. The final isolated full-suite rerun passed all 275 files / 3,788
tests with no unhandled rejections.

A subsequent browser run caught the theme-transition contrast defect described
above and was intentionally stopped after diagnosis (one failure, one
interrupted case, 11 passed). A new frame-sampling regression reproduced the
defect before the CSS fix. The targeted five-case rerun then passed, including
the original axe check, both spacing sweeps, pending graph selection and frame
sampling. Final full-selection results supersede these intermediate runs.

Playwright and the full Vitest suite run sequentially: the benchmark process
tests require exclusive use of the browser server's port 4310. No assertions
are skipped or relaxed.

Before/after screenshots use synthetic media and remain local Playwright/tmp
evidence; no user photos or public CI image artifacts are added. A physical
Windows/macOS display, real browser zoom controls, VoiceOver/NVDA and touch/pen
remain manual gates. The project continues to be a desktop editor; compact
reflow is not mobile editing certification.
