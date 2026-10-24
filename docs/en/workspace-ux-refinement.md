# Story workspace interaction refinement

## Intent and design decisions

Continue the approved desktop story-authoring direction for creators arranging
local photos, video and recordings. A first-time author should understand the
next action; a returning editor should reach it with the keyboard and retain
their draft. The visual language follows the existing film-room surfaces,
semantic accent, local CJK fonts and visual reading thread. The current palette
and responsive spacing are specified in the [design system](design-system.md).

Keep the existing workspace rail and improve task interactions in place.
Replacing navigation again or adding a wizard would hide the author's context
and duplicate the approved flow. Creation uses a focused, dismissible inline
form with a live authored-order preview. Graph, outline and storyboard remain
three views of the same Story. The single Composition remains the edit model.

## Behavior

- Opening story setup focuses its first field; dismissing returns focus and
  retains the draft within the current project session. Project switches clear
  the custom outline. Submission validates finite positive durations and the
  existing 1–30 / 300-code-point outline limits next to the affected field.
- Setup previews only user-authored headings, in their supplied order. It
  does not create a proposal, source claim, new edit or network request.
- Story tabs support Left/Right, Home/End and a linked panel with one tab stop.
  Existing draft-save/review gates run before changing the view. A skip link
  reaches the workspace without traversing the global navigation.
- Storyboard uses actual selected media, explicit source/offline state,
  narrative intent and target/actual timing. No selection and an offline
  selected source are distinct. Media details hydrate from the shared catalog
  cache, independently of the current library page and fenced to the project
  generation. Only one selected beat's preview plays; photos use the original
  source, video/audio use native controls, and close/Escape returns focus.
- Actual beat time is the union of mapped clip intervals across tracks.
  Concurrent sound and picture count once. A different story's active cut
  does not mark this story as mapped.
- An empty library search offers one action to clear the search and filters,
  reload the collection and restore search focus.
- Pipeline stage shortcuts are keyboard buttons; opening and closing the
  workbench manages focus. The dock uses the existing semantic theme tokens.

## Cinema Foundation reference review — 2026-10-24

The user supplied both archives as design guidance. Their internal release
manifests were checked without executing scripts: v1.1.0: 50 entries, v1.0.0:
41 entries, no mismatches. Archive SHA-256 values:

- v1.1.0: `855362d3f5785592ae1bb07a4417a33f332ec0a3b4137af06cec9ad001b478a4`
- v1.0.0: `7c942d4b25a3eb44df59d3f87e7b1dbfab0a8b99c5ca0c7fec0a315b05195fcc`

Relevant guidance: `knowledge/storyboard-planning.md`,
`templates/storyboard-card.md`, `integration/field-mapping.md` and
`integration/PHOTO_VIDEO_EMOTION.md`. v1.1.0 adds an emotional-narrative overlay
while retaining the v1 shot-proposal contract byte-for-byte. Apply its ordering
of image / narrative intent / timing / media feasibility, clear source status,
and distinction between authored intent and evidence. No emotional score,
invented footage, sound, inferred source fact or AI image appears in this UI.

The supplied shot and emotional schemas are now available as references. They
are not the current scene-level StoryPlan contract. Runtime integration still
requires a reviewed shot/scene ID adapter, revision-fenced sidecar storage and
Preview / Review / Accept. This refinement does not implement that layer.
The archives contain no separate license grant for wholesale vendoring; no
archive scripts, executable code, example media, branding or assets are added
to the product. Apache-2.0 and NOTICE remain the repository's licensing basis.

## Validation

See [validation](validation-workspace-ux-refinement.md) for commands, results
and outstanding manual checks.
