# PhotoDepth v1 — selective 2.5D photo motion

M8A adds a bounded foreground/background camera effect to the existing
GraphicScene contract. A `PhotoDepthRecipe` is an optional version-1 property
of one scene and names one root `Image` node. The image node's Composition-local
`start`/`end` remains the only clock. There is no second timeline, generated
project code, remote asset, or provider call.

## Recipe and source contract

The recipe stores stable IDs, a 3–6 second duration, source catalog ID and
SHA-256, mode, and either:

- `parallax`: a local PNG alpha mask ID/hash, an original-photo or local
  background-fill identity, normalized protected region, foreground/background
  depth factors, bounded camera endpoints, amplitude, and easing; or
- `fallback`: the source identity and a typed reason. The ordinary Image node
  continues to render with its existing still/pan behavior.

The photo, mask and optional background must be imported to the local Library.
Replace-source changes keep the Image node and its existing timing; the old
depth recipe becomes an explicit `mask-unreliable` fallback bound to the new
source hash. The user can then choose a matching mask and recreate parallax.
Project schema 1.0.0 remains backward compatible because this field is
optional. The JSON Schema describes the versioned extension; application
validation additionally enforces cross-field and timing relationships.

The mask must be a local PNG with the original photo's encoded width and height,
both transparent and opaque alpha pixels, and a foreground bounds box contained
by the protected region. No EXIF autorotation is applied while comparing source
and mask pixels; prepare the mask in the same pixel orientation as the imported
source. Each dependency is hash-checked from bounded admitted bytes. Original
media is read-only. A separate clean background fill is preferred for a clean
parallax edge. Choosing the original photo as the background keeps its full
pixels behind the foreground mask and can leave a faint duplicate subject; the
Monitor and manual review are required to judge that choice.

## Deterministic motion and safety

`evaluatePhotoDepthAtTime(scene, compositionSeconds)` is pure and history
independent. Camera interpolation uses the scene's existing easing vocabulary.
Foreground and background receive separate bounded transforms from depth
factors and amplitude. Rotation and GraphicScene enter/exit animation cannot be
combined with parallax in v1. Rendering admits the protected box at every output
frame and checks that the background transform covers it. Monitor PNG and
FFmpeg Output use the same prepared textures and frame evaluator.

The renderer rejects missing/changed assets, malformed or empty masks, mask
dimension mismatch, masks that escape the protected region, and motion that
would crop the protected subject. Visual QA reports large enclosed transparent
mask regions as a warning and all valid parallax recipes as manual review. It
does not claim to detect face, hand, pose, identity or contact changes. When two
people overlap, use one combined foreground mask/protected region. If an edge,
hole or clean plate is unreliable, remove the recipe or select a documented
fallback instead of trusting the split.

All saved edits use `graphic.scene.upsert` and existing revision fencing,
required selection, lock, Undo/Redo, autosave and reopen. Asset bytes and
derived renderer textures remain in their existing local source/cache
boundaries; no image bytes or personal paths enter the recipe. Scene and source
locks remain authoritative. Cancellable preview work belongs to the current
project/revision and is discarded when stale.

## Desktop workflow

Select a root Image layer in Edit → Graphics. Import the photo, mask and optional
background through the existing local media import panel. Set the existing
image layer to 3–6 seconds, choose the mask/fill, set the protected region and
motion, then inspect start/middle/end in the shared Monitor. Preview source
layers and their mask/fill thumbnails as needed. Save, Undo/Redo and reopen
through the existing editor controls. The Inspector offers a typed fallback and
recipe removal. Values outside the schema bounds are rejected by the same
solver command used by Desktop/API editing.

See [GraphicScene v1](graphic-scenes.md), the [threat model](security/graphic-scene-threat-model.md#photodepth-v1),
and the [validation record](validation-photo-depth.md).
