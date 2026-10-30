# Photo-film quality slice

This slice implements the supplied 2026-10-17 review's first visible outcome:
an editable, recoverable twenty-second A/B film made from generated public
fixtures. Its base is `f9ad717d8c70db61fb4f9863a350e807f15643c0` (PR #17),
whose complete Verify runs passed. At that development stage, main was
`c1b198f3a8a413a5500453f34127c1b6a5850be9`, before that dependency merged.

## Contract

- Optional version-1 clip layout, motion, title style and audio automation keep
  old schema-1.0.0 projects readable. No database migration is needed.
- Contain preserves source proportions; hero uses a manual focal point with a
  protected rectangle; diptych explicitly references two photos. Unsafe hero
  cropping falls back to contain with a reason. No automatic face claim.
- Motion applies only to stills: hold, a bounded push-in, pull-out, or pan. A pure shared
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

## Photo pull-out

In the Edit clip inspector, select a photo and choose **Pull out** in the photo
motion controls. The preset starts at 1.06× and ends at 1× with the existing
ease-in-out interpolation. It runs over the photo's current timeline duration;
changing that duration changes the motion speed rather than the authored
endpoints. It is an editorial camera movement over a still image, not inferred
depth or an AI-generated moving scene.

Motion can be added when the photo's layout is **Original**. The motion-only
presentation command leaves an absent `layout` property absent, preserving the
existing default contain behavior without saving a different layout selection.
Contain, hero and diptych layouts retain their saved geometry; static scale,
rotation and position remain separate. Existing protected-region checks can
hold an unsafe motion instead of cropping a protected subject.

The portable `PhotoMotion` recipe remains version 1 and adds the `pull-out`
preset. Preview and renderer use the same bounded endpoint evaluator. The
command does not change source references, native title styling, source ranges,
film duration or soundtrack envelopes. Clip, source and paired-photo locks
remain enforced. Undo/Redo and reopening restore the recipe, and protected clips
retain it when a beat is regenerated. No analysis provider or network service
is required.

An older project without this preset still opens normally. An older OpenFilm
binary may reject a project using the new preset; this change does not promise
forward compatibility with old readers. Native motion fidelity in editable NLE
handoff still requires manual recreation where unsupported.

The focused application/solver run passed **2 files / 101 tests** on 2026-10-18:

```sh
pnpm exec vitest run packages/application/tests/quality-editor.test.ts packages/solver/tests/editing.test.ts
```

The new pull-out cases cover motion-only Original layout, explicit contain/hero/
diptych layout preservation, exact retry, Undo/Redo, reopening, soundtrack and
title isolation, duration changes, clip/source/paired locks, unsupported video/
audio targets and locked beat regeneration. They initially failed because the
old validator rejected `pull-out`; they pass after the portable preset addition.
These checks must be combined with decoded render frames and localized browser
interaction coverage before the UI feature is marked complete. Source catalogs
remaining unchanged do not by themselves prove original file bytes are intact;
the render regressions separately verify generated source identities.

## Photo finishing (D5A candidate)

The existing photo Inspector adds **Set focus**, **Movement pace** and **Soft
photo background**. Set focus previews a single-photo hero crop without saving;
click/drag or use arrows (`0.01`, or `0.1` with Shift), then release to accept
one transaction. Escape, blur, resize or a changed source/selection/project
cancel it. Its captured revision is checked after any awaited save flush and by
the server. Diptych retains its contain behavior and existing numeric fields.

Version-1 and absent recipes keep their exact defaults. Ambient layout v2 has a
nested v1 fill: Gaussian sigma `0..0.05` of the shorter frame edge, default
`0.02`, and dimming `0..0.85`, default `0.45`. Motion v2 has a nested v1 Bézier
curve: four finite `0..1` coordinates ordered on both axes, fixed endpoints and
24 bisection steps. Unknown fields/versions fail closed; old binaries may reject
new v2 projects. Project schema remains `1.0.0`; no SQLite migration is needed.

Both Monitor and FFmpeg consume the same verified raw ambient preparation and
source copies. The raw intermediate has no primary correction or Film Look;
foreground/background enter one photographic color group before existing
motion/static transforms and later titles/captions/graphics. Black diptych
separators sit outside that color group. Original-look comparison reuses the
raw background. D5A leaves primary correction to its independent D5C owner.

The local photo-fill PNG endpoint accepts saved project/revision identity only.
One worker, four queued keys, 32 waiters per key, explicit byte/pixel bounds and
abort/close fences bound preparation. Failure is visible with Retry and prevents
successful Monitor readiness. No source file is overwritten. Locks, required
selection, history, autosave, reopen and Named Versions keep their existing
owner; explicit source replacement still clears layout/motion, with Undo
restoring the snapshot.

JSON/OTIO preserve full recipes; OTIO effects require manual recreation.
FCPXML/EDL reject unsupported effects, and fidelity handoff bakes via the same
renderer. Sidecars record actual v2 use and raw-fill/source hashes. See the design
in `docs/superpowers/specs/2026-10-30-d5a-photo-finishing-design.md` and the
[candidate evidence](validation-photo-film-quality.md#d5a-photo-finishing-candidate)
for bounds, measured output and remaining gates.

## Evidence ledger

| ID  | Observation in reviewed source                          | Change and acceptance proof                                              |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Q01 | Constant contain transform cannot express focal layouts | Shared plan, protected-region tests, real rendered pixel bounds          |
| Q02 | No motion data reaches preview or renderer              | Shared time evaluator, sampled start/middle/end FFmpeg frames            |
| Q03 | Implicit drawtext font and unwrapped text               | Measured local glyphs, explicit lines/font hash, same PNG in both paths  |
| Q04 | No add-audio command; normal edits ripple all tracks    | Overlay commands, history/reopen tests, real mixed waveform measurements |
| Q05 | Export has no complete rendering recipe                 | Private manifest and generated A/B composition diff                      |

## Boundaries

Native on-screen graphic text now has optional clip-local fade-out and a
frame-relative bottom safe distance. Defaults preserve the previous appearance:
zero-second fade and an 8% bottom boundary. The style survives existing command
history, replacement and reopen; duration changes preserve authored values and
clamp only the evaluated fade. See [the native text controls contract](native-text-controls.md)
for timing, measured layout, locks and the separate SRT/WebVTT export boundary.

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
