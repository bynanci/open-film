# Making a film in OpenFilm

OpenFilm is an open-source, local-first, story-first media composer. The workspace
is organized around making a film, not operating a media toolchain. All work stays
on the local machine.

## Start with a film

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

## Add and organize memories

**Add Media** accepts folders or selected files. Native desktop uses local pickers
and file paths. Browser-selected files and drops are copied into the project on
the local service; they are not uploaded to a cloud. Original files remain intact.
The compact Activity area reports progress, completion and files needing attention,
and offers cancellation for active import and render jobs.

The Library provides All, Moments, Similar, Favorites, Rejected and Missing views.
Choose a thumbnail to inspect it. Mark favorites, reject unwanted shots or lock
important memories. Organize groups related moments and repeated shots. Device,
capture-time evidence, GPS, codec, color and full source paths stay in the inspector
or technical details rather than the contact sheet.

The progress row—Add Media, Organize, Story, Edit, Export—shows useful next steps
and attention states. It is not a locked wizard: navigation stays available, with
empty-state guidance when a later step needs a story or composition first.

## Build the story

Create a story from the film's chosen template and duration defaults. The Story
board lists beats with titles, timing and selected-memory counts. Choose a beat
to refine its title, intent and target; selected memories are shown separately
from suggestions. Choosing a memory makes it required for that beat.

Refreshing suggestions re-ranks the beat's existing candidate scope using current
preferences. It does not replace selected memories or change other beats. Creating
the cut takes the story into **Edit**.

## Edit and preview

Clips remain grouped by story beat. Select a photo to change its hold and framing;
select a video to trim, adjust speed/volume, frame it or set a cut/crossfade. Audio
offers its supported trim and volume controls. Use drag or Earlier/Later to reorder.
Locks protect important clips from replacement, deletion and regeneration.

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

Keyboard shortcuts: Space plays/pauses, arrows select nearby clips, Delete removes
an eligible selected clip, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. Inputs and
dialogs retain normal typing and keyboard behavior. Earlier/Later provide an
accessible reorder alternative to drag.

## Finish or continue editing

Export begins with goals: **Watch / Share** creates an MP4; **Continue editing**
offers the existing NLE destinations. Advanced exposes the existing interchange
formats. MP4 export renders the current saved film and provides its local output
and browser download. It never copies an out-of-date preview as a finished film.

The Resolve card uses the shared compatibility model. Native cut layout and parser
checks are implemented, but real Resolve import is still a manual verification
gate. Speed, volume/mute, transforms, crossfades and titles need manual recreation.
The export report describes the particular file's limitations. See
[the compatibility matrix](nle-compatibility.md) for technical evidence.

## When a drive disappears

Offline media keeps its thumbnail, story placement and edits. Choose **Find File**
for one memory or **Find Folder** for a moved collection. Review uncertain matches;
filename alone never confirms identity. Reconnecting sources preserves the cut.
Browser-managed copies move with the project; externally referenced media may need
relinking. Physical removable-drive behavior still requires platform QA.

For implementation details, see [internationalization](i18n.md),
[the design system](design-system.md), and [the desktop guide](../apps/desktop/README.md).
