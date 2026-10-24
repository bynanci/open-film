# Story Arc Authoring Implementation Plan

**Goal:** Expand story creation with localized arc prompts and user-authored
ordered beats, then foreground the existing StoryGraph → Pipeline → Edit path.

**Architecture:** A pure `@openfilm/story` arc builder creates existing canonical
Story beats. The current application and HTTP create-story boundary validate
the requested arc and custom outline. Desktop stores no new state beyond the
Story the API already owns. Graph and Pipeline remain existing components.

**Specification:**
[2026-10-23 story arc authoring design](../specs/2026-10-23-story-arc-authoring-design.md)

## Tasks

1. Add pure story arc rules and tests for localized templates, custom outline
   limits/order, stable source distribution, and empty future beats.
2. Add application and API support for new arc IDs and strictly validated
   custom heading input; preserve `blank` and `proposal-film` behavior.
3. Add three-language story structure options and custom outline input. Open new
   stories on StoryGraph and provide accessible buttons for Pipeline and
   Compose/Edit.
4. Restyle Storyboard as a single ordered reading thread; keep current selection
   and timeline actions.
5. Add HTTP/reopen and browser regressions. Update product contracts,
   validation notes, TASKS and ROADMAP. Run focused tests, i18n, format, lint,
   typecheck, full unit/integration tests and build; run relevant browser tests
   when the configured desktop runner is available.

## Emotional/shot planning boundary

The supplied prompts ask for an emotional overlay and Shot Planning Proposal.
The user supplied cinema-foundation v1.1.0 and v1.0.0 on 2026-10-24; these now
provide the reference schemas and types. The current StoryPlan remains
scene-level without stable shot IDs. Do not cast or write the new shot-level
fields into StoryPlan. Track the overlay and its adapter as a follow-up; keep
current beat intent, narration, and visual direction editable as before.

The continued UI implementation and acceptance cases are recorded in
[workspace UX refinement](../../workspace-ux-refinement.md).
