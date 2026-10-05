# Security policy

## Supported scope

Security fixes currently target the 0.1.x development line. OpenFilm is a local
application; its loopback service can create projects and import files accessible
to the current operating-system user. It is not designed as a multi-user or
internet-facing service.

The server binds to `127.0.0.1`, checks the request Host and allowed browser
origins, requires JSON for write requests, limits request bodies, and streams only
cataloged cached thumbnails and the active project's preview. Project/cache paths
reject unsafe symlink destinations. Media tools receive argument arrays rather
than interpolated shell commands. These boundaries are covered by tests and
should be retained in extensions.

No remote AI provider is enabled. The plugin SDK supplies provider disclosure and
scoped consent validation, but plugins execute as trusted code and are not
sandboxed. Review a plugin before giving it filesystem access or media data.
Keep Node, FFmpeg, FFprobe, ExifTool, the webview, and project dependencies current:
media decoding and local process integration are part of the application's trust
boundary.

## Reporting a vulnerability

Use the repository host's private vulnerability reporting feature if enabled, or
an existing private maintainer contact. If neither is available, open an issue
asking for a confidential reporting channel; omit exploit details, private media,
file paths, credentials, and personal information from that public request.

A private report should include the affected version/commit, platform, minimal
reproduction with synthetic media, impact, and any suggested mitigation. We do not
publish a guaranteed response deadline or a paid bounty program. Maintainers
should acknowledge receipt and coordinate a fix and disclosure with the reporter.

## Privacy and project handling

Projects and exported timelines can contain absolute source paths, capture dates,
GPS, and other metadata. Share only the material you intend to disclose; use
generated fixtures for public issues. The project does not include the originals,
so moving or sharing a project does not grant recipients access to its media.

Close OpenFilm before making a filesystem backup of a project, or use SQLite-aware
backup tooling that also accounts for active WAL state. Back up source media
separately. Corrupt projects should be rejected rather than repaired by silently
rewriting or discarding data.
