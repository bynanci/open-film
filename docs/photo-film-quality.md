# Photo-film quality slice

This slice implements the supplied 2026-10-17 review's first visible outcome:
an editable, recoverable twenty-second A/B film made from generated public
fixtures. Its base is `f9ad717d8c70db61fb4f9863a350e807f15643c0` (PR #17),
whose complete Verify runs passed. Main remains
`c1b198f3a8a413a5500453f34127c1b6a5850be9` until that dependency merges.

## Contract

- Optional version-1 clip layout, motion, title style and audio automation keep
  old schema-1.0.0 projects readable. No database migration is needed.
- Contain preserves source proportions; hero uses a manual focal point with a
  protected rectangle; diptych explicitly references two photos. Unsafe hero
  cropping falls back to contain with a reason. No automatic face claim.
- Motion applies only to stills: hold, a bounded push-in, or pan. A pure shared
  evaluator clamps clip-local time, uses declared easing, and checks protection.
  Existing static transforms remain separate and user controlled.
- Film title, scene statement and subtitle are graphic roles. Local font glyphs
  are measured and rasterized once; monitor and renderer consume the same PNG.
  Graphic titles do not change transcript/caption evidence or timing.
  New graphic-title mutations and raster input share `MAX_TITLE_LENGTH` (8,000
  UTF-16 code units). This storage/work bound does not guarantee text fits the
  selected font and frame: measured layout still reports overflow. Existing
  project readers remain permissive so an older longer title can be opened,
  shortened or removed. New title-style edits also resolve role defaults against
  the actual project frame before saving, so tracking cannot exceed an implicit
  font size; this check performs no font I/O. Frame-independent readers preserve
  older styles for corrective edits. If an older style cannot resolve, the
  inspector shows a localized recovery message and display defaults without
  saving changes. **Reset title style** removes only the style through the
  existing undoable command; the authored text remains. Text correction and
  clearing stay available, and Undo can restore the older style safely.
  Layout validation accepts portable
  geometry; saving a new diptych edit additionally requires its effective gap
  (32 pixels by default) to be smaller than the actual project width.
- Added music/narration use explicit overlay tracks. Their add, move, trim,
  speed and deletion do not ripple pictures or extend the film. Gain points,
  fades and manually declared ducking use clip-local timeline seconds.
- All changes use existing validated timeline commands, request deduplication,
  history and project persistence. Locked clips cannot be modified implicitly.
- New effects are metadata/manual recreation in interchange where unsupported.
  A valid OTIO file does not establish Resolve effect fidelity.
- MP4 sidecars record the actual composition, source identities, renderer,
  fonts, timing, encoding and review warnings. They remain private local files.

## Native title timing and inset

`TitleStyle.fadeIn` and `fadeOut` are optional local timeline seconds from 0 to 10. Both default to zero, preserving existing hard-cut titles. The shared
`resolveTitleFadeFrames(style, duration, frameRate)` rounds each request to an
integer frame count. Overlapping requests share the available `frameCount - 1`
intervals proportionally: the incoming share is rounded first and the outgoing
share receives the remainder. This leaves a fully visible peak; a single-frame
title has no fade and remains visible.

`titleOpacityAtTime(style, localTimelineTime, duration, frameRate)` evaluates
linear opacity on the same frame grid. It returns zero outside the clip, starts
an incoming fade at zero on the first frame, and finishes an outgoing fade at
zero on the final live frame. Source trim and speed must be converted to local
timeline time before evaluation. The helpers use a one-nanosecond boundary
tolerance, matching the renderer's title frame range.

`TitleStyle.bottomInset` is an optional fraction of frame height from 0 to 0.45,
defaulting to the existing 0.08. For bottom-positioned titles it locates the
bottom edge of the complete text and optional scrim; 0.15 leaves 15% of the
frame below it. Raised titles still respect the existing top safety margin and
report overflow instead of clipping. Centered and top-positioned titles ignore
this inset. `position: "top"` uses the existing 8% top safety margin, including
the scrim, and can combine with `align: "right"` to avoid a subject below.

## Evidence ledger

| ID  | Observation in reviewed source                          | Change and acceptance proof                                              |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Q01 | Constant contain transform cannot express focal layouts | Shared plan, protected-region tests, real rendered pixel bounds          |
| Q02 | No motion data reaches preview or renderer              | Shared time evaluator, sampled start/middle/end FFmpeg frames            |
| Q03 | Implicit drawtext font and unwrapped text               | Measured local glyphs, explicit lines/font hash, same PNG in both paths  |
| Q04 | No add-audio command; normal edits ripple all tracks    | Overlay commands, history/reopen tests, real mixed waveform measurements |
| Q05 | Export has no complete rendering recipe                 | Private manifest and generated A/B composition diff                      |

## Boundaries

Audio automation uses clip-local timeline seconds. Changing source-in changes
the audio under the same local envelope; it does not slice automation against
original source timestamps. Shortening clips clamps automation at their new end.
Splitting a clip with active fades, gain points or ducking is explicitly rejected:
remove/reconfigure that automation before splitting, then configure each half.
Automatic envelope partitioning is deferred.

Font measurement and rasterization use local `fontkit` and `@resvg/resvg-js`
Node runtime dependencies. Desktop consumes the resulting transparent PNG;
the native font/raster implementation is not added to its browser bundle.
The installed runtime and local CJK fonts must be included when packaging the
service. Missing fonts are a recoverable setup/diagnostic issue, not a reason to
download fonts or call a remote rendering service silently.

Synthetic subjects exercise geometry; they do not prove face detection, speech
recognition, artistic quality or private narrative facts. Complete listening,
projector readability, real Pixel/Insta360 sources, Windows/native behavior and
real Resolve finishing remain workstation checks. Story direction compilation,
semantic source-range selection, grading and automated audio analysis follow
after this rendering/editing slice is verified.
