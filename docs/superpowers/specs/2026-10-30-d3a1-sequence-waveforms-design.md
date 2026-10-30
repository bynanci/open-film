# D3A1 — source peaks in the saved Sequence

## Intent and existing owners

Expert editors need to see source audio in Sequence time while seeking the saved
cut. Existing `WaveformData.sampleRate` is bins/second, not PCM sample frequency.
Keep FFmpeg extraction/cache identity and Source waveform controls. Reuse
`resolveClipSourceRange`, `resolveClipFrameRange` and the rational Record clock.
Story cards have clamped widths and cannot represent a globally linear clock.

## Approach

Add a derived waveform overview under the existing Record monitor. It seeks that
monitor through its existing guarded navigation; it has no clip storage, edit
commands or playback clock. Reusing Story-card x positions would misrepresent
time; a second editable track model would violate the single Composition owner.
These are engineering choices under the user's approved D3A1 scope.

The view has bounded frame-based windows, previous/next/fit controls and a single
Record playhead. Raw source peaks are explicitly labelled before gain, fades and
ducking. They are not an output mix/loudness meter. Source locks permit this
read-only evidence; preparation uses existing analysis protection and jobs.

## Contracts and bounded work

- Pure core `projectClipWaveform` consumes clip, asset, trusted current source
  hash, waveform, project timebase, half-open viewport frame range and1..2048
  columns. It returns peaks plus coverage for those columns. No persistence.
- Resolve rounded picture edges/ceiled duration through the existing frame
  helper. Extract the renderer's existing `round(timelineStart * 1000)` audio
  delay into `resolveClipAudioRange`; use it in renderer and waveform projection
  without changing output timing. Audio may start inside a picture frame.
  Project those audio intervals into the rational frame viewport through source-in
  and speed, clamped to source-out/source duration/waveform/clip duration. A short
  source ends in silence; neither the held video frame nor crossfade picture
  tail extends its peaks. Coverage uses the audio interval, not a rounded video tail.
- Match waveform asset and source hash, reject nonfinite/invalid shapes or more
  than20000peak bins. Source-bin boundary rounding is shared with Source view.
- Existing application intelligence adds a waveform-only batch read:1..8unique
  imported asset IDs, each1..1024UTF-16 units. It hashes/verifies through the
  existing identity owner, returns current source hash and cached evidence, and
  never hydrates transcript/scenes/markers. No new extractor or persisted schema.
- HTTP read includes project ID and verifies the open project both before and
  after awaited work. Desktop uses this same application method. Per-asset
  unavailable/changed evidence is typed; unexpected storage errors still fail.
- UI keeps at most32waveforms, reads at most8visible assets per batch, at most
  two reads concurrently, and makes no requests on playhead ticks. Pagination
  exposes additional sources; absent evidence remains visible as absent.
- Explicit preparation queues visible missing sources one at a time through
  existing waveform jobs. Cancel stops owned queued work; active shared/foreign
  jobs are never cancelled. Retry is explicit and refreshes current evidence.

## Safety, compatibility and interaction

Local imported sources only; paths never come from waveform HTTP inputs. No
network provider, JS/HTML execution, source rewrite, new timeline, project/catalog
schema or edit history change. The view owns abort controllers and generations;
project/composition/revision/source-version changes and unmount fence reads and
stop queued preparation. Delayed results cannot attach to another film or source.
Cache eviction is deterministic; context invalidation clears stale peaks.

Record seek uses existing flush/history/ownership barriers. Read-only projection
is allowed for pinned/locked clips without changing their state. Keys and pointer
seek cannot bypass disabled state. Native slider semantics, descriptive labels,
visible focus,44pxcoarse targets, three locales and existing Quiet Studio tokens
keep the feature usable in narrow/CJK workspaces. Rendering output is unchanged.

## Acceptance

Independent literal pulse fixtures cover trim, speed, rational start rounding,
short explicit source ranges, shortened final bins, repeated source clips,
crossfade picture tails and no peaks beyond the half-open clip end. Source/hash
mismatch and invalid/deep/large work fail closed. Application/API tests prove
waveform-only reads, bounded IDs, project switch fencing and unchanged saved
Composition/history/source bytes. Browser tests cover prepare/retry, seek/keyboard,
missing evidence, locks, context races, reopen, responsive/CJK and request counts
during playback. A real synthetic pulse-source MP4 is rendered and decoded;
observed pulse times must match projected Sequence positions within a declared
frame/bin/sample tolerance, with original hashes unchanged.
