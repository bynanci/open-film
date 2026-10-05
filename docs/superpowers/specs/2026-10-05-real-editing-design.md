# Real Editing Workflow

Starting main:259a59c37d2f126ea456bb1f3ba2de1344fbf88c. CI37329665222 passed;
no open PRs/issues at inspection. This extends the existing application,
solver, Vue interface and provider ports. The user's detailed round specification
and explicit autonomous execution instruction authorize implementation without
another design approval stage.

Priority: finish and verify graphical editing first, then relinking, device
adapters, proposal reference workflow, Resolve interchange and regression gates.
No new Core architecture, cloud features, AI, marketplace or GPU compositor.

## Editing decisions

Story beats organize a dark, thumbnail-led editing surface. Clip controls expose
source trims, still duration presets, speed, volume, Cut/Crossfade and transforms.
Reorder within a beat has drag and keyboard/button alternatives. Clip locks
protect identity, source edits and effects from deletion/replacement/automatic
regeneration; timeline offsets follow normal ripple changes. Asset locks and
must-include constraints remain protected during automatic suggestions.

Add only optional `Clip.locked` to the existing extensible1.0 project model.
Old files need no migration; validation/schema/docs cover the additive field.
Pure commands live beside the existing solver. A small application editor service
replays validated command batches, saves atomically, and retains bounded undo/redo
history for the open project session. No event-sourcing subsystem is introduced.
The API requires a content revision for edits; stale clients get a concrete
conflict instead of overwriting work. Debounced client commands update the visible
composition immediately, then show Saving/Saved/Save failed and retry capability.

Manual over-limit cuts remain saveable. Duration feedback shows target/max;
render continues to reject over-limit output. Fit suggestions state an action,
seconds saved and a reason, and are individually applicable. Beat regeneration
changes only that beat's content, retains protected clips, and preserves source
edits and effects elsewhere. Renderer crossfades retain its established incoming
fade semantics without changing source media.

## Next slices

Relinking retains asset IDs, thumbnails, ratings, edits and original provenance;
uses hashes before relative path or filename+size, and requires confirmation for
non-hash matches. References and volume identity use backward-compatible fields
or namespaced metadata with validation and documented persistence.
Pixel/Insta360 logic stays in dedicated adapter packages. Raw360 is recognized
and associated with exports; unsupported stitching/reframing is explicit. HDR
metadata is preserved and unsafe preview paths produce an actionable warning.
Generated reference media covers the complete proposal editing/relink flow.
OTIO is checked through the official parser; actual Resolve import remains a
manual gate unless a real installation is available.
