# Quiet Studio redesign implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement the tasks
> in order, followed by one fresh whole-change review.

**Goal:** Redesign the shell and shared creative-workflow components, verify
responsive/accessible operation, and push the updated feature branch.

**Architecture:** Retain Vue component/event/data boundaries. Modify the source
semantic tokens, existing shared CSS and focused component styles, rather than
introducing a second component framework or override stylesheet.

**Tech stack:** Vue 3, TypeScript, CSS, Playwright/axe, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-quiet-studio-redesign-design.md`

## Global constraints

Preserve schema, commands, source locks, drafts, focus, save/review barriers,
Undo/Redo, renderer and media. No external dependencies/fonts. Keep General/Expert,
CJK, en-XA, both themes, keyboard operation and reduced motion. Retain accessible
control boundaries and visible focus. Run browser/full Vitest sequentially.

## Review focus

- Icon project switch keeps its existing accessible name and native activation.
- Grouped top bar wraps without shrinking CJK/native select labels into clipping.
- Coarse-pointer media actions remain discoverable and have real hit targets.
- Segmented controls retain selected/pressed and keyboard semantics.
- Focus rings, save/error/lock signals and scene-authored colors stay visible.

## Task 1: Foundation and shell

- [x] Add rendered crowding/coarse-pointer regressions; observe baseline failures.
- [x] Revise semantic theme/geometry tokens and contrast-check existing tests.
- [x] Group the top bar with compact project switching and local status.
- [x] Refine navigation, button, field and mode-control styles at their source.
- [x] Verify new regressions and inspect dark/light shell screenshots.

## Task 2: Creative components

- [x] Refine media tiles, story rail/authoring fields, segmented views and inspector.
- [x] Refine Settings, command search, storyboard, export and pipeline geometry.
- [x] Reuse responsive breakpoints; remove superseded declarations in touched rules.
- [x] Capture and inspect all core screens, settings and command search.
- [x] Run the eight existing relevant browser suites with the new suite.

## Task 3: Verify and update branch

- [x] Run format, i18n, lint, typecheck, full Vitest, build and interchange.
- [x] Obtain a fresh read-only review; resolve demonstrated correctness issues.
- [x] Update design-system/TASKS/ROADMAP and a dedicated validation record.
- [x] Commit and push `codex/story-arc-authoring`; verify remote SHA and clean tree.
- [x] Report branch, evidence, screenshots and remaining manual gates.
