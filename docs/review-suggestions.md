# Reviewable suggestions

Suggestions are evidence to inspect, not permission to rewrite a film. Open the
Suggestions panel in **Edit → Transcript**. Each item shows the original and
suggested text, why it was proposed, and Preview, Accept and Skip actions. Preview
seeks the original media so a correction can be checked against the recording.
Diff presentation includes labels and deletion/insertion styling as well as color.

## Offline and optional provider review

Glossary review is deterministic and local. It works when no LanguageProvider is
configured. Language review is optional and uses the existing generic
`LanguageProvider` through `ProviderRegistry`; no LLM runtime, cloud account,
Claude CLI or vendor endpoint is required by the basic editing workflow.

A trusted application/server runtime can inject a provider. The default service
has none and honestly reports unavailable language review. Local providers do not
need remote consent. Remote providers must disclose both `text` and `transcripts`
and obtain explicit consent covering their destination/data kinds. Registry
authorization is checked on every batch and revoked when the descriptor changes.
An unavailable or unconsented provider is never called.

The provider receives bounded JSON context containing segment IDs and text,
transcription language and effective terminology. It receives no media binary,
source path, GPS, faces, timeline or filesystem access. The application expects:

```json
{
  "suggestions": [
    {
      "segmentId": "segment-1",
      "after": "十和田湖",
      "reason": "Matches the project term"
    }
  ]
}
```

Output is validated for shape, known selected segments, changed text, valid
Unicode and size limits. Invalid output produces a structured error. Provider
confidence, if supplied, is evidence from that provider, not an objective
probability. The language model has no database or project mutation access.

## Durable review lifecycle

Every suggestion records before/after text, reason, kind, source/provider/model,
source transcript revision and creation time. States are `pending`, `accepted`,
`skipped` and `stale`. Completed suggestions survive restart. Re-running the same
review deduplicates equivalent evidence rather than resetting accepted/skipped
items.

Accept checks the current revision and original text, applies a normal transcript
command, and records acceptance and its resulting revision in the same catalog
transaction. It is undoable. Lost response retries use the same request ID without
applying twice. Desktop retains an uncertain-acceptance receipt and shows Retry
even if the accepted card has disappeared or the application has restarted.
Reconciliation preserves any pending manual draft as a conflict. If a retry
receives a definitive missing-suggestion response, such as after opening
a restored project copy, that receipt is cleared and navigation is released.
Network, server and missing-source failures retain uncertain receipts for Retry.
Responses from a disposed or changed project/asset cannot clear a newer receipt.
Review actions reserve ownership before waiting for transcript saves. Rapid
Accept clicks cannot replace a pending receipt, and project navigation waits for
preparation and transport together.
If the transcript
changed since generation, Accept reports
`review.suggestionStale`; regenerate suggestions against the current text. Even
Undo creates a new revision token, so it cannot accidentally revive old evidence.
Skip changes review status without changing text. Original suggestions remain
auditable.

Stale evidence may also be skipped to dismiss it. Accepted items stay accepted;
Undo changes transcript history rather than rewriting the review audit.

Review jobs use the shared Activity/cancellation model. Batches default to 50
segments, with configurable bounds of 1–100. Language review permits at most
20,000 text characters per segment and 60,000 UTF-8 prompt bytes, including
instructions, serialized IDs/text and terminology context. Grouping accounts for
CJK and JSON escaping. Oversized source text stays intact in a failed durable
batch; it is not truncated or sent to the provider. Other valid batches can finish.
Completed batches become visible while later batches run. One failed batch can be retried
or skipped while other completed evidence is retained. Cancellation preserves
partial results and marks unfinished work for explicit retry; restart does not
pretend an interrupted provider call completed.

Both failed and cancelled batches expose Retry and Skip. Glossary retry remains
offline and uses the current term definitions against the job's bound transcript
revision; it requires no LanguageProvider. A failed batch is terminalized even
when a valid glossary replacement exceeds the suggestion-size limit. Restart
recovery marks abandoned queued/running review jobs failed and their unfinished
batches cancelled, retaining completed suggestions. Retry never rebases evidence
onto a newer transcript revision.

Batch Retry first saves any manual draft. If that changes the revision, the old
batch is rejected before provider invocation; create a new review for the edited
text. Retrying an uncertain Accept instead confirms its original request before
flushing a possibly conflicting draft.

Starting a newer review does not hide an older review's Retry/Skip actions.
Unfinished reviews are paged independently of suggestion cards, with at most five
jobs' batches read in a refresh. Each action remains bound to its original job.

Paged review navigation retains the requested page while background activity
refreshes. Paging controls wait for that page's acknowledgement, so polling cannot
replace a pending Next request with the previous page.

Suggestion paging reads the source-verified current revision with a bounded
transcript read; polling does not materialize the full document. Real text review
and acceptance still validate the content needed for their commands.

No Accept All AI shortcut is required. A person's manually edited text always wins:
glossary and language review only propose changes. Story, composition, media and
clip locks are outside this text-review command boundary.

CLI exposes `review run`, `list`, `accept`, `skip`, `batches`, `retry-batch` and
`skip-batch`. `review run source-id --source glossary --project /path/film.openfilm`
requires no provider. Accept requires the current `--base-revision` and a unique
`--request-id`. Provider review requires trusted runtime configuration; the CLI
does not load arbitrary network endpoints from project data.

The local API starts review with `POST /api/assets/:id/review` and returns a
shared Job. Paged suggestions use GET suffix `/review/suggestions`. Accept/Skip
use `/api/review/suggestions/:id/accept|skip`; batch status/retry/skip use
`/api/review/jobs/:jobId/batches`. Invalid retry requests leave completed jobs
unchanged. Project switching waits for active jobs and in-flight text mutations.
