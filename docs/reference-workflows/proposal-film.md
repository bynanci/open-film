# Make a proposal reference film

This walkthrough uses generated CC0 media to exercise a complete local workflow:
import, choose essential memories, compose a story, edit the cut, reconnect moved
files, and prepare a timeline for another editor. It uses no private footage or
paid service. Camera names in the fixtures are simulated metadata; they do not
identify the devices that created the pixels.

## 1. Generate the media and open a project

From the repository root, with the documented Node/pnpm requirements, FFmpeg,
FFprobe, and Perl available:

```sh
pnpm install --frozen-lockfile
node fixtures/proposal-film/generate.mjs /tmp/openfilm-proposal-reference
pnpm dev
```

Open `http://127.0.0.1:1420`. Choose **New project**, enter a film title such as
“Our next chapter”, and set **Project folder** to
`/tmp/openfilm-proposal.openfilm`. Choose **Create project**.

In **Library**, choose **Add media**, enter
`/tmp/openfilm-proposal-reference/media` as **Media folder**, then **Import folder**.
Wait for **Import complete**. This ordinary library contains ten assets: landscape
and portrait photos, a similar photo and an exact copy, a metadata-free PNG,
simulated Pixel and Insta360 flat exports, and a short generated audio bed.

The generator also writes `manifest.json`, recording hashes, byte counts, expected
metadata, provenance, and the CC0 license. See the
[fixture instructions](../../fixtures/proposal-film/README.md) for its optional
`raw/` directory and programmatic generator. Keep the media outside the project;
OpenFilm references these originals and keeps its own previews in the project.

## 2. Inspect and choose the memories

Choose **Find moments & duplicates**. Explore **Moments** and **Similar media**,
then return to **All media**. Analysis groups available capture-time and similarity
evidence; a missing capture time is not proof of when a photo was taken.

- Inspect `01-opening-landscape.jpg`. Mark **Favorite**, set a star rating, and
  optionally choose **Always include** to make it essential to the film.
- In **Similar media**, inspect the exact-copy group. Use the Library card's
  reject control on `03-exact-copy.jpg`, or **Leave out** in its details. Keep
  `02-opening-similar.jpg` available for comparing another opening.
- Inspect `06-pixel-portrait.jpg` and `07-pixel-motion.mp4`. **Source format and
  preview** shows the recorded device, camera metadata, and timezone. Expand
  **Technical details and evidence** for orientation, GPS, color, and detection
  evidence when present. The Motion Photo badge is explicitly experimental.
- Inspect `08-insta360-export.jpg` and `09-insta360-export.mp4`. They are
  **Exported flat media**. Recorded original-source associations do not establish
  stitching or optical correctness.

Use these controls for different purposes:

| Control                               | What it preserves                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Favorite** / star rating in Library | A preference used when choosing media; it is not a must-include instruction.                                                                                                          |
| **Always include** in Library         | Requires this asset in the film. Protects it from automatic shortening/regeneration and manual deletion/replacement; manual trims and effects remain editable.                        |
| Selected thumbnails in a story beat   | **Must include** for that beat, in selection order, after **Save beat**. Automatic fit/regeneration protects them. A deliberate timeline deletion/replacement can update that choice. |
| **Lock clip** in Timeline             | Protects that particular clip's source edits, duration, effects, order, and identity. Other edits can still move its start through normal timeline ripple.                            |

Keep a few moments essential and leave others optional. Selecting or locking every
clip leaves no useful freedom for automatic shortening. Restore rejected media
before making it required.

## 3. Plan the proposal story

Go to **Stories** and choose **Create your first story** (or **New story**).
Enter a **Story title**, choose **Starting structure → Proposal Film**, and use
**Media to consider → All media in this project**. Confirm **Target (seconds)** is
`270` and **Maximum (seconds)** is `300`, then choose **Plan story**. Selecting the
proposal structure sets these defaults when the duration fields have not been
manually edited; existing custom values are retained.

The template creates this nine-beat arc. Its target budgets sum to 4:30; the story
maximum is 5:00.

| Beat             | Target budget |
| ---------------- | ------------: |
| Cold Open        |        10.8 s |
| Beginning        |        29.7 s |
| Ordinary Days    |        40.5 s |
| Adventures       |        49.5 s |
| Growing Together |          45 s |
| Why You          |          45 s |
| Future           |        31.5 s |
| Build-up         |        13.5 s |
| Ending           |         4.5 s |

Open a beat, edit **Beat title** or **What should this moment say?**, and select an
essential candidate thumbnail if appropriate. The helper under **Choose the memories**
explains **Must include**. Choose **Save beat** before moving to another beat or
composing. Leaving candidates unselected keeps them optional; it does not request
an empty beat. Candidate groups follow the template's chronological distribution,
so review the actual media rather than assuming their content matches a beat name.

Choose **Compose film**. This small generated library produces a much shorter
cut than 4:30; it does not contain enough material to reach that target naturally.
The target guides pacing rather than padding the film to an exact duration.

## 4. Shape the cut in Timeline

Select a clip thumbnail to open its inspector. Try these edits on optional,
unlocked clips so essential moments remain protected:

1. For a photo, choose a **Photo duration** preset such as **2s** or enter a custom
   duration. For either three-second video, set **Source in** and **Source out**
   within the displayed source duration. Compare **Source**, **Selected**, and
   **Timeline** durations; changing **Playback speed** changes timeline length.
2. Try a speed preset, **Mute clip** or **Clip volume**, **Cut** or **Crossfade**,
   and the scale, rotation, and position fields. The selected source monitor is
   for inspection; render the film to judge the complete edit.
3. When a beat contains two or more clips on the same track, use **Earlier** /
   **Later** or drag a clip onto another to reorder them. With this small fixture,
   single-clip beats leave the movement controls disabled. Use **Replace clip** or
   **Delete clip** only
   on a moment you mean to change. **Undo** and **Redo** also cover saved edits.
4. Select an important edited clip and choose **Lock clip**. Its **Locked** badge
   remains visible, and its editing controls are disabled until **Unlock clip**.

Select a beat header and its **Story beat** inspector. Rename it, change its
intent or target/minimum/maximum, then try **Regenerate beat**, **Make shorter**,
**More video**, **More photos**, **Replace similar shots**, or **Remove repetition**.
These actions affect that beat and preserve protected moments. Inspect neighboring
beats to confirm their edits survived; normal ripple can change their start times.

To exercise duration feedback with this deliberately small fixture, give one
optional, unlocked photo a custom duration of `310` seconds. A manual cut over the
maximum can be saved, but rendering will be rejected until it is shorter. Open
**Fit to target**, read the action, reason, and seconds saved, and apply one
suggestion or **Apply all suggestions**. Required and locked clips are protected.
If no suggestion is possible, undo the exercise or shorten an eligible photo
manually; do not remove protection from a moment merely to silence the warning.
For a quick reference preview, return the long photo to a short preset after
observing Fit's behavior.

Wait for **Saved**. A **Save failed** or **Save conflict** retains the draft;
**Retry save**, **Apply draft to latest**, and the draft download/recovery actions
are available in the editor. Navigation, undo/redo, rendering, and export flush
pending edits. Keyboard shortcuts are Space to play, arrows to select, Delete to
remove, Cmd/Ctrl Z to undo, and Cmd/Ctrl Shift Z to redo. Text fields keep normal
text-editing shortcuts.

## 5. Preview, reopen, and reconnect

Once duration is within the maximum and required source files are available,
choose **Render preview**. Watch the film and listen to the audio. Later edits mark
that preview out of date; choose **Render again** before reviewing them.

Wait for **Saved**, choose **Switch project**, then **Open project**, enter
`/tmp/openfilm-proposal.openfilm` as **Existing .openfilm folder**, and open it.
Return to **Timeline** and check the beat names, trims, effects, order, and locks.
The saved cut persists; a previously rendered preview may need to be rendered
again after reopening.

For the portability exercise, finish or cancel active jobs, then move the generated
media folder and project folder to new locations. Reopen the moved `.openfilm`
folder. Cached thumbnails, ratings, and edits remain available while disconnected
originals show **Missing Media** or **Library offline**. Use **Check again** after
reconnecting at the same path, or **Relink Media** for a new location:

1. Use **Search a folder** and its **Search folder path**, or inspect a single item,
   choose **Relink selected media**, then **Choose one file** and **Replacement
   file path**.
2. Choose **Find matches** and inspect the evidence. A unique exact content match
   can be selected automatically. Choose ambiguous copies explicitly; confirm
   weaker matches only when the chosen file is the intended original. A known
   hash mismatch cannot be overridden.
3. Apply the reviewed matches, then **Close relink media**. Check the availability
   status and return to Timeline to play the reconnected source. Ratings, IDs,
   trims, effects, and locks should remain intact.

See [Moving and reconnecting media](../media-portability.md) for matching rules,
legacy projects, and mount-path limitations. The generated manifest's hashes can
be checked against the moved originals; editing and relinking must not change
their bytes.

## 6. Prepare the edit for Resolve

Go to **Export** and choose **OpenTimelineIO**. The displayed output path points to
`exports/timeline.otio` in the project. Keep the original media accessible; the
export references it. Read the persistent **Export compatibility report** and keep
the accompanying `timeline.otio.report.json` alongside the timeline. Export
**OpenFilm timeline** as well when you want a full JSON copy of the OpenFilm cut.

Cuts, trims, stills, audio, and tracks have independent OpenTimelineIO parser
validation. That validation does not certify a real DaVinci Resolve import.
Speed, volume, transforms, and crossfades are retained in OpenFilm metadata and
need manual recreation in Resolve; do not assume native effect preservation.

Follow [NLE compatibility and manual verification](../nle-compatibility.md) for
version-specific import checks. In an actual Resolve installation, verify source
paths, clip order, source in/out, still durations, track placement, and overall
length; recreate and inspect the advanced edits. Compare playback with the
OpenFilm preview before sharing. Record the Resolve version and results rather
than marking an unperformed import as verified.

## Optional camera-format checks

Import the generated `raw/` directory separately to inspect explicit limitations.
The `.insv` and `.insp` samples must show **360 source / Requires reframed export**,
with metadata still browseable; use a flat JPG/MP4 export for the film. The DNG
fixture exercises metadata-only fallback, not real-camera demosaicing. Motion
Photo fixtures exercise experimental detection and evidence, not production motion
extraction. Real camera DNG decoding, HDR display appearance, physical removable
drives, native pickers, and actual 360 stitching/reframing remain manual checks.
Generated source tags and successful browser playback do not establish those
hardware capabilities.
