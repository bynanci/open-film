# Film look open-source reference

This source review informs the bounded film-look implementation. OpenFilm's six
creative presets and `none` use original Apache-2.0 matrices; no upstream code,
LUT, model, or UI asset was copied. OpenColorIO, ACES configurations, Filmulator,
and RawTherapee are references, not installed dependencies or active processors.

## Pinned sources

Reviewed on 2026-10-18. These pins identify the material read, not the locally
installed FFmpeg version or a claim that upstream software was exercised.

| Reference                        | Exact read revision                        | Evidence and license                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FFmpeg `n8.0`                    | `140fd653aed8cad774f991ba083e2d01e86420c7` | [Filter documentation](https://github.com/FFmpeg/FFmpeg/blob/140fd653aed8cad774f991ba083e2d01e86420c7/doc/filters.texi): `colorchannelmixer`, `lut3d`, and `zscale`. [License](https://github.com/FFmpeg/FFmpeg/blob/140fd653aed8cad774f991ba083e2d01e86420c7/LICENSE.md): LGPL-2.1-or-later base; configured components may require GPL or other terms.                                                                                                                                                                                                                                                                                                                                |
| OpenColorIO `v2.4.2`             | `6918fad3f5d22ac3ef2397c754bf4268c2b58dd0` | [Look process space](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/6918fad3f5d22ac3ef2397c754bf4268c2b58dd0/docs/guides/authoring/looks.rst), [processor API](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/6918fad3f5d22ac3ef2397c754bf4268c2b58dd0/include/OpenColorIO/OpenColorIO.h), and [LUT baking limitations](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/6918fad3f5d22ac3ef2397c754bf4268c2b58dd0/docs/tutorials/baking_luts.rst). [Code license](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/6918fad3f5d22ac3ef2397c754bf4268c2b58dd0/LICENSE): BSD-3-Clause; the cited documentation declares CC-BY-4.0. |
| OpenColorIO-Config-ACES `v3.0.0` | `a5925315611828a342c0abb69714218a3612639a` | [README](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/blob/a5925315611828a342c0abb69714218a3612639a/README.rst) and [BSD-3-Clause license](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/blob/a5925315611828a342c0abb69714218a3612639a/LICENSE): versioned configuration and CLF reference.                                                                                                                                                                                                                                                                                                                                              |
| Filmulator `master` snapshot     | `57fbaec57555432d86d3aa632990cd8fa09114ad` | [README](https://github.com/CarVac/filmulator-gui/blob/57fbaec57555432d86d3aa632990cd8fa09114ad/README.md): raw development and spatial film effects. [License](https://github.com/CarVac/filmulator-gui/blob/57fbaec57555432d86d3aa632990cd8fa09114ad/LICENSE): GPL-3.0-or-later.                                                                                                                                                                                                                                                                                                                                                                                                      |
| RawTherapee `5.11`               | `db575c6690d30ce6428c0e1383bec8b8f1fb8d21` | [README](https://github.com/RawTherapee/RawTherapee/blob/db575c6690d30ce6428c0e1383bec8b8f1fb8d21/README.md) and [GPL v3 license](https://github.com/RawTherapee/RawTherapee/blob/db575c6690d30ce6428c0e1383bec8b8f1fb8d21/LICENSE): raw-development workflow reference.                                                                                                                                                                                                                                                                                                                                                                                                                |

## Decisions for this implementation

Adopt means independently implement a useful constraint; adapt means fit the
concept to OpenFilm's existing adapters; defer means outside this implementation.

| Decision                                                  | Application                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adopt** explicit processing stages from OCIO            | Distinguish source decoding, HDR conversion, creative matrix, compositing, and output encoding. Name the recipe domain `encoded-sdr-rgb`; this describes an operation on decoded SDR RGB, not a standardized color space or an OCIO process space.                                                        |
| **Adopt** versioned transform identity                    | Preserve recipe version, preset, strength, resolved inheritance scope, domain, origin, and license in export provenance. Original coefficients remain the common recipe for browser and renderer.                                                                                                         |
| **Adapt** FFmpeg channel mixing                           | Map the shared row-major matrix into `colorchannelmixer`; preserve alpha and bypass the creative operation for `none` or zero strength. Numeric behavior includes RGB clipping and the renderer's 8-bit `rgba` stage. The RGB lift uses input alpha, so it becomes a constant lift only on opaque pixels. |
| **Adapt** preview/render consistency                      | Use shared coefficients and explicitly describe browser preview as approximate. Record the existing HDR-before-look policy. Matching equations do not establish matching decoded inputs or universal display color parity.                                                                                |
| **Defer** native OCIO, ACES, and physical film simulation | Keep color-engine integration in adapters if later justified. The current presets do not reproduce camera responses, measured film stocks, spatial development effects, or an ACES pipeline.                                                                                                              |
| **Defer** external LUT loading and LUT export             | Establish licensing, processing-space, format, interpolation, and numeric contracts before adding assets or interchange claims. Current NLE project handoff retains look metadata; a baked render applies the creative operation.                                                                         |

## Current color boundary

The browser SVG adapter requests `color-interpolation-filters="sRGB"`. The
renderer applies the coefficients to decoded RGB without adding a transfer
conversion beyond the existing decode path. For supported HDR, the existing
Hable tone map produces BT.709 SDR before the creative matrix. BT.709 and sRGB
share primaries but have different transfer characteristics; `format=rgba` does
not convert one transfer function into the other.

Consequently, the shared matrix domain is an implementation boundary rather
than a full color-management promise. Browser decoding, source tags or missing
tags, embedded image profiles, display management, rounding, clipping, and output
compression can affect appearance. The rendered export is the deliverable;
browser preview is guidance. `none` disables the creative look and does not
disable required source decoding or HDR preview conversion. Unsupported HDR
metadata continues to require an SDR copy through the existing media policy.

## Future LUT admission and interchange

An external LUT needs asset-specific creator and source provenance, an exact
revision or checksum, explicit use/modification/redistribution terms, and any
required attribution. A repository-level license alone does not establish the
rights to every contributed LUT. No external LUT collection is bundled here.

A future transform contract must specify input, process, and output spaces;
domain/range; cube dimensions and entry order; interpolation; finite numeric
values; clipping and precision; alpha handling; and any shaper stage. OCIO's
[Iridas cube reader](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/6918fad3f5d22ac3ef2397c754bf4268c2b58dd0/src/OpenColorIO/fileformats/FileFormatIridasCube.cpp)
documents domains and red-fastest ordering, while its
[Resolve cube reader](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/6918fad3f5d22ac3ef2397c754bf4268c2b58dd0/src/OpenColorIO/fileformats/FileFormatResolveCube.cpp)
documents another cube dialect and shaper stages. A `.cube` extension does not
identify a color space. OCIO's
[CLF/CTF reader](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/6918fad3f5d22ac3ef2397c754bf4268c2b58dd0/src/OpenColorIO/fileformats/FileFormatCTF.cpp)
also distinguishes format versions and parameter bit-depth scaling from actual
processing precision. NLE interpretation and numerical comparisons would need
separate evidence before claiming equivalent interchange.

## Runtime licensing boundary

FFmpeg's actual binary configuration determines its applicable terms. Its pinned
license lists `perspective`, already used for photo motion, among optional GPL
filters, and `libx264` among GPL external libraries. The new channel-matrix
adapter does not establish an LGPL-only runtime. Inspect the version,
configuration, enabled components, and accompanying notices of any binary to be
distributed, as described in [third-party components](third-party.md).

This record summarizes design references without copying substantial upstream
material; it introduces no third-party payload or new NOTICE entry.
