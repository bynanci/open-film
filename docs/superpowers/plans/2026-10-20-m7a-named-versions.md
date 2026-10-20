# M7A — Named Versions implementation plan

**Goal:** Add durable, immutable named project snapshots with shared application,
HTTP/CLI and Desktop workflows for create, list, inspect/diff, rename and
explicitly confirmed restore. Keep originals and the existing edit/history
contracts intact.

**Base:** `ba7af5067c486654a9708c6f0df00c923ab9cfb6` (`main`, refreshed
2026-10-20). Latest main Verify run `39294727686` passed; no open PRs existed
at planning time. Work is isolated on `codex/m7a-named-versions`.

**User specification:** The M7A Named Versions work package attached to this
task. The durable product contract and evidence will be added to the repository
as part of this change.

## Architecture and boundaries

- Add a versioned `VersionRecord v1` and a private project-owned `versions/`
  store. Each immutable package contains a validated `project.json` image and a
  SQLite catalog image, each hashed; index metadata holds the editable name and
  description, stable ID, idempotency receipt, creation/parent data, project
  revision, source-reference fingerprints and software/catalog versions.
  Renaming changes only the index. Originals, managed source bytes, cache and
  export files are not copied or overwritten.
- Keep create/list/inspect/diff/rename/restore in one application service used
  by the CLI, loopback API and Desktop. API results expose source identity and
  hashes without absolute source paths, credentials or cache paths. Diff is
  deterministic and groups Story beats, Composition/tracks/clips, captions,
  GraphicScenes/templates, audio and referenced source identities.
- Establish one snapshot boundary under the SQLite project writer guard. The
  implementation will prove the `node:sqlite` serialized image path with WAL
  data and competing-process tests: transition to rollback-journal mode to
  checkpoint WAL, acquire an exclusive transaction, read the saved manifest and
  serialize the same catalog state, then restore WAL mode. Refuse rather than
  publish if a writer/read lock, active import/render/job, stale project owner,
  schema check, size bound or source identity check cannot be satisfied. Stage
  files privately, fsync where supported, validate hashes/integrity, then
  atomically publish the complete version directory. No direct Vue file access.
- Restore uses an explicit base project revision, an explicit confirmation and
  a fresh current-state checkpoint before touching the project. Validate the
  selected version, catalog, sources and current revision first. Apply catalog
  rows in-place inside an exclusive SQLite transaction so live catalog adapters
  remain valid; publish `project.json` with a durable restore journal. On error
  roll back the database and manifest; on process restart recover the journal
  before opening project data. Missing/changed sources produce typed
  Missing/Relink blockers and never trigger guessed relinking or media writes.
  Restore preflight must also honor current clip and asset locks: if a locked
  item would change, require the user to unlock it first rather than silently
  bypassing protection or partially restoring the version. Desktop create and
  restore flush pending editor work first; a successful restore clears stale
  selection/history drafts and reloads the saved project revision.
- Keep current Undo/Redo session-scoped. Version restore is a project-level
  operation with a new revision and does not alter the timeline model or project
  schema 1.0.0. Old projects without `versions/` open normally. Add bounded
  count/space enforcement that fails with an actionable message; never evict a
  version silently.

**Global constraints:** Local-first and non-destructive; retain Composition,
TimelineEditor, SQLite, renderer, autosave/reopen, typed commands and existing
lock contracts; no second timeline or history engine; no untrusted project code;
synthetic/CC0 fixtures only; no private paths, photos, credentials or provider
data in public output; retain Apache-2.0 and NOTICE.

**Review focus:** SQLite/WAL snapshot consistency and recovery; race behavior
with a second process and an external manifest edit; crash points around restore
publication; source hash revalidation; strict ID/path/symlink handling; lost
response idempotency; stale in-memory app owners; quota handling; Desktop focus,
keyboard access and three-locale copy. Any uncertainty in snapshot semantics is
a blocker, not grounds to weaken the tests.

## Implementation tasks

1. **Contract, validation and deterministic diff — red then green.** Add Core
   types/validators for version record, source reference and typed restore/diff
   results. Add unit tests for v1 validation, stable identity, sanitization,
   diff grouping/order and malformed/future records. Add
   `docs/named-versions.md` describing immutability, storage, compatibility and
   restore semantics.

2. **SQLite snapshot boundary — red then green.** Extend
   `packages/catalog/src/index.ts` with bounded snapshot capture, integrity and
   schema validation, and transactionally restoring a same-schema snapshot into
   the existing connection. Add tests in `packages/catalog/tests/` for WAL
   committed/uncommitted transactions, integrity, foreign keys, exact row
   restoration, busy readers/writers, invalid images and failed rollback.
   Restore WAL mode in `finally`; do not change catalog schema unless the tested
   contract proves it necessary.

3. **Shared Application version service — red then green.** Add
   `packages/application/src/project-versions.ts`, wire it from
   `OpenFilmApplication`, and expose typed create/list/inspect/diff/rename/
   restore methods. Validate canonical project paths and every version entry
   against symlinks/path traversal; use request IDs for lost-response retries;
   reject active jobs, stale project revisions and lock conflicts; hash source references and
   project/catalog payloads; stage → fsync → validate → atomic directory publish;
   add bounded storage and restore-journal recovery before project open. Keep
   names/descriptions out of immutable content. Add focused application tests in
   `packages/application/tests/project-versions.test.ts` for V1/V2, close/reopen,
   diff, rename immutability, restore + fresh checkpoint, changed/missing
   sources, active jobs, concurrent process lock, stale/external edits, lost
   response, symlink/path attacks, quota, forced write/disk failure, and journal
   crash recovery.

4. **HTTP/API and CLI adapters — red then green.** Add strict loopback routes in
   `apps/server/src/server.ts` and corresponding typed helpers in
   `apps/desktop/src/api.ts`; keep mutation serialization and validate only
   known request fields. Add CLI commands `versions create|list|inspect|diff|
rename|restore` through the same service; restore requires an explicit
   `--confirm` and base revision. Add HTTP/CLI integration coverage under
   `tests/integration/` for shared results, privacy, stale revision, explicit
   confirmation, idempotency, project switching and errors.

5. **Desktop Versions panel — red then green.** Add an accessible project-level
   Versions panel/drawer from the existing workflow shell (do not add a timeline
   or workspace state model), with create/name, list, diff and a two-step restore
   confirmation that names the target and current checkpoint. Reset/refresh on
   project switch and use existing error localization/focus conventions. Add
   `zh-TW`, `en-US`, `ja-JP` messages and keyboard/focus behavior. Cover with a
   localized Playwright scenario in `tests/e2e/project-versions.spec.ts` and
   relevant unit/i18n checks.

6. **Actual render and regression evidence.** Build a synthetic project with
   two generated photos, a caption, a GraphicScene and audio. Create V1, alter
   those fields, create V2, close/reopen, diff, restore V1 and render MP4. Verify
   with FFprobe and decoded frames: duration/frame count, caption timing and
   position, scene layer pixels, audio stream, catalog/source identities and
   original source hashes. Confirm V2 remains restorable after another reopen.
   Add one regression that exercises the shared Application/API/CLI path and one
   browser flow; no mocked render evidence.

7. **Documentation, gates, review and PR.** Update README, TASKS, ROADMAP,
   `docs/architecture.md`, `docs/CONTRACTS.md`, `docs/project-format.md`,
   `docs/named-versions.md`, and `docs/validation-named-versions.md`. Run
   `pnpm format:check`, `pnpm test:i18n`, `pnpm lint`, `pnpm typecheck`,
   `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:interchange`, and
   `pnpm test:native` only if Rust prerequisites are available. Record every
   failure/unrun gate, exact FFmpeg evidence and manual workstation limits.
   Request a fresh correctness review, confirm exact base/head and CI, then open
   one M7A PR. Do not merge without explicit authorization.

## Verification and acceptance

The key end-to-end sequence is Create V1 → edit GraphicScene/Caption/Audio and
photo-template sources → Create V2 → Compare → close/reopen → Restore V1 → Render
→ close/reopen → Restore V2. Both versions remain immutable and recoverable,
originals remain byte-identical, diffs remain deterministic, and failed/stale or
unsafe operations leave the active project unchanged. Full-gate results and
actual MP4/frame/hash evidence are recorded in the M7A validation document.
