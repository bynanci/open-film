# Sequence source waveforms

In **Expert → Edit**, the Record monitor shows the saved Composition's source
audio peaks. Clips on Video, Audio and Music tracks share the existing Record
clock. These are raw source peaks before gain, fades, ducking and mixing; they
are not an output loudness meter or beat detection.

## Use the overview

1. Open the saved film in Expert Edit. Missing peaks have an outlined region and
   a source status instead of invented audio.
2. Choose **Prepare visible missing** to use the existing local waveform jobs.
   Other active analysis remains protected. **Stop preparation queue** stops
   queued work; an already active job continues in Activity.
3. Click a waveform or focus **Seek Record waveform** and use the arrow keys to
   seek the existing Record monitor. Protected clips remain read only.
4. Use the previous/next 30-second window or **Fit sequence**. More than eight
   visible sources are paged, with explicit previous/next source controls.
5. Use **Refresh / retry visible** after a read failure or completed analysis.
   Changed or inaccessible sources keep their peaks hidden until current
   evidence is available.

Trim, source in/out, speed and short sources affect the displayed positions.
Holding a video's last picture does not extend its audio. A source reused by
several clips shares cached evidence. Playback moves the playhead without
fetching or rebuilding waveforms on each frame.

The overview follows acknowledged saved edits and the current project. It does
not alter timing, locks, media, Undo/Redo or project data. See the
[validation](validation-sequence-waveforms.md) for decoded timing evidence and
remaining workstation checks.
