# Precision editing

The Edit workspace offers Story and Precision modes over the same composition
and edit history. Story mode remains the place for beat structure, photos and
the overall sequence. Precision mode focuses on source timing for one selected
video or audio clip. Switching modes does not create a second cut.

## Source time and film time

The source preview, waveform, transcript, scene cuts and manual markers all use
seconds in the original file. The selected clip still has a composition start,
source in/out and optional playback speed. A source second is not necessarily a
second in the film: retimed clips map the selected source span through their
speed. The UI distinguishes the source playhead, its location within the clip
and positions outside the clip.

Use explicit source playback, frame stepping or waveform seeking to find a
point. Zoom changes the visible source range; follow-playhead is a view option.
Hover preview is opt-in and only seeks while paused. Moving a pointer over a
waveform must not unexpectedly start playback or alter a cut.

## Trim and split

Drag the in/out handles or set an edge at the playhead. A drag previews a range
locally and commits one edit on completion. The shared command path validates
source bounds, positive duration, playback speed and clip locks. Snapping can
help align an edge to a source marker, scene cut or loaded speech boundary; see
[markers-and-snapping.md](markers-and-snapping.md).

Split at a playhead inside the selected clip to divide its existing source span.
Both sides retain the relevant source and edit properties. The split belongs to
the same composition history as Story edits; undo/redo and autosave operate on
that history. It does not split or modify the original media file. A locked
clip can still be played or analyzed, but must be unlocked before trimming or
splitting.

A source locked in Library also prevents splitting, even when its selected
timeline clip is unlocked. Precision explains the source lock and disables both
the Split action and B shortcut until it is unlocked in Library. Source locking
does not disable a valid trim of an unlocked clip.

Split also waits until the incoming crossfade has finished. The guard converts
the source span through clip speed, matching the shared command's film-time
transition constraint. Playback can use a saved clip range when source duration
metadata is unavailable; trimming, splitting, adding markers and analysis wait
for a finite positive duration recorded on the asset.

The editor must flush pending work before operations that switch project or
export. A failed/conflicting save remains visible and keeps the existing draft
recovery behavior. Reopening the project loads the saved cut, not a separate
Precision draft document.

## Analysis and transcript

Waveform analysis, scene detection and transcription are explicit actions with
visible progress and cancellation. Analysis completion refreshes source evidence;
it does not edit the timeline. Read-only transcript segments and words act as
seek targets, with page controls for long recordings. An unavailable Whisper
model leaves source playback and normal editing usable.

Analysis availability follows all active project jobs, including work on another
source, import and rendering. The inspector shows job details for the selected
source and explains when another task owns the project. It keeps polling until
that task completes or is cancelled so analysis becomes available again.

Marker controls show 100 rows per page with a full visible-range count and
first/previous/next/last navigation. Paging limits DOM work without discarding
scene/manual evidence used for seeking or snapping; the waveform overlay stays
bounded separately.

The source player and inspector remain available while navigating the precision
view. Long transcript/marker lists scroll inside their own areas rather than
displacing every editing control. Browser checks exercise supported desktop
sizes 1280×720, 1440×900 and 1920×1080 in English, Traditional Chinese and Japanese.

## Keyboard scope

Precision mode exposes Space for playback, left/right for frame stepping,
Shift+left/right for second stepping, B for split and M for a marker. Keyboard
editing commands must not intercept typing in inputs, selects, menus or dialogs,
or fire in the hidden Story editor. The visible mode owns the shortcuts.

## P0 limits and evidence

The transcript is navigational evidence, not an editable subtitle track. There
is no automatic highlight selection, face tracking, smart crop, dictionary,
proofreading, safe-frame overlay or subtitle burn-in in this foundation.

`tests/e2e/precision-editing.spec.ts` is the browser acceptance path for a Proposal
film with a photo, generated spoken video and procedural music: actual import,
analysis orchestration, source seeking, snapped trim, split, shared history,
reopening and a rendered MP4 preview. It also checks source-switch job recovery,
cancellation, exact frame adjustment and valid sub-frame trim boundaries.
Its deterministic transcription provider is
explicitly a protocol fixture. Real FFmpeg waveform/scene processing and actual
Whisper inference are different checks and must be reported separately.

Source evidence is cleared when a read, job or marker operation reports changed
or missing media. Precision edit/marker controls wait for a successful source
verification; use the source refresh action after restoring the original file.
Cancelled re-transcription keeps previously verified results. This source
readiness guard does not delete the saved composition or its edit history.
