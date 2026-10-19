# Declarative GraphicScene v1

M3 / F01 extends the existing Composition with optional `graphicScenes`. The
user's October 19 scope replaces the earlier M3/F03 motion-authoring queue item;
general clip keyframes remain future work. Schema-1.0.0 projects without this
field keep their current behavior. No catalog migration or second timeline is
introduced.

## Rendering contract

A scene has version 1, a stable ID/name, a Composition start time, duration and
zIndex, plus an ordered tree of Image, Text, Shape and Group nodes. Node times
are scene-local seconds with a half-open `[start,end)` interval. Coordinates are
Composition pixels relative to the parent center: positive x is right and y is
down. Width/height describe the unanimated local box. Groups scale their entire
local coordinate system around their center; group opacity composites the group,
including overlapping children, rather than independently fading each child.

Siblings and scenes render in ascending zIndex, retaining authored order on ties.
Scenes composite above existing visual/title tracks and below native captions.
Images contain-fit into their local box. Text uses the existing measured local
CJK title rasterizer, centered and wrapped in its box. Shapes are rectangles or
ellipses with a literal six-digit hex fill. All content clips to the output frame.

Optional enter/from and exit/to animations interpolate x, y, width, height and
opacity against explicit static values. Easing is linear, quadratic ease-in,
quadratic ease-out, or quadratic ease-in-out. Durations must fit without overlap
inside the node interval. Endpoints never depend on previous frames, wall time,
randomness, CSS animation or project code. `evaluateGraphicSceneAtTime(scene,t)`
accepts Composition seconds and returns a fresh evaluated tree. Equal inputs
produce equal output in any seek order.

The Node adapter prepares bounded local PNG textures and creates trusted SVG
containing numerical geometry and embedded generated PNGs only. Resvg rasterizes
that SVG with system font discovery disabled. The Monitor requests output-frame
indices and receives PNG bytes from the shared application service; FFmpeg consumes
the same PNG producer at those exact indices. Playback may display fewer samples
when the local renderer is busy; paused/seek frames use the exact requested frame,
and failed/stale frames are visibly withheld. This is a deterministic frame
contract, not a real-time or color-managed workstation performance claim.

## Authoring, persistence and compatibility

`graphic.scene.upsert` and `graphic.scene.remove` are existing TimelineCommand
variants. Upsert validates the complete detached scene tree and referenced catalog
image identities. Existing revision checks, request receipts, history, autosave and
reopen own persistence. Commands never alter source media, clip locks, required
selections, transcript revisions or caption text. Shortening that would exclude a
scene is rejected before enqueueing; users explicitly adjust/remove it first.
Regeneration checks only its completed duration. Undo/Redo retains stable IDs.

Edit adds a Graphics Inspector with scene/node selection, primitive controls,
timing and enter/exit controls. It uses the existing Composition duration and
Monitor. Image admission is limited to cataloged local PNG, JPEG and WebP files,
verified by signatures and actual dimensions; SVG/HTML, animated media, arbitrary
paths, font paths, executable expressions and remote URLs are not scene fields.

JSON preserves the complete data and image references. OTIO preserves it as
metadata with an explicit manual-recreation warning. FCPXML/EDL reject scenes
they cannot represent. No native NLE graphic reconstruction is claimed.

## Resource limits

These v1 limits fail closed with typed errors, before expensive work where
possible: 8 scenes, 64 nodes total, nesting depth 4, 30 seconds per scene,
512 text characters per node and 4,096 total, finite coordinates within ±8,192,
dimensions 1–4,096, node boxes at most 8,294,400 pixels, opacity
0–1 and integer zIndex within ±1,000. Rendering supports at most 8,294,400 output
pixels, 60 fps, 1,800 active scene frames and 2,000,000,000 frame-pixels per render.
Source images are at most 64 MiB each and 32 million decoded pixels. Prepared
textures total at most 33,177,600 pixels and 64 MiB PNG bytes. Generated sequence
PNGs total at most 256 MiB; rendering is cancellable and private temporary work
is removed on success, error and cancellation. Font identities and source hashes
enter the existing private render manifest.

See [threat model](security/graphic-scene-threat-model.md) and
[validation](validation-graphic-scene.md).

## Upstream reference

Reviewed `openfilm/openfilm` SPEC §3 and MANUAL's `frame(t)` guidance on
2026-10-19. The adopted idea is history-independent frame evaluation and readiness
before capture. Its executable HTML/page protocol is outside this implementation.
No upstream implementation, branding or example media is copied. Existing
Apache-2.0 and NOTICE remain unchanged.
