# Native runtime and installer candidates (M7E)

This candidate implements verified runtime staging, native startup/diagnostics,
owned shutdown and an installer build workflow. Windows/macOS installation QA,
release signing and an update feed are **not configured or validated**. A Linux
runtime process regression is not evidence of a self-contained Windows installer.
M7A is integrated in main. M7B/M7D/M8A remain separate PRs; M7E uses the current
main runtime contract and does not depend on their unmerged changes.

## RuntimeManifest v1

`runtime-manifest.json` is an installation resource, outside project schema 1.0.0
and SQLite. It declares application/Node versions, platform/architecture, supported
project schema, entrypoints, every file's SHA-256/size/executable flag, component
versions and license-file references. `sbom.spdx.json` is also hash-covered.
`NOTICE` and per-component license texts travel with the bundle. `distribution`
records reviewed OS baseline/shared-library requirements and a hash-covered audit
receipt. Without it, staging produces a `test-only` bundle: the installer verifier
and release shell reject that bundle. IDs and inventory
paths are relative; build input paths and environment values are not copied into
receipts. Runtime package checks reject links, extra files, case collisions,
traversal, drive/UNC paths, reserved names, oversized trees and changed bytes.

The Tauri build embeds the manifest SHA-256. Rust checks this digest and all
listed files before running Node. The launcher repeats full validation before
loading native libraries or starting the service. These hashes provide integrity
relative to the built shell; authenticity still depends on the installer trust
and platform code signing. A local attacker able to replace the shell is outside
this integrity boundary.

Required components are Node 24.14+ on the pinned 24.x line, the current bundled
Node service/launcher, FFmpeg/FFprobe, a CJK font, fontkit, resvg and their required
runtime dependencies. Preflight executes tools, checks versions, rejects FFmpeg
`--enable-nonfree`, requires a GPL receipt for GPL builds, checks libx264/AAC and
loads/rasterizes CJK text with the bundled font. Identifiers and checks do not
replace a distribution license review or a FFmpeg source-offer obligation.

ExifTool/Perl and Whisper are optional and not included by this first contract.
Metadata follows the existing explicit FFprobe/filesystem fallback. No model,
font or provider download happens during first run. System webviews and OS
libraries remain platform prerequisites. In particular, dynamically linked
FFmpeg binaries from a developer machine are not evidence of portable closure.

## Build an audited runtime

Run `pnpm install --frozen-lockfile` and `pnpm build`. Prepare a local ignored
`runtime-inputs.local.json` containing:

- `appVersion`, `nodeVersion`, `platform` (`linux`, `darwin`, `win32`) and
  `architecture` (`x64`, `arm64`);
- `tools.node`, `tools.ffmpeg`, `tools.ffprobe`, `tools.font`, each with `source`,
  independently reviewed `sha256`, exact `version`, SPDX `license`, `licenseFile`
  and `licenseSha256`;
- `dependencyLicenses` overrides `{packageName: {source, sha256}}` for installed
  packages that omit a full license text. The current closure needs these for
  fontkit, brotli, dfa and the platform-specific resvg native package;
- `distributionReview: {source, sha256, systemRequirements: string[]}` with an
  independently reviewed binary/license/source-obligation and OS/shared-library
  baseline receipt. Without this receipt the output is explicitly test-only and
  cannot pass installer admission.

Do not infer a distribution license from a filename or copy a generic receipt.
Review the actual binary build options, upstream source obligations and font
redistribution terms. Keep supplied binaries and full license texts in a reviewed
local build-input directory. Staging requires the target OS/architecture, copies
inputs without altering originals and never fetches network artifacts.

```sh
pnpm runtime:stage runtime-inputs.local.json /tmp/openfilm-runtime-candidate
pnpm exec tsx scripts/native/verify.ts /tmp/openfilm-runtime-candidate <reviewed-manifest-sha256>
```

The second command verifies the independently supplied manifest digest and that
the service/launcher match this checkout's `pnpm build`. It exercises owned
start/close with an empty temporary app-data directory. Staging uses exclusive
files, a cooperative output lock and sibling publication; existing destinations
are rejected. Identical inputs produce identical runtime manifests/inventory.
The npm closure comes from the frozen installed dependencies, with exact versions
and every copied file included in the manifest.

`Native installer candidate` is an explicit GitHub workflow. Supply a reviewed
runtime artifact ID from this repository and its independently reviewed manifest
digest, then select the matching runner OS/architecture. It verifies the bundle,
runs native checks and builds using `tauri.bundle.conf.json`. It produces installer
hash receipts and `candidate.json`, with Windows/macOS workstation status
`not-run`. It does not publish a release or claim the candidate is signed.

The default shell configuration keeps bundling disabled so a developer build
without runtime resources cannot accidentally be advertised as self-contained.
Windows candidates use NSIS current-user installation and require an installed
WebView2 runtime; the workflow does not silently bootstrap WebView2. Use the
platform's supported WebView2 installation process on the test machine.

## Service ownership and first run

Each shell starts only its own verified launcher. No arbitrary user/project JS,
HTML, URL, executable argument or runtime path is accepted over the bridge. The
launcher clears Node injection/provider environment values, uses a controlled
app-data cwd and limits PATH to bundled binaries. Application data/projects live
outside installation resources. The default project root uses Documents (or the
user home when Documents is unavailable), never the app-data working directory.

The service binds `127.0.0.1` on port 0. The OS chooses a free port; a private
random session path protects API and media URLs, alongside the existing Host and
Origin checks. A second shell gets an independent service/port/session. Neither
shell adopts or kills a process occupying the development port. A private IPC
control-ready event, service-ready record and authenticated workspace request are
all required before Edit mounts. Runtime status is shown in English, Traditional
Chinese and Japanese, with keyboard retry and no private paths in diagnostics.

The native shell requests close through a numbered bridge request. The UI first
runs its existing beforeunload draft protections. Pending drafts keep the window
open; an accepted close makes the workspace inert, then awaits existing
application cancellation/save/SQLite close, a matching private IPC acknowledgement
and a successful child exit. A close failure stays visible and does not authorize
force termination. The shared private IPC retains its existing benchmark wire
names for compatibility; native ownership is an explicit separate opt-in. Loss
of the native owner's input/IPC channel requests graceful shutdown of that owned
service only. An OS hard kill during a failed save cannot be certified as safe.

## Updates, rollback and project safety

Automatic updates are disabled and no feed or signing key is configured.
`verifyRuntimeUpdate` is a host-only extension requiring a trusted Ed25519 key,
a detached signature over the manifest and full runtime verification. It is not
an update downloader, project input or activation endpoint. There is no claim of
implemented automatic installation/rollback.

Manual rollback reinstalls the previous verified app/runtime candidate while
retaining application-data and project directories. The installer workflow has
no project/media deletion hooks. Supported projects use existing schema guards;
a version that cannot read a newer project/catalog refuses it. Do not downgrade
project files implicitly: keep a current backup/Named Version and obtain explicit
restore intent if a data restore is needed. Actual installer replace/failure/
rollback/uninstall behavior must pass the workstation checklist before release.

See [validation](validation-native-installer.md) and
[workstation QA](workstation-qa.md#m7e-native-installer-candidate).
