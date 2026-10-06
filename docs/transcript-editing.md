# Transcript editing

Open **Edit → Transcript** for the selected spoken video or audio. Transcribe
first if there is no transcript. Story and Precision editing remain available;
correcting text never changes original audio, Story selections, clip trims or
composition duration.

## Correct and navigate

Select a segment to seek its source time. Edit its text inline, split at the
playhead or text cursor, merge with the previous/next segment, or delete the
transcript segment. Deletion removes text only. Search provides matching segments
and occurrences, next/previous navigation and source seeking. Replace changes one
occurrence; Replace All is one command and one undo step.

Transcript has its own Undo/Redo history. Keyboard actions follow the focused
workspace; typing spaces in a text field does not start playback. The editor saves
commands with a debounce and displays saving, saved, failed or conflict state.
Leaving the workspace waits for pending edits. Failed requests keep a recovery
draft tied to the revision on which it was made; a draft cannot overwrite a newer
transcript automatically.

Transcription and re-transcription requests also participate in the navigation
barrier from preflight through acknowledgement. A project switch cannot send a
delayed request into a different project, even when portable copies share asset
IDs. Failed requests retain their error, block an already-waiting switch and
allow an explicit retry.

The editor observes newly completed transcription jobs even when they finish
before a poll sees them running. A clean editor reloads the new provider revision;
pending manual drafts are reconciled, with conflicts preserving edits when the
provider revision changed. Completion refresh waits for initial draft recovery;
stale ancillary responses cannot replace newer job/revision-page state.

Reconciliation waits while a save or exact request receipt remains unresolved.
Delayed reads and errors belong to their original draft base; they cannot mark a
newly acknowledged save conflicted or block its receipt retry.

## Timing after correction

Every segment has an alignment state:

| State         | Meaning                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `original`    | Provider timing corresponds to the original provider text. Legacy segments without an explicit state have this meaning. |
| `text-edited` | Text changed. Segment times remain usable, but historical word timing is not treated as precise alignment.              |
| `realigned`   | Reserved for a future explicit alignment process; this release does not perform forced alignment.                       |

Any changed text conservatively becomes `text-edited`, including punctuation and
capitalization. Precision still supports segment seeking but excludes stale word
boundaries from word snapping and word-specific seeking. Words remain evidence,
not a promise that corrected syllables occur at their old timestamps.

A split uses a valid playhead time first. A cursor may use an original word
boundary when the word text actually maps to the segment. Otherwise timing is
proportional and marked `estimated`. Splits preserve complete words that fit
inside each range; the immutable parent keeps all original timing evidence.
Merging uses the first start and second end and joins CJK text without inserting
an English space. Latin words receive appropriate spacing.

## Revisions and recovery

Provider results and edits are separate immutable revisions. Revision metadata
records its parent, source (`provider`, `user`, `glossary` or `review-suggestion`),
creation time and accepted suggestion when relevant. Provider/model/source-hash
provenance stays with the original recognition evidence.

Undo, Redo and selecting a previous revision create a new revision token. They
do not resurrect an old token and make an old suggestion appear current again.
Re-transcription keeps the current result until a new run succeeds; failed or
cancelled recognition preserves existing edits. A concurrent edit causes a
revision conflict instead of being replaced by an in-flight provider result.

SQLite catalog v3 migrates v1/v2 projects in a transaction and adds transcript
revision/history/request receipts and text knowledge tables. The `.openfilm`
manifest and composition schema are unchanged. Request IDs are durable: retrying
the same request after a lost response acknowledges its original result without
applying it twice. Reusing an ID for another command is rejected.

## Shared application contract

`OpenFilmApplication.transcriptEditor` exposes `get`, `edit`, `undo`, `redo`,
`search`, `revisions` and `selectRevision`. Mutations require `baseRevision` and a
unique `requestId`. Core validates commands before the catalog applies them.
Desktop and CLI use the same application boundary; transcript state is not
Vue-only.

Existing provider and legacy segment IDs remain opaque, nonblank strings. Reads,
commands, review targets and keyboard focus preserve them exactly, including
long IDs and control-bearing values. Newly generated split IDs, asset/revision
IDs and request IDs keep their separate strict validation. No ID rewrite or
additional schema migration is needed for this compatibility fix.

Headless examples (replace the project path and asset ID with your own):

```bash
pnpm cli transcript source-id --project /path/film.openfilm
pnpm cli transcript search source-id --project /path/film.openfilm --query "十河田"
pnpm cli transcript edit source-id --project /path/film.openfilm --commands /path/edit.json
pnpm cli transcript revisions source-id --project /path/film.openfilm
```

`edit.json` contains the current revision from the read response, a fresh request
ID and validated commands:

```json
{
  "baseRevision": "current-revision-id",
  "requestId": "unique-request-id",
  "commands": [
    { "type": "replace-text", "segmentId": "segment-1", "text": "十和田湖" }
  ]
}
```

Reuse that exact request after an uncertain network response; use a new request
ID for a different operation. CLI command files are bounded to 1 MiB. The local
API exposes `GET /api/assets/:id/transcript` and POST suffixes `/edit`, `/undo`,
`/redo` and `/select`, plus paged GET `/search`, `/revisions` and
`/segments/:segmentId`. Invalid input and revision conflicts are structured errors.

Reads and searches are paged. Search streams parameterized SQLite rows through
an exact literal matcher; there is no regex, FTS or semantic-search service.
A generated search/matching benchmark and its limits are recorded in the
[validation record](validation-transcript-productivity.md). Very large archives still require
published hardware benchmarks before any performance claim.

Committed debounced batches use immutable validated snapshots in the existing
transcript tables. Undo/Redo retains up to 100 history references; revision evidence
and deduplication receipts are retained without silent pruning. Repeated editing
of very large transcripts can therefore grow the catalog. Storage compaction and
large-edit performance benchmarks are future work, separate from bounded UI reads.

See [Glossary](glossary.md) and [Review suggestions](review-suggestions.md) for
remembering and reviewing corrections.
