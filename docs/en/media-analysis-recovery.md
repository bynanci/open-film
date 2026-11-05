# Media-analysis ownership and recovery

Opening a film must not stop transcription, waveform generation, scene analysis
or reviewed silence analysis that another OpenFilm process is still running.
These operations use
the existing Job model with an optional `analysisOwner` execution identity. No
new worker runtime or catalog migration is needed; legacy ownerless jobs remain
readable and require explicit recovery when unfinished.

## What users see

Activity, Precision and Transcript share the same ownership status. A task owned
by this server offers Cancel. A task running elsewhere retains its progress and
does not offer a Cancel action that this server cannot perform. Unknown owners
offer recovery only after the user confirms that the previous process stopped.
Recovery preserves saved recognition, manual corrections, waveform/scenes,
markers, Story, composition and original media. It does not automatically retry
or replace text. Use the existing Analyze/Transcribe controls to retry explicitly;
the normal edited-transcript warning and draft flush still apply.

An observer can use Switch Project while a foreign analysis continues. Only a
matching runtime status with `canCancel: false` allows this exception; local work,
other job types and missing runtime status remain blocked. Closing flushes
edits and rechecks a fresh job snapshot before the server's final local-work
guard. Pending Precision analysis/marker requests also prevent leaving or changing
sources until they settle. Switching does not cancel or recover the foreign Job.

Undo/Redo also waits for pending Precision submissions. Conversely, marker and
analysis controls cannot submit during a composition history change. Ordinary
unsaved composition edits retain their existing one-step Undo behavior.

The confirmation is bound to the exact observed Job digest and owner token. If
another process changes that checkpoint, refresh the status and inspect it again.
Recovery never signals a foreign PID or forcibly terminates an arbitrary provider.

## Conservative owner evidence

The same owner helper used for language/glossary review binds Linux evidence to
the host, boot and PID namespace. On Windows it hashes the machine identity and
OS boot time with the host; the raw machine identifier is not stored in a project.
The bounded, read-only OS query uses the system PowerShell without profiles or a
visible window and only the trusted inbox system module path. If its initial
5-second query fails, owner inspection may revalidate once with the same deadline.
Only verified machine/boot evidence replaces the unavailable scope. Local tokens
remain bound to the exact host identity with which this process created them,
so revalidation cannot orphan its queued work or authorize a retagged token.
A failed revalidation stays unavailable; no polling loop or PID-only fallback.
Missing, malformed or unavailable evidence leaves that execution unverifiable. A matching scope and live PID are preserved.
Only `ESRCH` proves a stopped owner; permission failures, foreign scopes, old boots,
legacy missing identities and PID reuse are not evidence that a process stopped.
An occupied reused PID remains conservatively live and cannot grant local token
ownership. macOS still has no verified automatic dead-owner detection and retains
the explicit workstation confirmation gate.

Opening or starting analysis recovers only proven-dead work. Alive or unknown
unfinished work keeps the analysis slot occupied. `silence-analysis` uses the
same project reservation and owner proof. Its `waiting-review` state releases
the shared analysis slot while preserving the exact Review for inspection.
Analysis completion never applies an edit.

This is scoped to media-analysis operations, not a general multi-writer contract
for project files, import, rendering or every plugin.

## Durable boundaries

- Reservation checks and INSERT run in one SQLite `BEGIN IMMEDIATE` transaction.
  Transcription, waveform, scene and silence analysis share one project slot.
  Another process cannot start duplicate work or reuse an existing Job ID.
- Execution consumes the exact queued reservation once, with a locally owned
  token. Progress and terminal failure/cancellation are UPDATE-only and require
  matching owner, asset, operation and durable active status.
- Successful transcript or cache publication and completed Job status share the
  existing analysis transaction. Ownership loss rolls both back. Transcript
  revision conflict checks and source identity checks still apply.
- Explicit recovery rotates the owner and compare-and-sets the exact stored Job.
  Retained callbacks, obsolete results and HTTP preparation failures cannot
  revive that execution or overwrite the successor's saved result.
- Silence Jobs capture project, asset, Composition, revision, actual SHA-256,
  normalized detector options, owner token and attempt in SQLite. Create request
  IDs are idempotent: identical normalized input returns the original Job, while
  changed input returns 409. Freshness (`current`, `stale`, `unverified`) is
  independent of the Job state.
- Silence retry preserves the captured revision, source hash and options, and
  rotates the owner. Stale retries are rejected. Up to 100 retry receipts remain
  durable so an old retry ID cannot start a new attempt after a later failure.
- Silence Apply accepts only the privately persisted Review through the existing
  `SilenceService` and `TimelineEditor` `silence.ripple` command. A bounded
  project manifest receipt is saved with the edit; replay after restart repairs
  a failed Job acknowledgement without applying twice. New Apply operations
  fail closed when the project reaches 200 receipts.
- Review creation fails with `timeline.audioAutomationConflict` when a silence
  cut would trim or split a clip carrying local gain points, fades or ducking.
  The current ripple contract does not remap those clip-local curves, so it does
  not publish a Review that could move the curve, restart a fade, or exceed the
  shortened clip. Automation on a clip shifted intact by a ripple remains valid.
  Adjust the affected clip and create a new Review before applying the edit.

Application callers, HTTP and CLI share these boundaries. Logical cancellation
from [PR #8](https://github.com/bynanci/open-film/pull/8) still releases a provider
wait; physical termination remains the provider's responsibility.

## Headless and HTTP recovery

```sh
openfilm intelligence jobs --project film.openfilm
openfilm intelligence recovery JOB_ID --project film.openfilm
# Use only after confirming the earlier process is stopped.
openfilm intelligence recover JOB_ID --project film.openfilm --confirm-stopped
```

`GET /api/jobs` retains `jobs` and adds an `analysisRecovery` map for active
analysis. Runtime `canCancel` comes from this server's AbortController ownership,
not from PID liveness. `GET /api/intelligence/jobs/:id/recovery` returns the owner
state, confirmation capability, checkpoint and token. POST
`/api/intelligence/jobs/:id/recover` accepts only
`{ confirmStopped, checkpoint, ownerToken? }` and returns `{ job }`. An active
local or proven-live foreign owner rejects takeover. A changed checkpoint rejects
the request without changing saved evidence.

### Silence Job HTTP contract

All paths below are local-server endpoints. Request bodies reject unknown
fields. Identity, reservation, ownership, stale revision/hash and idempotency
conflicts return 409. A Review is returned only when the Job durably owns its
`reviewId`.

| Request                                 | Body                                                         | Response                            |
| --------------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| `POST /api/silence/jobs`                | `{ projectId, requestId, assetId, compositionId, options? }` | `202 { job, created, freshness }`   |
| `GET /api/silence/jobs/:jobId`          | —                                                            | `200 { job, freshness, recovery? }` |
| `GET /api/silence/jobs/:jobId/review`   | —                                                            | `200 { job, freshness, review }`    |
| `POST /api/silence/jobs/:jobId/cancel`  | `{}`                                                         | `200 { job }`                       |
| `POST /api/silence/jobs/:jobId/retry`   | `{ requestId }`                                              | `202 { job, created }`              |
| `POST /api/silence/jobs/:jobId/recover` | `{ confirmStopped, checkpoint, ownerToken? }`                | `200 { job }`                       |
| `POST /api/silence/jobs/:jobId/apply`   | `{ reviewId, proposal, requestId }`                          | `200 { job, edit }`                 |

`options` is bounded to `thresholdDb` [-80, -10],
`minimumSilenceSeconds` [0.1, 30] and `paddingSeconds` [0, 2]. Defaults are
-40 dBFS, 0.5 seconds and 0.12 seconds. Repeating a create request with the same
`requestId` and normalized payload returns the original Job and never starts
another runner; changed input with that key returns 409.

Cancel is available only to this process's active owner or its locally owned
queued reservation. Recover requires stopped-process confirmation and the exact
observed checkpoint and owner token; it never signals another process. Recovery
moves interrupted work to `failed`; retry remains explicit. `waiting-review` and
`completed` reviews remain fetchable, but Apply requires the exact persisted
proposal. Reusing an Apply request ID with a different proposal or review ID is
rejected.

SQLite owns Job state. Review JSON stays in the project-private
`analysis/silence-reviews/` directory. Review publication precedes the
`waiting-review` Job compare-and-set, so a failed Job write can leave an
inaccessible orphan Review but cannot make it listable or applicable. Apply
receipts store identifiers and hashes only; they do not contain proposal text or
media bytes.

See [validation](validation-media-analysis-recovery.md) for exact executed gates.
The Silence Job/API slice has a separate dated
[validation record](validation-silence-durable-jobs-2026-11-05.md).
Real ASR quality, GPU, cameras, large 4K sources, native installers and Resolve
remain separate [workstation gates](workstation-qa.md).
