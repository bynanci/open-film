# Independent sound timing (D3B1)

Sound timing belongs to the existing clip occurrence. Its picture keeps the
saved rational frame cut; sound can start before that picture (J cut) or continue
after it (L cut). Two occurrences of one source keep separate sound choices.

In the clip Inspector, open **Sound timing**. After the original source is
verified, enter start/end offsets in whole milliseconds, from −60000 to +60000.
A negative start extends sound earlier; a positive end extends it later.
**Apply** saves one typed edit. With both offsets zero, Apply explicitly adopts
the canonical sound clock for a linked clip. Existing independent ranges retain
their sub-millisecond sample remainder. Picture frames do not move.

The canonical clock is the first audio stream decoded at 48000 Hz, with its
source-local initial timestamp retained and every internal timestamp gap filled.
At normal 1× speed it preserves sample phase without time stretch. Older linked
clips retain their previous trim, delay and processor behavior until explicit
adoption. Adoption can change the old processor phase; it is a user action,
never an automatic migration. Non-1× clip speed still uses pitch-preserving
tempo processing, whose output must be compared with the same processed clock.

**Reset to picture** explicitly relinks sound and shows the resulting range.
Undo/Redo keep complete saved objects. The first independent timing write
promotes the project to schema 1.2; removal or Undo does not lower that header.
Older applications must reject it. Explicit Named Version Restore can restore a
complete older project and header.

Normal Record Play prepares a private complete mix through the same renderer
as WAV/MP4/stems, then schedules bounded two-second PCM blocks. Pictures and
captions follow sound time. Preparation/buffering holds the picture; cancel,
pause, seek, project change and Undo retire old playback. Shuttle rates other
than 1× are explicitly silent. Record reports unsupported WebAudio or failed
preparation; it does not silently use frame-gated sound.

Preparation supports at most one hour and 1 GiB per PCM file, with a 2 GiB
completed cache and one preparation per project. Each server range is at most
four seconds; the client retains at most eight seconds. Original sources are
never overwritten. Changed source bytes, stale saves or damaged PCM require
fresh preparation. Use WAV/MP4 export when the preview limit is exceeded.

Use existing role, gain, fades, control points and ducking controls. A future
coverage owner can supply `keep-primary`, `mix-secondary` or `replace-primary`
to the bounded evaluator. Secondary gain is 0–1 and replacement affects only
the named primary windows. D3B1 does not persist B-roll coverage or expose a
coverage authoring control.

Split and source replacement reject explicitly independent sound until it is
relinked. Conflicting captions, source exhaustion and protected clips/sources
reject without a partial save. Collect keeps complete originals for independent
sound, including a source shared with linked clips. JSON/OTIO preserve exact
metadata; OTIO requires manual recreation. FCPXML/EDL reject unsupported timing.

Synthetic browser/media results are recorded in the
[validation](validation-audio-policy.md). They do not establish physical audio
latency, human listening quality or native workstation QA.
