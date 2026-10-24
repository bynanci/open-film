# Quiet Studio component redesign

## Intent and scope

Make the existing local-first creative workspace easier to scan and more pleasant
to use. The user requested a deep redesign using skills and a branch update,
building on the Apple/Instagram interaction direction, responsive spacing and
General/Expert modes already implemented. This is an implementation request;
visual decisions below are the implementer's choices within that direction.

## Approaches considered

1. Palette-only polish is cheap but leaves the crowded toolbar and equal-weight
   control groups unresolved.
2. A wholly new shell or component library could change the interaction model
   and introduce unnecessary focus, draft and keyboard risks.
3. Refine the existing shell, semantic tokens and component styles together.
   This is the chosen implementation approach: preserve Vue components and all
   editing contracts while establishing a coherent visual hierarchy.

## Visual direction

- Neutral carbon dark surfaces and pearl light surfaces, with one cool blue
  action/selection family. Warning, danger and success retain their meanings.
- Group project identity, preferences and actions in the top bar. Use an icon
  with an accessible name for project switching; keep the familiar text labels
  for the main actions. Local status can compact to its dot with an accessible
  description. Never hide a safety or save error to make the toolbar fit.
- Use a 4px spacing rhythm, existing responsive gutters and both mode densities.
  Use shared control, panel and dialog radii; typography remains system/CJK.
- Prefer space and separators to nested framed cards. Selected navigation,
  segmented views and active objects need a shape/weight/boundary cue as well as
  color. Inputs keep a 3:1 boundary and visible focus.
- Make media thumbnails the emphasis of library tiles, story fields a readable
  authoring surface, and the editor's mode/tools visibly separate groups.
- Settings, command search, storyboard and pipeline use the same material and
  geometry. Do not apply blanket styles to scene content or rendered subtitles.
- The export preview appears alongside settings on desktop and before them on
  compact windows. Its existing native player and render/error/stale behavior
  remain owned by App in one mounted native player. A presentation-only grid
  places it next to ExportWorkspace without recreating it during workspace changes.

## Contracts

- Preserve the current branch and all previous authoring/mode work.
- No project schema, renderer, timeline, provider, API or storage changes.
- Keep existing button names, native selects, events, save/review fences,
  Undo/Redo, locks, autosave and reopen behavior.
- General keeps guidance; Expert keeps compact density and open advanced tools.
- No external fonts, new dependencies, remote media or executable design assets.
- Core text AA in both themes; required control cues >=3:1. At coarse pointer
  sizes, header utilities, mode/filter controls and media actions have >=44px hit targets and media
  actions remain visible without hover.
- Normal en-US and zh-TW top bars stay one row at 1280px and wider. Compact
  windows and long pseudo-locales may wrap without clipping or page overflow.

## Evidence and acceptance

Reuse the eight workflow/responsive/browser suites and actual token contrast
tests. Add rendered regressions for toolbar crowding and coarse-pointer controls,
and capture the core screens/settings/commands in both themes. Inspect screenshots
and run format, i18n, lint, typecheck, full Vitest, build and interchange. Browser
and full Vitest run sequentially because the benchmark fixture owns port 4310.
Report local evidence separately from hosted CI and physical native/manual QA.

The supplied Cinema Foundation archive was read as documentation only. Its
guidance prioritizes story, provenance and accurate media terminology; it does not
provide a UI token system. The UI Skills registry CLI could not reach its service;
the installed UI routing/component skills and existing product system remain the
design sources.
