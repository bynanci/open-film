# Desktop Locale Loading Validation

Measured on 2026-11-06 in a Windows worktree based on `main` at
`1bafb5cd4532ce9f9a171499abc8631e4863d1ee`. Environment: Node.js 24.14.0,
pnpm 11.11.0, Vite 8.2.4, Chromium through Playwright.

## Behavior

The initial Desktop catalog contains English, which remains the fallback.
Traditional Chinese and Japanese are imported only after locale resolution
selects them. The bootstrap waits for a saved or browser-selected locale before
mounting the first view, preventing an English flash while the selected local
chunk loads. After the runtime reports the host OS language, the existing
initializer can load and activate that catalog. Explicit language changes are
asynchronous, persist only after the catalog loads, and ignore stale completion
from an earlier selection.

The unit test verifies that `zh-TW` and `ja-JP` are not registered initially,
then selects Traditional Chinese and checks its real translated message. The
existing editing E2E switches the mounted editor through Traditional Chinese,
Japanese and English and checks that the editor state remains mounted.

## Production bundle

`pnpm build` completed successfully. The `index.html` entry references no
non-English locale chunk. The build emits the following separate assets:

| Resource                    |    Minified |      gzip | Loading       |
| --------------------------- | ----------: | --------: | ------------- |
| Initial JavaScript entry    | 1,460.63 kB | 417.07 kB | Startup       |
| Traditional Chinese catalog |   145.52 kB |  54.83 kB | When selected |
| Japanese catalog            |   194.63 kB |  57.91 kB | When selected |

The prior initial bundle recorded in `TASKS.md` was 1.72 MB minified / 508 kB
gzip, with both non-English catalogs included. The candidate build still warns
that the main application entry exceeds 500 kB; this change defers the two
message catalogs and does not split the rest of the application.

## Verification

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed; emitted the main-entry size advisory described above.
- `pnpm test:unit` — 233 files passed, 3,588 tests passed and 2 skipped.
- `pnpm test:i18n` — 3,156 semantic keys and placeholders validated across all
  three production locales.
- `pnpm exec vitest run tests/unit/i18n.test.ts --maxWorkers=1` — 12 passed.
- `pnpm exec playwright test tests/e2e/editing.spec.ts --grep "switches editor language in place"` — 1 passed.

## Limits

No native cold-start result is claimed. The standard release executable was not
present during this run, and this measurement is a production browser bundle
comparison, not an installer or clean-machine startup benchmark. Locale
switching depends on the local chunk being available; a failed load leaves the
current locale active and does not persist the requested locale.
