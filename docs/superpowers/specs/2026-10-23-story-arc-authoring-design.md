# Story Arc Authoring and Story-to-Pipeline Design

## Intent

Make story entry useful for different kinds of films without forcing every
editor into one template. People can start from a localized writing prompt or
write their own ordered beats, develop the main line in the existing StoryGraph
mind map, review the existing Pipeline Workbench, and then compose into the
existing Edit workspace.

## Current state at the fetched base

The implementation starts from `b39c2c369d584fa0bb4f75734737d4ebd68d928a`.
The repository already contains canonical `Story` / `StoryBeat`, the M9A
StoryGraph and M9B reviewable scene-level `StoryPlan`, and the M10 Pipeline
Workbench. StoryGraph stores semantic `precedes` edges separately from visual
node coordinates. StoryPlan preview/acceptance and Composition own the current
source, edit, and revision boundaries.

The story creation form only offered the generic and Proposal Film structures.
The Storyboard showed a wide card grid, and a newly created Story opened in the
outline perspective rather than foregrounding the mind-map stage. The
initial repository and supplied attachments did not include the referenced
`openfilm-cinema-foundation` package, the emotional-overlay JSON schema/types, or
a shot-level proposal contract with stable `shotId`s.

On 2026-10-24 the user supplied cinema-foundation v1.1.0 and v1.0.0. Their
reference schemas and UI guidance are reviewed in
[workspace UX refinement](../../workspace-ux-refinement.md); the runtime
scene/shot ID adapter remains unimplemented.

## Goals

- Keep the existing blank and Proposal Film structures and add journey, event
  recap, then-and-now, portrait, day-in-life, letter, memory collection, and a
  user-authored outline.
- Localized templates provide editable writing prompts. They do not infer
  events, feelings, or facts from photos, dates, or filenames.
- Preserve custom heading order as canonical `StoryBeat` order and initial
  StoryGraph `precedes` edges. A beat may remain without a candidate asset so
  users can record a planned or missing moment without inventing media.
- After creation, foreground the existing StoryGraph mind map; present an
  explicit path to the existing Pipeline Workbench and then Compose/Edit.
- Present the existing Storyboard in one readable vertical sequence with
  keyboard-accessible selection and existing media/timeline actions.
- Keep source selection and Composition in the existing application contracts;
  no second graph, timeline, pipeline, renderer, or project schema migration.
- Include Shot Grammar and emotional review as the next design layer, with
  explicit evidence/uncertainty separation and no silent acceptance.

## Design calls

- Story arc prompts are implemented as deterministic local templates in
  `packages/story`. They use project locale and explicit candidate metadata;
  inferred feeling and factual claims remain outside this data.
- Custom outline input is one heading per line, in authored order. The boundary
  accepts 1–30 non-empty headings, at most 300 Unicode code points each.
  Candidate assignment is stable and never reuses an asset. Beats beyond the
  available source count remain empty and visible in the outline/graph.
- StoryGraph remains the canonical planning mind map: beat references use the
  canonical Story beats, `precedes` edges express story order, and saved graph
  coordinates remain view state only.
- The workflow path is guidance rather than a hard lock. It does not prevent
  existing workspace navigation, but newly created stories open on StoryGraph
  and expose explicit buttons for Pipeline and Compose/Edit.
- Storyboard cards use a single vertical reading thread with current design
  tokens, restrained separators, responsive width, and visible keyboard focus.
  No Instagram or Apple trade dress/assets are copied.
- Emotional narrative and shot proposals are not persisted in StoryPlan or
  arbitrary Story properties. The provided prompts describe a versioned
  emotional overlay and shot-level IDs. The newly supplied reference contracts
  now cover those types, while the current StoryPlan still only has scene IDs.
  A follow-up must review their runtime adapter before writing such a layer.
  This feature leaves existing intent, narration, and visual-direction fields
  available for user-authored planning.

## Validation

Pure tests cover each localized arc, authored order, stable source distribution,
empty future beats, invalid outline limits, and immutability of inputs. An
application/HTTP regression creates a synthetic-media custom outline, verifies
mind-map order and reload, and rejects mismatched outline requests. Browser
coverage checks custom authoring, initial mind-map state, and opening the
existing Pipeline drawer. Existing StoryPlan acceptance, project schema,
Composition, and full project gates remain required.

## Next milestone: emotional and shot proposal layer

Before implementation, review the supplied versioned schema and define the
mapping for scene IDs versus future shot IDs. Keep event evidence separate from emotional
interpretation; default interpretations to review-required. Drafts must be
read-only and fenced to graph/source/intent revision. Until the runtime adapter is
validated, use only existing user-editable beat intent/script fields and do not
claim shot-level preview, audio bridges, or effect execution.
