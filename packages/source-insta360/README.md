# Insta360 sources

`@openfilm/source-insta360` implements the existing local `MediaSourceAdapter`
port and exports `isInsta360Raw`, `inspectInsta360Raw`, and
`enrichInsta360Asset`. Source files remain unchanged.

- **Level 1:** inspected flat JPG/MP4 exports are recognized from Insta360 or
  Arashi Vision camera/application metadata, or explicit original references.
  Existing decoded dimensions, timestamps, GPS, codec, color and raw metadata
  remain intact. Generic files named “Insta360” are insufficient evidence.
- **Level 2:** `.insv` and `.insp` sources remain catalog entries with real
  ExifTool metadata and bounded FFprobe metadata inspection when available.
  `.insv` is `360-video`; `.insp` remains `image`. Both carry
  `openfilm.preview.supported: false` and an instruction to import a stitched,
  reframed export from Insta360 Studio. Unsupported or corrupt payloads retain
  source identity and inspection warnings; no raw frame is used as a flat preview.
- Flat containers with explicit EXIF spherical/equirectangular projection tags
  or FFprobe Spherical Mapping side data also require a reframed export. Video
  uses `360-video`; images retain `image` with preview disabled. Aspect ratio
  alone does not establish spherical projection. Generic camera sources retain
  their generic identity when these explicit projection tags disable preview.
- **Level 3:** stitching, stabilization, reframing and native optical validation
  remain deferred.

`metadata["openfilm.insta360"]` records `level`, `original360Sources`,
`requiresReframedExport`, and `evidence`. Association entries contain `kind`
(`explicit-metadata` or `named-sibling`), `uri`, `evidence`, and `available`.
Explicit references come from existing `original360Sources` or inspected
OriginalFileName, OriginalRawFileName, DerivedFromFilePath and SourceFile tags.
Relative references resolve against the export directory. Offline explicit
references remain available as provenance hints.

Sibling associations require the same source/export stem, or a matching
`VID/IMG_YYYYMMDD_HHMMSS_[00/10_]sequence` capture name. `_export`, `_reframed`,
`_flat` and `_edited` suffixes are recognized. This can associate paired lens
files and their exports; filename evidence does not establish content identity,
optical correctness or production camera support. Symlinks are excluded.

Tests use generated decodable media and explicitly synthetic raw recognition
fixtures. Real Insta360 camera payloads and native Studio output remain a manual
compatibility check.
