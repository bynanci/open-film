# Cut Desk Phase 4C shortcut profiles — validation

- Date: 2026-11-05
- Feature branch: `codex/cut-desk-phase-4c-shortcut-profiles`
- Stacked review base: `codex/cut-desk-phase-4a-scopes` at `b3f36f6295713968c86aec4dc0320f20c4805910` (PR #112)
- Main beneath that branch: `0485b3115c962d9b21f6884536155f4b79393a88`

Phase 4C is isolated from the original mixed worktree and contains only the
shortcut-profile feature. It is proposed as a stacked PR so its diff excludes
Phase 4A; it can be retargeted to `main` after PR #112 merges. PR #112 advanced
to `b3f36f6` with a test-only Split Wipe control update; its fresh checks are
running.

The previous #112 browser shard 4 run hit its 45-minute job limit while
installing Linux media packages, so the required-lanes check failed because
that shard was cancelled. The second run exposed an outdated compare-control
count, fixed in #112 commit `b3f36f6` before the current run.

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

## Browser check status

The profile E2E did not reach its shortcut assertions in two current-base local
runs. The first run timed out while the welcome screen still showed
“Opening workspace”; trace data showed successful `/api/workspace` and
`/api/project` responses, and the welcome action became enabled at the 15-second
click timeout boundary. A retry timed out while generating the shared
`professionalCutDeskFixture` in the `beforeAll` hook. Neither attempt reached
the shortcut assertions, and the cause is unconfirmed; neither is passing
evidence for this base. The same profile scenario passed once before rebasing
onto PR #112's final test-host fix. The PR's GitHub checks must provide the
clean-runner browser validation.

The initial #113 browser run also found that the native-runtime shortcut test
fixture did not inject the profile resolver and used nonstandard codes for
letter events. The fixture now injects the default profile/resolver and uses
`KeyJ`-style codes. A direct Windows run is blocked while esbuild resolves
Vue's internal packages through the local `.pnp.cjs`; GitHub CI must validate
the updated fixture.

## Remaining verification

Physical keyboard layouts, OS-level key reservations, and native desktop
behavior still need checks on supported Windows and macOS workstations. Those
checks are separate from this shortcut-profile PR.
