# Third-party components

OpenFilm's current first-party code is offered under Apache-2.0; see
[licensing](licensing.md) and the authoritative [LICENSE](../LICENSE).
Dependencies and external programs retain their own licenses; the project
license does not replace them. The lockfiles identify exact versions, including
transitive packages. Previously granted rights remain available for the
historical material covered by those grants.

| Component                     | Role                                                            | Upstream license                                                                |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Vue, Vite, TypeScript tooling | Desktop UI and builds                                           | MIT (Vue/Vite); Apache-2.0 (TypeScript)                                         |
| Tauri                         | Native shell                                                    | MIT OR Apache-2.0                                                               |
| Node.js                       | Local application runtime                                       | MIT and bundled component notices                                               |
| SQLite                        | Embedded project catalog                                        | Public domain                                                                   |
| exiftool-vendored.pl          | Perl ExifTool packaging wrapper                                 | MIT wrapper; ExifTool's own terms apply to the bundled tool                     |
| ExifTool                      | Read media metadata                                             | Same terms as Perl: Artistic License or GNU GPL                                 |
| FFmpeg / FFprobe              | Decode, cache and render media                                  | LGPL-2.1-or-later normally; GPL-enabled builds and codecs have additional terms |
| OpenTimelineIO                | Independent development-time export validation                  | Apache-2.0                                                                      |
| fontkit                       | Local font shaping, measured title layout and glyph outlines    | MIT                                                                             |
| resvg (`@resvg/resvg-js`)     | Rasterize local title outlines into a shared preview/render PNG | MPL-2.0                                                                         |

FFmpeg/FFprobe and Perl are system prerequisites, not redistributed OpenFilm
binaries. Do not assume that every locally installed FFmpeg build has the same
license or enabled encoders. Inspect `ffmpeg -version` and upstream notices for
a binary being shipped. Installer work must resolve runtime, codec and ExifTool
notice obligations before redistribution. Codec patent licensing is separate
from copyright licensing.

Generated test media consists of procedural shapes, FFmpeg test patterns and
synthesized tones. No personal photographs, recordings or commercial music are
included. The fixture generator dedicates its generated media to the public
domain under CC0-1.0. The application icon is original OpenFilm contributor work
and is covered by this repository's license.

## Local title fonts and rasterization

Title rendering uses fontkit and resvg locally. Their exact versions and
platform-specific native rasterizer dependencies are recorded in `pnpm-lock.yaml`.
The rasterizer receives numerical glyph paths; it does not fetch fonts, contact
font services or embed remote images. The same resulting PNG is used for the
editor preview and FFmpeg render.

OpenFilm does not copy operating-system fonts into its repository or export
them with projects. Its default font lookup prefers the installed Noto Sans CJK
Traditional Chinese face, then documented local platform fallbacks; exports
record the resolved face and font-file SHA-256. `OPENFILM_TITLE_FONT` can select
an explicitly installed OTF, TTF or TTC. Missing glyphs are reported before
rendering. Font availability and redistribution permission are separate:
Windows/macOS fonts may be used locally according to their licenses but must
not be copied into installers without the required rights.

[Noto CJK](https://github.com/notofonts/noto-cjk) is SIL Open Font License 1.1.
The Linux development/CI environment installs the distribution's `fonts-noto-cjk`
package rather than bundling the font files in OpenFilm. If an installer later
redistributes Noto, retain the upstream copyright and complete OFL notice;
modified fonts must also meet reserved-name and other OFL conditions. Fontkit's
MIT notice and resvg's MPL-2.0 notice remain with their installed packages;
OpenFilm's current distribution terms are described in [licensing](licensing.md); dependency terms are unchanged.

## Optional transcription and capability reference

`faster-whisper` and CTranslate2 are optional local Python dependencies under
MIT licenses. OpenFilm does not redistribute their runtime or model weights in
its application package. Models have their own terms; verify the selected
publisher's license and retain required notices before redistribution. The local
adapter loads a supplied directory with networking disabled during recognition.

VidScribe is a capability reference, pinned in [the adaptation record](vidscribe-reference.md).
Its upstream source is MIT, copyright 2026 VidScribe contributors. This foundation
independently implements its adapted concepts; no substantial source, model or
UI asset was copied. OpenFilm's independent implementation is offered under
Apache-2.0. If future work copies substantial upstream code, retain the upstream copyright and full
MIT notice with that code and update NOTICE and this record.

## Original film looks and design references

The six creative film-look matrices and `none` are original OpenFilm work under
Apache-2.0. Their provenance is `openfilm-original`; they are aesthetic RGB
treatments without camera-response or measured film-stock claims. The
[pinned reference record](film-look-open-source-reference.md) documents FFmpeg,
OpenColorIO, ACES configurations, Filmulator, and RawTherapee as design inputs.
No reference code or LUT was copied; OCIO, ACES, Filmulator, and RawTherapee are
not application dependencies. No new third-party payload or NOTICE entry is
introduced by this source review.

FFmpeg licensing still depends on the actual binary configuration. Its upstream
license identifies the existing `perspective` filter and `libx264` integration
as GPL components; the channel-matrix feature does not establish an LGPL-only
runtime. Restoring Apache-2.0 for OpenFilm does not change those executable
terms. Any future external LUT must have its own traceable license and source
provenance before inclusion; a collection's repository license alone is
insufficient evidence for every contributed asset.

_Modified by OpenFilm contributors on 2026-10-18. Current first-party terms are Apache-2.0; historical grants and third-party terms remain applicable. See LICENSE and NOTICE._
