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

Silence Review and Clip Split use the same automation-window mapping. Split
fragments persist a schema 1.3 version 2 time map with the original clip-local
clock, source in/out and speed on an integer 48 kHz sample clock. The original
fade, gain-point and ducking curve keeps one semantic timeline; it is not copied
and restarted per fragment. The existing AudioMixPlan cuts each fragment after
the complete source/tempo/automation history and builds one DSP branch per
continuous clock. Review and render reject mismatched source, curve or clock
identity. A mapped fragment cannot directly change source trim or speed or
replace its source; explicitly reset automation or review a new trim first.
Independent J/L audio timing, locks and User Pins remain protected. Existing v1
projects are unchanged until a mapped edit is accepted.

The map retains the exact original trim seconds and legacy playback origin.
Repeated splits derive offsets from the same source anchor. A ripple whose
placed span would drop or duplicate original-clock samples fails before Review
publication; the saved proposal is never silently rounded. Mapped controls offer
an explicit **Reset envelope to edit** action: it clears gain points, fades and
ducking, retains role/source/base volume, and can be undone. Independent sound
timing remains blocked until that reset. Use Record to audition the saved mix.

Preparation supports at most one hour and 1 GiB per PCM file, with a 2 GiB
completed cache and one preparation per project.
The one-hour preparation limit also covers every preserved original DSP history,
including histories belonging to a much shorter visible fragment.
Each server range is at most four seconds; the client retains at most eight
seconds. Original sources are
never overwritten. Changed source bytes, stale saves or damaged PCM require
fresh preparation. Use WAV/MP4 export when the preview limit is exceeded.

Use existing role, gain, fades, control points and ducking controls. The existing
coverage owner can supply `keep-primary`, `mix-secondary` or `replace-primary`
to the bounded evaluator. Secondary gain is 0–1 and replacement affects only
the named primary windows. The D3B2 workflow owns saved coverage and its review.

The existing limiter runs separately on each rendered role stem and the master.
Overloaded stems therefore do not sum back to the limited master. Peak/loudness
reports measure decoded output; they do not normalize the saved mix.

Split and source replacement reject explicitly independent sound until it is
relinked. Conflicting captions, source exhaustion and protected clips/sources
reject without a partial save. Collect keeps complete originals for independent
sound and mapped automation, even after unpinning or when a source is shared
with linked clips. JSON/OTIO preserve exact
metadata; OTIO requires manual recreation. FCPXML/EDL reject unsupported timing.

Synthetic browser/media results are recorded in the
[validation](validation-audio-policy.md). They do not establish physical audio
latency, human listening quality or native workstation QA.
