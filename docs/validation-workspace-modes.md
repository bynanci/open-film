# Workspace modes validation

- Branch: `codex/story-arc-authoring`
- Base: `b39c2c369d584fa0bb4f75734737d4ebd68d928a`
- Candidate includes the existing uncommitted story-authoring and surface work.
- Fixtures: procedural synthetic PNG/video only; local temporary evidence.
- No dependency, project schema, renderer, provider or media mutation is added.

## Checks

| Local gate                     | Result                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pnpm format:check`            | Pass                                                                                              |
| `pnpm test:i18n`               | Pass: 2,268 semantic keys in three locales                                                        |
| `pnpm lint` / `pnpm typecheck` | Pass                                                                                              |
| `pnpm build`                   | Pass; existing >500kB application-chunk advisory remains                                          |
| Three new unit files           | Pass: 31 cases                                                                                    |
| Eight relevant browser suites  | Pass: 48/48, including 11 new mode cases                                                          |
| Full `pnpm test`               | Pass: 278 files / 3,819 tests in 343.10 seconds                                                   |
| `pnpm test:interchange`        | Pass: 18 harness tests, official OTIO 0.18.1 read/write/read, source hashes/bounds and relocation |
| `git diff --check`             | Pass                                                                                              |

New unit coverage checks safe preference defaults, persistence alongside existing
preferences, denied storage, multilingual/NFKC search, disabled results, shortcut
conditions, closed dispatch, review-state availability and stale generation/focus.

`workspace-modes.spec.ts` checks guided defaults, device persistence, keyboard
search/empty/disabled states, focus restoration, native Close and Space activation,
manual drafts/IME/dialog boundaries, failed-save gates, autosave acknowledgement,
selection, Undo, playhead and clip locks across mode changes. Both themes cover
640/768/900/1100/1280/1600/1920 widths; Traditional Chinese and expanded en-XA
exercise Story/Edit toolbar labels. Command dialogs retain axe AA checks.

The existing seven browser suites remain required: responsive-surfaces,
story-workflow-ux, workspace-shell, story-arc-authoring, global-visual,
global-workflow and precision-editing. They are the relevant regression
selection, not the full repository E2E suite. Full Vitest and Playwright run
sequentially because benchmark-process cases require exclusive port 4310.

## Reproduced defects and review

- Native dialog Close/Enter originally executed the selected command. A browser
  RED demonstrated incorrect navigation/focus; only search-field Enter now runs
  commands and native buttons retain their own activation.
- Autosave refreshed the catalog and reset a keyboard-selected action. A held
  real write reproduced the reset; selection now follows the enabled action ID.
- A reopened session could receive focus after the final await in a perspective
  command. The actual App dispatch regression failed before the added owner check.
- Timeline playback shortcuts consumed Space on new tool/quick-action controls.
  Native activation regressions failed before local propagation guards.
- Fresh read-only review found story-perspective actions appeared enabled during
  script-review busy/pending states. Actual-catalog REDs reproduced both states;
  availability and explanation now follow the existing review gate.
- Screenshot inspection found vertical CJK Inspector labels. Rendered label
  height/layout assertions reproduce the cramped controls; intrinsic tab sizing
  allows horizontal text to wrap into usable rows.
- The first full browser selection ended with 45/47 passing. Its two failures
  exposed clipped pseudo-locale mode descriptions and navigation offered during
  initial editor loading. Description cards now wrap; the shared editor exposes
  read-only loading state so actions remain unavailable until hydration finishes.
  A held real editor read and an actual-catalog unit RED reproduce the load gate.
  The corrected affected selection passed 16/16 without altering save/recovery
  behavior or weakening layout assertions. Final complete results supersede
  this intermediate run.

An intermediate browser check used an English/zh-TW/ja-JP helper with en-XA,
which it does not support. Tests now navigate semantically before applying the
pseudo-locale for layout measurement; assertions are unchanged. This was a test
setup defect, not evidence of a translation/runtime failure.

## Limits

Results are local automation, not hosted CI or workstation certification.
The full E2E repository selection and `pnpm test:native` are not rerun for this
web UI change. Native WebView/Windows/macOS, physical browser zoom, screen readers,
OS IME and touch/pen remain manual gates. Unrelated historical dirty changes and
unproven races in existing application navigation were excluded from the focused
fresh review; existing full/selected regressions still cover their integration.
