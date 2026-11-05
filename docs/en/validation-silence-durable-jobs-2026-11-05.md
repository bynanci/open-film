# Silence Durable Jobs validation — 2026-11-05

This record covers the local Silence Job and HTTP API candidate on branch
`codex/silence-durable-jobs`. It was based on the latest fetched `main` at
`e3f94f9cda161a3f955275a1a77f5f13d2bf7834`; PR #100's existing
`SilenceService` is reused. The candidate does not merge or publish itself.

## Implemented boundary

- SQLite stores the `silence-analysis` Job identity, owner, request fingerprint,
  source SHA-256, Composition revision, progress, attempt and Review ID.
- Create is request-idempotent across processes. Freshness remains a separate
  `current | stale | unverified` value.
- The local HTTP API exposes create, Job, Review, cancel, retry, recover and
  explicit apply. Analysis completion never edits the Composition.
- Apply requires the exact private Review and uses the existing
  `TimelineEditor` `silence.ripple` path. The Job service and composition HTTP
  routes share one application TimelineEditor, so a successful Apply enters
  that session's Undo/Redo history. A bounded project receipt is saved with the
  edit and repairs a failed Job acknowledgement on exact replay after restart.
- A source/revision mismatch is rejected without reanalysis. Locks, user pins,
  independent audio timing, source media immutability and editor protection
  remain enforced.
- Local gain automation is not yet remapped through a partial ripple. A review
  that would trim or split an automated clip fails before publishing a Review
  with `timeline.audioAutomationConflict`. An intact clip shifted by a ripple
  retains its local automation. Exact point/fade/ducking remapping remains a
  follow-up.

## Verification evidence

| Check                                                | Result                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                  | Passed                                                                                                      |
| `pnpm lint`                                          | Passed                                                                                                      |
| `pnpm typecheck`                                     | Passed                                                                                                      |
| `pnpm build`                                         | Passed; the existing desktop JavaScript chunk is about 1.72 MB and exceeds Vite's 500 kB warning threshold. |
| `pnpm test:contracts`                                | 77 files, 1,491 tests passed                                                                                |
| `pnpm test:i18n`                                     | 3,034 locale keys and error references validated                                                            |
| `pnpm test:docs-i18n`                                | Passed; 153 English reference mirrors validated.                                                            |
| Focused silence/application/catalog/media/HTTP suite | 9 files, 151 tests passed                                                                                   |

The focused command was:

```sh
pnpm exec vitest run \
  packages/core/tests/audio-activity.test.ts \
  packages/core/tests/silence-job-contract.test.ts \
  packages/catalog/tests/analysis-ownership.test.ts \
  packages/application/tests/silence-review.test.ts \
  packages/application/tests/editor.test.ts \
  packages/application/tests/silence-jobs.test.ts \
  packages/media/tests/audio-activity.test.ts \
  packages/media/tests/canonical-audio.test.ts \
  tests/integration/silence-jobs-http.test.ts
```

These tests use generated WAV data. The HTTP integration test invokes the real
FFmpeg audio analysis path and checks actual source hashes. It also exercises
explicit Apply, HTTP Undo/Redo, duplicate Apply after reopen, cancellation,
retry, stale source/revision rejection, no Review for automated clip splits,
concurrent request reservation from two live server processes, and recovery
after killing the Job-owning child process. Unknown owner recovery requires the
observed checkpoint and explicit stopped-process confirmation.
The project-version HTTP adapter regression also passed (3 files, 21 tests),
including the shared editor session-state reset after restoring a snapshot.

The local automation regression was first run without the fix: the new
proposal-protection test failed (`1 failed / 27 passed`) because the original
path accepted a ripple that would split a clip with automation. With the typed
fail-closed rule, the test passes and the real HTTP Job ends `failed` without a
fetchable Review.

## Not established by this record

- GitHub Actions on the pushed PR head are pending review/run.
- Full `pnpm test`, full `pnpm test:media`, browser E2E and native-shell suites
  were not run for this candidate.
- No Windows/macOS workstation, clean installer, update/rollback, Resolve,
  external-disk, GPU/4K or listening evidence is claimed.
- Signing/notarization, installer provenance and the separate Tokio, GLib and
  `proc-macro-error` advisory/maintenance warnings are not resolved here.

This is focused code and media evidence, not a release-readiness certification.
