# D3B1 independent audio timing and policy design

Date: 2026-10-30. Status: design candidate for independent audit; no product
implementation or media acceptance is claimed. Source baseline is merged main
`1005d381cc2000e0f991fc3e1779ebb2a61cd7ab` (including PR72). The authoritative
owner is the nested **Professional Cut Desk D3B1** item in `TASKS.md`, with the
D3B1 → D3B2 dependency in
[seven-subsystem reconciliation](../../roadmap/seven-subsystem-reconciliation.md).

## Scope and decisions

D3B1 adds independent sound timing to existing Clip occurrences, a closed B-roll
audio-policy value and pure evaluator, and one deterministic mix plan consumed
by render, Record and Sequence waveform projection. It reuses AudioAutomation,
transform.volume, the existing limiter, output measurements and role stems.
D3B2 owns visual coverage relationships, Story/solver proposals, acceptance
receipts and their persistence. No coverage relationship, coverage command,
proposal UI or durable coverage receipt is introduced here.

No second timeline, silent extra audio clip, source overwrite, provider call,
private-media upload, executable recipe or new dependency is permitted. Picture
timing stays on the existing rational frame contract. New audio timing uses
48,000 Hz sample coordinates; the UI accepts integer milliseconds. Legacy
projects without audioTiming and without supplied coverage retain their current
validation, mix graph, frame resolution, render and playback behavior exactly.

The selected implementation is a small pure core plan plus existing FFmpeg mix
execution. For new audio timing, Record plays the same rendered PCM mix using a
bounded WebAudio scheduler. This trades initial preparation latency for shared
tempo, effect and limiter behavior, with explicit preparation and error states.
It does not claim realtime original-source playback while preparing.

## Audited source and actual gaps

| Existing owner                                                              | Evidence at the pinned baseline                                                                                                                                                                                                                            | Required increment                                                                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/models.ts`                                               | Clip has sourceIn/out, timelineStart/duration, transform and AudioAutomation v1; no independent audio range or coverage meaning.                                                                                                                           | Optional inline audioTiming; separate pure EmbeddedAudioPolicyV1 type.                                                                 |
| `packages/core/src/sequence.ts`                                             | resolveClipFrameRange rounds picture start and ceils duration; resolveClipSourceRange shares trim defaults and 50 ms source tolerance. resolveCompositionFrame derives audible membership from picture frames.                                             | Preserve picture resolver; resolve new sound intervals outside frame membership.                                                       |
| `packages/core/src/sequence-waveform.ts`                                    | resolveClipAudioRange uses round(start × 1000), clips playable sound to source duration; projection is raw source peaks before gain/mix and excludes held video tails.                                                                                     | Keep exact absent-field branch; project explicit sound range and policy masks, including J/L extensions.                               |
| `packages/core/src/presentation.ts`; `packages/render/src/audio-filters.ts` | evaluateAudioGain and audioAutomationFilters already own fades, envelope and manual duck regions in local timeline seconds.                                                                                                                                | Use once per input, anchored to the independent sound start.                                                                           |
| `packages/render/src/index.ts`                                              | Every supported embedded stream can enter audioLabels. Source trim → tempo → volume → pad/trim → automation → millisecond delay; amix normalize=0 → alimiter limit=0.95. WAV is 48 kHz stereo pcm_s24le. Role filtering currently precedes graph creation. | Build policy first, filter stems afterward, and compile sample ranges without duplicate stream admission. Keep legacy graph unchanged. |
| `apps/desktop/src/components/RecordMonitor.vue`                             | Separate muted picture elements and audible media elements; frame-driven membership, evaluateAudioGain, element.volume clamped to one, explicit gain-unavailable issue. No WebAudio implementation was found.                                              | New-policy PCM scheduler and continuous audio clock; never describe current Record as sample accurate.                                 |
| `apps/desktop/src/composables/useRecordTransport.ts`                        | rAF publishes integer picture frames; buffering, owner generations, visibility and reverse semantics are explicit.                                                                                                                                         | Share transport intent and holds; derive picture frame from continuous PCM playhead for new-policy playback.                           |
| `packages/solver/src/editing.ts`                                            | Typed audio.add rejects video sources. trim/speed resize and ripple; automation is clamped in local clip time. Split already rejects nontrivial automation. Caption end bounds are protected, but no general caption retime exists.                        | Typed audio.timing command; preserve explicit audio through edits and fail closed on unimplemented partition/retime.                   |
| `packages/application/src/editor.ts`                                        | Closed command parser, serialized revision checks, request fingerprints, detached candidates, one history entry and save rollback.                                                                                                                         | Validate sound/media facts and capability version in this transaction; preserve existing CAS.                                          |
| `packages/application/src/audio-quality.ts`                                 | Measures real MP4 mix/stem/candidate; source hashes and disk snapshot are rechecked.                                                                                                                                                                       | Reuse measurements; policy preview gets equivalent stale/hash fencing. No new loudness control.                                        |
| `packages/application/src/collect-coverage.ts`, `collect-derived-media.ts`  | Coverage uses visual source ranges; derivative remap changes sourceIn/out.                                                                                                                                                                                 | Include independent sound dependencies; conservatively retain original media for explicit audioTiming in v1.                           |
| `SequenceWaveform.vue`, preparation/cache modules                           | Saved Composition, source hash, revision, 30-second viewport, bounded columns/cache and preparation lifecycle.                                                                                                                                             | Retain raw peaks and cache; add sound interval and excluded/suppressed state.                                                          |

The old schema reader accepts additive Clip keys, so a field alone cannot stop
an old application from ignoring the new sound semantics. Catalog v6 stores
inline JSON and needs no database migration.

## Options considered

1. Materialize a hidden audio clip and mute the video. Rejected: duplicates
   occurrence identity, source ownership, locks and possible mix contribution.
2. Extend picture sourceIn/out or use volume automation as a pseudo J/L cut.
   Rejected: changes picture timing or hides available source handles, and cannot
   begin sound before picture activation.
3. Inline independent sound range plus pure plan, selected. One occurrence,
   explicit source availability and shared execution; coverage remains B2-owned.
4. New browser tempo/limiter engine. Rejected for this slice: browser playbackRate
   and compressor behavior cannot promise FFmpeg atempo/alimiter parity. Rendered
   PCM reuses the actual existing graph, with bounded local cache costs.

## Closed contracts and capability version

New definitions live in `packages/core/src/audio-policy.ts`, exported by core.
Clip gains only `audioTiming?: AudioTimingV1`:

```ts
interface AudioTimingV1 {
  version: 1;
  sampleRate: 48000;
  timelineStartSample: number;
  sourceInSample: number;
  sourceOutSample: number;
}
type EmbeddedAudioPolicyV1 =
  | { version: 1; mode: "keep-primary" }
  | {
      version: 1;
      mode: "mix-secondary" | "replace-primary";
      role: AudioAutomation["role"];
      gain: number;
    };
```

Every sample coordinate is a nonnegative safe integer; sourceOutSample is
strictly greater than sourceInSample. sampleRate is exactly 48000. Integers are
canonical coordinates in the decoded/resampled source clock, not claims about
the source's native sample rate. Source bounds use the primary audio stream
selected by the existing `:a` behavior; multi-stream selection is outside v1.
New-policy render must select that same stream explicitly (first audio stream)
for reproducibility. End sample is start plus
`round((sourceOutSample - sourceInSample) / clipSpeed)`; require positive safe
length and an end no greater than `round(composition.duration * 48000)`.

Reject unknown keys/versions, NaN, Infinity, strings, negative or unsafe samples,
non-plain objects, accessors, prototype keys, sparse arrays and over-budget
inputs before reading nested payloads or allocating a graph. Policy gain is
finite in [0, 1]; keep-primary forbids role/gain keys. Roles are precisely the
existing music/narration/ambience/dialogue union. No filter strings, paths,
URLs or runtime configuration fields exist in either value.

Introduce `AUDIO_PROJECT_SCHEMA_VERSION = "1.2.0"`, promoting atomically on
first audioTiming write and never silently downgrading after removal or Undo.
Pin promotion must choose a capability floor and never rewrite 1.2 to 1.1.
Project 1.0 remains the default for new projects and legacy migration. Support
1.1 only with the reviewed pinning capability described below; do not advertise
1.1 parsing while omitting its required pin enforcement. Update version dispatch,
JSON Schema, project import/export, snapshots and hardcoded project-version
readers. Reject audioTiming in 1.0/1.1; reject unknown future versions. A frozen
old 1.0 validator and the pin-aware 1.1 validator must reject 1.2 before Clip
processing. Explicit Named Version Restore can restore an older complete
project with its older header. This is a project capability version, not an
application release number or a change to pipeline recipe versions.

## Independent timing and effects

`resolveAudioInterval(clip, asset, compositionDuration): ResolvedAudioInterval`
returns occurrence identity, source sample bounds, speed, timeline start/end
samples, `automationDurationSeconds` and the legacy/explicit discriminator.
The absent-field branch delegates to the existing resolveClipAudioRange exactly.
Do not change legacy padding or tolerance while sharing the exported helper.

Canonical source zero is the existing renderer's normalized demux timeline
zero, shared with picture sourceIn, not the first nonzero audio sample. The
selected decoded audio stream honors demux edit lists/skip samples (including
AAC priming). The new branch uses `aresample=48000:async=1:first_pts=0` before
sample trimming, preserving timestamp gaps as silence and trimming negative
preroll relative to that source zero. Do not insert asetpts=PTS-STARTPTS before
this normalization: doing so would erase an audio stream's offset from picture.
Test a video whose audio starts 125 ms later and an AAC edit-list fixture, in
addition to ordinary 44.1/48 kHz sources. Unknown/unreconcilable timestamp origin
fails explicitly. This is a shared render/preflight recipe, never a native file
sample or packet timestamp address. Source availability ends at the decoded
canonical stream end; declared picture duration cannot extend it.

For explicit timing, resample the selected source to 48 kHz, trim by sample,
reset PTS, apply the existing tempo chain once, then pad/trim to the derived
integer output length. This preserves existing pitch-preserving tempo behavior;
resampling establishes the coordinate domain before trimming. Audio cannot
borrow held-picture/crossfade tails. Actual decoded source availability is
verified before publishing a render/preview; metadata is an early gate, never
permission to synthesize a missing handle. No 50 ms tolerance silently pads a
new explicitly requested handle. Missing audio or unknown/unverified usable
duration produces an actionable failure; keep-primary can exclude a secondary
with no stream because it requests no secondary sound.

`audioTimingFromHandles(clip, asset, {startOffsetMs, endOffsetMs})` produces a
range from a currently linked clip. Both offsets are integer milliseconds in
[-60000, 60000]. Let A = round(clip.timelineStart × 1000) × 48,
I = round(resolvedSourceIn × 48000), S = clipSpeed, and D = clip.timelineDuration.
Start = A + startOffsetMs × 48; sourceIn = I + round(startOffsetMs × 48 × S);
sourceOut = I + round((D + endOffsetMs / 1000) × 48000 × S).
The ordinary validity checks then apply, including real source availability and
composition bounds. Negative start offset produces a J cut; positive end offset
produces an L cut. These conversions run once at explicit user acceptance;
reopen/render never reconstruct them from picture coordinates. Advanced API
values remain sample precise within the same bounds on actual media/duration.

For an already independent clip, inspector deltas extend its existing sound
range; changing the start also adjusts sourceIn by delta × speed, preserving
synchronization within one sample. The displayed ms values derive from stored
samples, with a sample remainder when not millisecond aligned. Reset means
explicitly remove audioTiming and return to the existing linked range; show
that its sound boundary changes before accepting.

AudioAutomation retains its existing shape and validation. With audioTiming,
its local zero is the independent sound start, and duration is the derived sound
length; apply volume, fades, envelope and ducking once. A timing command keeps
existing numeric automation values, validates them against the new duration,
and rejects if they no longer fit. It never silently truncates effects. The
inspector explains that moving the sound start also moves its effect clock;
users can send audio.configure in the same atomic batch. Existing
constrainAudioAutomation and legacy overlay auto-truncation must be bypassed
for explicit audioTiming; final-candidate validation replaces silent mutation. No source-relative
word alignment, automatic duck detection or new loudness normalization exists.

## Pure B2 handshake and deterministic mix

The following type is a transient validated evaluator input, never a new saved
Composition field, public command, or generic HTTP input in D3B1:

```ts
interface CoverageAudioBindingV1 {
  version: 1;
  bindingId: string;
  compositionId: string;
  primaryClipId: string;
  secondaryClipId: string;
  startSample: number;
  endSample: number;
  policy: EmbeddedAudioPolicyV1;
}
interface AudioMixContext {
  timebase: ProjectTimebaseV1;
  coverage: readonly CoverageAudioBindingV1[];
}
```

B2's future adapter constructs this only from accepted coverage at the current
revision after verifying source hashes, occurrence IDs, roles, bounds and locks.
B2 persists its own receipt with mode/role/gain/revision/hash, and owns retry,
Undo/reopen and invalidation. Binding IDs are unique 1–256 character identifiers;
clip identity is composition + clip ID, never asset ID. Maximum 1000 bindings
and 10,000 resulting plan segments per composition; reject before exceeding
budgets. B1 validates referenced clips and composition identity, primary !=
secondary, positive half-open windows inside both audible ranges (except no
stream is required for an excluded keep-primary secondary), and contradictory
bindings. For keep-primary without secondary sound, bound by its picture range.

The exported plan records have these fixed fields (all arrays are detached):

```ts
interface ResolvedAudioInterval {
  clipId: string;
  assetId: string;
  clock: "legacy" | "samples-48000";
  startSample: number;
  endSample: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  speed: number;
  automationDurationSeconds: number;
  // Preserve exact legacy floating trims/duration/delay for the legacy compiler.
  legacyRange?: ReturnType<typeof resolveClipAudioRange>;
}
interface AudioMixSegment extends ResolvedAudioInterval {
  key: string;
  trackIndex: number;
  clipIndex: number;
  automationStartSample: number;
  role: AudioAutomation["role"];
  baseGain: number;
}
interface AudioMixPlan {
  version: 1;
  sampleRate: 48000;
  durationSamples: number;
  legacyOnly: boolean;
  segments: readonly AudioMixSegment[];
  masks: readonly {
    clipId: string;
    startSample: number;
    endSample: number;
    reason: "excluded-secondary" | "replaced-primary";
  }[];
}
```

Segment sourceIn/out describe the original occurrence's processed branch;
start/end describe its admitted output window. automationStartSample retains
that branch's original start. Consumers calculate the trim offset from that
origin; they must not reinterpret the segment start as a new source/effect zero.
For a legacy occurrence, retain its exact range payload for legacy compilation;
canonical sample coordinates are derived interval indexes, never written back.

`buildAudioMixPlan(composition, assets, context): AudioMixPlan` returns ordered
segments and excluded occurrence intervals. Each segment carries clip/asset ID,
source mapping, start/end sample, automation origin/duration, effective role,
effective base gain and a stable segment key. No persisted time authority is
created. Ordering is timeline start, saved track index, saved clip index, then
segment start. Sweep sorted interval endpoints; no per-sample allocation.

| Policy                                               | Primary contribution                                                   | Secondary contribution                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| keep-primary (default only when B2 creates coverage) | Existing sound and automation unchanged                                | Excluded for that covered occurrence; no embedded fallback |
| mix-secondary                                        | Existing sound unchanged                                               | One input within accepted window, explicit role and gain   |
| replace-primary                                      | Suppressed only inside accepted window on the named primary occurrence | One input within accepted window, explicit role and gain   |

A coverage-owned secondary is admitted only through its bindings, never through
the ordinary embedded-input path, including outside the accepted windows. B2
must split or explicitly model uncovered uses of the same occurrence; B1 does
not infer that intent. Repeated use of the same asset in different occurrences
remains separate. Two overlapping bindings for the same secondary fail; two
replace-primary windows on the same primary also fail if they overlap. Disjoint
windows are allowed. A clip cannot be primary in one binding and secondary in
another in v1; this excludes recursive or cyclic suppression. Multiple distinct
mix-secondary occurrences may overlap and intentionally sum once each.

Policy gain replaces the secondary's effective base transform.volume for that
binding; it is never multiplied by a second saved gain. Policy role overrides
routing for that binding; existing automation still supplies its envelope once.
This is an explicit accepted-policy override, shown by future B2 UI. B2 must
update/reaccept or invalidate its receipt when the underlying secondary controls
change; B1 offers no standalone coverage controls that could conceal this.
Primary volume/role are never rewritten. Build suppression before selecting a
stem (including stem role discovery and audio-source preflight), so an ambience replacement still suppresses dialogue in a dialogue-only
stem. No global music/narration mute and no cross-asset suppression is allowed.

For a fragmented primary, trim/delay sound segments while keeping the original
independent audio automation clock and tempo phase. Prefer one decoded/tempo
branch per occurrence, apply automation once, then split/trim branches; never
restart atempo, fadeIn, fadeOut or ducking at every coverage boundary. Compile
sample-exact masks with atrim/asplit/concat and silence intervals, not a
frame-evaluated volume step that could shift the accepted mute boundary.

The final mix stays `amix normalize=0` followed by the existing limiter and film
end padding/trim. Preserve the existing limiter's complete options/defaults,
including observed gain/latency behavior; acceptance compares against the same
baseline graph. This slice adds no limiter or normalization algorithm. Stems use
the same plan and existing per-output limiter semantics; summing limited stems
is not promised to reconstruct the limited master under overload.

## Commands, edit compatibility and persistence

Add `{type: "audio.timing", clipId: string, timing: AudioTimingV1 | null}` to
TimelineCommand and the existing closed application parser. No origin, asset
path, coverage binding, frame rate or source hash supplied by that command is
trusted as authority. Reuse one optional fourth `TimelineEditContext` argument
with authoritative `timebase` and server-owned `origin`; do not introduce a
competing argument or a client-origin bypass.

| Operation on a clip with explicit audio | v1 behavior                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| audio.timing/configure/volume           | Explicit target edit under clip/source locks; validate effect duration and full candidate before save.                                                                                                              |
| Picture trim                            | Keep its independent sound samples exactly. Existing visual ripple moves affected peers and their independent audio by the same rounded sample delta; reject invalid sound bounds or protected peers.               |
| Speed                                   | Retain explicit sound source bounds and start; derive new sound duration with new speed, validate effects, film bounds and caption conflicts. No hidden source extension.                                           |
| Reorder/audio.move/ripple peer          | Translate audio start by round(actual saved picture delta × 48000), preserving source range. Validate the whole candidate; no cumulative frame-to-ms conversion loop.                                               |
| Split                                   | Reject any explicit audioTiming in v1 with `timeline.audioTimingConflict`; explain that audio must first be explicitly relinked. Existing automation split refusal also remains. No duplicate range on both halves. |
| Delete                                  | Remove the occurrence and its sound together; existing required-source and lock guards remain. Validate remaining independent ranges after ripple.                                                                  |
| Replace                                 | Reject while explicit timing exists; user must explicitly reset sound before replacement. Never carry old source coordinates into a new asset.                                                                      |
| Duration shortening/regeneration        | If an independent range would be truncated, moved through a protected object or discarded without an explicit target edit, fail atomically. No automatic clamp/drop as for legacy overlays.                         |
| Undo/Redo                               | Restore complete prior/pending objects in one entry; preserve capability header monotonicity. Reopen keeps latest saved data, not session undo history.                                                             |

Source-linked captions referring to a target are unchanged by audio-only handle
edits because source-to-sequence synchronization stays within one sample. Reject
an arbitrary API timing assignment that shifts that mapping by more than one
48 kHz sample while such cues exist. Picture trim does not silently rewrite
captions. Any speed/ripple/delete that changes a linked cue's mapping or leaves
its source window outside the resulting audible range fails with
`timeline.audioCaptionConflict`; an explicit caption edit/delete in the same
transaction can resolve it. Validate against the final batch candidate so
command order does not decide whether the conflict clears. Manual captions,
GraphicScenes and other overlays retain their existing absolute clocks and
range guards. D4 owns future compound retime policy; D3B1 does not infer word
alignment or weaken current source/clip/graphic locks.

Application captures the revision, actual source hash/duration/stream facts and
settings; after async work and before commit it rechecks queued CAS plus hashes.
A stale source/relink or changed disk baseline rejects with no partial history,
manifest, catalog, clip or receipt change. Include full audioTiming in revision
fingerprints, request replay, snapshots, Named Versions, variants and Collect.
Preserve unrelated fields by cloning/updating owners, never reconstructing Clip
from a stale allowlist. Variant generation must preserve independent audio
coordinates for retained instances or reject incompatible placement; it cannot
silently relink sound. Collect forces whole originals for any explicit audio
range and rejects derivative remapping of those assets in v1, including mixed
legacy/explicit occurrences; audio handles may extend beyond picture selection.
Interchange exports must retain native metadata and report unsupported independent
audio timing where the target cannot represent it, never claim exact fidelity.

## Independent candidate integration

The inspected pinning design is
`../v1-user-pinned/docs/superpowers/specs/2026-10-30-user-pinned-overrides-design.md`
in its separate worktree. Its implementation is **not in this pinned baseline**.
It promotes schema 1.1 on first pin, protects the full Clip payload against
automatic changes, and owns server-selected origin in TimelineEditContext.
D3B1 must integrate against the reviewed result before enabling 1.1/1.2 project
support. Direct audio.timing edits pin the full occurrence under that policy;
automatic timing changes cannot bypass pins through a new field. Pin removal
must not strip audioTiming; audio reset must not remove pin metadata. Audio-only
UI still respects source locks. No partial candidate code is copied here.

D5A PhotoLayout/PhotoMotion v2, D5B titleRuns/textRuns/TitleStyle.finishing,
D5C primaryColor/inheritance, and D8 local FilmLook/preset provenance are also
independent candidates. Full-object clone/update, history, restore and export
paths must preserve their versioned fields after integration. D3B1 adds no
replacement presentation/color/preset schema and weakens none of their closed
validators. Shared-file integration tests use actual landed owner validators,
not permissive temporary types or claims that the candidate already shipped.

## Record, waveform and UI behavior

Legacy Record remains unchanged when no explicit sound policy is active. A
policy-enabled composition uses a private, revision/source-bound PCM render via
existing audioOnly rendering and a new `RecordAudioPreviewService`. Requests
accept only composition ID and base revision; B2 will later provide server-owned
coverage through the same resolver. Internal RenderOptions gains optional
`audioMixContext?: AudioMixContext` for trusted adapters and media fixtures; it
is never forwarded from unvalidated HTTP input. Render manifests record the
audio policy version and canonical plan digest only for this new path, alongside
existing source hashes and toolchain evidence. Legacy manifest output is unchanged. No client-supplied composition or mix plan.

Service budget: at most one active preparation per project, 3600 seconds per
composition, 1 GiB output per preview, and 2 GiB completed cache with LRU eviction
excluding an active reader. Use existing job/cancel and safeProjectCachePath
infrastructure, private modes, temporary publication, source manifest hashes,
and checked disk/project identity. Failed, cancelled, over-limit or stale work
publishes no ready descriptor; an existing valid generation remains reusable
only under its exact key. Probe metadata and expected PCM length before serving;
`-fs` truncation is a failure, not a ready result. Preparation may be slow for
long films; show progress/cancel. Over-limit or unavailable playback is explicitly
reported and never falls back to an incorrect mix. MP4/WAV export remains usable.

A ready descriptor contains version, opaque ID, revision, source-key digest,
48000 sample rate, two channels, pcm_s24le and exact sample length; never an
absolute path. A bounded PCM range endpoint takes integer startSample/count
(maximum 192000 frames, four seconds), returns only the known WAV data chunk
with explicit shape headers, and uses existing host/origin/session protections.
Parse WAV chunks defensively with bounded header reads and data-size checks;
reject unsupported layouts. Preparation and playback start/seek recheck actual source hashes; each range
request checks captured file identity, revision and source-generation state.
Detected changes revoke the descriptor before more nodes are scheduled and
teardown playback; local cache corruption fails closed. Cache files never replace source
media or project state.

The WebAudio controller converts little-endian signed 24-bit PCM into float
AudioBuffers without reapplying gain, ducking or limiting. At most eight seconds
of PCM is buffered; schedule two-second contiguous blocks against one
AudioContext.currentTime anchor with a 250 ms lookahead and generation fence.
At normal 1× play, audio elapsed time is transport authority; picture frame is
floor(elapsed × rational rate) via shared helpers. Seeking anchors to the chosen
picture time converted once to sample; output audio edges retain sample timing
between picture frames. Buffer starvation holds picture/playhead before another
block starts; pause/seek/revision/project change/visibility loss/dispose cancel
scheduled nodes and pending range reads. Reverse and non-1× shuttle remain silent
for this policy mode and display that limitation; normal 1× playback is the parity
claim. Resume requires a user gesture when the browser requires one. If WebAudio
is unavailable, report unsupported preview instead of playing legacy audio.
All picture elements and legacy audio elements are muted/disconnected while PCM
owns sound, preventing hidden double mix. Hardware output latency and resampling
remain physical listening gates; automated parity is measured before the device.

Sequence waveforms continue to show raw source peaks, never rendered loudness.
Extend the shared projection with per-column audible/excluded/suppressed masks;
retain source coverage and peaks separately. Draw independent sound outside
picture edges within the existing Sequence row, with J/L boundaries. Use subdued
raw peaks with an explicit muted/excluded label; never draw silence as if the
source has no waveform. A partially suppressed column records both states;
source peaks are not multiplied by policy gain or automation. Include timing,
policy digest and revision in projection invalidation without duplicating source
peak caches. Source Monitor waveform remains unchanged. Timeline selection and
horizontal scrolling remain on existing rails.

Add a compact Sound section to the selected clip inspector: linked/independent
state, source handle availability, start/end ms fields, Apply, Reset sound timing,
and pending/error state. Use existing volume and role/fade/duck controls. No
B-roll coverage selector is shipped before B2. Disabled controls explain missing
stream, source lock, pending media facts, source exhaustion or unsupported split.
English, Traditional Chinese and Japanese strings and accessible labels/errors
must ship with the controls; no optimistic saved state before durable response.

## Threat model and failure checks

| Input/failure                                              | Required boundary                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Malicious timing/policy JSON                               | Closed descriptor-safe validators, finite safe coordinates, budgets, no path/filter execution.                       |
| Old application drops unknown semantics                    | 1.2 capability gate; frozen 1.0 and reviewed 1.1 rejection fixtures.                                                 |
| Stale revision/source or same asset ID with replaced bytes | Recheck CAS and actual hashes after preparation and before publication; exact snapshot identity.                     |
| Hidden duplicate sound                                     | One admission per occurrence, coverage-owned exclusion from default path, all legacy media muted for PCM mode.       |
| Global suppression or stem-only reappearance               | Primary occurrence interval subtraction before role filtering.                                                       |
| Effect/tempo restart at coverage edge                      | One occurrence audio branch and effect clock; segment only afterward.                                                |
| Source too short, metadata optimistic, missing stream      | Explicit range preflight plus decoded evidence; no silent pad of requested handles.                                  |
| Denial of service/cache abuse                              | Plan/window/file/cache budgets, cancellation, bounded PCM reads, no arbitrary cache path; stale reader invalidation. |
| Edit loses pin, title/color/preset or captions             | Full-owner cloning, final-candidate validation, shared origin, explicit conflict, atomic rollback.                   |
| Preview claims success while output differs                | Real PCM/MP4 evidence with negative controls; no graph-string-only acceptance.                                       |

## Acceptance and evidence contract

These are required implementation gates, **not results from this design turn**.
Use synthetic local sources; record source SHA-256 before and after every media
run, exact feature/base commits, FFmpeg/FFprobe versions, full commands, manifests,
encoded hashes, decoded PCM hashes, sample windows, measured thresholds and
negative-control failures. Encode hashes are provenance, not cross-platform
pixel/audio equality requirements. Run only focused tests and port-0 HTTP until
the coordinator grants a browser lease; never seize 4310/1420, run full Vitest,
normal Playwright or native benchmarks in this design worktree.

1. Pure timing: 24/25/30 and 30000/1001 pictures; off-frame .017-second start;
   44.1/48 kHz input; mono/stereo; .5/1/2 speed; zero/negative handles; one-sample
   edges; source missing/short; unsafe values; legacy missing-field exact objects
   and filter graph. Explicit source sample mapping error ≤ 1 canonical sample.
2. Two-tone J/L fixture: 12-second composition, first picture [0,6), next [6,12),
   second source has verified handles. Distinct 440 and 880 Hz tones at amplitude
   .1; J sound starts at 5.250 seconds, L first sound ends at 6.500 seconds.
   Assert picture cut still frame 180 at 30 fps and frame 180 at 30000/1001's
   existing rounding, with respective timebases retained. At speed 1, PCM event edges after
   measured common renderer latency differ from expected by ≤ 1 sample. Pin
   the common delay from a baseline impulse; do not individually align each edge.
3. Three-tone coverage fixture: primary 440 Hz, secondary 880 Hz, unrelated music
   1320 Hz, each amplitude .1; accepted coverage [4,6) and [8,9). keep-primary
   has no 880 Hz, continuous primary/music; mix-secondary at gain .5 adds exactly
   .5 times the secondary solo-baseline amplitude; replace-primary removes only
   440 Hz within accepted windows and retains music. Source sample identity and
   role/gain appear in the plan and evidence. Same asset used in a second clip
   remains independently audible. Overlapping forbidden bindings reject.
4. Real artifacts: render actual H.264/AAC MP4 and PCM WAV, decode MP4 audio at
   48 kHz, render all role stems, and capture the actual Record PCM stream into
   an OfflineAudioContext/scheduled browser graph under a later leased browser.
   WAV/Record normalized PCM max absolute error ≤ 2/2^23; block-seam discontinuity
   matches WAV within that bound. Spectral amplitudes measured in 200 ms windows
   ≥100 ms from edges: included tone ratio within ±0.5 dB of the same-codec solo
   control, excluded tone at least 45 dB below that control. AAC event timing
   tolerance ≤ 1024/48000 seconds after container skip/priming handling; retain
   the stricter PCM edge gate. For non-1× speed, compare the admitted sample
   window to a separately rendered identical atempo reference: pitch-preserving
   DSP is not a one-to-one sample permutation. No independent time-warp/correlation
   per event.
5. Gain/automation: constant gain, >1 legacy gain, fades, points and duck regions
   spanning coverage boundaries; automation clock never restarts. Low-level
   fixtures isolate no-double-mix (doubling would add ~6.02 dB). Peak and loudness
   reports use existing measureAudioOutput; loudness is measured, not silently
   normalized. Overload fixture compares the exact existing limiter baseline,
   and role stem tests document the existing per-stem limiter behavior.
6. Persistence/edit matrix: exact range through save/reopen/Undo/Redo/Named
   Version/variant/Collect; pin coexistence; mixed same-source occurrences; source
   hash changes; stale requests; disk save failure; missing stream; actual short
   decoded source; trim preserving audio; speed conflict; split/replace rejection;
   linked-caption final-batch conflict; no partially published clip/history/cache.
7. Negative controls must fail the same harness: deliberately add secondary
   twice; quantize J onset to a picture frame; suppress all narration; restart
   automation at 4 seconds; alter source bytes after capture; truncate PCM file;
   bypass role-aware suppression; feed previous preview after Undo. Record each
   expected failed metric/guard, not just a successful command exit.

Manual gates remain: representative dialogue at J/L boundaries, device latency,
long-project preparation/cancel behavior and actual Windows/macOS Record/export
listening. A passing Linux synthetic suite does not close these gates. The v1
split/reset limitation, one-hour PCM preparation bound and silent shuttle mode
must remain visible in release notes and the guide until their owners expand
the contract.
