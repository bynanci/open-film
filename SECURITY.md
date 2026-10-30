# Security policy

[English](SECURITY.md) · [繁體中文](SECURITY.zh-TW.md) · [日本語](SECURITY.ja.md)

## Supported versions

The latest published stable release is v0.4.0; main is active, unreleased development. Please report issues against the latest stable release or current main. Older releases may not receive fixes, and no backport or response-time commitment is made unless maintainers publish one.

## Trust boundaries

OpenFilm is a local application, not a multi-user or internet-facing service. Its local service binds to 127.0.0.1 and checks Host and browser Origin values. These checks are not authentication between processes running as the same operating-system user. Local clients can access imported sources and validated project operations.

Project and cache paths reject unsafe symlink destinations. Media tools receive argument arrays, not interpolated shell commands. Supported media containers are restricted, but FFmpeg, ExifTool, plugins and the operating system are not sandboxed. Keep these tools and dependencies current.

No remote AI provider is enabled by default. Provider consent is scoped, but plugins execute as trusted code and are not sandboxed. Review a plugin before allowing it access to project files or media.

Dependency advisories are checked on dependency changes and weekly by .github/workflows/security.yml. Scanner output reflects the advisory database revision used and does not certify that software is vulnerability-free. See the [security review](docs/security-review-2026-10-18.md) for its scope and limits.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting feature if it is enabled. Otherwise, contact a maintainer through a private channel. If no private channel is available, open a public issue asking how to report privately; do not include exploit details, affected private data or reproduction material in that request.

Include the affected release or commit, operating system, impact and a minimal reproduction using generated media where possible. Do not include private footage, project databases, credentials, personal paths or GPS data. We do not promise a response deadline or operate a paid bounty program.

## Privacy and project handling

Projects and exports can contain absolute source paths, capture dates, GPS and transcripts. Share only information you intend to disclose. A project file does not include the referenced original media and does not grant recipients rights to it.

Close OpenFilm before making a filesystem backup, or use SQLite-aware backup tooling that accounts for an active WAL. Back up source media separately. Corrupt projects should be rejected rather than silently rewritten or discarded.
