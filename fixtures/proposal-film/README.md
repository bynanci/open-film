# Generated proposal reference library

```sh
node fixtures/proposal-film/generate.mjs /tmp/openfilm-proposal-reference
```

The generator uses FFmpeg and the repository's vendored Perl ExifTool package.
It creates a small reusable library of CC0 geometric photos, test-pattern video
and synthesized audio. Import the generated `media/` directory for the ordinary
proposal workflow. No generated binaries are committed.

`media/` contains ten assets: a landscape, a similar shot, an exact byte copy,
a portrait, a PNG without capture metadata, a simulated Google Pixel portrait
and MP4, simulated Insta360 flat JPG/MP4 exports, and an eight-second audio bed.
The Pixel JPEG has genuine EXIF fields for camera, capture time, timezone,
orientation and synthetic GPS coordinates, plus experimental Motion Photo tags.
Device names describe simulated metadata, not the origin of the pixels.

`raw/` contains five optional adapter fixtures: `.insv` and `.insp` recognition
samples, a metadata-only DNG, and a tagged Pixel photo/video sidecar pair. Import
this directory separately when testing unsupported source handling. The 360
samples are ordinary generated MP4/JPEG containers with raw extensions. The DNG
is a minimal TIFF structure with real DNG/EXIF tags and no image strips. These
fixtures validate recognition, metadata retention and explicit preview limits;
real-device stitching, raw demosaicing and optical appearance require camera
originals and separate manual verification.

`manifest.json` records every relative path, expected metadata, content hash,
byte count, synthetic provenance and CC0 license. Original bytes can be checked
against its hashes after editing, rendering, moving and relinking a project.

```js
import { generateProposalMedia } from "./fixtures/proposal-film/generate.mjs";

const fixture = await generateProposalMedia("/tmp/reference", {
  includeRaw: true, // default; false generates only ordinary media
});
// fixture.mediaDirectory, fixture.rawDirectory, fixture.manifestPath
// fixture.byId["pixel-photo"], fixture.byId["insta360-video"]
// fixture.files: id, path, kind, expected, synthetic, sha256, bytes
```

Suggested editing exercise: start with the opening landscape, reject its exact
copy, compare the similar shot, trim the two videos, use a portrait in the middle
beat and finish on the Insta360 flat export. Then move both the media and project
directories, reopen the project, and relink while preserving ratings and edits.
The metadata-free PNG exercises filesystem timestamp fallback. The generated
music is two sine waves rather than a recorded performance.
