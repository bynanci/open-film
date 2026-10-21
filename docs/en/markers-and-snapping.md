# Source markers and snapping

A marker belongs to an original asset and a source timestamp. It is not a
timeline clip, a duplicated media file or an instruction to change a story.
Manual markers persist in the catalog against asset ID and source hash;
detected scene markers retain detector provenance in the scene result.

## Marker behavior

In Precision mode, add a marker at the playhead, double-click the waveform, or
use M when focus is outside text and form controls. Select a marker to seek to
its source position. Removing a manual marker removes that source marker; it
does not trim a clip or delete the original. Times must remain inside the
source duration. Marker labels, when provided, are user text and are not
translated when the interface language changes.

The Core marker vocabulary also reserves `speech`, `word`, `beat` and `chapter`
types. Their presence in the contract is not a claim that every type has an
authoring UI. P0 provides manual markers and detected scene cuts; loaded
transcript segment/word edges and selected source clip edges can also act as
snap candidates without creating persisted manual markers.

## Snap calculation

`packages/analysis/src/snapping.ts` contains the pure source-time calculation.
The view converts its pixel tolerance to seconds using the current zoom and
passes the valid trim bounds. Candidates outside those bounds or of disabled
types are ignored. With snapping off, the bounded requested time is preserved.

The nearest eligible candidate within the threshold wins. Equal distances prefer
the higher priority, then earlier time, candidate type and stable ID, making
ties reproducible. Default priorities are:

| Candidate                             | Priority |
| ------------------------------------- | -------: |
| Manual marker                         |      100 |
| Clip edge                             |       90 |
| Detected scene cut                    |       80 |
| Chapter                               |       70 |
| Beat                                  |       60 |
| Speech or transcript-segment boundary |       50 |
| Word boundary                         |       40 |

Both starts and ends of transcript segments and words are candidates. Silence
between segments remains free source time; snapping does not fill it with
invented speech. Transcript candidates come from the currently loaded page,
which is stated in the UI. Marker visualization is bounded separately from the
full persisted data so dense analysis does not require thousands of DOM lines.

## Visibility and persistence

Snap feedback identifies the selected target type and time. Marker timestamps,
scene cuts and transcript timings remain in source seconds when a clip is
moved, reordered or retimed. The normal timeline command still validates the
result after snapping; a nearby marker cannot bypass a lock, source limit or
positive-duration constraint.

Analysis results and manual markers are source-bound catalog data, while trim
and split commands are composition edits. Timeline undo/redo should not be
interpreted as a general analysis/marker history. Reopening retains committed
valid marker/analysis data and the independently saved composition. Changed
source bytes must not silently reuse markers or analysis from the old source.

Pure tests cover candidate selection, thresholds, bounds, disabled types and
deterministic ties. The precision browser workflow checks an actual persisted
marker, snapped trim and shared timeline history through the product controls.
