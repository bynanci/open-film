# MP4 compression quality

Export shows the film's actual saved width, height and frame rate. New projects
default to 1920 × 1080 at 30 fps; an existing project keeps its own frame. The
preview framing guides do not change that output size. MP4 rendering reads the
imported original sources, independently of editing proxies.

Choose **MP4 quality** in Export:

| Choice             | H.264 encoder | Preset   | CRF |
| ------------------ | ------------- | -------- | --- |
| Standard (default) | libx264       | veryfast | 23  |
| High detail        | libx264       | medium   | 18  |

High detail reduces video compression. Exports take longer and files are usually
larger. It does not recover detail absent from a source, reverse earlier photo
enlargement, add HDR mastering or change the composition frame. There is no
post-export upscaling step.

The choice is an output snapshot, shared by rendered preview and MP4 export.
Changing it marks an existing rendered result stale. Starting an output captures
the selected quality; an in-flight job cannot be changed through the selector.
Switching projects/compositions or restarting resets the choice to Standard.
It is not saved into the project, timeline history or editable NLE exports.
Existing film/scene/clip look choices, trims, duration, title geometry and music
tracks stay unchanged. Audio still follows the existing AAC / 48 kHz render
pipeline; this is a video compression control, not lossless audio export.

## Headless use

```bash
pnpm cli render --project /path/film.openfilm --quality high-detail
pnpm cli export --project /path/film.openfilm --format mp4 --quality high-detail
```

Omit `--quality` to retain Standard. Unknown values and quality flags on editable
exports fail validation. The same optional `quality` field is accepted by the
application's `FilmRenderOptions`, HTTP `/api/render` and MP4 `/api/export`.
HTTP validates it before reserving a job. It accepts only `standard` or
`high-detail`; arbitrary codecs, CRF values and FFmpeg arguments are not accepted.

The private `.mp4.manifest.json` records the profile, actual codec, preset and CRF,
saved frame, source identities and output hash. Review that file when comparing
renders. The profile is additive evidence in the existing version-1 manifest.

## Verification boundaries

Generated tests read x264's actual encoder SEI as well as the manifest, compare
decoded audio between profiles and verify Full HD / fractional frame-rate output.
These establish a software contract, not a subjective private-film quality claim
or a workstation performance benchmark. Real camera/HDR, display, projector,
native installer and Resolve checks remain manual gates. The existing photo
motion adapter can still resample a photo before enlarging it; this compression
choice does not claim to solve that separate sampling limitation.

See [executed validation](validation-export-quality.md).
