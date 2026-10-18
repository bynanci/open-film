# Reviewable scene directions

This slice connects a **saved Story scene direction → explained editing proposal
→ temporary preview → explicit adoption**. It extends the existing photo
presentation commands, history, autosave and renderer. It does not create a
second timeline or require a language provider.

## Using it

1. In **Story**, save the scene's visual direction. Use one of the supported
   phrases below, separated by a semicolon, comma or line break.
2. In **Edit → Story**, select a photo and open **Scene directions to edits** in
   its Inspector. Generate a proposal for that photo, or the photos in its scene.
3. Review the exact source phrase, reason and old/new value for each action.
   Unsupported or conflicting clauses are shown explicitly. No change has been
   saved yet.
4. Preview an action in the source monitor, or skip it. Preview uses the same
   photo geometry and time evaluator as ordinary editing, without autosave.
5. Adopt the selected actions. They are one saved command batch and one Undo
   step. Existing selected/required sources, other scenes, titles, transforms,
   soundtrack and timing remain unchanged.

Existing layout and motion are preserved by default. **Replace existing photo
direction** explicitly permits reviewing replacements of those fields. It never
unlocks sources or removes a diptych's paired photo. No scene text, title text,
source trim, media selection, transition or audio is inferred from these phrases.

## Deliberately limited vocabulary

The compiler matches complete clauses, ignoring case and extra whitespace.
This is an offline, deterministic command vocabulary, not natural-language or
image understanding. It does not guess identities, focal subjects or events.

| Operation | English                          | Traditional Chinese    | Japanese             |
| --------- | -------------------------------- | ---------------------- | -------------------- |
| Contain   | `Keep proportions`, `contain`    | `保留比例`             | `縦横比を保持`       |
| Hero      | `Hero framing`, `hero`           | `主視覺`               | `主役`               |
| Hold      | `Keep still`, `hold`             | `保持靜止`             | `静止`               |
| Push-in   | `Gentle push-in`, `slow push-in` | `緩慢推近`, `慢慢推近` | `ゆっくりズームイン` |
| Pan       | `Horizontal pan`, `pan`          | `水平平移`             | `水平パン`           |

Example: `保留比例；緩慢推近`. The original saved text remains the evidence.
English full stops are not clause separators: `Pan.` remains unsupported.
Descriptions such as `Do not pan` or `推近她的笑容` do not become guessed commands.
Two different motions, or contain plus hero, are conflicts for that family;
other supported families can still be reviewed. Unsupported text remains visible
and never generates a hidden operation.

Hold, push-in and pan reuse the existing version-1 recipes. The latter two use
a bounded 6% movement, with pan offsets based on 2% of output width. Existing
focal/protected regions remain in the recipe. If shared geometry reports a
fallback or unsafe result, that action is withheld with a review note rather
than claiming an active move that the renderer would silently hold.

## Bounds and isolation

- A proposal has 1–50 distinct target clip IDs from one saved scene and at most
  100 actions. It only changes photo layout/motion on story picture tracks.
- Clip locks, source locks, rejected/unsupported media, missing dimensions and
  paired-photo protection are enforced. Required/selected primary assets can
  receive non-destructive presentation changes; their identities and selection
  constraints are preserved.
- Composition timing and duration are unchanged. The stricter defined Story
  and film maximum applies; an already-over-limit film must be shortened with
  the existing editing/Fit workflow before direction adoption.
- Every selected subset is simulated again. Skipping a prerequisite layout
  cannot make a later motion silently unsafe; the UI and application reject
  that subset. The client never supplies executable commands to acceptance.
- Optional language-provider script suggestions remain a separate, consented
  text-review workflow. This compiler makes no provider or network calls.

## Staleness, saving and recovery

Preview binds the exact saved scene, composition, editing assets, settings,
film limits, film locale, project identity/directory, options and recipe version.
Acceptance recomputes the proposal and checks its identity. Changed text,
manual edits, locks, geometry or limits require a fresh review. The passive CLI
preview normalizes managed-source location bookkeeping so workspace repair of
an already-moved project does not falsely invalidate unchanged media.

The application publishes the chosen presentation changes and a typed,
versioned acceptance receipt together in `project.json`. Existing schema-1.0.0
projects without receipts remain readable; no SQLite migration is needed.
Receipts retain source direction, action evidence, before/after values and
request identity. The project supports 100 receipts and fails closed at that
capacity; it does not silently discard recovery evidence.

The same request ID and exact payload acknowledge an earlier acceptance without
reapplying it, including after reopening, Undo or subsequent edits. A fresh,
explicit request can adopt a regenerated plan after Undo; it creates a distinct
audit receipt. Accepted evidence stays historical when the edit is undone.
The standard in-session history remains in memory, as before this slice.

The UI retains an uncertain acceptance payload locally and retries the same
request. It prevents sending if that recovery payload cannot be stored. On a
definitive stale review, regenerate; on a saved-project conflict, reopen the
project before retrying. A rare publication-then-commit error may have saved the
film even though the response failed. The existing save conflict guard is kept:
reopen resolves the durable receipt instead of resetting the writer baseline or
overwriting the saved file. Retry acknowledgments also check for external saved
project changes before returning a purported current state.

## Shared application and adapters

The pure compiler lives in `@openfilm/solver`. `TimelineEditor.previewDirection`
and `acceptDirection` own bindings, selected-subset validation, receipts and the
normal command/history publication boundary. Vue presents the proposal; it does
not independently decide which commands are authorized.

- `POST /api/compositions/:id/direction/preview` accepts
  `{ beatId, clipIds, replaceExisting? }` and returns the detached proposal.
- `POST /api/compositions/:id/direction/accept` accepts only
  `{ planId, baseRevision, contextSignature, options, actionIds, requestId }`.
  The ordinary bounded JSON body limit still applies.

For a headless review:

```sh
pnpm cli direction-review preview FILM_ID --project ./film.openfilm --beat BEAT_ID --clips CLIP_ID > direction.json
pnpm cli direction-review accept FILM_ID --project ./film.openfilm --plan direction.json --request-id my-stable-review-request
```

Use `--replace-existing` only when previewing explicit replacements. For ordinary
IDs, `--clips CLIP_ID,...` and `--actions ACTION_ID,...` remain convenient. For
opaque IDs containing commas or other delimiters, use JSON arrays instead:

```sh
pnpm cli direction-review preview FILM_ID --project ./film.openfilm --beat BEAT_ID --clips-json '["photo, # & 回憶"]' > direction.json
pnpm cli direction-review accept FILM_ID --project ./film.openfilm --plan direction.json --request-id stable-request --actions-json '["photo, # & 回憶:layout"]'
```

Do not combine the CSV and JSON form of the same option. JSON arrays preserve
identities exactly and must contain nonempty strings; normal application scope,
uniqueness and size checks still apply. Omit action options to adopt all reviewed
actions. Preview opens passively without writing the project. The reviewed JSON file is bounded to 16 MiB. The CLI extracts
identities/selection from that file; supplied command snapshots cannot bypass
server-side compilation. Unicode, spaces, `#` and `&` in project paths and IDs
are covered by adapter regression tests.

## Scope of verification

Domain, application, HTTP/CLI and browser tests cover compilation, unsupported
prose, conflicts, lock/manual/paired-source protection, temporary preview,
subset safety, one-step Undo/Redo, stale inputs, save failures, duplicate retries,
relocation, reopening and localized desktop layouts. Exact full-suite and CI
results belong to the published candidate's validation record.

Generated fixtures do not establish private-film aesthetics, real subject
recognition, listening quality, projection readability or actual Resolve import.
Those remain workstation gates. Arbitrary prose interpretation, semantic source
selection, generated narration, grading and duration/rhythm compilation are
future increments.
