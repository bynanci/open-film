# Story Connections and Pipeline Flow Design

## Intent

OpenFilm editors need to move from loose story thinking to a reviewable production path without learning two unrelated interaction models. The story graph should feel tactile for an expert while remaining safe for a first-time editor, and the pipeline should make the current gate, evidence, and next action obvious.

The primary person is an editor returning to an active local project. They have just organized media or story beats, need to understand what blocks the next production step, and will next review a rough cut or export. The interface should feel like a quiet editorial operations board: dense enough for repeated use, calm enough to read during creative work, and explicit about every state-changing action.

## Product direction

- **Domain:** story beats, relationships, dependencies, checkpoints, evidence, review gates, handoffs, render artifacts.
- **Color world:** graphite editing surface, slate dividers, warm apricot focus, review amber, ready green, paper-white text.
- **Signature:** a continuous story-flow rail. It appears as typed connections in the graph and as a numbered gate line in the pipeline, so structure and execution share one visual language.
- **Defaults rejected:** duplicate tab and side navigation becomes one stage rail; a dashboard card grid becomes a focused stage ledger; decorative multi-color statuses become neutral structure with restrained semantic color.

## Scope

### Story graph

- Keep `StoryGraph` and `GraphViewState` as the only semantic and layout contracts.
- Upgrade mouse-only movement to pointer input so mouse, pen, and touch share one path.
- Add an explicit connection handle to every graph node in expert mode.
- Dragging a handle shows a live preview and highlights the candidate target. Releasing on a target proposes one typed relationship and persists it through application logic.
- A keyboard-accessible connection mode provides the same operation without dragging. Escape cancels it.
- The selected relationship type defaults from the source and target types but remains reviewable before use.
- `beat → asset / supports` updates the beat's canonical selected assets. `beat → beat / precedes` updates canonical beat order. Other valid links update the graph only.
- Duplicate, self-referencing, missing-node, and cyclic dependency links fail without modifying the graph.
- Moving a node remains layout-only and never changes playback order or a Composition revision.

### Pipeline workbench

- Preserve the five product stages and canonical eight recipe steps.
- Standard mode uses one numbered stage rail and one focused stage ledger. It exposes status, evidence, blockers, and the next action for the selected gate.
- Expert mode adds the left stage index, run inspector, dependency connectors, canonical step list, IDs, and keyboard shortcuts.
- Stage order is fixed by the recipe. Dragging is intentionally limited to story-graph layout because reordering production dependencies would misrepresent execution.
- The layout borrows the scanability of task and issue systems: compact state lozenges, a strong selected row, IDs where useful, and a detail surface next to the list. It does not copy Azure trademarks, icons, or assets.

## Interaction and accessibility

- Node movement starts only from the node body; connection dragging starts only from its dedicated handle.
- Window-scoped pointer tracking and cleanup prevent a stuck drag when the pointer leaves the canvas.
- The connection handle is a named button with visible focus. Enter or Space chooses a source or completes a target.
- A live status region announces the source, relationship, success, cancellation, or validation failure.
- Pipeline stages are buttons with `aria-current="step"`; status is expressed by text and shape as well as color.
- Standard mode retains every required production action. Expert mode increases density and exposes diagnostics rather than changing the underlying operation.
- At narrow widths the stage rail scrolls horizontally and side panes collapse before the focused stage content.

## Safety and persistence

- All semantic connections go through `StoryGraphService`, then existing project save and validation.
- No original media is modified or deleted.
- Layout cache remains project-private and separate from project revision.
- Existing quick actions remain available and use the same application methods.
- Existing pipeline run, review, retry, cancel, stale-result, consent, and artifact contracts remain unchanged.

## Approaches considered

1. **Adopt a third-party node editor.** Fast for connectors but adds a large interaction and security surface, duplicates current layout behavior, and risks contract drift.
2. **Store visual connections only in the browser.** Simple but would create a second story model and lose canonical ordering and asset selection semantics.
3. **Extend the existing graph and pipeline components.** Chosen. It reuses validated contracts, preserves local-first persistence, and allows standard and expert presentations over the same state.

## Acceptance

- Pointer-dragging a node persists layout without changing project content revision.
- Dragging or keyboard-connecting two nodes creates exactly one valid typed relationship.
- Beat-to-asset and beat-to-beat connections update their canonical story fields.
- Invalid and cyclic connections show a localized error and make no saved change.
- Reopen restores graph positions and semantic edges.
- Standard and expert pipeline modes expose the same five stage states and actions; expert mode additionally exposes the canonical steps and diagnostics.
- 1024×768 and 1280×720 layouts remain operable; touch targets, keyboard focus, IME behavior, and reduced motion remain valid.
