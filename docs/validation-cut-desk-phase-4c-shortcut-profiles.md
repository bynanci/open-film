# Cut Desk Phase 4C shortcut profiles — validation

- Date: 2026-11-05
- Feature branch: `codex/cut-desk-phase-4c-shortcut-profiles`
- Review base: `main` at `92ccf361642f060466b269dc2fcf3ed4d77102b3` (PR #112 merged)

Phase 4C is isolated from the original mixed worktree and contains only the
shortcut-profile feature. PR #113 now targets `main`; its diff contains only
Phase 4C after PR #112 merged as `92ccf36`.

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

The #113 browser run passed shards 1, 3, and 4. Shard 2 exposed a fixture
boundary error: values declared in the Node test module are not captured by
`page.evaluate`. The fixture now passes the default profile and action IDs as
serializable arguments and rebuilds the pure production resolver from its
source, with the scope helper supplied in the browser context. Review also
found letter events using nonstandard `code` values; those now use `KeyJ`-style
codes. The corrected fixture needs a fresh CI run. A direct
Windows run is blocked while esbuild resolves Vue's internal packages through
the local `.pnp.cjs`.

## Remaining verification

Physical keyboard layouts, OS-level key reservations, and native desktop
behavior still need checks on supported Windows and macOS workstations. Those
checks are separate from this shortcut-profile PR.
