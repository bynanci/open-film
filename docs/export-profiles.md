# Versioned Export Profiles

Export Profiles describe render-only output choices. They do not edit the saved
Composition, project frame settings, source media, or timeline history. Desktop,
HTTP, CLI, PNG, WAV, and MP4 exports use the shared `ExportProfileService` and
FFmpeg renderer.

## Profile v1

`ExportProfile` is a strict version-1 record with:

- `ratio`: `16:9`, `9:16`, or `1:1`.
- `width` and `height`: even dimensions from 64 through 4096, with an 8.3 MP
  output-pixel limit. Dimensions must match the selected ratio.
- `frameRate`: 1–60 fps.
- `framing`: `contain` or `crop`.
- `subtitleStrategy`: `preserve` for contain, `review-crop` for crop.
- `format`: `mp4`, `png`, `wav`, or `audio-stems`.
- `quality`: the existing `standard` or `high-detail` intermediate MP4 choice,
  including the intermediate used for PNG previews/stills. Audio profiles use
  `standard`. A supplied profile determines encoding quality even when a caller
  also supplies a separate quality option.

The defaults use 1920×1080, 1080×1920, or 1080×1080. `contain` scales the saved
Composition into the profile frame and pads unused space with black. `crop` uses
an explicit center crop and warns that a protected subject or subtitle safe area
may be cut. Crop publication requires a successful **Preview Export Frame**,
its `cropPreviewToken`, and explicit `confirmCrop: true` across Application,
HTTP, CLI and Desktop. This is not automatic subject reframing.

PNG output is opaque; alpha export is unsupported and reported in the warning
list and receipt. Larger output dimensions do not recover missing source detail.

## Rendered previews and stills

The preview service renders the selected saved Composition revision with the
selected profile, film look, and caption track, then extracts the requested
frame from that real MP4. Its response includes the frame-aligned time/index,
dimensions, profile, warnings, and an opaque token. The token is bound to the
project ID, project revision, Composition, frame index, selected profile,
quality, look/caption selection and source hashes. A null look override preserves
saved looks, like an omitted override. The token expires after ten minutes and
is served from a private project cache. Project
switches, edits, changed sources, cancellation, and cache expiry invalidate the
preview. The cache retains at most twelve owned PNG/receipt pairs, pruning old
sessions and orphan receipts when another preview is generated. Receipts can be
validated by a later service instance while their saved revision remains current.
The last selectable frame is the last complete frame at the output frame rate.

PNG stills use that same render path. `exports/still-<request-id>.png` is
published with a versioned JSON manifest containing the project/revision,
Composition hash, profile, look/caption selection, frame time/index, source
hashes, warnings, and output hash. Repeating a request ID with the same content
returns the verified existing result; using it for different content fails.
For a cropped still, the token must match that exact output frame and all render
choices. For MP4, it must match the output profile and render choices; reviewing
one frame does not establish that every shot is safely framed.

## WAV mix and role stems

WAV mix and role stems are generated from the existing Composition clips and
`AudioAutomation` renderer graph. Muted/hidden clips remain excluded, and saved
gain, fades, and ducking are evaluated by the same renderer. Outputs are
48 kHz, stereo, 24-bit PCM. Every stem has the same timeline start, duration, channel
count and sample count. Available roles are narration, music, ambience and
dialogue; no file is fabricated for a role with no applicable audio. The
versioned manifest records each output hash, role and sample measurements plus
the source hashes. A full mix is published as
`exports/mix-<request-id>.wav`; stems and their manifest are published together
under `exports/stems-<request-id>/`.
Audio preflight checks only sources used by the selected audio graph, so an
offline picture-only source does not block audio delivery. Conflicting hashes
for a source shared by successive role renders abort publication.

## Shared entry points and safety

- Application methods: `previewExportFrame`, `exportStill`, and
  `exportProfileAudio`.
- HTTP: `POST /api/export/frame-preview`, `GET
/api/export/frame-preview/:token`, `POST /api/export/still`, and
  `POST /api/export/audio`. MP4 uses the existing `POST /api/export` with a
  validated `exportProfile` and explicit crop confirmation when required.
- CLI: `openfilm export` accepts the existing MP4 format plus profile-based PNG,
  WAV, and audio-stem formats.
- Desktop: Export shares the saved Composition and existing MP4 look/caption
  controls; pending jobs can be cancelled, and stale project/revision results
  are discarded.

For CLI crop delivery, first request a PNG preview with the intended render
settings, inspect its returned local PNG path, then use its token within ten
minutes:

```sh
openfilm export --project film.openfilm --format png --ratio 9:16 --fps 30 --framing crop --time 1 --quality high-detail --preview
openfilm export --project film.openfilm --format png --ratio 9:16 --fps 30 --framing crop --time 1 --quality high-detail --confirm-crop --crop-preview-token <token> --request-id reviewed-still-001
```

Use the same look/caption choices in both calls. The second call can instead
select `--format mp4` and omit `--time` to deliver video from that reviewed
profile. `--confirm-crop` alone cannot authorize an unreviewed crop.

Profiles and manifests are output records, not project schema fields. Exports
are staged in private directories and atomically published. Output paths reject
symlinks and unsafe names; manifests and outputs are hash-checked on retry. The
application verifies source identity before publication and never rewrites the
original media. Project schema 1.0.0 and SQLite schema are unchanged.

This contract does not claim alpha export, automatic subject tracking, recovery
of source detail, hardware performance, or successful import into a particular
NLE. See [the validation record](validation-export-profiles.md) for measured
synthetic output and remaining workstation gates.
