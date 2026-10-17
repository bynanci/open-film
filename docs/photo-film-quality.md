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
- Added music/narration use explicit overlay tracks. Their add, move, trim,
  speed and deletion do not ripple pictures or extend the film. Gain points,
  fades and manually declared ducking use clip-local timeline seconds.
- All changes use existing validated timeline commands, request deduplication,
  history and project persistence. Locked clips cannot be modified implicitly.
- New effects are metadata/manual recreation in interchange where unsupported.
  A valid OTIO file does not establish Resolve effect fidelity.
- MP4 sidecars record the actual composition, source identities, renderer,
  fonts, timing, encoding and review warnings. They remain private local files.

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
