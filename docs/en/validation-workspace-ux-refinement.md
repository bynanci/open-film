# Workspace UX refinement validation

- Branch: `codex/story-arc-authoring`
- Base: `b39c2c369d584fa0bb4f75734737d4ebd68d928a`
- Fixtures: procedural synthetic photo/video only, under temporary directories.
- Project schema and existing editing contracts are unchanged.

## Checks

| Command / coverage             | Result                                                   |
| ------------------------------ | -------------------------------------------------------- |
| `pnpm format:check`            | Pass                                                     |
| `pnpm test:i18n`               | Pass: 2,253 matching keys in three locales               |
| `pnpm lint`                    | Pass, zero warnings                                      |
| `pnpm typecheck`               | Pass                                                     |
| `pnpm build`                   | Pass; existing large application-chunk advisory remains  |
| Six relevant Playwright suites | Pass: 29/29, including 13 precision-editing regressions  |
| Full `pnpm test`               | Pass: 275 files / 3,781 tests in the isolated serial run |
| `git diff --check`             | Pass                                                     |

The Playwright command used `story-workflow-ux`, `workspace-shell`,
`story-arc-authoring`, `global-visual`, `global-workflow` and `precision-editing`
specs with `PLAYWRIGHT_BROWSERS_PATH=/tmp/openfilm-playwright-browsers`.
This is the relevant browser regression selection, not the entire
`pnpm test:e2e` suite.

The full Vitest command uses
`OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python` (OpenTimelineIO 0.18.1).
No dependency, interpreter or browser binary is added to the repository.

### Validation scheduling failure and correction

The first full Vitest run was incorrectly scheduled concurrently with the
Playwright server. `native-benchmark-runner.test.ts` requires exclusive use of
port 4310 and correctly refused to start while the browser fixture held it.
That run ended with 274 files / 3,769 tests passing and 12 benchmark tests
failing from occupied-port / missing-terminal-evidence errors. Browser checks
passed 29/29. Once the browser server exited, port 4310 was checked as available
and the entire Vitest suite was restarted alone, with unchanged assertions.
The isolated rerun passed all 275 files / 3,781 tests in 339.72 seconds,
including all 12 previously blocked benchmark cases. Run the full Vitest and
Playwright server suites sequentially because they share this port.

## Regression coverage

`tests/unit/storyboard-ux.test.ts` covers overlapping clip time, foreign-story
mapping, native nested keyboard actions and offline preview availability.
These four regressions were reproduced before fixing the component.

`tests/e2e/story-workflow-ux.spec.ts` exercises inline validation/focus,
authored-order preview, draft dismissal/reopening, actual source photo/video
preview, native Enter/Space, Escape/focus restoration, tab relationships and
keyboard navigation, empty-search recovery, skip navigation and safe pipeline
inspection. Existing visual/workflow and precision-editing regressions remain
required. Image previews are checked for decoded natural dimensions and MP4
previews for readyState and decoded video width. A deliberately aborted source
request must show a retry state and successfully reload the original source.

Rendered new-screen checks cover en-US, zh-TW, ja-JP and expanded en-XA at
1024/1440 widths in both themes, with synthetic long CJK headings. Existing core
visual checks also cover 1280×720 and 1920×1080. Axe checks exercise story setup
and the storyboard. Screenshots are local Playwright outputs, using synthetic
media only; physical-device visual approval remains a manual gate.

## Manual gates

- VoiceOver/NVDA and touch/pen on physical Windows/macOS workstations remain
  unverified. Automated browser/axe checks do not certify those environments.
- These changes do not introduce renderer effects or shot/emotional runtime
  proposal support. Full cinema-foundation sidecar integration is a follow-up.
- No usability study was performed; no measured task-time improvement or
  aesthetic quality score is claimed.
