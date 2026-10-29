# Direct clip-picture manipulation — validation

Date: 2026-10-29. Dependency implementation tree:
`e9a531d499b1e3a6477ab1c06305e9b39b869247`. PR base after the dependency
merge: `57f244aa7e28989b14d532790f2fcb8c8f9a0fcb`. Recovery source branch:
`codex/direct-manipulation-editing` at
`1440e95b7bd1bbf40883de49c007574f2354fac1`.

This is a selective recovery, not a merge of the old branch. The retained scope
adds direct move and proportional corner resize to the General Story monitor.
It keeps the existing Composition `ClipTransform`, typed `transform` command,
preview geometry, atomic transaction, Undo/Redo and autosave/reopen paths. It
does not add a second timeline, a new project field, free rotation, opacity,
z-order or new ripple semantics.

## Recovery review

The old time-proportional track preview rippled every track. Current solver
semantics exclude `timing: "overlay"` tracks from film ripple and reconcile
overlays separately, so that preview could disagree with the accepted edit. The
old gesture queue also predates current exact-request persistence, rollback,
owner disposal and stale-revision fencing. Both implementations were rejected.

The recovered overlay uses pure CSS-pixel-to-frame-pixel geometry helpers and
the current `commitTransaction` boundary. Pointer preview is ephemeral;
pointer-up submits one complete transform command. Escape, pointer cancellation
or capture loss, blur, viewport/geometry changes, selection/revision/project
owner changes and disabling cancel the draft and restore the authoritative
saved transform. Source media is never overwritten.

## Automated evidence

Focused unit and render-boundary execution:

```text
pnpm exec vitest run   tests/unit/clip-transform-interaction.test.ts   tests/unit/clip-transform-overlay.test.ts   tests/unit/timeline-clip-render-boundary.test.ts

3 files, 93 tests passed
```

The pure interaction matrix covers viewport conversion, every corner at
0/37/90/180/-25 degrees, opposite-corner anchoring, the positive scale floor and
non-finite/invalid input rejection. Component tests cover labelled keyboard and
pointer targets, one keyboard commit, cancellation and the coarse-pointer CSS
contract.

The dedicated Chromium regression runs the real application/API boundary:

```text
pnpm exec playwright test tests/e2e/direct-clip-manipulation.spec.ts

5 tests passed
```

It proves one pointer gesture produces one typed transaction, fractional
viewport fitting is converted to the same persisted composition-space values,
Escape creates no edit, Undo/Redo and reopen preserve the acknowledged value,
locked clips cannot enter adjustment, viewport changes cancel without a
transaction, rejected transactions restore the authoritative transform, original
source hashes remain unchanged and all four coarse-pointer corner targets are at
least 44 by 44 CSS pixels. Four-point `elementFromPoint` sampling additionally
proves each full target remains hit-testable rather than being clipped by the
monitor or covered by its toolbar.

Local gates executed on this branch:

| Gate                             | Result                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | passed on the dependency base                                              |
| `pnpm format:check`              | passed                                                                     |
| `pnpm test:i18n`                 | passed; 2,394 semantic keys                                                |
| `pnpm test:docs-i18n`            | passed                                                                     |
| `pnpm lint`                      | passed                                                                     |
| `pnpm typecheck`                 | passed                                                                     |
| `pnpm build`                     | passed; existing chunk-size advisory only                                  |
| `pnpm test:interchange`          | passed; 18 Python tests and official OpenTimelineIO 0.18.1 read/write/read |
| complete `pnpm test`             | passed; 297 files and 4,285 tests                                          |
| complete `pnpm test:e2e`         | passed; 276 browser regressions in Chromium                                |
| `pnpm test:native`               | not run locally; Cargo is unavailable                                      |

The first local interchange invocation intentionally remains recorded: its 18
standard-library tests passed, then the official parser phase stopped because
`opentimelineio` was absent. A temporary virtual environment with the CI-pinned
`opentimelineio==0.18.1` was used for the successful rerun; no global or project
environment was modified.

## Manual and hosted gates

Physical Windows/macOS mouse and trackpad behavior, high-DPI scaling, touch
hardware and color-managed monitor inspection remain workstation gates. Native
Rust/Tauri validation and the complete exact-head GitHub matrix must pass before
merge. Browser evidence does not claim those physical checks.
