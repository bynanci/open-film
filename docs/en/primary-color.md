# Primary color

In **Edit**, select a photo or flat video clip and open **Primary color** in the
inspector. Choose **Whole film**, **Scene** or **Clip**, adjust the values, then
select **Apply primary color**. Values stay in the controls until Apply; the
Monitor displays saved settings. Apply creates one Undo step and autosaves.

| Control               | Bounds and meaning                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Warm / cool           | -1 to 1; positive warms red relative to blue. This is a bounded RGB adjustment, with no Kelvin/camera-profile claim.            |
| Encoded SDR gain (EV) | -2 to 2; multiplies encoded SDR code values by `2^EV`. Calibrated scene exposure requires a separate color-management workflow. |
| Contrast              | 0.5 to 1.5; 1 is neutral, around a normalized encoded-RGB pivot of 0.5.                                                         |

**Neutral values** prepares 0/0/1 in the controls; Apply saves that explicit
override. **Inherit** removes the selected scope's override. Effective priority is
clip → scene → whole film → uncorrected. Explicit neutral stops inheritance.
Parent edits retain child overrides. A change affecting locked clips, source
media or paired photos is rejected atomically. Selection pins remain selected;
source files and all timing remain immutable.

Correction applies to source picture pixels, including both diptych photos. It
does not color titles, captions, canvas, gaps or controls. Existing HDR conversion
runs first, primary correction runs next, and Film Look runs afterwards. Each
color operation clamps independently. **Before Film Look** comparison retains
saved primary correction. Selecting an Original Film Look skips that creative
operation while retaining primary correction.

Committed edits use the existing saved-revision transport fence, which pauses and
rebuilds Record ownership safely. Diagnostic Film Look comparison preserves the
current media resources. Primary controls introduce no separate playback clock,
timeline, live unsaved media edit or source proxy bake.

## Statistical Auto Match

Select **Auto Match · statistical suggestion**, choose a reference clip, then
**Measure a suggestion**. The local measurement compares brightness, warm/cool
balance and contrast statistics before Film Look. It shows decoded **Reference**,
**Before primary** and **Suggested primary** images, median/clipping measurements,
and current/proposed numbers. Review the loaded samples, check the review box,
then select **Apply suggestion to this clip**. Generation and comparison leave
the project unchanged. Discard or Escape cancels and returns focus to Measure.

This is a statistical suggestion. Differences in lighting and scene content need
human judgment. Dark, flat or heavily clipped samples can receive no useful
suggestion. Measured improvement must be at least 5% and 0.005 in the declared
score, with no clipping-fraction increase above 0.02.

The bounded review accepts two distinct opaque photo/flat-video clips from the
same saved film. It samples up to three positions inside each effective source
range. Diptychs, transparent sources, unavailable/unsupported media, sources above
512 MiB, and dimensions above 8192×8192 require manual adjustment. Ordinary manual
correction still supports valid diptychs and partial alpha.

Reports are private, local and limited to five, with one active measurement and a
30-minute expiry. Changing the project, saved revision, source bytes or comparison
artifacts invalidates review. Apply rechecks full source hashes and exact recipe
inside the serialized editor. Accepted numbers survive Undo/Redo, autosave,
Named Versions, Collect and reopen. A private proposal cannot resume after
reopen. A fresh measurement is needed for fresh evidence.

A reviewed Apply is a single-command editor transaction. Requests combining its
private review ID with replacement, trim or other sibling commands are rejected
before any edit is saved. Ordinary manual edit batches and later independent
replacement remain available; exact acknowledged request retries remain safe.

At the original expiry deadline, an owned timer retires the report and removes
its private comparison directory without waiting for another measurement. Discard
and project close cancel owned timers. Expired access also attempts cleanup. A
filesystem deletion failure is reported, leaves the evidence permanently
unusable, and retains bounded cleanup ownership for retry through access,
discard or disposal; it does not extend the report deadline.

## Portable numerical contract

The optional recipe extends schema `1.0.0` Composition/Clip data and needs no
catalog migration:

```ts
interface PrimaryColorCorrection {
  version: 1;
  temperature: number; // finite -1..1
  exposureEv: number; // finite -2..2
  contrast: number; // finite 0.5..1.5
}
// Composition.defaultPrimaryColor?: PrimaryColorCorrection
// Composition.beatPrimaryColors?: { beatId: string; correction: PrimaryColorCorrection }[]
// Clip.primaryColor?: PrimaryColorCorrection
```

Unknown fields/versions, missing parameters and invalid bounds fail validation.
Absent/neutral correction adds no format conversion and preserves legacy decoded
output exactly. Core derives RGB slopes
`2^exposureEv * contrast * [1 + .1*temperature, 1, 1 - .1*temperature]` and constant
offset `.5*(1-contrast)`, rounded to 12 decimals. Clamp once after primary, then
apply the separate Film Look. Alpha is preserved. SVG uses sRGB coefficients;
FFmpeg uses the same coefficients in a generated RGB LUT on decoded RGBA8.

This establishes shared equations, with measured codec/browser tolerances.
Browser decode, proxies, transfer functions, quantization, display profiles and
physical displays can differ. Judge delivery with the FFmpeg rendered preview.
The private render manifest records scope, recipe, coefficients, source/color
hash evidence and FFmpeg build alongside the existing Film Look registry.

JSON/OTIO retain authored/effective metadata. Active primary correction needs
manual recreation in editable NLE output; limited FCPXML/EDL exports reject it.
Fidelity handoff bakes existing opaque precomp intervals and sets explicit neutral
primary on replacement clips to prevent applying it again. Existing output-only
Film Look choices retain saved primary correction. Collect does not color-bake
originals or shared preview sources.

## CLI and HTTP

The existing editor request saves primary settings:

```json
{
  "baseRevision": "saved-editor-revision",
  "requestId": "primary-adjustment-1",
  "commands": [
    {
      "type": "primary-color",
      "scope": "clip",
      "clipId": "clip-id",
      "correction": {
        "version": 1,
        "temperature": 0.2,
        "exposureEv": 0.3,
        "contrast": 1.1
      }
    }
  ]
}
```

```bash
pnpm cli primary-color edit --project /tmp/film.openfilm --composition film --commands /tmp/primary.json
pnpm cli primary-color-review --project /tmp/film.openfilm --composition film --clip target --reference-clip reference
```

CLI review prints transient statistics/suggestion JSON. Its private images and
review ID do not survive process exit; it cannot silently apply or resume a
proposal. Use Desktop for the image review workflow. HTTP review is project-bound
and uses the same service; Apply uses the ordinary editor command with the exact
suggestion and `primaryColorReviewId`.

See [validation](validation-primary-color.md),
[Film Looks](film-looks.md) and [NLE compatibility](nle-compatibility.md).
