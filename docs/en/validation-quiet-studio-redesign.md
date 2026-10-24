# Quiet Studio redesign validation

Date: 2026-10-24. Branch: `codex/story-arc-authoring`.
Main/base: `b39c2c369d584fa0bb4f75734737d4ebd68d928a`.
The earlier authoring/responsive/operation-mode work was preserved in checkpoint
`a6513c1c2e112ae8a6014c1e3ef79d5a6395aa0c`; this redesign is the delta after it.

## Scope and design sources

The installed brainstorming, UI Skills routing, component enhancement and
planning/execution skills guided an implementation over the existing Vue/CSS
design system. The UI Skills registry CLI could not reach `ui-skills.com`;
no additional registry code or dependencies were added. The supplied Cinema
Foundation archive was read as documentation, never executed.

Changes cover semantic theme/geometry tokens, project/preferences/actions in the
top bar, shared controls, media cards, story authoring/segmented views, inspector,
mode cards, Settings, command search, storyboard, graph, pipeline and versions.
A presentation-only App grid places the same mounted native preview alongside
export settings, preserving its DOM identity and native playback state. Schema, editing commands, provider/renderer,
source media and autosave/revision/history contracts are unchanged.

## Reproduced issues

- The new real-browser desktop regression failed at en-US Expert/1280px: the
  header measured 96.375px and had wrapped. Grouped controls and an accessible
  project icon switch retain one row (<=80px) at 1280/1440/1920px in English and
  Traditional Chinese, both modes.
- The coarse-pointer regression failed because media actions had opacity 0
  without hover. They are now visible, have >=44px targets, and a real tap
  toggles/persists lock state and can undo that toggle.
- Screenshot inspection found the export preview below a long form. The new
  visibility assertion failed with a bottom of 3195px in a 900px viewport.
  Desktop preview/settings now share the top area; compact layouts stack them.
- The initial focused component selection passed 4/4, including native
  project-switch Enter, command Escape/focus return and Settings axe AA checks.

## Final gates

Final local results after the fixes:

| Gate                    | Result                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm format:check`     | Pass                                                                                             |
| `pnpm test:i18n`        | Pass; 2,268 semantic keys in en-US, zh-TW and ja-JP                                              |
| `pnpm test:docs-i18n`   | Pass; 9 README locale groups, 110 reference mirrors                                              |
| `pnpm lint`             | Pass; zero warnings                                                                              |
| `pnpm typecheck`        | Pass                                                                                             |
| `pnpm test`             | **278 files / 3,821 tests passed**, 344.32s                                                      |
| `pnpm test:e2e`         | **228/228 passed**, one worker, 18.6 minutes; no skips or retries                                |
| `pnpm build`            | Pass; existing >500kB application chunk advisory remains                                         |
| `pnpm test:interchange` | Pass; 18 harness tests, official OpenTimelineIO 0.18.1, source hash/bounds and relocation checks |
| Built CLI smoke         | Pass; real import, synthetic playable MP4, CJK title raster, exports and reopen                  |
| `git diff --check`      | Pass                                                                                             |

The new browser suite includes actual decoded synthetic-source MP4 playback,
native player identity/seek/volume/rate continuity, pointer targets and real
keyboard/focus behavior. Screenshots were inspected for both themes across the
core workspaces, Settings and command search. Logs and synthetic screenshots are
kept locally under `/tmp/openfilm-redesign/`; no media/cache output is committed.
The full Vitest process and interchange command exited zero. Intentional ENOSPC
and process-failure messages from native benchmark fixtures are negative tests,
not workstation measurements.

The Python-backed gates use the existing verified validation environment:

```sh
PATH="/tmp/openfilm-otio-venv/bin:$PATH" pnpm test
PATH="/tmp/openfilm-otio-venv/bin:$PATH" pnpm test:interchange
```

`opentimelineio.__version__` in that environment is `0.18.1`. The browser command
uses `PLAYWRIGHT_BROWSERS_PATH=/tmp/openfilm-playwright-browsers`, pointing to the
already installed Playwright Chromium build. The first browser invocation did not
find that cache; no assertions ran until the correct cache was selected.

## Review remediation

The first combined browser run passed 49/53; the four unchanged locale visual
tests rejected the compact export action being below the viewport. Fresh read-only
review also found that two mutually exclusive video subtrees would reset the
native player's state across Edit/Export. Playback continuity was treated as an
Important issue because users should retain their seek position during a purely
visual workspace redesign.

Both findings received real browser REDs. The final implementation uses one
App-owned mounted video, not a separate slot player; a decoded synthetic-source
MP4 checks element identity, 1.25s seek position, volume, rate and paused state
through both workspace switches. The render wait explicitly allows FFmpeg to
finish rather than assuming the ordinary 5s control timeout is a render limit.

The export grid remains side by side through 1024px and stacks a bounded preview
below 900px. Expanded-locale measurement showed 193px destination-choice cards
and a primary action starting at y=727 on a 720px viewport. The settings column
now has more width and the choice controls use compact 12px insets and 16px titles,
retaining all descriptions and assertions. A new explicit en-XA/1280px and
zh-TW/1024px check supplements the existing four-locale visual tests.

The reviewer declined physical/native input/assistive-technology certification,
completion of author-owned test runs, and unchanged pipeline wording/untouched
editing behavior. Those remain documented limits, required final gates, and
existing baseline scope respectively. No speculative backend changes were made.

The first full Vitest run passed 276 files but could not collect the existing
foreign-analysis navigation suite: its regex required `class` and `:disabled` to
be adjacent, so the accessible project-switch attributes broke discovery. The
test host now reads the actual disabled binding from Vue's template AST; its
navigation, source-lock and pending-write assertions are retained. One NLE test
also failed because the default `python3` lacked OpenTimelineIO. Reusing the
verified Python environment fixed that prerequisite. The two affected files
passed 96/96 tests before the full rerun.

CI's documentation locale guard also found stale/missing English reference
mirrors from the accumulated authoring/mode work. Their source-equivalent copies
are included; `pnpm test:docs-i18n` passes with 9 README locale groups and 110
reference mirrors. An intermediate export-layout diagnostic run was interrupted;
it is excluded from final passing evidence. No assertions were skipped or relaxed.

The relevant browser selection contains 54 tests in 10 files: component-redesign,
workspace-modes, responsive-surfaces, story-workflow-ux, workspace-shell,
story-arc-authoring, global-visual, global-workflow, precision-editing and
project-versions. The existing responsive/locale cases retain their assertions;
the new suite adds actual coarse-pointer controls and layout regressions, plus
dark/light screenshots of Library, Outline, Edit, Export, Versions, Graph,
Storyboard, Pipeline, Settings and commands.

## PR #53 review and full-suite remediation

The GitHub review and the first hosted full-browser run exposed five correctness
issues and stale expectations in older workflows. The final candidate saves the
last IME composition value, localizes untouched built-in arc prompts while
preserving user-owned text, derives new-story timing from the selected arc,
isolates Timeline shortcuts while the Pipeline drawer owns focus, and requests
full-size Storyboard images with the loopback CORS contract.

General mode still exposes advanced audio, Fit and Visual QA actions through its
documented disclosure. New stories still open in StoryGraph. Existing browser
flows now exercise those intended steps explicitly; reload/relink checks use the
top-bar project identity and enter the workspace whose content they inspect.
The compact Export layout keeps the MP4 action fully visible at 1280x720 and
1024x768, including expanded pseudo-localized text, without changing export order
or Composition state.

Focused review tests passed 42/42. The 50-case affected browser selection passed
48 immediately; the two stale workspace assumptions were corrected and passed
individually. The final repository-wide runs then passed all 3,821 Vitest tests
and all 228 Playwright tests from the final files. Production build, built CLI
smoke, all 18 OpenTimelineIO 0.18.1 interchange checks and `git diff --check`
also passed.

## Limits

Local automation is separate from hosted CI and native workstation evidence.
The complete repository E2E selection was rerun; native Rust gates remain owned
by exact-head hosted CI for this web presentation change. Physical Windows/macOS WebViews, OS IME,
VoiceOver/NVDA, actual browser zoom controls, touch/pen devices and hardware/4K/NLE
QA remain manual gates. CSS reflow and emulated coarse pointer are evidence for
those particular browser conditions, not a claim of physical-device certification.
