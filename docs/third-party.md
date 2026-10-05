# Third-party components

OpenFilm source is Apache-2.0. Dependencies and external programs retain their
own licenses; the project license does not replace them. The lockfiles identify
exact versions, including transitive packages.

| Component                     | Role                                           | Upstream license                                                                |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Vue, Vite, TypeScript tooling | Desktop UI and builds                          | MIT (Vue/Vite); Apache-2.0 (TypeScript)                                         |
| Tauri                         | Native shell                                   | MIT OR Apache-2.0                                                               |
| Node.js                       | Local application runtime                      | MIT and bundled component notices                                               |
| SQLite                        | Embedded project catalog                       | Public domain                                                                   |
| exiftool-vendored.pl          | Perl ExifTool packaging wrapper                | MIT wrapper; ExifTool's own terms apply to the bundled tool                     |
| ExifTool                      | Read media metadata                            | Same terms as Perl: Artistic License or GNU GPL                                 |
| FFmpeg / FFprobe              | Decode, cache and render media                 | LGPL-2.1-or-later normally; GPL-enabled builds and codecs have additional terms |
| OpenTimelineIO                | Independent development-time export validation | Apache-2.0                                                                      |

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
