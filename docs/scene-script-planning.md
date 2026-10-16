# Scene scripts from classified memories

This development slice connects **Library categories → editable scene script →
duration-checked film**. It builds on the existing Story, composition solver and
editor. The [validation record](validation-scene-script-planning.md) reports
targeted domain/application/browser results, real rendering/reopen, initial
full-suite failures and the corrected UI run. Complete corrected-candidate CI
and review are a separate merge gate in [PR #15](https://github.com/bynanci/open-film/pull/15/checks);
workstation verification remains separate. See [TASKS](../TASKS.md).

The starting point is main `e2e926b23ac0fe3bb8aa1d474592a3aef80e6ae6`, after
PR #13's measurement tooling merged. Real workstation observations remain open
in [issue #7](https://github.com/bynanci/open-film/issues/7). That hardware gate is
independent of the scene-planning feature and its automated tests.

## What the planner knows

The offline planner uses the media the user has selected, saved categories/tags,
capture chronology, media types and existing selection preferences. A category
comes from the asset's **first saved tag**; additional tags remain asset data.
Chronological grouping provides an alternative when the desired story follows
time. An unclassified photo is not evidence of its location, people, relationship
or emotional meaning.

Script starters are editable writing assistance in the film's content language:
English, Traditional Chinese or Japanese. They are based on the supplied
classifications and structure, not image recognition. No model is installed,
no image is sent to a remote service and no LanguageProvider is invoked by this
flow. Interface language and film language remain separate.

## User workflow

1. In Library, select a memory and edit **Categories** in its Inspector. Separate
   categories with commas and choose **Save categories**. Mark favorites, rejected
   media and locked selections as appropriate. The first tag determines category
   grouping, so use it consistently for a set such as a trip or chapter.
2. In Story, choose **Plan script and scenes**. Enter the title and brief, choose
   Categories or Capture date, and select all eligible media or the current
   Library page. Set the target, maximum and Cut/Crossfade rhythm.
3. Choose **Preview scene plan**. Review each scene's title, purpose, narration
   draft, visual direction, assigned media and time budget. Edit the text to
   describe the real memories in your own words. The system does not infer
   unobserved facts about a photo.
4. Compare actual solved duration with the maximum, then each scene's actual
   duration with its budget. Selected-media
   thumbnails help identify the result. Correct infeasible selections or duration
   limits before accepting. Changes to planning settings require a new preview;
   replacing an edited script draft requires explicit confirmation.
5. Choose **Create story and edit** to save a **new Story and composition together**.
   The Story workspace shows the created scene and retains existing films. Open
   Edit when ready to trim, reorder, set photo holds, preview or export through the
   existing flow.
6. Saved scene narration and visual direction travel with the Story. Reopening
   restores those texts; switching the interface language does not rewrite them.

This is a writing-and-editing workflow. Narration text is not synthesized audio,
and visual direction is not an automatically applied camera move. Describing a
slow push-in does not add motion keyframes to the render. The generated cut uses
the actual source clips, holds and supported transitions visible in its preview.

## Scene content and ownership

An optional `StoryBeat.script` contains `narration` and `visualDirection`. The
existing beat title, intent, target and media selections retain their roles.
There is no second timeline, caption track or transcript mutation model.
Projects without a script remain valid; manually written script text is content,
not a localized UI label.

The offline draft provides starting text and ordering choices. Users review and
edit that proposal before creating a film. Generating another draft does not
silently overwrite an existing story or its composition. Accepted text persists
in the project-owned Story alongside its scene and source references.

## Duration and selection contract

Planning is bounded to **2,000 source candidates and 30 scenes**. These are input
limits, not a large-library performance claim. The existing story scope rules and
required/locked-source protections still apply; rejected media are ineligible.
The scene planner selects photos and videos. It reports excluded audio sources;
a locked audio source requires an explicit selection decision rather than silent
omission. This planner does not add a soundtrack or recorded narration. Desktop
can edit or replace audio clips that already exist, but cannot add a new soundtrack
track to this visual-only composition.

The target is a preference and the maximum is a hard composition constraint.
Scene budgets guide the existing solver; the **solver's proposed composition**
determines the previewed film length. A sum of suggested scene budgets alone does
not prove the resulting cut fits. A short usable collection can legitimately
produce a shorter film.

Each generated scene reserves enough time for at least one playable clip before
the remaining budget is distributed by narrative weight. A still or a video of
at least one second reserves one second; a scene containing only shorter known
videos uses its longest playable source as that minimum. If the target cannot
cover those scene minima, the planner reports the required duration rounded up
to the next millisecond and asks the user to increase time or combine categories.
It does not generate empty scenes to make an impossible budget appear valid.

Source bounds, required selections, duplicate prevention and duration conflicts
use the same composition rules as an ordinary Story. If required content cannot
fit, the user must change the relevant selection or limit. Optional crossfades
must remain valid for their actual neighboring clips and resulting timing.
Successful acceptance requires a validated composition within the maximum.

Narration length is a writing consideration, not a measured speech duration.
The planner does not certify that an unrecorded voice-over fits its scene. Record
or import the real narration and review timing before claiming a finished spoken
cut meets the limit.

## Review, staleness and persistence

Preview is separate from acceptance. A signature binds the reviewed draft to its
project ID, film content locale and the current catalog fields for its source
scope: saved source identity, classification, selection, timing and renderability
information. It does not bind unrelated project state or rehash the actual media
file bytes during planning. Acceptance rechecks those catalog inputs; changed
inputs produce `story.planStale` (HTTP 409) and require a fresh preview. Rendering
retains its own actual-source inspection; planning does not replace that check.

The application validates user-edited script and scene input and saves the new
Story and composition in one publication boundary. A failed save must not leave
only half the pair in memory or on disk. Existing films are not an overwrite
target. The accepted composition carries a durable receipt identity for the exact
submitted plan. Retrying that same acceptance, including after reopening, returns
the saved pair instead of creating another film. If the composition has since
been manually edited, that current composition is returned, not overwritten by
the old preview. A changed submission or changed saved Story cannot reuse the
receipt as if it were the original accepted proposal: `story.planConflict`
(HTTP 409) requires a new draft. Later reads failing do not undo an acknowledged
creation.

An unaccepted draft survives workspace-tab changes and blocks project switching
until accepted or explicitly discarded. A failed or stale acceptance keeps the
draft available. During acceptance, existing beat mutation controls wait for the
response, preventing a delayed response from mixing an old beat draft into the
new Story. Only successful acceptance/save acknowledges persistence; an unsaved
proposal is not promised to survive application exit.

## Shared application boundary

The pure planning code lives with Story algorithms and uses portable media/story
models. The application owns catalog scope, signatures, validation, solver preview
and acceptance. Desktop, local HTTP and CLI call that same use case. Vue renders
and edits the proposal; it does not independently choose source eligibility or
calculate a competing duration solution.

The local API exposes two operations:

- `POST /api/story-plans/preview`: accepts `title`, `groupBy` (`category` or
  `chronology`), `targetDuration`, `maxDuration`, optional `brief`, `assetIds` and
  `transition` (`cut` or `crossfade`). Returns `{ plan }` without persisting a film.
- `POST /api/story-plans/accept`: accepts `{ plan }`, validates the editable Story,
  checks its scope/signature and solves again. The submitted composition is not
  trusted as an executable result. Returns the saved `{ story, composition }`.

The plan contains the proposed Story and composition, source IDs/signature,
transition choice and excluded-audio count. Editable scene source references must
stay inside its original bounded scope and respect globally locked sources.
The preferred acceptance payload contains only `plan.story`, `sourceAssetIds`,
`sourceSignature` and `transition`; the informational preview composition need
not be sent back. Full preview JSON remains accepted for CLI file review. The
acceptance and Story-edit HTTP endpoints, and CLI plan-file input, allow at most **16 MiB**; ordinary
API bodies retain their existing **1 MiB** limit. This supports the bounded
2,000-clip preview and long CJK scripts without making all API routes unbounded.

For a headless review, save the preview JSON, inspect/edit the Story's scene text,
then accept that file:

```bash
pnpm cli scene-plan preview --project /path/film.openfilm --group-by category --target 270 --max 300 --title "Our memories" --transition crossfade > scene-plan.json
pnpm cli scene-plan accept --project /path/film.openfilm --plan scene-plan.json
```

Use `--brief` to supply the writing prompt and `--assets id1,id2` for an explicit
scope. Preview opens the CLI project with read-only/export intent and does not
write `project.json`; successful acceptance creates the film. Changing bound
catalog inputs or film language can require a fresh preview. Validation
evidence must include the same success, retry and stale/failure behavior through
both API and CLI.

## Targeted verification and remaining gates

The targeted suites establish:

- Category and chronological grouping are deterministic for the same inputs;
  unclassified, multiply tagged and missing-date assets are handled explicitly.
- Scope and scene limits are enforced without silently losing required media.
- Rejected assets stay out; required/locked selections and source bounds remain
  protected; infeasible durations produce an actionable failure.
- Previewed timing comes from the real solver, and accepted composition duration
  respects the chosen maximum with valid cuts/crossfades.
- Editable narration/visual direction survive save/reopen and language switching.
- Source changes invalidate reviewed drafts before acceptance; failed publication
  preserves existing stories and compositions.
- API/CLI and the localized Desktop flow share the same decisions and validation.
- A real 2,000-clip crossfade CLI preview above 1 MiB and a 30-scene HTTP acceptance
  with long CJK script fields succeed within the 16 MiB input bound. Those scripts
  remain editable through Story PATCH and persist after reopening.
- Delayed acceptance disables conflicting old-beat controls, preserves the
  acknowledged new film and retains the intended script after reopening.

The [validation record](validation-scene-script-planning.md) preserves exact
candidate gate outcomes and the initial failures, while current full CI is in the
[PR checks](https://github.com/bynanci/open-film/pull/15/checks). Existing
Story/Precision synchronization, Undo/Redo, locks, recovery and export remain part
of that full regression gate; targeted tests alone do not claim its completion.

Automated generated-fixture success does not certify a compelling screenplay,
real photo understanding, speech timing, Windows startup/memory, Pixel/Insta360
camera quality or DaVinci Resolve import. Those observations need their own
evidence. See [native measurement](native-performance.md) and
[Resolve workstation QA](resolve-workstation-qa.md).

## OpenCut adaptation and next step

OpenCut classic demonstrates named scene navigation, shared commands and common
preview/export semantics. OpenFilm adapts those interaction principles while
keeping Story beats and its existing solver. The current OpenCut rewrite's
"scripting" direction concerns programmatic editor automation, not evidence of a
photo-to-screenplay feature. See the [pinned reference](opencut-reference.md).

After this offline flow is verified, the next bounded improvement is optional,
reviewable LanguageProvider assistance for the **declared category and scene
text**. It should preserve user text, validate structured proposals, bind them to
the reviewed source revision and require the existing consent boundary for a
remote destination. Image interpretation, narration synthesis and photo motion
need separate explicit capabilities and evidence.
