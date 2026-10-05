# Google Pixel source adapter

`PixelSource` implements the existing local media source port. `enrichPixelAsset`
recognizes Google plus a Pixel camera model in EXIF/QuickTime metadata; filenames
or a Google Photos software tag alone remain `GenericCamera`. It preserves the
original EXIF/FFprobe extensions, IDs, hashes, ratings and locks. Date offsets,
orientation, GPS, camera, dimensions, codec, frame rate and color/HDR evidence stay
available in the source metadata and `openfilm.pixel.evidence`.

Motion Photo support is experimental detection only. A bounded positive video
byte-offset or an ExifTool embedded-video field records `kind: embedded`.
Motion tags with a matching regular sibling video record `kind: sidecar`;
unresolved references record `kind: metadata-reference`. Offset evidence is not
a verified MP4 extraction. Named sibling pairing is not proof of correspondence.
The adapter does not modify originals, extract embedded video, assemble motion
playback or claim production support. Referenced sidecars must be in the source's
own directory; symlink files are ignored.

`inspectPixelDng` first attempts normal inspection and a one-frame decode. If the
installed tools cannot decode it, real ExifTool DNG metadata remains catalogable
with `openfilm.preview.supported: false` and an actionable RAW-export reason.
Malformed files without DNG metadata still fail. Synthetic metadata fixtures
exercise catalog retention; they do not demonstrate a real Pixel camera's RAW
demosaic, optical output or HDR appearance. Those checks remain manual.
