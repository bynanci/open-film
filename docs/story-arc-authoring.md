# Story arc authoring

OpenFilm's Story workspace now treats templates as starting points. The saved
Story and StoryBeat remain canonical; no new project schema, graph, timeline,
pipeline, or renderer was introduced.

## Starting structures

Blank and Proposal Film remain available. Additional local prompts provide:

- **Journey:** set out, along the way, arrive.
- **Event recap:** preparation, gathering, defining moment, afterglow.
- **Then and now:** an earlier reference, what changed, the present.
- **Portrait:** context, details, reflection.
- **A day in life:** a beginning, everyday rhythm, a change of pace, day's end.
- **Letter:** opening note, what to say, a chosen memory, an open close.
- **Memory collection:** moments, what connects them, what remains.
- **Custom outline:** one authored beat title per line.

Template intents are editable prompts, not statements inferred from media.
Their wording is localized to the project's content language. Existing
`intent`, `script.narration`, and `script.visualDirection` remain user-editable
fields on the canonical Story beats.

## Custom outline boundary

The story creation API accepts `customOutline` only with the
`custom-outline` structure. It requires 1–30 non-empty headings, at most 300
Unicode code points each. The supplied order becomes the Story beat order and
the first StoryGraph `precedes` chain. Outline headings are user-authored and
retain `titleSource: user`.

Candidate media are assigned in stable capture-date/ID order and are never
reused across beats. When there are more beats than sources, unassigned beats
remain present with an empty candidate list. This is intentional: a story may
include a plan to find, record, or import a moment later, without manufacturing
media or claiming that it already exists.

## Thinking, pipeline, edit

New stories open in the existing StoryGraph perspective. Its beat nodes
reference canonical StoryBeat IDs; `precedes` edges describe semantic story
order. Panning and node coordinates are view state and do not alter narrative
order. The Story workspace exposes the existing Pipeline Workbench before the
existing Compose/Edit action. This path guides the author without disabling
other project navigation.

Storyboard review uses one vertical reading thread with responsive cards,
keyboard focus, selected-memory previews, timing labels, and the existing
timeline navigation actions. It remains a presentation of the same Story and
Composition.

## Emotional and shot-planning boundary

The supplied implementation prompts reference an
`openfilm-cinema-foundation` package, an emotional-overlay v1 schema, and
shot-level proposal IDs. The v1.0.0 and v1.1.0 archives were supplied on
2026-10-24 and reviewed as [UI design guidance](workspace-ux-refinement.md).
The current `StoryPlan` has scene IDs rather than shot IDs, so runtime
integration still needs a reviewed adapter. This implementation does not infer emotional shifts,
subtext, media intent, sound bridges, camera movement, or source facts. It also
does not persist an improvised overlay in StoryPlan. A follow-up needs an
explicit versioned contract and scene-to-shot adapter before it can safely add
reviewable emotional or shot suggestions.

See [Story Graph](validation-story-graph.md),
[StoryPlan](validation-story-plan.md), [Pipeline Workbench](../TASKS.md#delivered--m10b-pipeline-workbench-uiux),
and [this implementation's validation](validation-story-arc-authoring.md).
