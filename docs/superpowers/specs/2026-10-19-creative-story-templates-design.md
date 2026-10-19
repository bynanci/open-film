# Creative Story Templates design

## Goal

Add three editable story templates to Edit while continuing to render through
the existing version 1 `GraphicScene` contract. Conversation Card, Route Story,
and Photo Relationship each produce ordinary Image/Text/Shape/Group nodes with
stable IDs, Composition-time scene bounds, scene-local node timing, and explicit
animation endpoints. Template records retain only provenance and node bindings;
the GraphicScene remains the only visual timing and rendering model.

## Composition data

Add an optional, bounded `graphicSceneTemplates` collection to Composition. Each
version 1 record identifies one existing `sceneId`, a fixed template ID, and
small template-specific data. It never owns independent duration or ordering.
Strict validation rejects unknown fields, orphaned scene IDs, duplicate scene
bindings, excessive records/text/route points, missing image references, and
invalid source citations. Legacy compositions without records remain valid.
Creation and edits travel through the existing `graphic.scene.upsert` command so
scene and provenance changes share receipts, autosave, Undo/Redo, and reopen.
Removing a scene removes its bound record in the same command.

Conversation data keeps exact original text, user-entered source citation, and
the displayed message node IDs. A quoted message must equal the original; an
excerpt stores exact character offsets and the rendered card visibly labels it
as an excerpt. If the author changes the display text, the card marks it as an
adaptation while retaining the original and source.

Route Story accepts bounded manually entered points or an explicitly selected
GPX file. The importer rejects DTD/entity declarations, invalid coordinates,
empty routes, oversized files, and excessive points. It hashes the exact file
bytes, stores a bounded simplified point list and optional named waypoints, and
ignores timestamps, distances, elevation claims, and race results. The rendered
route is a progressively revealed line of ordinary GraphicScene shapes.

Photo Relationship supports one-image focus reveal, two-image comparison, and
two-image bookends. Each image role retains its asset ID and authored focal and
protected regions. Layouts use the existing `resolvePhotoPlan` crop math; the
scene image bounds animate between those resolved placements. No asset is
rewritten and no relationship is inferred from EXIF or image contents.

## Desktop flow

Add a localized Template Gallery and Inspector inside Edit. Gallery cards open
the matching form. The Inspector configures message count/order/speaker/text and
timing, route points or GPX import and waypoint labels, or photo role/assets and
focus regions. Shared scene timing and animation controls remain visible in the
existing Graphics Inspector, which edits the generated nodes. All template
changes use the existing command queue and disabled states for pending history,
conflicts, and failed saves. UI copy uses the existing English, Traditional
Chinese, and Japanese catalogs and keyboard-accessible labels.

## Validation and evidence

Use fictional chat, a synthetic GPX route, and generated test images only.
Unit tests cover strict metadata and GPX admission, exact citations/excerpts,
route point bounds and honesty, photo focus protection, stable IDs, and
arbitrary-seek determinism. Application tests cover atomic persistence,
locked-source preservation, Undo/Redo, reopen, and source hashes. Browser tests
cover Gallery creation, editing, keyboard access, and saved-state behavior. An
FFmpeg integration test produces a 24-second MP4 containing all three templates,
then checks decoded frames from each section, output duration/frame count,
template content/positions, and source hashes. CI retains only this synthetic
artifact. Real private media, physical displays, hardware/4K, and downstream
NLE finishing remain manual gates.

## Security and compatibility

GPX is treated as bounded untrusted data: no external fetch, entity expansion,
HTML, JavaScript, path access, or process execution. Only existing local image
assets can feed Image nodes. The GraphicScene schema and renderer remain
version 1; the new optional metadata is strict JSON and is not evaluated by the
renderer. No project schema migration, new timeline, dependency, or source-media
mutation is required.
