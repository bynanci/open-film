# Camera sources and preview limits

Device adapters live in `@openfilm/source-pixel` and
`@openfilm/source-insta360`; the portable Core has no device-specific branches.
The application applies their metadata enrichment during local import. Original
EXIF/FFprobe records remain available alongside the interpreted fields.

| Source                                  | Implemented behavior                                                                            | Verified evidence                                                                        | Remaining manual check                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Pixel JPG/MP4                           | Google/Pixel metadata recognition; date/offset, orientation, GPS, device and technical metadata | Real ExifTool-tagged generated JPG/MP4, import and preview tests                         | Representative camera originals and orientation appearance |
| DNG                                     | Metadata retained; preview only after successful bounded decode                                 | Generated TIFF/DNG tags and metadata-only DNG fixture                                    | Real Pixel CFA/demosaic and camera color                   |
| HEVC 10-bit HLG/PQ                      | Detect, retain original color fields, tone-map preview to SDR                                   | Generated HEVC, actual FFprobe, thumbnail, proxy and renderer; original hashes unchanged | Real HDR appearance and device-specific metadata           |
| Pixel Motion Photo                      | Embedded offset, sidecar and metadata-reference detection with evidence                         | Simulated metadata, embedded bytes and named sidecars                                    | Real camera variants and extraction; experimental          |
| Insta360 flat exported JPG/MP4, Level 1 | Ordinary playable media, retained device metadata, source association                           | Generated tagged JPEG/H.264 files decoded, thumbnailed, proxied and rendered             | Representative real exports, especially unusual codecs     |
| `.insv` / `.insp`, Level 2              | Recognition, best-effort metadata and original-source association                               | Simulated source files and explicit/conventional sibling relationships                   | Real camera raw files and hardware metadata                |
| Raw/spherical processing, Level 3       | Capability recorded; requires reframed export                                                   | Explicit spherical metadata and raw files are blocked from flat preview                  | Stitching, gyro, reframing and keyframes are deferred      |

Level 1 uses the normal production media path. This does not imply every camera
codec or raw format has been validated. A filename alone does not establish Pixel
identity. Uncertain files use generic camera handling. Insta360 associations record
their evidence and do not certify that two files share identical source content.
An explicit spherical projection is treated as 360 media even in an MP4 or JPG;
a 2:1 aspect ratio alone does not establish that projection.

HDR detection distinguishes bit depth from dynamic range: 10-bit or BT.2020 alone
does not imply HDR. HLG/PQ transfer functions and HDR side data are preserved in
`openfilm.color` and the original probe record. Safe SDR previews require known
transfer/primaries/matrix values and FFmpeg `zscale` plus `tonemap`. Unknown color
metadata or missing filters produces an actionable unsupported-preview message;
OpenFilm keeps the catalog metadata instead of silently producing a wrong preview.
This is preview conversion, not a full color-management or grading engine.

Raw 360 sources display **360 source / Requires reframed export**. Export a
stitched, reframed flat JPG/MP4 with Insta360 Studio, then import that file.
Undecodable DNGs similarly require an exported JPEG for preview. Unsupported
sources stay browseable; automatic story composition excludes them. An explicitly
required unsupported asset must be converted before composition/rendering.

For projects imported before these adapters, import the source folder again to
refresh device/color metadata and rebuild versioned preview caches. IDs, ratings,
locks and timeline references remain stable. Preview proxies are cached inside
the project; missing proxies have a specific rebuild instruction. Originals are
never rewritten by this pipeline.

All committed fixture definitions are generated/public-domain. See
[`fixtures/proposal-film`](../fixtures/proposal-film/README.md) for provenance and
reproduction. No real personal camera media is bundled.

## Browser previews of ordinary media

Native JPEG, PNG, WebP, GIF and BMP sources are served with their matching image
MIME type. TIFF, AVIF, successfully decoded HEIC/DNG, and HDR images use the cached
JPEG preview. Unsupported or missing derivatives give a specific rebuild or
conversion instruction instead of sending undecodable source bytes to the player.

Imported audio uses a project-relative MP3 preview cache, including AAC, M4A,
FLAC, Ogg and Opus. Embedded album artwork remains metadata and does not turn an
audio file into a video clip. Rendering and timeline exports retain the original
audio references; preview conversion never rewrites the source. Reimporting an
older audio-only import builds its missing preview. Disabling proxies explicitly
uses the original audio and therefore depends on the browser's native codec support.

`tests/integration/preview-formats.test.ts` generates real GIF, BMP, TIFF, AVIF
and audio files, including MP3/FLAC with embedded cover art. It checks HTTP MIME,
served bytes, audio codec, byte ranges, missing-cache recovery, project relocation
and unchanged source hashes. HEIC coverage is a catalog/cache routing fixture:
it does **not** establish real HEIC decoding support or camera compatibility.
A representative HEIC import still needs verification with the installed FFmpeg
build.
