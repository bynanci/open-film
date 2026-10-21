# Reviewable audio quality (M6 / PR 6A)

AudioAutomation already owns role, fades, gain points and manual ducking. This
feature reuses that contract and the existing volume command. It adds no audio
schema or second timeline, and never rewrites a media source.

The application renders three private MP4s with the normal FFmpeg Renderer:
original mix, selected sound stem (all other clip audio muted), and a proposed
mix. The stem's integrated loudness informs a constant-volume suggestion by role:
narration/dialogue −16 LUFS, music −23 LUFS, ambience −24 LUFS. These are
workflow defaults, not delivery-standard certification. The current volume
contract remains 0–1; boosts requiring more than unity are explicitly limited.

FFmpeg loudnorm reports decoded input integrated LUFS, LRA and oversampled true
peak. Block astats provides decoded sample peak and RMS/peak meter bins. Silence
and nonfinite results remain null. Files without audio or longer than one hour
fail explicitly. The meter is a sampled output meter, not a live input meter.

A candidate is actually encoded and remeasured. Acceptance is unavailable unless
its full-mix true peak is at most −1 dBTP. The user auditions original/candidate,
then explicitly accepts a normal typed volume command through autosave/history.
All authored fades, curves, ducking, trims and speed stay intact. Uncertain edit
writes follow the existing editor recovery lifecycle.

Results bind project, saved Composition, editor revision, settings, source hashes
and output hashes. Source locks/rejections are respected. Changes invalidate
playback/acceptance; the server and application reject stale requests. Client
abort cancels child processes, partial caches are removed, and a retry creates a
new private review. Cache directories reject symlinks and use mode 0700; at most
five in-session completed reviews remain. Paths and original media are not sent
to providers.

Desktop, HTTP and `openfilm audio-quality --project <path> --composition <id>
--clip <id>` call the same application boundary. Loudness/peak values do not prove
speech intelligibility, musical balance or creative quality; those remain manual
listening decisions.
