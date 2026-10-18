# Generated 20-second photo-film comparison

```sh
pnpm exec tsx scripts/photo-film-quality.ts /tmp/openfilm-photo-quality-evidence
```

Requires FFmpeg/FFprobe and a locally installed CJK font. The title renderer
resolves `Noto Sans CJK TC` for the designed version and records the actual font
in each render manifest. No font is downloaded by this script.

The runner generates eight CC0 calibration stills: portraits with center, left
and right subject markers; landscape pairs; a square detail; a closing picture;
and a wide picture with two subjects near opposite edges. The pictures use
geometric markers and grids, without photographs or personal media. It also
creates 20 seconds of synthesized music tones and eight seconds of a gated
speech-shaped tone. The latter has no words and cannot establish narration
clarity, recording quality or language support. See [LICENSE](LICENSE).

`A.mp4` and `B.mp4` are each 20 seconds at 960×540 / 30 fps, using the same
timeline. A uses legacy contain geometry, cuts, static default titles and fixed
audio gain. B adds protected hero framing, two diptychs, a gentle push-in, a pan,
an intentional hold, one short dissolve, three Traditional Chinese text roles
and audio fades/ducking. The far-apart-subjects picture deliberately exercises
safe fallback when filling the frame would cut protected content. Only the
specified primitives change; this is a calibration comparison rather than an
automatic film-making or aesthetic quality claim.

The local output includes:

- `media/manifest.json`: relative generated source names, SHA-256 hashes and CC0 provenance.
- `A-composition.json`, `B-composition.json`, `composition-diff.json`: the actual editable recipes and structural differences.
- `implementation-sources.json`: code source hashes for reproducing a run from a working tree; the summary explicitly records whether Git was dirty.
- `A.mp4.manifest.json`, `B.mp4.manifest.json`: renderer-generated source, font, encoding and output evidence. These contain private local URIs.
- `A-contact-sheet.jpg`, `B-contact-sheet.jpg`: 24 actual decoded frames per film, at each clip start/middle/end and selected transition edges; timestamp labels sit outside the decoded frame.
- `frame-samples.json`: exact frame sample timestamps.
- `A-ffprobe.private.json`, `B-ffprobe.private.json`: measured media streams and duration, including local filenames.
- Loudness/true-peak and overall RMS logs; `evidence-summary.json` contains parsed measurements and a narrow 220 Hz music-band RMS comparison before/during the synthetic narration tone.

Generated files stay in the chosen local directory and are not committed. Keep
private manifests local or explicitly redact paths before publishing them.
Both outputs must contain video and audio and remain 20 seconds within one
frame. Manifest source hashes must match the generated inputs. Contact sheets
support visual review; synthetic success does not replace real source review,
listening, projection, workstation or DaVinci Resolve QA.

To generate only the reusable source library:

```sh
node fixtures/photo-film-quality/generate.mjs /tmp/openfilm-quality-media
```
