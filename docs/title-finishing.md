# Bilingual titles and finishing

Native titles and Caption Track cues can contain two language runs with their
own local font, size, weight, line height and tracking. Edit the two language
rows in the existing Inspector. Sizes, tracking, gap and finishing dimensions
use composition pixels. An empty second-language draft stays local until both
rows are valid; opening a legacy title does not change its text or style.

Title finishing offers a bounded shadow, outline and one rounded background
pill per measured line. Pills replace the block scrim while enabled; disabling
them restores the saved background choice. Finishing and title fade affect the
text graphic alone. The source picture and audio remain unchanged. The shared
measured raster, including both run fonts and every effect, is used by the
Monitor and MP4 renderer.

The Inspector reports each run's actual installed font family and weight.
Unavailable requested families/weights produce explicit fallback evidence;
missing glyphs or an unreadable font prevent a text preview/render. Correct the
font or text rather than assuming a browser fallback matches delivered pixels.
Oversized text or effects fail when the complete painted bounds cannot fit the
safe area. The editor does not silently shrink or clip a language.

In the Caption Inspector, **Preview and MP4 captions** uses the same selection
as Export. Automatic selects the first saved track; **No captions** disables
both preview and burn-in. Selecting a cue for editing does not switch output
languages. Cue intervals remain half-open Composition milliseconds; preview
uses the same output-frame conversion as rendering. Overlapping cues retain
the renderer's start/end ordering. The browser explicitly reports an unavailable
preview above 32 simultaneous caption images or 33,177,600 decoded pixels;
saved cues and MP4 output are retained for rendered review.

SRT/WebVTT retain both literal texts and their original cue times. They do not
carry independent typography, shadow, stroke, pills or title fade. Native NLE
handoff retains full recipes in metadata and requires effect recreation or an
explicit rendered bake. It does not claim editable title parity in Resolve.

## Saved contract

The existing `Clip.title` or `CaptionCue.text` is the canonical string:

```ts
{
  title: "繁體標題\nOur story",
  titleRuns: {
    version: 1,
    splitAt: 4,
    primary: { fontSize: 32, tracking: 1 },
    secondary: { fontSize: 20, tracking: 2, fontWeight: 700 },
    gap: 12
  },
  titleStyle: {
    version: 1,
    role: "film-title",
    finishing: {
      version: 1,
      stroke: { color: "#000000", width: 2 },
      pill: {
        color: "#221133", opacity: 0.8,
        paddingX: 12, paddingY: 6, radius: 8
      }
    }
  }
}
```

Caption cues use `textRuns` instead of `titleRuns`; their shared base style and
finishing remain on `CaptionTrack.style`. Run metadata is separately versioned
and marks the UTF-16 index of the LF between two nonempty valid Unicode slices.
Neither primary text nor timing is duplicated in another model. Each run
inherits base typography independently.

The whole bilingual string is bounded to 8,000 UTF-16 units and 32 measured
lines. Gap is 0–128 pixels. Font size remains positive and at most 4,096 pixels;
weight is an integer from 100–900, line height is 1–4, and tracking is
0–min(100, effective font size). Families are bounded local labels, never paths
or remote fonts. Shadow offsets are −64–64 pixels, blur is 0–16, outline width
is 0–16, and pill padding/radius is 0–64. Opacity is 0–1; colors are literal
six-digit RGB hex. Shadow support is explicitly bounded at three standard
deviations. All paint reserves safe area before wrapping and placement.

Unknown versions/keys, invalid Unicode, unsafe boundaries and non-finite values
reject before saving. Existing projects without the new fields retain their
original pixels and schema; no catalog/project migration materializes defaults.
Newer styling is not a promise that an older application can recreate it.

Existing typed `presentation` and `caption.cue.update` commands own these edits.
A bilingual text change must include updated run metadata or explicit null to
remove independent styling. Otherwise it fails with
`timeline.titleRunsConflict`. Clearing run metadata keeps both literal texts;
removing a title clears its runs atomically. Resetting title style retains text
and its bilingual boundary while removing typography/gap/effect overrides.
Undo/Redo, autosave, exact retry and saved reopening use the existing history.
Clip, primary-source and paired-photo locks remain enforced; caption cues retain
their existing independent Composition semantics and transcript provenance.
Trim/speed/split/replacement preserve authored run/effect data.

Font file hashes and primary/secondary usage assignments travel with render
receipts. Swapping assignments invalidates a reviewed crop even if the set of
fonts is unchanged. Collect Media retains both effective font bindings, including
unselected caption languages in later saved Compositions, subject to its existing
font licensing and hash checks. No font is downloaded by a project.

See the [design](https://github.com/bynanci/open-film/blob/main/docs/superpowers/specs/2026-10-30-d5b-title-finishing-design.md),
[plan](https://github.com/bynanci/open-film/blob/main/docs/superpowers/plans/2026-10-30-d5b-title-finishing.md) and
[validation record](validation-title-finishing.md).
