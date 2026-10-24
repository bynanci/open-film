# Workspace Modes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the current session. Steps use checkbox syntax for tracking.

**Goal:** Give general users a guided interface and frequent users faster access.

**Architecture:** Extend existing local preferences and shared workspace chrome.
Use a closed navigation-command catalog, one accessible dialog and native tool
disclosures. Keep existing editor instances and application mutation gates.

**Tech Stack:** Vue 3, TypeScript, existing semantic CSS/i18n, Vitest, Playwright.

**Spec:** [Workspace modes](../specs/2026-10-24-workspace-modes-design.md).

## Global constraints

- Preserve all current uncommitted story-authoring/UI changes on this branch.
- No new dependency, project schema, timeline, provider or media mutation.
- Use current theme tokens, three locales and synthetic browser fixtures.

## Review focus

- Invalid/unwritable local storage retains safe session behavior.
- Mode changes never discard a draft, selected source, history or playhead.
- Commands respect save failures, busy states and reopened project generations.
- Shortcut/search keys do not escape text/IME/dialog boundaries.
- Narrow/expanded-text layouts and expert density retain usable controls.

## Tasks

- [x] Write failing preference/search/shortcut tests and a browser mode-entry case.
- [x] Add validated `WorkspaceMode` preference, shared mode controls and localized
      labels. Verify persistence, invalid values and storage failures.
- [x] Add typed command filtering, accessible command dialog and App dispatch
      through existing navigation/save gates. Verify keyboard and stale ownership.
- [x] Apply guided/expert density and progressive editor/export controls while
      retaining child state; verify mode switching with dirty edits and Undo.
- [x] Run affected/full gates sequentially; inspect screenshots, update TASKS,
      ROADMAP and validation with real results and outstanding manual gates.

Use the existing working branch; no commit, push or merge is part of this UI request.
