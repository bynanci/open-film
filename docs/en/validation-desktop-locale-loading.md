# Desktop Locale Loading Validation

Rechecked on 2026-11-06 against `main` at
`b6304914a7eb351d8e5d0a0a11b41e163713e20b`. Environment: Linux x86_64,
Node.js 24.19.0, pnpm 11.19.0, Vite 8.2.4, Chromium through Playwright.

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

| Resource                    |  Minified |     gzip | Loading       |
| --------------------------- | --------: | -------: | ------------- |
| Traditional Chinese catalog | 145.85 kB | 54.93 kB | When selected |
| Japanese catalog            | 195.20 kB | 58.08 kB | When selected |

The current entry and its five static JavaScript preloads total 556.04 kB
minified / 181.11 kB gzip. The initial stylesheet is 195.75 kB / 31.54 kB gzip.
`index.html` references neither non-English catalog; English is bundled with
the locale runtime as the fallback.

The prior initial bundle recorded in `TASKS.md` was 1.72 MB minified / 508 kB
gzip, with both non-English catalogs included. The candidate build still warns
that the main application entry exceeds 500 kB; this change defers the two
message catalogs and does not split the rest of the application.

## Verification

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed; emitted the main-entry size advisory described above.
- `pnpm build` — passed; produced separate 145.85 kB Traditional Chinese and
  195.20 kB Japanese catalog chunks.
- `pnpm test:i18n` — 3,159 semantic keys and placeholders validated across all
  three production locales.
- `pnpm exec vitest run tests/unit/i18n.test.ts --maxWorkers=1` — 12 passed.
- `pnpm exec playwright test tests/e2e/editing.spec.ts --grep 'switches editor language in place'` — 1 passed.

## Limits

No native cold-start result is claimed. This is a production browser bundle
measurement, not an installer or clean-machine startup benchmark. Locale
switching depends on the local chunk being available; a failed load leaves the
current locale active and does not persist the requested locale.
