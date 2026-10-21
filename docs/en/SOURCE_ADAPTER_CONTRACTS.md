# Device adapter integration

Use new `@openfilm/source-pixel` and `@openfilm/source-insta360` packages following
existing source ports. No device-specific Core model changes. Original metadata
is preserved in the existing EXIF/FFprobe extensions. All methods below return a
detached asset or freshly inspected asset; application assigns its durable ID/hash.

Pixel package exports:

- `enrichPixelAsset(asset:MediaAsset):Promise<MediaAsset>`: reliable Google Pixel
  recognition; uncertain sources remain generic. Record timezone, orientation,
  GPS, camera, dimensions/codec/rate/color/HDR evidence already inspected.
- `inspectPixelDng(candidate: @openfilm/media.MediaCandidate, signal?:AbortSignal)`:
  inspect decodable DNG normally; if decoding fails, retain real ExifTool metadata
  and mark preview unavailable rather than losing the catalog asset.
- A `PixelSource` implementing the existing MediaSourceAdapter port.
- Metadata key `openfilm.pixel`: `{recognized, device?, motionPhoto?:{detected,
kind:'embedded'|'sidecar'|'metadata-reference', experimental:true, ...evidence}}`.
  Motion Photo minimum is detection and evidence; no production extraction claim.

Insta360 package exports:

- `isInsta360Raw(uri:string):boolean` for .insv/.insp.
- `inspectInsta360Raw(candidate,signal?):Promise<MediaAsset>`: recognition and
  metadata without stitching or treating dual-fisheye frames as flat media.
- `enrichInsta360Asset(asset:MediaAsset):Promise<MediaAsset>`: exported JPG/MP4
  recognition and practical original source association, with evidence.
- An `Insta360Source` implementing MediaSourceAdapter.
- Metadata key `openfilm.insta360`: `{level:1|2, original360Sources:string[],
requiresReframedExport:boolean, ...evidence}`. Exported flat media level1 renders
  normally. Raw .insv uses mediaType360-video; .insp can remain image with the
  capability below. Association is explicit metadata or cautious named siblings,
  never proof of optical/stitching correctness. Level3 remains deferred.

Shared preview capability metadata: `openfilm.preview` contains
`{supported:boolean, reason?:string, warnings?:string[]}`. Raw360 or undecodable
DNG uses supported:false and an actionable reason. Core stays device-agnostic.
Desktop displays **360 source / Requires reframed export** for raw360. Metadata
remains browseable and editable; unsupported sources do not silently render.

Root owns generic media changes: discover DNG/.insv/.insp, export extractExif,
preserve full color/HDR probe fields, safe HDR thumbnail/proxy/render tone mapping
(only with required FFmpeg filters), application adapter dispatch and skipping
unsupported derived stages while retaining metadata, source proxy serving, root
manifests/aliases/lockfile. Adapters may own their package.json only. Keep package
dependencies limited to existing core/plugin-sdk/media/metadata ports and Node.

Fixtures are generated CC0 with synthetic provenance: JPG/MP4, portrait/landscape,
duplicate/similar shots, audio, missing/GPS metadata, Pixel and Insta360 simulated
tags, plus generated HEVC10-bit HLG/PQ where codec exists. A generated TIFF/DNG
metadata fixture may validate DNG metadata only; real camera demosaic/optical/HDR
appearance remains manual. No private camera files are committed.
