# Durable silence analysis jobs

Status: implementation design for the `main` baseline `e3f94f9cda161a3f955275a1a77f5f13d2bf7834`.

## Intent

Expose the existing source-bound `SilenceService` as a durable, cancellable,
review-first HTTP workflow. Persist execution identity in the existing SQLite
`jobs` table and keep the current `TimelineEditor` as the only composition
writer. A completed analysis creates an exact persisted proposal; it never
edits a timeline until an explicit, exact-proposal Apply request.

## Goals and boundaries

- Persist operation/job/project/asset/composition identities, captured
  composition revision, source hash, progress, execution owner and review ID.
- Support `queued`, `running`, `waiting-review`, `failed`, `cancelled`, and
  `completed` lifecycle states. Freshness is a separate derived value so a
  stale review remains inspectable without pretending its execution failed.
- Make create requests idempotent by `requestId`, with conflicting reuse
  rejected. Fence every progress/result write by the original owner token and
  exact durable state.
- Cancel only work owned by the serving process. Recover only after the
  existing owner proof or explicit stopped-process confirmation. Recovery
  marks an interrupted attempt failed; only explicit retry starts new work.
- Require exact source hash, composition revision, review ID and review
  proposal at Apply. Preserve existing source immutability, locks, pins,
  canonical audio checks, editor history and Undo/Redo behavior.
- Persist bounded silence Apply receipts with the project so a repeated exact
  request remains acknowledgeable after process restart, including the narrow
  window where the Composition save succeeded but the Job status write did not.
- Keep analysis and immutable review files in the current project-private
  storage boundaries. Orphaned review files after a failed SQLite transition
  are not discoverable or applicable without a matching durable job.

Non-goals: a new queue/runtime, a second timeline/editor, automatic Apply,
desktop editing UI, external providers, broad multi-writer project support,
and changes to the existing silence algorithm.

## Approaches

1. **Selected: `SilenceJobService` orchestration over existing services.** Add
   durable job lifecycle and HTTP coordination while delegating analysis,
   private Review persistence and composition edits to `SilenceService` and
   `TimelineEditor`. Reuse `CatalogIntelligenceStore` reservation/CAS and
   `analysisOwner`. This keeps shared project serialization and ownership
   guarantees while limiting changes to the existing media intelligence path.
2. Put silence editing directly inside `MediaIntelligence`. This reuses the
   class but mixes proposal-backed editing with transcript/waveform/scene cache
   producers and broadens their regression surface.
3. Add a separate queue or SQLite table. This isolates code but duplicates the
   reservation, owner-token, recovery and concurrency protocol and can race
   existing project analysis jobs.

The request selects approach 1 by requiring the existing Job/reservation and
SilenceService/TimelineEditor contracts to be reused.

## Durable state and identity

The generic `Job` receives the additive `waiting-review` status and an optional
versioned `silenceAnalysis` record:

```ts
interface SilenceAnalysisJobData {
  version: 1;
  projectId: string;
  compositionId: string;
  baseRevision: string;
  requestId: string;
  requestFingerprint: string;
  options: {
    thresholdDb: number;
    minimumSilenceSeconds: number;
    paddingSeconds: number;
  };
  sourceHash?: string;
  reviewId?: string;
  retryRequests?: { requestId: string; fingerprint: string; attempt: number }[];
  applyRequestId?: string;
  appliedRevision?: string;
}
```

`Job.type` is `silence-analysis`; its existing `id`, `assetId`, `progress`,
`analysisOwner`, timestamps and errors remain authoritative. `sourceHash` is
seeded from the imported asset when available and is validated against actual
source bytes before analysis and Apply. Legacy assets without a catalog hash
may establish it once from the verified source snapshot; after it is recorded,
every retry must match it. The captured `baseRevision` never changes on retry.

SQLite reservation checks and insertion, including `requestId` lookup, occur in
one `BEGIN IMMEDIATE` transaction. Equal request ID and equal normalized
fingerprint returns the original job; equal request ID with different project,
asset, composition, revision or options returns 409. Silence shares the current
project-wide analysis slot with transcription, waveforms and scenes. A job in
`waiting-review` releases that execution slot.

Retry request receipts are retained as a bounded list (maximum 100) so replay
of an earlier retry remains idempotent even after later attempts. Capacity
exhaustion rejects another retry rather than dropping receipts.

Freshness is returned separately as `current`, `stale`, or `unverified`:
composition revision and known catalog source-hash mismatches are stale;
unknown actual bytes remain unverified until the existing source verifier
checks them. Apply always performs the full current-byte and stored-review
verification, regardless of the summary freshness value.

`OpenFilmProject.silenceApplyReceipts` stores at most 200 bounded receipts
`{ version: 1, jobId, requestId, fingerprint, compositionId, reviewId,
baseRevision, appliedRevision, appliedAt }`. The existing editor writes this
receipt in the same atomic project manifest publication as the accepted
Composition. An exact repeated request acknowledges the recorded revision
without replaying the command; reusing its request ID with another payload is a 409. This also lets the durable Job transition be retried safely after a
SQLite write failure.

## HTTP contract

All routes require the current local project and use the server's existing
strict JSON field validation and error envelope.

| Method and route                        | Request                                                      | Result                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `POST /api/silence/jobs`                | `{ projectId, requestId, assetId, compositionId, options? }` | `202 { job, freshness }`; idempotent duplicate returns the same durable job without starting another worker |
| `GET /api/silence/jobs/:jobId`          | none                                                         | `200 { job, freshness, recovery? }`                                                                         |
| `GET /api/silence/jobs/:jobId/review`   | none                                                         | `200 { job, freshness, review }` only when the job owns a persisted review                                  |
| `POST /api/silence/jobs/:jobId/cancel`  | `{}`                                                         | `200 { job }`; only a local abort controller can cancel                                                     |
| `POST /api/silence/jobs/:jobId/retry`   | `{ requestId }`                                              | `202 { job }`; only failed/cancelled attempts, same captured identities, new owner token                    |
| `POST /api/silence/jobs/:jobId/recover` | `{ confirmStopped, checkpoint, ownerToken? }`                | `200 { job }`; exact checkpoint and stopped-owner confirmation required                                     |
| `POST /api/silence/jobs/:jobId/apply`   | `{ reviewId, proposal, requestId }`                          | `200 { job, edit }`; exact persisted proposal and captured identities required                              |

Unknown jobs/reviews return 404; invalid bodies return 400; identity,
reservation, owner, freshness and repeated-key conflicts return 409; unsupported
media retain existing typed 422/413 responses. Apply is never implicit. The
same apply request is acknowledged idempotently; a request ID reused with a
different review payload is rejected. A durable completed Job stores the
accepted review identity and acknowledged revision so repeated HTTP calls do
not apply a second edit.

## State flow

```text
POST -> queued --owner CAS--> running --verified analysis + durable Review--> waiting-review
                                  |                                         |
                                  +--cancel--> cancelled                   +--explicit exact Apply--> completed
                                  +--error--> failed
dead owner / confirmed recovery -> failed --explicit retry + new owner--> queued
```

Stale freshness is orthogonal to every state. A stale queued/running attempt
fails closed; a stale waiting-review job stays available for inspection but
Apply rejects it. No retry changes the original revision or silently updates
the source hash.

The HTTP adapter owns local `AbortController`s and task promises. Durable job
transitions and recovery live in the application/catalog layer. Startup skips
silence jobs in the generic job-failure loop and delegates them to the shared
owner-aware recovery path. Late callbacks cannot overwrite a successor because
all writes use owner-token and status compare-and-set predicates.

## Failure handling and idempotency

- Initial reservation failure returns no job and starts no analysis.
- Failure to persist a Review publishes no `waiting-review` state. The private
  immutable Review may be orphaned, but cannot be fetched/applied without its
  owning Job. Temporary files are removed by the existing SilenceService.
- A cancelled, failed or recovered job keeps its original identities. Retry
  first checks the captured revision and source hash; mismatch is a conflict.
- Apply passes the exact review payload to existing `SilenceService.apply` and
  the shared TimelineEditor with an idempotency request ID. The TimelineEditor
  records a bounded manifest receipt in the same save as the edit. Only after
  the editor acknowledges the one transaction is the Job marked completed.
- If final Job persistence fails after the composition edit, the API reports
  failure. A retry with the same exact request ID reads the durable project
  receipt and completes the Job without reapplying. Changed payloads are
  rejected, and retries never recalculate the proposal.

## Validation plan

Add catalog unit/integration tests for concurrent equal/conflicting request
IDs, one shared analysis reservation, owner-token CAS, retry/recover and
storage failures. Add unit tests for exact source/revision/review binding,
freshness separation, late callbacks, cancellation and duplicate Apply. Add
real HTTP tests against `startServer()` for every route and error boundary.
Use two project/catalog processes for reservation and recovery tests. Preserve
existing SilenceService media tests for source hashes, cancellation, locks,
pins, audio timing, Undo/Redo and source immutability. Run the requested lint,
typecheck, build, contract and relevant media suites; record actual counts and
cross-process limitations in validation docs.

## Risks

- Catalog `jobs` are JSON records; all transitions must validate silence-specific
  fields at the store boundary instead of trusting HTTP or TypeScript types.
- The Apply receipt is persisted in the project manifest with a hard count
  limit and strict validation. It records hashes/IDs only, not source media or
  proposal content. It must be covered by project validation and reopen tests.
- Filesystem Review publication and SQLite Job transition cannot be one atomic
  transaction. The ordering is intentionally Review first, owner-CAS Job
  second; orphaned private files are safe, but cleanup can be a later bounded
  maintenance task.
- Native FFmpeg behavior and physical-workstation media validation remain
  separate from HTTP/application correctness tests.
