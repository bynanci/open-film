# Editing round integration contracts

All durations are seconds. P0 file ownership is intentionally separate.

## Pure editing — packages/solver/src/editing.ts

Export through @openfilm/solver:

- `TimelineCommand` union (below).
- `EditorDocument = { composition: Composition; story: Story }`.
- `applyTimelineCommand(document, assets: MediaAsset[], command): EditorDocument`.
- `ShorteningSuggestion = { id: string; clipId: string; secondsSaved: number; reason: string; command: TimelineCommand }`.
- `suggestShortening(document, assets, targetDuration: number): ShorteningSuggestion[]`.

Command shapes:

```ts
type TimelineCommand =
  | { type: "trim"; clipId: string; sourceIn: number; sourceOut: number }
  | { type: "duration"; clipId: string; duration: number }
  | { type: "speed"; clipId: string; speed: number }
  | { type: "volume"; clipId: string; volume: number }
  | {
      type: "transform";
      clipId: string;
      scale?: number;
      rotation?: number;
      x?: number;
      y?: number;
    }
  | {
      type: "transition";
      clipId: string;
      transition: "cut" | "crossfade";
      duration?: number;
    }
  | { type: "reorder"; clipId: string; toIndex: number }
  | { type: "delete"; clipId: string }
  | { type: "replace"; clipId: string; assetId: string }
  | { type: "lock"; clipId: string; locked: boolean }
  | {
      type: "beat";
      beatId: string;
      patch: {
        title?: string;
        intent?: string;
        targetDuration?: number;
        minDuration?: number;
        maxDuration?: number;
      };
    }
  | {
      type: "regenerate-beat";
      beatId: string;
      mode:
        | "regenerate"
        | "shorten"
        | "more-video"
        | "more-photos"
        | "replace-similar"
        | "remove-repetition";
    };
```

`toIndex` is the index within the source beat's clips on the same track.
Only finite valid values accepted. Volume0..1, speed>0, source ranges bounded by
actual source duration. Photo duration>0. Editing errors are specific.
Generated/automatic operations protect locked and required assets. Other beats'
source edits, order, duration and effects survive; ripple timeline offsets may
change. Suggestions are a sequential plan; applying all listed commands reaches
the best feasible target without silently dropping protected clips.

For individual Fit actions, `prepareShorteningPlan(document, assets, targetDuration)`
returns `suggestions` measured independently against the current cut. Each preview
contains its command, actual saving, before/after duration, and a snapshot of the
document, revision when present, target and source assets. Zero-saving or invalid
individual actions are omitted. `shorteningCommands(document, assets, targetDuration,
preview)` rejects stale state or changed commands before returning commands to the
normal editor queue. The prepared plan's `commands` and `secondsSaved` retain the
original sequential Apply-all plan; independent row savings are alternatives and
must never be added together. Individual Apply enqueues only its reviewed command;
the existing persistence batching and undo behavior are unchanged.

Both helpers accept an optional final `excludedClipIds` array. Desktop Skip
excludes that clip from the newly computed sequential plan as well as individual
alternatives. The normalized exclusion set is included in the snapshot; pass the
current set again to `shorteningCommands`, which rejects a preview from a different
filter. Preview changes only the inspected source range and before/after display;
it never queues an edit. Apply-all still uses the existing bounded command queue,
not a new all-film atomic transaction.

## Application service — packages/application/src/editor.ts

Export via @openfilm/application:

```ts
interface TimelineEditorState extends EditorDocument {
  assets: MediaAsset[];
  revision: string;
  canUndo: boolean;
  canRedo: boolean;
}
class TimelineEditor {
  constructor(application: OpenFilmApplication);
  get(compositionId: string): TimelineEditorState;
  edit(
    compositionId: string,
    input: {
      baseRevision: string;
      requestId?: string;
      commands: TimelineCommand[];
    },
  ): Promise<TimelineEditorState>;
  undo(
    compositionId: string,
    baseRevision: string,
  ): Promise<TimelineEditorState>;
  redo(
    compositionId: string,
    baseRevision: string,
  ): Promise<TimelineEditorState>;
}
```

One instance per open application. Bounded history, reset on project reopen.
Validate JSON input at the boundary; do not trust TypeScript casts. A stale revision
throws an error with status409. Persist edits before acknowledging success;
rollback in-memory state/history if validation or disk write fails. Preserve
per-clip locks and all existing project references. Deduplicate request IDs.

## HTTP — root-owned

- GET `/api/compositions/:id/editor` -> TimelineEditorState.
- POST `/api/compositions/:id/edit` body `{baseRevision,requestId?,commands}` -> state.
- POST `/api/compositions/:id/undo` and `/redo` body `{baseRevision}` -> state.
- GET `/api/source/:assetId` streams the referenced local source for preview,
  with existing Origin/Host checks and correct media MIME/range support.

Existing global mutation serialization also covers editor writes. Get asset
metadata through state; thumbnails use existing cached media endpoint. No raw
project replacement endpoint is added.

## Desktop — apps/desktop only

Build `TimelineEditor.vue` plus focused composable/styles. Fetch state from the
above routes; import pure editing functions/types from @openfilm/solver. Debounce
valid commands around400ms, preserve pending edits on error, and flush before
undo/redo/render/export/project switch. Publish changed composition/story/assets
to parent App. Ctrl/CmdZ, ShiftZ, Delete, arrows and Space respect form focus.
Save state includes retry; stale-server conflict must retain the unsaved draft.
Use lazy cached thumbnails, not one video decoder per clip.
