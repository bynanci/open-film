# Generated sample media

Run `node fixtures/sample-media/generate.mjs /tmp/openfilm-samples` from the repository root. FFmpeg creates two geometric images, an exact image copy, a three-second motion test pattern with synthesized sound, and a two-second audio tone. No personal media or downloaded material is used. The generated files are dedicated to the public domain under CC0 1.0; the current distribution is GPL-3.0-only, with historical generator Apache-2.0 grants preserved. See docs/licensing.md.

Tests generate these assets in temporary folders and exercise actual FFprobe, FFmpeg and SQLite. Generated originals stay outside project directories. Project cache contains only thumbnails, video proxies and previews. ExifTool enriches metadata when installed; FFprobe plus filesystem timestamps provide the offline fallback.

_Modified by OpenFilm contributors on 2026-10-18. Preexisting Apache-2.0 grants remain available; the current derivative distribution is GPL-3.0-only. See LICENSE and NOTICE._
