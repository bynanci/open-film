# Media-analysis ownership and recovery

Opening a film must not stop transcription, waveform generation or scene analysis
that another OpenFilm process is still running. These three operations now use
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
the host, boot and PID namespace. A matching scope and live PID are preserved.
Only `ESRCH` proves a stopped owner; permission failures, foreign scopes, old boots,
legacy missing identities and PID reuse are not evidence that a process stopped.
Windows/macOS do not yet have verified automatic dead-owner detection and retain
the explicit workstation confirmation gate.

Opening or starting analysis recovers only proven-dead work. Alive or unknown
unfinished work keeps the analysis slot occupied. This is scoped to the three
media-analysis operations, not a general multi-writer contract for project files,
import, rendering or every plugin.

## Durable boundaries

- Reservation checks and INSERT run in one SQLite `BEGIN IMMEDIATE` transaction.
  All three analysis operations share one project slot. Another process cannot
  start duplicate work or reuse an existing Job ID.
- Execution consumes the exact queued reservation once, with a locally owned
  token. Progress and terminal failure/cancellation are UPDATE-only and require
  matching owner, asset, operation and durable active status.
- Successful transcript or cache publication and completed Job status share the
  existing analysis transaction. Ownership loss rolls both back. Transcript
  revision conflict checks and source identity checks still apply.
- Explicit recovery rotates the owner and compare-and-sets the exact stored Job.
  Retained callbacks, obsolete results and HTTP preparation failures cannot
  revive that execution or overwrite the successor's saved result.

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

See [validation](validation-media-analysis-recovery.md) for exact executed gates.
Real ASR quality, GPU, cameras, large 4K sources, native installers and Resolve
remain separate [workstation gates](workstation-qa.md).
