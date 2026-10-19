# Creative Story Templates

Creative Story Templates build editable scenes by composing the existing
version-1 `GraphicScene` primitives. They do not create a second timeline,
renderer, asset store or project schema migration. Scene placement and every
visible duration remain in the saved Composition and its ordinary GraphicScene
nodes.

## Gallery and Inspector

The Edit inspector offers three local templates:

- **Conversation Card** creates one to four speaker/message pairs. Messages can
  be reordered by their saved record order and timed on the scene's local clock.
  Text remains literal and supports line breaks. The card uses centered,
  frame-safe margins; Graphics can edit each node's font, line breaks and
  position. Template controls set layer animation duration and easing.
- **Route Story** accepts explicitly entered latitude/longitude points or bytes
  from a GPX file the user selected. Points appear in sequence as a dotted route
  reveal; named waypoints remain associated with their original coordinates.
  Imported source name and SHA-256 are retained. Timing, elevation, speed,
  distance, race results and event claims are not inferred or imported.
- **Photo Relationship** supports a focal reveal, two-photo comparison and
  opening/closing bookends. Each image node points to a local catalog asset.
  Focal points and optional protected regions are normalized against the source
  photo. Images use a full-frame contain fit, so the first version does not crop
  a protected area out of the output.

Saved templates can be reopened in the inspector to change text, scene timing,
animation, relationship, photo source, focal point and protected region. Font,
line-break and per-layer geometry edits use the existing Graphics inspector.
Template changes emit the existing `graphic.scene.upsert` command with an
optional template record. Composition revision checks, lock state, Undo/Redo,
autosave, retry and reopen continue through the existing editor application.

## Source attribution

Conversation metadata binds stable message IDs to their existing speaker, text
and optional source-label nodes. `quoted` text must equal the entire stored
original; `excerpt` must match the saved UTF-16 range and receives a visible
localized excerpt label; `adapted` retains the original and citation while
identifying changed wording. Removing source metadata is an explicit inspector
action. Source text is bounded and never sent to an AI provider by this feature.

Route metadata binds saved map points to shape nodes. The GPX importer is
read-only, accepts UTF-8 XML up to 4 MiB, rejects DTDs, entities, comments,
processing instructions, malformed XML and more than one track segment/route,
and supports at most 32 display points and eight named waypoints. If more than
32 route points exist, deterministic even sampling preserves the endpoints.
Only the exact imported file hash and display geometry are saved; original file
paths, timestamps, elevation, speed and activity summaries are not persisted.

Photo metadata binds image-node identity, relationship role, catalog asset ID,
optional source hash and focus/layout data. A comparison requires two distinct
assets. The renderer reads the existing local image bytes and validates their
identity; templates never overwrite source media.

## Limits and trust boundary

All metadata is strict JSON with a version field, bounded arrays and literal
text. It is validated against the exact saved scene and node types before a
typed edit is committed. Unknown fields, orphaned node IDs, missing assets,
malformed hashes, unsafe file names and invalid coordinates are rejected.
GPX content is parsed as data only. No network request, project HTML, script,
remote URL, XML entity expansion or third-party template code is executed.

The output renderer continues to consume only the corresponding GraphicScene.
The metadata is editorial provenance and replacement context; it cannot add
render primitives or bypass the existing resource limits.

See [GraphicScene v1](graphic-scenes.md),
[architecture](architecture.md#creative-story-template-records),
[project contracts](CONTRACTS.md#creative-story-template-records) and the
[validation record](validation-creative-story-templates.md).
