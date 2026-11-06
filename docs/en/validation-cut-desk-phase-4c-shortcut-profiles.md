# Cut Desk Phase 4C shortcut profiles — validation

- Feature merged: 2026-11-05 in [PR #113](https://github.com/bynanci/open-film/pull/113),
  merge commit [`1bafb5cd4532ce9f9a171499abc8631e4863d1ee`](https://github.com/bynanci/open-film/commit/1bafb5cd4532ce9f9a171499abc8631e4863d1ee).
- Current integration evidence: PR #119, based on main
  [`b6304914a7eb351d8e5d0a0a11b41e163713e20b`](https://github.com/bynanci/open-film/commit/b6304914a7eb351d8e5d0a0a11b41e163713e20b).

The PR #113 Verify run
([run 42049843903](https://github.com/bynanci/open-film/actions/runs/42049843903))
passed fast-contract, all four browser shards, heavy-media, native-shell and
docs checks. Its three-platform Render QA
([run 42049843580](https://github.com/bynanci/open-film/actions/runs/42049843580))
and Windows FFmpeg 9 check
([run 42049843761](https://github.com/bynanci/open-film/actions/runs/42049843761))
also passed. The later full PR #119 Verify run on the current main base passed
as well (run 42230170897, linked in the Phase 4A record).

## Delivered scope

- Versioned declarative JSON profiles use action IDs and `KeyboardEvent.code`.
  Imports reject unknown fields, unsupported keys/modifiers, conflicting
  actions, browser and operating-system reserved shortcuts, and files larger
  than 16 KiB.
- Up to 16 profiles persist in a separate local preference key. Export includes
  the complete resolved map; profile data is not written to project state.
- Settings select, import, export, and remove profiles. The shortcut reference
  shows current Source, Record, and Timeline bindings.
- Existing focus, modal, IME, text-input, pending-operation, and history guards
  remain in place. Shift retains its existing frame-step behavior.

## Local automated evidence

- `pnpm typecheck` — passed on this branch after the final editor change.
- `pnpm exec vitest run tests/unit/shortcut-profiles.test.ts tests/unit/workspace-mode-preferences.test.ts tests/unit/cut-desk-responsive-a11y.test.ts tests/unit/precision-render-boundary.test.ts --maxWorkers=1` — 4 files, 37 tests passed.
- `pnpm exec vitest run tests/unit/timeline-clip-render-boundary.test.ts --maxWorkers=1` — 55 tests passed.
- `pnpm test:i18n` — 3,156 semantic keys match across en-US, zh-TW, and ja-JP.
- `pnpm test:docs-i18n` — README locales 10; English reference mirrors 160.
- Targeted ESLint — passed.

## Browser and platform status

The PR #113 hosted browser suite passed all four shards after the fixture
corrections. Earlier local runs that timed out before reaching the shortcut
assertions are not counted as passing evidence. The corrected fixture passes
serializable profile data into `page.evaluate` and uses standard `KeyboardEvent`
codes such as `KeyJ`.

## Remaining verification

Physical keyboard layouts, OS-level key reservations, and native desktop
behavior still need checks on supported Windows and macOS workstations. Those
checks are separate from this shortcut-profile PR.
