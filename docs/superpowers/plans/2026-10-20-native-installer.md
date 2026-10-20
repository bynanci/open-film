# M7E runtime and installer implementation plan

User-provided scope: `07-M7E-Native-Installer.md`. Base is current main after
M7A; M7B/M7D/M8A remain independent open candidates with review findings.

1. Define a schema-v1 RuntimeManifest outside the project schema. Validate
   platform/architecture, safe relative paths, hashes, executable permissions,
   versions, license receipts and disabled update policy before execution.
2. Stage explicit hash-pinned Node/media/font inputs plus the current service,
   launcher and frozen-install native/font dependencies. Fail on missing license
   files; include complete SPDX inventory and NOTICE. Do not download runtime
   binaries or ship developer machine paths/credentials.
3. Launch one owned service via the verified Node executable and private IPC.
   Use an ephemeral loopback port, private session, readiness request, isolated
   environment and writable app-data cwd. Reuse existing application shutdown.
4. Embed the manifest digest in the Rust shell, verify resources before launch,
   expose typed startup status and graphical retry. Route native close through
   existing draft protection, then await service close and process exit.
5. Add an explicit candidate installer workflow that accepts a reviewed runtime
   artifact/digest, verifies the service against this checkout, builds on the
   selected platform and records artifact hashes. Keep signing, public feeds and
   automatic updating unconfigured; retain signed-update validation extension.
6. Prove real synthetic MP4 output, source identity, independent instances,
   shutdown/restart/reopen, corrupt runtime/path rejection and browser recovery.
   Run the repository gates and retain clean Windows/macOS as not-run.

No second timeline, project format or editing history is introduced. Installer
resources and application data are separate. Real target-machine installation,
upgrade/uninstall, dependency closure and signing are acceptance gates, not
inferences from a Linux process test.
