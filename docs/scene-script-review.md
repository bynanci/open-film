# Reviewable scene-script suggestions

Story can ask the configured `LanguageProvider` to improve one saved scene's
**Narration** or **Visual direction**. The result is evidence to review: original
text, proposed text and a reason. Generating a suggestion does not change the
Story. Accept changes only the chosen planning field; Skip changes only the
review decision. Both decisions remain with the project after reopening.

This extends [scene-script planning](scene-script-planning.md). It uses the same
Story and provider boundaries as Desktop, the local API and headless commands.

## Workflow

1. Classify memories in Library, plan scenes, and explicitly create the Story and
   film. Existing saved Stories can also use script review.
2. In Story, select a scene and write or inspect its narration and visual
   direction. Choose the field to review in **Script suggestions**.
3. Configure a provider through the trusted application runtime. If it is remote,
   inspect its name, destination and declared data classes before granting
   consent. Without a provider, manual script editing remains available and the
   panel explains why language review is unavailable.
4. Choose **Suggest improvements**. Pending manual scene edits must save first.
   If text changes while that save is in flight, review waits instead of sending
   an outdated draft. Activity shows the cancellable review job.
5. Read Original, Suggested and Why. Choose Accept or Skip for the individual
   suggestion. Accepted text remains editable through the normal Story fields;
   the original wording remains in the review evidence.
6. Reopen the project to continue with pending suggestions or inspect reviewed
   history. An uncertain acceptance retains its exact receipt for Retry.

Narration and visual direction are separate review targets. A narration decision
does not overwrite the other field, media selections, clip locks, timing or
Composition. These are planning notes, not synthesized speech or applied camera
motion. Text review does not measure an unrecorded narrator's speaking duration.
The [duration solver](scene-script-planning.md#duration-and-selection-contract)
continues to govern the actual cut.

## Provider and privacy contract

The existing `KnowledgeService` owns registration and consent. Script readiness
requires `text`; transcript review retains its separate `text` and `transcripts`
requirements. A text-only provider can therefore review scripts without being
advertised as a transcript provider. No provider or network endpoint is installed
by default, and project data cannot select an executable or remote endpoint.

Remote consent must match the displayed provider ID, destination and complete
declared data-kind set. The existing `ProviderRegistry` authorizes each call and
checks descriptor integrity. Revocation or provider replacement prevents obsolete
results from being published. Local providers require no remote consent.
The visible disclosure includes Story and scene identifiers; existing project
IDs may be arbitrary user-supplied strings rather than anonymous UUIDs.

The prompt contains an instruction line followed by bounded JSON:

- The explicit `scene-script-review` task and film content language.
- Story ID/title and the selected scene's ID/title/intent.
- That scene's target/minimum/maximum duration, when present.
- The chosen field name and its saved text.

It does not include asset IDs, photos, videos, source paths, GPS, transcripts,
raw camera metadata or the other script field. Saved scene descriptions are
user-supplied context; the provider has no access to the underlying images or
filesystem. The prompt requests the film content language. Changing UI language
relabels controls without rewriting saved text or existing suggestions.

The provider may return zero or one suggestion:

```json
{
  "suggestions": [
    {
      "beatId": "scene-01",
      "field": "narration",
      "after": "我們慢慢走，把這一天留在記憶裡。",
      "reason": "保留原意，讓句子更適合朗讀。"
    }
  ]
}
```

The application derives the original text, target Story, provider identity,
revision, IDs and timestamps. Unknown targets, duplicate results, extra fields,
unchanged text, malformed Unicode and invalid confidence/reason values are
rejected. Script fields retain the existing 8,000-Unicode-code-point limit.
Prompts are limited to 60,000 UTF-8 bytes including instructions, and results to
200,000 UTF-8 bytes. Oversized input is rejected without truncating user text.
An optional confidence value remains provider evidence, not an objective
probability; the explanation is the primary review aid.

## Source binding and recovery

Each suggestion records its exact target and a digest of the project identity
and disclosed source context. The application checks this source after the
provider returns and again before acceptance. Editing the selected text, scene
purpose, relevant timing or film language makes old evidence stale. Editing the
other script field does not invalidate this target merely because it shares the
same scene. Stale evidence can be skipped; accepting it requires a new review.

The SQLite catalog stores immutable before/after/reason/provider evidence and
`pending`, `accepted`, `skipped` or `stale` lifecycle state. Equivalent reruns
deduplicate rather than resetting a person's accepted/skipped decision. An
explicit rerun may create fresh pending evidence when the previous match is
stale, including after the source text is restored. The old ID, text, status and
audit remain intact; simply reading history never revives stale evidence. Reads
are paged, and exact-scene status updates use the catalog rather than rendering
every suggestion.

Listing can reconcile published receipts and mark obsolete pending evidence.
Its saved-project check, revision calculation, receipt reconciliation and scoped
or history lifecycle updates therefore share the same write lock as project
saves. An old viewer cannot stale fresh evidence published by another OpenFilm
process in the middle of polling. Receipt recovery checks database state on
each pass, including after an owned or caller transaction rolls back; an
in-memory cache cannot certify a committed audit update. Unverifiable saved
projects remain inspectable without changing lifecycle state. Temporary lock
contention reports a retryable busy state.
Accept and Skip also report lock contention as `jobs.busy` (409), so acceptance
retains its exact retry request. Unexpected decision failures report
`operation.failed` (500) rather than claiming evidence is stale, including when
the project publication succeeded but audit finalization failed.

The text lives in `project.json`, so SQLite alone cannot make acceptance atomic.
The application saves the changed script together with a small
`sceneScriptReviewReceipts` entry in the same atomic project-file publication.
A catalog transaction serializes acceptance against competing review decisions.
Every existing-project save, including ordinary Story/timeline saves and close,
uses the same SQLite write lock. Its owner-baseline check and atomic file
publication run together under that lock, so another OpenFilm process cannot
save between acceptance's final check and publication. Nested acceptance keeps
ownership of its outer transaction. A stale writer must reopen; it cannot
overwrite newer text through a later save or cleanup. Temporary lock contention
remains retryable. The lock coordinates OpenFilm processes; an arbitrary external
file editor does not participate in that protocol.
Failed Story/film creation and import-library publication restore the previous
in-memory draft; closing or retrying must not publish an operation reported as
failed. Import caches receive a new library only after its save succeeds.
If validation or project-file publication fails before the atomic rename, no
accepted text is published. If catalog finalization or the response fails after
the file was saved, the exact receipt lets Retry/reopen
finish the audit without applying the change twice or replacing later edits.
Reusing a request ID for different evidence is rejected.

An explicit `409 / story.planConflict` response requires reopening the project.
The review panel clears only its browser retry receipt and releases project
navigation, so the user can reopen safely; it does not accept or skip evidence.
Any already published project receipt remains authoritative during reopening.
Network failures, 5xx responses, temporary lock contention and other conflicts
retain the exact retry receipt because publication may still be uncertain.

The project receipt field is optional for existing 1.0 projects, bounded to
10,000 receipts with unique suggestion and acceptance-request IDs, and separate
from editable Story payloads. Restored projects must satisfy both uniqueness
checks before opening or reconciling pending evidence.
All four receipt identity fields are nonblank, well-formed Unicode, contain no
C0/DEL controls and are bounded to 256 UTF-16 code units, matching the stored
review identifier contract. Existing opaque Story and scene IDs are unchanged.
Catalog schema v5 adds `scene_script_suggestions` transactionally; the existing
v4 transcript identity migration is not repeated. Legacy project migration and
opaque transcript identity remain covered by regression tests.

Review requires verifiable saved context. A process with an externally changed
project must reopen before publishing; stale state must not overwrite the newer
file during cleanup. Missing, unreadable or malformed saved files also block
further saving, so cleanup cannot recreate or overwrite external state.
Incidental root `updatedAt` changes do not count as scene content changes.
Safe observer cleanup does not certify a successful save: service shutdown uses
strict workspace saving before issuing its successful close acknowledgement.

Moving a project with managed sources repairs the catalog locations and saves
changed library roots under the same writer lock before workspace review is
available. A partial earlier relocation can also be repaired when the catalog
already has the new location. Failed opening releases storage without a cleanup
autosave. Export-only opening remains passive and performs neither repair nor
manifest publication.

Jobs use the existing Activity, cancellation and execution-owner machinery.
Cancellation releases a non-cooperating provider and rejects late output. Another
opener preserves a live owner. Automatic recovery applies only to proven-dead
owners; unknown owners retain the existing explicit, exact-checkpoint recovery
procedure. This does not claim automatic Windows/macOS owner verification.

## API and CLI

```text
GET  /api/review/provider?workflow=scene-script
POST /api/review/consent
POST /api/stories/:storyId/script-review
GET  /api/stories/:storyId/script-review/suggestions
POST /api/script-review/suggestions/:id/accept
POST /api/script-review/suggestions/:id/skip
```

Consent uses the existing descriptor-bound payload plus
`workflow: "scene-script"`. Start requires `{ beatId, field }` and returns the
shared Job with HTTP 202. Listing requires `beatId` and `field` query parameters;
optional status/offset/limit retain bounded paging. It returns suggestions and
the current `revision`. Accept requires `{ baseRevision, requestId }` and returns
the actual saved `{ story }`; Skip takes an empty object. Provider output and
endpoint configuration are never accepted as mutation payloads.

```sh
openfilm script-review provider --project /path/film.openfilm
openfilm script-review list story-01 --beat scene-01 --field narration --project /path/film.openfilm
openfilm script-review run story-01 --beat scene-01 --field narration --project /path/film.openfilm
openfilm script-review accept suggestion-01 --base-revision <revision> --request-id <unique-id> --project /path/film.openfilm
openfilm script-review skip suggestion-01 --project /path/film.openfilm
```

Headless list/accept/skip work with saved evidence without configuring a new
provider. Generating new suggestions requires trusted runtime registration,
just as optional transcript language review does.

## Verification limits

Deterministic providers exercise the real registry, jobs, storage, HTTP, CLI and
browser decisions. They are explicitly test fixtures and provide no evidence of
language-model writing quality. See the [validation record](validation-scene-script-review.md).
Real provider quality, workstation/installer behavior and Resolve observations
remain separate in [issue #7](https://github.com/bynanci/open-film/issues/7).
