# Professional Cut Desk Phase 4B — deterministic animation and retiming

**Status:** Approved staged design; 4B.1 hosted validation passed; 4B.2 implementation candidate

**Baseline:** `main` at `9b33249c3bd60872072c55fac4efac43d6d6e13b`, through draft PR #125 head `1d8712571139d5654eda6bdbccaaac302a06c5a0`
**Scope:** one versioned clip-time contract, then supported visual keyframes and
forward speed ramps in separate reviewable increments.

## Intent

Let an editor animate a clip's supported visual properties and retime forward
video with repeatable, frame-addressable results. A saved Composition remains the
single source of truth. Preview, arbitrary seeks, FFmpeg output and downstream
source-time consumers must resolve the same clip-local time through one pure
contract.

The existing editor already has three related but separate behaviors: a scalar
`transform.speed` with a linear source-time map, photo motion evaluated on clip
local time, and GraphicScene `frame(t)` animation. Audio automation has a
sample-clock map and deliberately rejects edits whose mapping cannot be proven.
Phase 4B should reuse those boundaries and make their time assumptions explicit;
it must not add another timeline or rely on playback history.

## Goals

- Preserve schema-1.0.0 and current projects: absent animation data keeps the
  existing static visual transform and scalar-speed behavior exactly.
- Add a strictly validated, versioned clip-local frame contract for a finite set
  of visual properties: `x`, `y`, `scale`, `rotation` and `opacity`.
- Add a forward-only source-time map whose knots are addressed by integer
  project frames and whose source positions use bounded integer nanoseconds.
  Legacy clips resolve through the current constant-speed formula.
- Resolve visual values and source time from the requested frame alone. Seeking
  backward, out of order or after reopen must not depend on prior frames.
- Keep existing typed TimelineCommands, save/history queue, Undo/Redo, autosave,
  source locks, track locks and User Pin protections as the only write path.
- Preserve source bounds, captions, audio timing/automation, transcripts,
  waveforms, rhythm evidence and split/trim behavior, or reject an edit before it
  can save if its mapping cannot be preserved.
- Demonstrate Monitor/FFmpeg parity and bounded decode, seek, render-time and
  memory costs with synthetic media.

## Non-goals

- A second timeline, a general effects-graph rewrite, project-scripted plugins,
  executable expressions or arbitrary project HTML/JavaScript.
- Reverse playback, freeze-frame retiming, frame interpolation, optical flow,
  generated media, AI-authored keyframes or keying private media to remote
  providers.
- Claiming native keyframe interchange. NLE export must continue to classify
  unsupported or baked animation honestly.
- Changing audio-only automation into keyframes. The existing sample-accurate
  automation contract remains the owner for gain, fades and ducking.

## Approaches

1. **Shared versioned time contract, then separate feature slices (selected).**
   Introduce one pure clip-frame resolver and legacy adapter first; add visual
   property keyframes next; add source-time/speed ramps after their consumers can
   share the mapping. This matches the existing Composition and renderer
   boundaries and makes each risk independently testable.
2. **Implement keyframes and speed ramps in one large renderer change.** This
   exposes end-to-end behavior sooner, but couples schema, preview, captions,
   audio, split/trim, render and NLE export before the time rules are settled.
3. **Keep separate feature-specific clocks.** Rejected because photo motion,
   general transforms, clip speed, audio and captions would continue to drift
   under edits and arbitrary seeks.

The staged shared-contract approach was selected by the user on 2026-11-06.

## Proposed contract and state flow

The persisted `ClipAnimationV1` contract below is a target for the visual
keyframe slice, not a field to add ahead of its consumers. Until Monitor and
FFmpeg can both honor it, 4B.1 must not persist animation data that one of them
would ignore. The first slice instead makes the existing legacy clip clock an
explicit, pure frame-time contract and routes Composition preview resolution
through it. This is a prerequisite for the persisted visual and source-time
maps, whose data will remain declarative JSON with bounded frames, properties,
knots and interpolation identifiers. Those values must be validated at project
load and the typed edit-command boundary in the slice that first persists them.

In v1, base visual state is evaluated with today's composition order: photo
motion acts on its photo layer, then the clip's static transform applies to the
result. A key on a property is an **absolute replacement** for that property's
final composition-frame value; it does not add to or multiply the prior value.
Unkeyed properties retain today's result exactly. This prevents an implicit
second stack while preserving existing projects. The geometry properties keep
the existing contract's units: `x` and `y` are composition-frame pixels from
frame center, `scale` is a positive multiplier and `rotation` is clockwise
degrees. Proposed limits are `x/y` within four times the larger composition
dimension, `scale` 0.01–10, `rotation` −3600–3600 degrees, and `opacity` 0–1.
Visual tracks have at most 128 keys each and 256 keys total per clip. These
limits are stricter than the legacy static transform validator and do not
retroactively restrict old projects.

The proposed persisted JSON shape for 4B.2/4B.3 is:

```ts
interface ClipAnimationV1 {
  version: 1;
  visualTracks?: Array<{
    property: "x" | "y" | "scale" | "rotation" | "opacity";
    keys: Array<{
      frame: number;
      value: number;
      interpolation?:
        | "hold"
        | "linear"
        | {
            kind: "cubic-bezier";
            x1: number;
            y1: number;
            x2: number;
            y2: number;
          };
    }>;
  }>;
  sourceTimeMap?: {
    points: Array<{ frame: number; sourceTimeNs: number }>;
  };
}
```

There is at most one track per visual property. Visual tracks are bounded to five
tracks per clip and map points to 64. Key values are finite numbers within their
property bounds; frame offsets and stored source timestamps are safe integers.
`opacity` is a layer-alpha multiplier: its default value is `1`
and the animated value multiplies the existing transition opacity, so an
existing crossfade cannot be disabled by an opacity keyframe. The first key's
value holds from clip frame `0` through that key; the last holds through frame
`N-1`. For consecutive keys, the earlier key's interpolation controls the
segment. `hold` switches to the next value exactly at the next key frame;
`linear` interpolates directly; `cubic-bezier` solves the normalized time curve
with 24 fixed bisection iterations and interpolates values using the
corresponding normalized output. All math is computed from the requested frame
without state accumulation.

The resolved clip frame range follows `resolveClipFrameRange`: integer
`startFrame`, half-open interval `[startFrame, endFrame)`, and
`N = endFrame - startFrame` output samples. Key offsets are clip-local output
sample indices in `[0, N-1]`; the final visible sample is `N-1`. Offset `N` is
not a visible keyframe. The retime map alone has boundary knots at offsets `0`
and `N`, so its final source timestamp describes the exclusive source endpoint.
The resolver accepts only a safe integer sequence-frame index and subtracts the
resolved clip start frame; it does not reconstruct frame indices by repeatedly
adding floating-point seconds. Project frame time is derived from the existing
rational `ProjectTimebaseV1` helpers.

Each visual key stores its value and outgoing interpolation: `hold`, `linear`,
or `cubic-bezier`. The default is `linear`. Cubic control points reuse the
existing validated photo easing shape: all coordinates are in `[0,1]` and
`x1 <= x2`, `y1 <= y2`, preventing time reversal and value overshoot. The value
at the last key holds through the remaining visible clip samples. A property
with one key is constant. Unknown properties, duplicate offsets, unbounded
curves and non-finite results fail closed.

The contract includes a source-time map for retiming. A map point pairs a
clip-local output frame with an absolute source timestamp in integer nanoseconds
from source start. Points are strictly ordered, remain inside the source asset
and move forward only. The first map uses linear source-time interpolation
between knots; each interval therefore has a measurable constant average speed,
and the speed may change at a knot without a source-time jump. The map has
exactly one start boundary at frame `0` and one exclusive end boundary at frame
`N`; both must match the validated source range. Interior points must have an
average speed between 0.25× and 4×. There is no implicit reverse or freeze
frame. Any later smooth interpolation must be a separately versioned extension
with a proven positive derivative over each segment. Existing clips without a
map resolve as `sourceIn + localTime * transform.speed`, preserving current
behavior.

Map endpoints must equal the effective source-in and source-out after converting
the existing seconds fields to integer nanoseconds once with nearest-nanosecond
rounding. Interpolated source positions remain continuous floating-point
nanoseconds in the pure resolver; conversion to a decoder timestamp happens once
at the named media-read boundary using that source stream's time base. Splits and
trims evaluate the same original map at their integer frame boundary, then slice
and rebase; they do not round an intermediate endpoint and reuse it as a new
clock.

When `sourceTimeMap` exists, its map is authoritative and the legacy scalar
`transform.speed` must be absent or exactly `1`; the typed retime command writes
explicit `sourceIn`/`sourceOut`, clears any non-1 scalar speed and rejects a
conflicting source range. This leaves all schema-1 clips on the current scalar
resolver until an explicit retime edit is accepted.

A single pure resolver in `@openfilm/core` accepts a saved clip, asset timing,
project timebase and arbitrary Composition frame. It returns the local frame,
resolved visual properties and source timestamp. It uses no wall clock, mutable
playback state, filesystem or project-provided code. Timeline preview asks this
resolver for the displayed frame; the FFmpeg renderer uses the same resolver's
finite segment data to construct its filter/timestamp plan. The renderer may not
maintain a second interpolation implementation.

The resolver's visual clock is clip-local output time and remains independent of
source trim or retiming. This keeps authored camera motion stable when a source
range changes. A retime command preserves the clip's timeline start and duration
in v1; it changes the source-time map and resulting source-out only through an
explicit typed command. It is rejected if the source endpoint, track/clip lock,
User Pin or dependent timing contract cannot be preserved.

## Delivery slices

### 4B.1 — deterministic legacy frame-time contract

- Add a pure `resolveClipFrameTime` API in `@openfilm/core` for saved legacy
  clips. Its `ResolvedClipFrameTimeV1` result returns the rounded clip start
  frame, local output-frame offset, rational-timebase local seconds, and
  scalar-speed source timestamp for an arbitrary requested sequence frame.
- Keep the current source-in/out validation, 50 ms duration tolerance, rounded
  clip start, half-open duration, source-end clamp, and presentation-tail hold.
  This slice does not add a persisted animation field, UI, schema migration or
  change saved Composition behavior.
- Route `resolveCompositionFrame` through the shared contract. FFmpeg continues
  to derive its affine trim/setpts plan from the existing shared source-range
  contract; keyframe and retime fields are not renderable until their later
  slices add preview and output consumers together.
- Test exact rational-rate sample mapping, first/last/exclusive samples, source
  clamps, invalid and pre-clip frame rejection, deterministic random seek order,
  and legacy behavior. Record local focused and full contract validation before
  calling this slice complete.

### 4B.2 — visual property keyframes

**Draft PR #126:** `codex/cut-desk-phase-4b-visual-keyframes-main`, stacked on
draft PR #125. This candidate adds strict schema-1.4 persistence,
typed edit commands, transient Monitor preview, split/trim rebasing and an
FFmpeg visual consumer for position, scale, rotation and opacity. It deliberately
does not add a source-time map or alter any audio clock. See
`docs/validation-cut-desk-phase-4b-visual-keyframes.md` for current evidence and
remaining gates.

- Add the optional versioned `ClipAnimationV1` model and strict validator in
  the same slice that adds Monitor and FFmpeg consumers, so no persisted key is
  silently ignored by one side.

- Add typed keyframe edit commands and an Inspector surface inside the existing
  TimelineEditor. Pointer/keyboard edits preview transiently, then save once via
  the current transaction and history queue.
- Initially animate only `x`, `y`, `scale`, `rotation` and `opacity`; keyed
  values replace only their matching static property. Keep photo movement
  presets intact for all unkeyed properties and resolve them through the same
  clip-local frame context.
- Split and trim preserve keyframe values at the seam, rebase right-side local
  frame offsets, and create one atomic Undo/Redo transaction. Locks and pins are
  checked before preview acceptance and persistence.
- Validate same-frame monitor/output values with synthetic animated MP4 probes,
  arbitrary seek order, Save/Reopen, Undo/Redo and stale revisions.

### 4B.3 — forward speed ramps

- Add a reviewable speed-ramp editor over the existing clip, with local-frame
  knots, per-interval speed and source-time readout, and bounded
  duration/source-range feedback. V1 is a forward-only, piecewise-linear
  source-time map; speed changes at knots are explicit and source time remains
  continuous.
- Route preview, source seeking, waveform/time mapping, audio and caption/source
  timing consumers through the shared resolver. Composition-time captions stay
  fixed; source-anchored cues are mapped by the retime map. Unreliable transcript
  timing must remain explicitly imprecise. Until the audio policy is approved
  and measured, reject a speed-map edit on a clip with audible embedded audio,
  non-default audio automation, or separate source-mapped audio timing. Never
  silently stretch, mute, drop automation, or desynchronize audio. Unrelated
  Composition-time music and narration tracks remain on their existing clocks.
- Apply splits and trims by evaluating the source map at the edit boundary,
  slicing/rebasing both sides, then running current lock, pin, caption, audio and
  max-duration validation. Any unsupported dependent mapping fails closed.
- Render a synthetic A/V MP4 with several ramp shapes; decode output frames and
  audio samples at start, knots, between knots and end. Compare them with the
  same resolver and test random-seek order, automation, captions, source hash,
  Undo/Redo, reopen and actual FFmpeg output.
- Do not mark this slice complete until the supported audio behavior and measured
  render cost are explicit; a visually correct ramp with drifting or silently
  discarded audio is a correctness failure.

## Safety, ownership and compatibility

- No source media is modified. Project data cannot contain executable content or
  remote references. Existing asset hash checks remain in force.
- Composition and typed edit commands remain authoritative. Vue components do
  not write clip arrays directly.
- Locked tracks/clips and User Pins are hard constraints. A direct accepted edit
  records the existing override/pin state; pipeline regeneration cannot replace
  it. Stale revisions reject rather than replay against a different clip.
- Optional V1 data is strict and bounded. Legacy projects load unchanged. A
  project schema version bump is needed only if an actual migration requires it;
  absence of animation data must not dirty an opened project.
- NLE reports classify the new values according to tested target fidelity; no
  native editable effect is claimed without import/playback evidence.

## Verification matrix

| Layer              | Required evidence                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract/unit      | Validation bounds, legacy adaptation, frame math, deterministic random seeks, monotonic source map and no accumulated state                   |
| Solver/application | Typed commands, lock/User Pin/stale rejection, exact split/trim mapping, atomic history, autosave and reopen                                  |
| Desktop/browser    | Inspector keyboard/pointer interaction, transient preview, project switch, accessibility, all locales, reduced motion and responsive Cut Desk |
| Renderer           | Synthetic source hash, actual FFmpeg MP4, decoded start/knot/mid/end frames and audio, shared resolver parity, cancellation                   |
| Performance        | Decode/seek time, filter-plan size, render throughput, peak memory and resolver cost at bounded knot counts                                   |
| Interchange/manual | Compatibility report and separate target-NLE, physical workstation, real-media and sustained 4K gates                                         |

Full repository CI is required for each feature PR. Native install, signed
Windows/macOS workstations, hardware playback and Resolve are separate manual
gates and cannot be inferred from Linux CI.

## Risks and calls for the implementer

- FFmpeg filter expressions can grow with curve count. Keep knots bounded and
  measure plan size before increasing limits; avoid building one command term per
  output frame.
- Source nanoseconds must be converted consistently to decoder timestamps and
  48 kHz sample boundaries. Round only at named decode/output boundaries, not
  repeatedly while splitting.
- Speed maps can invalidate audio automation, transcript source mapping, captions
  and rhythm evidence. Each owner must consume the shared mapping or reject the
  operation with an actionable reason.
- Audio policy for speed ramps remains a product decision: (A) use
  pitch-preserving variable-speed processing with measured fidelity and exact
  automation/sample mapping, or (B) keep the first ramp release picture-only and
  reject edits while embedded/source-mapped audio is audible. The default
  recommendation is B until A has decoded-audio evidence, because the current
  `atempo` chain handles one scalar speed and is not a variable-speed quality or
  synchronization contract.
- Cubic interpolation can reverse or overshoot between valid endpoints. Validate
  monotonicity of the entire segment, not only the knots.
- User-facing speed values should be derived from the map and displayed with
  measured source/time consequences; avoid a speed control whose saved result
  differs from its preview.

The builder may choose renderer expression construction and exact conservative
resource limits after measurement, but may not weaken bounds, source validation,
history, lock/pin protections or actual-render evidence.
