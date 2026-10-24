# Story Arc Authoring Validation

## Candidate

- Base: `b39c2c369d584fa0bb4f75734737d4ebd68d928a`
- Branch: `codex/story-arc-authoring`
- Project schema: unchanged at 1.0.0
- Fixture policy: generated synthetic images/video only; no personal media

## Automated checks

These are the initial story-authoring checks. The continued desktop shell and
interaction refinement, including current full-suite counts, are recorded in
[workspace UX validation](validation-workspace-ux-refinement.md).

| Check                                                               | Result                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| Story arc / legacy Story and Scene Planner tests                    | Pass: 103 tests across 6 files                       |
| Story create API, StoryGraph order, invalid outline, project reopen | Pass: `tests/integration/story-arcs.test.ts`         |
| Browser: custom outline → StoryGraph → Pipeline Workbench           | Pass: 1/1                                            |
| Existing localized story workflow                                   | Pass: 3/3 (`global-workflow.spec.ts`)                |
| Precision editing regressions                                       | Pass: 13/13; native readiness harness: 72/72         |
| i18n                                                                | Pass: 2,235 semantic keys match across all 3 locales |
| Format, lint, TypeScript/Vue typecheck, production build            | Pass                                                 |
| Full Vitest suite                                                   | Pass: 273 files, 3,774 tests                         |

The full suite ran with the test-only Python dependency installed under
`/tmp/openfilm-python-deps` and exposed via `PYTHONPATH` for the existing
OpenTimelineIO handoff regression. No Python dependency or browser binary was
added to the repository. Browser regressions ran with Playwright Chromium
installed under `/tmp`.

## Manual gates

- Visual review of Traditional Chinese and Japanese long-form layouts on a
  physical high-DPI display remains open.
- Touch/pen mind-map and workbench interaction remains open.
- Shot-level/emotional proposal validation is not implemented in this change;
  the reference schemas were supplied on 2026-10-24 and reviewed as design
  guidance; their runtime scene/shot adapter remains unimplemented. See
  [design](superpowers/specs/2026-10-23-story-arc-authoring-design.md).
- This change does not add an MP4/render path; rendering remains on the existing
  Composition and Pipeline contracts.
