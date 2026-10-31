# Making a film in OpenFilm

Follow five steps: **Add media → Organize → Story → Edit → Export**. You will finish with an OpenFilm project you can reopen and a playable MP4, or an export for further work in another editor.

The basic workflow runs locally and needs no cloud account or AI. Optional remote providers require configuration and your consent before data is sent. First-time users should complete [setup and startup](getting-started.md). This page describes current `main`; check the [release notes](https://github.com/bynanci/open-film/releases) for features in a published version.

## Before you begin: create a project

Welcome offers **Create Film**, **Open Project** and recent films. Recent entries
report whether their saved location is currently available; opening a missing
entry does not erase it. Language and Settings are available before opening a film.

Create Film asks for a name, story type, film language and target/maximum length.
The Proposal Film template supplies its 4:30 target and 5:00 maximum. These are
template defaults, not a Core limit. Storage is under Advanced; the local service
uses a unique project folder inside the configured default location. Settings can
choose a different default location for future films.

The interface language and film language are independent. Changing the interface
updates buttons and guidance immediately. Changing the film language updates
known default template text, while custom titles and intents remain unchanged.

## 1. Add media

**Add Media** accepts folders or selected files. Native desktop uses local pickers
and file paths. Browser-selected files and drops are copied into the project on
the local service; they are not uploaded to a cloud. Original files remain intact.
The compact Activity area reports progress, completion and files needing attention,
and offers cancellation for active import and render jobs.

**Expected result:** Library contains thumbnails and import results. Resolve failed or unsupported sources reported in Activity before continuing. See [camera source support](source-support.md) for format requirements.

## 2. Organize media

The Library provides All, Moments, Similar, Favorites, Rejected and Missing views.
Choose a thumbnail to inspect it. Mark favorites, reject unwanted shots or lock
important memories. Organize groups related moments and repeated shots. Device,
capture-time evidence, GPS, codec, color and full source paths stay in the inspector
or technical details rather than the contact sheet.

The progress row—Add Media, Organize, Story, Edit, Export—shows useful next steps
and attention states. It is not a locked wizard: navigation stays available, with
empty-state guidance when a later step needs a story or composition first.

**Expected result:** You have identified the moments to keep, rejected unwanted sources and know which sources still need attention.

## 3. Build the story

Create a story from the film's chosen template and duration defaults. The Story
board lists beats with titles, timing and selected-memory counts. Choose a beat
to refine its title, intent and target; selected memories are shown separately
from suggestions. Choosing a memory makes it required for that beat.

Refreshing suggestions re-ranks the beat's existing candidate scope using current
preferences. It does not replace selected memories or change other beats. Creating
the cut takes the story into **Edit**.

**Expected result:** Story beats, important media and duration intentions have become an editable cut. For more detailed scene design, read [story templates](creative-story-templates.md) and [scene-script planning](scene-script-planning.md).

## 4. Edit and preview

Clips remain grouped by story beat. Select a photo to change its hold and framing;
select a video to trim, adjust speed/volume or change its framing. Photos and video
clips support Cut, Crossfade, Dip to Black and Dip to White. Audio offers its
supported trim and volume controls. Use drag or Earlier/Later to reorder. Locks
protect important clips from replacement, deletion and regeneration.

The duration display keeps actual, target and maximum visible. **Fit to target**
offers explainable changes measured from the current film. Preview inspects a
proposed change without saving it; Apply commits it; Skip excludes that clip from
the refreshed plan. The Apply-all total comes from its sequential plan, not the
sum of independent alternatives. If protected material prevents the target, the
interface explains that instead of silently removing it.

Edits autosave after a short pause. Saved, Saving and Save failed describe the
actual state. Undo and Redo remain available during the editing session. A conflict
retains the draft and offers review/reapply or an explicit discard; a language
change does not reset the editor. Preview renders the current film; later edits
mark that preview stale until rendered again.

In the standard Story view, Space plays/pauses, Left/Right selects adjacent clips,
and Delete removes an eligible selected clip. Ctrl/Cmd+Z undoes and
Ctrl/Cmd+Shift+Z redoes.

Expert mode offers Tabbed monitor and Dual monitor layouts. Select the Source or
Record monitor first; Space controls playback and Left/Right steps through frames
in the active monitor. Outside Transcript view, press `?` to open the shortcut
reference. Inputs and dialogs retain normal typing and keyboard behavior.
Earlier/Later provide an accessible reorder alternative to drag.

**Expected result:** Changes are saved and you have watched a current preview. Add [captions](composition-captions.md), check [audio quality](audio-quality.md) or use [precision editing](precision-editing.md) as needed. Use [named versions](named-versions.md) to keep a comparable checkpoint across editing sessions.

## 5. Export and check

Export begins with goals: **Watch / Share** creates an MP4; **Continue editing**
offers the existing NLE destinations. Advanced exposes the existing interchange
formats. MP4 export renders the current saved film and provides its local output
and browser download. It never copies an out-of-date preview as a finished film.

When continuing in another editor, keep the export report and prepare the referenced media. Standard interchange preserves supported cut structure; advanced effects may survive only as metadata and need recreation in the destination. A rendered handoff has its own editability limits. Read [NLE handoff](nle-handoff.md) and the [compatibility matrix](nle-compatibility.md). Actual Resolve import still requires workstation verification.

**Expected result:** You have an output file, its location and a compatibility report. Play the MP4 and check the opening, ending, captions, sound and representative transitions. Close and reopen the project to check that saved edits and sources are available. See [export quality](export-quality.md) to adjust compression.

## When a drive disappears

Offline media keeps its thumbnail, story placement and edits. Choose **Find File**
for one memory or **Find Folder** for a moved collection. Review uncertain matches;
filename alone never confirms identity. Reconnecting sources preserves the cut.
Browser-managed copies move with the project; externally referenced media may need
relinking. Physical removable-drive behavior still requires platform QA.

See [media portability and relinking](media-portability.md) for the complete recovery workflow. To deliver a project with referenced sources or move to another computer, use [Collect Media](collect-media.md) and back up external originals separately.

## Known limits

- The local service is designed for one user's workstation, not multi-user collaboration or direct internet exposure.
- Preview of raw 360 media, DNG, HDR and some codecs depends on the source and installed tools. Follow the specific conditions in [source support](source-support.md).
- You can save an over-limit cut, but it must fit the maximum before rendering. Source duration and protection settings also constrain automatic composition.
- Transcription, local models and supported [speech generation](provider-generation.md) are optional. Basic editing remains available without them; remote services may charge separately.
- Automated checks do not replace playback, listening and external-editor verification on your actual computer.

## Next steps and reporting problems

See the [desktop guide](https://github.com/bynanci/open-film/blob/main/apps/desktop/README.md) for other ways to work. Follow [Support](https://github.com/bynanci/open-film/blob/main/SUPPORT.md) when reporting a problem, including your version, platform and reproduction steps. Omit private media, full source paths and credentials. For documentation fixes, translations and code contributions, read [Contributing](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.md).
