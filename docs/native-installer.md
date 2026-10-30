# Native runtime and installer candidates (M7E)

This candidate implements verified runtime staging, native startup/diagnostics,
owned shutdown and an installer build workflow. Windows/macOS installation QA,
release signing and an update feed are **not configured or validated**. A Linux
runtime process regression is not evidence of a self-contained Windows installer.
The 0.4.0 source integration includes M7A–M7D and M8A/M8B on the same
Composition/application contracts. Native distribution remains a separate
manual candidate gate.

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
Node service/launcher, FFmpeg/FFprobe, a CJK font, fontkit, resvg, Koffi and their required
runtime dependencies. Preflight executes tools, checks versions, rejects FFmpeg
`--enable-nonfree`, requires a GPL receipt for GPL builds, checks libx264/AAC and
loads/rasterizes CJK text with the bundled font. Identifiers and checks do not
replace a distribution license review or a FFmpeg source-offer obligation.

Koffi `3.3.3` and its exact host native addon are part of the verified inventory.
Its npm lifecycle script remains disabled (`allowBuilds.koffi: false`); frozen
installation uses the pinned prebuilt package. Staging requires the host addon
actually selected by the loader, retains the core and two Node API MIT notices,
and checks their reviewed hashes. Native preflight verifies all inventory hashes
before loading the addon. Missing OS symbols or unsupported filesystems do not
fall back to ordinary rename/copy. Actual Windows/macOS publication behavior
remains a workstation gate.

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
files, a cooperative output lock and atomic sibling no-replace publication; existing destinations
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
and a successful child exit. Startup cancellation reaches the owned launcher
without waiting behind readiness; late startup results cannot remount Edit.
A close failure stays visible and does not authorize force termination. An
already exited failed owner can be reaped before an explicit Retry. The shared
private IPC retains its existing benchmark wire
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

### Reviewed artifact transport

Upload the staged runtime as `runtime.tar` (archive its contents, preserving executable modes), inside an Actions artifact. Dispatch with both its source workflow run ID and artifact ID. The workflow validates archive paths and rejects links before extraction, then checks the independent manifest digest, complete file hashes, shell version and checkout build bytes. Rust is selected through `RUSTUP_TOOLCHAIN=1.99.0`.

Installer outputs are uploaded inside `installers.tar`, with an adjacent SHA-256
receipt and a separately readable `candidate.json`. Verify the archive digest,
then extract it to recover `bundle/` before running an AppImage or a macOS app.
The archive preserves executable modes and macOS bundle links through Actions
artifact transfer. Windows/macOS workstation fields remain `not-run` until the
candidate-bound checklist has actual observations.

The inactive signed-update verifier binds bundle validation to the digest of the
exact manifest bytes verified by Ed25519. Installer admission similarly checks
the independently reviewed digest against the same bytes it parses and uses for
the file inventory. Replacing the manifest between reads cannot substitute an
unsigned inventory.

## Explicit support files and emitted attribution

Tools may declare up to 32 `supportFiles` (Node/FFmpeg/FFprobe only). Each has
`id`, `source`, `destination`, `sha256`, `version`, `license`, `licenseFile`,
`licenseSha256`, and `executable`. `destination` is relative to the owning
executable's `bin/` directory; for example `lib/codec.so.1` stages as
`bin/lib/codec.so.1`. Parent traversal and absolute paths are rejected. Each file
has one `tool:<tool>:<id>` component and a full hash-pinned notice. Shared
sidecars need one explicit owner; duplicate destinations, aliases, links,
case collisions, missing notices, and wrong architectures fail staging. Full
historical first-party grants are retained under `licenses/historical/` to
avoid a cross-platform `LICENSES`/`licenses` case collision.

`inspect-linkage.py` reads ELF, PE, or Mach-O imports using literal argument
arrays for `readelf`, `dumpbin`, or `otool`; it does not load the inspected code,
copy host libraries, or add a loader search path. Its bounded policy contains
`schemaVersion: 1`, `platform`, `architecture`, `entrypoints`, a `files` map of
relative binary paths to exact hashes, and `systemImports`. `baseline` names the
OS, build, architecture and ABI. System imports use exact names and explicit
`reason` and `symbolVersions` lists. ELF versions must fit the reviewed list;
bundled libraries must supply required versions. ELF sidecars need an actual
origin-relative runpath. Developer paths, unresolved recursive imports, and
ambiguous destinations are rejected. Universal Mach-O inputs and unmodeled
loader layouts require separate review and are currently refused.

```sh
python3 scripts/native/inspect-linkage.py --root /path/to/staged-runtime \
  --policy /path/to/reviewed-linkage-policy.json --output /path/to/new-linkage.json
```

Supply staging `linkage: {policy: {source, sha256}, evidence: {source, sha256}}`.
The policy and executed evidence must cover every native tool/addon/sidecar.
For a reviewed runtime, `baseline.reviewed` must be `true` and
`baseline.reviewReceipt: {origin, sha256}` must name the same independently
reviewed receipt pinned by `distributionReview`. Local inspection or fixture
success cannot establish that review. Raw observations and tool identities stay
in the hash-covered linkage receipts; clean target preflight is still required.

`pnpm build` also emits `dist/build-contributions.json`, raw esbuild metafiles,
and Vite emitted-module records under `dist/attribution/`. Records identify
actual contributing modules, frozen package/source identities and output hashes,
including the esbuild and Vite/Vue runtime helpers that enter emitted chunks.
Esbuild helper presence is recorded with a null byte count; other byte hints use
esbuild output counts or Vite rendered lengths and are not a post-minification
license percentage. Raw esbuild delivery roles are retained independently, so a
shipped artifact cannot be edited into an unshipped CLI classification. The verifier
rebuilds the inventory from the raw maps; editing away a contributor, changing
source/package/lock bytes, or changing an output blocks attribution. Optional
lock entries and build-only packages are not automatically reported as shipped.

Staging accepts `attribution: {buildContributions: {source, sha256},
licenseReceipts: {source, sha256}}`; without an explicit contribution pin it
uses this checkout's generated contribution record when present. Each license
receipt names the exact `packageId` and `sourceIdentity`, `reviewed: true`, a
supported `licenseConcluded`, full `texts: [{source, sha256, origin}]`, and
`obligations`. Obligations contain `kind`, a full hash-pinned evidence `file`,
and, for source/configuration/relinking duties, the exact covered
`artifactSha256` list. The implementation requires applicable Apache NOTICE or
reviewed absence evidence, Node bundled notices, all three pinned Koffi MIT
notices, OFL reserved-name review, GPL/LGPL source/source-offer and relinking
evidence, MPL source disclosure and FFmpeg build configuration. A field such as
`NOASSERTION` never approves a license. Full text provenance remains explicit;
no copyright holders are invented. Missing source or notice evidence remains a
blocked review item even when a development binary runs.

`receipts/attribution.json` and the artifact-bound `sbom.spdx.json` are hashed by
RuntimeManifest v1. `runtimeReviewStatus` covers the JS/runtime/tool/npm/license
portion; overall `reviewStatus` stays blocked without actual native evidence.
The SPDX relationships distinguish emitted code, copied package files, compiled
Rust inputs, host build/proc-macro inputs and external OS dependencies.

The final native shell embeds the manifest digest, so its final hash cannot
appear inside a receipt hashed by that same manifest. After the real locked
release build with an explicit `--target` and `--message-format=json`, retain
its raw metadata, JSON compiler messages, exit status and Rust version.
`cargo-attribution.ts` consumes those local input paths, verifies source checksums
and artifact bytes, and classifies target code, host build/proc-macro inputs,
uncompiled packages and generated outputs. Proc-macro expansion requires an
explicit artifact-bound generated-code review before it can remain build-only. It normalizes workspace paths while
retaining a digest of the exact resolved Cargo identity. Generated code and Rust
sysroot/static runtime inputs need explicit source/contribution review; neither
the whole Cargo lock nor successful compilation supplies that review.

```sh
pnpm exec tsx scripts/native/cargo-attribution.ts local-cargo-inputs.json new-cargo-evidence.json
pnpm exec tsx scripts/native/attribute-distribution.ts local-distribution-inputs.json /path/to/new-native-evidence
```

The second command requires independently pinned build/Cargo/license inputs,
`repository`, `runtimeRoot`, and `runtimeManifestSha256`. Optional
`nativeLinkage`, `nativeRuntimeInputs`, and `targetDirectory` supply actual
shell linkage, reviewed Rust sysroot/static-runtime source inventories and the
explicit Cargo target directory. Native runtime inventories bind an identity,
full provenance evidence and the covered final shell hash; they still need
complete license receipts. The command writes separate native attribution,
Cargo contribution and SPDX receipts **outside** the runtime. It preserves the
embedded manifest and exits nonzero for blocked evidence. A later candidate
receipt must bind both the manifest and these external native receipts to final
installer/trust/security evidence. This work does not supply that candidate,
review the GLib remediation, or close any installer/workstation gate.

### Native post-build review corrections — 2026-10-30

Native-shell linkage readiness separately requires an executed, verified target
receipt, policy/tool digests, a successful matching binary observation, and a
reviewed OS/build/architecture/ABI baseline with its independent review reference.
A reviewed runtime does not implicitly review the shell. Fixture or failed
observations remain blocked; `distributionApproved` remains false.

Cargo link directives retain their observed target/host role from the actual
build-script output directory. Target static libraries and ambiguous unqualified
link names require exactly one `static-native` input whose `linkedLibraries`
array names the exact `{packageId, name}` directives. That input's source
inventory and final-shell artifact hashes must match, and its existing license
receipt must independently supply complete reviewed texts/obligations. The
attributed package and SPDX source information retain these exact directive
claims. Host-only generator libraries stay separate from shipped target code;
unknown, missing, mismatched or duplicate coverage blocks the native review.

Post-build output paths resolve their existing ancestors before any directory
or receipt write. Canonical descendants and directory aliases into the runtime
are refused, using the host's drive/case/separator rules. This preserves the
existing runtime inventory rather than placing external post-build evidence
inside it. The external receipt remains outside the manifest hash graph.
